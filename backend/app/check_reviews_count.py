
import asyncio
from sqlalchemy import text
from app.database import engine

async def check():
    async with engine.connect() as conn:
        res = await conn.execute(text("SELECT count(*) FROM reviews WHERE platform='google' AND restaurant_id='bfe23673-fa07-4e91-9db8-6c9fbf77ccbc'"))
        count = res.scalar()
        print(f"Google Reviews count for Shu Shia: {count}")

if __name__ == "__main__":
    asyncio.run(check())
