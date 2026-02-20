"""Review endpoints — listing + bulk ingest with sentiment analysis."""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi import APIRouter, Depends, Query

from app.database import get_db
from app.models import Guest, Review, SentimentScore
from app.schemas import IngestionReport, ReviewPlatform, ReviewRead, ReviewWithGuest
from app.services.ingestion import ingest_reviews
from app.services.sentiment import analyze_and_store

router = APIRouter(prefix="/api", tags=["reviews"])


def _apply_common_filters(query, platform, search, days):
    """Apply shared filters to a review query."""
    if platform:
        query = query.where(Review.platform == platform)
    if search:
        query = query.where(Review.content.ilike(f"%{search}%"))
    if days is not None:
        cutoff = datetime.utcnow() - timedelta(days=days)
        query = query.where(Review.reviewed_at >= cutoff)
    return query


@router.get("/reviews/stats")
async def review_stats(
    platform: str | None = None,
    search: str | None = None,
    days: int | None = Query(None, ge=1),
    db: AsyncSession = Depends(get_db),
):
    """Return aggregate stats for reviews matching the current filters."""
    base = select(Review).options(selectinload(Review.sentiment_scores))
    base = _apply_common_filters(base, platform, search, days)
    result = await db.execute(base)
    reviews = result.scalars().all()

    total = len(reviews)
    avg_rating = round(sum(r.rating for r in reviews) / total, 1) if total else 0

    positive = 0
    negative = 0
    neutral = 0
    for r in reviews:
        if not r.sentiment_scores:
            neutral += 1
            continue
        avg_score = sum(s.score for s in r.sentiment_scores) / len(r.sentiment_scores)
        if avg_score >= 0.3:
            positive += 1
        elif avg_score <= -0.3:
            negative += 1
        else:
            neutral += 1

    return {
        "total": total,
        "avg_rating": avg_rating,
        "positive": positive,
        "negative": negative,
        "neutral": neutral,
    }


@router.get("/reviews", response_model=list[ReviewWithGuest])
async def list_all_reviews(
    platform: str | None = None,
    search: str | None = None,
    sentiment: str | None = None,
    days: int | None = Query(None, ge=1),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """List all reviews with search, sentiment, platform, and time filters."""
    query = (
        select(Review)
        .options(selectinload(Review.sentiment_scores), selectinload(Review.guest))
        .order_by(Review.reviewed_at.desc())
    )
    query = _apply_common_filters(query, platform, search, days)

    # Execute and filter by sentiment in Python (requires loaded scores)
    result = await db.execute(query)
    reviews = result.scalars().all()

    # Sentiment filter
    if sentiment in ("positive", "negative", "neutral"):
        filtered = []
        for r in reviews:
            if not r.sentiment_scores:
                avg_score = 0
            else:
                avg_score = sum(s.score for s in r.sentiment_scores) / len(r.sentiment_scores)
            if sentiment == "positive" and avg_score >= 0.3:
                filtered.append(r)
            elif sentiment == "negative" and avg_score <= -0.3:
                filtered.append(r)
            elif sentiment == "neutral" and -0.3 < avg_score < 0.3:
                filtered.append(r)
        reviews = filtered

    # Apply pagination after filtering
    reviews = reviews[skip : skip + limit]

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
    db: AsyncSession = Depends(get_db),
):
    """Get reviews for a specific guest, optionally filtered by platform."""
    query = (
        select(Review)
        .where(Review.guest_id == guest_id)
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
    report = await ingest_reviews(db, platform, reviews_data)

    # Run sentiment analysis on newly ingested reviews
    if report.ingested > 0:
        # Fetch the most recently ingested reviews
        result = await db.execute(
            select(Review)
            .order_by(Review.ingested_at.desc())
            .limit(report.ingested)
        )
        new_reviews = result.scalars().all()
        for review in new_reviews:
            await analyze_and_store(db, review.id, review.content)

    return report
