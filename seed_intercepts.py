
import json
import httpx
import asyncio
from datetime import datetime, timedelta

BASE_URL = "http://localhost:8000/api"

async def seed_intercepts():
    async with httpx.AsyncClient(timeout=30.0) as client:
        timestamp = datetime.now().strftime("%H%M%S")
        
        # 1. Create a "VIP at Risk" Guest
        vip_name = f"VIP-{timestamp}"
        vip_email = f"vip.{timestamp}@email.com"
        
        print(f"Creating VIP at Risk: {vip_name}...")
        
        # Using more realistic, premium dish names: "Dry-Aged Wagyu Tomahawk"
        vip_orders = []
        for i in range(11):
            vip_orders.append({
                "guest_name": vip_name,
                "guest_email": vip_email,
                "item_name": "Dry-Aged Wagyu Tomahawk",
                "category": "food",
                "price": 125.00,
                "quantity": 1,
                "ordered_at": (datetime.utcnow() - timedelta(days=2)).isoformat()
            })
        
        await client.post(f"{BASE_URL}/orders/ingest", json={"orders": vip_orders})
        await client.post(f"{BASE_URL}/reviews/ingest", json={
            "platform": "yelp",
            "reviews": [
                {
                    "review_id": f"yelp-vip-risk-{timestamp}",
                    "guest_name": vip_name,
                    "guest_email": vip_email,
                    "rating": 1.0,
                    "text": "The dry-aged steak was tough and overcooked. For this price, I expected perfection. Extremely disappointing.",
                    "date": (datetime.utcnow() - timedelta(days=1)).isoformat()
                }
            ]
        })

        # 2. Create a "Lost Regular" Guest
        lost_name = f"Reg-{timestamp}"
        lost_email = f"reg.{timestamp}@email.com"
        
        print(f"Creating Lost Regular: {lost_name}...")
        
        # Using "Truffle Tagliatelle" and "Vintage Barolo"
        lost_orders = []
        for i in range(5):
            lost_orders.append({
                "guest_name": lost_name,
                "guest_email": lost_email,
                "item_name": "Truffle Tagliatelle",
                "category": "food",
                "price": 38.00,
                "quantity": 1,
                "ordered_at": (datetime.utcnow() - timedelta(days=20)).isoformat()
            })
        
        await client.post(f"{BASE_URL}/orders/ingest", json={"orders": lost_orders})
        await client.post(f"{BASE_URL}/reviews/ingest", json={
            "platform": "google",
            "reviews": [
                {
                    "review_id": f"google-lost-reg-{timestamp}",
                    "author_name": lost_name,
                    "author_email": lost_email,
                    "rating": 2.0,
                    "text": "I used to love the truffle pasta here, but it's been a while and the menu hasn't evolved. Waiting for something new.",
                    "time": (datetime.utcnow() - timedelta(days=21)).isoformat()
                }
            ]
        })

        # 3. Create a Guest who SHOULD BE FILTERED (meets criteria but NO REVIEWS)
        filtered_name = f"NoReview-{timestamp}"
        filtered_email = f"norev.{timestamp}@email.com"
        
        print(f"Creating Filtered Guest: {filtered_name}...")
        
        # Using "Wild-Caught Chilean Sea Bass"
        filtered_orders = []
        for i in range(11):
            filtered_orders.append({
                "guest_name": filtered_name,
                "guest_email": filtered_email,
                "item_name": "Wild-Caught Chilean Sea Bass",
                "category": "food",
                "price": 54.00,
                "quantity": 1,
                "ordered_at": (datetime.utcnow() - timedelta(days=1)).isoformat()
            })
        
        await client.post(f"{BASE_URL}/orders/ingest", json={"orders": filtered_orders})

if __name__ == "__main__":
    asyncio.run(seed_intercepts())
