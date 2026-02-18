"""Pytest fixtures for SavorIQ backend tests."""

import asyncio
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_db
from app.main import app

# In-memory SQLite for testing
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestingSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    """Create and drop tables for each test."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Provide a test database session."""
    async with TestingSessionLocal() as session:
        yield session


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """Provide a test HTTP client with overridden DB dependency."""

    async def override_get_db():
        async with TestingSessionLocal() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


# ── Sample data helpers ───────────────────────────────────────────────────

SAMPLE_YELP_REVIEWS = {
    "platform": "yelp",
    "reviews": [
        {
            "review_id": "test-yelp-001",
            "guest_name": "Test User",
            "guest_email": "test@example.com",
            "rating": 4.5,
            "text": "The food was delicious and the coffee was amazing. Love the cozy atmosphere!",
            "date": "2026-01-15",
        },
        {
            "review_id": "test-yelp-002",
            "guest_name": "Another User",
            "guest_email": "another@example.com",
            "rating": 3.0,
            "text": "Mediocre burger but the beer selection is great. Too loud and crowded though.",
            "date": "2026-01-20",
        },
    ],
}

SAMPLE_GOOGLE_REVIEWS = {
    "platform": "google",
    "reviews": [
        {
            "review_id": "test-goog-001",
            "author_name": "Test User",
            "author_email": "test@example.com",
            "rating": 5.0,
            "text": "Best latte in town! The barista is incredibly talented. Beautiful interior design.",
            "time": "2026-02-01T10:00:00",
        },
    ],
}

SAMPLE_ORDERS = {
    "orders": [
        {
            "guest_name": "Test User",
            "guest_email": "test@example.com",
            "item_name": "Oat Milk Latte",
            "category": "drink",
            "price": 5.50,
            "quantity": 1,
            "ordered_at": "2026-01-10T08:00:00",
        },
        {
            "guest_name": "Test User",
            "guest_email": "test@example.com",
            "item_name": "Croissant",
            "category": "food",
            "price": 4.00,
            "quantity": 2,
            "ordered_at": "2026-01-10T08:00:00",
        },
    ],
}
