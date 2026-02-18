"""Tests for Pydantic schema validation."""

import pytest
from pydantic import ValidationError

from app.schemas import (
    GuestCreate,
    OrderCreate,
    ReviewCreate,
    YelpReviewIngest,
    GoogleReviewIngest,
    IngestionRequest,
    ReviewPlatform,
    OrderCategory,
)


class TestGuestSchemas:
    def test_valid_guest(self):
        guest = GuestCreate(name="Test User", email="test@email.com")
        assert guest.name == "Test User"
        assert guest.tier.value == "new"

    def test_guest_minimal(self):
        guest = GuestCreate(name="Minimal")
        assert guest.email is None
        assert guest.phone is None


class TestOrderSchemas:
    def test_valid_order(self):
        order = OrderCreate(
            guest_id="abc-123",
            item_name="Latte",
            category=OrderCategory.drink,
            price=5.50,
        )
        assert order.quantity == 1

    def test_invalid_price(self):
        with pytest.raises(ValidationError):
            OrderCreate(
                guest_id="abc-123",
                item_name="Latte",
                category=OrderCategory.drink,
                price=-1.0,  # Invalid
            )

    def test_invalid_quantity(self):
        with pytest.raises(ValidationError):
            OrderCreate(
                guest_id="abc-123",
                item_name="Latte",
                category=OrderCategory.drink,
                price=5.0,
                quantity=0,  # Invalid
            )


class TestReviewSchemas:
    def test_valid_review(self):
        review = ReviewCreate(
            guest_id="abc-123",
            platform=ReviewPlatform.yelp,
            rating=4.5,
            content="Great place!",
        )
        assert review.rating == 4.5

    def test_rating_out_of_range(self):
        with pytest.raises(ValidationError):
            ReviewCreate(
                guest_id="abc-123",
                platform=ReviewPlatform.yelp,
                rating=6.0,  # Max is 5
                content="Test",
            )

    def test_negative_rating(self):
        with pytest.raises(ValidationError):
            ReviewCreate(
                guest_id="abc-123",
                platform=ReviewPlatform.yelp,
                rating=-1.0,
                content="Test",
            )


class TestYelpIngestSchema:
    def test_valid(self):
        ingest = YelpReviewIngest(
            review_id="yelp-001",
            guest_name="Test",
            rating=4.0,
            text="Good food!",
            date="2026-01-15",
        )
        assert ingest.guest_email is None

    def test_missing_required(self):
        with pytest.raises(ValidationError):
            YelpReviewIngest(review_id="yelp-001", rating=4.0, text="Test")


class TestGoogleIngestSchema:
    def test_valid(self):
        ingest = GoogleReviewIngest(
            review_id="goog-001",
            author_name="Test",
            rating=5.0,
            text="Amazing!",
            time="2026-02-01T10:00:00",
        )
        assert ingest.author_email is None

    def test_missing_required(self):
        with pytest.raises(ValidationError):
            GoogleReviewIngest(review_id="goog-001", rating=5.0, text="Test")
