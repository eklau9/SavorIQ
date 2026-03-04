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
    """Return aggregate stats for reviews matching the current filters, scoped to restaurant."""
    base = select(Review).options(selectinload(Review.sentiment_scores))
    base = _apply_common_filters(base, x_restaurant_id, platform, search, days, date, bucket)
    result = await db.execute(base)
    reviews = result.scalars().all()

    total = len(reviews)
    avg_rating = round(sum(r.rating for r in reviews) / total, 1) if total else 0

    positive = 0
    negative = 0
    neutral = 0
    bucket_scores = {}  # {bucket: [scores]}
    rating_distribution = {5: 0, 4: 0, 3: 0, 2: 0, 1: 0}

    for r in reviews:
        if not r.sentiment_scores:
            neutral += 1
            continue
        
        # Track for overall sentiment
        review_avg = sum(s.score for s in r.sentiment_scores) / len(r.sentiment_scores)
        if review_avg >= 0.3:
            positive += 1
        elif review_avg <= -0.3:
            negative += 1
        else:
            neutral += 1
        
        # Track rating distribution
        r_int = int(round(r.rating))
        if 1 <= r_int <= 5:
            rating_distribution[r_int] += 1
        
        # Track for bucket-specific diagnostics
        for s in r.sentiment_scores:
            if s.bucket not in bucket_scores:
                bucket_scores[s.bucket] = []
            bucket_scores[s.bucket].append(s.score)

    # Calculate bucket averages
    bucket_averages = {
        b: sum(scores) / len(scores) 
        for b, scores in bucket_scores.items()
    }

    # Identify top strength and friction
    sorted_buckets = sorted(bucket_averages.items(), key=lambda x: x[1], reverse=True)
    top_strength = sorted_buckets[0][0] if sorted_buckets else None
    top_friction = sorted_buckets[-1][0] if len(sorted_buckets) > 1 else None

    return {
        "total": total,
        "avg_rating": avg_rating,
        "positive": positive,
        "negative": negative,
        "neutral": neutral,
        "top_strength": top_strength,
        "top_friction": top_friction,
        "bucket_averages": {b: round(s, 2) for b, s in bucket_averages.items()},
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
    limit: int = Query(50, ge=1, le=200),
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db),
):
    """List all reviews with filters, scoped to restaurant."""
    query = (
        select(Review)
        .options(selectinload(Review.sentiment_scores), selectinload(Review.guest))
        .order_by(Review.reviewed_at.desc())
    )
    query = _apply_common_filters(query, x_restaurant_id, platform, search, days, date, bucket)

    # Execute and filter by sentiment/bucket in Python (requires loaded scores)
    result = await db.execute(query)
    all_matching = result.scalars().all()

    filtered = []
    for r in all_matching:
        # Sentiment filter
        avg_score = 0
        if r.sentiment_scores:
            avg_score = sum(s.score for s in r.sentiment_scores) / len(r.sentiment_scores)
        
        match_sentiment = True
        if sentiment == "positive" and avg_score < 0.3:
            match_sentiment = False
        elif sentiment == "negative" and avg_score > -0.3:
            match_sentiment = False
        elif sentiment == "neutral" and (avg_score >= 0.3 or avg_score <= -0.3):
            match_sentiment = False
        
        if match_sentiment:
            filtered.append(r)

    # Apply pagination after filtering
    reviews = filtered[skip : skip + limit]

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
    limit: int = Query(20, ge=1, le=100),
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db),
):
    """Get reviews for a specific guest, scoped to restaurant."""
    query = (
        select(Review)
        .where(Review.guest_id == guest_id, Review.restaurant_id == x_restaurant_id)
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

    return report
