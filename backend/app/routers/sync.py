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
from sqlalchemy import func
from app.services.sync import (
    google_search,
    yelp_search,
    google_autocomplete,
    yelp_autocomplete,
)

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

    # 2. Pick only the most recent log PER PLATFORM
    latest_per_platform: dict[str, SyncLog] = {}
    for log in logs:
        if log.platform not in latest_per_platform:
            latest_per_platform[log.platform] = log

    from app.database import async_session
    from app.services.sync_engine import execute_platform_sync

    async def run_single_sync(platform, log):
        """Discover business URL if needed, then delegate to shared sync engine."""
        biz_url = log.business_id if log else None
        biz_name = log.business_name if log else None
        
        async with async_session() as session:
            try:
                if not biz_url:
                    # Deep Discovery: find the business by restaurant name
                    res_stmt = await session.execute(select(Restaurant).where(Restaurant.id == restaurant_id))
                    active_res = res_stmt.scalar_one_or_none()
                    if not active_res:
                        return {"platform": platform, "status": "error", "message": "Restaurant not found", "new_ingested": 0}
                    
                    biz_name = active_res.name
                    search_name = biz_name.encode('ascii', 'ignore').decode('ascii').strip() or biz_name
                    
                    if platform == "google":
                        matches = await google_search(biz_name)
                    else:
                        matches = await yelp_search(search_name)
                    
                    if not matches:
                        return {"platform": platform, "status": "skipped", "message": f"Could not discover {platform} page", "new_ingested": 0}
                    
                    best = matches[0]
                    biz_url = best.get("place_url") if platform == "google" else best.get("url")
                    biz_name = best["name"]

                # Delegate to shared sync engine (full sync for reset-and-sync)
                return await execute_platform_sync(
                    db=session,
                    restaurant_id=restaurant_id,
                    platform=platform,
                    business_url=biz_url,
                    business_name=biz_name,
                    max_reviews=100000,
                    is_full_sync=True,
                )
            except Exception as e:
                logger.error(f"Background sync failed for {platform}: {e}", exc_info=True)
                return {"platform": platform, "status": "error", "message": str(e), "new_ingested": 0}

    # Run both platforms concurrently
    required = ["google", "yelp"]
    tasks = [run_single_sync(p, latest_per_platform.get(p)) for p in required]
    sync_results = await asyncio.gather(*tasks)
    
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

    # 1. Fetch from both platforms in parallel
    async def _safe_yelp():
        if not settings.YELP_API_KEY: return []
        try:
            return await yelp_search(name, location, lat, lng)
        except Exception as e:
            logger.error(f"Yelp search failed: {e}")
            return []

    async def _safe_google():
        if not settings.GOOGLE_PLACES_API_KEY: return []
        try:
            return await google_search(name, location, lat, lng)
        except Exception as e:
            logger.error(f"Google search failed: {e}")
            return []

    yelp_results, google_results = await asyncio.gather(_safe_yelp(), _safe_google())

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
            google_match = None  # Only merge with Google results already fetched

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
    is_new_restaurant = False
    
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
            is_new_restaurant = True

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
        force: bool,
        is_new_restaurant: bool = False,
    ):
        import sys
        sys.stdout.write(f"\nSYNC: started for {restaurant_id} ({platform})\n")
        sys.stdout.flush()
        try:
            from app.database import async_session
            from app.services.sync_engine import execute_platform_sync

            async with async_session() as bg_db:
                try:
                    # ── Strict Business ID Guard ──
                    existing_binding = (await bg_db.execute(
                        select(SyncLog.business_id).where(
                            SyncLog.restaurant_id == restaurant_id,
                            SyncLog.platform == platform,
                        ).limit(1)
                    )).scalar_one_or_none()

                    if existing_binding and existing_binding != business_url:
                        sync_manager.finish_sync(
                            restaurant_id,
                            status="❌ Sync rejected: Cross-contamination prevented.",
                        )
                        logger.error(f"Guard rejected sync: {business_url} vs bound {existing_binding}")
                        return

                    # ── Smart Delta: figure out how many reviews to fetch ──
                    local_count = (await bg_db.execute(
                        select(func.count(Review.id)).where(
                            Review.restaurant_id == restaurant_id,
                            Review.platform == platform,
                            Review.is_deleted_on_platform == False,
                        )
                    )).scalar() or 0

                    sync_manager.update_progress(
                        restaurant_id, 5, "Checking live counts...", platform=platform
                    )
                    live_count = local_count

                    # Use cached platform count from SyncLog if available
                    existing_log = (await bg_db.execute(
                        select(SyncLog).where(
                            SyncLog.platform == platform,
                            SyncLog.business_id == business_url,
                        )
                    )).scalar_one_or_none()

                    if existing_log and existing_log.platform_total_count:
                        live_count = existing_log.platform_total_count
                    else:
                        try:
                            if platform == "google":
                                sr = await google_search(business_name, business_address or "")
                                if sr:
                                    match = next(
                                        (x for x in sr if x.get("place_url") == business_url or x.get("id") == business_url),
                                        sr[0],
                                    )
                                    live_count = match.get("review_count", local_count)
                            else:
                                sr = await yelp_search(business_name, business_address or "")
                                if sr:
                                    match = next(
                                        (x for x in sr if x.get("url") == business_url or x.get("id") == business_url),
                                        sr[0],
                                    )
                                    live_count = match.get("review_count", local_count)
                        except Exception as e:
                            logger.warning(f"Live count check failed: {e}")

                    # Decide sync mode
                    is_full_sync = local_count == 0 or force
                    if is_full_sync:
                        max_reviews = 100000
                    else:
                        # Only fetch enough to cover new reviews + safety buffer
                        diff = max(live_count - local_count, 0)
                        max_reviews = max(int(diff * 1.5) + 20, 50)

                    sys.stdout.write(
                        f"SYNC: local={local_count} live={live_count} "
                        f"mode={'full' if is_full_sync else 'delta'} max={max_reviews}\n"
                    )
                    sys.stdout.flush()

                    # ── Delegate to shared sync engine ──
                    result = await execute_platform_sync(
                        db=bg_db,
                        restaurant_id=restaurant_id,
                        platform=platform,
                        business_url=business_url,
                        business_name=business_name,
                        max_reviews=max_reviews,
                        is_full_sync=is_full_sync,
                    )

                    # Update live count in SyncLog if we got a valid one
                    if live_count > 0:
                        log_entry = (await bg_db.execute(
                            select(SyncLog).where(
                                SyncLog.platform == platform,
                                SyncLog.business_id == business_url,
                            )
                        )).scalar_one_or_none()
                        if log_entry:
                            log_entry.platform_total_count = live_count
                            await bg_db.commit()

                    sys.stdout.write(f"SYNC: COMPLETE — {result}\n")
                    sys.stdout.flush()

                except Exception as e:
                    logger.error(f"Critical sync failure: {e}", exc_info=True)
                    sys.stdout.write(f"SYNC CRASH: {e}\n")
                    sys.stdout.flush()
                    sync_manager.finish_sync(
                        restaurant_id, status=f"❌ Sync crashed: {str(e)[:50]}"
                    )

                # ── Cleanup on cancel: remove new restaurants with zero reviews ──
                if sync_manager.is_cancelled(restaurant_id) and is_new_restaurant:
                    review_count = (await bg_db.execute(
                        select(func.count(Review.id)).where(
                            Review.restaurant_id == restaurant_id,
                            Review.is_deleted_on_platform == False,
                        )
                    )).scalar() or 0

                    if review_count == 0:
                        from sqlalchemy import delete
                        from app.models import Guest, SentimentScore, MenuItem
                        # Cascade delete in dependency order
                        review_ids_subq = select(Review.id).where(Review.restaurant_id == restaurant_id).scalar_subquery()
                        await bg_db.execute(delete(SentimentScore).where(SentimentScore.review_id.in_(review_ids_subq)))
                        await bg_db.execute(delete(Review).where(Review.restaurant_id == restaurant_id))
                        await bg_db.execute(delete(SyncLog).where(SyncLog.restaurant_id == restaurant_id))
                        await bg_db.execute(delete(MenuItem).where(MenuItem.restaurant_id == restaurant_id))
                        await bg_db.execute(delete(Guest).where(Guest.restaurant_id == restaurant_id))
                        await bg_db.execute(delete(Restaurant).where(Restaurant.id == restaurant_id))
                        await bg_db.commit()
                        logger.info(f"Cancelled sync cleaned up new restaurant {restaurant_id} (zero reviews)")
                        sync_manager.finish_sync(restaurant_id, status="Cancelled — no data saved.")
                        sync_manager.clear_state(restaurant_id)

        except Exception as e:
            sys.stdout.write(f"SYNC FATAL: {type(e).__name__}: {e}\n")
            sys.stdout.flush()
            sync_manager.finish_sync(
                restaurant_id, status=f"❌ Fatal: {str(e)[:50]}"
            )

    background_tasks.add_task(
        _run_sync_task, platform, business_url, business_name,
        target_restaurant_id, business_address, force, is_new_restaurant,
    )

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
