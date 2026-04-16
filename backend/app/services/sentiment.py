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
from app.services.gemini_tracker import record_gemini_request

logger = logging.getLogger(__name__)

BATCH_PROMPT = """Analyze the following restaurant reviews and return a JSON object.
For each review, categorize the sentiment into 'food', 'drink', or 'ambiance' buckets.
Each bucket should have a score from -1.0 (very negative) to 1.0 (very positive) and a brief English summary.

IMPORTANT:
1. The input reviews may be in any language (Chinese, Spanish, etc.).
2. You MUST analyze the sentiment regardless of the language.
3. The 'summary' you return MUST be in English.
4. If a review doesn't mention a specific category, omit that bucket.

Input format: [{"id": "...", "text": "..."}, ...]
Output format: {"results": [{"id": "...", "sentiment": [{"bucket": "food", "score": 0.8, "summary": "..."}, ...]}]}
"""

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


from abc import ABC, abstractmethod

# ── Service Interface ─────────────────────────────────────────────────────

class SentimentAnalyzer(ABC):
    @abstractmethod
    async def analyze_batch(self, reviews: List[Dict[str, str]]) -> Dict[str, List[Dict[str, Any]]]:
        """Analyze a batch of reviews."""
        pass

    @abstractmethod
    async def analyze_single(self, text: str) -> List[Dict[str, Any]]:
        """Analyze a single review."""
        pass


# ── Heuristic Implementation ─────────────────────────────────────────────

class HeuristicAnalyzer(SentimentAnalyzer):
    async def analyze_batch(self, reviews: List[Dict[str, str]]) -> Dict[str, List[Dict[str, Any]]]:
        return {r["id"]: await self.analyze_single(r["text"]) for r in reviews}

    async def analyze_single(self, text: str) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        for bucket_name, keywords in [
            ("food", FOOD_KEYWORDS),
            ("drink", DRINK_KEYWORDS),
            ("ambiance", AMBIANCE_KEYWORDS),
        ]:
            score, has_content = _keyword_sentiment(text, keywords)
            if has_content:
                results.append({
                    "bucket": bucket_name,
                    "score": score,
                    "summary": _generate_summary(text, bucket_name, score),
                })
        if not results:
            results.append({
                "bucket": "food",
                "score": 0.0,
                "summary": "No specific category detected in review.",
            })
        return results


# ── Gemini Implementation ────────────────────────────────────────────────

class GeminiAnalyzer(SentimentAnalyzer):
    def __init__(self, api_key: str, model_name: str):
        self.api_key = api_key
        self.model_name = model_name
        self.heuristic = HeuristicAnalyzer()

    async def analyze_batch(self, reviews: List[Dict[str, str]], _depth: int = 0) -> Dict[str, List[Dict[str, Any]]]:
        if not reviews:
            return {}

        id_map = {f"idx_{i}": r["id"] for i, r in enumerate(reviews)}
        gemini_reviews = [{"id": f"idx_{i}", "text": r["text"]} for i, r in enumerate(reviews)]

        # Record request to internal tracker
        record_gemini_request()

        try:
            import google.generativeai as genai
            import asyncio
            genai.configure(api_key=self.api_key, transport="rest")
            model = genai.GenerativeModel(self.model_name)

            batch_input = json.dumps(gemini_reviews)
            prompt = BATCH_PROMPT + batch_input

            # REST transport requires sync client wrapped in thread pool (same as insights.py)
            def _sync_generate():
                return model.generate_content(prompt)

            response = await asyncio.wait_for(
                asyncio.to_thread(_sync_generate),
                timeout=60.0
            )
            text = response.text.strip()

            if "```" in text:
                json_match = re.search(r'```(?:json)?\s*(.*?)```', text, re.DOTALL)
                if json_match:
                    text = json_match.group(1).strip()

            # Try parsing, with repair on failure
            try:
                data = json.loads(text)
            except json.JSONDecodeError:
                # Attempt JSON repair: strip trailing commas, fix common issues
                repaired = re.sub(r',\s*([}\]])', r'\1', text)  # trailing commas
                repaired = re.sub(r'}\s*{', '},{', repaired)     # missing commas between objects
                try:
                    data = json.loads(repaired)
                    logger.info(f"Gemini JSON repaired successfully for batch of {len(reviews)}")
                except json.JSONDecodeError:
                    raise  # Let outer except handle it

            mapping = {}
            for res in data.get("results", []):
                temp_id = res["id"]
                original_id = id_map.get(temp_id)
                if original_id:
                    mapping[original_id] = res["sentiment"]
            
            return mapping

        except Exception as e:
            # If batch is splittable and we haven't recursed too deep, split and retry
            if len(reviews) > 1 and _depth < 2:
                mid = len(reviews) // 2
                logger.warning(f"Batch Gemini failed ({e}), splitting {len(reviews)} → {mid}+{len(reviews)-mid} and retrying")
                left = await self.analyze_batch(reviews[:mid], _depth + 1)
                right = await self.analyze_batch(reviews[mid:], _depth + 1)
                left.update(right)
                return left
            logger.warning(f"Batch Gemini analyzer failed: {e}")
            return await self.heuristic.analyze_batch(reviews)

    async def analyze_single(self, text: str) -> List[Dict[str, Any]]:
        try:
            import google.generativeai as genai
            import asyncio
            genai.configure(api_key=self.api_key, transport="rest")
            model = genai.GenerativeModel(self.model_name)

            # Reuse batch logic with 1 item
            results = await self.analyze_batch([{"id": "single", "text": text}])
            return results.get("single", await self.heuristic.analyze_single(text))

        except Exception as e:
            logger.warning(f"Gemini analyzer failed: {e}")
            return await self.heuristic.analyze_single(text)


# ── Factory ──────────────────────────────────────────────────────────────

def get_analyzer() -> SentimentAnalyzer:
    """Returns the configured sentiment analyzer."""
    if settings.GEMINI_API_KEY:
        return GeminiAnalyzer(settings.GEMINI_API_KEY, settings.GEMINI_MODEL)
    return HeuristicAnalyzer()


# ── Main Entry Points (Legacy Compatibility) ──────────────────────────────

async def analyze_review(review_text: str) -> List[Dict[str, Any]]:
    return await get_analyzer().analyze_single(review_text)

async def analyze_and_store_batch(db: AsyncSession, reviews: List[Dict[str, str]]) -> int:
    if not reviews:
        return 0
    analyzer = get_analyzer()
    mapping = await analyzer.analyze_batch(reviews)
    
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


async def analyze_batch_no_db(reviews: List[Dict[str, str]]) -> Dict[str, List[Dict[str, Any]]]:
    """Run sentiment analysis only (no DB writes).

    Used for concurrent execution — callers collect results from multiple
    parallel batches, then write to the DB sequentially.
    """
    if not reviews:
        return {}
    analyzer = get_analyzer()
    return await analyzer.analyze_batch(reviews)
