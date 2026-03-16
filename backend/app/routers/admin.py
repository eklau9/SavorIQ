"""Admin API endpoints for system monitoring and diagnostics.

These endpoints power the Admin Sidecar Dashboard and are not
intended for the customer-facing application.
"""

from __future__ import annotations

import logging
import os
import httpx

import time
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import Guest, MenuItem, Order, Restaurant, Review, SentimentScore, SyncLog
from app.schemas import SystemHealth, ComponentHealth, HealthStatus
from app.services.apify_sync import _get_apify_tokens
from app.services.yelp_tracker import get_yelp_usage, calibrate_yelp_usage, perform_live_sync
from app.services.gemini_tracker import get_gemini_usage, perform_gemini_probe

router = APIRouter(prefix="/api/admin", tags=["admin"])
logger = logging.getLogger(__name__)


@router.get("/health", response_model=SystemHealth)
async def get_health(db: AsyncSession = Depends(get_db)):
    """Comprehensive system health diagnostics."""
    # Import here to avoid circular dependency
    from app.main import start_time
    
    # 1. Database Check
    db_health = ComponentHealth(status=HealthStatus.healthy)
    try:
        start_db = time.time()
        await db.execute(select(1))
        db_health.latency_ms = round((time.time() - start_db) * 1000, 2)
    except Exception as e:
        db_health.status = HealthStatus.unhealthy
        db_health.message = str(e)

    # 2. Gemini Check
    gemini_health = ComponentHealth(status=HealthStatus.healthy)
    if not settings.GEMINI_API_KEY:
        gemini_health.status = HealthStatus.unhealthy
        gemini_health.message = "API Key missing"
    
    # 3. Apify Check
    apify_health = ComponentHealth(status=HealthStatus.healthy)
    if not settings.APIFY_API_TOKEN:
        apify_health.status = HealthStatus.unhealthy
        apify_health.message = "API Token missing"

    uptime = time.time() - start_time
    
    overall_status = HealthStatus.healthy
    if any(c.status == HealthStatus.unhealthy for c in [db_health, gemini_health, apify_health]):
        overall_status = HealthStatus.unhealthy

    return SystemHealth(
        status=overall_status,
        backend=ComponentHealth(status=HealthStatus.healthy, latency_ms=0),
        database=db_health,
        gemini=gemini_health,
        apify=apify_health,
        uptime_seconds=uptime
    )


# ── Location Management ──────────────────────────────────────────────

@router.get("/locations")
async def list_locations(db: AsyncSession = Depends(get_db)):
    """
    Return all restaurants with per-platform review counts and sync status.
    Zero quota cost — purely database queries.
    """
    restaurants = (await db.execute(select(Restaurant).order_by(Restaurant.name))).scalars().all()
    results = []

    for r in restaurants:
        # Review counts per platform
        google_local = (await db.execute(
            select(func.count(Review.id))
            .where(Review.restaurant_id == r.id, Review.platform == "google", Review.is_deleted_on_platform == False)
        )).scalar() or 0

        yelp_local = (await db.execute(
            select(func.count(Review.id))
            .where(Review.restaurant_id == r.id, Review.platform == "yelp", Review.is_deleted_on_platform == False)
        )).scalar() or 0

        # Fetch Ground Truth counts
        google_gt = (await db.execute(
            select(SyncLog.platform_total_count)
            .where(SyncLog.restaurant_id == r.id, SyncLog.platform == "google")
            .order_by(SyncLog.last_synced_at.desc())
            .limit(1)
        )).scalar()
        
        yelp_gt = (await db.execute(
            select(SyncLog.platform_total_count)
            .where(SyncLog.restaurant_id == r.id, SyncLog.platform == "yelp")
            .order_by(SyncLog.last_synced_at.desc())
            .limit(1)
        )).scalar()

        google_count = google_gt if google_gt is not None else google_local
        yelp_count = yelp_gt if yelp_gt is not None else yelp_local

        # Guest count
        guest_count = (await db.execute(
            select(func.count(Guest.id)).where(Guest.restaurant_id == r.id)
        )).scalar() or 0

        # Last sync times per platform
        google_sync = (await db.execute(
            select(SyncLog.last_synced_at)
            .where(SyncLog.restaurant_id == r.id, SyncLog.platform == "google")
            .order_by(SyncLog.last_synced_at.desc())
            .limit(1)
        )).scalar()

        yelp_sync = (await db.execute(
            select(SyncLog.last_synced_at)
            .where(SyncLog.restaurant_id == r.id, SyncLog.platform == "yelp")
            .order_by(SyncLog.last_synced_at.desc())
            .limit(1)
        )).scalar()

        results.append({
            "id": r.id,
            "name": r.name,
            "address": r.address,
            "google_reviews": google_count,
            "yelp_reviews": yelp_count,
            "total_reviews": google_count + yelp_count,
            "guest_count": guest_count,
            "google_last_synced": google_sync.isoformat() if google_sync else None,
            "yelp_last_synced": yelp_sync.isoformat() if yelp_sync else None,
            "subscription_status": "none",  # Placeholder until billing is built
            "created_at": r.created_at.isoformat(),
        })

    return results


