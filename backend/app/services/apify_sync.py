"""Apify-based review scraping for Google Maps and Yelp.

Uses Apify actors to fetch reviews without platform API limitations:
- Google: compass/google-maps-reviews-scraper (unlimited reviews, sorted by newest)
- Yelp:   yin/yelp-scraper (up to ~240 reviews, bypasses paywalled API)
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

APIFY_BASE = "https://api.apify.com/v2"

# In-memory cache for tokens that returned 403 — skip them for 24 hours
_dead_tokens: dict[str, float] = {}  # token -> timestamp when marked dead
_DEAD_TOKEN_TTL = 86400  # 24 hours


def _get_apify_tokens() -> list[str]:
    """Build ordered list of Apify tokens: primary first, then fallbacks 1-N from env."""
    import os, time
    tokens = []
    if settings.APIFY_API_TOKEN:
        tokens.append(settings.APIFY_API_TOKEN)
    
    # Check fallback tokens 1 to N until we don't find any more
    i = 1
    while True:
        # Check both Settings and os.environ directly to handle unlimited tokens
        t = getattr(settings, f"APIFY_FALLBACK_TOKEN_{i}", None)
        if not t:
            t = os.environ.get(f"APIFY_FALLBACK_TOKEN_{i}")
            
        if t:
            t = t.strip()
            if t and t not in tokens:
                tokens.append(t)
            i += 1
        else:
            # If token N is missing, try one more just in case of a gap
            if not os.environ.get(f"APIFY_FALLBACK_TOKEN_{i+1}"):
                break
            i += 1

    # Filter out recently-dead tokens
    now = time.time()
    alive = [t for t in tokens if now - _dead_tokens.get(t, 0) > _DEAD_TOKEN_TTL]
    if not alive and tokens:
        # All dead — clear cache and retry all (they may have recovered)
        _dead_tokens.clear()
        return tokens
    return alive


async def _run_apify_actor(
    actor_id: str,
    run_input: dict,
    timeout: int = 120,
    progress_callback=None,
) -> list[dict]:
    """
    Run an Apify actor synchronously and return dataset items.

    Tries each configured token in order (primary → fallbacks).
    Falls through to the next token on 402 (Payment Required) or
    429 (Too Many Requests) quota errors.
    """
    import time as _time
    tokens = _get_apify_tokens()
    if not tokens:
        raise ValueError("No Apify tokens configured. Set APIFY_API_TOKEN or APIFY_FALLBACK_TOKENS.")

    last_error: Exception | None = None

    for i, token in enumerate(tokens, 1):
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        label = f"token #{i}/{len(tokens)} (...{token[-6:]})"

        async with httpx.AsyncClient(timeout=httpx.Timeout(300)) as client:
            # Start the actor run WITHOUT waiting (fire and poll)
            try:
                run_resp = await client.post(
                    f"{APIFY_BASE}/acts/{actor_id}/runs",
                    headers=headers,
                    json=run_input,
                    params={"waitForFinish": 0},  # Don't wait — return immediately
                )
            except httpx.HTTPError as exc:
                last_error = exc
                logger.warning(f"Apify {label}: network error — {exc}")
                continue

            # Quota exhausted or access denied → mark dead and try next token
            if run_resp.status_code in (402, 403, 429):
                _dead_tokens[token] = _time.time()
                last_error = RuntimeError(
                    f"Apify {label}: unavailable (HTTP {run_resp.status_code})"
                )
                logger.warning(str(last_error))
                continue

            run_resp.raise_for_status()
            run_data = run_resp.json().get("data", {})
            run_id = run_data.get("id")
            status = run_data.get("status")

            # Poll every 5 seconds until done (max ~3 minutes)
            max_polls = 36  # 36 * 5s = 180s max
            poll_count = 0
            while status in ("READY", "RUNNING") and poll_count < max_polls:
                poll_count += 1

                # Report progress while waiting
                if progress_callback:
                    pct = min(10 + poll_count, 35)  # Gradual 10% → 35%
                    elapsed = poll_count * 5
                    progress_callback(pct, f"Scraping reviews... ({elapsed}s elapsed)")

                await asyncio.sleep(2.0 if poll_count <= 5 else 4.0)

                poll_resp = await client.get(f"{APIFY_BASE}/actor-runs/{run_id}", headers=headers)
                poll_resp.raise_for_status()
                run_data = poll_resp.json().get("data", {})
                status = run_data.get("status")

            if status not in ("SUCCEEDED",):
                raise RuntimeError(
                    f"Apify actor {actor_id} run {run_id} finished with status: {status}. "
                    f"Status message: {run_data.get('statusMessage', 'N/A')}"
                )

            if progress_callback:
                progress_callback(38, "Downloading scraped data...")

            dataset_id = run_data.get("defaultDatasetId")
            if not dataset_id:
                raise RuntimeError("No dataset ID in Apify run response.")

            logger.info(f"Apify {label}: actor run {run_id} succeeded, fetching dataset {dataset_id}")

            # Fetch the dataset items (same token that started the run)
            items_resp = await client.get(
                f"{APIFY_BASE}/datasets/{dataset_id}/items",
                headers=headers,
                params={"format": "json"},
            )
            items_resp.raise_for_status()
            return items_resp.json()

    # All tokens exhausted
    raise RuntimeError(
        f"All {len(tokens)} Apify token(s) exhausted or failed. Last error: {last_error}"
    )


async def apify_google_reviews(place_id_or_url: str, max_reviews: int = 100000, progress_callback=None) -> list[dict]:
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
        }
    else:
        run_input = {
            "placeIds": [place_id_or_url],
            "maxReviews": max_reviews,
            "reviewsSort": "newest",
        }

    raw_items = await _run_apify_actor("compass~google-maps-reviews-scraper", run_input, progress_callback=progress_callback)
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


async def apify_yelp_reviews(yelp_url: str, max_reviews: int = 100000, progress_callback=None) -> list[dict]:
    """
    Fetch Yelp reviews via Apify's Yelp Review Scraper.
    Returns normalized dicts ready for the existing ingestion pipeline.
    """
    # Strip query params (Yelp Fusion API appends tracking params that confuse the scraper)
    from urllib.parse import urlparse, urlunparse
    parsed = urlparse(yelp_url)
    clean_url = urlunparse((parsed.scheme, parsed.netloc, parsed.path, '', '', ''))
    
    run_input = {
        "startUrls": [{"url": clean_url}],
        "maxReviews": max_reviews,
    }

    # NOTE: yin~yelp-scraper is broken (CheerioCrawler silently drops startUrls, returns 0 reviews).
    # tri_angle~yelp-review-scraper (151K+ runs) reliably scrapes Yelp reviews.
    raw_items = await _run_apify_actor("tri_angle~yelp-review-scraper", run_input, progress_callback=progress_callback)
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
