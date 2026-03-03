import asyncio
import httpx
import json
from datetime import datetime, timedelta

async def seed_priority_test():
    url = "http://localhost:8000"
    
    # 1. Create a VIP At-Risk Guest
    print("Seeding At-Risk VIP...")
    guest_res = await httpx.AsyncClient().post(f"{url}/api/guests", json={
        "name": "Legacy VIP",
        "email": "vip_risk@savoriq_test.com",
        "tier": "vip"
    })
    vip = guest_res.json()
    
    # Add expensive order
    await httpx.AsyncClient().post(f"{url}/api/orders/ingest", json={
        "orders": [
            {
                "guest_name": "Legacy VIP",
                "item_name": "Wagyu Steak",
                "category": "food",
                "price": 95.0,
                "quantity": 1,
                "ordered_at": datetime.utcnow().isoformat()
            }
        ]
    })
    
    # Add negative review
    await httpx.AsyncClient().post(f"{url}/api/reviews/ingest", json={
        "platform": "google",
        "reviews": [
            {
                "review_id": "vip_bad_rev",
                "author_name": "Legacy VIP",
                "rating": 1.0,
                "text": "Extremely disappointed. The steak was overcooked and the ambiance was loud and dirty. Not worth it for a regular like me.",
                "time": datetime.utcnow().isoformat()
            }
        ]
    })

    # 2. Create a Lost Regular
    print("Seeding Lost Regular...")
    lost_res = await httpx.AsyncClient().post(f"{url}/api/guests", json={
        "name": "Silent Regular",
        "email": "lost_reg@savoriq_test.com",
        "tier": "regular"
    })
    lost = lost_res.json()
    
    # Add old order (20 days ago)
    old_date = (datetime.utcnow() - timedelta(days=20)).isoformat()
    await httpx.AsyncClient().post(f"{url}/api/orders/ingest", json={
        "orders": [
            {
                "guest_name": "Silent Regular",
                "item_name": "Classic Latte",
                "category": "drink",
                "price": 6.50,
                "quantity": 1,
                "ordered_at": old_date
            }
        ]
    })

    # 3. Create a New Big Spender
    print("Seeding New Big Spender...")
    await httpx.AsyncClient().post(f"{url}/api/orders/ingest", json={
        "orders": [
            {
                "guest_name": "High Potential Newcomer",
                "item_name": "Full Brunch Set",
                "category": "food",
                "price": 120.0,
                "quantity": 1,
                "ordered_at": datetime.utcnow().isoformat()
            }
        ]
    })

    print("Priority Seeding Complete.")

if __name__ == "__main__":
    asyncio.run(seed_priority_test())
