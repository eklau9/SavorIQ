# Technical Specification: System Architecture & API Integrations

> **Last Updated:** March 20, 2026

This document details the internal architecture, API usage, and intelligence pipeline for SavorIQ.

## 1. APIs & External Services Directory

| Service | Category | Purpose | Tier / Usage Limit |
| :--- | :--- | :--- | :--- |
| **Google Places API (New)** | Discovery Search | Lightweight text search to find Google Place IDs, URLs, and basic metadata. | Free ($200/mo credit allows ~10,000 free searches). |
| **Yelp Fusion API** | Discovery Search | Lightweight text search to find Yelp Business IDs, URLs, and basic metadata. | Free (5,000 requests/month). |
| **Apify REST API** | Review Sync | Runs headless actor bots (`compass/google-maps-reviews-scraper`, `tri_angle~yelp-review-scraper`) to deep-scrape historical review data. | Paid (Consumes Apify compute credits). |
| **Google Gemini API** | AI Intelligence | Powers per-review Sentiment Analysis and Executive Dashboard Manager Briefings. Uses `gemini-1.5-flash` model. | Free Tier (15 RPM, 1,500 RPD). |
| **Railway** | Backend Hosting | Hosts the FastAPI backend as a Docker container with a public HTTPS endpoint. | Free Tier ($5/mo credit). |
| **Supabase** | Database Hosting | Cloud PostgreSQL database with connection pooling (Transaction Pooler on port 6543). | Free Tier (500MB storage). |
| **Browser Geolocation API** | Client Feature | Native browser feature used for location-aware "Smart Search" when the city field is left blank. | Free (Native HTML5). |

---

## 2. Multi-Stage Discovery & Syncing

