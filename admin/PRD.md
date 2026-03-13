# PRD: SavorIQ Admin Command Center

## Problem

SavorIQ relies on multiple external APIs (Apify, Yelp, Google, Supabase) with varying quotas and rate limits. Operators need visibility into:
- Which Apify tokens are exhausted vs. active
- How much free-tier credit remains across all accounts
- When quotas will reset
- Health of other integrated services

Previously, this required running a CLI script (`check_quotas.py`) manually in the terminal.

## Solution

A standalone **Admin Command Center** — a separate React web app that provides a visual, always-on dashboard for system monitoring.

## Requirements

### P0 (MVP — Shipped)
- [x] **API Quotas Dashboard**: Visual cards for all 16+ Apify tokens showing remaining credit, used amount, reset date, and active/exhausted status
- [x] **Service Status**: Yelp daily quota, Supabase storage usage, Google API info
- [x] **Auto-Refresh**: Dashboard updates every 60 seconds
- [x] **Dark Theme**: Premium "Command Center" aesthetic
- [x] **Decoupled**: Completely separate from customer-facing app

### P1 (Future)
- [ ] **Sync Logs**: View recent sync history, success/failure rates
- [ ] **Sync Controls**: Trigger manual syncs from admin UI
- [ ] **Alerts**: Visual/audio alerts when all tokens are exhausted
- [ ] **Review Pipeline**: Monitor sentiment analysis queue

### P2 (Nice-to-Have)
- [ ] **Settings Page**: Edit `.env` values from the UI
- [ ] **Multi-user Auth**: Admin login for team access
- [ ] **Deploy**: Host on Railway alongside the backend

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐
│  Admin Dashboard │────▶│  FastAPI Backend      │
│  (React / Vite)  │ API │  /api/admin/* routes  │
│  Port 5174       │◀────│  Port 8000            │
└─────────────────┘     └──────────┬───────────┘
                                   │
                         ┌─────────▼──────────┐
                         │  External APIs      │
                         │  Apify, Yelp,       │
                         │  Supabase, Google   │
                         └────────────────────┘
```

## Success Metrics

- Operator can check all API quotas within 5 seconds (vs. ~15s for CLI)
- Zero impact on customer-facing app performance
- New monitoring pages can be added in < 30 minutes
