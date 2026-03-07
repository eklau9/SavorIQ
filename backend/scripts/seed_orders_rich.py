
import asyncio
import os
import random
from datetime import datetime, timedelta
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool
from dotenv import load_dotenv

# Load environment variables
load_dotenv('.env')
DATABASE_URL = os.getenv('DATABASE_URL')
if "postgresql://" in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")

# Constants
HEYTEA_ID = "8bb477ed-37bf-48d4-acb1-285225a3629c"

ITEMS = [
    {"name": "Matcha drinks", "category": "drink", "price": 6.50},
    {"name": "Triple matcha supreme", "category": "drink", "price": 7.50},
    {"name": "Mango coconut boom supreme", "category": "drink", "price": 8.00},
    {"name": "Extra cream cheese foam", "category": "food", "price": 1.50},
    {"name": "Coconut mango blue", "category": "drink", "price": 7.00},
    {"name": "Cloud Longing Tea Latte", "category": "drink", "price": 6.00},
    {"name": "Supreme Brown Sugar Bobo Milk", "category": "drink", "price": 6.50},
    {"name": "Grape Fruit Boom", "category": "drink", "price": 7.20},
    {"name": "Roasted Brown Sugar Bobo", "category": "drink", "price": 6.80},
]

async def seed():
    engine = create_async_engine(
        DATABASE_URL,
        connect_args={
            "statement_cache_size": 0,
            "prepared_statement_cache_size": 0,
        },
        poolclass=NullPool
    )
    async with engine.begin() as conn:
        print(f"🌱 Seeding premium orders for Restaurant: {HEYTEA_ID}")
        
        # 1. Fetch guest IDs for this restaurant
        res_guests = await conn.execute(text("SELECT id FROM guests WHERE restaurant_id = :rid"), {"rid": HEYTEA_ID})
        guest_ids = [row[0] for row in res_guests.all()]
        
        if not guest_ids:
            print("❌ No guests found for Heytea. Please sync reviews first.")
            return

        print(f"Found {len(guest_ids)} guests. Generating orders...")

        # 2. Generate ~1500 orders to make it look active
        orders_to_insert = []
        start_date = datetime.utcnow() - timedelta(days=90)
        
        for _ in range(1500):
            item = random.choice(ITEMS)
            guest_id = random.choice(guest_ids)
            order_date = start_date + timedelta(
                days=random.randint(0, 90),
                hours=random.randint(0, 23),
                minutes=random.randint(0, 59)
            )
            
            orders_to_insert.append({
                "id": str(os.urandom(16).hex()), # Simple hex ID for raw insert
                "restaurant_id": HEYTEA_ID,
                "guest_id": guest_id,
                "item_name": item["name"],
                "category": item["category"],
                "price": item["price"],
                "quantity": random.randint(1, 3),
                "ordered_at": order_date
            })

        # 3. Bulk Insert
        await conn.execute(
            text("""
                INSERT INTO orders (id, restaurant_id, guest_id, item_name, category, price, quantity, ordered_at)
                VALUES (:id, :restaurant_id, :guest_id, :item_name, :category, :price, :quantity, :ordered_at)
            """),
            orders_to_insert
        )
        
        print(f"✅ Successfully seeded 1500 orders for Heytea!")

if __name__ == "__main__":
    asyncio.run(seed())
