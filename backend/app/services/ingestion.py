"""Review ingestion pipeline — Yelp & Google Maps JSON normalization."""

from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Guest, Order, Review
from app.schemas import (
    GoogleReviewIngest,
    IngestionReport,
    OrderIngestItem,
    OrderIngestionReport,
    ReviewPlatform,
    YelpReviewIngest,
)

logger = logging.getLogger(__name__)


async def _get_or_create_guest(
    db: AsyncSession, restaurant_id: str, name: str, email: str | None = None
) -> Guest:
    """Find existing guest by email or name within a restaurant, or create a new one."""
    if email:
        result = await db.execute(
            select(Guest).where(Guest.restaurant_id == restaurant_id, Guest.email == email)
        )
        guest = result.scalar_one_or_none()
        if guest:
            return guest

    # Fallback: match by exact name within the restaurant
    result = await db.execute(
        select(Guest).where(Guest.restaurant_id == restaurant_id, Guest.name == name)
    )
    guest = result.scalar_one_or_none()
    if guest:
        return guest

    # Create new guest for this restaurant
    guest = Guest(restaurant_id=restaurant_id, name=name, email=email, tier="new")
    db.add(guest)
    await db.flush()
    return guest


def _parse_datetime(raw: str) -> datetime:
    """Parse various ISO datetime formats."""
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    # Last resort: try fromisoformat
    return datetime.fromisoformat(raw.replace("Z", "+00:00").replace("+00:00", ""))


def normalize_yelp_review(raw: YelpReviewIngest) -> dict:
    """Normalize a Yelp review into a common format."""
    return {
        "platform": ReviewPlatform.yelp,
        "platform_review_id": raw.review_id,
        "guest_name": raw.guest_name,
        "guest_email": raw.guest_email,
        "rating": raw.rating,
        "content": raw.text or "[Rating only]",
        "reviewed_at": _parse_datetime(raw.date),
    }


def normalize_google_review(raw: GoogleReviewIngest) -> dict:
    """Normalize a Google Maps review into a common format."""
    return {
        "platform": ReviewPlatform.google,
        "platform_review_id": raw.review_id,
        "guest_name": raw.author_name,
        "guest_email": raw.author_email,
        "rating": raw.rating,
        "content": raw.text or "[Rating only]",
        "reviewed_at": _parse_datetime(raw.time),
    }


def normalize_review(raw: YelpReviewIngest | GoogleReviewIngest, platform: ReviewPlatform) -> dict:
    """Dispatch to the correct normalizer based on platform."""
    if platform == ReviewPlatform.yelp:
        if not isinstance(raw, YelpReviewIngest):
            raw = YelpReviewIngest(**raw.model_dump())
        return normalize_yelp_review(raw)
    else:
        if not isinstance(raw, GoogleReviewIngest):
            raw = GoogleReviewIngest(**raw.model_dump())
        return normalize_google_review(raw)


async def check_duplicate(db: AsyncSession, platform_review_id: str) -> bool:
    """Return True if a review with this platform_review_id already exists."""
    if not platform_review_id:
        return False
    result = await db.execute(
        select(Review).where(Review.platform_review_id == platform_review_id)
    )
    return result.scalar_one_or_none() is not None


