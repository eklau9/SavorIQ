# SavorIQ Data Models

SQLAlchemy ORM models for the SavorIQ database.

## Core Models

- **`Restaurant`**: Represents a physical location/tenant. Stores basic info and addresses.
- **`Guest`**: Represents a customer profile. Tracks metadata across multiple reviews.
- **`Review`**: Individual feedback from Yelp or Google Maps. Linked to a guest and restaurant.
- **`SentimentScore`**: Deep sentiment segments (e.g., Food: 0.8, Service: -0.5) associated with a review.
- **`MenuItem`**: The official menu for a restaurant, used for analytics and mention extraction.
- **`SyncLog`**: Tracks when each platform was last synced to avoid API cooldowns.

## Design Patterns

- **UUIDs/Strings**: Most models use string-based IDs for compatibility across different environments.
- **Relationships**: Extensive use of SQLAlchemy relationships (e.g., `Review.sentiment_scores`) for easy data traversal.
- **Timestamp Tracking**: Use `created_at` and `reviewed_at` fields for temporal analysis.
