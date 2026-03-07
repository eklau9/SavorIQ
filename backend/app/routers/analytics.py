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

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/overview", response_model=OverviewStats)
async def get_overview(
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db)
):
    """Aggregate statistics across all guests, orders, and reviews, scoped to restaurant."""
    # Totals
    guests_count = (await db.execute(select(func.count(Guest.id)).where(Guest.restaurant_id == x_restaurant_id))).scalar() or 0
    orders_count = (await db.execute(select(func.count(Order.id)).where(Order.restaurant_id == x_restaurant_id))).scalar() or 0
    reviews_count = (await db.execute(select(func.count(Review.id)).where(Review.restaurant_id == x_restaurant_id))).scalar() or 0
    avg_rating = (await db.execute(select(func.avg(Review.rating)).where(Review.restaurant_id == x_restaurant_id))).scalar() or 0.0

    # Sentiment by bucket
    bucket_rows = (
        await db.execute(
            select(
                SentimentScore.bucket,
                func.avg(SentimentScore.score).label("avg_score"),
                func.count(SentimentScore.id).label("review_count"),
            )
            .join(Review, SentimentScore.review_id == Review.id)
            .where(Review.restaurant_id == x_restaurant_id)
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

    return OverviewStats(
        total_guests=guests_count,
        total_orders=orders_count,
        total_reviews=reviews_count,
        avg_rating=round(float(avg_rating), 2),
        sentiment_by_bucket=sentiment_by_bucket,
    )


@router.get("/deep", response_model=DeepAnalytics)
async def get_deep_analytics(
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db)
):
    """Provide deep insights scoped to restaurant, using review mentions as performance proxy if orders are missing."""
    overview = await get_overview(x_restaurant_id, db)

    # 1. Fetch all reviews for this restaurant with sentiment
    reviews = (
        await db.execute(
            select(Review)
            .where(Review.restaurant_id == x_restaurant_id)
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

    # 3. Star-segmented mention analysis
    positive_reviews = [r for r in reviews if r.rating >= 4]
    negative_reviews = [r for r in reviews if r.rating <= 3]

    all_feedback_texts = [r.content for r in reviews]

    # Flatten all menu keywords for the unmatched scan
    all_menu_keywords = set()
    for item in menu_items:
        for kw in item["keywords"]:
            all_menu_keywords.add(kw)

    def scan_mentions(review_pool, items):
        """Count how many reviews in a pool mention each menu item (via keyword aliases)."""
        results = []
        for item in items:
            mention_count = 0
            for r in review_pool:
                content_lower = r.content.lower()
                if any(kw in content_lower for kw in item["keywords"]):
                    mention_count += 1

            if mention_count >= 2:
                results.append(
                    ItemPerformance(
                        item_name=item["name"],
                        category=item["category"],
                        order_count=mention_count,
                        avg_sentiment=None,
                        review_count=mention_count,
                    )
                )
        results.sort(key=lambda x: x.review_count, reverse=True)
        return results[:5]

    # Top Performers: most mentioned in 4-5★ reviews
    top_performers = scan_mentions(positive_reviews, menu_items)

    # At-Risk: most mentioned in 1-3★ reviews
    risks = scan_mentions(negative_reviews, menu_items)

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
    unmatched_counts: dict[str, int] = {}
    unmatched_ratings: dict[str, list[float]] = {}
    # Pre-compile word-boundary patterns so e.g. "rice" won't match "price"
    term_patterns = {term: re.compile(r'\b' + re.escape(term) + r'\b', re.IGNORECASE) for term in FOOD_DRINK_TERMS}
    for r in reviews:
        content_lower = r.content.lower()
        for term in FOOD_DRINK_TERMS:
            if term_patterns[term].search(content_lower) and term not in all_menu_keywords:
                # Make sure this term isn't a substring of a known keyword
                is_part_of_menu = any(term in kw for kw in all_menu_keywords)
                if not is_part_of_menu:
                    unmatched_counts[term] = unmatched_counts.get(term, 0) + 1
                    unmatched_ratings.setdefault(term, []).append(float(r.rating))

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

    return DeepAnalytics(
        overview=overview,
        top_performers=top_performers,
        risks=risks,
        unmatched_mentions=unmatched_mentions,
        briefing=briefing
    )


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
            .where(Review.restaurant_id == x_restaurant_id)
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
            .where(Review.restaurant_id == x_restaurant_id)
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
            .where(Review.restaurant_id == x_restaurant_id)
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
    """Operational KPIs: revenue, segments, data health, platform split, scoped to restaurant."""

    # 1. Revenue
    rev_row = (
        await db.execute(
            select(
                func.sum(Order.price * Order.quantity).label("total_revenue"),
                func.count(Order.id).label("total_orders"),
            )
            .where(Order.restaurant_id == x_restaurant_id)
        )
    ).first()
    
    total_revenue = float(rev_row.total_revenue or 0)
    total_orders = rev_row.total_orders or 0

    guests_count = (await db.execute(select(func.count(Guest.id)).where(Guest.restaurant_id == x_restaurant_id))).scalar() or 1
    
    # Calculate metrics, handling zero-order states gracefully
    avg_order_value = round(total_revenue / max(total_orders, 1), 2) if total_orders > 0 else 0.0
    orders_per_guest = round(total_orders / max(guests_count, 1), 1) if total_orders > 0 else 0.0

    # 2. Category breakdown
    cat_rows = (
        await db.execute(
            select(
                Order.category,
                func.sum(Order.price * Order.quantity).label("revenue"),
                func.count(Order.id).label("count"),
            )
            .where(Order.restaurant_id == x_restaurant_id)
            .group_by(Order.category)
        )
    ).all()

    category_breakdown = [
        CategoryRevenue(
            category=row.category,
            revenue=round(float(row.revenue), 2),
            order_count=row.count,
        )
        for row in cat_rows
    ]

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

    # 4. Data completeness — guests with BOTH orders AND reviews
    guests_with_orders = (
        await db.execute(
            select(func.count(func.distinct(Order.guest_id)))
            .where(Order.restaurant_id == x_restaurant_id)
        )
    ).scalar() or 0

    guests_with_reviews = (
        await db.execute(
            select(func.count(func.distinct(Review.guest_id)))
            .where(Review.restaurant_id == x_restaurant_id)
        )
    ).scalar() or 0

    # Guests that appear in BOTH tables within this restaurant
    guests_with_both = (
        await db.execute(
            select(func.count()).select_from(
                select(Order.guest_id)
                .where(Order.restaurant_id == x_restaurant_id)
                .intersect(
                    select(Review.guest_id)
                    .where(Review.restaurant_id == x_restaurant_id)
                )
                .subquery()
            )
        )
    ).scalar() or 0

    data_completeness = round(guests_with_both / max(guests_count, 1), 2)

    # 5. Platform split
    platform_rows = (
        await db.execute(
            select(Review.platform, func.count(Review.id).label("count"))
            .where(Review.restaurant_id == x_restaurant_id)
            .group_by(Review.platform)
        )
    ).all()

    platform_split = {row.platform: row.count for row in platform_rows}

    return OperationsAnalytics(
        total_revenue=round(total_revenue, 2),
        avg_order_value=avg_order_value,
        orders_per_guest=orders_per_guest,
        category_breakdown=category_breakdown,
        tier_distribution=tier_distribution,
        data_completeness=data_completeness,
        total_guests=guests_count,
        guests_with_both=guests_with_both,
        platform_split=platform_split,
    )
