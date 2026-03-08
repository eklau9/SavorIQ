"""Review endpoints — listing + bulk ingest with sentiment analysis."""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi import APIRouter, Depends, Query, Header
from typing import Optional

from app.database import get_db
from app.models import Guest, Review, SentimentScore
from app.schemas import IngestionReport, ReviewPlatform, ReviewRead, ReviewWithGuest
from app.services.ingestion import ingest_reviews
from app.services.sentiment import analyze_and_store_batch

router = APIRouter(prefix="/api", tags=["reviews"])


def _apply_common_filters(query, restaurant_id, platform, search, days, date_str=None, bucket=None):
    """Apply shared filters to a review query, including tenant isolation."""
    query = query.where(Review.restaurant_id == restaurant_id)
    query = query.where(Review.is_deleted_on_platform == False)
    if platform:
        query = query.where(Review.platform == platform)
    if search:
        query = query.where(Review.content.ilike(f"%{search}%"))
    if days is not None:
        cutoff = datetime.utcnow() - timedelta(days=days)
        query = query.where(Review.reviewed_at >= cutoff)
    if date_str:
        try:
            target_date = datetime.strptime(date_str, "%Y-%m-%d")
            next_day = target_date + timedelta(days=1)
            query = query.where(Review.reviewed_at >= target_date)
            query = query.where(Review.reviewed_at < next_day)
        except ValueError:
            pass
    if bucket:
        # Join sentiment scores only if filtering by bucket
        query = query.join(SentimentScore).where(SentimentScore.bucket == bucket)
    return query


@router.get("/reviews/stats")
async def review_stats(
    platform: str | None = None,
    search: str | None = None,
    days: int | None = Query(None, ge=1),
    date: str | None = None,
    bucket: str | None = None,
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db),
):
    """Return aggregate stats for reviews matching the current filters using fast SQL aggregation."""
    # Base query for counting and averaging ratings
    stmt = select(
        func.count(Review.id).label("total"),
        func.avg(Review.rating).label("avg_rating")
    )
    stmt = _apply_common_filters(stmt, x_restaurant_id, platform, search, days, date, bucket)
    
    result = await db.execute(stmt)
    total, avg_rating = result.fetchone() or (0, 0)

    # Subquery for overall sentiment breakdown (positive/negative/neutral)
    # This averages all scores for a review first
    sentiment_subq = (
        select(
            Review.id,
            func.avg(SentimentScore.score).label("avg_score")
        )
        .join(SentimentScore, Review.id == SentimentScore.review_id)
        .where(Review.restaurant_id == x_restaurant_id)
        .group_by(Review.id)
        .subquery()
    )

    sentiment_stmt = (
        select(
            func.count(Review.id).filter(sentiment_subq.c.avg_score >= 0.3).label("positive"),
            func.count(Review.id).filter(sentiment_subq.c.avg_score <= -0.3).label("negative"),
            func.count(Review.id).filter((sentiment_subq.c.avg_score < 0.3) & (sentiment_subq.c.avg_score > -0.3)).label("neutral")
        )
        .outerjoin(sentiment_subq, Review.id == sentiment_subq.c.id)
    )
    sentiment_stmt = _apply_common_filters(sentiment_stmt, x_restaurant_id, platform, search, days, date, bucket)
    
    sent_res = await db.execute(sentiment_stmt)
    positive, negative, neutral = sent_res.fetchone() or (0, 0, 0)

    # Bucket averages for diagnostics
    bucket_avg_stmt = (
        select(
            SentimentScore.bucket,
            func.avg(SentimentScore.score).label("avg_score")
        )
        .join(Review, Review.id == SentimentScore.review_id)
        .where(Review.restaurant_id == x_restaurant_id)
    )
    if platform or search or days or date:
        # Re-apply filters to bucket stats if needed
        bucket_avg_stmt = _apply_common_filters(bucket_avg_stmt, x_restaurant_id, platform, search, days, date, bucket)
        
    bucket_avg_stmt = bucket_avg_stmt.group_by(SentimentScore.bucket)
    
    bucket_res = await db.execute(bucket_avg_stmt)
    bucket_averages = {row[0]: round(float(row[1]), 2) for row in bucket_res.all()}

    # Identify top strength and friction
    sorted_buckets = sorted(bucket_averages.items(), key=lambda x: x[1], reverse=True)
    top_strength = sorted_buckets[0][0] if sorted_buckets else None
    top_friction = sorted_buckets[-1][0] if len(sorted_buckets) > 1 else None

    # Rating distribution
    dist_stmt = (
        select(
            func.round(Review.rating).label("r_int"),
            func.count(Review.id)
        )
    )
    dist_stmt = _apply_common_filters(dist_stmt, x_restaurant_id, platform, search, days, date, bucket)
    dist_stmt = dist_stmt.group_by(func.round(Review.rating))
    
    dist_res = await db.execute(dist_stmt)
    rating_distribution = {5: 0, 4: 0, 3: 0, 2: 0, 1: 0}
    for r_int, count in dist_res.all():
        if 1 <= r_int <= 5:
            rating_distribution[int(r_int)] = count

    return {
        "total": total,
        "avg_rating": round(float(avg_rating or 0), 1),
        "positive": positive,
        "negative": negative,
        "neutral": neutral,
        "top_strength": top_strength,
        "top_friction": top_friction,
        "bucket_averages": bucket_averages,
        "rating_distribution": rating_distribution
    }


