# Technical Specification: Review Ingestion & Intelligence Pipeline

This document details the internal architecture of the SavorIQ review processing system, providing a technical reference for the "Two-Stage" discovery and ingestion flow.

## 1. Multi-Stage Discovery & Syncing

To optimize API costs and performance, the system follows a split architecture:

### Stage 1: Discovery (Lightweight)
- **APIs**: Yelp Fusion Business Search, Google Places (New) Text Search.
- **Goal**: Find business IDs and URLs without fetching full review data.
- **Usage**: Triggered on every search bar input.
- **Cost**: Low/Free (utilizes Google $200/mo credit and Yelp's 5k/mo free tier).

### Stage 2: Syncing (Intensive)
- **API**: Apify REST API (Actor Scrapers).
- **Goal**: Deep-scrape historical and new reviews.
- **Usage**: Triggered manually by user via "Sync Reviews" button.
- **Guardrails**: 
    - 24-hour cooldown per store.
    - Proactive frontend blocking if `SyncLog` shows recent activity.
- **Cost**: Consumes Apify compute credits.

---

## 2. Intelligence Processing (AI Sentiment)

Once reviews are ingested, they pass through the Intelligence Layer:

### Pipeline Flow:
1. **Ingestion**: Raw JSON normalized and saved to `reviews` table.
2. **Sentiment Hook**: Triggered for every NEWLY ingested review.
3. **AI Categorization**:
    - **Model**: Google Gemini.
    - **Buckets**: Food, Drink, Ambiance.
    - **Score Range**: -1.0 (Critical) to 1.0 (Excellent).
4. **Aggregation**: Scores are used to update the "Guest Pulse" and Dashboard KPIs.

### Optimization Strategy (Planned):
- **Batching**: Group 50+ reviews into a single Gemini prompt to minimize API calls.
- **Tiered Analysis**: Prioritize negative sentiment (1-3 stars) and VIP reviews for deep analysis; use lightweight heuristics for generic 5-star praise.
- **Model Switching**: Use `gemini-1.5-flash` for high-volume individual reviews and `gemini-1.5-pro` for high-level aggregate Manager Briefings.

---

## 3. Data Schema

### `SyncLog` Table
Maintains the state of truth for cooldowns and proactive feedback.
- `business_id`: Full URL/Fingerprint.
- `last_synced_at`: Timestamp for cooldown calculation.
- `reviews_fetched`: Total items found.
- `new_reviews`: Count of truly new items ingested.
