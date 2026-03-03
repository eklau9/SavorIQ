import json
import httpx
import asyncio
import os

BASE_URL = "http://localhost:8000/api"

async def seed_data():
    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Ingest Google Reviews
        google_path = "backend/app/seed/google_reviews.json"
        if os.path.exists(google_path):
            with open(google_path, "r") as f:
                google_reviews = json.load(f)
            print(f"Ingesting {len(google_reviews)} Google Reviews...")
            resp = await client.post(f"{BASE_URL}/reviews/ingest", json={
                "platform": "google",
                "reviews": google_reviews
            })
            print(f"Google Response: {resp.status_code} - {resp.json().get('ingested', 0)} ingested")
        
        # 2. Ingest Yelp Reviews
        yelp_path = "backend/app/seed/yelp_reviews.json"
        if os.path.exists(yelp_path):
            with open(yelp_path, "r") as f:
                yelp_reviews = json.load(f)
            print(f"Ingesting {len(yelp_reviews)} Yelp Reviews...")
            resp = await client.post(f"{BASE_URL}/reviews/ingest", json={
                "platform": "yelp",
                "reviews": yelp_reviews
            })
            print(f"Yelp Response: {resp.status_code} - {resp.json().get('ingested', 0)} ingested")

        # 3. Ingest Orders
        orders_path = "backend/app/seed/orders.json"
        if os.path.exists(orders_path):
            with open(orders_path, "r") as f:
                orders_data = json.load(f)
            print(f"Ingesting {len(orders_data)} Orders...")
            resp = await client.post(f"{BASE_URL}/orders/ingest", json={
                "orders": orders_data
            })
            print(f"Orders Response: {resp.status_code} - {resp.json().get('ingested', 0)} ingested")

if __name__ == "__main__":
    asyncio.run(seed_data())
