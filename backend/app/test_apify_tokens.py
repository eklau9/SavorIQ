
import asyncio
import httpx
import os
from app.config import settings

async def test_tokens():
    tokens = [settings.APIFY_API_TOKEN]
    for i in range(1, 10):
        t = getattr(settings, f"APIFY_FALLBACK_TOKEN_{i}", None)
        if t: tokens.append(t)
    
    actor_id = "compass/google-maps-reviews-scraper"
    # actor_id_alt = "compass~google-maps-reviews-scraper"
    
    for i, token in enumerate(tokens):
        print(f"Testing token {i} (...{token[-4:]})")
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://api.apify.com/v2/acts/{actor_id}",
                headers={"Authorization": f"Bearer {token}"}
            )
            print(f"  Actor check: {resp.status_code}")
            if resp.status_code == 200:
                print(f"  Token {i} is GOOD for {actor_id}")
            else:
                print(f"  Token {i} error: {resp.text}")

if __name__ == "__main__":
    asyncio.run(test_tokens())
