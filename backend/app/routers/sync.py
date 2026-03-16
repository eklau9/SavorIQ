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
from app.services.cache import api_cache
from app.services.sync import (
    google_search,
    yelp_search,
)
from app.services.discovery import discover_menu_items
from app.models import MenuItem

from app.services.sync_progress import sync_manager

router = APIRouter(prefix="/api/sync", tags=["sync"])
logger = logging.getLogger(__name__)

@router.get("/progress/{restaurant_id}")
async def get_sync_progress(restaurant_id: str):
    """Poll for the current progress of a sync operation."""
    state = sync_manager.get_state(restaurant_id)
    if not state:
        return {"percent": 0, "status": "Idle", "active": False}
    
    return {
        "percent": state.percent,
        "status": state.status,
        "processed_count": state.processed_count,
        "total_count": state.total_count,
        "estimated_seconds_remaining": state.estimated_seconds_remaining,
        "is_cancelled": state.is_cancelled,
        "active": state.percent < 100
    }

@router.delete("/progress/{restaurant_id}")
async def cancel_sync(restaurant_id: str):
    """Request cancellation of an active sync."""
    sync_manager.cancel_sync(restaurant_id)
    return {"status": "cancellation_requested"}

# Daily sync cooldown (hours)
SYNC_COOLDOWN_HOURS = 1


