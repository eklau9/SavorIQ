"""Tests for the Deep Sentiment analysis service."""

import pytest

from app.services.sentiment import (
    _keyword_sentiment,
    analyze_review,
    analyze_sentiment_heuristic,
    FOOD_KEYWORDS,
    DRINK_KEYWORDS,
    AMBIANCE_KEYWORDS,
)


class TestKeywordSentiment:
    def test_food_positive(self):
        score, has_content = _keyword_sentiment(
            "The food was absolutely delicious and fresh!", FOOD_KEYWORDS
        )
        assert has_content is True
        assert score > 0

    def test_food_negative(self):
        score, has_content = _keyword_sentiment(
            "The food was terrible and the dish was bland.", FOOD_KEYWORDS
        )
        assert has_content is True
        assert score < 0

    def test_drink_positive(self):
        score, has_content = _keyword_sentiment(
            "The coffee was perfect and the latte was amazing!", DRINK_KEYWORDS
        )
        assert has_content is True
        assert score > 0

    def test_no_match(self):
        score, has_content = _keyword_sentiment(
            "I visited the place yesterday.", FOOD_KEYWORDS
        )
        assert has_content is False
        assert score == 0.0

    def test_neutral_mention(self):
        score, has_content = _keyword_sentiment(
            "The food was served.", FOOD_KEYWORDS
        )
        assert has_content is True
        assert score == 0.1  # Slight positive bias

    def test_ambiance_negative(self):
        score, has_content = _keyword_sentiment(
            "The atmosphere was terrible, too loud and crowded.", AMBIANCE_KEYWORDS
        )
        assert has_content is True
        assert score < 0


class TestAnalyzeSentimentHeuristic:
    def test_multi_bucket_review(self):
        text = "The food was delicious, the coffee was great, and the atmosphere was cozy!"
        results = analyze_sentiment_heuristic(text)

        buckets = {r["bucket"] for r in results}
        assert "food" in buckets
        assert "drink" in buckets
        assert "ambiance" in buckets

    def test_food_only_review(self):
        text = "The pasta was amazing and the dessert was perfect!"
        results = analyze_sentiment_heuristic(text)

        assert any(r["bucket"] == "food" for r in results)
        food_result = next(r for r in results if r["bucket"] == "food")
        assert food_result["score"] > 0

    def test_no_category_fallback(self):
        text = "I visited this place on a Tuesday. It was fine."
        results = analyze_sentiment_heuristic(text)

        # Should return at least one result (fallback)
        assert len(results) >= 1
        assert results[0]["bucket"] == "food"

    def test_summary_generation(self):
        text = "The food was great and the coffee was bad."
        results = analyze_sentiment_heuristic(text)

        for r in results:
            assert "summary" in r
            assert len(r["summary"]) > 0

    def test_mixed_sentiment_review(self):
        text = "Terrible food but the drink selection was amazing and the music was nice."
        results = analyze_sentiment_heuristic(text)
        assert len(results) >= 2


class TestAnalyzeReview:
    @pytest.mark.asyncio
    async def test_falls_back_to_heuristic(self):
        """Without a Gemini API key, should use the heuristic."""
        results = await analyze_review("The food was great and the latte was perfect!")
        assert isinstance(results, list)
        assert len(results) > 0
        for r in results:
            assert "bucket" in r
            assert "score" in r
            assert -1.0 <= r["score"] <= 1.0

    @pytest.mark.asyncio
    async def test_score_bounds(self):
        results = await analyze_review("Everything was absolutely amazing: the food, drinks, and vibe!")
        for r in results:
            assert -1.0 <= r["score"] <= 1.0

    @pytest.mark.asyncio
    async def test_negative_review(self):
        results = await analyze_review(
            "The food was disgusting, the drink was horrible, and the atmosphere was awful."
        )
        for r in results:
            assert r["score"] <= 0
