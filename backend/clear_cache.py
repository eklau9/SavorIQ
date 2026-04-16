import asyncio
from sqlalchemy import delete
from app.database import async_session
from app.models import BriefingCache

async def clear_cache():
    async with async_session() as session:
        await session.execute(delete(BriefingCache))
        await session.commit()
        print("Cache cleared!")

if __name__ == "__main__":
    asyncio.run(clear_cache())
