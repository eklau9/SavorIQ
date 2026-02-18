"""Analytics endpoints — aggregate stats across all guests."""

from __future__ import annotations

import sqlalchemy
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Guest, Order, Review, SentimentScore
from app.schemas import BucketSentiment, DeepAnalytics, ItemPerformance, OverviewStats
from app.services.insights import generate_manager_briefing

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/overview", response_model=OverviewStats)
async def get_overview(db: AsyncSession = Depends(get_db)):
    """Aggregate statistics across all guests, orders, and reviews."""
    # Totals
    guests_count = (await db.execute(select(func.count(Guest.id)))).scalar() or 0
    orders_count = (await db.execute(select(func.count(Order.id)))).scalar() or 0
    reviews_count = (await db.execute(select(func.count(Review.id)))).scalar() or 0
    avg_rating = (await db.execute(select(func.avg(Review.rating)))).scalar() or 0.0

    # Sentiment by bucket
    bucket_rows = (
        await db.execute(
            select(
                SentimentScore.bucket,
                func.avg(SentimentScore.score).label("avg_score"),
                func.count(SentimentScore.id).label("review_count"),
            ).group_by(SentimentScore.bucket)
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
async def get_deep_analytics(db: AsyncSession = Depends(get_db)):
    """Provide deep insights: item performance + AI strategy briefing."""
    overview = await get_overview(db)

    # 1. Calculate item popularity
    order_rows = (
        await db.execute(
            select(
                Order.item_name,
                Order.category,
                func.count(Order.id).label("count")
            ).group_by(Order.item_name, Order.category)
        )
    ).all()

    # 2. Get all reviews with sentiment
    reviews = (
        await db.execute(
            select(Review).options(
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
