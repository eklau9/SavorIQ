"""SavorIQ FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_db
from app.routers import analytics, guests, orders, reviews


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database tables on startup."""
    await init_db()
    yield


app = FastAPI(
    title=settings.APP_NAME,
    description="Third Space Guest Intelligence Hub — F&B orders × review sentiment",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(guests.router)
app.include_router(orders.router)
app.include_router(reviews.router)
app.include_router(analytics.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": settings.APP_NAME}
