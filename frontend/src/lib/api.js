const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

/**
 * Helper to get the active restaurant ID from localStorage.
 */
function getActiveRestaurantId() {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("activeRestaurantId");
}

/**
 * Wrapper for fetch that automatically injects the X-Restaurant-ID header.
 */
async function apiFetch(endpoint, options = {}) {
    const restaurantId = getActiveRestaurantId();
    const headers = {
        ...options.headers,
        "X-Access-Key": "SavorIQ", // Required by backend
    };

    if (restaurantId) {
        headers["X-Restaurant-ID"] = restaurantId;
    }

    const res = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
    });

    if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const msg = typeof errorData.detail === 'string'
            ? errorData.detail
            : JSON.stringify(errorData.detail || errorData) || `API Error: ${res.status}`;
        throw new Error(msg);
    }

    return res.json();
}

export async function fetchRestaurants() {
    return apiFetch("/api/restaurants", { cache: "no-store" });
}

export async function fetchGuests({ tier = null, sort_by = "recent", limit = 1000, skip = 0 } = {}) {
    const params = new URLSearchParams();
    if (tier) params.set("tier", tier);
    if (sort_by) params.set("sort_by", sort_by);
    if (limit) params.set("limit", limit);
    if (skip) params.set("skip", skip);
    return apiFetch(`/api/guests?${params}`, { cache: "no-store" });
}

export async function fetchGuestPriorities() {
    return apiFetch("/api/guests/priorities", { cache: "no-store" });
}

export async function fetchGuest(id) {
    return apiFetch(`/api/guests/${id}`, { cache: "no-store" });
}

export async function fetchGuestPulse(id) {
    return apiFetch(`/api/guests/${id}/pulse`, { cache: "no-store" });
}

export async function fetchGuestOrders(id) {
    return apiFetch(`/api/guests/${id}/orders`, { cache: "no-store" });
}

export async function fetchAllReviews(platform = null, search = null, sentiment = null, days = null, date = null, bucket = null) {
    const params = new URLSearchParams();
    if (platform) params.set("platform", platform);
    if (search) params.set("search", search);
    if (sentiment) params.set("sentiment", sentiment);
    if (days !== null) params.set("days", days);
    if (date) params.set("date", date);
    if (bucket) params.set("bucket", bucket);
    return apiFetch(`/api/reviews?${params}`, { cache: "no-store" });
}

export async function fetchReviewStats(platform = null, search = null, days = null, date = null, bucket = null) {
    const params = new URLSearchParams();
    if (platform) params.set("platform", platform);
    if (search) params.set("search", search);
    if (days !== null) params.set("days", days);
    if (date) params.set("date", date);
    if (bucket) params.set("bucket", bucket);
    return apiFetch(`/api/reviews/stats?${params}`, { cache: "no-store" });
}

export async function fetchGuestReviews(id) {
    return apiFetch(`/api/guests/${id}/reviews`, { cache: "no-store" });
}

export async function fetchOverview() {
    return apiFetch("/api/analytics/overview", { cache: "no-store" });
}

export async function fetchDeepAnalytics() {
    return apiFetch("/api/analytics/deep", { cache: "no-store" });
}

export async function ingestReviews(data) {
    return apiFetch("/api/reviews/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
}

export async function ingestOrders(data) {
    return apiFetch("/api/orders/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
}

export async function fetchSentimentAnalytics() {
    return apiFetch("/api/analytics/sentiment", { cache: "no-store" });
}

export async function fetchOperationsAnalytics() {
    return apiFetch("/api/analytics/operations", { cache: "no-store" });
}

export async function postInterceptAction(guestId, data) {
    return apiFetch(`/api/guests/${guestId}/intercept/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
}

// ── Sync API ──────────────────────────────────────────────────────────

export async function searchBusiness(name, location, lat = null, lng = null) {
    const params = new URLSearchParams({ name });
    if (location) params.append("location", location);
    if (lat) params.append("lat", lat);
    if (lng) params.append("lng", lng);

    return apiFetch(`/api/sync/search?${params}`, { cache: "no-store" });
}

export async function syncApifyReviews(platform, url, businessName) {
    const params = new URLSearchParams({
        platform,
        business_url: url,
        business_name: businessName,
        max_reviews: 100, // Default to 100 for user-triggered syncs
    });
    return apiFetch(`/api/sync/apify-reviews?${params}`, {
        method: "POST",
    });
}

export async function fetchSyncStatus() {
    return apiFetch("/api/sync/status", { cache: "no-store" });
}
