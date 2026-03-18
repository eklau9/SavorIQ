"""Guest management endpoints — listing, metrics, and pulse."""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import Guest, InterceptAction, MenuItem, Order, Restaurant, Review
from app.schemas import GuestPulse, GuestRead, GuestPrioritized, ReviewRead, RestaurantRead
from app.services.cache import api_cache

router = APIRouter(prefix="/api", tags=["guests"])


@router.get("/restaurants", response_model=list[RestaurantRead])
async def list_restaurants(db: AsyncSession = Depends(get_db)):
    """List all restaurants for the tenant switcher."""
    result = await db.execute(select(Restaurant).order_by(Restaurant.name))
    return result.scalars().all()


@router.get("/guests", response_model=list[GuestRead])
async def list_guests(
    tier: str | None = None,
    sort_by: str = Query("recent", enum=["recent", "rating", "reviews"]),
    skip: int = Query(0, ge=0),
    limit: int = Query(10000, ge=1),
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db),
):
    """List all guests with advanced sorting and expanded limits, scoped to restaurant."""
    cache_suffix = f"{tier}:{sort_by}:{skip}:{limit}"
    cached = api_cache.get(x_restaurant_id, "guests", suffix=cache_suffix)
    if cached is not None:
        return cached

    print(f"DEBUG: list_guests called with limit={limit}, restaurant_id={x_restaurant_id}")
    
    # Subquery for guest metrics (avg rating, review count)
    subq = (
        select(
            Review.guest_id,
            func.max(Review.reviewed_at).label("latest_review"),
            func.avg(Review.rating).label("avg_rating"),
            func.count(Review.id).label("review_count")
        )
        .where(
            Review.restaurant_id == x_restaurant_id,
            Review.is_deleted_on_platform == False
        )
        .group_by(Review.guest_id)
        .subquery()
    )

    # Main query selecting Guest and metrics
    # Using INNER JOIN to ensure we only show guests who HAVE reviews
    query = (
        select(Guest, subq.c.avg_rating, subq.c.review_count)
        .where(Guest.restaurant_id == x_restaurant_id)
        .join(subq, Guest.id == subq.c.guest_id)
    )
    
    if tier:
        query = query.where(Guest.tier == tier)

    # Apply sorting
    if sort_by == "recent":
        # Sort by latest review date, or guest last visit, or guest creation
        query = query.order_by(func.coalesce(subq.c.latest_review, Guest.last_visit, Guest.created_at).desc())
    elif sort_by == "rating":
        query = query.order_by(func.coalesce(subq.c.avg_rating, 0).desc())
    elif sort_by == "reviews":
        query = query.order_by(func.coalesce(subq.c.review_count, 0).desc())

    # Apply pagination
    query = query.offset(skip).limit(limit)
    
    result = await db.execute(query)
    rows = result.all() # Each row is (Guest, avg_rating, review_count)
    
    print(f"DEBUG: list_guests returning {len(rows)} rows")
    
    out = []
    for g, avg, count in rows:
        # Create a dictionary instead of relying on model_validate to handle post-init attribute setting better
        res = {
            "id": g.id,
            "name": g.name,
            "email": g.email,
            "phone": g.phone,
            "tier": g.tier,
            "first_visit": g.first_visit.isoformat() if g.first_visit else None,
            "last_visit": g.last_visit.isoformat() if g.last_visit else None,
            "created_at": g.created_at.isoformat(),
            "avg_rating": round(float(avg), 1) if avg is not None else 0.0,
            "visit_count": count or 0
        }
        out.append(res)
        
    api_cache.set(x_restaurant_id, "guests", out, suffix=cache_suffix)
    return out


