const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function fetchGuests(tier = null) {
    const params = new URLSearchParams();
    if (tier) params.set("tier", tier);
    const res = await fetch(`${API_BASE}/api/guests?${params}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch guests");
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

export async function fetchAllReviews(platform = null, search = null, sentiment = null, days = null) {
    const params = new URLSearchParams();
    if (platform) params.set("platform", platform);
    if (search) params.set("search", search);
    if (sentiment) params.set("sentiment", sentiment);
    if (days !== null) params.set("days", days);
    const res = await fetch(`${API_BASE}/api/reviews?${params}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch reviews");
    return res.json();
}

export async function fetchReviewStats(platform = null, search = null, days = null) {
    const params = new URLSearchParams();
    if (platform) params.set("platform", platform);
    if (search) params.set("search", search);
    if (days !== null) params.set("days", days);
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
