"""SQLAlchemy ORM models for SavorIQ."""

import uuid
from datetime import datetime
from typing import List, Optional

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class Restaurant(Base):
    __tablename__ = "restaurants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    address: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    guests: Mapped[List["Guest"]] = relationship(back_populates="restaurant", cascade="all, delete-orphan")
    orders: Mapped[List["Order"]] = relationship(back_populates="restaurant", cascade="all, delete-orphan")
    reviews: Mapped[List["Review"]] = relationship(back_populates="restaurant", cascade="all, delete-orphan")


class Guest(Base):
    __tablename__ = "guests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    restaurant_id: Mapped[str] = mapped_column(String(36), ForeignKey("restaurants.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String(254), nullable=True) # Removed unique constraint across tenants
    phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    tier: Mapped[str] = mapped_column(
        Enum("new", "regular", "vip", "slipping", name="guest_tier"), default="new"
    )
    first_visit: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_visit: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    restaurant: Mapped["Restaurant"] = relationship(back_populates="guests")
    orders: Mapped[List["Order"]] = relationship(back_populates="guest", cascade="all, delete-orphan")
    reviews: Mapped[List["Review"]] = relationship(back_populates="guest", cascade="all, delete-orphan")


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    restaurant_id: Mapped[str] = mapped_column(String(36), ForeignKey("restaurants.id"), nullable=False)
    guest_id: Mapped[str] = mapped_column(String(36), ForeignKey("guests.id"), nullable=False)
    item_name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(
        Enum("food", "drink", name="order_category"), nullable=False
    )
    price: Mapped[float] = mapped_column(Float, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    ordered_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    restaurant: Mapped["Restaurant"] = relationship(back_populates="orders")
    guest: Mapped["Guest"] = relationship(back_populates="orders")


class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    restaurant_id: Mapped[str] = mapped_column(String(36), ForeignKey("restaurants.id"), nullable=False, index=True)
    guest_id: Mapped[str] = mapped_column(String(36), ForeignKey("guests.id"), nullable=False, index=True)
    platform: Mapped[str] = mapped_column(
        Enum("yelp", "google", name="review_platform"), nullable=False, index=True
    )
    platform_review_id: Mapped[Optional[str]] = mapped_column(String(100), unique=True, nullable=True)
    rating: Mapped[float] = mapped_column(Float, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    ingested_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    is_deleted_on_platform: Mapped[bool] = mapped_column(Boolean, default=False)

    restaurant: Mapped["Restaurant"] = relationship(back_populates="reviews")
    guest: Mapped["Guest"] = relationship(back_populates="reviews")
    sentiment_scores: Mapped[List["SentimentScore"]] = relationship(
        back_populates="review", cascade="all, delete-orphan"
    )


class SentimentScore(Base):
    __tablename__ = "sentiment_scores"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    review_id: Mapped[str] = mapped_column(String(36), ForeignKey("reviews.id"), nullable=False)
    bucket: Mapped[str] = mapped_column(
        Enum("food", "drink", "ambiance", name="sentiment_bucket"), nullable=False
    )
    score: Mapped[float] = mapped_column(Float, nullable=False)  # -1.0 to 1.0
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    analyzed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    review: Mapped["Review"] = relationship(back_populates="sentiment_scores")


class InterceptAction(Base):
    __tablename__ = "intercept_actions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    restaurant_id: Mapped[str] = mapped_column(String(36), ForeignKey("restaurants.id"), nullable=False)
    guest_id: Mapped[str] = mapped_column(String(36), ForeignKey("guests.id"), nullable=False)
    status: Mapped[str] = mapped_column(
        Enum("open", "actioned", "resolved", "dismissed", name="intercept_status"),
        default="open"
    )
    segment: Mapped[str] = mapped_column(String(50), nullable=False)  # e.g., "VIP_AT_RISK"
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    actioned_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    guest: Mapped["Guest"] = relationship()


class SyncLog(Base):
    """Tracks the last time reviews were synced for a business on each platform."""
    __tablename__ = "sync_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    restaurant_id: Mapped[str] = mapped_column(String(36), ForeignKey("restaurants.id"), nullable=False)
    platform: Mapped[str] = mapped_column(
        Enum("yelp", "google", name="sync_platform"), nullable=False
    )
    business_id: Mapped[str] = mapped_column(String(200), nullable=False)  # Yelp biz ID or Google place ID
    business_name: Mapped[str] = mapped_column(String(300), nullable=False)
    last_synced_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    reviews_fetched: Mapped[int] = mapped_column(Integer, default=0)
    new_reviews: Mapped[int] = mapped_column(Integer, default=0)
    
    # "Ground Truth" fields — captured from platform search API (cheap)
    platform_total_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    platform_rating: Mapped[Optional[float]] = mapped_column(Float, nullable=True)


class MenuItem(Base):
    """A menu item belonging to a specific restaurant, with keyword aliases for review matching."""
    __tablename__ = "menu_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    restaurant_id: Mapped[str] = mapped_column(String(36), ForeignKey("restaurants.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(
        Enum("food", "drink", name="menu_category", create_constraint=False), nullable=False
    )
    keywords: Mapped[str] = mapped_column(Text, nullable=False)  # Comma-separated aliases, e.g. "matcha latte,matcha"
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    restaurant: Mapped["Restaurant"] = relationship()

