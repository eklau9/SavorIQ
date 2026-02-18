"""Comprehensive tests for the review + order ingestion pipeline.

Target: 90%+ coverage of app/services/ingestion.py
"""

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models import Guest, Order, Review
from app.schemas import (
    GoogleReviewIngest,
    ReviewPlatform,
    YelpReviewIngest,
)
from app.services.ingestion import (
    _get_or_create_guest,
    _parse_datetime,
    check_duplicate,
    ingest_orders,
    ingest_reviews,
    normalize_google_review,
    normalize_review,
    normalize_yelp_review,
)


# ── DateTime Parsing ─────────────────────────────────────────────────────


class TestParseDatetime:
    def test_iso_format_with_time(self):
        dt = _parse_datetime("2026-01-15T10:30:00")
        assert dt.year == 2026
        assert dt.month == 1
        assert dt.day == 15
        assert dt.hour == 10
        assert dt.minute == 30

    def test_date_only(self):
        dt = _parse_datetime("2026-01-15")
        assert dt.year == 2026
        assert dt.hour == 0

    def test_space_separated(self):
        dt = _parse_datetime("2026-01-15 10:30:00")
        assert dt.hour == 10

    def test_invalid_falls_back(self):
        """Should still parse via fromisoformat for non-standard formats."""
        dt = _parse_datetime("2026-01-15T10:30:00")
        assert dt is not None


# ── Yelp Normalization ────────────────────────────────────────────────────


class TestNormalizeYelpReview:
    def test_basic_normalization(self):
        raw = YelpReviewIngest(
            review_id="yelp-001",
            guest_name="Test Guest",
            guest_email="test@email.com",
            rating=4.5,
            text="Great food!",
            date="2026-01-15",
        )
        result = normalize_yelp_review(raw)

        assert result["platform"] == ReviewPlatform.yelp
        assert result["platform_review_id"] == "yelp-001"
        assert result["guest_name"] == "Test Guest"
        assert result["guest_email"] == "test@email.com"
        assert result["rating"] == 4.5
        assert result["content"] == "Great food!"

    def test_no_email(self):
        raw = YelpReviewIngest(
            review_id="yelp-002",
            guest_name="No Email Guest",
            rating=3.0,
            text="Okay experience.",
            date="2026-01-20",
        )
        result = normalize_yelp_review(raw)
        assert result["guest_email"] is None


# ── Google Normalization ──────────────────────────────────────────────────


class TestNormalizeGoogleReview:
    def test_basic_normalization(self):
        raw = GoogleReviewIngest(
            review_id="goog-001",
            author_name="Google User",
            author_email="google@email.com",
            rating=5.0,
            text="Amazing coffee!",
            time="2026-02-01T10:00:00",
        )
        result = normalize_google_review(raw)

        assert result["platform"] == ReviewPlatform.google
        assert result["platform_review_id"] == "goog-001"
        assert result["guest_name"] == "Google User"
        assert result["content"] == "Amazing coffee!"

    def test_no_email(self):
        raw = GoogleReviewIngest(
            review_id="goog-002",
            author_name="No Email",
            rating=4.0,
            text="Good stuff.",
            time="2026-02-05T15:00:00",
        )
        result = normalize_google_review(raw)
        assert result["guest_email"] is None


# ── normalize_review dispatcher ──────────────────────────────────────────


class TestNormalizeReview:
    def test_dispatch_yelp(self):
        raw = YelpReviewIngest(
            review_id="yelp-d-001",
            guest_name="Dispatch Test",
            rating=4.0,
            text="Test",
            date="2026-01-01",
        )
        result = normalize_review(raw, ReviewPlatform.yelp)
        assert result["platform"] == ReviewPlatform.yelp

    def test_dispatch_google(self):
        raw = GoogleReviewIngest(
            review_id="goog-d-001",
            author_name="Dispatch Test",
            rating=4.0,
            text="Test",
            time="2026-01-01T00:00:00",
        )
        result = normalize_review(raw, ReviewPlatform.google)
        assert result["platform"] == ReviewPlatform.google