async def ingest_reviews(
    db: AsyncSession,
    restaurant_id: str,
    platform: ReviewPlatform,
    reviews_data: list[dict],
) -> IngestionReport:
    """
    Full ingestion pipeline:
    1. Validate & normalize each review
    2. Deduplicate by platform_review_id
    3. Get-or-create guest
    4. Persist review
    5. Return ingestion report
    """
    report = IngestionReport(
        platform=platform.value,
        total_received=len(reviews_data),
        ingested=0,
        duplicates_skipped=0,
        errors=0,
    )

    for i, raw_data in enumerate(reviews_data):
        try:
            # Parse into typed schema
            if platform == ReviewPlatform.yelp:
                parsed = YelpReviewIngest.model_validate(raw_data)
            else:
                parsed = GoogleReviewIngest.model_validate(raw_data)

            normalized = normalize_review(parsed, platform)

            # Dedup check
            if await check_duplicate(db, normalized["platform_review_id"]):
                report.duplicates_skipped += 1
                continue

            # Get or create guest scoped to restaurant
            guest = await _get_or_create_guest(
                db,
                restaurant_id=restaurant_id,
                name=normalized["guest_name"],
                email=normalized.get("guest_email"),
            )

            # Update guest visit timestamps
            reviewed_at = normalized["reviewed_at"]
            if guest.first_visit is None or reviewed_at < guest.first_visit:
                guest.first_visit = reviewed_at
            if guest.last_visit is None or reviewed_at > guest.last_visit:
                guest.last_visit = reviewed_at

            # Update tier logic after each review
            metrics_result = await db.execute(
                select(
                    func.count(Review.id).label("review_count"),
                    func.count(Order.id).label("order_count")
                ).where(Review.guest_id == guest.id, Review.restaurant_id == restaurant_id)
            )
            metrics = metrics_result.one()
            review_count = metrics.review_count
            order_count = metrics.order_count

            now = datetime.utcnow()
            days_since_last = (now - guest.last_visit).days if guest.last_visit else 0
            days_since_first = (now - guest.first_visit).days if guest.first_visit else 0

            if review_count >= 3:
                guest.tier = "vip"
            elif days_since_last > 30:
                guest.tier = "slipping"
            elif days_since_first <= 30 and order_count < 3:
                guest.tier = "new"
            else:
                guest.tier = "regular"

            # Create review
            review = Review(
                restaurant_id=restaurant_id,
                guest_id=guest.id,
                platform=normalized["platform"].value,
                platform_review_id=normalized["platform_review_id"],
                rating=normalized["rating"],
                content=normalized["content"],
                reviewed_at=normalized["reviewed_at"],
                ingested_at=datetime.utcnow(),
            )
            db.add(review)
            report.ingested += 1

        except Exception as e:
            logger.warning(f"Error ingesting review #{i}: {e}")
            report.errors += 1
            report.error_details.append(f"Review #{i}: {str(e)}")

    await db.flush()
    return report


async def ingest_orders(
    db: AsyncSession,
    restaurant_id: str,
    orders_data: list[dict],
) -> OrderIngestionReport:
    """Bulk ingest orders from JSON data."""
    report = OrderIngestionReport(
        total_received=len(orders_data),
        ingested=0,
        errors=0,
    )

    for i, raw_data in enumerate(orders_data):
        try:
            parsed = OrderIngestItem.model_validate(raw_data)
            guest = await _get_or_create_guest(
                db, restaurant_id=restaurant_id, name=parsed.guest_name, email=parsed.guest_email
            )

            ordered_at = _parse_datetime(parsed.ordered_at)

            # Update guest visit timestamps
            if guest.first_visit is None or ordered_at < guest.first_visit:
                guest.first_visit = ordered_at
            if guest.last_visit is None or ordered_at > guest.last_visit:
                guest.last_visit = ordered_at

            # ── Tier Calculation Logic ──
            # Re-fetch guest metrics to ensure accuracy
            metrics_result = await db.execute(
                select(
                    func.count(Review.id).label("review_count"),
                    func.count(Order.id).label("order_count")
                ).where(Review.guest_id == guest.id, Review.restaurant_id == restaurant_id)
            )
            metrics = metrics_result.one()
            review_count = metrics.review_count
            order_count = metrics.order_count

            # 1. VIP: > 3 reviews (per user request)
            if review_count >= 3:
                guest.tier = "vip"
            # 2. Regular: 3+ orders or 2+ reviews
            elif order_count >= 3 or review_count >= 2:
                guest.tier = "regular"
            # 3. New: First visit was within the last 30 days
            else:
                now = datetime.utcnow()
                if guest.first_visit and (now - guest.first_visit).days <= 30:
                    guest.tier = "new"
                else:
                    guest.tier = "regular" # Default to regular if they've been around longer but don't hit VIP/New criteria

            order = Order(
                restaurant_id=restaurant_id,
                guest_id=guest.id,
                item_name=parsed.item_name,
                category=parsed.category.value,
                price=parsed.price,
                quantity=parsed.quantity,
                ordered_at=ordered_at,
            )
            db.add(order)
            report.ingested += 1

        except Exception as e:
            logger.warning(f"Error ingesting order #{i}: {e}")
            report.errors += 1
            report.error_details.append(f"Order #{i}: {str(e)}")

    await db.flush()
    return report
