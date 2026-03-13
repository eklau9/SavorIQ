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

YELP_KEY = os.getenv("YELP_API_KEY")
DATABASE_URL = os.getenv("DATABASE_URL")

async def check_apify():
    print("--- APIFY (Review Syncing) ---")
    
    # We import settings here to avoid top-level app dependency if possible, 
    # but the script already appends the path.
    # We use a dynamic loop to support unlimited tokens
    tokens = []
    if os.getenv("APIFY_API_TOKEN"):
        tokens.append(os.getenv("APIFY_API_TOKEN"))
    
    i = 1
    while True:
        t = os.getenv(f"APIFY_FALLBACK_TOKEN_{i}")
        if t:
            t = t.strip()
            if t and t not in tokens:
                tokens.append(t)
            i += 1
        else:
            if not os.getenv(f"APIFY_FALLBACK_TOKEN_{i+1}"):
                break
            i += 1

    if not tokens:
        print("❌ No Apify tokens found in .env\n")
        return
    
    active_found = False
    
    async with httpx.AsyncClient() as client:
        for i, token in enumerate(tokens):
            label = "Primary" if i == 0 else f"Fallback #{i}"
            headers = {"Authorization": f"Bearer {token}"}
            
            try:
                # 1. Get basic info and status
                me_resp = await client.get("https://api.apify.com/v2/users/me", headers=headers)
                # 2. Get detailed usage/limits
                limits_resp = await client.get("https://api.apify.com/v2/users/me/limits", headers=headers)
                
                if me_resp.status_code == 200 and limits_resp.status_code == 200:
                    me_data = me_resp.json().get("data", {})
                    limits_data = limits_resp.json().get("data", {})
                    
                    # Status Check: Apify explicitly tells us if the account is disabled
                    actors_enabled = me_data.get("effectivePlatformFeatures", {}).get("ACTORS", {}).get("isEnabled", True)
                    disabled_reason = me_data.get("effectivePlatformFeatures", {}).get("ACTORS", {}).get("disabledReason", "")
                    
                    # Limits/Usage
                    l_block = limits_data.get("limits", {})
                    c_block = limits_data.get("current", {})
                    
                    max_usd = l_block.get("maxMonthlyUsageUsd", 0)
                    used_usd = c_block.get("monthlyUsageUsd", 0)
                    remaining_usd = max(0, max_usd - used_usd)
                    
                    next_reset = limits_data.get("monthlyUsageCycle", {}).get("endAt", "Unknown")
                    if next_reset != "Unknown":
                        next_reset = next_reset[:10]
                    
                    is_active = actors_enabled and (max_usd == 0 or remaining_usd > 0)
                    
                    if not is_active:
                        status = "❌ EXHAUSTED"
                        if disabled_reason:
                            label_val = f"Used ${used_usd:.2f} (Limit Exceeded)"
                        else:
                            label_val = "Limit reached"
                    else:
                        status = "✅ ACTIVE"
                        if not active_found:
                            status += " (NEXT UP)"
                            active_found = True
                        
                        if max_usd > 0:
                            label_val = f"${remaining_usd:.2f} / ${max_usd:.2f} remaining"
                        else:
                            label_val = "New Account (Free $5.00)"

                    print(f"[{label}] {status}")
                    print(f"   - Credit: {label_val}")
                    print(f"   - Resets on: {next_reset}")
                    print(f"   - Token: ...{token[-6:]}")
                else:
                    print(f"❌ [{label}] Failed to fetch (ME:{me_resp.status_code} LIMITS:{limits_resp.status_code})")
            except Exception as e:
                print(f"❌ [{label}] Error: {str(e)}")
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
    
    # We use raw asyncpg to bypass SQLAlchemy's internal queries 
    # and prepare-statement management which conflicts with PgBouncer.
    try:
        import asyncpg
        # Convert SQLAlchemy URL to asyncpg format if needed
        # (mostly just changing the driver name)
        url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
        
        # Connect with statement cache disabled
        conn = await asyncpg.connect(url, statement_cache_size=0)
        try:
            row = await conn.fetchrow("SELECT pg_size_pretty(pg_database_size(current_database()));")
            size = row[0] if row else "Unknown"
            print(f"✅ Current Database Storage Used: {size}")
            print("✅ Supabase Free Tier Storage Limit: 500 MB")
        finally:
            await conn.close()
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