@router.get("/reviews", response_model=list[ReviewWithGuest])
async def list_all_reviews(
    platform: str | None = None,
    search: str | None = None,
    sentiment: str | None = None,
    bucket: str | None = None,
    days: int | None = Query(None, ge=1),
    date: str | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=5000),
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db),
):
    """List all reviews with filters, entirely in SQL."""
    # Subquery for avg score if we need sentiment filtering
    sentiment_subq = (
        select(
            SentimentScore.review_id,
            func.avg(SentimentScore.score).label("avg_score")
        )
        .group_by(SentimentScore.review_id)
        .subquery()
    )

    query = (
        select(Review)
        .options(selectinload(Review.sentiment_scores), selectinload(Review.guest))
        .outerjoin(sentiment_subq, Review.id == sentiment_subq.c.review_id)
        .order_by(Review.reviewed_at.desc())
    )
    query = _apply_common_filters(query, x_restaurant_id, platform, search, days, date, bucket)

    if sentiment:
        if sentiment == "positive":
            query = query.where(sentiment_subq.c.avg_score >= 0.3)
        elif sentiment == "negative":
            query = query.where(sentiment_subq.c.avg_score <= -0.3)
        elif sentiment == "neutral":
            query = query.where((sentiment_subq.c.avg_score < 0.3) & (sentiment_subq.c.avg_score > -0.3))

    # Pagination in SQL
    query = query.offset(skip).limit(limit)

    result = await db.execute(query)
    reviews = result.scalars().all()

    out = []
    for r in reviews:
        data = ReviewWithGuest.model_validate(r)
        data.guest_name = r.guest.name if r.guest else "Unknown"
        out.append(data)
    return out


@router.get("/guests/{guest_id}/reviews", response_model=list[ReviewRead])
async def list_guest_reviews(
    guest_id: str,
    platform: str | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=5000),
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db),
):
    """Get reviews for a specific guest, scoped to restaurant."""
    query = (
        select(Review)
        .where(Review.guest_id == guest_id, Review.restaurant_id == x_restaurant_id)
        .where(Review.is_deleted_on_platform == False)
        .options(selectinload(Review.sentiment_scores))
        .order_by(Review.reviewed_at.desc())
        .offset(skip)
        .limit(limit)
    )
    if platform:
        query = query.where(Review.platform == platform)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/reviews/ingest", response_model=IngestionReport)
async def ingest_reviews_endpoint(
    payload: dict,
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db),
):
    """
    Bulk ingest reviews from Yelp or Google Maps JSON.
    Expects: {"platform": "yelp"|"google", "reviews": [...]}

    After ingestion, automatically runs sentiment analysis on each new review.
    """
    platform_str = payload.get("platform", "")
    try:
        platform = ReviewPlatform(platform_str)
    except ValueError:
        return IngestionReport(
            platform=platform_str,
            total_received=0,
            ingested=0,
            duplicates_skipped=0,
            errors=1,
            error_details=[f"Invalid platform: {platform_str}. Use 'yelp' or 'google'."],
        )

    reviews_data = payload.get("reviews", [])
    report = await ingest_reviews(db, x_restaurant_id, platform, reviews_data)

    # Run sentiment analysis on newly ingested reviews
    if report.ingested > 0:
        # Fetch the most recently ingested reviews
        result = await db.execute(
            select(Review)
            .order_by(Review.ingested_at.desc())
            .limit(report.ingested)
        )
        new_reviews = result.scalars().all()
        
        # Prepare batches of 25 for Gemini
        batch_size = 25
        reviews_to_analyze = [
            {"id": r.id, "text": r.content} 
            for r in new_reviews
        ]
        
        for i in range(0, len(reviews_to_analyze), batch_size):
            batch = reviews_to_analyze[i : i + batch_size]
            await analyze_and_store_batch(db, batch)

    await db.commit()
    return report
