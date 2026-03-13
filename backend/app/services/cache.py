"""In-memory TTL cache for API responses, keyed by (restaurant_id, endpoint).

Usage:
    from app.services.cache import api_cache
    
    # In your endpoint:
    cached = api_cache.get(restaurant_id, "deep_analytics")
    if cached is not None:
        return cached
    
    # ... compute result ...
    api_cache.set(restaurant_id, "deep_analytics", result)
    return result
    
    # After sync:
    api_cache.invalidate(restaurant_id)
"""

from __future__ import annotations

import time
import logging
from typing import Any

logger = logging.getLogger(__name__)

# Default TTL in seconds
DEFAULT_TTL = 300  # 5 minutes


class _CacheEntry:
    __slots__ = ("value", "expires_at")

    def __init__(self, value: Any, ttl: int):
        self.value = value
        self.expires_at = time.monotonic() + ttl


class APICache:
    """Simple in-memory cache with per-key TTL and restaurant-scoped invalidation."""

    def __init__(self, default_ttl: int = DEFAULT_TTL):
        self._store: dict[str, _CacheEntry] = {}
        self._default_ttl = default_ttl
        self._hits = 0
        self._misses = 0

    def _make_key(self, restaurant_id: str, endpoint: str, suffix: str = "") -> str:
        return f"{restaurant_id}:{endpoint}:{suffix}" if suffix else f"{restaurant_id}:{endpoint}"

    def get(self, restaurant_id: str, endpoint: str, suffix: str = "") -> Any | None:
        """Return cached value or None if expired/missing."""
        key = self._make_key(restaurant_id, endpoint, suffix)
        entry = self._store.get(key)
        if entry is None:
            self._misses += 1
            return None
        if time.monotonic() > entry.expires_at:
            del self._store[key]
            self._misses += 1
            return None
        self._hits += 1
        logger.debug(f"Cache HIT: {key}")
        return entry.value

    def set(self, restaurant_id: str, endpoint: str, value: Any, ttl: int | None = None, suffix: str = "") -> None:
        """Store a value with optional custom TTL."""
        key = self._make_key(restaurant_id, endpoint, suffix)
        self._store[key] = _CacheEntry(value, ttl or self._default_ttl)
        logger.debug(f"Cache SET: {key} (TTL={ttl or self._default_ttl}s)")

    def invalidate(self, restaurant_id: str) -> int:
        """Remove ALL cached entries for a given restaurant. Returns count of evicted keys."""
        prefix = f"{restaurant_id}:"
        keys_to_remove = [k for k in self._store if k.startswith(prefix)]
        for k in keys_to_remove:
            del self._store[k]
        if keys_to_remove:
            logger.info(f"Cache INVALIDATED {len(keys_to_remove)} keys for restaurant {restaurant_id}")
        return len(keys_to_remove)

    def invalidate_all(self) -> None:
        """Clear the entire cache."""
        count = len(self._store)
        self._store.clear()
        logger.info(f"Cache CLEARED: {count} keys removed")

    def stats(self) -> dict:
        """Return cache statistics."""
        return {
            "entries": len(self._store),
            "hits": self._hits,
            "misses": self._misses,
            "hit_rate": f"{self._hits / max(1, self._hits + self._misses) * 100:.1f}%",
        }


# Singleton instance — import this everywhere
api_cache = APICache()