### Stage 1: Discovery (Lightweight)
- **APIs**: Yelp Fusion Business Search, Google Places (New) Text Search.
- **Goal**: Find business IDs and URLs without fetching full review data.
- **Usage**: Triggered on search bar input in the Sync screen.
- **Cost**: Low/Free (utilizes Google $200/mo credit and Yelp's 5k/mo free tier).

### Stage 2: Review Sync (Intensive)
- **API**: Apify REST API (Actor Scrapers).
- **Goal**: Deep-scrape historical and new reviews.
- **Usage**: Triggered manually via "Sync Now" button (More tab or Sync screen).
- **Guardrails**:
    - 24-hour cooldown per restaurant per platform.
    - Proactive frontend blocking if `SyncLog` shows recent activity.
- **Cost**: Consumes Apify compute credits.
- **Token Waterfall**: Uses a fallback strategy to maximize free-tier usage:
    - **Primary + N Fallbacks**: Tokens configured in `backend/.env` as `APIFY_API_TOKEN` (primary) and `APIFY_FALLBACK_TOKEN_1` through `_N` (backup free-tier accounts).
    - **Retry Logic**: `_run_apify_actor()` tries each token in order. On HTTP 402 (quota exceeded) or 429 (rate limit), it immediately retries with the next token.
    - **Non-quota errors** (500, network failures, actor FAILED status) are **not** retried across tokens.
    - **Token Loading**: `_get_apify_tokens()` reads from both Pydantic Settings (tokens 1-15) and `os.environ` directly (tokens 16+), supporting unlimited keys.

---

## 3. Intelligence Processing

### Sentiment Analysis Pipeline
1. **Ingestion**: Raw JSON normalized and saved to `reviews` table.
2. **Sentiment Hook**: Triggered for every NEWLY ingested review.
3. **AI Categorization** (Google Gemini):
    - **Buckets**: Food, Drink, Ambiance.
    - **Score Range**: -1.0 (Critical) to 1.0 (Excellent).
    - **TPM Guard**: Caps reviews at 1,300 per Gemini request (~200K tokens).
4. **Aggregation**: Scores feed Dashboard KPIs and Manager Briefings.

### Manager Briefing Pipeline
1. **Input**: Sentiment buckets + top/risk items + all review text for the selected time range.
2. **Model**: Gemini `gemini-1.5-flash`.
3. **Output**: Strategic summary + typed insights (Win/Risk/Action) with keywords and review ID citations.
4. **Optimization**: 1Y and All Time frames reuse the 6MO briefing (no extra Gemini call).
5. **Caching**: Data-hash-aware in-memory cache + 2-hour TTL.
6. **Retry Logic**: 5 retries with exponential backoff (5s, 10s, 15s, 20s) — covers the 60s RPM reset window.
7. **Error Classification**: Only classifies 429 as "Daily Quota Exhausted" when error explicitly says `PerDay`. All other 429s treated as temporary RPM burst limits.

### Gemini Quota Tracking
- **File-Based Day Counter**: `gemini_quota.json` tracks daily request count, resets at midnight UTC.
- **In-Memory RPM Deque**: Tracks per-minute request count using a sliding window.
- **Probe Endpoint**: `/api/admin/gemini/probe` — tests API availability without consuming quota.
- **Admin Dashboard Integration**: Quotas page shows live RPM and RPD status with visual bar.

---

## 4. Technical Architecture

| Component | Stack | Details |
|---|---|---|
| **Backend** | Python 3.12, FastAPI | Async with SQLAlchemy, hosted on Railway (Docker) |
| **Database** | Supabase PostgreSQL | Multi-tenant via `restaurant_id`, Transaction Pooler (port 6543) |
| **ORM** | SQLAlchemy (AsyncSession) | Tables auto-created via `Base.metadata.create_all` on startup |
| **AI Engine** | Google Gemini (`gemini-1.5-flash`) | Sentiment analysis + Manager Briefings |
| **Scrapers** | Apify (REST API) | Google Maps + Yelp review actors |
| **Mobile** | React Native / Expo Router (TypeScript) | 5-tab navigation, shared API layer |
| **Admin** | React / Vite | Operator monitoring at `/admin/` or `localhost:5174` |
| **Web** | Next.js (App Router) | Broader executive analytics (legacy) |

### Multi-Tenancy & Data Isolation
- Every table (`guests`, `reviews`, `orders`, `sentiment_scores`, `intercept_actions`, `sync_logs`) includes a `restaurant_id`.
- Backend enforces isolation using an `X-Restaurant-ID` header on every request.
- New restaurant tenants are auto-provisioned during the first sync.
- Row-Level Security (RLS) is conceptually enforced by the API layer scoping all queries.

### Frontend Data Loading Architecture
- **Disk Cache**: Dashboard data persisted to AsyncStorage with 24-hour TTL.
- **In-Memory Cache**: `dashboardCache` ref holds all 5 time-range frames.
- **Prefetch Pipeline**: On load, analytics for all frames fetched in parallel (pure SQL), then briefings fetched sequentially with 4s spacing to respect Gemini RPM limits.
- **Background Data**: Guests, reviews, stats, priorities, and operations fetched lazily once per session.
- **Intelligence Badge**: Derived from actual data content (`data?.briefing?.insights?.length > 0`), not a separate state flag — ensures badge and on-screen content are always in sync.

---

## 5. Database Schema

### Core Tables
- **`restaurants`**: Master tenant table (id, name, address, platform_url).
- **`guests`**: Scoped to `restaurant_id`. Auto-created from reviewers. Includes tier (VIP/Regular/One-Time).
- **`reviews`**: Scoped to `restaurant_id`. Deduplicated by `platform_review_id`. Tracks `is_deleted_on_platform`.
- **`sentiment_scores`**: Linked to reviews. Stores bucket (food/drink/ambiance) + score (-1.0 to 1.0).
- **`menu_items`**: Scoped to `restaurant_id`. Name, category, keywords (comma-separated), `is_active` flag.
- **`orders`**: Scoped to `restaurant_id`. (Currently unused — sentiment-driven analytics used instead.)
- **`intercept_actions`**: Tracks manager responses (open/actioned/resolved/dismissed).
- **`sync_logs`**: Tracks Apify sync history per restaurant per platform. Includes `platform_total_count` for ground-truth review counts.

### API Endpoints
| Router | Prefix | Key Endpoints |
|---|---|---|
| `analytics` | `/api/analytics/` | `GET /overview`, `GET /deep`, `GET /briefing`, `GET /operations`, `GET /historical-trends`, `GET /sentiment` |
| `sync` | `/api/sync/` | `POST /search`, `POST /apify-reviews`, `GET /progress/{id}`, `POST /cancel/{id}` |
| `reviews` | `/api/reviews/` | `GET /`, `GET /stats` |
| `guests` | `/api/guests/` | `GET /`, `GET /{id}`, `GET /priorities` |
| `menu` | `/api/menu/` | `GET /items`, `POST /items`, `POST /upload-photo` |
| `admin` | `/api/admin/` | `GET /health`, `GET /restaurants`, `GET /gemini/usage`, `POST /gemini/probe` |
