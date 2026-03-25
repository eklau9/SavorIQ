"""Sync endpoints — search for businesses and sync reviews from Yelp/Google."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import APIRouter, Depends, HTTPException, Query, Header, BackgroundTasks

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
    google_autocomplete,
    yelp_autocomplete,
)
from app.services.discovery import discover_menu_items
from app.models import MenuItem

from app.services.sync_progress import sync_manager

router = APIRouter(prefix="/api/sync", tags=["sync"])
logger = logging.getLogger(__name__)


@router.get("/autocomplete")
async def autocomplete_business(
    q: str = Query(..., min_length=2),
    lat: float = Query(None),
    lng: float = Query(None),
):
    """Lightweight typeahead — returns name suggestions from Google + Yelp."""
    import asyncio
    google_task = asyncio.create_task(google_autocomplete(q, lat, lng))
    yelp_task = asyncio.create_task(yelp_autocomplete(q, lat, lng))

    google_results, yelp_results = [], []
    try:
        google_results = await google_task
    except Exception as e:
        logger.warning(f"Google autocomplete failed: {e}")
    try:
        yelp_results = await yelp_task
    except Exception as e:
        logger.warning(f"Yelp autocomplete failed: {e}")

    # Deduplicate by name (case-insensitive), prefer Google
    seen = set()
    combined = []
    for item in google_results + yelp_results:
        key = item["name"].strip().lower()
        if key not in seen:
            seen.add(key)
            combined.append(item)

    return combined[:8]  # Cap at 8 suggestions

@router.get("/latest-results/{restaurant_id}")
async def get_latest_sync_results(
    restaurant_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Return the most recent sync_log entries per platform for this restaurant.
    Used by the frontend to show accurate per-platform results in the report overlay."""
    from datetime import datetime, timedelta
    cutoff = datetime.utcnow() - timedelta(hours=1)
    
    logs = (await db.execute(
        select(SyncLog)
        .where(SyncLog.restaurant_id == restaurant_id, SyncLog.last_synced_at >= cutoff)
        .order_by(SyncLog.last_synced_at.desc())
    )).scalars().all()
    
    # Deduplicate: keep most recent per platform
    seen = set()
    results = []
    for log in logs:
        if log.platform not in seen:
            seen.add(log.platform)
            results.append({
                "platform": log.platform,
                "status": "success",
                "new_ingested": log.new_reviews,
                "reviews_fetched": log.reviews_fetched,
                "business_name": log.business_name,
            })
    
    return results

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
        "active": state.percent < 100,
        "new_ingested": state.new_ingested,
        "platform": state.platform,
    }

