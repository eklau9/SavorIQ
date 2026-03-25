"""Menu item CRUD endpoints — manage a restaurant's menu items."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional

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


# ── Photo Upload & Extraction ────────────────────────────────────────────

class PhotoExtractRequest(BaseModel):
    image_base64: str  # Base64-encoded image data (no data:image prefix)


class ExtractedMenuItem(BaseModel):
    name: str
    category: str  # "food" or "drink"
    price: Optional[float] = None
    keywords: str


class BulkAddRequest(BaseModel):
    items: List[ExtractedMenuItem]


@router.post("/extract-from-photo", response_model=List[ExtractedMenuItem])
async def extract_from_photo(
    payload: PhotoExtractRequest,
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
):
    """Extract menu items from a photo using Gemini Vision.
    
    Returns extracted items for user review/confirmation before saving.
    """
    from app.services.discovery import extract_menu_from_image
    from app.services.gemini_tracker import record_gemini_request

    raw_items = await extract_menu_from_image(payload.image_base64)
    record_gemini_request()

    # Normalize the results
    items = []
    for item in raw_items:
        category = item.get("category", "food").lower()
        if category not in ("food", "drink"):
            category = "food"
        items.append(ExtractedMenuItem(
            name=item.get("name", "Unknown"),
            category=category,
            price=item.get("price"),
            keywords=item.get("keywords", item.get("name", "").lower()),
        ))

    return items


@router.post("/merge", response_model=List[MenuItemRead])
async def merge_menu_items(
    payload: BulkAddRequest,
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db),
):
    """Add items to the menu without deleting existing ones.
    
    Deduplicates by name (case-insensitive). Existing items with the same
    name are kept; only new items are inserted.
    """
    # Get existing item names for dedup
    result = await db.execute(
        select(MenuItem.name)
        .where(MenuItem.restaurant_id == x_restaurant_id, MenuItem.is_active == True)
    )
    existing_names = {name.lower() for name in result.scalars().all()}

    added = []
    for item_data in payload.items:
        if item_data.name.lower() in existing_names:
            continue  # Skip duplicates
        category = item_data.category.lower()
        if category not in ("food", "drink"):
            category = "food"
        item = MenuItem(
            restaurant_id=x_restaurant_id,
            name=item_data.name,
            category=category,
            keywords=item_data.keywords,
        )
        db.add(item)
        await db.flush()
        await db.refresh(item)
        added.append(item)
        existing_names.add(item_data.name.lower())

    # Return full list (existing + newly added)
    all_result = await db.execute(
        select(MenuItem)
        .where(MenuItem.restaurant_id == x_restaurant_id, MenuItem.is_active == True)
        .order_by(MenuItem.name)
    )
    return all_result.scalars().all()


@router.post("/bulk-add", response_model=List[MenuItemRead])
async def bulk_add_menu_items(
    payload: BulkAddRequest,
    x_restaurant_id: str = Header(..., alias="X-Restaurant-ID"),
    db: AsyncSession = Depends(get_db),
):
    """Save confirmed menu items. Clears existing items and replaces with the new set."""
    # Clear existing menu items for this restaurant
    await db.execute(
        delete(MenuItem).where(MenuItem.restaurant_id == x_restaurant_id)
    )

    saved = []
    for item_data in payload.items:
        category = item_data.category.lower()
        if category not in ("food", "drink"):
            category = "food"
        item = MenuItem(
            restaurant_id=x_restaurant_id,
            name=item_data.name,
            category=category,
            keywords=item_data.keywords,
        )
        db.add(item)
        await db.flush()
        await db.refresh(item)
        saved.append(item)

    return saved

