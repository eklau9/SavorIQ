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
    GEMINI_MODEL: str = "gemini-2.0-flash"

    # CORS
    CORS_ORIGINS: List[str] = ["http://localhost:3000"]

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
