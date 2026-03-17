"""SavorIQ FastAPI application entry point."""

import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

start_time = time.time()

from app.config import settings
from app.database import init_db
from app.routers import admin, analytics, guests, menu, orders, reviews, sync


from app.services.yelp_tracker import perform_live_sync


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database tables and sync quotas on startup."""
    await init_db()
    
    # Perform initial Yelp quota sync
    try:
        await perform_live_sync()
        print("INFO: Initial Yelp quota sync successful.")
    except Exception as e:
        print(f"WARNING: Initial Yelp quota sync failed: {e}")
        
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
    # Skip check for health, root, OPTIONS, and static files
    path = request.url.path
    if request.method == "OPTIONS" or path in ["/health", "/"] or not path.startswith("/api"):
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

# Serve the Expo web build if available
STATIC_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "static"))
_index_html = os.path.join(STATIC_DIR, "index.html")

if os.path.isfile(_index_html):
    import mimetypes
    print(f"INFO: Serving web app from {STATIC_DIR}")

    @app.get("/")
    async def serve_index():
        return FileResponse(_index_html, media_type="text/html")

    # Catch-all MUST be registered last — serves files or SPA fallback
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve static file if it exists, otherwise SPA fallback to index.html."""
        file_path = os.path.join(STATIC_DIR, full_path)
        if os.path.isfile(file_path):
            content_type = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
            return FileResponse(file_path, media_type=content_type)
        # Expo static export: check for route.html
        html_path = file_path + ".html"
        if os.path.isfile(html_path):
            return FileResponse(html_path, media_type="text/html")
        # Check for index.html in subdirectory
        index_path = os.path.join(file_path, "index.html")
        if os.path.isfile(index_path):
            return FileResponse(index_path, media_type="text/html")
        return FileResponse(_index_html, media_type="text/html")
else:
    print(f"INFO: No web app found at {STATIC_DIR}, serving API only")

    @app.get("/")
    async def root():
        return {
            "message": "SavorIQ API is running",
            "health_check": "/health",
        }
