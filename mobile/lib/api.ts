import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Use env var if set (deployed builds), otherwise: web=localhost, device=Railway
// Use env var if set (deployed builds), otherwise: local for simulator/web, Railway for production
const getInitialApiBase = () => {
    if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;

    if (__DEV__) {
        // If in web browser and not on localhost (e.g. accessing via IP on phone),
        // default to that same IP for the backend.
        if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
            return `http://${window.location.hostname}:8000`;
        }
        return Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://127.0.0.1:8000';
    }

    return 'https://savoriq-api-production.up.railway.app';
};

const DEFAULT_API_BASE = getInitialApiBase();

const FETCH_TIMEOUT = 20000; // 20s timeout

async function getApiBase(): Promise<string> {
    const custom = await AsyncStorage.getItem('apiBase');
    return custom || DEFAULT_API_BASE;
}

async function getActiveRestaurantId(): Promise<string | null> {
    return AsyncStorage.getItem('activeRestaurantId');
}

export async function setActiveRestaurantId(id: string): Promise<void> {
    await AsyncStorage.setItem('activeRestaurantId', id);
}

async function getAccessKey(): Promise<string | null> {
    return AsyncStorage.getItem('accessKey');
}

export async function setAccessKey(key: string): Promise<void> {
    await AsyncStorage.setItem('accessKey', key);
}

export async function setApiBase(url: string | null): Promise<void> {
    if (url) {
        await AsyncStorage.setItem('apiBase', url);
    } else {
        await AsyncStorage.removeItem('apiBase');
    }
}

// ── Core Fetch Wrapper ──────────────────────────────────────────────

async function apiFetch<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const [apiBase, restaurantId, accessKey] = await Promise.all([
        getApiBase(),
        getActiveRestaurantId(),
        getAccessKey(),
    ]);

    const headers: Record<string, string> = {
        ...(options.headers as Record<string, string>),
    };

    if (restaurantId) {
        headers['X-Restaurant-ID'] = restaurantId;
    }

    headers['X-Access-Key'] = accessKey || 'SavorIQ';

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
        const res = await fetch(`${apiBase}${endpoint}`, {
            ...options,
            headers,
            signal: controller.signal,
        });
        clearTimeout(id);

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.detail || `API Error: ${res.status}`);
        }

        return res.json();
    } catch (e: any) {
        clearTimeout(id);
        if (e.name === 'AbortError') {
            throw new Error('Request timed out. Please check your connection.');
        }
        throw e;
    }
}

// ── Restaurant ──────────────────────────────────────────────────────

export interface Restaurant {
    id: string;
    name: string;
    platform_url: string;
}

export function fetchRestaurants(): Promise<Restaurant[]> {
    return apiFetch('/api/restaurants');
}

// ── Analytics ───────────────────────────────────────────────────────

export interface BucketSentiment {
    bucket: string;
    avg_score: number;
    review_count: number;
}

export interface Overview {
    total_guests: number;
    total_orders: number;
    total_reviews: number;
    avg_rating: number;
    sentiment_by_bucket: BucketSentiment[];
}

export interface ItemPerformance {
    item_name: string;
    category: string;
    order_count: number;
    avg_sentiment: number | null;
    review_count: number;
}

export interface ManagerInsight {
    title: string;
    description: string;
    type: string;
    steps: string[];
}

export interface ManagerBriefing {
    summary: string;
    insights: ManagerInsight[];
}

export interface UnmatchedMention {
    term: string;
    mention_count: number;
}

export interface DeepAnalytics {
    overview: Overview;
    top_performers: ItemPerformance[];
    risks: ItemPerformance[];
    unmatched_mentions: UnmatchedMention[];
    briefing: ManagerBriefing;
}

export function fetchOverview(): Promise<Overview> {
    return apiFetch('/api/analytics/overview');
}

export function fetchDeepAnalytics(): Promise<DeepAnalytics> {
    return apiFetch('/api/analytics/deep');
}

// ── Guests ──────────────────────────────────────────────────────────

