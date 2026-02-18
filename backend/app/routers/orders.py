"""Order endpoints — history + bulk ingest."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import APIRouter, Depends, Query

from app.database import get_db
from app.models import Order
from app.schemas import OrderIngestionReport, OrderRead
from app.services.ingestion import ingest_orders

router = APIRouter(prefix="/api", tags=["orders"])


@router.get("/guests/{guest_id}/orders", response_model=list[OrderRead])
async def list_guest_orders(
    guest_id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Get order history for a specific guest."""
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
    db: AsyncSession = Depends(get_db),
):
    """Bulk ingest orders from JSON. Expects {"orders": [...]}."""
    orders_data = payload.get("orders", [])
    report = await ingest_orders(db, orders_data)
    return report