@router.post("/reset-and-sync")
async def reset_and_sync(
    restaurant_id: str = Query(..., description="Restaurant ID to reset and resync"),
    db: AsyncSession = Depends(get_db),
):
    """
    Smart Sync for a restaurant: re-syncs the most recent Google and Yelp logs only.
    Runs platforms concurrently to avoid timeouts.
    """
    # Initialize global progress tracking
    sync_manager.start_sync(restaurant_id, "Initializing Smart Sync...")
    
    # 1. Get sync logs for this restaurant
    stmt = select(SyncLog).where(SyncLog.restaurant_id == restaurant_id).order_by(SyncLog.last_synced_at.desc())
    result = await db.execute(stmt)
    logs = result.scalars().all()

    if not logs:
        raise HTTPException(status_code=404, detail="No sync logs found for this restaurant")

    # 2. Pick only the most recent log PER PLATFORM
    latest_per_platform: dict[str, SyncLog] = {}
    for log in logs:
        if log.platform not in latest_per_platform:
            latest_per_platform[log.platform] = log

    # ── Trigger resync concurrently ──
    from app.database import async_session
    
    async def run_single_sync(platform, log):
        # We need to use the sync log data if available
        biz_url = log.business_id if log else None
        biz_name = log.business_name if log else None
        
        async with async_session() as session:
            try:
                if not biz_url:
                    # Try to discover it if we don't have a log (Deep Discovery)
                    # We look for the active restaurant name
                    res_stmt = await session.execute(select(Restaurant).where(Restaurant.id == restaurant_id))
                    active_res = res_stmt.scalar_one_or_none()
                    if not active_res:
                        return {"platform": platform, "status": "error", "message": "Restaurant not found", "new_ingested": 0}
                    
                    biz_name = active_res.name
                    logger.info(f"Attempting to discover {platform} for {biz_name}...")
                    
                    if platform == "google":
                        matches = await google_search(biz_name)
                    else:
                        matches = await yelp_search(biz_name)
                    
                    if not matches:
                        return {"platform": platform, "status": "skipped", "message": f"Could not discover {platform} page", "new_ingested": 0}
                    
                    # Pick best match (first one)
                    best = matches[0]
                    biz_url = best.get("place_url") if platform == "google" else best.get("url")
                    biz_name = best["name"]

                return await sync_apify_reviews(
                    platform=platform,
                    business_url=biz_url,
                    business_name=biz_name,
                    force=True,
                    restaurant_id=restaurant_id,
                    db=session
                )
            except Exception as e:
                logger.error(f"Background sync failed for {platform}: {e}", exc_info=True)
                return {
                    "platform": platform, 
                    "status": "error", 
                    "message": str(e),
                    "new_ingested": 0
                }

    # 2. Add 'google' or 'yelp' if missing from logs
    required = ["google", "yelp"]
    tasks = []
    for p in required:
        log = latest_per_platform.get(p)
        tasks.append(run_single_sync(p, log))

    sync_results = await asyncio.gather(*tasks)
    
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
            # UPDATE Ground Truth: Caputre live counts for free during any search!
            log.platform_total_count = item.get("review_count")
            log.platform_rating = item.get("rating")
            
            diff = datetime.utcnow() - log.last_synced_at
            total_sec = diff.total_seconds()
            ago = f"{int(total_sec/60)}m ago" if total_sec < 3600 else f"{int(total_sec/3600)}h ago" if total_sec < 86400 else f"{int(total_sec/86400)}d ago"
            item["last_sync"] = {
                "last_synced_at": log.last_synced_at.isoformat(),
                "ago": ago,
                "on_cooldown": total_sec < (SYNC_COOLDOWN_HOURS * 3600),
                "cooldown_remaining_minutes": max(0, int((SYNC_COOLDOWN_HOURS * 3600 - total_sec) / 60)) if total_sec < (SYNC_COOLDOWN_HOURS * 3600) else 0,
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
    target_restaurant_id = restaurant_id or x_restaurant_id
    
    # Initialize progress if it's the high-level call (not concurrent background call)
    if target_restaurant_id and not restaurant_id:
        sync_manager.start_sync(target_restaurant_id, f"Initializing {platform} sync...")

    # SAFETY CHECK: Prevent cross-location pollution
    if target_restaurant_id:
        res_stmt = await db.execute(select(Restaurant).where(Restaurant.id == target_restaurant_id))
        target_res = res_stmt.scalar_one_or_none()
        if target_res:
            t_name = target_res.name.lower()
            b_name = business_name.lower()
            t_address = (target_res.address or "").lower()
            b_address = (business_address or "").lower()
            
            # 1. Strict Brand Check
            # Check if common brand name exists in both
            brand_words = {"heytea", "shu shia", "starbucks", "mcdonald"} # Expand as needed
            t_brands = {w for w in brand_words if w in t_name}
            b_brands = {w for w in brand_words if w in b_name}
            
            if t_brands and b_brands and t_brands != b_brands:
                logger.warning(f"Brand mismatch: Restaurant={t_name}, Scraped={b_name}")
                raise HTTPException(status_code=400, detail=f"Sync aborted: Scraped business '{business_name}' does not match restaurant '{target_res.name}'.")

            # 2. Location Guard (City/Address)
            # If we have addresses, ensure cities match at least
            if t_address and b_address:
                # Simple city check: find the word after the last comma or just look for city names
                # For now, let's just check if the business address (which is usually specific) 
                # has some overlap with the restaurant address.
                if not any(word in b_address for word in t_address.split() if len(word) > 3):
                    # If there's NO overlap in address words (ignoring short ones), be cautious
                    # But don't block unless we're SURE.
                    logger.info(f"Location overlap weak: {t_address} vs {b_address}")

    # ── Daily sync guard ──
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
            target_restaurant_id = log.restaurant_id
            cutoff = datetime.utcnow() - timedelta(hours=SYNC_COOLDOWN_HOURS)
            if log.last_synced_at > cutoff:
                # ... status message construction ...
                return {
                    "platform": platform,
                    "status": "skipped",
                    "message": "Already synced recently.",
                    "new_ingested": 0
                }
    else:
        existing = await db.execute(select(SyncLog).where(SyncLog.platform == platform, SyncLog.business_id == business_id))
        log = existing.scalar_one_or_none()
        if log:
            target_restaurant_id = log.restaurant_id

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
    if restaurant_id:
        sync_manager.update_progress(restaurant_id, 5, f"Checking {platform} live counts...")
    
    live_count = local_count # Default if check fails
    try:
        if platform == "google":
            sr = await google_search(business_name, business_address or "")
            if sr:
                match = next((x for x in sr if x.get("place_url") == business_url or x.get("id") == business_url), sr[0])
                live_count = match.get("review_count", local_count)
        else:
            sr = await yelp_search(business_name, business_address or "")
            if sr:
                match = next((x for x in sr if x.get("url") == business_url or x.get("id") == business_url), sr[0])
                live_count = match.get("review_count", local_count)
    except Exception as e:
        logger.warning(f"Live count check failed: {e}. Falling back to Full Sync for safety.")
        live_count = -1 

    # 3. Decision
    delta_limit = 50
    gap = live_count - local_count
    is_full_sync = (local_count == 0 or live_count < local_count or gap >= delta_limit or live_count == -1)
    max_reviews_to_fetch = 100000 if is_full_sync else delta_limit
    sync_mode = "full" if is_full_sync else "delta"
    
    logger.info(f"Adaptive Sync Logic: local={local_count}, live={live_count}, gap={gap} => MODE: {sync_mode}")

    if restaurant_id:
        sync_manager.update_progress(restaurant_id, 10, f"Scraping {platform} reviews ({sync_mode})...", est_remaining=120)

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
        logger.error(f"Apify {platform} error: {e}", exc_info=True)
        raise HTTPException(
            status_code=502, 
            detail=f"Apify {platform} error: {str(e)}. This usually means the scraper timed out or hit a block. Please try again in 5 minutes."
        )

    if restaurant_id:
        if sync_manager.is_cancelled(restaurant_id):
             return {
                 "platform": platform,
                 "status": "cancelled", 
                 "message": "Sync was cancelled by user.",
                 "new_ingested": 0
             }
        sync_manager.update_progress(
            restaurant_id, 
            40, 
            f"Ingesting {len(raw_reviews)} reviews...", 
            processed_count=0,
            total_count=len(raw_reviews),
            est_remaining=60
        )

    # ── Ingest into SavorIQ ──
    # INCREMENTAL SYNC: Use Stop-on-Match unless it's a forced full sync.
    # We only prune if we fetched ALL reviews (full sync).
    stop_on_match = not is_full_sync
    safe_to_prune = is_full_sync and live_count > 0 and len(raw_reviews) >= live_count
    
    report = await ingest_reviews(
        db, 
        target_restaurant_id, 
        review_platform, 
        raw_reviews, 
        full_sync=safe_to_prune,
        stop_on_match=stop_on_match
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
        
        total_reviews = len(reviews_to_analyze)
        total_batches = (total_reviews + batch_size - 1) // batch_size
        logger.info(f"Processing sentiment for {total_reviews} reviews in {total_batches} batches.")
        
        for i in range(0, total_reviews, batch_size):
            if restaurant_id:
                if sync_manager.is_cancelled(restaurant_id):
                    return {
                        "platform": platform,
                        "status": "cancelled", 
                        "message": "Sync was cancelled by user during sentiment analysis.",
                        "new_ingested": report.ingested
                    }
                
                batch_num = (i // batch_size) + 1
                progress = 40 + int((batch_num / total_batches) * 60)
                remaining_batches = total_batches - batch_num
                est_rem = remaining_batches * 5 # Roughly 5s per batch
                
                # Report processed count (how many reviews completed sentiment so far)
                processed = i
                sync_manager.update_progress(
                    restaurant_id, 
                    progress, 
                    f"Analyzing sentiment batch {batch_num}/{total_batches}...",
                    processed_count=processed,
                    total_count=total_reviews,
                    est_remaining=est_rem
                )

            batch = reviews_to_analyze[i : i + batch_size]
            batch_num = (i // batch_size) + 1
            logger.info(f"Analyzing batch {batch_num}/{total_batches}...")
            
            async with db.begin_nested():
                try:
                    await analyze_and_store_batch(db, batch)
                except Exception as e:
                    logger.error(f"Sentiment analysis failed for batch {batch_num}: {e}")
                    continue
            
            # Rate limiting: 15 RPM = 1 request every 4 seconds
            if i + batch_size < total_reviews:
                logger.info(f"Rate limiting: Waiting 4s before next batch...")
                await asyncio.sleep(4)

    if restaurant_id:
        sync_manager.finish_sync(restaurant_id)

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
        # Update Ground Truth captured during this sync session
        log.platform_total_count = live_count if live_count >= 0 else log.platform_total_count
        # We don't have a reliable live_rating here unless we fetched it in the count check
    else:
        log = SyncLog(
            restaurant_id=restaurant_id,
            platform=platform,
            business_id=business_id,
            business_name=business_name,
            last_synced_at=datetime.utcnow(),
            reviews_fetched=len(raw_reviews),
            new_reviews=report.ingested,
            platform_total_count=live_count if live_count >= 0 else None,
        )
        db.add(log)

    await db.commit()

    # ── Automatic Menu Discovery (For Zero-Config Onboarding) ──
    if target_restaurant_id:
        # Check if menu is currently empty
        m_stmt = await db.execute(select(func.count(MenuItem.id)).where(MenuItem.restaurant_id == target_restaurant_id))
        m_count = m_stmt.scalar() or 0
        
        if m_count == 0 and len(raw_reviews) > 0:
            logger.info(f"Zero-Config detected for restaurant {target_restaurant_id}. Triggering AI Menu Discovery...")
            if restaurant_id:
                sync_manager.update_progress(restaurant_id, 95, "Discovering menu items from reviews...", est_remaining=10)
            
            # Use top 50 reviews for discovery
            texts = [r.content for r in new_reviews[:50]] if report.ingested > 0 else [r["text"] for r in raw_reviews[:50] if r.get("text")]
            discovered_items = await discover_menu_items(texts)
            
            if discovered_items:
                to_add = [
                    MenuItem(
                        restaurant_id=target_restaurant_id,
                        name=item["name"],
                        category=item["category"],
                        keywords=item["keywords"]
                    )
                    for item in discovered_items
                ]
                db.add_all(to_add)
                await db.commit()
                logger.info(f"Auto-discovered and saved {len(to_add)} menu items.")


    # Bust the cache so the dashboard shows fresh data
    api_cache.invalidate(restaurant_id)
    logger.info(f"Cache invalidated for restaurant {restaurant_id} after sync")

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
