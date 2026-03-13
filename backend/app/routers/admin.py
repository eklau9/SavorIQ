"""Admin API endpoints for system monitoring and diagnostics.

These endpoints power the Admin Sidecar Dashboard and are not
intended for the customer-facing application.
"""

from __future__ import annotations

import logging
import os

import httpx
from fastapi import APIRouter

from app.config import settings
from app.services.apify_sync import _get_apify_tokens

router = APIRouter(prefix="/api/admin", tags=["admin"])
logger = logging.getLogger(__name__)


@router.get("/quotas")
async def get_quotas():
    """
    Return live API quota data for all external services.

    Used by the Admin Sidecar Dashboard to render quota gauges.
    """
    apify_tokens = await _check_apify_tokens()
    yelp = await _check_yelp()
    supabase = await _check_supabase()
    google = _check_google()

    return {
        "apify": apify_tokens,
        "yelp": yelp,
        "supabase": supabase,
        "google": google,
    }


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


async def _check_yelp() -> dict:
    """Check Yelp Fusion API daily quota."""
    if not settings.YELP_API_KEY:
        return {"configured": False}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://api.yelp.com/v3/businesses/search?location=San+Jose&limit=1",
                headers={
                    "Authorization": f"Bearer {settings.YELP_API_KEY}",
                    "Accept": "application/json",
                },
            )
            return {
                "configured": True,
                "daily_limit": resp.headers.get("ratelimit-limit", "Unknown"),
                "remaining": resp.headers.get("ratelimit-remaining", "Unknown"),
                "resets_at": resp.headers.get("ratelimit-resettime", "Unknown"),
            }
    except Exception as e:
        return {"configured": True, "error": str(e)}


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
    """Return static Google API info (no live quota API available)."""
    return {
        "places": {
            "configured": bool(settings.GOOGLE_PLACES_API_KEY),
            "note": "$200/mo credit (~10,000 searches)",
            "console_url": "https://console.cloud.google.com/apis/api/places.googleapis.com/quotas",
        },
        "gemini": {
            "configured": bool(settings.GEMINI_API_KEY),
            "note": "15 RPM, 1,500 RPD (Free Tier)",
            "console_url": "https://aistudio.google.com/app/plan_information",
        },
    }
