"""Unified sync engine — single source of truth for scrape → ingest → sentiment → save.

Both the `reset-and-sync` and `apify-reviews` endpoints call into this module
instead of duplicating the pipeline logic.
"""

from __future__ import annotations

import asyncio
import logging
import time as _time
from datetime import datetime

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Review, SyncLog, MenuItem, SentimentScore
from app.schemas import ReviewPlatform
from app.services.apify_sync import apify_google_reviews, apify_yelp_reviews
from app.services.ingestion import ingest_reviews
from app.services.sentiment import analyze_batch_no_db
from app.services.cache import api_cache
from app.services.discovery import discover_menu_items
from app.services.sync_progress import sync_manager

logger = logging.getLogger(__name__)


async def execute_platform_sync(
    db: AsyncSession,
    restaurant_id: str,
    platform: str,
    business_url: str,
    business_name: str,
    max_reviews: int,
    is_full_sync: bool,
) -> dict:
    """Run the full sync pipeline for one platform (google or yelp).

    Steps:
        1. Scrape reviews via Apify
        2. Ingest into the database (dedup + upsert)
        3. Sentiment analysis on new reviews (skip already-analyzed)
        4. Update SyncLog
        5. Auto-discover menu items (first sync only)
        6. Invalidate API cache

    Returns a dict with platform, status, new_ingested, and reviews_fetched.
    """
    try:
        # ── 1. Scrape reviews ──
        sync_manager.update_progress(
            restaurant_id, 10, "Scraping reviews...", platform=platform
        )

        def _scrape_progress(pct, status):
            sync_manager.update_progress(restaurant_id, pct, status, platform=platform)

        if platform == "google":
            raw_reviews = await apify_google_reviews(
                business_url, max_reviews, progress_callback=_scrape_progress
            )
        else:
            raw_reviews = await apify_yelp_reviews(
                business_url, max_reviews, progress_callback=_scrape_progress
            )

        # ── 2. Ingest ──
        sync_manager.update_progress(
            restaurant_id, 40, f"Ingesting {len(raw_reviews)} reviews...", platform=platform
        )

        def _ingest_progress(done, total):
            pct = 35 + int(5 * (done / total)) if total else 35
            sync_manager.update_progress(
                restaurant_id, pct, f"Ingesting review {done}/{total}...",
                processed_count=done, total_count=total, platform=platform,
            )

        report = await ingest_reviews(
            db, restaurant_id, ReviewPlatform(platform), raw_reviews,
            full_sync=is_full_sync, stop_on_match=not is_full_sync,
            progress_callback=_ingest_progress,
        )

        # ── 3. Sentiment analysis (skip already-analyzed, parallel Gemini) ──
        if report.ingested > 0:
            res = await db.execute(
                select(Review)
                .where(Review.restaurant_id == restaurant_id, Review.platform == platform)
                .order_by(Review.ingested_at.desc())
                .limit(report.ingested)
            )
            new_reviews = res.scalars().all()

            # Skip reviews that already have sentiment scores
            already_analyzed = set(
                (await db.execute(
                    select(SentimentScore.review_id).where(
                        SentimentScore.review_id.in_([r.id for r in new_reviews])
                    )
                )).scalars().all()
            )
            reviews_to_analyze = [
                {"id": r.id, "text": r.content}
                for r in new_reviews if r.id not in already_analyzed
            ]

            total_to_analyze = len(reviews_to_analyze)
            if total_to_analyze > 0:
                batch_size = 200
                concurrent = 3
                batch_start = _time.monotonic()

                sync_manager.update_progress(
                    restaurant_id, 40, f"Analyzing sentiment... (0/{total_to_analyze})",
                    processed_count=0, total_count=total_to_analyze, platform=platform,
                )

                # Split into batches, run 3 at a time
                batches = [
                    reviews_to_analyze[i:i + batch_size]
                    for i in range(0, total_to_analyze, batch_size)
                ]
                all_results = {}
                for chunk_start in range(0, len(batches), concurrent):
                    chunk = batches[chunk_start:chunk_start + concurrent]
                    results = await asyncio.gather(
                        *[analyze_batch_no_db(b) for b in chunk]
                    )
                    for r in results:
                        all_results.update(r)

                    done = min((chunk_start + len(chunk)) * batch_size, total_to_analyze)
                    pct = 40 + int(45 * (done / total_to_analyze))
                    elapsed = _time.monotonic() - batch_start
                    rate = done / elapsed if elapsed > 0 else 0
                    eta = int((total_to_analyze - done) / rate) if rate > 0 else None
                    sync_manager.update_progress(
                        restaurant_id, pct,
                        f"Analyzing sentiment... ({done}/{total_to_analyze})",
                        processed_count=done, total_count=total_to_analyze,
                        est_remaining=eta, platform=platform,
                    )

                # Write all sentiment results to DB
                sync_manager.update_progress(
                    restaurant_id, 88, "Saving sentiment scores...", platform=platform
                )
                for r_id, sentiments in all_results.items():
                    for item in sentiments:
                        db.add(SentimentScore(
                            review_id=r_id,
                            bucket=item["bucket"],
                            score=float(item.get("score", 0.0)),
                            summary=item.get("summary", ""),
                            analyzed_at=datetime.utcnow(),
                        ))
                await db.flush()
            else:
                logger.info(
                    f"All {len(new_reviews)} reviews already analyzed — skipping sentiment"
                )

        # ── 4. Update SyncLog ──
        sync_log = (await db.execute(
            select(SyncLog).where(
                SyncLog.platform == platform, SyncLog.business_id == business_url
            )
        )).scalar_one_or_none()

        if not sync_log:
            sync_log = SyncLog(
                restaurant_id=restaurant_id,
                platform=platform,
                business_id=business_url,
                business_name=business_name,
            )
            db.add(sync_log)

        sync_log.last_synced_at = datetime.utcnow()
        sync_log.reviews_fetched = len(raw_reviews)
        sync_log.new_reviews = report.ingested

        # ── 5. Auto-discover menu items (first sync only) ──
        m_count = (await db.execute(
            select(func.count(MenuItem.id)).where(
                MenuItem.restaurant_id == restaurant_id
            )
        )).scalar() or 0

        if m_count == 0 and report.ingested > 0:
            sync_manager.update_progress(
                restaurant_id, 95, "Discovering menu items...", platform=platform
            )
            try:
                review_rows = (await db.execute(
                    select(Review.content)
                    .where(Review.restaurant_id == restaurant_id)
                    .order_by(Review.reviewed_at.desc())
                    .limit(50)
                )).scalars().all()

                discovered = await discover_menu_items(list(review_rows))
                for item in discovered:
                    db.add(MenuItem(
                        restaurant_id=restaurant_id,
                        name=item.get("name", "Unknown"),
                        category=item.get("category", "food"),
                        keywords=item.get("keywords", ""),
                    ))
                if discovered:
                    logger.info(
                        f"Menu discovery: saved {len(discovered)} items for {restaurant_id}"
                    )
            except Exception as e:
                logger.warning(f"Menu discovery failed: {e}")

        # ── 6. Commit + invalidate cache ──
        await db.commit()
        api_cache.invalidate(restaurant_id)
        sync_manager.finish_platform(
            restaurant_id, platform, new_ingested=report.ingested
        )

        logger.info(
            f"Sync complete for {restaurant_id} ({platform}): "
            f"{report.ingested} new, {len(raw_reviews)} fetched"
        )
        return {
            "platform": platform,
            "status": "success",
            "new_ingested": report.ingested,
            "reviews_fetched": len(raw_reviews),
        }

    except Exception as e:
        logger.error(f"Sync failed for {platform}: {e}", exc_info=True)
        sync_manager.finish_sync(
            restaurant_id, status=f"❌ Sync error: {str(e)[:50]}"
        )
        return {
            "platform": platform,
            "status": "error",
            "message": str(e),
            "new_ingested": 0,
        }
