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

Return ONLY valid JSON in this exact format:
{
  "summary": "Overall, the restaurant is performing well with high marks in ambiance, though beverage sentiment has dipped slightly.",
  "insights": [
    {"title": "The Espresso Bloom", "description": "Your espresso is a top-tier performer; consider featuring it in a brunch promotion.", "type": "win"},
    {"title": "Service Speed", "description": "Guests are mentioning slow service on Friday nights; look into staffing levels.", "type": "risk"}
  ]
}

RESTAURANT DATA:
"""

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
        
        return ManagerBriefing(
            summary=payload.get("summary", "No summary available."),
            insights=[ManagerInsight(**i) for i in payload.get("insights", [])]
        )

    except Exception as e:
        logger.warning(f"Manager briefing generation failed: {e}")
        # Return a fallback briefing
        return ManagerBriefing(
            summary="Unable to generate AI briefing at this time. Please check your manual analytics below.",
            insights=[
                ManagerInsight(
                    title="API Unavailable",
                    description="The AI insight engine is currently offline. Review your top performers and risks manually.",
                    type="risk"
                )
            ]
        )
