"""Internal Yelp API usage tracker.

Counts requests made through SavorIQ to avoid calling the Yelp API
just to check remaining quota. Resets daily at midnight UTC.
"""

from __future__ import annotations

from datetime import datetime, timezone

import httpx
from app.config import settings

# Yelp Fusion free tier: 300 requests/day (as of 2024)
YELP_DAILY_LIMIT = 300

_request_count: int = 0
_current_date: str = ""


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _maybe_reset() -> None:
    """Reset counter if it's a new UTC day."""
    global _request_count, _current_date
    today = _today_utc()
    if today != _current_date:
        _request_count = 0
        _current_date = today


def record_yelp_request(count: int = 1) -> None:
    """Call this after each successful Yelp API request."""
    global _request_count
    _maybe_reset()
    _request_count += count


def get_yelp_usage() -> dict:
    """Return current usage stats for the dashboard."""
    _maybe_reset()
    remaining = max(0, YELP_DAILY_LIMIT - _request_count)
    # Calculate tomorrow's reset
    return {
        "configured": True,
        "daily_limit": YELP_DAILY_LIMIT,
        "used_today": _request_count,
        "remaining": remaining,
        "resets_at": "Daily at midnight UTC",
        "tracking": "internal",
    }


def calibrate_yelp_usage(remaining: int, total_limit: int | None = None) -> None:
    """Update internal counter based on live data from Yelp headers."""
    global _request_count
    _maybe_reset()
    
    limit = total_limit or YELP_DAILY_LIMIT
    # If Yelp says we have 'remaining' left, then we have used 'limit - remaining'
    _request_count = max(0, limit - remaining)


async def perform_live_sync() -> dict:
    """
    Hit the Yelp API once to get the current quota status and update local tracker.
    Returns the live data dict.
    """
    if not settings.YELP_API_KEY:
        return {"configured": False}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # We do a tiny search to get the ratelimit headers
            resp = await client.get(
                "https://api.yelp.com/v3/businesses/search?location=San+Jose&limit=1",
                headers={
                    "Authorization": f"Bearer {settings.YELP_API_KEY}",
                    "Accept": "application/json",
                },
            )
            
            data = {
                "configured": True,
                "daily_limit": resp.headers.get("ratelimit-limit", "Unknown"),
                "remaining": resp.headers.get("ratelimit-remaining", "Unknown"),
                "resets_at": resp.headers.get("ratelimit-resettime", "Unknown"),
            }
            
            if data["remaining"] != "Unknown":
                remaining = int(data["remaining"])
                limit = int(data["daily_limit"]) if data["daily_limit"] != "Unknown" else None
                calibrate_yelp_usage(remaining, limit)
                
            return data
    except Exception as e:
        return {"configured": True, "error": str(e)}
