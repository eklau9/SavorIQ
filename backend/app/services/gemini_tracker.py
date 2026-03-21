import time
import logging
import json
import os
from collections import deque
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Free Tier Limits
RPM_LIMIT = 15
RPD_LIMIT = 1500
TRACKER_FILE = "gemini_quota.json"

# In-memory storage
_recent_requests: deque[float] = deque()

def _load_data() -> dict:
    if os.path.exists(TRACKER_FILE):
        try:
            with open(TRACKER_FILE, "r") as f:
                return json.load(f)
        except:
            pass
    return {"daily_requests": 0, "current_day": ""}

def _save_data(daily_requests: int, current_day: str):
    try:
        with open(TRACKER_FILE, "w") as f:
            json.dump({"daily_requests": daily_requests, "current_day": current_day}, f)
    except Exception as e:
        logger.error(f"Failed to save quota data: {e}")

def _maybe_reset_daily() -> tuple[int, str]:
    data = _load_data()
    daily_requests = data["daily_requests"]
    current_day = data["current_day"]
    
    # Use local time to match user's day and likely Google reset window
    today = datetime.now().strftime("%Y-%m-%d")
    if today != current_day:
        daily_requests = 0
        current_day = today
        _save_data(daily_requests, current_day)
    return daily_requests, current_day

def _clear_old_requests() -> None:
    """Remove timestamps older than 60 seconds."""
    now = time.time()
    while _recent_requests and now - _recent_requests[0] > 60:
        _recent_requests.popleft()

def record_gemini_request() -> None:
    """Call whenever a Gemini API request is attempted."""
    now = time.time()
    daily_requests, current_day = _maybe_reset_daily()
    _clear_old_requests()
    
    _recent_requests.append(now)
    daily_requests += 1
    _save_data(daily_requests, current_day)

def get_gemini_usage() -> dict:
    """Return usage stats for the dashboard."""
    daily_requests, _ = _maybe_reset_daily()
    _clear_old_requests()
    
    rpm = len(_recent_requests)
    
    return {
        "rpm": rpm,
        "rpm_limit": RPM_LIMIT,
        "rpd": daily_requests,
        "rpd_limit": RPD_LIMIT,
        "is_rate_limited": rpm >= RPM_LIMIT or daily_requests >= RPD_LIMIT
    }

async def calibrate_gemini_usage(manual_count: int = 0) -> None:
    """Manually update or reset the internal daily counter."""
    _, current_day = _maybe_reset_daily()
    _save_data(manual_count, current_day)

async def perform_gemini_probe() -> dict:
    """
    Hit the Gemini API once with a tiny request to see if quota is available.
    If it works, we calibrate the internal tracker back to safe levels.
    """
    from app.config import settings
    import google.generativeai as genai

    if not settings.GEMINI_API_KEY:
        return {"configured": False, "error": "API Key missing"}

    try:
        genai.configure(api_key=settings.GEMINI_API_KEY)
        model = genai.GenerativeModel(settings.GEMINI_MODEL)
        
        # 1-token probe request
        response = await model.generate_content_async("hi")
        
        if response.text:
            # Success! Gemini is reachable — record this probe but keep the daily counter intact
            record_gemini_request() # record this probe as +1
            return {"configured": True, "status": "success", "message": "Probe successful. Gemini is reachable."}
        
        return {"configured": True, "status": "error", "message": "Unexpected empty response"}
    except Exception as e:
        error_msg = str(e).lower()
        usage = get_gemini_usage()
        
        if "429" in error_msg:
            # Only calibrate to 1500 if Google EXPLICITLY says daily quota
            if "perday" in error_msg or "per_day" in error_msg:
                await calibrate_gemini_usage(1500)
                return {"configured": True, "status": "error", "message": "Daily Quota Exhausted (1500/1500)."}
            
            # Otherwise it's a minute-level burst limit (RPM) — much more common
            return {"configured": True, "status": "error", "message": "Minute Burst Limit Hit (RPM). Try again in 60 seconds."}
            
        return {"configured": True, "status": "error", "message": str(e)}
