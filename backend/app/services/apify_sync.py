"""Apify-based review scraping for Google Maps and Yelp.

Uses Apify actors to fetch reviews without platform API limitations:
- Google: compass/google-maps-reviews-scraper (unlimited reviews, sorted by newest)
- Yelp:   yin/yelp-scraper (up to ~240 reviews, bypasses paywalled API)
"""

from __future__ import annotations

import logging
from datetime import datetime

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

APIFY_BASE = "https://api.apify.com/v2"


async def _run_apify_actor(actor_id: str, run_input: dict, timeout: int = 180) -> list[dict]:
    """
    Run an Apify actor synchronously and return dataset items.

    1. POST to start the actor run (waits up to `timeout` seconds for completion)
    2. GET the dataset items from the run's defaultDatasetId
    """
    if not settings.APIFY_API_TOKEN:
        raise ValueError("APIFY_API_TOKEN is not configured.")

    headers = {
        "Authorization": f"Bearer {settings.APIFY_API_TOKEN}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout + 30)) as client:
        # Start the actor run and wait for it to finish
        run_resp = await client.post(
            f"{APIFY_BASE}/acts/{actor_id}/runs",
            headers=headers,
            json=run_input,
            params={"waitForFinish": timeout},
        )
        run_resp.raise_for_status()
        run_data = run_resp.json().get("data", {})

        status = run_data.get("status")
        if status not in ("SUCCEEDED",):
            raise RuntimeError(
                f"Apify actor {actor_id} finished with status: {status}. "
                f"Status message: {run_data.get('statusMessage', 'N/A')}"
            )

        dataset_id = run_data.get("defaultDatasetId")
        if not dataset_id:
            raise RuntimeError("No dataset ID in Apify run response.")

        # Fetch the dataset items
        items_resp = await client.get(
            f"{APIFY_BASE}/datasets/{dataset_id}/items",
            headers=headers,
            params={"format": "json"},
        )
        items_resp.raise_for_status()
        return items_resp.json()


async def apify_google_reviews(place_id_or_url: str, max_reviews: int = 100000) -> list[dict]:
    """
    Fetch Google Maps reviews via Apify's Google Maps Reviews Scraper.
    Accepts either a Google Place ID (e.g. 'ChIJOfQAb0XJj4ARFG40QIgMJx4')
    or a full Google Maps URL.
    Returns normalized dicts ready for the existing ingestion pipeline.
    Setting max_reviews=100000 effectively removes the limit.
    """
    # Determine if input is a Place ID or URL
    if place_id_or_url.startswith("http"):
        run_input = {
            "startUrls": [{"url": place_id_or_url}],
            "maxReviews": max_reviews,
            "reviewsSort": "newest",
            "language": "en",
        }
    else:
        run_input = {
            "placeIds": [place_id_or_url],
            "maxReviews": max_reviews,
            "reviewsSort": "newest",
            "language": "en",
        }

    raw_items = await _run_apify_actor("compass~google-maps-reviews-scraper", run_input)
    logger.info(f"Apify Google: fetched {len(raw_items)} reviews for {place_id_or_url}")

    reviews = []
    for item in raw_items:
        # Include items without review text (ratings-only)
        text = item.get("text") or item.get("textTranslated") or "[Rating only]"

        # Parse publishedAtDate (ISO format from Apify)
        pub_date = item.get("publishedAtDate", "")
        time_str = pub_date[:19] if pub_date else datetime.utcnow().isoformat()[:19]

        review_id = item.get("reviewId", "")
        if not review_id:
            # Fallback: construct from reviewer + date
            reviewer_id = item.get("reviewerId", "unknown")
            review_id = f"apify-goog-{reviewer_id}-{time_str[:10]}"

        # Normalize ID by stripping common prefixes to avoid duplicates
        if "/" in review_id and "reviews/" in review_id:
            review_id = review_id.split("reviews/")[1]

        reviews.append({
            "review_id": review_id,
            "author_name": item.get("name", "Anonymous"),
            "author_email": None,
            "rating": float(item.get("stars") or item.get("rating") or 0),
            "text": text,
            "time": time_str,
        })

    return reviews


async def apify_yelp_reviews(yelp_url: str, max_reviews: int = 100000) -> list[dict]:
    """
    Fetch Yelp reviews via Apify's Yelp Review Scraper.
    Returns normalized dicts ready for the existing ingestion pipeline.
    """
    run_input = {
        "startUrls": [{"url": yelp_url}],
        "maxReviews": max_reviews,
    }

    raw_items = await _run_apify_actor("tri_angle~yelp-review-scraper", run_input)
    logger.info(f"Apify Yelp: fetched {len(raw_items)} reviews for {yelp_url}")

    reviews = []
    for item in raw_items:
        text = item.get("text") or item.get("reviewText") or ""
        if not text:
            continue

        # Parser already handles ISO dates which this actor returns
        raw_date = item.get("date") or ""
        date_str = _parse_yelp_date(raw_date)

        # Use the provided ID
        review_id = item.get("id") or item.get("reviewId") or ""
        if not review_id:
            user_name = item.get("reviewerName") or item.get("userName") or "unknown"
            review_id = f"apify-yelp-{user_name}-{date_str[:10]}"

        reviews.append({
            "review_id": review_id,
            "guest_name": item.get("reviewerName") or item.get("userName") or "Anonymous",
            "guest_email": None,
            "rating": float(item.get("rating") or 0),
            "text": text,
            "date": date_str,
        })

    return reviews


def _parse_yelp_date(raw: str) -> str:
    """Normalize various Yelp date formats to ISO date string."""
    if not raw:
        return datetime.utcnow().strftime("%Y-%m-%d")

    # Already ISO-ish
    if raw[:4].isdigit() and "-" in raw:
        return raw[:10]

    # US format like "2/28/2026"
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%b %d, %Y"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue

    return raw[:10]
