"""Analytics endpoints — aggregate stats across all guests."""

from __future__ import annotations
import re

import sqlalchemy
from fastapi import APIRouter, Depends, Header, Query
from typing import Optional
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import BriefingCache, Guest, MenuItem, Order, Review, SentimentScore, SyncLog
from app.schemas import (
    BucketSentiment,
    BucketHighlight,
    CategoryRevenue,
    DeepAnalytics,
    GuestTierCount,
    ItemPerformance,
    OperationsAnalytics,
    OverviewStats,
    SentimentAnalytics,
    SentimentTrendPoint,
    UnmatchedMention,
    ManagerBriefing,
)
from app.services.insights import generate_manager_briefing
from app.services.cache import api_cache

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/overview", response_model=OverviewStats)
async def get_overview(
    days: Optional[int] = Query(None),
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db)
):
    """Aggregate statistics across all guests, orders, and reviews, scoped to restaurant."""
    suffix = f"days_{days}" if days else ""
    cached = api_cache.get(x_restaurant_id, "overview", suffix=suffix)
    if cached is not None:
        return cached

    from datetime import datetime, timedelta
    cutoff = datetime.utcnow() - timedelta(days=days) if days else None

    # 1. Active Guests (Guests with at least one non-deleted review)
    active_guests_stmt = (
        select(func.count(func.distinct(Review.guest_id)))
        .where(Review.restaurant_id == x_restaurant_id, Review.is_deleted_on_platform == False)
    )
    if cutoff:
        active_guests_stmt = active_guests_stmt.where(Review.reviewed_at >= cutoff)
    
    guests_count = (await db.execute(active_guests_stmt)).scalar() or 0
    
    # 2. Review Counts (Local Processed vs. Platform Ground Truth)
    processed_reviews_stmt = (
        select(func.count(Review.id))
        .where(Review.restaurant_id == x_restaurant_id, Review.is_deleted_on_platform == False)
    )
    if cutoff:
        processed_reviews_stmt = processed_reviews_stmt.where(Review.reviewed_at >= cutoff)
        
    processed_reviews_count = (await db.execute(processed_reviews_stmt)).scalar() or 0
    
    # Fetch Ground Truth from SyncLogs (latest per platform only, avoid duplicates)
    from sqlalchemy import distinct
    latest_sync_subq = (
        select(
            SyncLog.platform,
            func.max(SyncLog.last_synced_at).label("latest_sync")
        )
        .where(SyncLog.restaurant_id == x_restaurant_id)
        .group_by(SyncLog.platform)
        .subquery()
    )
    sync_logs_result = await db.execute(
        select(func.sum(SyncLog.platform_total_count))
        .join(
            latest_sync_subq,
            (SyncLog.platform == latest_sync_subq.c.platform) &
            (SyncLog.last_synced_at == latest_sync_subq.c.latest_sync)
        )
        .where(SyncLog.restaurant_id == x_restaurant_id)
    )
    external_reviews_count = sync_logs_result.scalar()
    
    # Use EXTERNAL count as the primary "ALL" headline, but NEVER show less than our actual DB count
    if days:
        reviews_count = processed_reviews_count
    else:
        if external_reviews_count and external_reviews_count >= processed_reviews_count:
            reviews_count = external_reviews_count
        else:
            reviews_count = processed_reviews_count
    
    avg_rating_stmt = select(func.avg(Review.rating)).where(Review.restaurant_id == x_restaurant_id, Review.is_deleted_on_platform == False)
    if cutoff:
        avg_rating_stmt = avg_rating_stmt.where(Review.reviewed_at >= cutoff)
        
    avg_rating = (await db.execute(avg_rating_stmt)).scalar() or 0.0
    
    print(f"DEBUG OVERVIEW: restaurant={x_restaurant_id}, guests={guests_count}, reviews={reviews_count} (processed={processed_reviews_count})")

    # Sentiment by bucket
    bucket_stmt = (
        select(
            SentimentScore.bucket,
            func.avg(SentimentScore.score).label("avg_score"),
            func.count(SentimentScore.id).label("review_count"),
        )
        .join(Review, SentimentScore.review_id == Review.id)
        .where(Review.restaurant_id == x_restaurant_id, Review.is_deleted_on_platform == False)
        .group_by(SentimentScore.bucket)
    )
    if cutoff:
        bucket_stmt = bucket_stmt.where(Review.reviewed_at >= cutoff)
        
    bucket_rows = (await db.execute(bucket_stmt)).all()

    sentiment_by_bucket = [
        BucketSentiment(
            bucket=row.bucket,
            avg_score=round(float(row.avg_score), 2),
            review_count=row.review_count,
        )
        for row in bucket_rows
    ]

    result = OverviewStats(
        total_guests=guests_count,
        total_orders=0, # Deprecated
        total_reviews=reviews_count,
        avg_rating=round(float(avg_rating), 2),
        sentiment_by_bucket=sentiment_by_bucket,
    )
    api_cache.set(x_restaurant_id, "overview", result, suffix=suffix)
    return result


