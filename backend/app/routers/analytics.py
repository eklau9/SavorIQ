"""Analytics endpoints — aggregate stats across all guests."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import APIRouter, Depends

from app.database import get_db
from app.models import Guest, Order, Review, SentimentScore
from app.schemas import BucketSentiment, OverviewStats

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