@router.delete("/locations/{restaurant_id}")
async def delete_location(
    restaurant_id: str,
    x_confirm_delete: str = Header(..., alias="X-Confirm-Delete"),
    db: AsyncSession = Depends(get_db),
):
    """
    Permanently delete a restaurant and ALL associated data.
    Requires X-Confirm-Delete header to match the restaurant name exactly.
    """
    restaurant = (await db.execute(
        select(Restaurant).where(Restaurant.id == restaurant_id)
    )).scalar_one_or_none()

    if not restaurant:
        raise HTTPException(status_code=404, detail="Restaurant not found")

    if x_confirm_delete.strip() != restaurant.name.strip():
        raise HTTPException(
            status_code=400,
            detail=f"Confirmation failed. Type '{restaurant.name}' exactly to confirm deletion."
        )

    name = restaurant.name

    # Cascade delete in dependency order
    # 1. Sentiment scores (depends on reviews)
    review_ids_subq = select(Review.id).where(Review.restaurant_id == restaurant_id).scalar_subquery()
    await db.execute(delete(SentimentScore).where(SentimentScore.review_id.in_(review_ids_subq)))

    # 2. Reviews, Orders, Menu Items, Sync Logs (depend on restaurant + guests)
    await db.execute(delete(Review).where(Review.restaurant_id == restaurant_id))
    await db.execute(delete(Order).where(Order.restaurant_id == restaurant_id))
    await db.execute(delete(MenuItem).where(MenuItem.restaurant_id == restaurant_id))
    await db.execute(delete(SyncLog).where(SyncLog.restaurant_id == restaurant_id))

    # 3. Guests (depend on restaurant)
    await db.execute(delete(Guest).where(Guest.restaurant_id == restaurant_id))

    # 4. Restaurant itself
    await db.execute(delete(Restaurant).where(Restaurant.id == restaurant_id))

    await db.commit()
    logger.info(f"Deleted restaurant '{name}' ({restaurant_id}) and all associated data")

    return {"status": "deleted", "name": name, "id": restaurant_id}





@router.get("/quotas")
async def get_quotas():
    """
    Return live API quota data for all external services.

    Used by the Admin Sidecar Dashboard to render quota gauges.
    All checks are zero-cost (Apify account info, internal Yelp tracking, DB query).
    """
    apify_tokens = await _check_apify_tokens()
    supabase = await _check_supabase()
    google = _check_google()
    yelp = get_yelp_usage()

    return {
        "apify": apify_tokens,
        "yelp": yelp,
        "supabase": supabase,
        "google": google,
    }


@router.post("/quotas/yelp-sync")
async def sync_yelp_live():
    """
    Force a live Yelp API check and update the internal tracker.
    Costs 1 API request.
    """
    if not settings.YELP_API_KEY:
        return {"status": "error", "message": "Yelp API key not configured"}

    try:
        live_data = await perform_live_sync()
        if live_data.get("configured") and "remaining" in live_data:
            return {
                "status": "success",
                "yelp": get_yelp_usage()
            }
        else:
            return {"status": "error", "message": live_data.get("error", "Could not fetch live data")}
    except Exception as e:
        logger.error(f"Error in Yelp live sync: {e}")
        return {"status": "error", "message": str(e)}


