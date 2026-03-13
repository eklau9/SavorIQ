"""SavorIQ FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_db
from app.routers import admin, analytics, guests, menu, orders, reviews, sync


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

from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse

# Access Key Middleware
@app.middleware("http")
async def access_control_middleware(request: Request, call_next):
    # Skip check for health, root, and OPTIONS preflight
    if request.method == "OPTIONS" or request.url.path in ["/health", "/"]:
        return await call_next(request)
    
    # Skip check if no key is configured on server
    if not settings.ACCESS_KEY:
        return await call_next(request)
        
    access_key = request.headers.get("X-Access-Key")
    if access_key != settings.ACCESS_KEY:
        return JSONResponse(
            status_code=401,
            content={"detail": "Unauthorized: Invalid or missing X-Access-Key"}
        )
    
    return await call_next(request)

# Routers
app.include_router(guests.router)
app.include_router(orders.router)
app.include_router(reviews.router)
app.include_router(analytics.router)
app.include_router(menu.router)
app.include_router(sync.router)
app.include_router(admin.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": settings.APP_NAME}