@router.get("/deep", response_model=DeepAnalytics)
async def get_deep_analytics(
    days: Optional[int] = Query(None),
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db)
):
    """Provide deep insights scoped to restaurant, using review mentions as performance proxy if orders are missing."""
    suffix = f"days_{days}" if days else ""
    cached = api_cache.get(x_restaurant_id, "deep_analytics", suffix=suffix)
    if cached is not None:
        return cached

    from datetime import datetime, timedelta
    cutoff = datetime.utcnow() - timedelta(days=days) if days else None

    overview = await get_overview(days, x_restaurant_id, db)

    # 1. Fetch reviews for this restaurant with sentiment
    reviews_stmt = (
        select(Review)
        .where(Review.restaurant_id == x_restaurant_id, Review.is_deleted_on_platform == False)
        .options(
            sqlalchemy.orm.selectinload(Review.sentiment_scores)
        )
    )
    if cutoff:
        reviews_stmt = reviews_stmt.where(Review.reviewed_at >= cutoff)
        
    reviews = (await db.execute(reviews_stmt)).scalars().all()

    # 2. Load active menu items from DB (replaces hardcoded list)
    menu_items_rows = (
        await db.execute(
            select(MenuItem)
            .where(MenuItem.restaurant_id == x_restaurant_id, MenuItem.is_active == True)
        )
    ).scalars().all()

    # Convert DB rows to the dict format used by scan_mentions
    menu_items = [
        {
            "name": mi.name,
            "category": mi.category,
            "keywords": [kw.strip().lower() for kw in mi.keywords.split(",") if kw.strip()],
        }
        for mi in menu_items_rows
    ]

    # Pre-compute lowercased content for all reviews to avoid redundant .lower() calls
    review_data = [
        {"original": r, "content_lower": r.content.lower()} 
        for r in reviews
    ]

    def scan_mentions(items, pool_filter=None):
        """Count how many reviews mention each menu item (via keyword aliases)."""
        results = []
        # Filter the pre-computed review pool once
        pool = [rd for rd in review_data if pool_filter(rd["original"])] if pool_filter else review_data
        
        for item in items:
            mention_count = 0
            keywords = item["keywords"]
            for rd in pool:
                if any(kw in rd["content_lower"] for kw in keywords):
                    mention_count += 1

            if mention_count >= 1: # Lower threshold to 1 for better visibility on smaller datasets
                results.append(
                    ItemPerformance(
                        item_name=item["name"],
                        category=item["category"],
                        avg_sentiment=None,
                        review_count=mention_count,
                    )
                )
        results.sort(key=lambda x: x.review_count, reverse=True)
        return results[:5]

    # Top Performers: most mentioned in 4-5★ reviews
    top_performers = scan_mentions(menu_items, lambda r: r.rating >= 4)

    # At-Risk: most mentioned in 1-3★ reviews
    risks = scan_mentions(menu_items, lambda r: r.rating <= 3)

    # 4. Extract unmatched mentions — food/drink terms NOT on the menu
    # Common food/drink terms to look for in reviews
    FOOD_DRINK_TERMS = [
        "coffee", "espresso", "latte", "cappuccino", "americano", "mocha",
        "tea", "fruit tea", "matcha", "boba", "milk tea", "smoothie", "juice", "soda", "water",
        "cake", "cookie", "croissant", "sandwich", "salad", "pasta",
        "burger", "pizza", "sushi", "ramen", "noodles", "rice",
        "chicken", "steak", "fish", "shrimp", "tofu", "dumpling",
        "ice cream", "gelato", "yogurt", "waffle", "pancake",
        "taro", "ube", "mango", "strawberry", "peach", "lychee",
        "tapioca", "pudding", "cream puff", "macaron",
    ]
    
    # Flatten all menu keywords for the unmatched scan
    all_menu_keywords = set()
    for item in menu_items:
        for kw in item["keywords"]:
            all_menu_keywords.add(kw)

    unmatched_counts: dict[str, int] = {}
    unmatched_ratings: dict[str, list[float]] = {}
    
    # Pre-compile word-boundary patterns
    # We only scan terms NOT already on the menu
    active_terms = [t for t in FOOD_DRINK_TERMS if t not in all_menu_keywords]
    term_patterns = {term: re.compile(r'\b' + re.escape(term) + r'\b', re.IGNORECASE) for term in active_terms}
    
    for rd in review_data:
        content_lower = rd["content_lower"]
        r = rd["original"]
        for term, pattern in term_patterns.items():
            if pattern.search(content_lower):
                unmatched_counts[term] = unmatched_counts.get(term, 0) + 1
                unmatched_ratings.setdefault(term, []).append(float(r.rating))

    all_feedback_texts = [rd["content_lower"] for rd in review_data]

    # Only show terms mentioned 2+ times, sorted by count
    unmatched_mentions = [
        UnmatchedMention(
            term=term.title(),
            mention_count=count,
            avg_rating=round(sum(unmatched_ratings[term]) / len(unmatched_ratings[term]), 1),
        )
        for term, count in sorted(unmatched_counts.items(), key=lambda x: x[1], reverse=True)
        if count >= 2
    ][:10] # Take more for possible promotion

    # 5. Self-Healing Promotion: If menu is empty, show unmatched terms as "suggested" performers
    if not top_performers and unmatched_mentions:
        # Sort unmatched by rating DESC for top performers
        top_from_unmatched = sorted(unmatched_mentions, key=lambda x: x.avg_rating or 0, reverse=True)
        top_performers = [
            ItemPerformance(
                item_name=m.term,
                category="food", # Default assumption
                avg_sentiment=None,
                review_count=m.mention_count,
                is_suggested=True
            )
            for m in top_from_unmatched[:5]
            if (m.avg_rating or 0) >= 4.0
        ]

    if not risks and unmatched_mentions:
        # Sort unmatched by rating ASC for risks
        risks_from_unmatched = sorted(unmatched_mentions, key=lambda x: x.avg_rating or 5, reverse=False)
        risks = [
            ItemPerformance(
                item_name=m.term,
                category="food",
                avg_sentiment=None,
                review_count=m.mention_count,
                is_suggested=True
            )
            for m in risks_from_unmatched[:5]
            if (m.avg_rating or 5) <= 3.5
        ]

    # 6. Try to get AI briefing from cache only (don't block for generation)
    # We use a non-blocking check or just return None and let the separate endpoint handle it
    briefing = None
    # For now, we'll let the separate /briefing endpoint handle this to keep the main dashboard fast

    result = DeepAnalytics(
        overview=overview,
        top_performers=top_performers,
        risks=risks,
        unmatched_mentions=unmatched_mentions[:5], # Return only top 5 back to client
        briefing=None # Always fetch separately for speed
    )
    api_cache.set(x_restaurant_id, "deep_analytics", result, suffix=suffix)
    return result


