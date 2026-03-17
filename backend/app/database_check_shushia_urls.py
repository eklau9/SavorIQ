
import asyncio
from sqlalchemy import text
from app.database import engine

async def check():
    async with engine.connect() as conn:
        print('--- Sync Logs for Shu Shia ---')
        res = await conn.execute(text("SELECT platform, business_id, business_name FROM sync_logs WHERE business_name ILIKE '%Shu Shia%'"))
        rows = res.fetchall()
        for row in rows:
            print(f'Platform: {row[0]}, ID/URL: {row[1]}, Name: {row[2]}')

if __name__ == "__main__":
    asyncio.run(check())