export interface Guest {
    id: string;
    name: string;
    email: string | null;
    tier: string;
    first_visit: string;
    last_visit: string;
    visit_count?: number;
    avg_rating?: number;
    intercept_status?: string;
}

export interface GuestPulse {
    guest: Guest;
    total_orders: number;
    total_spend: number;
    favorite_items: string[];
    visit_count: number;
    sentiment_summary: { bucket: string; avg_score: number; review_count: number }[];
    recent_reviews: Review[];
}

export interface GuestPrioritized {
    guest: Guest;
    segment: string;
    priority_score: number;
    reason: string;
    recommended_action: string;
    total_spend: number;
    last_visit_days_ago: number;
    review_count: number;
    current_status: string;
    current_action: any | null;
}

export interface FetchGuestsFilters {
    tier?: string;
    sort_by?: 'recent' | 'rating' | 'reviews';
    limit?: number;
}

export function fetchGuests(filters: FetchGuestsFilters = {}): Promise<Guest[]> {
    const params = new URLSearchParams();
    if (filters.tier) params.append('tier', filters.tier);
    if (filters.sort_by) params.append('sort_by', filters.sort_by);
    if (filters.limit) params.append('limit', String(filters.limit));

    const url = `/api/guests${params.toString() ? '?' + params.toString() : ''}`;
    return apiFetch(url);
}

export function fetchGuestPriorities(): Promise<GuestPrioritized[]> {
    return apiFetch('/api/guests/priorities');
}

export function fetchGuest(id: string): Promise<Guest> {
    return apiFetch(`/api/guests/${id}`);
}

export function fetchGuestPulse(id: string): Promise<GuestPulse> {
    return apiFetch(`/api/guests/${id}/pulse`);
}

// ── Reviews ─────────────────────────────────────────────────────────

export interface Review {
    id: string;
    guest_id: string;
    platform: string;
    rating: number;
    content: string;
    reviewed_at: string;
    author_name: string | null;
    platform_review_id: string | null;
}

export function fetchAllReviews(filters?: {
    platform?: string;
    search?: string;
    days?: number;
}): Promise<Review[]> {
    const params = new URLSearchParams();
    if (filters?.platform) params.set('platform', filters.platform);
    if (filters?.search) params.set('search', filters.search);
    if (filters?.days) params.set('days', String(filters.days));
    return apiFetch(`/api/reviews?${params}`);
}

export interface ReviewStats {
    total: number;
    avg_rating: number;
    rating_distribution: Record<string, number>;
    platform_breakdown: Record<string, number>;
}

export function fetchReviewStats(filters?: {
    platform?: string;
    search?: string;
    days?: number;
}): Promise<ReviewStats> {
    const params = new URLSearchParams();
    if (filters?.platform) params.set('platform', filters.platform);
    if (filters?.search) params.set('search', filters.search);
    if (filters?.days) params.set('days', String(filters.days));
    return apiFetch(`/api/reviews/stats?${params}`);
}

// ── Sync ────────────────────────────────────────────────────────────

export function fetchSyncStatus(): Promise<any> {
    return apiFetch('/api/sync/status');
}

export function syncApifyReviews(platform: string, url: string, businessName: string): Promise<any> {
    const params = new URLSearchParams({
        platform,
        business_url: url,
        business_name: businessName,
        max_reviews: '100',
    });
    return apiFetch(`/api/sync/apify-reviews?${params}`, { method: 'POST' });
}

export function searchBusiness(name: string, location?: string, lat?: number | null, lng?: number | null): Promise<any> {
    const params = new URLSearchParams({ name });
    if (location) params.set('location', location);
    if (lat) params.set('lat', String(lat));
    if (lng) params.set('lng', String(lng));
    return apiFetch(`/api/sync/search?${params}`);
}



// ── Intercept Actions ───────────────────────────────────────────────

export function postInterceptAction(guestId: string, data: { action: string; note?: string }): Promise<any> {
    return apiFetch(`/api/guests/${guestId}/intercept/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
}
