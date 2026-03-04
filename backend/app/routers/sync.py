"""Sync endpoints — search for businesses and sync reviews from Yelp/Google."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import APIRouter, Depends, HTTPException, Query

from app.config import settings
from app.database import get_db
from app.models import Review, SyncLog
from app.schemas import ReviewPlatform
from app.services.apify_sync import apify_google_reviews, apify_yelp_reviews
from app.services.ingestion import ingest_reviews
from app.services.sentiment import analyze_and_store
from app.services.sync import (
    google_search,
    yelp_search,
)

router = APIRouter(prefix="/api/sync", tags=["sync"])
logger = logging.getLogger(__name__)

# Daily sync cooldown (hours)
SYNC_COOLDOWN_HOURS = 24


@router.get("/search")
async def search_business(
    name: str = Query(..., description="Business name to search for"),
    location: str | None = Query(None, description="City or address"),
    lat: float | None = Query(None, description="Latitude"),
    lng: float | None = Query(None, description="Longitude"),
):
    """
    Search for a business on both Yelp and Google Places.
    Supports location string or coordinates.
    """
    results = {"yelp": [], "google": []}

    # Yelp search
    if settings.YELP_API_KEY:
        try:
            results["yelp"] = await yelp_search(name, location, lat, lng)
        except Exception as e:
            results["yelp_error"] = str(e)

    # Google search
    if settings.GOOGLE_PLACES_API_KEY:
        try:
            results["google"] = await google_search(name, location, lat, lng)
        except Exception as e:
            results["google_error"] = str(e)

    return results



@router.post("/apify-reviews")
async def sync_apify_reviews(
    platform: str = Query(..., description="Platform: 'yelp' or 'google'"),
    business_url: str = Query(..., description="Full Google Maps or Yelp URL"),
    business_name: str = Query("Unknown", description="Business display name"),
    max_reviews: int = Query(100000, description="Max reviews to fetch (default 100,000)"),
    force: bool = Query(False, description="Force sync even if synced today"),
    db: AsyncSession = Depends(get_db),
):
    """
    Sync reviews via Apify actors (Google Maps Reviews Scraper / Yelp Scraper).
    Fetches more reviews than direct APIs and works with paywalled Yelp.
    """
    # ── Daily sync guard ──
    # For sync logs, we use the business URL as ID for Apify syncs
    business_id = business_url
    if not force:
        existing = await db.execute(
            select(SyncLog).where(
                SyncLog.platform == platform,
                SyncLog.business_id == business_id,
            )
        )
        log = existing.scalar_one_or_none()
        if log:
            cutoff = datetime.utcnow() - timedelta(hours=SYNC_COOLDOWN_HOURS)
            if log.last_synced_at > cutoff:
                diff = datetime.utcnow() - log.last_synced_at
                total_seconds = diff.total_seconds()
                
                if total_seconds < 3600:
                    ago_str = f"~{int(total_seconds / 60)}m"
                else:
                    ago_str = f"~{int(total_seconds / 3600)}h"
                
                remaining_seconds = max(0, (SYNC_COOLDOWN_HOURS * 3600) - total_seconds)
                if remaining_seconds < 3600:
                    remaining_str = f"~{int(remaining_seconds / 60)}m"
                else:
                    remaining_str = f"~{int(remaining_seconds / 3600)}h"

                return {
                    "status": "skipped",
                    "message": f"Already synced {ago_str} ago. Next sync available in {remaining_str}.",
                    "last_synced": log.last_synced_at.isoformat(),
                    "reviews_fetched": log.reviews_fetched,
                    "new_reviews": log.new_reviews,
                }

    # ── Fetch reviews via Apify ──
    logger.info(f"Syncing Apify reviews for {platform} - URL: {business_url}")
    try:
        if platform == "google":
            if not settings.APIFY_API_TOKEN:
                raise HTTPException(status_code=400, detail="APIFY_API_TOKEN not configured")
            raw_reviews = await apify_google_reviews(business_url, max_reviews)
            review_platform = ReviewPlatform.google
        elif platform == "yelp":
            if not settings.APIFY_API_TOKEN:
                raise HTTPException(status_code=400, detail="APIFY_API_TOKEN not configured")
            raw_reviews = await apify_yelp_reviews(business_url, max_reviews)
            review_platform = ReviewPlatform.yelp
        else:
            raise HTTPException(status_code=400, detail="Platform must be 'yelp' or 'google'")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Apify {platform} error: {str(e)}")

    # ── Ingest into SavorIQ ──
    report = await ingest_reviews(db, review_platform, raw_reviews)

    # ── Run sentiment analysis on new reviews ──
    if report.ingested > 0:
        result = await db.execute(
            select(Review)
            .order_by(Review.ingested_at.desc())
            .limit(report.ingested)
        )
        new_reviews = result.scalars().all()
        for review in new_reviews:
            await analyze_and_store(db, review.id, review.content)

    # ── Update sync log ──
    existing = await db.execute(
        select(SyncLog).where(
            SyncLog.platform == platform,
            SyncLog.business_id == business_id,
        )
    )
    log = existing.scalar_one_or_none()
    if log:
        log.last_synced_at = datetime.utcnow()
        log.reviews_fetched = len(raw_reviews)
        log.new_reviews = report.ingested
        log.business_name = business_name
    else:
        log = SyncLog(
            platform=platform,
            business_id=business_id,
            business_name=business_name,
            last_synced_at=datetime.utcnow(),
            reviews_fetched=len(raw_reviews),
            new_reviews=report.ingested,
        )
        db.add(log)

    return {
        "status": "synced",
        "source": "apify",
        "platform": platform,
        "business_name": business_name,
        "total_fetched": len(raw_reviews),
        "new_ingested": report.ingested,
        "duplicates_skipped": report.duplicates_skipped,
        "errors": report.errors,
    }


@router.get("/status")
async def sync_status(db: AsyncSession = Depends(get_db)):
    """Get the sync status for all tracked businesses."""
    result = await db.execute(select(SyncLog).order_by(SyncLog.last_synced_at.desc()))
    logs = result.scalars().all()

    return [
        {
            "platform": log.platform,
            "business_id": log.business_id,
            "business_name": log.business_name,
            "last_synced_at": log.last_synced_at.isoformat(),
            "reviews_fetched": log.reviews_fetched,
            "new_reviews": log.new_reviews,
        }
        for log in logs
    ]
