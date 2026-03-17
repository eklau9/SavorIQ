"""AI Manager Briefing service — uses Gemini to generate actionable advice."""

from __future__ import annotations

import json
import logging
import re

from app.config import settings
from app.schemas import ItemPerformance, ManagerBriefing, ManagerInsight, BucketSentiment

logger = logging.getLogger(__name__)

BRIEFING_PROMPT = """You are a strategic restaurant consultant. Analyze the provided restaurant performance data and generate a high-level briefing for the owner.

- **Handling 3-Star Reviews**: Treat 3-star feedback as "neutral-to-positive" operational feedback. Use these to suggest "action" insights (e.g., "Guest mentioned inconsistent seasoning — consider a kitchen workshop").
- **Handling 1-2 Star Reviews**: Treat these as "risks". They require immediate "risk" insights.
- **Highlight ALL menu item names** in the summary AND in the insight descriptions by wrapping them in backticks (e.g., `Espresso`, `Oat Milk Latte`). Do NOT use any other markers like ++ or --. Only use backticks.
- **Do NOT put markers in insight titles**. Titles should be clean plain text with no backticks or special formatting.
- **IMPORTANT**: Use simple, direct vocabulary. Avoid complex jargon.
- Each insight MUST include a `steps` field containing 3-5 short, actionable bullets for the manager.

Return ONLY valid JSON in this exact format:
{
  "summary": "Overall, the restaurant is performing well with high marks in ambiance, though beverage sentiment has dipped slightly.",
  "insights": [
    {
      "title": "The Espresso Bloom",
      "description": "Your espresso is a top-tier performer; consider featuring it in a brunch promotion.",
      "type": "win",
      "steps": ["Feature in weekly newsletter", "Add as 'Staff Pick' on menu", "Post a demo video on Instagram"]
    },
    {
      "title": "Service Speed",
      "description": "Guests are mentioning slow service on Friday nights; look into staffing levels.",
      "type": "risk",
      "steps": ["Review Friday shift schedules", "Optimize kitchen-to-table workflow", "Cross-train staff for busy peaks"]
    }
  ]
}

RESTAURANT DATA:
"""

import hashlib
import asyncio

# Multi-slot cache: maps data_hash -> ManagerBriefing
_briefing_cache: dict[str, ManagerBriefing] = {}
# Concurrency locks: maps data_hash -> asyncio.Lock
_briefing_locks: dict[str, asyncio.Lock] = {}

async def generate_manager_briefing(
    bucket_sentiment: list[BucketSentiment],
    top_performers: list[ItemPerformance],
    risks: list[ItemPerformance],
    recent_reviews: list[str]
) -> ManagerBriefing:
    """Uses Gemini to generate a strategic briefing for the restaurant owner."""
    
    data_context = {
        "bucket_sentiment": [b.model_dump() for b in bucket_sentiment],
        "top_performers": [i.model_dump() for i in top_performers],
        "risks": [i.model_dump() for i in risks],
        "recent_feedback_snippets": recent_reviews[:10]  # Limit context
    }

    # 1. Check data version (Data-aware caching)
    # Add date string (PST) to context to force reload at midnight PST
    from datetime import datetime, timedelta, timezone
    
    # PST is UTC-8
    pst_now = datetime.now(timezone.utc) - timedelta(hours=8)
    date_str = pst_now.strftime("%Y-%m-%d")
    
    data_context["cache_date_pst"] = date_str
    
    data_str = json.dumps(data_context, sort_keys=True)
    data_hash = hashlib.md5(data_str.encode()).hexdigest()

    if data_hash in _briefing_cache:
        logger.info(f"Rapid Cache HIT for briefing: {data_hash}")
        return _briefing_cache[data_hash]

    # 3. Request Locking: Only allow ONE generation for this specific data hash
    if data_hash not in _briefing_locks:
        _briefing_locks[data_hash] = asyncio.Lock()
    
    async with _briefing_locks[data_hash]:
        # Re-check cache inside lock
        if data_hash in _briefing_cache:
            return _briefing_cache[data_hash]

        max_retries = 3
        retry_count = 0
        
        while retry_count < max_retries:
            try:
                import google.generativeai as genai
                
                if not settings.GEMINI_API_KEY:
                    raise ValueError("Gemini API key not configured")

                from app.services.gemini_tracker import record_gemini_request
                record_gemini_request()
                
                genai.configure(api_key=settings.GEMINI_API_KEY)
                model = genai.GenerativeModel(settings.GEMINI_MODEL)

                prompt = BRIEFING_PROMPT + json.dumps(data_context, indent=2)
                response = await model.generate_content_async(prompt)
                text = response.text.strip()

                # Extract JSON
                if "```" in text:
                    json_match = re.search(r'```(?:json)?\s*(.*?)```', text, re.DOTALL)
                    if json_match:
                        text = json_match.group(1).strip()

                payload = json.loads(text)
                
                result = ManagerBriefing(
                    summary=payload.get("summary", "No summary available."),
                    insights=[ManagerInsight(**i) for i in payload.get("insights", [])]
                )
                # Success! Break out of retry loop
                break

            except Exception as e:
                error_msg = str(e)
                if "429" in error_msg and retry_count < max_retries - 1:
                    retry_count += 1
                    wait_time = retry_count * 2
                    logger.warning(f"Gemini 429 Rate Limit hit. Retry {retry_count}/{max_retries} in {wait_time}s...")
                    await asyncio.sleep(wait_time)
                    continue
                
                logger.warning(f"Manager briefing generation failed: {e}")
                
                from app.services.gemini_tracker import get_gemini_usage, calibrate_gemini_usage
                usage = get_gemini_usage()
                
                is_429 = "429" in error_msg
                is_daily_quota = "PerDay" in error_msg or "per_day" in error_msg.lower()
                is_rpd_limited = usage.get("rpd", 0) >= usage.get("rpd_limit", 1000)
                is_rpm_limited = usage.get("rpm", 0) >= usage.get("rpm_limit", 15)
                
                if is_429 and (is_daily_quota or not is_rpm_limited):
                    # Google says we're done for the day — sync tracker to match
                    await calibrate_gemini_usage(usage.get("rpd_limit", 1000))
                    title = "Daily Quota Exhausted"
                    description = f"You've used your {usage.get('rpd_limit', 1000)} daily AI requests. Insights will resume tomorrow at midnight PT."
                elif is_rpm_limited:
                    title = "Minute Burst Limit Hit"
                    description = "Too many requests at once. Please wait 60 seconds for the burst limit to reset."
                elif is_429:
                    # 429 but not clearly daily — still likely exhausted
                    await calibrate_gemini_usage(usage.get("rpd_limit", 1000))
                    title = "Daily Quota Exhausted"
                    description = f"Google reports quota exceeded. Insights will resume tomorrow at midnight PT."
                else:
                    title = "AI Temporarily Unavailable"
                    description = f"Gemini returned an error: {error_msg[:80]}. Try again in a moment."
                
                # Return a fallback briefing WITHOUT caching it
                return ManagerBriefing(
                    summary="AI Briefing is temporarily paused due to API limits. Manual data below is still live.",
                    insights=[
                        ManagerInsight(
                            title=title,
                            description=description,
                            type="risk",
                            steps=["Check the Admin dashboard for live quota status", "Insights reset at midnight Pacific Time", "Review manual analytics below"]
                        )
                    ]
                )

    # Update cache (only for successful results)
    _briefing_cache[data_hash] = result
    
    # Optional: limit cache size
    if len(_briefing_cache) > 20:
        _briefing_cache.pop(next(iter(_briefing_cache)))

    return result
