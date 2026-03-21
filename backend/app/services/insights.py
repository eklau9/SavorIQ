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
- Each insight MUST include a `keywords` field: 2-4 short phrases that appear VERBATIM in the actual review texts provided. These are used to search and filter which reviews relate to this insight. Use lowercase. Pick distinctive words/phrases guests actually wrote (e.g., "reservation", "cold food", "wasabi", "minimum order").
- Each insight MUST include a `review_indices` field: a list of review index numbers (from the numbered reviews below) that this insight is based on. Include ALL reviews that contributed to this insight. Use the index numbers provided.

Return ONLY valid JSON in this exact format:
{
  "summary": "Overall, the restaurant is performing well with high marks in ambiance, though beverage sentiment has dipped slightly.",
  "insights": [
    {
      "title": "The Espresso Bloom",
      "description": "Your espresso is a top-tier performer; consider featuring it in a brunch promotion.",
      "type": "win",
      "steps": ["Feature in weekly newsletter", "Add as 'Staff Pick' on menu", "Post a demo video on Instagram"],
      "keywords": ["espresso", "coffee", "brunch"],
      "review_indices": [0, 3, 7, 12]
    },
    {
      "title": "Service Speed",
      "description": "Guests are mentioning slow service on Friday nights; look into staffing levels.",
      "type": "risk",
      "steps": ["Review Friday shift schedules", "Optimize kitchen-to-table workflow", "Cross-train staff for busy peaks"],
      "keywords": ["slow service", "waited", "friday"],
      "review_indices": [1, 5, 9]
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

# TPM guard: max reviews to send before hitting free-tier token limits
MAX_REVIEWS_FOR_GEMINI = 1300  # ~200K tokens at ~150 tokens/review


async def generate_manager_briefing(
    bucket_sentiment: list[BucketSentiment],
    top_performers: list[ItemPerformance],
    risks: list[ItemPerformance],
    recent_reviews: list[dict],  # [{id: str, text: str}, ...]
) -> ManagerBriefing:
    """Uses Gemini to generate a strategic briefing for the restaurant owner.
    
    recent_reviews: list of dicts with 'id' and 'text' keys.
    """
    
    review_count_note = None
    total_available = len(recent_reviews)
    
    # TPM guard: cap reviews if they exceed safe token limit
    if total_available > MAX_REVIEWS_FOR_GEMINI:
        recent_reviews = recent_reviews[:MAX_REVIEWS_FOR_GEMINI]
        review_count_note = f"Based on {MAX_REVIEWS_FOR_GEMINI:,} of {total_available:,} most recent reviews"
        logger.info(f"TPM guard: capped reviews from {total_available} to {MAX_REVIEWS_FOR_GEMINI}")

    # Build indexed review list for Gemini
    indexed_reviews = [
        {"idx": i, "text": r["text"]}
        for i, r in enumerate(recent_reviews)
    ]
    
    # Map from index -> review ID for later lookup
    idx_to_id = {i: r["id"] for i, r in enumerate(recent_reviews)}

    data_context = {
        "bucket_sentiment": [b.model_dump() for b in bucket_sentiment],
        "top_performers": [i.model_dump() for i in top_performers],
        "risks": [i.model_dump() for i in risks],
        "recent_feedback_snippets": indexed_reviews,
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

        max_retries = 5
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
                
                # Map review_indices back to actual review IDs
                insights = []
                for i in payload.get("insights", []):
                    review_indices = i.get("review_indices", [])
                    review_ids = [
                        idx_to_id[idx] for idx in review_indices
                        if idx in idx_to_id
                    ]
                    insights.append(ManagerInsight(
                        title=i.get("title", ""),
                        description=i.get("description", ""),
                        type=i.get("type", "action"),
                        steps=i.get("steps", []),
                        keywords=i.get("keywords", []),
                        review_ids=review_ids,
                    ))
                
                result = ManagerBriefing(
                    summary=payload.get("summary", "No summary available."),
                    insights=insights,
                    review_count_note=review_count_note,
                )
                # Success! Break out of retry loop
                break

            except Exception as e:
                error_msg = str(e)
                if "429" in error_msg and retry_count < max_retries - 1:
                    retry_count += 1
                    wait_time = min(5 * retry_count, 20)  # 5s, 10s, 15s, 20s — covers RPM reset window
                    logger.warning(f"Gemini 429 Rate Limit hit. Retry {retry_count}/{max_retries} in {wait_time}s...")
                    await asyncio.sleep(wait_time)
                    continue
                
                logger.warning(f"Manager briefing generation failed: {e}")
                
                from app.services.gemini_tracker import get_gemini_usage, calibrate_gemini_usage
                usage = get_gemini_usage()
                
                is_429 = "429" in error_msg
                is_daily_quota = "PerDay" in error_msg or "per_day" in error_msg.lower()
                
                if is_429 and is_daily_quota:
                    # Google EXPLICITLY says daily quota is done — sync tracker to match
                    await calibrate_gemini_usage(usage.get("rpd_limit", 1000))
                    title = "Daily Quota Exhausted"
                    description = f"You've used your {usage.get('rpd_limit', 1000)} daily AI requests. Insights will resume tomorrow at midnight PT."
                elif is_429:
                    # Any other 429 is almost always an RPM burst limit (15/min)
                    # Don't calibrate daily tracker — this is a temporary minute-level throttle
                    title = "Rate Limit — Try Again Shortly"
                    description = "Too many AI requests at once. This resets in 60 seconds — try switching time ranges or refreshing."
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
                            steps=["Wait 60 seconds and refresh", "Try a different time range", "Check the Admin dashboard for live quota status"],
                            keywords=[],
                            review_ids=[],
                        )
                    ],
                    review_count_note=None,
                )

    # Update cache (only for successful results)
    _briefing_cache[data_hash] = result
    
    # Optional: limit cache size
    if len(_briefing_cache) > 20:
        _briefing_cache.pop(next(iter(_briefing_cache)))

    return result
