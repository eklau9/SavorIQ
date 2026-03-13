"""Analytics endpoints — aggregate stats across all guests."""

from __future__ import annotations
import re

import sqlalchemy
from fastapi import APIRouter, Depends, Header
from typing import Optional
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Guest, MenuItem, Order, Review, SentimentScore
from app.schemas import (
    BucketSentiment,
    BucketHighlight,
    CategoryRevenue,
    DeepAnalytics,
    GuestTierCount,
    ItemPerformance,
    OperationsAnalytics,
    OverviewStats,
    SentimentAnalytics,
    SentimentTrendPoint,
    UnmatchedMention,
)
from app.services.insights import generate_manager_briefing
from app.services.cache import api_cache

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/overview", response_model=OverviewStats)
async def get_overview(
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db)
):
    """Aggregate statistics across all guests, orders, and reviews, scoped to restaurant."""
    cached = api_cache.get(x_restaurant_id, "overview")
    if cached is not None:
        return cached

    # 1. Active Guests (Guests with at least one non-deleted review)
    active_guests_stmt = (
        select(func.count(func.distinct(Review.guest_id)))
        .where(Review.restaurant_id == x_restaurant_id, Review.is_deleted_on_platform == False)
    )
    guests_count = (await db.execute(active_guests_stmt)).scalar() or 0
    reviews_count = (await db.execute(select(func.count(Review.id)).where(Review.restaurant_id == x_restaurant_id, Review.is_deleted_on_platform == False))).scalar() or 0
    avg_rating = (await db.execute(select(func.avg(Review.rating)).where(Review.restaurant_id == x_restaurant_id, Review.is_deleted_on_platform == False))).scalar() or 0.0

    print(f"DEBUG OVERVIEW: restaurant={x_restaurant_id}, guests={guests_count}, reviews={reviews_count}")

    # Sentiment by bucket
    bucket_rows = (
        await db.execute(
            select(
                SentimentScore.bucket,
                func.avg(SentimentScore.score).label("avg_score"),
                func.count(SentimentScore.id).label("review_count"),
            )
            .join(Review, SentimentScore.review_id == Review.id)
            .where(Review.restaurant_id == x_restaurant_id, Review.is_deleted_on_platform == False)
            .group_by(SentimentScore.bucket)
        )
    ).all()

    sentiment_by_bucket = [
        BucketSentiment(
            bucket=row.bucket,
            avg_score=round(float(row.avg_score), 2),
            review_count=row.review_count,
        )
        for row in bucket_rows
    ]

    result = OverviewStats(
        total_guests=guests_count,
        total_orders=0, # Deprecated
        total_reviews=reviews_count,
        avg_rating=round(float(avg_rating), 2),
        sentiment_by_bucket=sentiment_by_bucket,
    )
    api_cache.set(x_restaurant_id, "overview", result)
    return result


