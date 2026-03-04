"""Review Sync Service — Fetch reviews from Yelp Fusion and Google Places APIs.

Provides methods to:
1. Search for a business by name + location
2. Fetch reviews for a specific business
3. Normalize data into SavorIQ ingestion format
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# ── Yelp Fusion API ──────────────────────────────────────────────────────

YELP_BASE = "https://api.yelp.com/v3"


async def yelp_search(
    name: str,
    location: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
) -> list[dict]:
    """Search Yelp for businesses matching name + location or coordinates."""
    if not settings.YELP_API_KEY:
        raise ValueError("YELP_API_KEY is not configured.")

    headers = {"Authorization": f"Bearer {settings.YELP_API_KEY}"}
    params: dict[str, Any] = {"term": name, "limit": 5}

    if location:
        params["location"] = location
    elif lat is not None and lng is not None:
        params["latitude"] = lat
        params["longitude"] = lng
    else:
        raise ValueError("Either location or lat/lng must be provided for search.")

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(f"{YELP_BASE}/businesses/search", headers=headers, params=params)
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 400:
                raise ValueError("Invalid location. Please provide a more specific city, address, or zip code.") from e
            raise
        data = resp.json()

    return [
        {
            "id": b["id"],
            "name": b["name"],
            "address": ", ".join(b["location"].get("display_address", [])),
            "rating": b.get("rating", 0),
            "review_count": b.get("review_count", 0),
            "url": b.get("url"),
        }
        for b in data.get("businesses", [])
    ]


# ── Google Places API (New) ──────────────────────────────────────────────

GOOGLE_PLACES_BASE = "https://places.googleapis.com/v1"


async def google_search(name: str, location: str) -> list[dict]:
    """Search Google Places for businesses matching a text query."""
    if not settings.GOOGLE_PLACES_API_KEY:
        raise ValueError("GOOGLE_PLACES_API_KEY is not configured.")

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.googleMapsUri",
    }
    body = {"textQuery": f"{name} {location}"}

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{GOOGLE_PLACES_BASE}/places:searchText",
            headers=headers,
            json=body,
        )
        resp.raise_for_status()
        data = resp.json()

    return [
        {
            "id": p["id"],
            "name": p.get("displayName", {}).get("text", "Unknown"),
            "address": p.get("formattedAddress", ""),
            "rating": p.get("rating", 0),
            "review_count": p.get("userRatingCount", 0),
            "place_url": p.get("googleMapsUri"),
        }
        for p in data.get("places", [])
    ]
