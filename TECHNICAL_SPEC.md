# Technical Specification: System Architecture & API Integrations

This document details the internal architecture, API usage, and intelligence pipeline for SavorIQ.

## 1. APIs & External Services Directory

SavorIQ relies on the following external services to function. This is the definitive list of all APIs, their purpose, and their current billing/usage strategy:

| Service | Category | Purpose | Tier / Usage Limit |
| :--- | :--- | :--- | :--- |
| **Google Places API (New)** | Discovery Search | Lightweight text search to find Google Place IDs, URLs, and basic metadata. | Free ($200/mo credit allows ~10,000 free searches). |
| **Yelp Fusion API** | Discovery Search | Lightweight text search to find Yelp Business IDs, URLs, and basic metadata. | Free (5,000 requests/month). |
| **Apify REST API** | Review Sync | Runs headless actor bots (`compass/google-maps-reviews-scraper`, `tri_angle~yelp-review-scraper`) to bypass strict API limits and deep-scrape historical review data. | Paid (Consumes Apify compute credits). |
| **Google Gemini API** | AI Intelligence | Powers both the per-review Sentiment Analysis (categorization) and the Executive Dashboard Manager Briefings. Uses `gemini-1.5-flash` model. | Free Tier (15 Requests Per Minute, 1,500 Requests Per Day). |
| **Browser Geolocation API** | Client Feature | Native frontend browser feature used for location-aware "Smart Search" when the city field is left blank. | Free (Native HTML5). |

---

## 2. Multi-Stage Discovery & Syncing

To optimize API costs and performance, the system follows a split architecture:

### Stage 1: Discovery (Lightweight)
- **APIs**: Yelp Fusion Business Search, Google Places (New) Text Search.
- **Goal**: Find business IDs and URLs without fetching full review data.
- **Usage**: Triggered on every search bar input.
- **Cost**: Low/Free (utilizes Google $200/mo credit and Yelp's 5k/mo free tier).

### Stage 2: Syncing
### Database Schema (Supabase)
- **restaurants**: Master table for tenants.
- **guests**: Scoped to `restaurant_id`.
- **reviews**: Scoped to `restaurant_id`.
- **orders**: Scoped to `restaurant_id`.
- **sentiment_scores**: Linked to reviews.
- **intercept_actions**: Tracks manager responses, scoped to `restaurant_id`.
- **sync_logs**: Tracks Apify sync history, scoped to `restaurant_id`.
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

## 3. Database Architecture & Hosting

## Technical Architecture
- **Backend:** FastAPI (Python)
- **Database:** Supabase Cloud PostgreSQL (Multi-tenant)
- **ORM:** SQLAlchemy (Async)
- **AI Engine:** Google Gemini Pro (Sentiment & Insights)
- **Scraper:** Apify (Yelp & Google Maps)
- **Frontend:** Next.js (App Router)

### Multi-Tenancy & Data Isolation
SavorIQ uses a **Hard Isolation** strategy at the database level:
- Every table (`guests`, `reviews`, `orders`, `intercept_actions`) includes a `restaurant_id`.
- The Backend enforces isolation using an `X-Restaurant-ID` header.
- New restaurant tenants are auto-provisioned during the first sync of a business location.
- Row-Level Security (RLS) is conceptually enforced by the API layer scoping all queries to the provided `restaurant_id`.
SavorIQ is migrating from a local SQLite development database to a production-ready **Supabase Cloud PostgreSQL** instance.

### Connection Strategy
- **Driver**: `asyncpg` (Asynchronous Python driver required by SQLAlchemy for FastAPI).
- **Pooling**: **Transaction Pooler** (Port `6543`).
    - *Why?* Transaction pooling is essential for modern serverless/API environments. It allows FastAPI to rapidly execute a query and instantly return the connection to the pool, preventing connection exhaustion under heavy load.
- **ORM**: SQLAlchemy (`AsyncSession`).
- **Initialization**: Tables are automatically constructed on application startup via `Base.metadata.create_all`.

---

## 4. Data Schema

### `SyncLog` Table
Maintains the state of truth for cooldowns and proactive feedback.
- `business_id`: Full URL/Fingerprint.
- `last_synced_at`: Timestamp for cooldown calculation.
- `reviews_fetched`: Total items found.
- `new_reviews`: Count of truly new items ingested.
