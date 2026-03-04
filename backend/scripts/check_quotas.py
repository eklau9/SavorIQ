import os
import sys
import asyncio
import httpx
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from sqlalchemy.pool import NullPool

# Add the backend directory to the path so we can import from app, or just run it independently
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Load from backend/.env
env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
load_dotenv(env_path)

APIFY_TOKEN = os.getenv("APIFY_API_TOKEN")
YELP_KEY = os.getenv("YELP_API_KEY")
DATABASE_URL = os.getenv("DATABASE_URL")

async def check_apify():
    print("--- APIFY (Review Syncing) ---")
    if not APIFY_TOKEN:
        print("❌ No APIFY_API_TOKEN found in .env\n")
        return
    
    url = "https://api.apify.com/v2/users/me"
    headers = {"Authorization": f"Bearer {APIFY_TOKEN}"}
    
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code == 200:
                data = resp.json().get("data", {})
                limits = data.get("limits", {})
                usage = data.get("currentUsage", {})
                
                max_cu = limits.get("maxComputeUnits", 0)
                used_cu = usage.get("computeUnits", 0)
                print(f"✅ Compute Units Used: {used_cu:.2f} / {max_cu:.2f} CU")
                print(f"✅ Remaining Compute Units: {max_cu - used_cu:.2f} CU")
            else:
                print(f"❌ Failed to fetch Apify usage. Status Code: {resp.status_code}")
    except Exception as e:
        print(f"❌ Error checking Apify: {str(e)}")
    print("")

async def check_yelp():
    print("--- YELP FUSION (Discovery Search) ---")
    if not YELP_KEY:
        print("❌ No YELP_API_KEY found in .env\n")
        return
    
    # We make a tiny request just to get the headers
    url = "https://api.yelp.com/v3/businesses/search?location=San+Jose&limit=1"
    headers = {
        "Authorization": f"Bearer {YELP_KEY}",
        "Accept": "application/json"
    }
    
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code == 200:
                limit = resp.headers.get("ratelimit-limit", "Unknown")
                remaining = resp.headers.get("ratelimit-remaining", "Unknown")
                reset = resp.headers.get("ratelimit-resettime", "Unknown")
                
                print(f"✅ Daily Request Limit: {limit}")
                print(f"✅ Remaining Requests Today: {remaining}")
                print(f"✅ Quota Resets At (UTC): {reset}")
            else:
                print(f"❌ Failed to fetch Yelp usage. Status Code: {resp.status_code}")
    except Exception as e:
        print(f"❌ Error checking Yelp: {str(e)}")
    print("")

async def check_supabase():
    print("--- SUPABASE POSTGRESQL (Database) ---")
    if not DATABASE_URL:
        print("❌ No DATABASE_URL found in .env\n")
        return
    
    # Configure the engine similar to the main app to avoid pooler issues
    connect_args = {"statement_cache_size": 0, "prepared_statement_cache_size": 0}
    
    try:
        engine = create_async_engine(
            DATABASE_URL, 
            connect_args=connect_args,
            poolclass=NullPool
        )
        async with engine.begin() as conn:
            result = await conn.execute(text("SELECT pg_size_pretty(pg_database_size(current_database()));"))
            size = result.scalar()
            print(f"✅ Current Database Storage Used: {size}")
            print("✅ Supabase Free Tier Storage Limit: 500 MB")
        await engine.dispose()
    except Exception as e:
        print(f"❌ Error checking Supabase: {str(e)}")
    print("")

def check_google():
    print("--- GOOGLE PLACES & GEMINI AI ---")
    print("ℹ️  Note: Google does not expose live quota usage via a simple API endpoint for these services.")
    print("To check your Google quotas, please visit your Cloud Console:")
    print("👉 Places API (Discovery): https://console.cloud.google.com/apis/api/places.googleapis.com/quotas")
    print("   - You receive a $200/mo credit which covers roughly 10,000 free text searches.")
    print("👉 Gemini Flash/Pro (Intelligence): https://aistudio.google.com/app/plan_information")
    print("   - Free Tier Limits: 15 Requests Per Minute, 1,500 Requests Per Day.")
    print("")

async def main():
    print("="*50)
    print(" SavorIQ Live API Quota Checker ")
    print("="*50)
    print("")
    
    await check_apify()
    await check_yelp()
    await check_supabase()
    check_google()
    
    print("="*50)

if __name__ == "__main__":
    asyncio.run(main())
