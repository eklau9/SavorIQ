# SavorIQ Product Requirements Document (PRD)

## 1. Vision & Objective
**SavorIQ** is a "Third Space" Guest Intelligence Hub designed to bridge the gap between operational F&B data and guest sentiment. 

The primary objective is to empower restaurant managers and hospitality operators with actionable insights by connecting **what guests buy** (order history) with **how they feel** (review sentiment). This allows for highly personalized guest engagement and targeted operational improvements.

---

## 2. Target Audience
*   **Restaurant Managers**: To identify operational friction points (e.g., slow service, cold food) and top-performing items.
*   **Hospitality Groups**: To understand guest loyalty and sentiment across multiple locations and platforms.
*   **Marketing Teams**: To segment guests for personalized promotions based on their "Guest Pulse."

---

## 3. Core Features

### 3.1 Data Ingestion Pipeline
*   **Multi-Platform Support**: Ability to ingest reviews from Yelp and Google Maps.
*   **POS Integration**: Support for bulk ingestion of F&B order history via JSON.
*   **Deduplication**: Automatic detection of duplicate reviews to ensure data integrity.

### 3.2 Deep Sentiment Analysis (Powered by Gemini AI)
*   **Contextual Categorization**: Reviews are automatically categorized into three domains:
    *   **Food**: Taste, presentation, quality.
    *   **Drink**: Coffee quality, bar service, beverage variety.
    *   **Ambiance**: Atmosphere, cleanliness, seating.
*   **Granular Scoring**: Sentiment is scored from -1.0 (Critical) to +1.0 (Excellent) per category.
*   **AI Insights**: Automated summaries explaining the sentiment behind the scores.

### 3.3 Guest Intelligence & Smart Intercepts
*   **Prioritized Action Inbox**: Instead of a flat list, the manager is presented with prioritized "Intercepts" (e.g., At-Risk VIPs, Churn Risks).
*   **Actionable Playbooks**: Each guest intercept includes a recommended "Counter-Measure" (e.g., "Gift a free item to recover sentiment").
*   **Smart Segmentation**: Automatic categorization of guests into groups like "Promoters," "Risks," and "Big Spenders" based on order and sentiment history.

### 3.4 Interactive Dashboard
*   **Executive Overview**: High-level metrics for Total Guests, Orders, and Average Rating.
*   **Diagnostics**: Identification of "Top Strengths" and "Top Friction" points based on AI sentiment analysis.
*   **Guest Registry**: Searchable directory of guests with quick-glance status indicators.

---

## 4. User Stories
1.  **As a Manager**, I want to see which menu items are being criticized in reviews so I can address kitchen or supply issues immediately.
2.  **As an Owner**, I want to identify my "Frequent Flyers" (VIPs) who have left negative reviews so I can personally reach out and recover that relationship.
3.  **As a Barista**, I want to see if our recent change in coffee beans has improved "Drink" sentiment in online reviews.

---

## 5. Success Metrics
*   **Sentiment Correlation**: Percentage of "VIP" guests with high sentiment scores.
*   **Operational Recovery**: reduction in "Negative" sentiment in "Friction" categories over time.
*   **Data Completeness**: Percentage of guests in the database who have both order and review data linked.

---

## 6. Technical Requirements
*   **Backend**: FastAPI for high-performance async processing.
*   **Frontend**: Next.js (React) for a responsive, modern dashboard.
*   **AI**: Integration with Google Gemini for advanced linguistic analysis.
*   **Deployment**: Containerized with Docker and Kubernetes for scalability.
