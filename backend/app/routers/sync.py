"""Sync endpoints — search for businesses and sync reviews from Yelp/Google."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import APIRouter, Depends, HTTPException, Query, Header

from app.config import settings
from app.database import get_db
from app.models import Restaurant, Review, SyncLog
from app.schemas import ReviewPlatform, UnifiedBusiness, PlatformBusiness, SyncStatus
import uuid
import asyncio
from math import radians, cos, sin, asin, sqrt
from app.services.apify_sync import apify_google_reviews, apify_yelp_reviews
from app.services.ingestion import ingest_reviews
from sqlalchemy import func
from app.services.sentiment import analyze_and_store_batch
from app.services.sync import (
    google_search,
    yelp_search,
)

router = APIRouter(prefix="/api/sync", tags=["sync"])
logger = logging.getLogger(__name__)

# Daily sync cooldown (hours)
SYNC_COOLDOWN_HOURS = 1


@router.post("/reset-and-sync")
async def reset_and_sync(
    restaurant_id: str = Query(..., description="Restaurant ID to reset and resync"),
    db: AsyncSession = Depends(get_db),
):
    """
    Clear all reviews for a restaurant and re-initiate sync using existing logs.
    """
    # 1. Get sync logs for this restaurant
    stmt = select(SyncLog).where(SyncLog.restaurant_id == restaurant_id)
    result = await db.execute(stmt)
    logs = result.scalars().all()

    if not logs:
        raise HTTPException(status_code=404, detail="No sync logs found for this restaurant")

    # 2. No more hard-deletes! We now use Adaptive Sync.
    # sync_apify_reviews will automatically choose between Delta and Full sync
    # based on live vs local counts.
    await db.flush() 

    # 3. Trigger resync for each log
    sync_results = []
    for log in logs:
        # We call the existing sync_apify_reviews logic internally or just returnurls
        # For simplicity, we'll return a success message and then the frontend can trigger them 
        # OR we trigger them here sequentially
        try:
            res = await sync_apify_reviews(
                platform=log.platform,
                business_url=log.business_id,
                business_name=log.business_name,
                force=True,
                restaurant_id=restaurant_id,
                db=db
            )
            sync_results.append(res)
        except Exception as e:
            sync_results.append({"platform": log.platform, "status": "error", "message": str(e)})

    await db.commit()
    return {"status": "success", "results": sync_results}


@router.get("/search", response_model=list[UnifiedBusiness])
async def search_business(
    name: str = Query(..., description="Business name to search for"),
    location: str | None = Query(None, description="City or address"),
    lat: float | None = Query(None, description="Latitude"),
    lng: float | None = Query(None, description="Longitude"),
    db: AsyncSession = Depends(get_db),
):
    """
    Search for a business on both Yelp and Google Places and merge results.
    """
    yelp_results = []
    google_results = []

    # 1. Fetch from platforms
    if settings.YELP_API_KEY:
        try:
            yelp_results = await yelp_search(name, location, lat, lng)
        except Exception as e:
            logger.error(f"Yelp search failed: {e}")

    if settings.GOOGLE_PLACES_API_KEY:
        try:
            google_results = await google_search(name, location, lat, lng)
        except Exception as e:
            logger.error(f"Google search failed: {e}")

    # 2. Attach sync status to all raw results
    async def attach_sync_status(item, platform):
        # Normalize: Google uses 'place_url', Yelp uses 'url'. 
        # For PlatformBusiness schema, we want everything in 'url'.
        if platform == "google" and "place_url" in item:
            item["url"] = item.pop("place_url")
            
        biz_id = item.get("url")
        if not biz_id: return
        stmt = select(SyncLog).where(SyncLog.platform == platform, SyncLog.business_id == biz_id)
        res = await db.execute(stmt)
        log = res.scalar_one_or_none()
        if log:
            diff = datetime.utcnow() - log.last_synced_at
            total_sec = diff.total_seconds()
            ago = f"~{int(total_sec/60)}m" if total_sec < 3600 else f"~{int(total_sec/3600)}h" if total_sec < 86400 else f"~{int(total_sec/86400)}d"
            item["last_sync"] = {
                "last_synced_at": log.last_synced_at.isoformat(),
                "ago": ago,
                "on_cooldown": total_sec < (SYNC_COOLDOWN_HOURS * 3600),
                "reviews_fetched": log.reviews_fetched,
                "new_reviews": log.new_reviews
            }

    # Run sequentially to avoid session concurrency issues
    for i in google_results:
        await attach_sync_status(i, "google")
    for i in yelp_results:
        await attach_sync_status(i, "yelp")

    # 3. Merge Strategy
    def get_haversine_dist(lat1, lon1, lat2, lon2):
        if None in [lat1, lon1, lat2, lon2]: return 999999
        R = 6371 # km
        dLat, dLon = radians(lat2-lat1), radians(lon2-lon1)
        lat1, lat2 = radians(lat1), radians(lat2)
        a = sin(dLat/2)**2 + cos(lat1)*cos(lat2)*sin(dLon/2)**2
        return 2 * R * asin(sqrt(a)) * 1000 # returns meters

    # --- 4. Strict Filtering & Deep Unification ---
    # We only want results that actually match the name searched
    name_query = name.lower().strip()
    
    prefiltered_unified: list[dict] = []
    used_yelp_ids = set()
    
    # First: Build initial unified list from Google
    for g in google_results:
        # Strict Name Filter
        if name_query not in g["name"].lower():
            continue

        match = None
        for y in yelp_results:
            if y["id"] in used_yelp_ids: continue
            dist = get_haversine_dist(g["latitude"], g["longitude"], y["latitude"], y["longitude"])
            if dist < 150: # 150m threshold
                match = y
                used_yelp_ids.add(y["id"])
                break
        
        # Deep Match: If no Yelp match by distance, try a targeted Yelp search by name + coordinates
        if not match:
            try:
                # We do a tiny-radius search for this exact name near this spot
                deep_yelp = await yelp_search(g["name"], lat=g["latitude"], lng=g["longitude"])
                if deep_yelp:
                    # Check if any deep results are actually the same (tight distance)
                    for dy in deep_yelp:
                        d = get_haversine_dist(g["latitude"], g["longitude"], dy["latitude"], dy["longitude"])
                        if d < 100: # Tight 100m for deep match
                            match = dy
                            await attach_sync_status(match, "yelp")
                            break
            except Exception as e:
                logger.error(f"Deep Yelp merge failed for {g['name']}: {e}")

        total_rev = g["review_count"] + (match["review_count"] if match else 0)
        # Weighted avg rating
        if total_rev > 0:
            g_weight = g["rating"] * g["review_count"]
            y_weight = (match["rating"] * match["review_count"]) if match else 0
            avg_rating = round((g_weight + y_weight) / total_rev, 1)
        else:
            avg_rating = g["rating"]

        prefiltered_unified.append({
            "id": str(uuid.uuid4()),
            "name": g["name"],
            "address": g["address"],
            "total_reviews": total_rev,
            "avg_rating": avg_rating,
            "google": g,
            "yelp": match,
            "distance": None
        })

    # Second: Add remaining Yelp results that match the name
    for y in yelp_results:
        # Strict Name Filter
        if name_query not in y["name"].lower():
            continue

        if y["id"] not in used_yelp_ids:
            # Deep Match: Try to find this on Google if it's unique to Yelp
            google_match = None
            try:
                dg_res = await google_search(y["name"], lat=y["latitude"], lng=y["longitude"])
                if dg_res:
                    for dg in dg_res:
                        d = get_haversine_dist(dg["latitude"], dg["longitude"], y["latitude"], y["longitude"])
                        if d < 100:
                            google_match = dg
                            await attach_sync_status(google_match, "google")
                            break
            except Exception as e:
                logger.error(f"Deep Google merge failed for {y['name']}: {e}")

            if google_match:
                # If we found a Google match, it might have been missed in the first loop
                # (but it should have been caught if it matched the name filter there).
                # To avoid duplicates, we'll only add here if it wasn't already unified.
                # Since we check used_yelp_ids, it should be safe.
                pass 

            total_rev = y["review_count"] + (google_match["review_count"] if google_match else 0)
            if total_rev > 0:
                y_weight = y["rating"] * y["review_count"]
                g_weight = (google_match["rating"] * google_match["review_count"]) if google_match else 0
                avg_rating = round((y_weight + g_weight) / total_rev, 1)
            else:
                avg_rating = y["rating"]

            prefiltered_unified.append({
                "id": str(uuid.uuid4()),
                "name": y["name"],
                "address": y["address"],
                "total_reviews": total_rev,
                "avg_rating": avg_rating,
                "google": google_match,
                "yelp": y,
                "distance": None
            })

    unified = prefiltered_unified

    print(f"DEBUG: search_business returning {type(unified)} with {len(unified)} items")
    return unified



@router.post("/apify-reviews")
async def sync_apify_reviews(
    platform: str = Query(..., description="Platform: 'yelp' or 'google'"),
    business_url: str = Query(..., description="Full Google Maps or Yelp URL"),
    business_name: str = Query("Unknown", description="Business display name"),
    business_address: str | None = None,
    force: bool = Query(False, description="Force sync even if synced today"),
    restaurant_id: str | None = None,
    x_restaurant_id: str | None = Header(None, alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db),
):
    """
    Sync reviews via Apify actors (Google Maps Reviews Scraper / Yelp Scraper).
    Fetches more reviews than direct APIs and works with paywalled Yelp.
    """
    # ── Resolve target restaurant ID ──
    # Priority: 1. Explicit param, 2. Header
    target_restaurant_id = restaurant_id or x_restaurant_id
    
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
            # If we already have a log for this specific URL, we always use its restaurant
            target_restaurant_id = log.restaurant_id
            
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
    else:
        # Even if forcing, we need to find the target_restaurant_id if it exists
        # The initial assignment `target_restaurant_id = restaurant_id` handles the fallback
        existing = await db.execute(
            select(SyncLog).where(
                SyncLog.platform == platform,
                SyncLog.business_id == business_id,
            )
        )
        log = existing.scalar_one_or_none()
        if log:
            target_restaurant_id = log.restaurant_id

    # ── Provision new Restaurant if no mapping exists ──
    if not target_restaurant_id:
        # Check if a restaurant with the same name AND address already exists
        stmt = select(Restaurant).where(Restaurant.name == business_name)
        if business_address:
            stmt = stmt.where(Restaurant.address == business_address)
        
        existing_resto = await db.execute(stmt)
        matched = existing_resto.scalar_one_or_none()
        
        if matched:
            # SAFETY: Only merge by name if this restaurant doesn't ALREADY have
            # a sync log for this platform. If it does, they are likely different locations.
            platform_check = await db.execute(
                select(SyncLog).where(
                    SyncLog.restaurant_id == matched.id,
                    SyncLog.platform == platform
                )
            )
            has_conflicting_sync = platform_check.scalar_one_or_none()
            
            if not has_conflicting_sync:
                logger.info(f"Matched existing restaurant '{business_name}' (ID: {matched.id}). No platform conflict.")
                target_restaurant_id = matched.id
                # Update address if it was missing
                if business_address and not matched.address:
                    matched.address = business_address
            else:
                logger.info(f"Restaurant name '{business_name}' exists but belongs to a different {platform} URL. Creating separate entry.")

        if not target_restaurant_id:
            logger.info(f"First-time sync for {business_name}. Provisioning new Restaurant tenant.")
            new_restaurant = Restaurant(name=business_name, address=business_address)
            db.add(new_restaurant)
            await db.flush() # Get the generated ID
            target_restaurant_id = new_restaurant.id
    else:
        # If target restaurant already existed, update its address if provided and different
        res_stmt = await db.execute(select(Restaurant).where(Restaurant.id == target_restaurant_id))
        existing_res = res_stmt.scalar_one_or_none()
        if existing_res and business_address and existing_res.address != business_address:
            logger.info(f"Updating address for restaurant {target_restaurant_id} to {business_address}")
            existing_res.address = business_address
    
    # Ensure restaurant_id is set for downstream services
    restaurant_id = target_restaurant_id

    # ── Adaptive Sync Branching ──
    # 1. Get local count
    local_count = 0
    if target_restaurant_id:
        local_count_result = await db.execute(
            select(func.count(Review.id)).where(
                Review.restaurant_id == target_restaurant_id, 
                Review.platform == platform,
                Review.is_deleted_on_platform == False
            )
        )
        local_count = local_count_result.scalar() or 0

    # 2. Get live count (quick check)
    live_count = local_count # Default if check fails
    try:
        if platform == "google":
            # Search for this specific record again to get fresh count
            sr = await google_search(business_name, business_address or "")
            if sr:
                # Find the one with matching URL/ID
                match = next((x for x in sr if x.get("place_url") == business_url or x.get("id") == business_url), sr[0])
                live_count = match.get("review_count", local_count)
        else:
            sr = await yelp_search(business_name, business_address or "")
            if sr:
                match = next((x for x in sr if x.get("url") == business_url or x.get("id") == business_url), sr[0])
                live_count = match.get("review_count", local_count)
    except Exception as e:
        logger.warning(f"Live count check failed: {e}. Falling back to Full Sync for safety.")
        live_count = -1 # Trigger full sync

    # 3. Decision
    # - New Shop: Full Sync
    # - Deletions (live < local): Full Sync to prune
    # - Massive Gap (> 50): Full Sync
    # - Small Gap or Equality: Delta Sync (cheap)
    delta_limit = 50
    gap = live_count - local_count
    
    is_full_sync = (
        local_count == 0 or 
        live_count < local_count or 
        gap >= delta_limit or
        live_count == -1
    )
    
    max_reviews_to_fetch = 100000 if is_full_sync else delta_limit
    sync_mode = "full" if is_full_sync else "delta"
    
    logger.info(f"Adaptive Sync Logic: local={local_count}, live={live_count}, gap={gap} => MODE: {sync_mode}")

    # ── Fetch reviews via Apify ──
    try:
        if platform == "google":
            raw_reviews = await apify_google_reviews(business_url, max_reviews_to_fetch)
            review_platform = ReviewPlatform.google
        elif platform == "yelp":
            raw_reviews = await apify_yelp_reviews(business_url, max_reviews_to_fetch)
            review_platform = ReviewPlatform.yelp
        else:
            raise HTTPException(status_code=400, detail="Platform must be 'yelp' or 'google'")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Apify {platform} error: {str(e)}")

    # ── Ingest into SavorIQ ──
    report = await ingest_reviews(
        db, 
        target_restaurant_id, 
        review_platform, 
        raw_reviews, 
        full_sync=is_full_sync
    )

    # ── Run sentiment analysis on new reviews (Batch processing) ──
    if report.ingested > 0:
        result = await db.execute(
            select(Review)
            .where(
                Review.restaurant_id == target_restaurant_id,
                Review.platform == platform,
                Review.is_deleted_on_platform == False
            )
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
        
        from app.services.sentiment import analyze_and_store_batch
        
        total_batches = (len(reviews_to_analyze) + batch_size - 1) // batch_size
        logger.info(f"Processing sentiment for {len(reviews_to_analyze)} reviews in {total_batches} batches.")
        
        for i in range(0, len(reviews_to_analyze), batch_size):
            batch = reviews_to_analyze[i : i + batch_size]
            batch_num = (i // batch_size) + 1
            logger.info(f"Analyzing batch {batch_num}/{total_batches}...")
            try:
                await analyze_and_store_batch(db, batch)
            except Exception as e:
                logger.error(f"Sentiment analysis failed for batch starting at {i}: {e}")
                # Continue with next batch so we don't crash the whole sync
                continue

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
        # Keep existing restaurant_id mapping
    else:
        log = SyncLog(
            restaurant_id=restaurant_id, # Link new log to the restaurant it created/received
            platform=platform,
            business_id=business_id,
            business_name=business_name,
            last_synced_at=datetime.utcnow(),
            reviews_fetched=len(raw_reviews),
            new_reviews=report.ingested,
        )
        db.add(log)

    await db.commit()

    return {
        "status": "synced",
        "mode": sync_mode,
        "platform": platform,
        "business_name": business_name,
        "live_count": live_count,
        "local_count": local_count,
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
