"""Guest endpoints — CRUD + Guest Pulse aggregate."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi import APIRouter, Depends, HTTPException, Query

from app.database import get_db
from app.models import Guest, Order, Review, SentimentScore
from app.schemas import (
    BucketSentiment,
    GuestCreate,
    GuestPulse,
    GuestRead,
    ReviewRead,
)

router = APIRouter(prefix="/api/guests", tags=["guests"])


@router.get("", response_model=list[GuestRead])
async def list_guests(
    tier: str | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """List all guests with optional tier filter and pagination."""
    query = select(Guest)
    if tier:
        query = query.where(Guest.tier == tier)
    query = query.offset(skip).limit(limit).order_by(Guest.last_visit.desc())
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{guest_id}", response_model=GuestRead)
async def get_guest(guest_id: str, db: AsyncSession = Depends(get_db)):
    """Get a single guest by ID."""
    result = await db.execute(select(Guest).where(Guest.id == guest_id))
    guest = result.scalar_one_or_none()
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")
    return guest


@router.post("", response_model=GuestRead, status_code=201)
async def create_guest(data: GuestCreate, db: AsyncSession = Depends(get_db)):
    """Create a new guest."""
    guest = Guest(**data.model_dump())
    db.add(guest)
    await db.flush()
    return guest


@router.get("/{guest_id}/pulse", response_model=GuestPulse)
async def get_guest_pulse(guest_id: str, db: AsyncSession = Depends(get_db)):
    """
    Guest Pulse — aggregate view combining purchase data + review sentiment.
    """
    # Fetch guest
    result = await db.execute(select(Guest).where(Guest.id == guest_id))
    guest = result.scalar_one_or_none()
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")

    # Orders stats
    orders_result = await db.execute(
        select(Order).where(Order.guest_id == guest_id).order_by(Order.ordered_at.desc())
    )
    orders = orders_result.scalars().all()
    total_spend = sum(o.price * o.quantity for o in orders)

    # Unique visit dates
    visit_dates = {o.ordered_at.date() for o in orders}
    visit_count = len(visit_dates) if visit_dates else 1

    # Favorite items (top 3 by frequency)
    item_counts: dict[str, int] = {}
    for o in orders:
        item_counts[o.item_name] = item_counts.get(o.item_name, 0) + o.quantity
    favorite_items = sorted(item_counts, key=item_counts.get, reverse=True)[:3]

    # Reviews with sentiment
    reviews_result = await db.execute(
        select(Review)
        .where(Review.guest_id == guest_id)
        .options(selectinload(Review.sentiment_scores))
        .order_by(Review.reviewed_at.desc())
        .limit(10)
    )
    reviews = reviews_result.scalars().all()

    # Aggregate sentiment by bucket
    bucket_scores: dict[str, list[float]] = {"food": [], "drink": [], "ambiance": []}
    for r in reviews:
        for s in r.sentiment_scores:
            if s.bucket in bucket_scores:
                bucket_scores[s.bucket].append(s.score)

    # Cross-reference: check which categories the guest has ordered
    order_categories = {o.category for o in orders}  # {"food", "drink"}

    sentiment_summary = []
    for bucket, scores in bucket_scores.items():
        if scores:
            sentiment_summary.append(
                BucketSentiment(
                    bucket=bucket,
                    avg_score=round(sum(scores) / len(scores), 2),
                    review_count=len(scores),
                )
            )
        elif bucket in order_categories:
            # Guest ordered items in this category but no review mentions it
            sentiment_summary.append(
                BucketSentiment(
                    bucket=bucket,
                    avg_score=0.0,
                    review_count=0,
                )
            )

    return GuestPulse(
        guest=GuestRead.model_validate(guest),
        total_orders=len(orders),
        total_spend=round(total_spend, 2),
        favorite_items=favorite_items,
        visit_count=visit_count,
        sentiment_summary=sentiment_summary,
        recent_reviews=[ReviewRead.model_validate(r) for r in reviews],
    )
