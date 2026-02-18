"""Review endpoints — listing + bulk ingest with sentiment analysis."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi import APIRouter, Depends, Query

from app.database import get_db
from app.models import Review
from app.schemas import IngestionReport, ReviewPlatform, ReviewRead
from app.services.ingestion import ingest_reviews
from app.services.sentiment import analyze_and_store

router = APIRouter(prefix="/api", tags=["reviews"])


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
