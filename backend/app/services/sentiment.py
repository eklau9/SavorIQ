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
from typing import Any, Dict, List

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


def analyze_sentiment_heuristic(review_text: str) -> List[Dict[str, Any]]:
    """
    Fallback heuristic: analyse review text with keyword matching.
    Returns list of bucket results.
    """
    results: List[Dict[str, Any]] = []
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

# ── Gemini Batch Prompt ──────────────────────────────────────────────────

BATCH_PROMPT = """You are a restaurant review analyst. Analyze the following list of reviews and for EACH review, categorize sentiment into exactly three buckets: "food", "drink", and "ambiance".

For each bucket, provide:
- score: a float from -1.0 (very negative) to 1.0 (very positive). Use 0.0 if not mentioned.
- summary: a brief 1-sentence explanation.

EXTREMELY IMPORTANT:
1. You must return a JSON object with a key "results" that is a list of objects.
2. Each object in the "results" list MUST include the "id" provided in the input list so we can map it back correctly.
3. Return ONLY valid JSON.

Format:
{
  "results": [
    {
      "id": "review_id_1",
      "sentiment": [
        {"bucket": "food", "score": 0.8, "summary": "..."},
        {"bucket": "drink", "score": 0.0, "summary": "..."},
        {"bucket": "ambiance", "score": 0.5, "summary": "..."}
      ]
    },
    ...
  ]
}

Reviews to analyze:
"""


async def analyze_sentiment_batch(reviews: List[Dict[str, str]]) -> Dict[str, List[Dict[str, Any]]]:
    """
    Use Gemini to analyze a batch of reviews in a single call.
    'reviews' should be a list of {'id': id, 'text': text}.
    Returns a dict mapping review_id -> list of sentiment results.

    Uses a temporary ID mapping (idx_0, idx_1...) to prevent Gemini from 
    truncating long UUID strings in the JSON response.
    """
    if not reviews:
        return {}

    # 1. Create mapping to protect IDs from LLM truncation
    id_map = {f"idx_{i}": r["id"] for i, r in enumerate(reviews)}
    gemini_reviews = [{"id": f"idx_{i}", "text": r["text"]} for i, r in enumerate(reviews)]

    try:
        import google.generativeai as genai

        genai.configure(api_key=settings.GEMINI_API_KEY)
        model = genai.GenerativeModel(settings.GEMINI_MODEL)

        # Prepare batch context
        batch_input = json.dumps(gemini_reviews)
        response = await model.generate_content_async(BATCH_PROMPT + batch_input)
        text = response.text.strip()

        # Clean JSON
        if "```" in text:
            json_match = re.search(r'```(?:json)?\s*(.*?)```', text, re.DOTALL)
            if json_match:
                text = json_match.group(1).strip()

        data = json.loads(text)
        
        # Mapping results back to original IDs
        mapping = {}
        for res in data.get("results", []):
            temp_id = res["id"]
            original_id = id_map.get(temp_id)
            if original_id:
                mapping[original_id] = res["sentiment"]
            else:
                logger.warning(f"Gemini returned unknown temp ID: {temp_id}")
        
        return mapping

    except Exception as e:
        logger.warning(f"Batch Gemini analysis failed: {e}. Falling back to individual heuristics.")
        # Fallback: process each individually with heuristic
        return {r["id"]: analyze_sentiment_heuristic(r["text"]) for r in reviews}


async def analyze_sentiment_gemini(review_text: str) -> List[Dict[str, Any]]:
    """Use Gemini to analyze review sentiment into buckets."""
    try:
        import google.generativeai as genai

        genai.configure(api_key=settings.GEMINI_API_KEY)
        model = genai.GenerativeModel(settings.GEMINI_MODEL)

        response = await model.generate_content_async(GEMINI_PROMPT + review_text)
        text = response.text.strip()

        # Extract JSON from response (handle markdown code blocks)
        if "```" in text:
            json_match = re.search(r'```(?:json)?\s*(.*?)```', text, re.DOTALL)
            if json_match:
                text = json_match.group(1).strip()

        results = json.loads(text)

        # Validate structure
        validated: List[Dict[str, Any]] = []
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

async def analyze_review(review_text: str) -> List[Dict[str, Any]]:
    """
    Analyze a review's sentiment. Uses Gemini if API key is configured,
    otherwise falls back to keyword heuristic.
    """
    if settings.GEMINI_API_KEY:
        return await analyze_sentiment_gemini(review_text)
    return analyze_sentiment_heuristic(review_text)


async def analyze_and_store_batch(
    db: AsyncSession, reviews: List[Dict[str, str]]
) -> int:
    """
    Analyze a batch of reviews and store sentiment scores.
    Returns the count of successfully analyzed reviews.
    """
    if not reviews:
        return 0

    # 1. Get batch sentiment mapping
    mapping = await analyze_sentiment_batch(reviews)
    
    count = 0
    for r_id, results in mapping.items():
        for item in results:
            score = SentimentScore(
                review_id=r_id,
                bucket=item["bucket"],
                score=float(item.get("score", 0.0)),
                summary=item.get("summary", ""),
                analyzed_at=datetime.utcnow(),
            )
            db.add(score)
        count += 1

    await db.flush()
    return count
