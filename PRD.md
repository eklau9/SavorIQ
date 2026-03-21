# SavorIQ — Product Requirements Document (PRD)

> **Last Updated:** March 20, 2026

## 1. Vision & Objective

**SavorIQ** is an AI-powered guest intelligence platform for restaurants and hospitality operators. It aggregates reviews from Google Maps and Yelp, applies deep sentiment analysis via Google Gemini, and delivers actionable manager insights through a premium mobile-first interface.

### Key Objectives
1. **AI-Driven Intelligence:** Gemini-powered Manager Briefings surface wins, risks, and action items from review data across configurable time ranges (1M, 3M, 6M, 1Y, All Time).
2. **Multi-Platform Review Aggregation:** Unified ingestion of Google Maps and Yelp reviews via Apify scrapers with automatic deduplication.
3. **Guest Intelligence:** Auto-created guest profiles from reviewer identities with VIP/Regular/One-Time tiering and intercept prioritization.
4. **Multi-Tenant Isolation:** Every query is scoped to `restaurant_id` via `X-Restaurant-ID` header; supports unlimited restaurant locations.
5. **Operational Analytics:** Sentiment trends, quarterly ratings, monthly volume, review velocity, platform split, and menu item performance tracking.

---

## 2. Target Audience
- **Restaurant Managers**: View AI briefings, resolve guest intercepts, track menu item performance.
- **Hospitality Operators**: Monitor multiple locations, sync reviews, manage quotas via Admin Dashboard.

---

## 3. Application Architecture

### 3.1 Mobile App (Primary Interface)
**Stack:** React Native / Expo Router / TypeScript  
**Port:** `localhost:8081` (dev) or Railway production URL

Five-tab mobile-first interface:

| Tab | Purpose |
|---|---|
| **Dashboard** | Executive overview: KPI cards (Guests, Reviews, Avg Rating), AI Manager Briefing with 5 time-range chips, Top Performers, At-Risk Items, Historical Trends |
| **Inbox** | Prioritized guest intercepts needing manager action (Resolve / Dismiss) |
| **Guests** | Searchable guest list with VIP/Regular/One-Time badges, review counts, sentiment overview |
| **Reviews** | Full review feed with search, keyword filtering, date filtering, and platform badges |
| **More** | Restaurant switcher, Sync Now, Menu Upload, Admin Dashboard link, API environment toggle, sign out |

**Additional Screens:**
- `sync.tsx` — Add new restaurant: search Google/Yelp → confirm listing → initial review sync with progress overlay
- `guest/[id].tsx` — Individual guest profile with review history and sentiment timeline
- `rating-breakdown.tsx` — Detailed rating distribution chart
- `menu-upload.tsx` — Photo-to-menu item extraction for precise item tracking
- `admin.tsx` — Deep link to Admin Dashboard

### 3.2 Admin Dashboard (Operator Command Center)
**Stack:** React / Vite  
**Port:** `localhost:5174` (dev) or served at `{API_BASE}/admin/`

| Page | Purpose |
|---|---|
| **Quotas** | Live quota status for Gemini (RPM/RPD), Yelp (daily), Apify (credit balance per token), Google Places |
| **Locations** | All synced restaurants with review counts by platform (Google/Yelp), last sync timestamps, database-verified counts |

### 3.3 Backend API
**Stack:** Python 3.12 / FastAPI / SQLAlchemy (Async) / PostgreSQL  
**Hosting:** Railway (Docker) — `https://savoriq-api-production.up.railway.app`

---

## 4. Core Features (Implemented)

### 4.1 AI Manager Briefing
- **Model:** Google Gemini (`gemini-1.5-flash`, free tier: 15 RPM, 1500 RPD)
- **Input:** All reviews for the selected time range + sentiment buckets + top/risk items
- **Output:** Strategic summary + typed insights (Win / Risk / Action) with:
  - Actionable steps (3-5 per insight)
  - Keywords for review filtering (used for insight → review navigation)
  - Review IDs for exact citation back to source reviews
- **Time Ranges:** 1M (30d), 3M (90d), 6M (180d), 1Y (365d), All Time
- **Optimization:** 1Y and All Time reuse the 6MO briefing (no extra Gemini call)
- **Caching:** Data-hash-aware in-memory cache + 2-hour TTL + AsyncStorage disk persistence
- **Prefetching:** All 5 frames are prefetched during initial load (4s spacing between Gemini requests)
- **AI Integrity Mode:** When no menu is configured, unmatched food/drink terms from reviews are auto-discovered and shown as "Suggested" items with an explanatory badge

