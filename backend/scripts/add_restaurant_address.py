import asyncio
import os
import sys
from sqlalchemy import text
from app.database import engine

async def run_migration():
    print("🚀 Starting migration: adding 'address' column and indexes...")
    async with engine.begin() as conn:
        # Add Address Column
        try:
            await conn.execute(text("ALTER TABLE restaurants ADD COLUMN address VARCHAR(500)"))
            print("✅ Successfully added 'address' column.")
        except Exception as e:
            if "already exists" in str(e).lower():
                print("ℹ️ Column 'address' already exists.")
            else:
                print(f"❌ Error adding column: {e}")

        # Add Performance Indexes
        try:
            print("📈 Adding performance indexes to 'reviews' table...")
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_reviews_resto_date ON reviews (restaurant_id, reviewed_at DESC)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_reviews_platform ON reviews (platform)"))
            print("✅ Successfully added indexes.")
        except Exception as e:
            print(f"❌ Error adding indexes: {e}")

if __name__ == "__main__":
    asyncio.run(run_migration())
