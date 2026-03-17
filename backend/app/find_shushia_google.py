
import asyncio
from app.services.sync import google_search

async def find():
    print("Searching for Shu Shia...")
    results = await google_search("Shu Shia", "Cupertino")
    for r in results:
        print(f"Name: {r.get('name')}, URL: {r.get('place_url') or r.get('id')}")

if __name__ == "__main__":
    asyncio.run(find())
