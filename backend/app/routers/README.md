# SavorIQ API Routers

Definitions for the SavorIQ backend REST API.

## Structure

Each router focuses on a specific functional domain:

- **`analytics.py`**: High-level overview and deep sentiment aggregation.
- **`guests.py`**: Guest registry management and prioritization logic.
- **`reviews.py`**: Review listing, filtering, and aggregate statistics.
- **`sync.py`**: Data ingestion from Yelp and Google Maps via Apify.
- **`menu.py`**: Management of official menu items for entity extraction.

## Common Features

All routers follow these patterns:
- **Tenant Isolation**: Use the `X-Restaurant-ID` header to scope all data queries.
- **Async DB**: All database operations use `AsyncSession` for non-blocking performance.
- **Pydantic Schemas**: Input/output validation is strictly handled by Pydantic models in `app/schemas.py`.
