"""Guest endpoints — CRUD + Guest Pulse aggregate."""

from __future__ import annotations

from datetime import datetime

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
    GuestSegment,
    GuestPrioritized,
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


@router.get("/priorities", response_model=list[GuestPrioritized])
async def list_guest_priorities(db: AsyncSession = Depends(get_db)):
    """
    Returns a prioritized list of guests needing manager action.
    Applies segmentation logic based on spend, visit frequency, and sentiment.
    """
    # Load all guests with their orders and reviews/sentiment
    query = (
        select(Guest)
        .options(
            selectinload(Guest.orders),
            selectinload(Guest.reviews).selectinload(Review.sentiment_scores)
        )
    )
    result = await db.execute(query)
    guests = result.scalars().all()
    
    now = datetime.utcnow()
    prioritized = []

    for g in guests:
        # Calculate base metrics
        total_spend = sum(o.price * o.quantity for o in g.orders)
        last_visit = g.last_visit or g.created_at
        days_since_visit = (now - last_visit).days
        
        avg_sentiment = 0.0
        review_count = 0
        all_scores = []
        for r in g.reviews:
            all_scores.extend([s.score for s in r.sentiment_scores])
        
        if all_scores:
            avg_sentiment = sum(all_scores) / len(all_scores)
            review_count = len(all_scores)

        # ── Segmentation Logic ──
        segment = None
        reason = ""
        action = ""
        priority = 0.0

        # 1. VIP at Risk (CRITICAL)
        if g.reviews and g.tier == "vip" and avg_sentiment < -0.2:
            segment = GuestSegment.vip_at_risk
            reason = f"VIP guest with negative sentiment ({avg_sentiment:.2f}) across {review_count} reviews."
            action = "Personal reach-out by GM. Offer a complimentary meal or private tasting."
            priority = 1.0

        # 2. Lost Regular (HIGH)
        elif g.reviews and g.tier == "regular" and days_since_visit > 14:
            segment = GuestSegment.lost_regular
            reason = f"Regular guest who hasn't visited in {days_since_visit} days."
            action = "Send a 'We Miss You' email with a loyalty bonus or free beverage coupon."
            priority = 0.8

        # 3. New Big Spender (MEDIUM)
        elif g.reviews and g.tier == "new" and total_spend > 50:
            segment = GuestSegment.new_big_spender
            reason = f"New guest with high initial spend (${total_spend:.2f})."
            action = "Personal welcome note. Ensure they are invited to the loyalty program on next visit."
            priority = 0.6

        # 4. Promoter (LOW/MONITOR)
        elif g.reviews and avg_sentiment > 0.6 and total_spend > 100:
            segment = GuestSegment.promoter
            reason = f"High-value advocate with positive sentiment ({avg_sentiment:.2f})."
            action = "Thank them for their support. Consider for exclusive 'Insider' events."
            priority = 0.4

        if segment:
            prioritized.append(
                GuestPrioritized(
                    guest=GuestRead.model_validate(g),
                    segment=segment,
                    priority_score=priority,
                    reason=reason,
                    recommended_action=action,
                    total_spend=round(total_spend, 2),
                    last_visit_days_ago=days_since_visit
                )
            )

    # Sort by priority score (desc)
    prioritized.sort(key=lambda x: x.priority_score, reverse=True)
    return prioritized


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