@router.get("/guests/priorities", response_model=list[GuestPrioritized])
async def list_guest_priorities(
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns a prioritized list of guests needing manager action for the current restaurant.
    """
    cached = api_cache.get(x_restaurant_id, "priorities")
    if cached is not None:
        return cached

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
        # Filter out deleted reviews before calculating metrics
        active_reviews = [r for r in g.reviews if not r.is_deleted_on_platform]
        review_count = len(active_reviews)
        avg_rating = sum(r.rating for r in active_reviews) / review_count if review_count > 0 else 0
        
        # 2. Review Engagement Score
        # Simple score based on review count and content length
        engagement_score = min(1.0, (review_count * 0.2) + (sum(len(r.content) for r in active_reviews) / 2000))
        
        # 3. Recency
        # Use active reviews for last visit if available
        last_visit_at = max((r.reviewed_at for r in active_reviews), default=g.last_visit)
        last_visit_days_ago = (now - last_visit_at).days if last_visit_at else 365
        
        # 4. Sentiment Analysis (buckets)
        bad_food_mentions = 0
        bad_service_mentions = 0
        for r in active_reviews:
            # Direct attribute access is faster than repeated lookups
            scores = r.sentiment_scores
            for s in scores:
                if s.score < -0.3:
                    bucket = s.bucket
                    if bucket == "food": 
                        bad_food_mentions += 1
                    elif bucket in ("ambiance", "service"): 
                        bad_service_mentions += 1

        # ── Segments ──
        score = 0
        segment = None
        reason = ""
        action = ""

        if review_count >= 5 and avg_rating >= 4.5:
            segment = "PROMOTER"
            score = 90
            reason = "Frequent high-rating reviewer"
            action = "Publicly thank and feature review"
        elif avg_rating < 2.5:
            segment = "VIP_AT_RISK"
            score = 95
            reason = "Consistently negative feedback"
            action = "Immediate owner response required"
        elif review_count >= 3 and last_visit_days_ago > 30:
            segment = "LOST_REGULAR"
            score = 75
            reason = "Frequent reviewer hasn't posted in 30+ days"
            action = "Send personalized 'We Miss You' note"

        if segment:
            # Check if we already have an action recorded
            action_key = f"{g.id}:{segment}"
            current_action = actions_map.get(action_key)
            status = current_action.status if current_action else "open"

            prioritized.append(GuestPrioritized(
                guest=GuestRead.model_validate(g),
                segment=segment,
                priority_score=score,
                reason=reason,
                recommended_action=action,
                last_visit_days_ago=last_visit_days_ago,
                review_count=review_count,
                review_engagement_score=engagement_score,
                current_status=status,
                current_action=current_action # Will be mapped by Pydantic
            ))

    # Sort by priority score DESC
    prioritized.sort(key=lambda x: x.priority_score, reverse=True)
    api_cache.set(x_restaurant_id, "priorities", prioritized)
    return prioritized


@router.post("/guests/{guest_id}/intercept/action")
async def guest_intercept_action(
    guest_id: str,
    payload: dict,
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db)
):
    """Record a manager action taken for a specific guest segment."""
    status = payload.get("status", "actioned")
    segment = payload.get("segment")
    notes = payload.get("notes")

    if not segment:
        raise HTTPException(status_code=400, detail="Segment is required")

    # Update or Create
    query = (
        select(InterceptAction)
        .where(
            InterceptAction.guest_id == guest_id,
            InterceptAction.segment == segment,
            InterceptAction.restaurant_id == x_restaurant_id
        )
    )
    result = await db.execute(query)
    action = result.scalar_one_or_none()

    if action:
        action.status = status
        action.notes = notes
        action.actioned_at = datetime.utcnow()
    else:
        action = InterceptAction(
            guest_id=guest_id,
            restaurant_id=x_restaurant_id,
            segment=segment,
            status=status,
            notes=notes
        )
        db.add(action)

    await db.commit()
    return {"status": "success", "id": action.id}


@router.get("/guests/{guest_id}", response_model=GuestRead)
async def get_guest(
    guest_id: str,
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db)
):
    """Retrieve full profile for a specific guest."""
    query = (
        select(Guest)
        .where(Guest.id == guest_id, Guest.restaurant_id == x_restaurant_id)
        .options(selectinload(Guest.reviews), selectinload(Guest.orders))
    )
    result = await db.execute(query)
    guest = result.scalar_one_or_none()
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")
    
    # Filter deleted reviews manually before returning
    guest.reviews = [r for r in guest.reviews if not r.is_deleted_on_platform]
    
    return guest


@router.get("/guests/{guest_id}/pulse", response_model=GuestPulse)
async def get_guest_pulse(
    guest_id: str,
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns the 'Guest Pulse' — an AI-friendly summary of a guest's loyalty,
    recent items, and sentiment across categories.
    """
    query = (
        select(Guest)
        .where(Guest.id == guest_id, Guest.restaurant_id == x_restaurant_id)
        .options(
            selectinload(Guest.orders),
            selectinload(Guest.reviews).selectinload(Review.sentiment_scores)
        )
    )
    result = await db.execute(query)
    guest = result.scalar_one_or_none()
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")

    # Metrics
    active_reviews = [r for r in guest.reviews if not r.is_deleted_on_platform]
    visit_count = len(active_reviews)
    
    # Calculate Engagement Score
    avg_length = sum(len(r.content) for r in active_reviews) / max(visit_count, 1)
    engagement_score = min(1.0, (visit_count * 0.15) + (avg_length / 500))

    # Favorite Items (Top 3 Mentions)
    # 1. Fetch menu items for keyword matching
    menu_result = await db.execute(
        select(MenuItem).where(MenuItem.restaurant_id == x_restaurant_id)
    )
    menu_items = menu_result.scalars().all()
    
    item_mentions: dict[str, int] = {}
    for r in active_reviews:
        content_lower = r.content.lower()
        for mi in menu_items:
            keywords = [k.strip().lower() for k in mi.keywords.split(",") if k.strip()]
            if any(kw in content_lower for kw in keywords):
                item_mentions[mi.name] = item_mentions.get(mi.name, 0) + 1
    
    favorite_items = sorted(item_mentions.keys(), key=lambda x: item_mentions[x], reverse=True)[:3]
    
    # Sentiment Summary By Bucket
    bucket_data: dict[str, list[float]] = {}
    for r in active_reviews:
        for s in r.sentiment_scores:
            bucket_data.setdefault(s.bucket, []).append(s.score)
    
    sentiment_summary = [
        {
            "bucket": b,
            "avg_score": round(sum(scores) / len(scores), 2),
            "review_count": len(scores)
        }
        for b, scores in bucket_data.items()
    ]

    # Build guest response with computed avg_rating
    guest_data = GuestRead.model_validate(guest)
    if visit_count > 0:
        guest_data.avg_rating = round(sum(r.rating for r in active_reviews) / visit_count, 1)
        guest_data.visit_count = visit_count

    return GuestPulse(
        guest=guest_data,
        favorite_items=favorite_items,
        visit_count=visit_count,
        review_engagement_score=round(engagement_score, 2),
        sentiment_summary=sentiment_summary,
        recent_reviews=active_reviews[:5]
    )
