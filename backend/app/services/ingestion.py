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
    db: AsyncSession, name: str, email: str | None = None
) -> Guest:
    """Find existing guest by email or name, or create a new one."""
    if email:
        result = await db.execute(select(Guest).where(Guest.email == email))
        guest = result.scalar_one_or_none()
        if guest:
            return guest

    # Fallback: match by exact name
    result = await db.execute(select(Guest).where(Guest.name == name))
    guest = result.scalar_one_or_none()
    if guest:
        return guest

    # Create new guest
    guest = Guest(name=name, email=email, tier="new")
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
        "content": raw.text,
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
        "content": raw.text,
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

            # Get or create guest
            guest = await _get_or_create_guest(
                db,
                name=normalized["guest_name"],
                email=normalized.get("guest_email"),
            )

            # Update guest visit timestamps
            reviewed_at = normalized["reviewed_at"]
            if guest.first_visit is None or reviewed_at < guest.first_visit:
                guest.first_visit = reviewed_at
            if guest.last_visit is None or reviewed_at > guest.last_visit:
                guest.last_visit = reviewed_at

            # Create review
            review = Review(
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
                db, name=parsed.guest_name, email=parsed.guest_email
            )

            ordered_at = _parse_datetime(parsed.ordered_at)

            # Update guest visit timestamps
            if guest.first_visit is None or ordered_at < guest.first_visit:
                guest.first_visit = ordered_at
            if guest.last_visit is None or ordered_at > guest.last_visit:
                guest.last_visit = ordered_at

            # Update tier based on order count
            result = await db.execute(
                select(Order).where(Order.guest_id == guest.id)
            )
            order_count = len(result.scalars().all())
            if order_count >= 10:
                guest.tier = "vip"
            elif order_count >= 3:
                guest.tier = "regular"

            order = Order(
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
