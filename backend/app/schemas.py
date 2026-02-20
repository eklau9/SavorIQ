"""Pydantic schemas for SavorIQ API request/response validation."""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


# ── Enums ──────────────────────────────────────────────────────────────────

class GuestTier(str, Enum):
    new = "new"
    regular = "regular"
    vip = "vip"


class OrderCategory(str, Enum):
    food = "food"
    drink = "drink"


class ReviewPlatform(str, Enum):
    yelp = "yelp"
    google = "google"


class SentimentBucket(str, Enum):
    food = "food"
    drink = "drink"
    ambiance = "ambiance"


# ── Guest ──────────────────────────────────────────────────────────────────

class GuestBase(BaseModel):
    name: str
    email: str | None = None
    phone: str | None = None
    tier: GuestTier = GuestTier.new


class GuestCreate(GuestBase):
    pass


class GuestRead(GuestBase):
    id: str
    first_visit: datetime | None = None
    last_visit: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Order ──────────────────────────────────────────────────────────────────

class OrderBase(BaseModel):
    item_name: str
    category: OrderCategory
    price: float = Field(gt=0)
    quantity: int = Field(ge=1, default=1)


class OrderCreate(OrderBase):
    guest_id: str
    ordered_at: datetime | None = None


class OrderRead(OrderBase):
    id: str
    guest_id: str
    ordered_at: datetime

    model_config = {"from_attributes": True}


# ── Review ─────────────────────────────────────────────────────────────────

class ReviewBase(BaseModel):
    platform: ReviewPlatform
    rating: float = Field(ge=0, le=5)
    content: str


class ReviewCreate(ReviewBase):
    guest_id: str
    platform_review_id: str | None = None
    reviewed_at: datetime | None = None


class ReviewRead(ReviewBase):
    id: str
    guest_id: str
    platform_review_id: str | None = None
    reviewed_at: datetime
    ingested_at: datetime
    sentiment_scores: list[SentimentScoreRead] = []

    model_config = {"from_attributes": True}


# ── Sentiment Score ────────────────────────────────────────────────────────

class SentimentScoreRead(BaseModel):
    id: str
    review_id: str
    bucket: SentimentBucket
    score: float = Field(ge=-1, le=1)
    summary: str | None = None
    analyzed_at: datetime

    model_config = {"from_attributes": True}


# Rebuild ReviewRead to resolve forward ref
ReviewRead.model_rebuild()


class ReviewWithGuest(ReviewRead):
    """Review with guest name for global listing."""
    guest_name: str = ""

    model_config = {"from_attributes": True}


# ── Ingestion ──────────────────────────────────────────────────────────────

class YelpReviewIngest(BaseModel):
    """Schema for a single Yelp review from exported JSON."""
    review_id: str
    guest_name: str
    guest_email: str | None = None
    rating: float
    text: str
    date: str  # ISO date string


class GoogleReviewIngest(BaseModel):
    """Schema for a single Google Maps review from exported JSON."""
    review_id: str
    author_name: str
    author_email: str | None = None
    rating: float
    text: str
    time: str  # ISO datetime string


class IngestionRequest(BaseModel):
    """Bulk ingestion request."""
    platform: ReviewPlatform
    reviews: list[YelpReviewIngest] | list[GoogleReviewIngest]


class IngestionReport(BaseModel):
    """Result summary from an ingestion run."""
    platform: str
    total_received: int
    ingested: int
    duplicates_skipped: int
    errors: int
    error_details: list[str] = []


# ── Order Ingestion ───────────────────────────────────────────────────────

class OrderIngestItem(BaseModel):
    guest_name: str
    guest_email: str | None = None
    item_name: str
    category: OrderCategory
    price: float = Field(gt=0)
    quantity: int = Field(ge=1, default=1)
    ordered_at: str  # ISO datetime string


class OrderIngestionRequest(BaseModel):
    orders: list[OrderIngestItem]


class OrderIngestionReport(BaseModel):
    total_received: int
    ingested: int
    errors: int
    error_details: list[str] = []


# ── Guest Pulse (aggregate) ───────────────────────────────────────────────

class BucketSentiment(BaseModel):
    bucket: SentimentBucket
    avg_score: float
    review_count: int


class GuestPulse(BaseModel):
    """Aggregate view: guest profile + purchase stats + sentiment overview."""
    guest: GuestRead
    total_orders: int
    total_spend: float
    favorite_items: list[str]
    visit_count: int
    sentiment_summary: list[BucketSentiment]
    recent_reviews: list[ReviewRead]


# ── Analytics ──────────────────────────────────────────────────────────────

class OverviewStats(BaseModel):
    total_guests: int
    total_orders: int
    total_reviews: int
    avg_rating: float
    sentiment_by_bucket: list[BucketSentiment]


class ItemPerformance(BaseModel):
    item_name: str
    category: OrderCategory
    order_count: int
    avg_sentiment: float | None = None
    review_count: int


class ManagerInsight(BaseModel):
    title: str
    description: str
    type: str  # "win", "risk", "action"
    steps: list[str] = []


class ManagerBriefing(BaseModel):
    summary: str
    insights: list[ManagerInsight]


class DeepAnalytics(BaseModel):
    overview: OverviewStats
    top_performers: list[ItemPerformance]
    risks: list[ItemPerformance]
    briefing: ManagerBriefing