### 4.2 Data Ingestion & Review Sync
- **Discovery:** Yelp Fusion API (5k/mo free) + Google Places (New) API ($200/mo free credit)
- **Sync:** Apify actors (`compass/google-maps-reviews-scraper` + `tri_angle~yelp-review-scraper`)
- **Token Waterfall:** Primary + up to 16 fallback Apify tokens; auto-retries on HTTP 402/429
- **Deduplication:** Reviews tracked by `platform_review_id`; `is_deleted_on_platform` flag for platform-removed reviews
- **Progress Tracking:** Real-time sync progress with percentage, status, ETA, processed/total counts
- **Cooldown:** 24-hour per-restaurant per-platform cooldown enforced by `SyncLog`

### 4.3 Sentiment Analysis Pipeline
- **Trigger:** Automatic for every newly ingested review
- **Model:** Google Gemini (batched processing)
- **Buckets:** Food, Drink, Ambiance
- **Score Range:** -1.0 (Critical) to 1.0 (Excellent)
- **TPM Guard:** Caps reviews sent to Gemini at 1,300 per request (~200K tokens)

### 4.4 Guest Intelligence
- **Auto-Creation:** Guest profiles created from reviewer name + platform identity
- **Tiering:** VIP (3+ reviews), Regular (2 reviews), One-Time (1 review)
- **Intercept Prioritization:** Low-rating reviews trigger priority inbox items with AI-generated reason + recommended action
- **Resolution Workflow:** Open → Actioned → Resolved → Dismissed
- **Auto-Resolution:** Guests who later leave 4-5★ reviews are auto-resolved

### 4.5 Historical Trends (1Y / All Time views)
- **Quarterly Ratings:** Avg rating per quarter with review count
- **Monthly Volume:** Bar chart of review counts per month
- **Sentiment Shifts:** 6-month vs prior 6-month comparison per bucket (Food/Drink/Ambiance)
- **Pure SQL:** Zero Gemini cost — all computed from database

### 4.6 Operations Analytics
- **Review Velocity:** Reviews per week (last 30 days)
- **Sentiment Momentum:** Rating change vs prior 30 days
- **Tier Distribution:** VIP / Regular / One-Time counts
- **Platform Split:** Google vs Yelp review breakdown

---

## 5. Authentication & Security
- **Access Key Gate:** App requires an access key on first launch (stored in AsyncStorage, persists across browser navigation)
- **API Scoping:** All requests include `X-Restaurant-ID` and `X-Access-Key` headers
- **Multi-Tenant Isolation:** Every table includes `restaurant_id`; queries are always scoped

---

## 6. Performance & Caching
- **In-Memory Cache:** Backend API cache with configurable TTL per endpoint
- **Disk Cache:** Frontend persists dashboard data + background data (guests, reviews, stats) to AsyncStorage
- **Prefetch Pipeline:** On load, fetches analytics for all 5 date frames in parallel, then briefings sequentially with 4s spacing
- **Restaurant Switch:** Full loading splash screen on switch; disk cache silently hydrates in-memory cache for faster `refreshAll`
- **Intelligence Badge:** Shows "Intelligence Ready" when current frame's briefing loads; inline spinner handles uncached frames

---

## 7. Gemini Quota Management
- **Tracker:** File-based daily counter (`gemini_quota.json`) + in-memory RPM deque
- **Rate Limit Handling:** 5 retries with 5-20s exponential backoff (covers 60s RPM window)
- **Error Classification:** Only classifies as "Daily Quota Exhausted" when Google explicitly says `PerDay`; all other 429s treated as RPM burst limits
- **Probe Endpoint:** `/api/admin/gemini/probe` tests API availability without burning quota

---

## 8. Technical Requirements
- **Backend:** FastAPI with SQLAlchemy (Supabase Cloud PostgreSQL via `asyncpg`)
- **Mobile:** React Native / Expo Router (TypeScript)
- **Admin:** React / Vite
- **Database:** Supabase PostgreSQL (Transaction Pooler, port 6543)
- **AI:** Google Gemini API (`gemini-1.5-flash`)
- **Scraping:** Apify REST API (Google Maps + Yelp actors)
- **Hosting:** Railway (Docker)
- **APIs:** Google Places, Yelp Fusion, Apify, Google Gemini, Browser Geolocation
