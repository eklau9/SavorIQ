"""Create the menu_items table in Supabase and seed Heytea's menu.

Usage:
    python migrate_menu_items.py
"""

import asyncio
import os
import uuid
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from sqlalchemy.pool import NullPool

load_dotenv(".env")
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("❌ ERROR: DATABASE_URL is not set in .env")
    exit(1)

if "postgresql://" in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")


def get_uuid() -> str:
    return str(uuid.uuid4()).replace("-", "_")


engine = create_async_engine(
    DATABASE_URL,
    connect_args={
        "statement_cache_size": 0,
        "prepared_statement_cache_size": 0,
        "prepared_statement_name_func": lambda: f"stmt_{get_uuid()}",
    },
    poolclass=NullPool,
)

# Heytea's current menu items (migrated from hardcoded MENU_ITEMS in analytics.py)
HEYTEA_MENU = [
    {"name": "Cheese Foam Green Tea",        "category": "drink", "keywords": "cheese foam,cream cheese foam,cheezo"},
    {"name": "Brown Sugar Bobo",             "category": "drink", "keywords": "brown sugar bobo,bobo"},
    {"name": "Mango Coconut Boom",           "category": "drink", "keywords": "mango coconut boom,mango coconut"},
    {"name": "Supreme Brown Sugar Bobo Milk","category": "drink", "keywords": "supreme brown sugar,bobo milk"},
    {"name": "Triple Matcha Supreme",        "category": "drink", "keywords": "triple matcha"},
    {"name": "Coconut Mango Blue",           "category": "drink", "keywords": "coconut mango blue,coconut mango"},
    {"name": "Jasmine Milk Tea",             "category": "drink", "keywords": "jasmine milk tea,jasmine tea,jasmine"},
    {"name": "Green Grape Boom",             "category": "drink", "keywords": "grape boom,green grape,grape"},
    {"name": "Passion Fruit Tea",            "category": "drink", "keywords": "passion fruit"},
    {"name": "Kale Boost",                   "category": "drink", "keywords": "kale boost,kale"},
    {"name": "Mochi Topping",                "category": "food",  "keywords": "mochi"},
]


async def run_migration():
    print("🍽️  Menu Items Migration")

    async with engine.begin() as conn:
        # 1. Create the menu_items table
        print("\n1️⃣  Creating `menu_items` table...")
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS menu_items (
                id VARCHAR(36) PRIMARY KEY,
                restaurant_id VARCHAR(36) NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
                name VARCHAR(200) NOT NULL,
                category VARCHAR(20) NOT NULL,
                keywords TEXT NOT NULL,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
            );
        """))
        print("  ✅ Table created")

        # 2. Find the Heytea restaurant
        result = await conn.execute(text(
            "SELECT id FROM restaurants WHERE name = 'Heytea' LIMIT 1"
        ))
        row = result.first()
        if not row:
            print("  ❌ No 'Heytea' restaurant found — skipping seed")
            return

        heytea_id = row[0]
        print(f"\n2️⃣  Seeding menu items for Heytea (ID: {heytea_id})...")

        # Check how many already exist
        existing = await conn.execute(text(
            "SELECT COUNT(*) FROM menu_items WHERE restaurant_id = :rid"
        ), {"rid": heytea_id})
        existing_count = existing.scalar()

        if existing_count > 0:
            print(f"  ⚠️  {existing_count} menu items already exist — skipping seed")
            return

        # 3. Insert menu items
        for item in HEYTEA_MENU:
            item_id = str(uuid.uuid4())
            await conn.execute(text("""
                INSERT INTO menu_items (id, restaurant_id, name, category, keywords, is_active, created_at)
                VALUES (:id, :rid, :name, :category, :keywords, TRUE, NOW())
            """), {
                "id": item_id,
                "rid": heytea_id,
                "name": item["name"],
                "category": item["category"],
                "keywords": item["keywords"],
            })
            print(f"  ✅ {item['name']}")

        print(f"\n🎉 Seeded {len(HEYTEA_MENU)} menu items for Heytea!")


if __name__ == "__main__":
    asyncio.run(run_migration())
