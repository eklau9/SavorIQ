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
    async def test_guest_creation_via_ingestion(self, client):
        # Ingest a review for a new guest
        resp = await client.post("/api/reviews/ingest", json=SAMPLE_YELP_REVIEWS)
        assert resp.status_code == 200
        
        # Verify guest was created in the list
        resp = await client.get("/api/guests")
        assert resp.status_code == 200
        guests = resp.json()
        assert any(g["name"] == "Test User" for g in guests)

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


class TestReviewFiltersOptimized:
    @pytest.mark.asyncio
    async def test_review_filtering_sql(self, client):
        """Test the new SQL-level filtering for reviews."""
        # Seed reviews
        await client.post("/api/reviews/ingest", json=SAMPLE_YELP_REVIEWS)
        
        # Test search filter
        resp = await client.get("/api/reviews?search=great")
        assert resp.status_code == 200
        reviews = resp.json()
        assert all("great" in r["content"].lower() for r in reviews)

        # Test platform filter
        resp = await client.get("/api/reviews?platform=yelp")
        assert resp.status_code == 200
        assert all(r["platform"] == "yelp" for r in resp.json())

    @pytest.mark.asyncio
    async def test_review_stats_sql(self, client):
        """Test the new SQL-level stats aggregation."""
        await client.post("/api/reviews/ingest", json=SAMPLE_YELP_REVIEWS)
        
        resp = await client.get("/api/reviews/stats")
        assert resp.status_code == 200
        stats = resp.json()
        assert "total" in stats
        assert "avg_rating" in stats
        assert "rating_distribution" in stats
        assert stats["total"] > 0


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
