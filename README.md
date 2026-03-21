# SavorIQ

AI-powered guest intelligence platform for restaurants. Aggregates reviews from Google Maps and Yelp, applies deep sentiment analysis via Gemini AI, and delivers actionable manager insights through a premium mobile-first interface.

## Project Structure

- **`backend/`**: FastAPI server — PostgreSQL database (Supabase), review sync via Apify, sentiment analysis, Gemini AI briefings.
- **`mobile/`**: React Native / Expo — 5-tab manager app (Dashboard, Inbox, Guests, Reviews, More).
- **`admin/`**: React / Vite — Operator command center for API quotas, token health, location monitoring.
- **`frontend/`**: Next.js web application (legacy).
- **`k8s/`**: Kubernetes deployment configs.
- **`docs/`**: Additional documentation.

## Quick Start

### All Services (Dev)
```bash
# Terminal 1: Backend
cd backend && source venv/bin/activate && uvicorn app.main:app --reload --host 0.0.0.0

# Terminal 2: Mobile
cd mobile && npx expo start --web --port 8081

# Terminal 3: Admin
cd admin && npm run dev
```

### Individual Setup
- [Backend Setup](backend/README.md)
- [Mobile App Setup](mobile/README.md)
- [Admin Dashboard](admin/README.md)

## Core Tech Stack

| Component | Stack |
|---|---|
| **Backend** | Python 3.12, FastAPI, SQLAlchemy, PostgreSQL (Supabase), Gemini API |
| **Mobile** | TypeScript, React Native, Expo Router |
| **Admin** | React, Vite |
| **Hosting** | Railway (Docker) |
| **AI** | Google Gemini (`gemini-1.5-flash`) |
| **Scrapers** | Apify (Google Maps + Yelp actors) |

## Running Tests

```bash
# Backend
cd backend && source venv/bin/activate && PYTHONPATH=$(pwd) pytest

# Mobile
cd mobile && npm test
```

## Apify Token Fallback

SavorIQ uses an automatic **waterfall fallback** for Apify API tokens. When the primary token's $5.00 free credit is exhausted, the system retries with backup tokens.

```env
# backend/.env
APIFY_API_TOKEN=apify_api_PRIMARY
APIFY_FALLBACK_TOKEN_1=apify_api_BACKUP1
APIFY_FALLBACK_TOKEN_2=apify_api_BACKUP2
```

- Every sync always tries the primary first. On HTTP 402/429, it falls to the next token.
- Tokens auto-reset monthly on their billing anniversary.
- Add as many backup tokens as needed (sequential numbering).

## Monitoring

```bash
cd backend && ./venv/bin/python3 scripts/check_quotas.py
```

Reports Apify token balances, Yelp daily limits, Supabase storage, and Gemini quota status.

## Key Documentation

| Document | Purpose |
|---|---|
| [PRD.md](PRD.md) | Product requirements — all features, screens, and capabilities |
| [TECHNICAL_SPEC.md](TECHNICAL_SPEC.md) | Architecture, API integrations, database schema, intelligence pipeline |
| [SAAS_ROADMAP.md](SAAS_ROADMAP.md) | SaaS registration, auth, billing roadmap |