@router.get("/deep", response_model=DeepAnalytics)
async def get_deep_analytics(
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db)
):
    """Provide deep insights scoped to restaurant, using review mentions as performance proxy if orders are missing."""
    cached = api_cache.get(x_restaurant_id, "deep_analytics")
    if cached is not None:
        return cached

    overview = await get_overview(x_restaurant_id, db)

    # 1. Fetch all reviews for this restaurant with sentiment
    reviews = (
        await db.execute(
            select(Review)
            .where(Review.restaurant_id == x_restaurant_id, Review.is_deleted_on_platform == False)
            .options(
                sqlalchemy.orm.selectinload(Review.sentiment_scores)
            )
        )
    ).scalars().all()

    # 2. Load active menu items from DB (replaces hardcoded list)
    menu_items_rows = (
        await db.execute(
            select(MenuItem)
            .where(MenuItem.restaurant_id == x_restaurant_id, MenuItem.is_active == True)
        )
    ).scalars().all()

    # Convert DB rows to the dict format used by scan_mentions
    menu_items = [
        {
            "name": mi.name,
            "category": mi.category,
            "keywords": [kw.strip().lower() for kw in mi.keywords.split(",") if kw.strip()],
        }
        for mi in menu_items_rows
    ]

    # Pre-compute lowercased content for all reviews to avoid redundant .lower() calls
    review_data = [
        {"original": r, "content_lower": r.content.lower()} 
        for r in reviews
    ]

    def scan_mentions(items, pool_filter=None):
        """Count how many reviews mention each menu item (via keyword aliases)."""
        results = []
        # Filter the pre-computed review pool once
        pool = [rd for rd in review_data if pool_filter(rd["original"])] if pool_filter else review_data
        
        for item in items:
            mention_count = 0
            keywords = item["keywords"]
            for rd in pool:
                if any(kw in rd["content_lower"] for kw in keywords):
                    mention_count += 1

            if mention_count >= 1: # Lower threshold to 1 for better visibility on smaller datasets
                results.append(
                    ItemPerformance(
                        item_name=item["name"],
                        category=item["category"],
                        avg_sentiment=None,
                        review_count=mention_count,
                    )
                )
        results.sort(key=lambda x: x.review_count, reverse=True)
        return results[:5]

    # Top Performers: most mentioned in 4-5★ reviews
    top_performers = scan_mentions(menu_items, lambda r: r.rating >= 4)

    # At-Risk: most mentioned in 1-3★ reviews
    risks = scan_mentions(menu_items, lambda r: r.rating <= 3)

    # 4. Extract unmatched mentions — food/drink terms NOT on the menu
    # Common food/drink terms to look for in reviews
    FOOD_DRINK_TERMS = [
        "coffee", "espresso", "latte", "cappuccino", "americano", "mocha",
        "tea", "fruit tea", "matcha", "boba", "milk tea", "smoothie", "juice", "soda", "water",
        "cake", "cookie", "croissant", "sandwich", "salad", "pasta",
        "burger", "pizza", "sushi", "ramen", "noodles", "rice",
        "chicken", "steak", "fish", "shrimp", "tofu", "dumpling",
        "ice cream", "gelato", "yogurt", "waffle", "pancake",
        "taro", "ube", "mango", "strawberry", "peach", "lychee",
        "tapioca", "pudding", "cream puff", "macaron",
    ]
    
    # Flatten all menu keywords for the unmatched scan
    all_menu_keywords = set()
    for item in menu_items:
        for kw in item["keywords"]:
            all_menu_keywords.add(kw)

    unmatched_counts: dict[str, int] = {}
    unmatched_ratings: dict[str, list[float]] = {}
    
    # Pre-compile word-boundary patterns
    # We only scan terms NOT already on the menu
    active_terms = [t for t in FOOD_DRINK_TERMS if t not in all_menu_keywords]
    term_patterns = {term: re.compile(r'\b' + re.escape(term) + r'\b', re.IGNORECASE) for term in active_terms}
    
    for rd in review_data:
        content_lower = rd["content_lower"]
        r = rd["original"]
        for term, pattern in term_patterns.items():
            if pattern.search(content_lower):
                unmatched_counts[term] = unmatched_counts.get(term, 0) + 1
                unmatched_ratings.setdefault(term, []).append(float(r.rating))

    all_feedback_texts = [rd["content_lower"] for rd in review_data]

    # Only show terms mentioned 2+ times, sorted by count
    unmatched_mentions = [
        UnmatchedMention(
            term=term.title(),
            mention_count=count,
            avg_rating=round(sum(unmatched_ratings[term]) / len(unmatched_ratings[term]), 1),
        )
        for term, count in sorted(unmatched_counts.items(), key=lambda x: x[1], reverse=True)
        if count >= 2
    ][:5]

    # 5. Generate AI briefing
    briefing = await generate_manager_briefing(
        overview.sentiment_by_bucket,
        top_performers,
        risks,
        all_feedback_texts
    )

    result = DeepAnalytics(
        overview=overview,
        top_performers=top_performers,
        risks=risks,
        unmatched_mentions=unmatched_mentions,
        briefing=briefing
    )
    api_cache.set(x_restaurant_id, "deep_analytics", result)
    return result


