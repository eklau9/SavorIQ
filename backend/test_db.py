import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from app.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    connect_args={"statement_cache_size": 0, "prepared_statement_cache_size": 0},
)
async def test():
    async with engine.begin() as conn:
        await conn.execute(sqlalchemy.text("SELECT 1"))
        print("Success!")
import sqlalchemy
asyncio.run(test())
