"""Deep Sentiment Skill — Gemini-powered review categorization.

Categorizes review text into Food, Drink, and Ambiance buckets with
sentiment scores from -1.0 (very negative) to 1.0 (very positive).

Falls back to keyword-based heuristic when Gemini API is unavailable.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import SentimentScore

logger = logging.getLogger(__name__)

# ── Keyword Heuristic (fallback) ──────────────────────────────────────────

FOOD_KEYWORDS = [
    "food", "dish", "meal", "plate", "menu", "chef", "cook", "taste",
    "flavor", "delicious", "bland", "stale", "fresh", "appetizer", "entree",
    "dessert", "salad", "burger", "pizza", "pasta", "sushi", "breakfast",
    "lunch", "dinner", "brunch", "portion", "ingredient",
]

DRINK_KEYWORDS = [
    "drink", "coffee", "latte", "espresso", "cappuccino", "tea", "beer",
    "wine", "cocktail", "juice", "smoothie", "soda", "water", "bar",
    "barista", "brew", "roast", "pour", "mocktail", "matcha", "lassi",
    "lemonade", "shake", "sake", "spirit", "liquor",
]

AMBIANCE_KEYWORDS = [
    "ambiance", "atmosphere", "decor", "vibe", "music", "lighting",
    "cozy", "loud", "quiet", "crowded", "clean", "dirty", "space",
    "seating", "patio", "outdoor", "interior", "design", "noise",
    "comfortable", "relaxing", "aesthetic", "warm", "welcoming",
]

POSITIVE_WORDS = {
    "great", "amazing", "excellent", "wonderful", "fantastic", "love",
    "perfect", "best", "good", "nice", "lovely", "delicious", "fresh",
    "beautiful", "cozy", "friendly", "relaxing", "comfortable", "superb",
    "outstanding", "incredible", "awesome", "refreshing", "tasty",
}

NEGATIVE_WORDS = {
    "bad", "terrible", "awful", "worst", "hate", "disgusting", "horrible",
    "bland", "stale", "dirty", "rude", "slow", "cold", "loud", "crowded",
    "overpriced", "disappointing", "mediocre", "poor", "nasty", "gross",
    "unpleasant",
}


def _keyword_sentiment(text: str, keywords: list[str]) -> tuple[float, bool]:
    """
    Compute sentiment score for a bucket based on keyword presence.
    Returns (score, has_content): score is -1.0 to 1.0, has_content is True
    if any bucket keyword was found.
    """
    text_lower = text.lower()
    clean_text = re.sub(r'[^a-zA-Z\s]', '', text_lower)
    words = clean_text.split()
    
    # Identify indices of keywords
    keyword_indices = [i for i, w in enumerate(words) if w in keywords]
    if not keyword_indices:
        return 0.0, False

    # Score based on sentiment words near ANY of the keywords (5-word window)
    window_words = set()
    for idx in keyword_indices:
        start = max(0, idx - 5)
        end = min(len(words), idx + 6)
        window_words.update(words[start:end])

    pos_count = len(window_words & POSITIVE_WORDS)
    neg_count = len(window_words & NEGATIVE_WORDS)
    total = pos_count + neg_count

    if total == 0:
        return 0.1, True  # Default slight positive for mention

    score = (pos_count - neg_count) / total
    return round(max(-1.0, min(1.0, score)), 2), True


def _generate_summary(text: str, bucket: str, score: float) -> str:
    """Generate a brief summary for a sentiment score."""
    sentiment = "positive" if score > 0.2 else "negative" if score < -0.2 else "neutral"
    return f"Review mentions {bucket} aspects with {sentiment} sentiment."


def analyze_sentiment_heuristic(review_text: str) -> list[dict]:
    """
    Fallback heuristic: analyse review text with keyword matching.
    Returns list of bucket results.
    """
    results = []
    for bucket_name, keywords in [
        ("food", FOOD_KEYWORDS),
        ("drink", DRINK_KEYWORDS),
        ("ambiance", AMBIANCE_KEYWORDS),
    ]:
        score, has_content = _keyword_sentiment(review_text, keywords)
        if has_content:
            results.append({
                "bucket": bucket_name,
                "score": score,
                "summary": _generate_summary(review_text, bucket_name, score),
            })

    # If no bucket matched at all, assign a neutral food score
    if not results:
        results.append({
            "bucket": "food",
            "score": 0.0,
            "summary": "No specific category detected in review.",
        })

    return results


# ── Gemini Integration ────────────────────────────────────────────────────

GEMINI_PROMPT = """You are a restaurant review analyst. Analyze the following review and categorize sentiment into exactly three buckets: "food", "drink", and "ambiance".

For each bucket, provide:
- score: a float from -1.0 (very negative) to 1.0 (very positive). Use 0.0 if the bucket is not mentioned.
- summary: a brief 1-sentence explanation.

Return ONLY valid JSON in this exact format:
[
  {"bucket": "food", "score": 0.8, "summary": "The food was praised for its freshness."},
  {"bucket": "drink", "score": -0.3, "summary": "Coffee was described as lukewarm."},
  {"bucket": "ambiance", "score": 0.5, "summary": "The atmosphere was described as cozy."}
]

Review text:
"""


async def analyze_sentiment_gemini(review_text: str) -> list[dict]:
    """Use Gemini to analyze review sentiment into buckets."""
    try:
        import google.generativeai as genai

        genai.configure(api_key=settings.GEMINI_API_KEY)
        model = genai.GenerativeModel(settings.GEMINI_MODEL)

        response = model.generate_content(GEMINI_PROMPT + review_text)
        text = response.text.strip()

        # Extract JSON from response (handle markdown code blocks)
        if "```" in text:
            json_match = re.search(r'```(?:json)?\s*(.*?)```', text, re.DOTALL)
            if json_match:
                text = json_match.group(1).strip()

        results = json.loads(text)

        # Validate structure
        validated = []
        for item in results:
            if "bucket" in item and "score" in item:
                validated.append({
                    "bucket": item["bucket"],
                    "score": max(-1.0, min(1.0, float(item["score"]))),
                    "summary": item.get("summary", ""),
                })
        return validated if validated else analyze_sentiment_heuristic(review_text)

    except Exception as e:
        logger.warning(f"Gemini analysis failed, falling back to heuristic: {e}")
        return analyze_sentiment_heuristic(review_text)


# ── Main Entry Point ─────────────────────────────────────────────────────

async def analyze_review(review_text: str) -> list[dict]:
    """
    Analyze a review's sentiment. Uses Gemini if API key is configured,
    otherwise falls back to keyword heuristic.
    """
    if settings.GEMINI_API_KEY:
        return await analyze_sentiment_gemini(review_text)
    return analyze_sentiment_heuristic(review_text)


async def analyze_and_store(
    db: AsyncSession, review_id: str, review_text: str
) -> list[SentimentScore]:
    """Analyze a review and store sentiment scores in the database."""
    results = await analyze_review(review_text)

    scores = []
    for item in results:
        score = SentimentScore(
            review_id=review_id,
            bucket=item["bucket"],
            score=item["score"],
            summary=item.get("summary", ""),
            analyzed_at=datetime.utcnow(),
        )
        db.add(score)
        scores.append(score)

    await db.flush()
    return scores
