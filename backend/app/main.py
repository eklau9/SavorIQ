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
    return {"status": "ok", "service": settings.APP_NAME, "v": "6-FRESH"}


@app.get("/debug-web")
async def debug_web():
    """Debug endpoint to check static file serving."""
    static_dir = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "static"))
    index_path = os.path.join(static_dir, "index.html")
    exists = os.path.isfile(index_path)
    files = []
    if os.path.isdir(static_dir):
        files = os.listdir(static_dir)[:20]
    return {
        "static_dir": static_dir,
        "index_exists": exists,
        "dir_exists": os.path.isdir(static_dir),
        "files_in_static": files,
        "version": "v4-unconditional"
    }

# Serve the Expo web build if available, otherwise JSON root
import mimetypes
from urllib.parse import unquote

# Register font MIME types
mimetypes.add_type("font/ttf", ".ttf")
mimetypes.add_type("font/woff", ".woff")
mimetypes.add_type("font/woff2", ".woff2")

STATIC_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "static"))
_index_html = os.path.join(STATIC_DIR, "index.html")
_has_web_app = os.path.isfile(_index_html)
print(f"INFO: Static dir={STATIC_DIR}, has_web_app={_has_web_app}")


@app.get("/")
async def serve_root():
    if _has_web_app:
        return FileResponse(_index_html, media_type="text/html")
    return {"message": "SavorIQ API is running", "health_check": "/health"}


# Admin dashboard
ADMIN_DIR = os.path.join(STATIC_DIR, "admin")
_admin_index = os.path.join(ADMIN_DIR, "index.html")
_has_admin = os.path.isfile(_admin_index)
print(f"INFO: Admin dir={ADMIN_DIR}, has_admin={_has_admin}")


@app.get("/admin")
async def serve_admin_root():
    """Redirect /admin to /admin/ for consistent routing."""
    if not _has_admin:
        return JSONResponse(status_code=404, content={"detail": "Admin not deployed"})
    return FileResponse(_admin_index, media_type="text/html")


@app.get("/admin/{full_path:path}")
async def serve_admin(full_path: str):
    """Serve admin static files with SPA fallback."""
    if not _has_admin:
        return JSONResponse(status_code=404, content={"detail": "Admin not deployed"})
    file_path = os.path.normpath(os.path.join(ADMIN_DIR, full_path))
    if not file_path.startswith(ADMIN_DIR):
        return FileResponse(_admin_index, media_type="text/html")
    if os.path.isfile(file_path):
        content_type = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
        return FileResponse(file_path, media_type=content_type)
    return FileResponse(_admin_index, media_type="text/html")


@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    """Serve static file if exists, otherwise SPA fallback to index.html."""
    if not _has_web_app:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=404, content={"detail": "Not Found"})

    # Decode URL-encoded characters (e.g., %40 → @) for paths like @expo/vector-icons
    decoded_path = unquote(full_path)
    file_path = os.path.normpath(os.path.join(STATIC_DIR, decoded_path))
    
    # Security: prevent path traversal
    if not file_path.startswith(STATIC_DIR):
        return FileResponse(_index_html, media_type="text/html")
    
    if os.path.isfile(file_path):
        content_type = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
        return FileResponse(file_path, media_type=content_type)
    # Expo static export: route.html
    html_path = file_path + ".html"
    if os.path.isfile(html_path):
        return FileResponse(html_path, media_type="text/html")
    # Subdirectory index.html
    index_path = os.path.join(file_path, "index.html")
    if os.path.isfile(index_path):
        return FileResponse(index_path, media_type="text/html")
    return FileResponse(_index_html, media_type="text/html")


