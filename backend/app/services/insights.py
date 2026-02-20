"""AI Manager Briefing service — uses Gemini to generate actionable advice."""

from __future__ import annotations

import json
import logging
import re

from app.config import settings
from app.schemas import ItemPerformance, ManagerBriefing, ManagerInsight, BucketSentiment

logger = logging.getLogger(__name__)

BRIEFING_PROMPT = """You are a strategic restaurant consultant. Analyze the provided restaurant performance data and generate a high-level briefing for the owner.

Input Data:
1. Bucket Sentiment: Average sentiment scores for Food, Drink, and Ambiance.
2. Top Performers: Best-selling items with high sentiment.
3. Risk Items: Best-selling items with poor sentiment.
4. Recent Trends: Specific highlights from guest feedback.

Output Requirements:
- A concise summary (2-3 sentences) of the overall restaurant health.
- Exactly 3-4 actionable insights categorized as:
  - "win": Celebrate the success of a popular item or practice.
  - "risk": Identify a critical issue that needs immediate attention.
  - "action": Sustained improvements or new opportunities.
- **Highlight ALL item names** in the summary AND in the insight descriptions using these markers:
  - `++Item Name++` for positive items (e.g., top performers like **Espresso** or **Oat Milk Latte**).
  - `--Item Name--` for negative/risk items (e.g., risks like **Cold Brew** or **Chicken Curry**).
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

# Simple in-memory cache for the manager briefing
_briefing_cache: dict[str, any] = {
    "hash": None,
    "briefing": None
}

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

    if _briefing_cache["hash"] == data_hash and _briefing_cache["briefing"]:
        logger.info("Serving manager briefing from data-aware cache")
        return _briefing_cache["briefing"]

    try:
        import google.generativeai as genai
        
        if not settings.GEMINI_API_KEY:
            raise ValueError("Gemini API key not configured")

        genai.configure(api_key=settings.GEMINI_API_KEY)
        model = genai.GenerativeModel(settings.GEMINI_MODEL)

        prompt = BRIEFING_PROMPT + json.dumps(data_context, indent=2)
        response = model.generate_content(prompt)
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

    except Exception as e:
        logger.warning(f"Manager briefing generation failed: {e}")
        # Return a fallback briefing
        result = ManagerBriefing(
            summary="Unable to generate AI briefing at this time. Please check your manual analytics below.",
            insights=[
                ManagerInsight(
                    title="API Unavailable",
                    description="The AI insight engine is currently offline. Review your top performers and risks manually.",
                    type="risk"
                )
            ]
        )

    # Update cache (Cache the result, even if it's the fallback, for this data state)
    _briefing_cache["hash"] = data_hash
    _briefing_cache["briefing"] = result
    
    return result
