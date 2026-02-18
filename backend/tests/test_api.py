"""API integration tests for SavorIQ endpoints."""

import pytest

from tests.conftest import SAMPLE_GOOGLE_REVIEWS, SAMPLE_ORDERS, SAMPLE_YELP_REVIEWS


class TestHealthEndpoint:
    @pytest.mark.asyncio
    async def test_health(self, client):
        resp = await client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["service"] == "SavorIQ"


class TestGuestsEndpoints:
    @pytest.mark.asyncio
    async def test_list_guests_empty(self, client):
        resp = await client.get("/api/guests")
        assert resp.status_code == 200
        assert resp.json() == []

    @pytest.mark.asyncio
    async def test_create_and_get_guest(self, client):
        # Create
        resp = await client.post(
            "/api/guests",
            json={"name": "Test Guest", "email": "test@api.com", "tier": "new"},
        )
        assert resp.status_code == 201
        guest = resp.json()
        assert guest["name"] == "Test Guest"
        guest_id = guest["id"]

        # Get
        resp = await client.get(f"/api/guests/{guest_id}")
        assert resp.status_code == 200
        assert resp.json()["name"] == "Test Guest"

    @pytest.mark.asyncio
    async def test_get_nonexistent_guest(self, client):
        resp = await client.get("/api/guests/nonexistent-id")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_guest_pulse_404(self, client):
        resp = await client.get("/api/guests/nonexistent-id/pulse")
        assert resp.status_code == 404


class TestReviewIngestion:
    @pytest.mark.asyncio
    async def test_ingest_yelp(self, client):
        resp = await client.post("/api/reviews/ingest", json=SAMPLE_YELP_REVIEWS)
        assert resp.status_code == 200
        data = resp.json()
        assert data["platform"] == "yelp"
        assert data["ingested"] == 2

    @pytest.mark.asyncio
    async def test_ingest_google(self, client):
        resp = await client.post("/api/reviews/ingest", json=SAMPLE_GOOGLE_REVIEWS)
        assert resp.status_code == 200
        data = resp.json()
        assert data["ingested"] == 1

    @pytest.mark.asyncio
    async def test_ingest_invalid_platform(self, client):
        resp = await client.post(
            "/api/reviews/ingest",
            json={"platform": "invalid", "reviews": []},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["errors"] == 1


class TestOrderIngestion:
    @pytest.mark.asyncio
    async def test_ingest_orders(self, client):
        resp = await client.post("/api/orders/ingest", json=SAMPLE_ORDERS)
        assert resp.status_code == 200
        data = resp.json()
        assert data["ingested"] == 2


class TestAnalytics:
    @pytest.mark.asyncio
    async def test_overview_empty(self, client):
        resp = await client.get("/api/analytics/overview")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_guests"] == 0

    @pytest.mark.asyncio
    async def test_overview_with_data(self, client):
        # Seed data
        await client.post("/api/reviews/ingest", json=SAMPLE_YELP_REVIEWS)
        await client.post("/api/orders/ingest", json=SAMPLE_ORDERS)

        resp = await client.get("/api/analytics/overview")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_guests"] > 0
        assert data["total_reviews"] > 0


class TestGuestPulseIntegration:
    @pytest.mark.asyncio
    async def test_full_pulse_flow(self, client):
        """Integration test: ingest data → check guest pulse."""
        # Ingest orders and reviews
        await client.post("/api/orders/ingest", json=SAMPLE_ORDERS)
        await client.post("/api/reviews/ingest", json=SAMPLE_YELP_REVIEWS)

        # Find the guest
        resp = await client.get("/api/guests")
        guests = resp.json()
        assert len(guests) > 0

        # Get pulse for first guest
        guest_id = guests[0]["id"]
        resp = await client.get(f"/api/guests/{guest_id}/pulse")
        assert resp.status_code == 200
        pulse = resp.json()
        assert "guest" in pulse
        assert "total_orders" in pulse
        assert "total_spend" in pulse
        assert "sentiment_summary" in pulse