@router.get("/sentiment", response_model=SentimentAnalytics)
async def get_sentiment_analytics(
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db)
):
    """Sentiment breakdown: per-bucket averages, monthly trend, highlights, scoped to restaurant."""

    # 1. Per-bucket averages
    bucket_rows = (
        await db.execute(
            select(
                SentimentScore.bucket,
                func.avg(SentimentScore.score).label("avg_score"),
                func.count(SentimentScore.id).label("review_count"),
            )
            .join(Review, SentimentScore.review_id == Review.id)
            .where(Review.restaurant_id == x_restaurant_id, Review.is_deleted_on_platform == False)
            .group_by(SentimentScore.bucket)
        )
    ).all()

    buckets = [
        BucketSentiment(
            bucket=row.bucket,
            avg_score=round(float(row.avg_score), 2),
            review_count=row.review_count,
        )
        for row in bucket_rows
    ]

    # 2. Monthly trend — group by month + bucket
    trend_query = (
        await db.execute(
            select(
                func.to_char(SentimentScore.analyzed_at, "YYYY-MM").label("month"),
                SentimentScore.bucket,
                func.avg(SentimentScore.score).label("avg_score"),
            )
            .join(Review, SentimentScore.review_id == Review.id)
            .where(Review.restaurant_id == x_restaurant_id, Review.is_deleted_on_platform == False)
            .group_by("month", SentimentScore.bucket)
            .order_by("month")
        )
    ).all()

    # Pivot into trend points
    months_map: dict[str, dict] = {}
    for row in trend_query:
        month = row.month
        if month not in months_map:
            months_map[month] = {"month": month}
        months_map[month][f"{row.bucket}_avg"] = round(float(row.avg_score), 2)

    trend = [SentimentTrendPoint(**data) for data in months_map.values()]

    # 3. Highlights — best/worst review per bucket
    all_scores = (
        await db.execute(
            select(SentimentScore, Review.content)
            .join(Review, SentimentScore.review_id == Review.id)
            .where(Review.restaurant_id == x_restaurant_id, Review.is_deleted_on_platform == False)
        )
    ).all()

    bucket_highlights: dict[str, dict] = {}
    for score_obj, content in all_scores:
        b = score_obj.bucket
        if b not in bucket_highlights:
            bucket_highlights[b] = {
                "bucket": b,
                "best_snippet": None, "best_score": None,
                "worst_snippet": None, "worst_score": None,
            }
        snippet = content[:120] + ("…" if len(content) > 120 else "")
        if bucket_highlights[b]["best_score"] is None or score_obj.score > bucket_highlights[b]["best_score"]:
            bucket_highlights[b]["best_score"] = round(score_obj.score, 2)
            bucket_highlights[b]["best_snippet"] = snippet
        if bucket_highlights[b]["worst_score"] is None or score_obj.score < bucket_highlights[b]["worst_score"]:
            bucket_highlights[b]["worst_score"] = round(score_obj.score, 2)
            bucket_highlights[b]["worst_snippet"] = snippet

    highlights = [BucketHighlight(**data) for data in bucket_highlights.values()]

    return SentimentAnalytics(buckets=buckets, trend=trend, highlights=highlights)


