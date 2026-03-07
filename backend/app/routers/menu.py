"""Menu item CRUD endpoints — manage a restaurant's menu items."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import MenuItem
from app.schemas import MenuItemCreate, MenuItemRead

router = APIRouter(prefix="/api/menu", tags=["menu"])


@router.get("", response_model=list[MenuItemRead])
async def list_menu_items(
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db),
):
    """List all active menu items for a restaurant."""
    result = await db.execute(
        select(MenuItem)
        .where(MenuItem.restaurant_id == x_restaurant_id, MenuItem.is_active == True)
        .order_by(MenuItem.name)
    )
    return result.scalars().all()


@router.post("", response_model=MenuItemRead, status_code=201)
async def create_menu_item(
    payload: MenuItemCreate,
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db),
):
    """Add a new menu item to the restaurant's menu."""
    item = MenuItem(
        restaurant_id=x_restaurant_id,
        name=payload.name,
        category=payload.category,
        keywords=payload.keywords,
    )
    db.add(item)
    await db.flush()
    await db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
async def deactivate_menu_item(
    item_id: str,
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db),
):
    """Soft-delete (deactivate) a menu item."""
    result = await db.execute(
        select(MenuItem).where(
            MenuItem.id == item_id,
            MenuItem.restaurant_id == x_restaurant_id,
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Menu item not found")
    item.is_active = False
    await db.flush()
