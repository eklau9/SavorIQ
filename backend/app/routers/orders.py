"""Order endpoints — history + bulk ingest."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import APIRouter, Depends, Query, Header, HTTPException
from app.database import get_db
from app.models import Order, Guest
from app.schemas import OrderIngestionReport, OrderRead
from app.services.ingestion import ingest_orders

router = APIRouter(prefix="/api", tags=["orders"])


@router.get("/guests/{guest_id}/orders", response_model=list[OrderRead])
async def list_guest_orders(
    guest_id: str,
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Get order history for a specific guest, scoped to restaurant."""
    # Verify guest belongs to this restaurant
    guest_result = await db.execute(
        select(Guest).where(Guest.id == guest_id, Guest.restaurant_id == x_restaurant_id)
    )
    if not guest_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Guest not found in this restaurant")

    result = await db.execute(
        select(Order)
        .where(Order.guest_id == guest_id)
        .order_by(Order.ordered_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()


@router.post("/orders/ingest", response_model=OrderIngestionReport)
async def ingest_orders_endpoint(
    payload: dict,
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db),
):
    """Bulk ingest orders from JSON. Expects {"orders": [...]}, scoped to restaurant."""
    orders_data = payload.get("orders", [])
    report = await ingest_orders(db, x_restaurant_id, orders_data)
    await db.commit()
    return report