@router.get("/briefing", response_model=ManagerBriefing)
async def get_manager_briefing_handler(
    days: Optional[int] = Query(None),
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db)
):
    """Generate a strategic AI briefing for the manager.
    
    For days <= 180 (6MO): sends ALL reviews in range to Gemini with index citation.
    For days > 180 or None (ALL): reuses the 6MO briefing (no extra Gemini call).
    """
    # For 1Y and ALL: reuse the 6MO briefing to save tokens
    if days is None or days > 180:
        suffix_6mo = "days_180"
        cached_6mo = api_cache.get(x_restaurant_id, "manager_briefing", suffix=suffix_6mo)
        if cached_6mo is not None:
            return cached_6mo
        # If 6MO briefing not cached yet, generate it
        return await _generate_briefing_for_days(180, x_restaurant_id, db)
    
    suffix = f"days_{days}" if days else ""
    cached = api_cache.get(x_restaurant_id, "manager_briefing", suffix=suffix)
    if cached is not None:
        return cached
    
    return await _generate_briefing_for_days(days, x_restaurant_id, db)


async def _generate_briefing_for_days(
    days: int,
    x_restaurant_id: str,
    db: AsyncSession,
    auto_generate: bool = False,
) -> ManagerBriefing:
    """Internal: generate briefing for a specific day range.
    
    Cache priority: in-memory → DB → Gemini API.
    DB cache survives server restarts. Invalidated when review count changes.
    """
    import json as _json
    import logging as _logging
    _log = _logging.getLogger(__name__)

    suffix = f"days_{days}"
    # 1. In-memory cache (fastest)
    cached = api_cache.get(x_restaurant_id, "manager_briefing", suffix=suffix)
    if cached is not None:
        return cached

    from datetime import datetime, timedelta
    cutoff = datetime.utcnow() - timedelta(days=days)

    # Count reviews for this range (cheap SQL, used for cache invalidation)
    review_count = (
        await db.execute(
            select(func.count(Review.id))
            .where(
                Review.restaurant_id == x_restaurant_id,
                Review.is_deleted_on_platform == False,
                Review.reviewed_at >= cutoff,
            )
        )
    ).scalar() or 0

    # 2. DB persistent cache — survives server restarts
    BRIEFING_TTL_HOURS = 72
    ttl_cutoff = datetime.utcnow() - timedelta(hours=BRIEFING_TTL_HOURS)
    db_cached = (
        await db.execute(
            select(BriefingCache)
            .where(
                BriefingCache.restaurant_id == x_restaurant_id,
                BriefingCache.days == days,
                BriefingCache.review_count == review_count,
                BriefingCache.created_at >= ttl_cutoff,
            )
            .order_by(BriefingCache.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    if db_cached:
        _log.info(f"DB Cache HIT for briefing: restaurant={x_restaurant_id}, days={days}")
        payload = _json.loads(db_cached.briefing_json)
        from app.schemas import ManagerInsight
        briefing = ManagerBriefing(
            summary=payload.get("summary", ""),
            insights=[
                ManagerInsight(**i) for i in payload.get("insights", [])
            ],
            review_count_note=payload.get("review_count_note"),
            generated_at=db_cached.created_at.isoformat() + "Z",
        )
        # Warm in-memory cache from DB hit
        api_cache.set(x_restaurant_id, "manager_briefing", briefing, suffix=suffix, ttl=7200)
        return briefing

    # If we are not auto-generating (e.g., initial dashboard load), return empty state immediately
    if not auto_generate:
        from datetime import datetime as _dt
        return ManagerBriefing(
            summary="",
            insights=[],
            review_count_note=None,
            generated_at=_dt.utcnow().isoformat() + "Z",
        )

    # 3. Generate via Gemini (expensive)
    _log.info(f"DB Cache MISS — calling Gemini: restaurant={x_restaurant_id}, days={days}")
    deep = await get_deep_analytics(days, x_restaurant_id, db)

    recent_reviews_stmt = (
        select(Review.id, Review.content)
        .where(Review.restaurant_id == x_restaurant_id, Review.is_deleted_on_platform == False)
        .where(Review.reviewed_at >= cutoff)
        .order_by(Review.reviewed_at.desc())
    )
    rows = (await db.execute(recent_reviews_stmt)).all()
    recent_reviews = [{"id": str(row.id), "text": row.content} for row in rows]

    from app.services.insights import generate_manager_briefing
    briefing = await generate_manager_briefing(
        bucket_sentiment=deep.overview.sentiment_by_bucket,
        top_performers=deep.top_performers,
        risks=deep.risks,
        recent_reviews=recent_reviews,
        restaurant_id=x_restaurant_id,
    )

    # 4. Fallback: If Gemini failed (no insights) and we have reviews, return a clean
    #    manager-friendly empty state — never surface stale/test content.
    if not briefing.insights and review_count > 0:
        _log.warning(f"Gemini unavailable for {x_restaurant_id}. Returning clean empty state.")
        from datetime import datetime as _dt
        briefing = ManagerBriefing(
            summary="",
            insights=[],
            review_count_note=None,
            generated_at=_dt.utcnow().isoformat() + "Z",
        )
        # Short TTL so the next request retries Gemini rather than caching emptiness
        api_cache.set(x_restaurant_id, "manager_briefing", briefing, suffix=suffix, ttl=300)
        return briefing

    # Only cache briefings with real insights (not empty fallbacks) in the permanent DB cache
    if briefing.insights:
        from datetime import datetime, timedelta
        briefing.generated_at = datetime.utcnow().isoformat() + "Z"
        api_cache.set(x_restaurant_id, "manager_briefing", briefing, suffix=suffix, ttl=7200)
        # Guard against duplicate INSERTs from concurrent requests
        # (e.g. 1Y + All both resolve to days=180 and race to persist)
        from datetime import datetime, timedelta
        recent_cutoff = datetime.utcnow() - timedelta(minutes=5)
        already_persisted = (
            await db.execute(
                select(BriefingCache)
                .where(
                    BriefingCache.restaurant_id == x_restaurant_id,
                    BriefingCache.days == days,
                    BriefingCache.review_count == review_count,
                    BriefingCache.created_at >= recent_cutoff,
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if not already_persisted:
            briefing_data = {
                "summary": briefing.summary,
                "insights": [i.model_dump() for i in briefing.insights],
                "review_count_note": briefing.review_count_note,
            }
            db_entry = BriefingCache(
                restaurant_id=x_restaurant_id,
                days=days,
                review_count=review_count,
                briefing_json=_json.dumps(briefing_data),
            )
            db.add(db_entry)
            await db.commit()
            _log.info(f"Briefing persisted to DB: restaurant={x_restaurant_id}, days={days}")
        else:
            _log.debug(f"Briefing already persisted by concurrent request: restaurant={x_restaurant_id}, days={days}")

    return briefing


@router.post("/briefing/refresh")
async def refresh_manager_briefing(
    days: Optional[int] = Query(None),
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db),
):
    """Force-regenerate AI briefings for ALL time ranges in one go.

    Generates 30-day, 90-day, and 180-day briefings sequentially (4s spacing
    to respect Gemini RPM limits). 1Y and ALL reuse the 180-day briefing.
    Has a 2-hour cooldown per restaurant, persisted in DB.
    Returns the briefing for the requested `days` param.
    """
    import logging as _logging
    from datetime import datetime, timedelta

    _log = _logging.getLogger(__name__)

    COOLDOWN_HOURS = 2
    ALL_RANGES = [30, 90, 180]  # 1Y and ALL reuse 180

    # ── Cooldown check: if ANY range was recently generated, block ──
    cooldown_cutoff = datetime.utcnow() - timedelta(hours=COOLDOWN_HOURS)
    latest_entry = (
        await db.execute(
            select(BriefingCache)
            .where(
                BriefingCache.restaurant_id == x_restaurant_id,
                BriefingCache.created_at >= cooldown_cutoff,
            )
            .order_by(BriefingCache.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    if latest_entry:
        next_available = latest_entry.created_at + timedelta(hours=COOLDOWN_HOURS)
        remaining_minutes = max(1, int((next_available - datetime.utcnow()).total_seconds() / 60))
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=429,
            content={
                "detail": f"Refresh available in {remaining_minutes} minutes",
                "cooldown_remaining_minutes": remaining_minutes,
            },
        )

    # ── Clear ALL caches for this restaurant ──
    for d in ALL_RANGES:
        suffix = f"days_{d}"
        api_cache.invalidate(x_restaurant_id, "manager_briefing", suffix=suffix)
    api_cache.invalidate(x_restaurant_id, "manager_briefing", suffix="")

    await db.execute(
        sqlalchemy.delete(BriefingCache).where(
            BriefingCache.restaurant_id == x_restaurant_id,
        )
    )
    await db.commit()

    _log.info(f"Refresh triggered: generating ALL ranges for restaurant={x_restaurant_id}")

    # ── Generate all ranges sequentially with RPM spacing ──
    import asyncio
    results = {}
    for i, d in enumerate(ALL_RANGES):
        if i > 0:
            await asyncio.sleep(4)  # Respect Gemini RPM limit
        try:
            briefing = await _generate_briefing_for_days(d, x_restaurant_id, db, auto_generate=True)
            results[d] = briefing
            _log.info(f"Generated briefing for {d}-day range")
        except Exception as e:
            _log.warning(f"Failed to generate {d}-day briefing: {e}")

    # Return the briefing for the requested time range
    effective_days = days if days is not None and days <= 180 else 180
    return results.get(effective_days, results.get(180, ManagerBriefing(
        summary="", insights=[], review_count_note=None,
    )))


@router.get("/historical-trends")
async def get_historical_trends(
    days: Optional[int] = Query(None),
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db)
):
    """Historical trends for 1Y/ALL views — pure SQL, zero Gemini cost.
    
    Returns quarterly rating averages, monthly review volume, and sentiment shifts.
    """
    suffix = f"days_{days}" if days else "all"
    cached = api_cache.get(x_restaurant_id, "historical_trends", suffix=suffix)
    if cached is not None:
        return cached

    from datetime import datetime, timedelta
    cutoff = datetime.utcnow() - timedelta(days=days) if days else None

    # 1. Quarterly rating averages
    quarterly_stmt = (
        select(
            func.to_char(Review.reviewed_at, 'YYYY-"Q"Q').label("quarter"),
            func.avg(Review.rating).label("avg_rating"),
            func.count(Review.id).label("review_count"),
        )
        .where(Review.restaurant_id == x_restaurant_id, Review.is_deleted_on_platform == False)
        .group_by(text('1'))
        .order_by(text('1'))
    )
    if cutoff:
        quarterly_stmt = quarterly_stmt.where(Review.reviewed_at >= cutoff)
    
    quarterly_rows = (await db.execute(quarterly_stmt)).all()
    quarterly_ratings = [
        {
            "quarter": row.quarter,
            "avg_rating": round(float(row.avg_rating), 2),
            "review_count": row.review_count,
        }
        for row in quarterly_rows
    ]

    # 2. Monthly review volume
    monthly_stmt = (
        select(
            func.to_char(Review.reviewed_at, 'YYYY-MM').label("month"),
            func.count(Review.id).label("review_count"),
            func.avg(Review.rating).label("avg_rating"),
        )
        .where(Review.restaurant_id == x_restaurant_id, Review.is_deleted_on_platform == False)
        .group_by(text('1'))
        .order_by(text('1'))
    )
    if cutoff:
        monthly_stmt = monthly_stmt.where(Review.reviewed_at >= cutoff)
    
    monthly_rows = (await db.execute(monthly_stmt)).all()
    monthly_volume = [
        {
            "month": row.month,
            "review_count": row.review_count,
            "avg_rating": round(float(row.avg_rating), 2),
        }
        for row in monthly_rows
    ]

    # 3. Sentiment shifts (compare last 6 months vs prior 6 months)
    now = datetime.utcnow()
    six_months_ago = now - timedelta(days=180)
    twelve_months_ago = now - timedelta(days=365)

    async def avg_sentiment_for_range(start, end):
        stmt = (
            select(
                SentimentScore.bucket,
                func.avg(SentimentScore.score).label("avg_score"),
            )
            .join(Review, SentimentScore.review_id == Review.id)
            .where(
                Review.restaurant_id == x_restaurant_id,
                Review.is_deleted_on_platform == False,
                Review.reviewed_at >= start,
                Review.reviewed_at < end,
            )
            .group_by(SentimentScore.bucket)
        )
        rows = (await db.execute(stmt)).all()
        return {row.bucket: round(float(row.avg_score), 3) for row in rows}

    recent_sentiment = await avg_sentiment_for_range(six_months_ago, now)
    prior_sentiment = await avg_sentiment_for_range(twelve_months_ago, six_months_ago)

    sentiment_shifts = []
    for bucket in ["food", "drink", "ambiance"]:
        current = recent_sentiment.get(bucket)
        previous = prior_sentiment.get(bucket)
        shift = None
        if current is not None and previous is not None:
            shift = round(current - previous, 3)
        sentiment_shifts.append({
            "bucket": bucket,
            "current": current,
            "previous": previous,
            "shift": shift,
        })

    result = {
        "quarterly_ratings": quarterly_ratings,
        "monthly_volume": monthly_volume,
        "sentiment_shifts": sentiment_shifts,
    }
    api_cache.set(x_restaurant_id, "historical_trends", result, suffix=suffix, ttl=7200)
    return result


@router.get("/operations", response_model=OperationsAnalytics)
async def get_operations_analytics(
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db)
):
    """Review KPIs: velocity, momentum, platform split, scoped to restaurant."""
    cached = api_cache.get(x_restaurant_id, "operations")
    if cached is not None:
        return cached

    from datetime import datetime, timedelta

    now = datetime.utcnow()
    last_30_days = now - timedelta(days=30)
    prev_30_days = now - timedelta(days=60)

    # 1. Review Velocity (Reviews per week in last 30 days)
    recent_reviews_count = (await db.execute(
        select(func.count(Review.id))
        .where(Review.restaurant_id == x_restaurant_id, Review.reviewed_at >= last_30_days, Review.is_deleted_on_platform == False)
    )).scalar() or 0
    review_velocity = round(recent_reviews_count / 4.2, 1) # ~4.2 weeks in 30 days

    # 2. Sentiment Momentum
    curr_avg = (await db.execute(
        select(func.avg(Review.rating))
        .where(Review.restaurant_id == x_restaurant_id, Review.reviewed_at >= last_30_days, Review.is_deleted_on_platform == False)
    )).scalar() or 0.0
    
    prev_avg = (await db.execute(
        select(func.avg(Review.rating))
        .where(Review.restaurant_id == x_restaurant_id, Review.reviewed_at >= prev_30_days, Review.reviewed_at < last_30_days, Review.is_deleted_on_platform == False)
    )).scalar() or 0.0
    
    sentiment_momentum = round(float(curr_avg) - float(prev_avg), 2) if prev_avg else 0.0
    
    active_guests_stmt = (
        select(func.count(func.distinct(Review.guest_id)))
        .where(Review.restaurant_id == x_restaurant_id, Review.is_deleted_on_platform == False)
    )
    guests_count = (await db.execute(active_guests_stmt)).scalar() or 0
    
    # 3. Tier distribution
    tier_rows = (
        await db.execute(
            select(Guest.tier, func.count(Guest.id).label("count"))
            .where(Guest.restaurant_id == x_restaurant_id)
            .group_by(Guest.tier)
        )
    ).all()

    tier_distribution = [
        GuestTierCount(tier=row.tier, count=row.count)
        for row in tier_rows
    ]

    # 4. Platform split
    platform_rows = (
        await db.execute(
            select(Review.platform, func.count(Review.id).label("count"))
            .where(Review.restaurant_id == x_restaurant_id, Review.is_deleted_on_platform == False)
            .group_by(Review.platform)
        )
    ).all()

    platform_split = {row.platform: row.count for row in platform_rows}

    result = OperationsAnalytics(
        review_velocity=review_velocity,
        sentiment_momentum=sentiment_momentum,
        tier_distribution=tier_distribution,
        total_guests=guests_count,
        platform_split=platform_split,
    )
    api_cache.set(x_restaurant_id, "operations", result)
    return result
