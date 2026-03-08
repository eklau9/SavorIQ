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
    slipping = "slipping"


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


class GuestSegment(str, Enum):
    vip_at_risk = "VIP_AT_RISK"           # High spend + Low sentiment
    lost_regular = "LOST_REGULAR"         # Prev regular + No visit > 14 days
    new_big_spender = "NEW_BIG_SPENDER"   # Tier=new + Spend > threshold
    promoter = "PROMOTER"                 # High sentiment + High spend
    stable_regular = "STABLE_REGULAR"     # Consistent visits + Neutral/Pos sentiment


class InterceptStatus(str, Enum):
    open = "open"
    actioned = "actioned"
    resolved = "resolved"
    dismissed = "dismissed"


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
    avg_rating: float | None = None
    visit_count: int | None = None
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
    text: str | None = None
    date: str  # ISO date string


class GoogleReviewIngest(BaseModel):
    """Schema for a single Google Maps review from exported JSON."""
    review_id: str
    author_name: str
    author_email: str | None = None
    rating: float
    text: str | None = None
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


# ── Unified Search ─────────────────────────────────────────────────────────

class SyncStatus(BaseModel):
    last_synced_at: str
    ago: str
    on_cooldown: bool
    reviews_fetched: int
    new_reviews: int

class PlatformBusiness(BaseModel):
    id: str
    name: str
    address: str | None = None
    rating: float
    review_count: int
    url: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    last_sync: SyncStatus | None = None

class UnifiedBusiness(BaseModel):
    id: str # UUID generated for the group
    name: str # Primary name (usually Google)
    address: str | None = None
    total_reviews: int
    avg_rating: float
    google: PlatformBusiness | None = None
    yelp: PlatformBusiness | None = None
    distance: float | None = None


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
    """Aggregate view: guest profile + review engagement + sentiment overview."""
    guest: GuestRead
    favorite_items: list[str]
    visit_count: int  # Derived from reviews
    review_engagement_score: float # 0.0 to 1.0 based on frequency/length
    sentiment_summary: list[BucketSentiment]
    recent_reviews: list[ReviewRead]


class GuestPrioritized(BaseModel):
    """A guest flagged for specific manager action or intercept."""
    guest: GuestRead
    segment: GuestSegment
    priority_score: float  # 0.0 to 1.0 (1.0 is highest priority)
    reason: str
    recommended_action: str
    last_visit_days_ago: int
    review_count: int = 0
    review_engagement_score: float = 0.0
    current_status: InterceptStatus = InterceptStatus.open
    current_action: InterceptActionRead | None = None

    model_config = {"from_attributes": True}


# ── Intercept Actions ──────────────────────────────────────────────────────

class InterceptActionBase(BaseModel):
    status: InterceptStatus
    notes: str | None = None
    segment: str


class InterceptActionCreate(InterceptActionBase):
    guest_id: str


class InterceptActionRead(InterceptActionBase):
    id: str
    guest_id: str
    actioned_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Menu Items ─────────────────────────────────────────────────────────────

class MenuItemCreate(BaseModel):
    name: str
    category: OrderCategory
    keywords: str  # Comma-separated aliases


class MenuItemRead(MenuItemCreate):
    id: str
    is_active: bool = True
    created_at: datetime

    model_config = {"from_attributes": True}


class RestaurantRead(BaseModel):
    id: str
    name: str
    address: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


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


class UnmatchedMention(BaseModel):
    """A food/drink term found in reviews but not matching any menu item."""
    term: str
    mention_count: int
    avg_rating: float | None = None


class DeepAnalytics(BaseModel):
    overview: OverviewStats
    top_performers: list[ItemPerformance]
    risks: list[ItemPerformance]
    unmatched_mentions: list[UnmatchedMention] = []
    briefing: ManagerBriefing


# ── Sentiment Analytics ───────────────────────────────────────────────────

class SentimentTrendPoint(BaseModel):
    month: str  # "2026-01"
    food_avg: float | None = None
    drink_avg: float | None = None
    ambiance_avg: float | None = None


class BucketHighlight(BaseModel):
    bucket: SentimentBucket
    best_snippet: str | None = None
    best_score: float | None = None
    worst_snippet: str | None = None
    worst_score: float | None = None


class SentimentAnalytics(BaseModel):
    buckets: list[BucketSentiment]
    trend: list[SentimentTrendPoint]
    highlights: list[BucketHighlight]


# ── Operations Analytics ──────────────────────────────────────────────────

class CategoryRevenue(BaseModel):
    category: str
    revenue: float
    order_count: int


class GuestTierCount(BaseModel):
    tier: str
    count: int


class OperationsAnalytics(BaseModel):
    review_velocity: float  # Reviews per week
    sentiment_momentum: float # Change in avg sentiment vs last period
    tier_distribution: list[GuestTierCount]
    total_guests: int
    platform_split: dict[str, int]  # {"google": 10, "yelp": 6}
