"""Guest endpoints — CRUD + Guest Pulse aggregate."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi import APIRouter, Depends, HTTPException, Query, Header
from typing import Optional

from app.database import get_db
from app.schemas import (
    BucketSentiment,
    GuestCreate,
    GuestPulse,
    GuestRead,
    GuestSegment,
    GuestPrioritized,
    ReviewRead,
    InterceptStatus,
    InterceptActionCreate,
    InterceptActionRead,
)
from app.models import Guest, Order, Review, SentimentScore, InterceptAction, Restaurant

router = APIRouter(prefix="/api", tags=["guests"])


@router.get("/restaurants")
async def list_restaurants(db: AsyncSession = Depends(get_db)):
    """List all restaurants for the tenant switcher."""
    result = await db.execute(select(Restaurant).order_by(Restaurant.name))
    return result.scalars().all()


@router.get("/guests", response_model=list[GuestRead])
async def list_guests(
    tier: str | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db),
):
    """List all guests with optional tier filter and pagination, scoped to restaurant."""
    query = select(Guest).where(Guest.restaurant_id == x_restaurant_id)
    if tier:
        query = query.where(Guest.tier == tier)
    query = query.offset(skip).limit(limit).order_by(Guest.last_visit.desc())
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/guests/priorities", response_model=list[GuestPrioritized])
async def list_guest_priorities(
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns a prioritized list of guests needing manager action for the current restaurant.
    """
    # Load guests for this restaurant with related data
    query = (
        select(Guest)
        .where(Guest.restaurant_id == x_restaurant_id)
        .options(
            selectinload(Guest.orders),
            selectinload(Guest.reviews).selectinload(Review.sentiment_scores)
        )
    )
    result = await db.execute(query)
    guests = result.scalars().all()
    
    # Load existing actions for this restaurant
    actions_result = await db.execute(
        select(InterceptAction).where(InterceptAction.restaurant_id == x_restaurant_id)
    )
    all_actions = actions_result.scalars().all()
    # Map by guest_id
    actions_map: dict[str, InterceptAction] = {f"{a.guest_id}:{a.segment}": a for a in all_actions}

    now = datetime.utcnow()
    prioritized = []

    for g in guests:
        # 1. Review Frequency calculation
        review_count = len(g.reviews)
        is_vip = review_count >= 3
        
        # 2. Sentiment calculation
        all_sentiment_scores = []
        low_rating_reviews = [r for r in g.reviews if r.rating <= 2]
        latest_review = g.reviews[0] if g.reviews else None # reviews are sorted by reviewed_at desc in relationship if we had it, but let's sort manually to be sure
        
        sorted_reviews = sorted(g.reviews, key=lambda x: x.reviewed_at, reverse=True)
        latest_review = sorted_reviews[0] if sorted_reviews else None
        
        for r in g.reviews:
            all_sentiment_scores.extend([s.score for s in r.sentiment_scores])
        
        avg_sentiment = sum(all_sentiment_scores) / len(all_sentiment_scores) if all_sentiment_scores else 0.0
        total_spend = sum(o.price * o.quantity for o in g.orders)
        
        # ── Segmentation Logic ──
        segment = None
        reason = ""
        action = ""
        priority = 0.0

        # Logic A: VIP with 1-2 star review (CRITICAL)
        if is_vip and any(r.rating <= 2 for r in g.reviews):
            segment = GuestSegment.vip_at_risk
            reason = f"VIP reviewer ({review_count} reviews) left a low rating."
            action = "Personal outreach by GM. High influence guest."
            priority = 1.0

        # Logic B: Regular/New with 1-2 star review (HIGH)
        elif any(r.rating <= 2 for r in g.reviews):
            segment = GuestSegment.lost_regular if review_count >= 2 else GuestSegment.new_big_spender
            reason = f"Guest left a critical review ({latest_review.rating if latest_review else '?'}/5 stars)."
            action = "Standard recovery playbook: Reply to review + offer incentive."
            priority = 0.7

        # Note: 3-star reviews are ignored for Priority Inbox per user request

        if segment:
            # 3. Resolution & Auto-logic
            action_key = f"{g.id}:{segment.value}"
            existing_action = actions_map.get(action_key)
            status = InterceptStatus.open
            notes = None
            
            if existing_action:
                status = InterceptStatus(existing_action.status)
                notes = existing_action.notes

            # Auto-Dismiss Logic: 3 months (90 days) or 6 months (180 days) for VIPs
            days_since_review = (now - latest_review.reviewed_at).days if latest_review else 0
            dismiss_threshold = 180 if is_vip else 90
            
            if status == InterceptStatus.open and days_since_review > dismiss_threshold:
                status = InterceptStatus.dismissed
                # Persist auto-dismiss? For now just reflect in response
            
            # Auto-Resolve Logic: Newer review is 4-5 stars
            if status in [InterceptStatus.open, InterceptStatus.actioned] and latest_review and latest_review.rating >= 4:
                # Need to check if there WAS a bad review BEFORE this good one
                has_bad_review_previously = any(r.rating <= 2 and r.reviewed_at < latest_review.reviewed_at for r in g.reviews)
                if has_bad_review_previously:
                    status = InterceptStatus.resolved
                    notes = notes or "Auto-resolved: Guest left a follow-up 4-5 star review."

            # Only show Open, Actioned, and maybe recently Resolved? 
            # Usually Priority Inbox is for things needing work.
            if status in [InterceptStatus.open, InterceptStatus.actioned]:
                prioritized.append(
                    GuestPrioritized(
                        guest=GuestRead.model_validate(g),
                        segment=segment,
                        priority_score=priority,
                        reason=reason,
                        recommended_action=action,
                        total_spend=round(total_spend, 2),
                        last_visit_days_ago=(now - (g.last_visit or g.created_at)).days,
                        review_count=review_count,
                        current_status=status,
                        current_action=InterceptActionRead.model_validate(existing_action) if existing_action else None
                    )
                )

    # Sort by priority score (desc)
    prioritized.sort(key=lambda x: x.priority_score, reverse=True)
    return prioritized


