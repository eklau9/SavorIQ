const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function fetchGuests(tier = null) {
    const params = new URLSearchParams();
    if (tier) params.set("tier", tier);
    const res = await fetch(`${API_BASE}/api/guests?${params}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch guests");
    return res.json();
}

export async function fetchGuestPriorities() {
    const res = await fetch(`${API_BASE}/api/guests/priorities`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch guest priorities");
    return res.json();
}

export async function fetchGuest(id) {
    const res = await fetch(`${API_BASE}/api/guests/${id}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch guest");
    return res.json();
}

export async function fetchGuestPulse(id) {
    const res = await fetch(`${API_BASE}/api/guests/${id}/pulse`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch guest pulse");
    return res.json();
}

export async function fetchGuestOrders(id) {
    const res = await fetch(`${API_BASE}/api/guests/${id}/orders`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch orders");
    return res.json();
}

export async function fetchAllReviews(platform = null, search = null, sentiment = null, days = null, date = null, bucket = null) {
    const params = new URLSearchParams();
    if (platform) params.set("platform", platform);
    if (search) params.set("search", search);
    if (sentiment) params.set("sentiment", sentiment);
    if (days !== null) params.set("days", days);
    if (date) params.set("date", date);
    if (bucket) params.set("bucket", bucket);
    const res = await fetch(`${API_BASE}/api/reviews?${params}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch reviews");
    return res.json();
}

export async function fetchReviewStats(platform = null, search = null, days = null, date = null, bucket = null) {
    const params = new URLSearchParams();
    if (platform) params.set("platform", platform);
    if (search) params.set("search", search);
    if (days !== null) params.set("days", days);
    if (date) params.set("date", date);
    if (bucket) params.set("bucket", bucket);
    const res = await fetch(`${API_BASE}/api/reviews/stats?${params}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch review stats");
    return res.json();
}

export async function fetchGuestReviews(id) {
    const res = await fetch(`${API_BASE}/api/guests/${id}/reviews`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch reviews");
    return res.json();
}

export async function fetchOverview() {
    const res = await fetch(`${API_BASE}/api/analytics/overview`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch overview");
    return res.json();
}

export async function fetchDeepAnalytics() {
    const res = await fetch(`${API_BASE}/api/analytics/deep`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch deep analytics");
    return res.json();
}

export async function ingestReviews(data) {
    const res = await fetch(`${API_BASE}/api/reviews/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    return res.json();
}

export async function ingestOrders(data) {
    const res = await fetch(`${API_BASE}/api/orders/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    return res.json();
}

export async function fetchSentimentAnalytics() {
    const res = await fetch(`${API_BASE}/api/analytics/sentiment`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch sentiment analytics");
    return res.json();
}

export async function fetchOperationsAnalytics() {
    const res = await fetch(`${API_BASE}/api/analytics/operations`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch operations analytics");
    return res.json();
}

export async function postInterceptAction(guestId, data) {
    const res = await fetch(`${API_BASE}/api/guests/${guestId}/intercept/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to post intercept action");
    return res.json();
}

// ── Sync API ──────────────────────────────────────────────────────────

export async function searchBusiness(name, location, lat = null, lng = null) {
    const params = new URLSearchParams({ name });
    if (location) params.append("location", location);
    if (lat) params.append("lat", lat);
    if (lng) params.append("lng", lng);

    const res = await fetch(`${API_BASE}/api/sync/search?${params}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to search businesses");
    return res.json();
}

export async function syncApifyReviews(platform, url, businessName) {
    const params = new URLSearchParams({
        platform,
        business_url: url,
        business_name: businessName,
        max_reviews: 100, // Default to 100 for user-triggered syncs
    });
    const res = await fetch(`${API_BASE}/api/sync/apify-reviews?${params}`, {
        method: "POST",
    });
    if (!res.ok) throw new Error("Failed to sync reviews via Apify");
    return res.json();
}

export async function fetchSyncStatus() {
    const res = await fetch(`${API_BASE}/api/sync/status`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch sync status");
    return res.json();
}