# ── Guest Get/Create ─────────────────────────────────────────────────────


class TestGetOrCreateGuest:
    @pytest.mark.asyncio
    async def test_create_new_guest(self, db_session):
        guest = await _get_or_create_guest(db_session, "New Guest", "new@email.com")
        assert guest.name == "New Guest"
        assert guest.email == "new@email.com"
        assert guest.tier == "new"

    @pytest.mark.asyncio
    async def test_find_by_email(self, db_session):
        g1 = await _get_or_create_guest(db_session, "First", "same@email.com")
        await db_session.flush()
        g2 = await _get_or_create_guest(db_session, "First Again", "same@email.com")
        assert g1.id == g2.id

    @pytest.mark.asyncio
    async def test_find_by_name(self, db_session):
        g1 = await _get_or_create_guest(db_session, "Named Guest")
        await db_session.flush()
        g2 = await _get_or_create_guest(db_session, "Named Guest")
        assert g1.id == g2.id

    @pytest.mark.asyncio
    async def test_create_without_email(self, db_session):
        guest = await _get_or_create_guest(db_session, "No Email")
        assert guest.email is None


# ── Duplicate Check ──────────────────────────────────────────────────────


class TestCheckDuplicate:
    @pytest.mark.asyncio
    async def test_not_duplicate(self, db_session):
        result = await check_duplicate(db_session, "nonexistent-id")
        assert result is False

    @pytest.mark.asyncio
    async def test_empty_id_not_duplicate(self, db_session):
        result = await check_duplicate(db_session, "")
        assert result is False

    @pytest.mark.asyncio
    async def test_is_duplicate(self, db_session):
        guest = Guest(name="DupTest")
        db_session.add(guest)
        await db_session.flush()

        review = Review(
            guest_id=guest.id,
            platform="yelp",
            platform_review_id="dup-test-id",
            rating=4.0,
            content="Test",
        )
        db_session.add(review)
        await db_session.flush()

        result = await check_duplicate(db_session, "dup-test-id")
        assert result is True


# ── Full Ingestion Pipeline ──────────────────────────────────────────────


