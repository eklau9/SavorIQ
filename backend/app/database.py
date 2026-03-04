"""Async SQLAlchemy database engine and session management."""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from sqlalchemy.pool import NullPool
import uuid
from app.config import settings

# Use connect_args for SQLite compatibility or Supabase Transaction Pooler
connect_args = {}
engine_kwargs = {"echo": settings.DEBUG}

if settings.DATABASE_URL.startswith("sqlite"):
    connect_args["check_same_thread"] = False
elif "asyncpg" in settings.DATABASE_URL:
    # Supabase Transaction Pooler does not support prepared statements properly.
    # The official SQLAlchemy workaround is to use unique statement names:
    connect_args["prepared_statement_name_func"] = lambda: f"__asyncpg_{uuid.uuid4()}__"
    connect_args["statement_cache_size"] = 0
    # Disable SQLAlchemy's connection pooling since Supabase handles it
    engine_kwargs["poolclass"] = NullPool

engine_kwargs["connect_args"] = connect_args
engine = create_async_engine(settings.DATABASE_URL, **engine_kwargs)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""
    pass


async def get_db():
    """FastAPI dependency that yields an async database session."""
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db():
    """Create all tables from metadata (dev convenience)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
