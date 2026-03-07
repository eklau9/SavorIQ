
import os
import random
import uuid
import psycopg2
from psycopg2.extras import execute_values
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Load environment variables
load_dotenv('.env')
DATABASE_URL = os.getenv('DATABASE_URL')
# psycopg2 doesn't use the asyncpg prefix
if "postgresql+asyncpg://" in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")

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

def seed():
    print(f"🌱 [SYNC] Seeding premium orders for Restaurant: {HEYTEA_ID}")
    
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
        
        # 1. Fetch guest IDs
        cur.execute("SELECT id FROM guests WHERE restaurant_id = %s", (HEYTEA_ID,))
        guest_ids = [row[0] for row in cur.fetchall()]
        
        if not guest_ids:
            print("❌ No guests found for Heytea.")
            return

        print(f"Found {len(guest_ids)} guests. Generating 1500 orders...")

        # 2. Generate orders
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
            
            orders_to_insert.append((
                str(uuid.uuid4()),
                HEYTEA_ID,
                guest_id,
                item["name"],
                item["category"],
                item["price"],
                random.randint(1, 3),
                order_date
            ))

        # 3. Bulk Insert
        query = """
            INSERT INTO orders (id, restaurant_id, guest_id, item_name, category, price, quantity, ordered_at)
            VALUES %s
        """
        execute_values(cur, query, orders_to_insert)
        
        conn.commit()
        print(f"✅ Successfully seeded 1500 orders for Heytea!")
        
        cur.close()
        conn.close()
        
    except Exception as e:
        print(f"❌ Error during sync seeding: {e}")

if __name__ == "__main__":
    seed()
