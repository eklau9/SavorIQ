# SavorIQ Backend

The FastAPI-based intelligence engine for SavorIQ.

## Overview

The backend is responsible for:
1. **Data Sync**: Scraping reviews from Yelp and Google Maps using Apify actors.
2. **Sentiment Analysis**: Processing reviews through Google's Gemini AI to identify specific friction points and strengths (the "Deep Sentiment" system).
3. **Guest Resolution**: Tracking VIP guest status and prioritizing manager intercepts based on recent feedback.
4. **Tenant Management**: Multi-location support with restaurant-level data isolation.

## Key Components

- **`app/routers/`**: API endpoint definitions grouped by functional area (guests, reviews, analytics, sync).
- **`app/models/`**: SQLAlchemy database models.
- **`app/services/`**: Core business logic and external integrations (Gemini, Apify, Yelp, Google).
- **`app/schemas/`**: Pydantic models for request/response validation.

## Local Development

1. Create a virtual environment: `python3 -m venv venv`
2. Activate: `source venv/bin/activate`
3. Install dependencies: `pip install -r requirements.txt`
4. Set up `.env` with required API keys (Gemini, Apify, Database URL).
5. Run the server: `uvicorn app.main:app --reload`
