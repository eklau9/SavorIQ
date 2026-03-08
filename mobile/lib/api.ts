import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// Use env var if set (deployed builds), otherwise: local for simulator/web, Railway for production
const getInitialApiBase = () => {
    // 1. Explicit env var (highest priority)
    if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;

    // 2. Localhost for development (web/simulator)
    // We check __DEV__ (global in Expo/React Native)
    if (__DEV__) {
        // Use 127.0.0.1 instead of localhost to avoid IPv6 resolution issues (::1) 
        // which can cause "Failed to fetch" if the server is only listening on IPv4.
        return 'http://127.0.0.1:8000';
    }

    // 3. Fallback to Railway Production
    return 'https://savoriq-api-production.up.railway.app';
};

const DEFAULT_API_BASE = getInitialApiBase();

const FETCH_TIMEOUT = 20000; // 20s timeout

export async function getApiBase(): Promise<string> {
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

async function apiFetch<T = any>(endpoint: string, options: RequestInit = {}, signal?: AbortSignal): Promise<T> {
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

    const localController = new AbortController();
    const id = setTimeout(() => localController.abort(), FETCH_TIMEOUT);

    try {
        const res = await fetch(`${apiBase}${endpoint}`, {
            ...options,
            headers,
            signal: signal || localController.signal,
        });
        clearTimeout(id);

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            let errorMsg = errorData.detail || `API Error: ${res.status}`;
            if (typeof errorMsg === 'object') {
                errorMsg = JSON.stringify(errorMsg);
            }
            throw new Error(errorMsg);
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
    address?: string; // Optional physical address
    platform_url: string;
}

export function fetchRestaurants(signal?: AbortSignal): Promise<Restaurant[]> {
    return apiFetch('/api/restaurants', {}, signal);
}


// ── Analytics ───────────────────────────────────────────────────────

export interface BucketSentiment {
    bucket: string;
    avg_score: number;
    review_count: number;
}

export interface Overview {
    total_guests: number;
    total_reviews: number;
    avg_rating: number;
    sentiment_by_bucket: BucketSentiment[];
}

export interface ItemPerformance {
    item_name: string;
    category: string;
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

export function fetchOverview(signal?: AbortSignal): Promise<Overview> {
    return apiFetch('/api/analytics/overview', {}, signal);
}

export function fetchDeepAnalytics(signal?: AbortSignal): Promise<DeepAnalytics> {
    return apiFetch('/api/analytics/deep', {}, signal);
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
    created_at: string;
}

export interface GuestPulse {
    guest: Guest;
    favorite_items: string[];
    visit_count: number;
    review_engagement_score: number;
    sentiment_summary: { bucket: string; avg_score: number; review_count: number }[];
    recent_reviews: Review[];
}

export interface GuestPrioritized {
    guest: Guest;
    segment: string;
    priority_score: number;
    reason: string;
    recommended_action: string;
    last_visit_days_ago: number;
    review_count: number;
    review_engagement_score: number;
    current_status: string;
    current_action: any | null;
}

export interface FetchGuestsFilters {
    tier?: string;
    sort_by?: 'recent' | 'rating' | 'reviews';
    limit?: number;
}

export function fetchGuests(filters: FetchGuestsFilters = {}, signal?: AbortSignal): Promise<Guest[]> {
    const params = new URLSearchParams();
    if (filters.tier) params.append('tier', filters.tier);
    if (filters.sort_by) params.append('sort_by', filters.sort_by);
    if (filters.limit) params.append('limit', String(filters.limit));

    const url = `/api/guests${params.toString() ? '?' + params.toString() : ''}`;
    return apiFetch(url, {}, signal);
}

export function fetchGuestPriorities(signal?: AbortSignal): Promise<GuestPrioritized[]> {
    return apiFetch('/api/guests/priorities', {}, signal);
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
    guest_name?: string; // High-level guest name from join
    platform_review_id: string | null;
}

export function fetchAllReviews(filters?: {
    platform?: string;
    search?: string;
    sentiment?: string;
    days?: number;
    limit?: number;
}, signal?: AbortSignal): Promise<Review[]> {
    const params = new URLSearchParams();
    if (filters?.platform) params.set('platform', filters.platform);
    if (filters?.search) params.set('search', filters.search);
    if (filters?.sentiment) params.set('sentiment', filters.sentiment);
    if (filters?.days) params.set('days', String(filters.days));
    if (filters?.limit) params.set('limit', String(filters.limit));
    return apiFetch(`/api/reviews?${params}`, {}, signal);
}

export interface ReviewStats {
    total: number;
    avg_rating: number;
    positive: number;
    negative: number;
    neutral: number;
    top_strength: string | null;
    top_friction: string | null;
    bucket_averages: Record<string, number>;
    rating_distribution: Record<string, number>;
}

export interface OperationsAnalytics {
    review_velocity: number;
    sentiment_momentum: number;
    tier_distribution: { tier: string; count: number }[];
    total_guests: number;
    platform_split: Record<string, number>;
}

export function fetchReviewStats(filters?: {
    platform?: string;
    search?: string;
    sentiment?: string;
    days?: number;
}, signal?: AbortSignal): Promise<ReviewStats> {
    const params = new URLSearchParams();
    if (filters?.platform) params.set('platform', filters.platform);
    if (filters?.search) params.set('search', filters.search);
    if (filters?.sentiment) params.set('sentiment', filters.sentiment);
    if (filters?.days) params.set('days', String(filters.days));
    return apiFetch(`/api/reviews/stats?${params}`, {}, signal);
}

export function fetchOperationsAnalytics(signal?: AbortSignal): Promise<OperationsAnalytics> {
    return apiFetch('/api/analytics/operations', {}, signal);
}

// ── Sync ────────────────────────────────────────────────────────────

export interface SyncStatus {
    last_synced_at: string;
    ago: string;
    on_cooldown: boolean;
    reviews_fetched: number;
    new_reviews: number;
}

export interface PlatformBusiness {
    id: string;
    name: string;
    address?: string;
    rating: number;
    review_count: number;
    url?: string;
    latitude?: number;
    longitude?: number;
    last_sync?: SyncStatus;
}

export interface UnifiedBusiness {
    id: string;
    name: string;
    address?: string;
    total_reviews: number;
    avg_rating: number;
    google?: PlatformBusiness;
    yelp?: PlatformBusiness;
    distance?: number;
}

export function fetchSyncStatus(): Promise<any> {
    return apiFetch('/api/sync/status');
}

export function syncApifyReviews(platform: string, url: string, name: string, address?: string): Promise<any> {
    const params = new URLSearchParams({
        platform,
        business_url: url,
        business_name: name,
    });
    if (address) params.append('business_address', address);
    return apiFetch(`/api/sync/apify-reviews?${params.toString()}`, { method: 'POST' });
}

export function searchBusiness(name: string, location?: string, lat?: number | null, lng?: number | null): Promise<UnifiedBusiness[]> {
    const params = new URLSearchParams({ name });
    if (location) params.set('location', location);
    if (lat) params.set('lat', String(lat));
    if (lng) params.set('lng', String(lng));
    return apiFetch(`/api/sync/search?${params}`);
}

export function resetAndSync(restaurantId: string): Promise<any> {
    return apiFetch(`/api/sync/reset-and-sync?restaurant_id=${restaurantId}`, {
        method: 'POST',
    });
}



// ── Intercept Actions ───────────────────────────────────────────────

export function postInterceptAction(guestId: string, data: { action: string; note?: string }): Promise<any> {
    return apiFetch(`/api/guests/${guestId}/intercept/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
}