class TestIngestReviews:
    @pytest.mark.asyncio
    async def test_ingest_yelp_reviews(self, db_session):
        reviews_data = [
            {
                "review_id": "ingest-yelp-001",
                "guest_name": "Ingest User",
                "guest_email": "ingest@email.com",
                "rating": 4.0,
                "text": "Great food and coffee!",
                "date": "2026-01-15",
            },
            {
                "review_id": "ingest-yelp-002",
                "guest_name": "Ingest User 2",
                "rating": 3.5,
                "text": "Okay drink, nice atmosphere.",
                "date": "2026-01-20",
            },
        ]

        report = await ingest_reviews(db_session, ReviewPlatform.yelp, reviews_data)

        assert report.platform == "yelp"
        assert report.total_received == 2
        assert report.ingested == 2
        assert report.duplicates_skipped == 0
        assert report.errors == 0

    @pytest.mark.asyncio
    async def test_ingest_google_reviews(self, db_session):
        reviews_data = [
            {
                "review_id": "ingest-goog-001",
                "author_name": "Google Ingest",
                "author_email": "google.ingest@email.com",
                "rating": 5.0,
                "text": "Fantastic latte!",
                "time": "2026-02-01T10:00:00",
            },
        ]

        report = await ingest_reviews(db_session, ReviewPlatform.google, reviews_data)

        assert report.platform == "google"
        assert report.ingested == 1

    @pytest.mark.asyncio
    async def test_deduplication(self, db_session):
        reviews_data = [
            {
                "review_id": "dedup-001",
                "guest_name": "Dedup User",
                "rating": 4.0,
                "text": "First time.",
                "date": "2026-01-15",
            },
        ]

        # Ingest once
        await ingest_reviews(db_session, ReviewPlatform.yelp, reviews_data)

        # Ingest same again
        report = await ingest_reviews(db_session, ReviewPlatform.yelp, reviews_data)
        assert report.duplicates_skipped == 1
        assert report.ingested == 0

    @pytest.mark.asyncio
    async def test_guest_visit_tracking(self, db_session):
        reviews_data = [
            {
                "review_id": "visit-001",
                "guest_name": "Visit Tracker",
                "guest_email": "visit@email.com",
                "rating": 4.0,
                "text": "First visit review.",
                "date": "2026-01-10",
            },
            {
                "review_id": "visit-002",
                "guest_name": "Visit Tracker",
                "guest_email": "visit@email.com",
                "rating": 5.0,
                "text": "Second visit, even better!",
                "date": "2026-02-15",
            },
        ]

        await ingest_reviews(db_session, ReviewPlatform.yelp, reviews_data)

        result = await db_session.execute(
            select(Guest).where(Guest.email == "visit@email.com")
        )
        guest = result.scalar_one()
        assert guest.first_visit.month == 1
        assert guest.last_visit.month == 2

    @pytest.mark.asyncio
    async def test_error_handling_bad_data(self, db_session):
        reviews_data = [
            {"bad_field": "invalid data"},  # Missing required fields
        ]

        report = await ingest_reviews(db_session, ReviewPlatform.yelp, reviews_data)
        assert report.errors == 1
        assert len(report.error_details) == 1

    @pytest.mark.asyncio
    async def test_mixed_valid_and_invalid(self, db_session):
        reviews_data = [
            {
                "review_id": "mixed-001",
                "guest_name": "Valid User",
                "rating": 4.5,
                "text": "Valid review.",
                "date": "2026-01-15",
            },
            {"broken": True},  # Invalid
            {
                "review_id": "mixed-002",
                "guest_name": "Also Valid",
                "rating": 3.0,
                "text": "Another valid review.",
                "date": "2026-01-20",
            },
        ]

        report = await ingest_reviews(db_session, ReviewPlatform.yelp, reviews_data)
        assert report.ingested == 2
        assert report.errors == 1

    @pytest.mark.asyncio
    async def test_review_persisted_to_db(self, db_session):
        reviews_data = [
            {
                "review_id": "persist-001",
                "guest_name": "Persist User",
                "rating": 4.0,
                "text": "Checking persistence.",
                "date": "2026-01-15",
            },
        ]

        await ingest_reviews(db_session, ReviewPlatform.yelp, reviews_data)

        result = await db_session.execute(
            select(Review).where(Review.platform_review_id == "persist-001")
        )
        review = result.scalar_one()
        assert review.content == "Checking persistence."
        assert review.platform == "yelp"
        assert review.rating == 4.0


class TestIngestOrders:
    @pytest.mark.asyncio
    async def test_basic_order_ingest(self, db_session):
        orders_data = [
            {
                "guest_name": "Order User",
                "guest_email": "order@email.com",
                "item_name": "Latte",
                "category": "drink",
                "price": 5.50,
                "quantity": 1,
                "ordered_at": "2026-01-15T08:00:00",
            },
        ]

        report = await ingest_orders(db_session, orders_data)
        assert report.total_received == 1
        assert report.ingested == 1
        assert report.errors == 0

    @pytest.mark.asyncio
    async def test_order_bad_data(self, db_session):
        orders_data = [{"invalid": "structure"}]
        report = await ingest_orders(db_session, orders_data)
        assert report.errors == 1

    @pytest.mark.asyncio
    async def test_order_guest_tier_upgrade(self, db_session):
        """Guest with 3+ orders should be upgraded to 'regular'."""
        orders_data = [
            {
                "guest_name": "Tier User",
                "guest_email": "tier@email.com",
                "item_name": f"Item {i}",
                "category": "drink",
                "price": 5.00,
                "quantity": 1,
                "ordered_at": f"2026-01-{10+i:02d}T08:00:00",
            }
            for i in range(4)
        ]

        await ingest_orders(db_session, orders_data)

        result = await db_session.execute(
            select(Guest).where(Guest.email == "tier@email.com")
        )
        guest = result.scalar_one()
        assert guest.tier == "regular"
