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
from app.services.yelp_tracker import record_yelp_request

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
    params: dict[str, Any] = {
        "term": name, 
        "limit": 5,
        "radius": 40000 # Max allowed by Yelp (approx 25 miles)
    }

    if location:
        params["location"] = location
    elif lat is not None and lng is not None:
        params["latitude"] = lat
        params["longitude"] = lng
    else:
        # Default to a generic location if nothing else is provided
        # This prevents the search from failing completely if the user just types a name
        logger.info("No location or coordinates provided, defaulting Yelp search to 'USA'")
        params["location"] = "USA"

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(f"{YELP_BASE}/businesses/search", headers=headers, params=params)
        record_yelp_request()
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
            "latitude": b.get("coordinates", {}).get("latitude"),
            "longitude": b.get("coordinates", {}).get("longitude"),
        }
        for b in data.get("businesses", [])
    ]


# ── Google Places API (New) ──────────────────────────────────────────────

GOOGLE_PLACES_BASE = "https://places.googleapis.com/v1"


async def google_search(
    name: str,
    location: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
) -> list[dict]:
    """Search Google Places for businesses matching a text query or coordinates."""
    if not settings.GOOGLE_PLACES_API_KEY:
        raise ValueError("GOOGLE_PLACES_API_KEY is not configured.")

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.googleMapsUri,places.location",
    }

    # Construct query
    query = name
    if location:
        query = f"{name} {location}"

    body: dict[str, Any] = {"textQuery": query}

    # Add location bias if coordinates are provided
    if lat is not None and lng is not None:
        # 50000 meter radius is the max for circle bias in Google Places API (~31 miles)
        body["locationBias"] = {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": 50000.0,
            }
        }

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
            "latitude": p.get("location", {}).get("latitude"),
            "longitude": p.get("location", {}).get("longitude"),
        }
        for p in data.get("places", [])
    ]


# ── Autocomplete APIs (Lightweight typeahead) ────────────────────────────

async def google_autocomplete(
    query: str,
    lat: float | None = None,
    lng: float | None = None,
) -> list[dict]:
    """Lightweight Google Places autocomplete — returns name suggestions only."""
    if not settings.GOOGLE_PLACES_API_KEY:
        return []

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.GOOGLE_PLACES_API_KEY,
    }

    body: dict[str, Any] = {
        "input": query,
        "includedPrimaryTypes": ["restaurant"],
    }

    if lat is not None and lng is not None:
        body["locationBias"] = {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": 50000.0,
            }
        }

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{GOOGLE_PLACES_BASE}/places:autocomplete",
            headers=headers,
            json=body,
        )
        resp.raise_for_status()
        data = resp.json()

    suggestions = []
    for s in data.get("suggestions", []):
        pred = s.get("placePrediction", {})
        if pred:
            text = pred.get("text", {}).get("text", "")
            secondary = pred.get("structuredFormat", {}).get("secondaryText", {}).get("text", "")
            suggestions.append({
                "name": pred.get("structuredFormat", {}).get("mainText", {}).get("text", text),
                "description": secondary,
                "source": "google",
            })
    return suggestions


async def yelp_autocomplete(
    query: str,
    lat: float | None = None,
    lng: float | None = None,
) -> list[dict]:
    """Lightweight Yelp autocomplete — returns business name suggestions."""
    if not settings.YELP_API_KEY:
        return []

    headers = {"Authorization": f"Bearer {settings.YELP_API_KEY}"}
    params: dict[str, Any] = {"text": query}

    if lat is not None and lng is not None:
        params["latitude"] = lat
        params["longitude"] = lng

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            f"{YELP_BASE}/autocomplete",
            headers=headers,
            params=params,
        )
        record_yelp_request()
        resp.raise_for_status()
        data = resp.json()

    suggestions = []
    for biz in data.get("businesses", []):
        suggestions.append({
            "name": biz.get("name", ""),
            "description": "",
            "source": "yelp",
        })
    # Skip generic Yelp term/keyword suggestions — only show real businesses
    return suggestions

