# SavorIQ Product Requirements Document (PRD)

## 1. Vision & Objective
**SavorIQ** is a "Third Space" Guest Intelligence Hub designed to bridge the gap between operational F&B data and guest sentiment. 

The primary objective is to empower restaurant managers and hospitality operators with actionable insights by connecting **what guests buy** (order history) with **how they feel** (review sentiment). 

### Key Objectives
1.  **AI-Driven Guest Resolution:** Identify critical review patterns and provide actionable manager intercepts.
2.  **Multi-Platform Integration:** Unified view of Yelp and Google Maps reviews alongside internal order data.
3.  **Tiered Loyalty Insights:** Segment guests into VIP, Regular, and New based on spend and feedback frequency.
4.  **Multi-Tenant Isolation:** Ensure absolute data privacy between different restaurant locations/brands.
5.  **Operational Intelligence:** Surface food/drink/ambiance trends to drive menu and service improvements.

---

## 2. Target Audience
*   **Restaurant Managers**: To identify operational friction points and resolve guest issues.
*   **Hospitality Groups**: To understand loyalty and sentiment across platforms.
*   **Marketing Teams**: To segment guests based on their "Review Pulse."

---

## 3. Core Features

### 3.1 Data Ingestion & Analytics
*   **Multi-Platform Support**: Yelp and Google Maps reviews.
*   **Deep Sentiment Analysis**: Contextual categorization into **Food**, **Drink**, and **Ambiance**.
*   **Analytics Pages**: Dedicated views for Sentiment trends and Operational KPIs (Revenue, AOV, Guest Segments).

### 3.2 Guest Intelligence & Smart Intercepts
*   **Prioritized Action Inbox**: Managers see prioritized "Intercepts" needing attention.
*   **Review-Based VIP Tiers**:
    *   **VIP Reviewer**: 3+ reviews.
    *   **Regular Reviewer**: 2 reviews.
    *   **One-Time Reviewer**: 1 review.
*   **Rating-Based Logic**:
    *   **1-2 Stars**: Triggers a Priority Inbox intercept.
    *   **3 Stars**: Surface via AI Insights (Operational feedback) but no priority action.
    *   **4-5 Stars**: Auto-resolve positive sentiment.

### 3.3 Resolution Workflow
*   **Intercept Statuses**:
    *   `Open`: New issue, needs attention.
    *   `Actioned`: Manager has taken a step (e.g., outreach, comp).
    *   `Resolved`: Guest returned with positive feedback or issue confirmed fixed.
    *   `Dismissed`: Issue > 3 months old (6 months for VIPs) without action.
*   **Auto-Resolution**: System automatically marks issues as `Resolved` if the guest later leaves a 4-5 star review.

### 3.4 Interactive Dashboard
*   **Executive Overview**: High-level metrics and AI Manager Briefing.
*   **Diagnostics**: Clear visualization of "Top Performers" and "At-Risk Items."

### 3.5 Review Data Integration
*   **Primary Source**: Apify actors for both Google Maps and Yelp review scraping.
    *   **Google**: `compass/google-maps-reviews-scraper` — Fetch all reviews including "Ratings only" content.
    *   **Yelp**: `tri_angle~yelp-review-scraper` — Reliable scraping that bypasses paywalled Yelp API.
*   **Sync Cadence**: Daily with 24-hour cooldown per business per platform.
*   **Deduplication**: Each review tracked by unique `platform_review_id` to prevent duplicates across syncs.
*   **Budget & Usage Strategy**:
    *   **Discovery (Lightweight)**: The search bar utilizes the Yelp Fusion and Google Places APIs for "Discovery" (finding names, addresses, and URLs). These are low-cost, high-speed requests.
    *   **Sync (Intensive)**: Apify actors are utilized ONLY when the "Sync Reviews" button is triggered. This conserves credits by reserving intensive scraping for confirmed data ingestion.
    *   **Proactive Feedback**: Search results cross-reference `SyncLog` data to proactively display cooldown status and disable sync triggers for recently updated businesses.

---

## 4. Technical Requirements
*   **Backend**: FastAPI with SQLAlchemy (Supabase Cloud PostgreSQL via `asyncpg`).
*   **Frontend**: Next.js (React) with pure CSS visualizations.
*   **APIs & Integrations**: SavorIQ uses Google Places, Yelp Fusion, Apify, Google Gemini, and Browser Geolocation. For the definitive directory of API usage, limits, and costs, see [TECHNICAL_SPEC.md](file:///Users/Ed/Apps/SavorIQ/TECHNICAL_SPEC.md).
*   **Deployment**: Docker & Kubernetes ready.
