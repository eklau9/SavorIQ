"""SQLAlchemy ORM models for SavorIQ."""

import uuid
from datetime import datetime
from typing import List, Optional

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class Guest(Base):
    __tablename__ = "guests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String(254), unique=True, nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    tier: Mapped[str] = mapped_column(
        Enum("new", "regular", "vip", name="guest_tier"), default="new"
    )
    first_visit: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_visit: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    orders: Mapped[List["Order"]] = relationship(back_populates="guest", cascade="all, delete-orphan")
    reviews: Mapped[List["Review"]] = relationship(back_populates="guest", cascade="all, delete-orphan")


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    guest_id: Mapped[str] = mapped_column(String(36), ForeignKey("guests.id"), nullable=False)
    item_name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(
        Enum("food", "drink", name="order_category"), nullable=False
    )
    price: Mapped[float] = mapped_column(Float, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    ordered_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    guest: Mapped["Guest"] = relationship(back_populates="orders")


class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    guest_id: Mapped[str] = mapped_column(String(36), ForeignKey("guests.id"), nullable=False)
    platform: Mapped[str] = mapped_column(
        Enum("yelp", "google", name="review_platform"), nullable=False
    )
    platform_review_id: Mapped[Optional[str]] = mapped_column(String(100), unique=True, nullable=True)
    rating: Mapped[float] = mapped_column(Float, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    ingested_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

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