@router.delete("/progress/{restaurant_id}")
async def cancel_sync(restaurant_id: str):
    """Request cancellation of an active sync."""
    sync_manager.cancel_sync(restaurant_id)
    return {"status": "cancellation_requested"}




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

    # If no logs exist yet, run_single_sync will use deep discovery (search by restaurant name)

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
                    res_stmt = await session.execute(select(Restaurant).where(Restaurant.id == restaurant_id))
                    active_res = res_stmt.scalar_one_or_none()
                    if not active_res:
                        return {"platform": platform, "status": "error", "message": "Restaurant not found", "new_ingested": 0}
                    
                    biz_name = active_res.name
                    # Strip non-ASCII chars for Yelp (e.g. "Shu Shia 树夏" → "Shu Shia")
                    search_name = biz_name.encode('ascii', 'ignore').decode('ascii').strip()
                    if not search_name:
                        search_name = biz_name
                    
                    logger.info(f"Attempting to discover {platform} for '{search_name}' (from '{biz_name}')...")
                    
                    if platform == "google":
                        matches = await google_search(biz_name)  # Google handles CJK fine
                    else:
                        matches = await yelp_search(search_name)
                    
                    if not matches:
                        return {"platform": platform, "status": "skipped", "message": f"Could not discover {platform} page", "new_ingested": 0}
                    
                    best = matches[0]
                    biz_url = best.get("place_url") if platform == "google" else best.get("url")
                    biz_name = best["name"]

                # ── Scrape reviews via Apify ──
                sync_manager.update_progress(restaurant_id, 10, f"Scraping reviews...", platform=platform)
                if platform == "google":
                    raw_reviews = await apify_google_reviews(
                        biz_url, 100000,
                        progress_callback=lambda p, s: sync_manager.update_progress(restaurant_id, p, s, platform=platform)
                    )
                else:
                    raw_reviews = await apify_yelp_reviews(
                        biz_url, 100000,
                        progress_callback=lambda p, s: sync_manager.update_progress(restaurant_id, p, s, platform=platform)
                    )

                # ── Ingest ──
                sync_manager.update_progress(restaurant_id, 40, f"Ingesting {len(raw_reviews)} reviews...", platform=platform)
                def _ingest_progress(done, total):
                    pct = 35 + int(5 * (done / total)) if total else 35
                    sync_manager.update_progress(restaurant_id, pct, f"Ingesting review {done}/{total}...",
                                                 processed_count=done, total_count=total, platform=platform)
                report = await ingest_reviews(session, restaurant_id, ReviewPlatform(platform), raw_reviews, full_sync=True,
                                             progress_callback=_ingest_progress)

                # ── Sentiment analysis ──
                if report.ingested > 0:
                    res = await session.execute(
                        select(Review).where(Review.restaurant_id == restaurant_id, Review.platform == platform)
                        .order_by(Review.ingested_at.desc()).limit(report.ingested)
                    )
                    new_reviews = res.scalars().all()
                    batch_size = 130
                    reviews_to_analyze = [{"id": r.id, "text": r.content} for r in new_reviews]
                    total_reviews = len(reviews_to_analyze)
                    import time as _time
                    _batch_start = _time.monotonic()
                    sync_manager.update_progress(restaurant_id, 40, f"Analyzing sentiment... (0/{total_reviews})",
                                                 processed_count=0, total_count=total_reviews, platform=platform)
                    for i in range(0, total_reviews, batch_size):
                        batch = reviews_to_analyze[i : i + batch_size]
                        await analyze_and_store_batch(session, batch)
                        done = min(i + batch_size, total_reviews)
                        pct = 40 + int(50 * (done / total_reviews))
                        elapsed = _time.monotonic() - _batch_start
                        rate = done / elapsed if elapsed > 0 else 0
                        eta = int((total_reviews - done) / rate) if rate > 0 else None
                        sync_manager.update_progress(
                            restaurant_id, pct,
                            f"Analyzing sentiment... ({done}/{total_reviews})",
                            processed_count=done, total_count=total_reviews, est_remaining=eta, platform=platform
                        )
                        if done < total_reviews:
                            await asyncio.sleep(4)

                # ── Update SyncLog ──
                sync_log = (await session.execute(
                    select(SyncLog).where(SyncLog.platform == platform, SyncLog.business_id == biz_url)
                )).scalar_one_or_none()
                if not sync_log:
                    sync_log = SyncLog(restaurant_id=restaurant_id, platform=platform, business_id=biz_url, business_name=biz_name)
                    session.add(sync_log)
                sync_log.last_synced_at = datetime.utcnow()
                sync_log.reviews_fetched = len(raw_reviews)
                sync_log.new_reviews = report.ingested

                await session.commit()
                api_cache.invalidate(restaurant_id)

                sync_manager.finish_platform(restaurant_id, platform, new_ingested=report.ingested)
                return {"platform": platform, "status": "success", "new_ingested": report.ingested}
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
    
    # Log results for debugging
    for r in sync_results:
        logger.info(f"SYNC RESULT for {restaurant_id}: {r}")
    
    sync_manager.finish_sync(restaurant_id, status="✅ Smart Sync complete.")
    return {"status": "success", "results": list(sync_results)}


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

    # 1b. Location-aware Yelp fallback: if no location/GPS was provided and Google
    # returned results, re-search Yelp using the first Google result's coordinates.
    # This ensures both platforms search the same geographic area.
    if google_results and not yelp_results and not location and lat is None:
        first_g = google_results[0]
        g_lat, g_lng = first_g.get("latitude"), first_g.get("longitude")
        if g_lat and g_lng:
            try:
                logger.info(f"Yelp fallback: re-searching near Google result ({g_lat}, {g_lng})")
                yelp_results = await yelp_search(name, lat=g_lat, lng=g_lng)
            except Exception as e:
                logger.error(f"Yelp fallback search failed: {e}")

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
                "reviews_fetched": log.reviews_fetched,
                "new_reviews": log.new_reviews,
                "on_cooldown": total_sec < 3600,     # 1-hour cooldown
                "cooldown_remaining_minutes": max(0, int((3600 - total_sec) / 60)) if total_sec < 3600 else 0,
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
async def sync_apify_reviews_endpoint(
    platform: str = Query(..., description="Platform: 'yelp' or 'google'"),
    business_url: str = Query(..., description="Full Google Maps or Yelp URL"),
    business_name: str = Query("Unknown", description="Business display name"),
    business_address: str | None = None,
    force: bool = Query(False, description="Force sync even if synced today"),
    restaurant_id: str | None = None,
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: AsyncSession = Depends(get_db),
):
    """
    Fire-and-forget sync endpoint. Returns immediately while the sync runs
    in a background asyncio task.
    """
    target_restaurant_id = restaurant_id
    
    # ── Resolve target restaurant ID ──
    if not target_restaurant_id:
        # Fuzzy match: check if existing name contains the search name or vice versa
        from sqlalchemy import or_, literal
        existing_res = (await db.execute(
            select(Restaurant).where(
                or_(
                    Restaurant.name.ilike(f"%{business_name}%"),
                    literal(business_name).ilike(func.concat('%', Restaurant.name, '%'))
                )
            )
        )).scalar_one_or_none()
        if existing_res:
            target_restaurant_id = existing_res.id
        else:
            new_res = Restaurant(id=str(uuid.uuid4()), name=business_name, address=business_address)
            db.add(new_res)
            await db.commit()
            target_restaurant_id = new_res.id

    # Initialize progress tracking (only if not already active — prevents second platform from resetting first)
    if not sync_manager.get_state(target_restaurant_id) or sync_manager.get_state(target_restaurant_id).percent >= 100:
        sync_manager.start_sync(target_restaurant_id, f"Initializing sync...")

    # ── Background Worker ──
    async def _run_sync_task(
        platform: str,
        business_url: str,
        business_name: str,
        restaurant_id: str,
        business_address: str | None,
        force: bool
    ):
        import sys
        sys.stdout.write(f"\nCRITICAL: _run_sync_task started for {restaurant_id} ({platform})\n")
        sys.stdout.flush()
        try:
            from app.database import async_session
            from app.services.apify_sync import apify_google_reviews, apify_yelp_reviews
            from app.services.ingestion import ingest_reviews
            from app.models import Review, SyncLog, Restaurant, MenuItem
            from sqlalchemy import select, func
            from datetime import datetime, timedelta
            from app.services.cache import api_cache
            from app.services.discovery import discover_menu_items
            import uuid

            sys.stdout.write(f"SYNC: imports done, opening session\n")
            sys.stdout.flush()

            async with async_session() as bg_db:
                sys.stdout.write(f"SYNC: session acquired\n")
                sys.stdout.flush()
                try:
                    # ── Strict Business ID Guard ──
                    existing_binding = (await bg_db.execute(
                        select(SyncLog.business_id).where(SyncLog.restaurant_id == restaurant_id, SyncLog.platform == platform).limit(1)
                    )).scalar_one_or_none()
                    
                    if existing_binding and existing_binding != business_url:
                        sync_manager.finish_sync(restaurant_id, status="❌ Sync rejected: Cross-contamination prevented.")
                        logger.error(f"Guard rejected sync: {business_url} vs bound {existing_binding}")
                        return

                    sys.stdout.write(f"SYNC: guard passed, checking local count\n")
                    sys.stdout.flush()

                    # ── Adaptive Sync Branching ──
                    local_count_result = await bg_db.execute(
                        select(func.count(Review.id)).where(Review.restaurant_id == restaurant_id, Review.platform == platform, Review.is_deleted_on_platform == False)
                    )
                    local_count = local_count_result.scalar() or 0

                    sync_manager.update_progress(restaurant_id, 5, f"Checking live counts...", platform=platform)
                    live_count = local_count
                    
                    # Try to get live count for decision making
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
                        logger.warning(f"Live count check failed: {e}")
                        live_count = -1

                    is_full_sync = (local_count == 0 or force or live_count == -1)
                    max_reviews = 100000 if is_full_sync else 50
                    sync_mode = "full" if is_full_sync else "delta"
                    
                    sys.stdout.write(f"SYNC: local={local_count} live={live_count} mode={sync_mode} max={max_reviews}\n")
                    sys.stdout.flush()
                    sync_manager.update_progress(restaurant_id, 10, f"Scraping reviews ({sync_mode})...", platform=platform)

                    # ── Fetch reviews ──
                    try:
                        if platform == "google":
                            raw_reviews = await apify_google_reviews(
                                business_url, 
                                max_reviews, 
                                progress_callback=lambda p, s: sync_manager.update_progress(restaurant_id, p, s, platform=platform)
                            )
                        else:
                            raw_reviews = await apify_yelp_reviews(
                                business_url, 
                                max_reviews,
                                progress_callback=lambda p, s: sync_manager.update_progress(restaurant_id, p, s, platform=platform)
                            )
                        review_platform = ReviewPlatform(platform)
                    except Exception as e:
                        logger.error(f"Apify error: {e}")
                        sys.stdout.write(f"SYNC ERROR: Apify failed: {e}\n")
                        sys.stdout.flush()
                        sync_manager.finish_sync(restaurant_id, status=f"❌ Scraper error: {str(e)[:50]}")
                        return

                    sys.stdout.write(f"SYNC: got {len(raw_reviews)} reviews, ingesting...\n")
                    sys.stdout.flush()
                    sync_manager.update_progress(restaurant_id, 40, f"Ingesting {len(raw_reviews)} reviews...", platform=platform)
                    
                    def _ingest_progress(done, total):
                        pct = 35 + int(5 * (done / total)) if total else 35
                        sync_manager.update_progress(restaurant_id, pct, f"Ingesting review {done}/{total}...",
                                                     processed_count=done, total_count=total, platform=platform)
                    
                    # ── Ingest into SavorIQ ──
                    report = await ingest_reviews(bg_db, restaurant_id, review_platform, raw_reviews, full_sync=is_full_sync, stop_on_match=not is_full_sync,
                                                 progress_callback=_ingest_progress)

                    sys.stdout.write(f"SYNC: ingested={report.ingested} duplicates={report.duplicates_skipped}\n")
                    sys.stdout.flush()

                    # ── Sentiment analysis ──
                    if report.ingested > 0:
                        res = await bg_db.execute(
                            select(Review).where(Review.restaurant_id == restaurant_id, Review.platform == platform)
                            .order_by(Review.ingested_at.desc()).limit(report.ingested)
                        )
                        new_reviews = res.scalars().all()
                        
                        from app.services.sentiment import analyze_and_store_batch
                        import time as _time
                        batch_size = 130
                        reviews_to_analyze = [{"id": r.id, "text": r.content} for r in new_reviews]
                        total_reviews = len(reviews_to_analyze)
                        _batch_start = _time.monotonic()
                        sync_manager.update_progress(restaurant_id, 40, f"Analyzing sentiment... (0/{total_reviews})",
                                                     processed_count=0, total_count=total_reviews, platform=platform)
                        for i in range(0, total_reviews, batch_size):
                            batch = reviews_to_analyze[i : i + batch_size]
                            await analyze_and_store_batch(bg_db, batch)
                            done = min(i + batch_size, total_reviews)
                            pct = 40 + int(50 * (done / total_reviews))
                            elapsed = _time.monotonic() - _batch_start
                            rate = done / elapsed if elapsed > 0 else 0
                            eta = int((total_reviews - done) / rate) if rate > 0 else None
                            sync_manager.update_progress(
                                restaurant_id, pct,
                                f"Analyzing sentiment... ({done}/{total_reviews})",
                                processed_count=done, total_count=total_reviews, est_remaining=eta, platform=platform
                            )
                            if done < total_reviews:
                                await asyncio.sleep(4)

                    # ── Update SyncLog ──
                    log = (await bg_db.execute(select(SyncLog).where(SyncLog.platform == platform, SyncLog.business_id == business_url))).scalar_one_or_none()
                    if not log:
                        log = SyncLog(restaurant_id=restaurant_id, platform=platform, business_id=business_url, business_name=business_name)
                        bg_db.add(log)
                    
                    log.last_synced_at = datetime.utcnow()
                    log.reviews_fetched = len(raw_reviews)
                    log.new_reviews = report.ingested
                    if live_count > 0: # Only update if we got a valid live count
                        log.platform_total_count = live_count
                    
                    # ── Automatic Menu Discovery ──
                    m_count = (await bg_db.execute(select(func.count(MenuItem.id)).where(MenuItem.restaurant_id == restaurant_id))).scalar() or 0
                    if m_count == 0 and report.ingested > 0:
                        sync_manager.update_progress(restaurant_id, 95, "Discovering menu items...", platform=platform)
                        try:
                            # Fetch review texts to feed into AI discovery
                            review_rows = (await bg_db.execute(
                                select(Review.content).where(Review.restaurant_id == restaurant_id)
                                .order_by(Review.reviewed_at.desc()).limit(50)
                            )).scalars().all()
                            
                            discovered = await discover_menu_items(list(review_rows))
                            
                            # Persist discovered items into menu_items table
                            for item in discovered:
                                mi = MenuItem(
                                    restaurant_id=restaurant_id,
                                    name=item.get("name", "Unknown"),
                                    category=item.get("category", "food"),
                                    keywords=item.get("keywords", ""),
                                )
                                bg_db.add(mi)
                            if discovered:
                                logger.info(f"Menu discovery: saved {len(discovered)} items for {restaurant_id}")
                        except Exception as e:
                            logger.warning(f"Menu discovery failed: {e}")

                    await bg_db.commit()

                    # ── Finalize ──
                    api_cache.invalidate(restaurant_id)
                    sync_manager.finish_platform(restaurant_id, platform, new_ingested=report.ingested)
                    sys.stdout.write(f"SYNC: COMPLETE for {restaurant_id} - {report.ingested} new reviews\n")
                    sys.stdout.flush()
                    logger.info(f"Background Sync for {restaurant_id} ({platform}) completed successfully.")
                    
                except Exception as e:
                    logger.error(f"Critical sync failure: {e}", exc_info=True)
                    sys.stdout.write(f"SYNC CRASH (inner): {e}\n")
                    sys.stdout.flush()
                    sync_manager.finish_sync(restaurant_id, status=f"❌ Sync crashed: {str(e)[:50]}")
        except Exception as e:
            sys.stdout.write(f"SYNC CRASH (outer): {type(e).__name__}: {e}\n")
            sys.stdout.flush()
            sync_manager.finish_sync(restaurant_id, status=f"❌ Fatal: {str(e)[:50]}")

    background_tasks.add_task(_run_sync_task, platform, business_url, business_name, target_restaurant_id, business_address, force)

    return {
        "status": "processing",
        "tracking_id": target_restaurant_id
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
