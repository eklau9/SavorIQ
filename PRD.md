# SavorIQ Product Requirements Document (PRD)

## 1. Vision & Objective
**SavorIQ** is a "Third Space" Guest Intelligence Hub designed to bridge the gap between operational F&B data and guest sentiment. 

The primary objective is to empower restaurant managers and hospitality operators with actionable insights by connecting **what guests buy** (order history) with **how they feel** (review sentiment). 

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

---

## 4. Technical Requirements
*   **Backend**: FastAPI with SQLAlchemy (PostgreSQL).
*   **Frontend**: Next.js (React) with pure CSS visualizations.
*   **AI**: Google Gemini for sentiment analysis and strategic briefings.
*   **Deployment**: Docker & Kubernetes ready.