@router.post("/quotas/gemini-sync")
async def sync_gemini_live():
    """
    Force a live Gemini API check by sending a probe request.
    If successful, resets the internal daily tracker.
    If 429 occurs, calibrates the tracker to 1500.
    """
    try:
        live_data = await perform_gemini_probe()
        # Always return the latest usage so the dashboard can align
        usage = get_gemini_usage()
        
        if live_data.get("status") == "success":
            return {
                "status": "success",
                "gemini": usage
            }
        else:
            return {
                "status": "error", 
                "message": live_data.get("message", "Probe failed"),
                "gemini": usage
            }
    except Exception as e:
        logger.error(f"Error in Gemini live sync: {e}")
        return {"status": "error", "message": str(e)}


async def _check_apify_tokens() -> list[dict]:
    """Check quota status for all configured Apify tokens."""
    tokens = _get_apify_tokens()
    results = []

    async with httpx.AsyncClient(timeout=10) as client:
        for i, token in enumerate(tokens):
            label = "Primary" if i == 0 else f"Fallback #{i}"
            headers = {"Authorization": f"Bearer {token}"}

            try:
                me_resp = await client.get(
                    "https://api.apify.com/v2/users/me", headers=headers
                )
                limits_resp = await client.get(
                    "https://api.apify.com/v2/users/me/limits", headers=headers
                )

                if me_resp.status_code == 200 and limits_resp.status_code == 200:
                    me_data = me_resp.json().get("data", {})
                    limits_data = limits_resp.json().get("data", {})

                    actors_enabled = (
                        me_data.get("effectivePlatformFeatures", {})
                        .get("ACTORS", {})
                        .get("isEnabled", True)
                    )

                    l_block = limits_data.get("limits", {})
                    c_block = limits_data.get("current", {})

                    max_usd = l_block.get("maxMonthlyUsageUsd", 0)
                    used_usd = c_block.get("monthlyUsageUsd", 0)
                    remaining_usd = max(0, max_usd - used_usd)

                    next_reset = (
                        limits_data.get("monthlyUsageCycle", {})
                        .get("endAt", None)
                    )

                    is_active = actors_enabled and (max_usd == 0 or remaining_usd > 0)

                    results.append({
                        "index": i,
                        "label": label,
                        "is_active": is_active,
                        "max_usd": max_usd,
                        "used_usd": round(used_usd, 4),
                        "remaining_usd": round(remaining_usd, 4),
                        "resets_at": next_reset,
                        "token_hint": f"...{token[-6:]}",
                    })
                else:
                    results.append({
                        "index": i,
                        "label": label,
                        "is_active": False,
                        "error": f"HTTP {me_resp.status_code}/{limits_resp.status_code}",
                        "token_hint": f"...{token[-6:]}",
                    })
            except Exception as e:
                results.append({
                    "index": i,
                    "label": label,
                    "is_active": False,
                    "error": str(e),
                    "token_hint": f"...{token[-6:]}",
                })

    return results


async def _check_supabase() -> dict:
    """Check Supabase database storage usage."""
    db_url = settings.DATABASE_URL
    if not db_url or "sqlite" in db_url:
        return {"configured": False, "note": "Using local SQLite"}

    try:
        import asyncpg

        url = db_url.replace("postgresql+asyncpg://", "postgresql://")
        conn = await asyncpg.connect(url, statement_cache_size=0)
        try:
            row = await conn.fetchrow(
                "SELECT pg_size_pretty(pg_database_size(current_database()));"
            )
            size_str = row[0] if row else "Unknown"
            return {
                "configured": True,
                "used": size_str,
                "limit": "500 MB",
            }
        finally:
            await conn.close()
    except Exception as e:
        return {"configured": True, "error": str(e)}


def _check_google() -> dict:
    """Return live Gemini usage and static Google info."""
    from app.services.gemini_tracker import get_gemini_usage
    live_usage = get_gemini_usage()
    
    return {
        "places": {
            "configured": bool(settings.GOOGLE_PLACES_API_KEY),
            "note": "$200/mo credit (~10,000 searches)",
            "console_url": "https://console.cloud.google.com/apis/api/places.googleapis.com/quotas",
        },
        "gemini": {
            "configured": bool(settings.GEMINI_API_KEY),
            "note": f"{live_usage['rpm']}/{live_usage['rpm_limit']} RPM used",
            "usage": live_usage,
            "console_url": "https://aistudio.google.com/app/plan_information",
        },
    }
