"""Application configuration via pydantic-settings."""

from typing import List

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """SavorIQ application settings loaded from environment or .env file."""

    APP_NAME: str = "SavorIQ"
    DEBUG: bool = True
    ACCESS_KEY: str = "SavorIQ"

    # Server port (Railway assigns via PORT env var)
    PORT: int = 8000

    # Database — defaults to async SQLite for local dev
    DATABASE_URL: str = "sqlite+aiosqlite:///./savoriq.db"

    # Gemini AI for Deep Sentiment
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash-lite"  # 10x faster than 2.5-flash, same quality for JSON
    GEMINI_FALLBACK_MODEL: str = "gemini-2.5-flash"  # Fallback if lite quota exhausted

    # Google Places API (New)
    GOOGLE_PLACES_API_KEY: str = ""

    # Yelp Fusion API
    YELP_API_KEY: str = ""

    # Apify (review scraping for Google Maps + Yelp)
    APIFY_API_TOKEN: str = ""
    # Backup Apify tokens (free-tier accounts) — used in order when primary quota runs out
    APIFY_FALLBACK_TOKEN_1: str = ""
    APIFY_FALLBACK_TOKEN_2: str = ""
    APIFY_FALLBACK_TOKEN_3: str = ""
    APIFY_FALLBACK_TOKEN_4: str = ""
    APIFY_FALLBACK_TOKEN_5: str = ""
    APIFY_FALLBACK_TOKEN_6: str = ""
    APIFY_FALLBACK_TOKEN_7: str = ""
    APIFY_FALLBACK_TOKEN_8: str = ""
    APIFY_FALLBACK_TOKEN_9: str = ""
    APIFY_FALLBACK_TOKEN_10: str = ""
    APIFY_FALLBACK_TOKEN_11: str = ""
    APIFY_FALLBACK_TOKEN_12: str = ""
    APIFY_FALLBACK_TOKEN_13: str = ""
    APIFY_FALLBACK_TOKEN_14: str = ""
    APIFY_FALLBACK_TOKEN_15: str = ""
    APIFY_FALLBACK_TOKEN_16: str = ""

    # CORS — accepts comma-separated origins or "*" for all
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000", 
        "http://localhost:3001",
        "http://localhost:8081",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:8081",
        "http://192.168.68.56:8081",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "https://savoriq-web-production.up.railway.app"
    ]

    model_config = {
        "env_file": ".env", 
        "env_file_encoding": "utf-8",
        "extra": "ignore"
    }


settings = Settings()