@router.get("/sentiment", response_model=SentimentAnalytics)
async def get_sentiment_analytics(
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db)
):
    """Sentiment breakdown: per-bucket averages, monthly trend, highlights, scoped to restaurant."""

    # 1. Per-bucket averages
    bucket_rows = (
        await db.execute(
            select(
                SentimentScore.bucket,
                func.avg(SentimentScore.score).label("avg_score"),
                func.count(SentimentScore.id).label("review_count"),
            )
            .join(Review, SentimentScore.review_id == Review.id)
            .where(Review.restaurant_id == x_restaurant_id, Review.is_deleted_on_platform == False)
            .group_by(SentimentScore.bucket)
        )
    ).all()

    buckets = [
        BucketSentiment(
            bucket=row.bucket,
            avg_score=round(float(row.avg_score), 2),
            review_count=row.review_count,
        )
        for row in bucket_rows
    ]

    # 2. Monthly trend — group by month + bucket
    trend_query = (
        await db.execute(
            select(
                func.strftime("%Y-%m", SentimentScore.analyzed_at).label("month"),
                SentimentScore.bucket,
                func.avg(SentimentScore.score).label("avg_score"),
            )
            .join(Review, SentimentScore.review_id == Review.id)
            .where(Review.restaurant_id == x_restaurant_id, Review.is_deleted_on_platform == False)
            .group_by("month", SentimentScore.bucket)
            .order_by("month")
        )
    ).all()

    # Pivot into trend points
    months_map: dict[str, dict] = {}
    for row in trend_query:
        month = row.month
        if month not in months_map:
            months_map[month] = {"month": month}
        months_map[month][f"{row.bucket}_avg"] = round(float(row.avg_score), 2)

    trend = [SentimentTrendPoint(**data) for data in months_map.values()]

    # 3. Highlights — best/worst review per bucket
    all_scores = (
        await db.execute(
            select(SentimentScore, Review.content)
            .join(Review, SentimentScore.review_id == Review.id)
            .where(Review.restaurant_id == x_restaurant_id, Review.is_deleted_on_platform == False)
        )
    ).all()

    bucket_highlights: dict[str, dict] = {}
    for score_obj, content in all_scores:
        b = score_obj.bucket
        if b not in bucket_highlights:
            bucket_highlights[b] = {
                "bucket": b,
                "best_snippet": None, "best_score": None,
                "worst_snippet": None, "worst_score": None,
            }
        snippet = content[:120] + ("…" if len(content) > 120 else "")
        if bucket_highlights[b]["best_score"] is None or score_obj.score > bucket_highlights[b]["best_score"]:
            bucket_highlights[b]["best_score"] = round(score_obj.score, 2)
            bucket_highlights[b]["best_snippet"] = snippet
        if bucket_highlights[b]["worst_score"] is None or score_obj.score < bucket_highlights[b]["worst_score"]:
            bucket_highlights[b]["worst_score"] = round(score_obj.score, 2)
            bucket_highlights[b]["worst_snippet"] = snippet

    highlights = [BucketHighlight(**data) for data in bucket_highlights.values()]

    return SentimentAnalytics(buckets=buckets, trend=trend, highlights=highlights)


@router.get("/operations", response_model=OperationsAnalytics)
async def get_operations_analytics(
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db)
):
    """Review KPIs: velocity, momentum, platform split, scoped to restaurant."""
    cached = api_cache.get(x_restaurant_id, "operations")
    if cached is not None:
        return cached

    from datetime import datetime, timedelta

    now = datetime.utcnow()
    last_30_days = now - timedelta(days=30)
    prev_30_days = now - timedelta(days=60)

    # 1. Review Velocity (Reviews per week in last 30 days)
    recent_reviews_count = (await db.execute(
        select(func.count(Review.id))
        .where(Review.restaurant_id == x_restaurant_id, Review.reviewed_at >= last_30_days, Review.is_deleted_on_platform == False)
    )).scalar() or 0
    review_velocity = round(recent_reviews_count / 4.2, 1) # ~4.2 weeks in 30 days

    # 2. Sentiment Momentum
    curr_avg = (await db.execute(
        select(func.avg(Review.rating))
        .where(Review.restaurant_id == x_restaurant_id, Review.reviewed_at >= last_30_days, Review.is_deleted_on_platform == False)
    )).scalar() or 0.0
    
    prev_avg = (await db.execute(
        select(func.avg(Review.rating))
        .where(Review.restaurant_id == x_restaurant_id, Review.reviewed_at >= prev_30_days, Review.reviewed_at < last_30_days, Review.is_deleted_on_platform == False)
    )).scalar() or 0.0
    
    sentiment_momentum = round(float(curr_avg) - float(prev_avg), 2) if prev_avg else 0.0
    
    active_guests_stmt = (
        select(func.count(func.distinct(Review.guest_id)))
        .where(Review.restaurant_id == x_restaurant_id, Review.is_deleted_on_platform == False)
    )
    guests_count = (await db.execute(active_guests_stmt)).scalar() or 0
    
    # 3. Tier distribution
    tier_rows = (
        await db.execute(
            select(Guest.tier, func.count(Guest.id).label("count"))
            .where(Guest.restaurant_id == x_restaurant_id)
            .group_by(Guest.tier)
        )
    ).all()

    tier_distribution = [
        GuestTierCount(tier=row.tier, count=row.count)
        for row in tier_rows
    ]

    # 4. Platform split
    platform_rows = (
        await db.execute(
            select(Review.platform, func.count(Review.id).label("count"))
            .where(Review.restaurant_id == x_restaurant_id, Review.is_deleted_on_platform == False)
            .group_by(Review.platform)
        )
    ).all()

    platform_split = {row.platform: row.count for row in platform_rows}

    result = OperationsAnalytics(
        review_velocity=review_velocity,
        sentiment_momentum=sentiment_momentum,
        tier_distribution=tier_distribution,
        total_guests=guests_count,
        platform_split=platform_split,
    )
    api_cache.set(x_restaurant_id, "operations", result)
    return result
