"""Application configuration via pydantic-settings."""

from typing import List

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """SavorIQ application settings loaded from environment or .env file."""

    APP_NAME: str = "SavorIQ"
    DEBUG: bool = True

    # Database — defaults to async SQLite for local dev
    DATABASE_URL: str = "sqlite+aiosqlite:///./savoriq.db"

    # Gemini AI for Deep Sentiment
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-flash-latest"

    # Google Places API (New)
    GOOGLE_PLACES_API_KEY: str = ""

    # Yelp Fusion API
    YELP_API_KEY: str = ""

    # Apify (review scraping for Google Maps + Yelp)
    APIFY_API_TOKEN: str = ""

    # CORS
    CORS_ORIGINS: List[str] = ["http://localhost:3000", "http://localhost:3001"]

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