@router.post("/guests/{guest_id}/intercept/action", response_model=InterceptActionRead)
async def mark_intercept_action(
    guest_id: str,
    data: InterceptActionCreate,
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db)
):
    """Update the status of a guest intercept scoped to restaurant."""
    # Check if guest exists in this restaurant
    guest_result = await db.execute(
        select(Guest).where(Guest.id == guest_id, Guest.restaurant_id == x_restaurant_id)
    )
    if not guest_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Guest not found in this restaurant")

    # Check for existing action for this guest + segment
    query = select(InterceptAction).where(
        InterceptAction.restaurant_id == x_restaurant_id,
        InterceptAction.guest_id == guest_id,
        InterceptAction.segment == data.segment
    )
    result = await db.execute(query)
    action = result.scalar_one_or_none()

    if action:
        # Update existing
        action.status = data.status.value
        action.notes = data.notes
        # Updated_at will be handled by onupdate
    else:
        # Create new
        action = InterceptAction(
            restaurant_id=x_restaurant_id,
            guest_id=guest_id,
            status=data.status.value,
            segment=data.segment,
            notes=data.notes
        )
        db.add(action)

    await db.flush()
    return action


@router.get("/guests/{guest_id}", response_model=GuestRead)
async def get_guest(
    guest_id: str, 
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db)
):
    """Get a single guest by ID, scoped to restaurant."""
    result = await db.execute(
        select(Guest).where(Guest.id == guest_id, Guest.restaurant_id == x_restaurant_id)
    )
    guest = result.scalar_one_or_none()
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")
    return guest


@router.post("/guests", response_model=GuestRead, status_code=201)
async def create_guest(
    data: GuestCreate, 
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db)
):
    """Create a new guest for the restaurant."""
    guest = Guest(**data.model_dump(), restaurant_id=x_restaurant_id)
    db.add(guest)
    await db.flush()
    return guest


@router.get("/guests/{guest_id}/pulse", response_model=GuestPulse)
async def get_guest_pulse(
    guest_id: str, 
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    Guest Pulse — aggregate view combining purchase data + review sentiment, scoped to restaurant.
    """
    # Fetch guest
    result = await db.execute(
        select(Guest).where(Guest.id == guest_id, Guest.restaurant_id == x_restaurant_id)
    )
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


