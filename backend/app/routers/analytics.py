"""Analytics endpoints — aggregate stats across all guests."""

from __future__ import annotations

import sqlalchemy
from fastapi import APIRouter, Depends, Header
from typing import Optional
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Guest, Order, Review, SentimentScore
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
    """Provide deep insights scoped to restaurant."""
    overview = await get_overview(x_restaurant_id, db)

    # 1. Calculate item popularity
    order_rows = (
        await db.execute(
            select(
                Order.item_name,
                Order.category,
                func.count(Order.id).label("count")
            )
            .where(Order.restaurant_id == x_restaurant_id)
            .group_by(Order.item_name, Order.category)
        )
    ).all()

    # 2. Get all reviews for this restaurant with sentiment
    reviews = (
        await db.execute(
            select(Review)
            .where(Review.restaurant_id == x_restaurant_id)
            .options(
                sqlalchemy.orm.selectinload(Review.sentiment_scores)
            )
        )
    ).scalars().all()

    item_performances = []
    all_feedback_texts = [r.content for r in reviews]

    for row in order_rows:
        # Correlate mentions in reviews
        mentions_scores = []
        item_lower = row.item_name.lower()
        
        for r in reviews:
            if item_lower in r.content.lower():
                # Associate with the correct bucket score
                bucket_type = "food" if row.category == "food" else "drink"
                for s in r.sentiment_scores:
                    if s.bucket == bucket_type:
                        mentions_scores.append(s.score)

        avg_sentiment = (
            round(sum(mentions_scores) / len(mentions_scores), 2)
            if mentions_scores else None
        )

        item_performances.append(
            ItemPerformance(
                item_name=row.item_name,
                category=row.category,
                order_count=row.count,
                avg_sentiment=avg_sentiment,
                review_count=len(mentions_scores)
            )
        )

    # Sort and split
    item_performances.sort(key=lambda x: x.order_count, reverse=True)
    top_performers = [i for i in item_performances if (i.avg_sentiment or 0) >= 0][:5]
    risks = [i for i in item_performances if (i.avg_sentiment or 0) < 0][:5]

    # 3. Generate AI briefing
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
    avg_order_value = round(total_revenue / max(total_orders, 1), 2)
    orders_per_guest = round(total_orders / max(guests_count, 1), 1)

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
