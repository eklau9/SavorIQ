"""Tests for the admin API endpoint (/api/admin/quotas).

Tests are fully decoupled from external APIs using unittest.mock patches.
"""

import pytest
from unittest.mock import patch, AsyncMock, MagicMock
import httpx


# ── Admin Quotas Endpoint Tests ──────────────────────────────────────────


@pytest.mark.asyncio
class TestAdminQuotas:
    """Tests for GET /api/admin/quotas."""

    async def test_returns_all_sections(self, client):
        """Response contains apify, yelp, supabase, and google sections."""
        # Mock all external calls so the test is self-contained
        with patch("app.routers.admin._check_apify_tokens", new_callable=AsyncMock, return_value=[]), \
             patch("app.routers.admin._check_yelp", new_callable=AsyncMock, return_value={"configured": False}), \
             patch("app.routers.admin._check_supabase", new_callable=AsyncMock, return_value={"configured": False}), \
             patch("app.routers.admin._check_google", return_value={"places": {}, "gemini": {}}):
            resp = await client.get("/api/admin/quotas")

        assert resp.status_code == 200
        data = resp.json()
        assert "apify" in data
        assert "yelp" in data
        assert "supabase" in data
        assert "google" in data

    async def test_apify_tokens_structure(self, client):
        """Apify section returns properly structured token data."""
        mock_tokens = [
            {
                "index": 0,
                "label": "Primary",
                "is_active": False,
                "max_usd": 5,
                "used_usd": 5.13,
                "remaining_usd": 0,
                "resets_at": "2026-04-03T23:59:59.999Z",
                "token_hint": "...abc123",
            },
            {
                "index": 1,
                "label": "Fallback #1",
                "is_active": True,
                "max_usd": 5,
                "used_usd": 0.0,
                "remaining_usd": 5.0,
                "resets_at": "2026-04-10T23:59:59.999Z",
                "token_hint": "...def456",
            },
        ]

        with patch("app.routers.admin._check_apify_tokens", new_callable=AsyncMock, return_value=mock_tokens), \
             patch("app.routers.admin._check_yelp", new_callable=AsyncMock, return_value={"configured": False}), \
             patch("app.routers.admin._check_supabase", new_callable=AsyncMock, return_value={"configured": False}), \
             patch("app.routers.admin._check_google", return_value={"places": {}, "gemini": {}}):
            resp = await client.get("/api/admin/quotas")

        data = resp.json()
        assert len(data["apify"]) == 2
        assert data["apify"][0]["is_active"] is False
        assert data["apify"][0]["label"] == "Primary"
        assert data["apify"][1]["is_active"] is True
        assert data["apify"][1]["remaining_usd"] == 5.0

    async def test_yelp_configured(self, client):
        """Yelp section returns quota data when configured."""
        mock_yelp = {
            "configured": True,
            "daily_limit": "5000",
            "remaining": "4990",
            "resets_at": "2026-03-14T00:00:00+00:00",
        }

        with patch("app.routers.admin._check_apify_tokens", new_callable=AsyncMock, return_value=[]), \
             patch("app.routers.admin._check_yelp", new_callable=AsyncMock, return_value=mock_yelp), \
             patch("app.routers.admin._check_supabase", new_callable=AsyncMock, return_value={"configured": False}), \
             patch("app.routers.admin._check_google", return_value={"places": {}, "gemini": {}}):
            resp = await client.get("/api/admin/quotas")

        data = resp.json()
        assert data["yelp"]["configured"] is True
        assert data["yelp"]["remaining"] == "4990"

    async def test_supabase_storage(self, client):
        """Supabase section returns storage info."""
        mock_supa = {"configured": True, "used": "15 MB", "limit": "500 MB"}

        with patch("app.routers.admin._check_apify_tokens", new_callable=AsyncMock, return_value=[]), \
             patch("app.routers.admin._check_yelp", new_callable=AsyncMock, return_value={"configured": False}), \
             patch("app.routers.admin._check_supabase", new_callable=AsyncMock, return_value=mock_supa), \
             patch("app.routers.admin._check_google", return_value={"places": {}, "gemini": {}}):
            resp = await client.get("/api/admin/quotas")

        data = resp.json()
        assert data["supabase"]["used"] == "15 MB"
        assert data["supabase"]["limit"] == "500 MB"

    async def test_google_static_info(self, client):
        """Google section returns static configuration info."""
        with patch("app.routers.admin._check_apify_tokens", new_callable=AsyncMock, return_value=[]), \
             patch("app.routers.admin._check_yelp", new_callable=AsyncMock, return_value={"configured": False}), \
             patch("app.routers.admin._check_supabase", new_callable=AsyncMock, return_value={"configured": False}):
            resp = await client.get("/api/admin/quotas")

        data = resp.json()
        assert "places" in data["google"]
        assert "gemini" in data["google"]
