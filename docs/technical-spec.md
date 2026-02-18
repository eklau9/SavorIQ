# SavorIQ Technical Specification

## Overview

SavorIQ is a "Third Space" Guest Intelligence Hub that connects granular F&B (Food & Beverage) order history with multi-platform review sentiment analysis. The system ingests data from Yelp and Google Maps, categorizes reviews into Food, Drink, and Ambiance buckets, and presents unified guest profiles through an interactive dashboard.

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Next.js        │────▶│   FastAPI         │────▶│   PostgreSQL     │
│   Dashboard      │     │   Backend         │     │   Database       │
│   (Port 3000)    │◀────│   (Port 8000)     │◀────│   (Port 5432)    │
└─────────────────┘     └───────┬──────────┘     └──────────────────┘
                                │
                        ┌───────▼──────────┐
                        │   Gemini AI       │
                        │   Deep Sentiment  │
                        │   Skill           │
                        └──────────────────┘
```

**Stack**: FastAPI (Python) · Next.js (React) · PostgreSQL · Gemini AI · Kubernetes

---

## Database Schema

### Table: `guests`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `VARCHAR(36)` | PK, UUID | Unique guest identifier |
| `name` | `VARCHAR(200)` | NOT NULL | Guest full name |
| `email` | `VARCHAR(254)` | UNIQUE, NULLABLE | Guest email |
| `phone` | `VARCHAR(20)` | NULLABLE | Phone number |
| `tier` | `ENUM('new','regular','vip')` | DEFAULT 'new' | Loyalty tier |
| `first_visit` | `DATETIME` | NULLABLE | First recorded visit |
| `last_visit` | `DATETIME` | NULLABLE | Most recent visit |
| `created_at` | `DATETIME` | DEFAULT NOW | Record creation timestamp |

### Table: `orders`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `VARCHAR(36)` | PK, UUID | Unique order ID |
| `guest_id` | `VARCHAR(36)` | FK → guests.id | Associated guest |
| `item_name` | `VARCHAR(200)` | NOT NULL | Item ordered |
| `category` | `ENUM('food','drink')` | NOT NULL | Category bucket |
| `price` | `FLOAT` | NOT NULL | Unit price |
| `quantity` | `INTEGER` | DEFAULT 1 | Quantity ordered |
| `ordered_at` | `DATETIME` | DEFAULT NOW | Order timestamp |

### Table: `reviews`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `VARCHAR(36)` | PK, UUID | Unique review ID |
| `guest_id` | `VARCHAR(36)` | FK → guests.id | Associated guest |
| `platform` | `ENUM('yelp','google')` | NOT NULL | Source platform |
| `platform_review_id` | `VARCHAR(100)` | UNIQUE, NULLABLE | External ID for dedup |
| `rating` | `FLOAT` | NOT NULL | Star rating (0-5) |
| `content` | `TEXT` | NOT NULL | Review text |
| `reviewed_at` | `DATETIME` | DEFAULT NOW | Original review date |
| `ingested_at` | `DATETIME` | DEFAULT NOW | Ingestion timestamp |

### Table: `sentiment_scores`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `VARCHAR(36)` | PK, UUID | Unique score ID |
| `review_id` | `VARCHAR(36)` | FK → reviews.id | Associated review |
| `bucket` | `ENUM('food','drink','ambiance')` | NOT NULL | Sentiment category |
| `score` | `FLOAT` | NOT NULL | Sentiment (-1.0 to 1.0) |
| `summary` | `TEXT` | NULLABLE | Brief sentiment explanation |
| `analyzed_at` | `DATETIME` | DEFAULT NOW | Analysis timestamp |

---

## API Endpoints

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check — returns `{"status": "ok"}` |

### Guests

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/guests` | List guests (query: `?tier=&skip=&limit=`) |
| `GET` | `/api/guests/{id}` | Get single guest |
| `POST` | `/api/guests` | Create new guest |
| `GET` | `/api/guests/{id}/pulse` | **Guest Pulse** — aggregate profile |

#### `GET /api/guests/{id}/pulse` — Response

```json
{
  "guest": { "id": "...", "name": "Maya Chen", "tier": "vip", ... },
  "total_orders": 11,
  "total_spend": 64.50,
  "favorite_items": ["Oat Milk Latte", "Espresso", "Croissant"],
  "visit_count": 8,
  "sentiment_summary": [
    { "bucket": "food", "avg_score": 0.75, "review_count": 4 },
    { "bucket": "drink", "avg_score": 0.85, "review_count": 4 },
    { "bucket": "ambiance", "avg_score": 0.60, "review_count": 3 }
  ],
  "recent_reviews": [ ... ]
}
```

### Orders

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/guests/{id}/orders` | Order history for guest |
| `POST` | `/api/orders/ingest` | Bulk ingest orders from JSON |

### Reviews

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/guests/{id}/reviews` | Reviews for guest (query: `?platform=`) |
| `POST` | `/api/reviews/ingest` | Bulk ingest reviews + auto-sentiment |

#### `POST /api/reviews/ingest` — Request (Yelp)

```json
{
  "platform": "yelp",
  "reviews": [
    {
      "review_id": "yelp-r-001",
      "guest_name": "Maya Chen",
      "guest_email": "maya@email.com",
      "rating": 5.0,
      "text": "The oat milk latte is amazing...",
      "date": "2026-01-15"
    }
  ]
}
```

#### `POST /api/reviews/ingest` — Request (Google Maps)

```json
{
  "platform": "google",
  "reviews": [
    {
      "review_id": "goog-r-001",
      "author_name": "Maya Chen",
      "author_email": "maya@email.com",
      "rating": 5.0,
      "text": "My favorite coffee shop...",
      "time": "2026-02-10T09:30:00"
    }
  ]
}
```

### Analytics

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/analytics/overview` | Aggregate stats across all data |

---

## Deep Sentiment Skill

The sentiment analysis system categorizes each review into three buckets:

| Bucket | Examples |
|---|---|
| **Food** | food, dish, meal, taste, flavor, menu, chef, pasta, burger, dessert |
| **Drink** | coffee, latte, espresso, tea, beer, wine, cocktail, juice, barista |
| **Ambiance** | atmosphere, decor, vibe, music, lighting, cozy, seating, patio |

**Scoring**: Each bucket receives a score from **-1.0** (very negative) to **+1.0** (very positive).

**Implementation**: Uses Gemini AI when `GEMINI_API_KEY` is configured, otherwise falls back to a keyword-based heuristic engine.

---

## Kubernetes Deployment

| Resource | Name | Type |
|---|---|---|
| Namespace | `savoriq` | Namespace |
| Database | `postgres` | StatefulSet (1 replica, 5Gi PVC) |
| Backend | `savoriq-backend` | Deployment (2 replicas) |
| Frontend | `savoriq-frontend` | Deployment (2 replicas) |
| DB Service | `postgres` | ClusterIP:5432 |
| API Service | `savoriq-backend` | ClusterIP:8000 |
| Web Service | `savoriq-frontend` | LoadBalancer:80→3000 |
