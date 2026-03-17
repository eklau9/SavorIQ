import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import {
    fetchDeepAnalytics,
    fetchGuests,
    fetchAllReviews,
    fetchReviewStats,
    DeepAnalytics,
    Guest,
    Review,
    ReviewStats,
    fetchGuestPriorities,
    GuestPrioritized,
    fetchOperationsAnalytics,
    OperationsAnalytics,
    fetchBriefing
} from './api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRestaurant } from './RestaurantContext';

// AsyncStorage cache helpers
const CACHE_KEY_PREFIX = 'savoriq_dashboard_cache_';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function saveCacheToDisk(restaurantId: string, cache: Record<string, DeepAnalytics>) {
    try {
        const payload = { timestamp: Date.now(), data: cache };
        await AsyncStorage.setItem(CACHE_KEY_PREFIX + restaurantId, JSON.stringify(payload));
    } catch (e) {
        console.warn('Failed to save cache to disk:', e);
    }
}

async function loadCacheFromDisk(restaurantId: string): Promise<Record<string, DeepAnalytics> | null> {
    try {
        const raw = await AsyncStorage.getItem(CACHE_KEY_PREFIX + restaurantId);
        if (!raw) return null;
        const { timestamp, data } = JSON.parse(raw);
        // Invalidate if older than 24 hours
        if (Date.now() - timestamp > CACHE_TTL_MS) {
            await AsyncStorage.removeItem(CACHE_KEY_PREFIX + restaurantId);
            return null;
        }
        return data;
    } catch (e) {
        console.warn('Failed to load cache from disk:', e);
        return null;
    }
}

async function clearDiskCache(restaurantId: string) {
    try {
        await AsyncStorage.removeItem(CACHE_KEY_PREFIX + restaurantId);
    } catch (e) {
        // ignore
    }
}

interface DataContextType {
    dashboardData: DeepAnalytics | null;
    guests: Guest[];
    reviews: Review[];
    reviewStats: ReviewStats | null;
    operations: OperationsAnalytics | null;
    priorities: GuestPrioritized[];
    loading: boolean;
    progress: number;
    loadingStep: string;
    estimatedSecondsRemaining: number;
    error: string | null;
    briefingLoaded: boolean;
    timeRange: number | null;
    setTimeRange: (range: number | null) => void;
    refreshAll: (days?: number | null) => Promise<void>;
}

const DataContext = createContext<DataContextType>({
    dashboardData: null,
    guests: [],
    reviews: [],
    reviewStats: null,
    operations: null,
    priorities: [],
    loading: false,
    progress: 0,
    loadingStep: '',
    estimatedSecondsRemaining: 0,
    error: null,
    briefingLoaded: false,
    timeRange: 90,
    setTimeRange: () => {},
    refreshAll: async (days?: number | null) => { },
});

export function DataProvider({ children }: { children: React.ReactNode }) {
    const { activeId } = useRestaurant();
    const [dashboardData, setDashboardData] = useState<DeepAnalytics | null>(null);
    const [guests, setGuests] = useState<Guest[]>([]);
    const [reviews, setReviews] = useState<Review[]>([]);
    const [reviewStats, setReviewStats] = useState<ReviewStats | null>(null);
    const [operations, setOperations] = useState<OperationsAnalytics | null>(null);
    const [priorities, setPriorities] = useState<GuestPrioritized[]>([]);
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [loadingStep, setLoadingStep] = useState('');
    const [estimatedSecondsRemaining, setEstimatedSecondsRemaining] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [briefingLoaded, setBriefingLoaded] = useState(false);
    const [timeRange, setTimeRange] = useState<number | null>(90);

    const abortControllerRef = useRef<AbortController | null>(null);
    const dashboardCache = useRef<Record<string, DeepAnalytics>>({});
    const lastFetchedParams = useRef<{ id: string | null, days: number | null }>({ id: null, days: null });
    const currentDaysRef = useRef<number | null | undefined>(undefined);
    const coldLoadRef = useRef(true); // True until first successful load
    const diskCacheHydrated = useRef(false);

    // Hydrate in-memory cache from AsyncStorage on mount
    useEffect(() => {
        if (!activeId || diskCacheHydrated.current) return;
        diskCacheHydrated.current = true;
        
        (async () => {
            const diskCache = await loadCacheFromDisk(activeId);
            if (diskCache) {
                dashboardCache.current = diskCache;
                // Check if all 5 frames have briefings
                const ALL_KEYS = ['30', '90', '180', '365', 'all'];
                const allLoaded = ALL_KEYS.every(k => diskCache[k]?.briefing);
                if (allLoaded) {
                    // Everything is cached on disk — skip Gemini calls entirely
                    coldLoadRef.current = false;
                    const currentKey = timeRange ? String(timeRange) : 'all';
                    if (diskCache[currentKey]) {
                        setDashboardData(diskCache[currentKey]);
                        setBriefingLoaded(true);
                    }
                    console.log('[DataContext] Hydrated all 5 frames from disk cache — skipping Gemini');
                } else {
                    console.log('[DataContext] Partial disk cache — will fetch missing briefings');
                }
            }
        })();
    }, [activeId]);

    const refreshAll = useCallback(async (days?: number | null) => {
        if (!activeId) return;

        const cacheKey = days ? String(days) : 'all';
        currentDaysRef.current = days;

        // 1. Instant Cache HIT - Show data immediately
        const cached = dashboardCache.current[cacheKey];
        if (cached) {
            setDashboardData(cached);
            // If cache has a real briefing, we're fully loaded — skip everything
            if (dashboardCache.current[cacheKey].briefing) {
                setBriefingLoaded(true);
                setLoading(false);
                if (Platform.OS === 'web' && typeof window !== 'undefined') {
                    window.dispatchEvent(new Event('savoriq-ready'));
                }
                return;
            }
            // Cache has analytics but no briefing — show data, retry briefing only (lightweight)
            setLoading(false);
            fetchBriefing(days).then((briefing) => {
                const updated = { ...dashboardCache.current[cacheKey], briefing };
                dashboardCache.current[cacheKey] = updated;
                if (currentDaysRef.current === days) {
                    setDashboardData(updated);
                }
                setBriefingLoaded(true);
            }).catch(() => { /* silently fail, will retry on next visit */ });
            return;
        } else {
            // No cache: show splash ONLY on first-ever load (no previous data).
            // On time-range switches, keep the previous data visible.
            if (!dashboardData) {
                setLoading(true);
            }
            setBriefingLoaded(false);
        }

        // Cancel any existing request
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        const controller = new AbortController();
        abortControllerRef.current = controller;

        setError(null);
        setProgress(0);
        setLoadingStep('Initializing Intelligence Hub...');
        setEstimatedSecondsRemaining(5);

        const startTime = Date.now();
        const progressInterval = setInterval(() => {
            const elapsed = (Date.now() - startTime) / 1000;
            const remaining = Math.max(0, 5 - elapsed);
            setEstimatedSecondsRemaining(Math.ceil(remaining));

            setProgress(prev => {
                if (prev < 90) return prev + 2;
                return prev;
            });
            
            if (elapsed > 1) setLoadingStep('Analyzing Guest Profiles...');
            if (elapsed > 2.5) setLoadingStep('Fetching Deep Analytics...');
            if (elapsed > 4) setLoadingStep('Finalizing Sync...');
        }, 300);

        try {
            // Fetch critical dashboard data with a 15s timeout
            const deepData = await Promise.race([
                fetchDeepAnalytics(days, controller.signal),
                new Promise<never>((_, reject) => 
                    setTimeout(() => reject(new Error('Dashboard load timed out. Please try refreshing.')), 15000)
                )
            ]);
            const freshData = { ...deepData, briefing: null };
            
            // Update active view if still on this frame
            if (currentDaysRef.current === days) {
                setDashboardData(freshData);
            }
            // Update cache
            dashboardCache.current[cacheKey] = freshData;

            clearInterval(progressInterval);
            setProgress(100);
            setLoadingStep('Sync Complete');
            setEstimatedSecondsRemaining(0);

            // If no briefing to wait for (cache hit scenario), mark loading done
            // Otherwise briefing .then/.catch will handle it

            // Fetch briefing — on cold load, splash stays visible until this resolves
            const briefingPromise = Promise.race([
                fetchBriefing(days, controller.signal),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('Briefing timed out')), 30000)
                )
            ]).then((briefing) => {
                const updated = { ...freshData, briefing };
                dashboardCache.current[cacheKey] = updated;
                
                // Only update state if this frame is still active
                if (currentDaysRef.current === days) {
                    setDashboardData(updated);
                }
                setBriefingLoaded(true);
                coldLoadRef.current = false;
                // Persist to disk after briefing loads
                if (activeId) saveCacheToDisk(activeId, dashboardCache.current);
            }).catch((e: any) => {
                if (e.name !== 'AbortError') {
                    console.warn('Briefing fetch failed:', e);
                    // DON'T cache the fallback — leave briefing as null so it retries next time
                    // Just update the UI to show the error message
                    if (currentDaysRef.current === days) {
                        setDashboardData(prev => prev ? { ...prev, briefing: {
                            summary: "Briefing temporarily unavailable. Pull to refresh to retry.",
                            insights: []
                        }} : null);
                    }
                }
                setBriefingLoaded(true);
                coldLoadRef.current = false;
            });

            // On cold load, wait for briefing before dismissing splash
            if (coldLoadRef.current) {
                await briefingPromise;
                setLoadingStep('Loading insights for other date ranges...');
                setProgress(40);
            }

            // Fetch other background metrics with timeouts to prevent hanging
            const withTimeout = (promise: Promise<any>, ms = 15000) => {
                return Promise.race([
                    promise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Background fetch timed out')), ms))
                ]);
            };

            const bgOps = [
                withTimeout(fetchGuests({}, controller.signal)).then(setGuests),
                withTimeout(fetchAllReviews({}, controller.signal)).then(setReviews),
                withTimeout(fetchReviewStats(undefined, controller.signal)).then(setReviewStats),
                withTimeout(fetchGuestPriorities(controller.signal)).then(setPriorities),
                withTimeout(fetchOperationsAnalytics(controller.signal)).then(setOperations),
            ];

            Promise.allSettled(bgOps);

            // On cold load, prefetch ALL other frames and wait for them before dismissing splash
            if (coldLoadRef.current && abortControllerRef.current === controller) {
                await prefetchOtherFrames(controller.signal, true);
            }
            
        } catch (err: any) {
            if (err.name === 'AbortError') {
                console.info('Sync aborted');
            } else {
                console.error('RefreshAll failed:', err);
                setError(err.message || 'Data sync failed');
            }
        } finally {
            clearInterval(progressInterval);
            // On cold load, loading was kept alive until briefing resolved above
            setLoading(false);
            setProgress(100);
            setLoadingStep('Sync Complete');
            setEstimatedSecondsRemaining(0);
            coldLoadRef.current = false;
            
            if (abortControllerRef.current === controller) {
                lastFetchedParams.current = { id: activeId, days: days || null };

                // Dismiss web splash once everything is ready
                if (Platform.OS === 'web' && typeof window !== 'undefined') {
                    window.dispatchEvent(new Event('savoriq-ready'));
                }

                // On warm refresh (not cold load), prefetch in background
                if (!coldLoadRef.current) {
                    prefetchOtherFrames(controller.signal, false);
                }
            }
        }
    }, [activeId]);

    const prefetchOtherFrames = async (signal: AbortSignal, showProgress: boolean = false) => {
        const ALL_FRAMES: (number | null)[] = [30, 90, 180, 365, null]; 
        const otherFrames = ALL_FRAMES.filter(f => f !== currentDaysRef.current);
        const frameLabels: Record<string, string> = { '30': '30 Day', '90': '90 Day', '180': '6 Month', '365': '1 Year', 'all': 'All Time' };
        
        // Step 1: Fetch ALL analytics data in parallel (fast DB queries, no rate limit)
        if (showProgress) setLoadingStep('Fetching analytics for all date ranges...');
        const analyticsPromises = otherFrames.map(async (frame) => {
            const key = frame ? String(frame) : 'all';
            if (dashboardCache.current[key]) return; // Already cached
            
            try {
                const data = await fetchDeepAnalytics(frame, signal);
                const frameData = { ...data, briefing: null };
                dashboardCache.current[key] = frameData;
                
                // If user switched to this frame while loading, show the data immediately
                if (currentDaysRef.current === frame) {
                    setDashboardData(frameData);
                }
            } catch (e) {
                // Silently fail
            }
        });
        
        await Promise.allSettled(analyticsPromises);
        
        // Step 2: Fetch briefings sequentially (Gemini RPM limit: 15/min, use 4s spacing)
        let completed = 1; // Current frame's briefing already loaded
        const total = ALL_FRAMES.length;
        
        for (const frame of otherFrames) {
            const key = frame ? String(frame) : 'all';
            if (dashboardCache.current[key]?.briefing) {
                completed++;
                continue; // Already has briefing
            }
            if (!dashboardCache.current[key]) {
                completed++;
                continue; // Analytics failed, skip
            }
            
            try {
                if (showProgress) {
                    setLoadingStep(`Generating ${frameLabels[key] || key} insight (${completed + 1} of ${total})...`);
                    setProgress(40 + Math.round((completed / total) * 55));
                }
                await new Promise(resolve => setTimeout(resolve, 4000));
                const briefing = await fetchBriefing(frame, signal);
                dashboardCache.current[key] = { ...dashboardCache.current[key], briefing };
                
                // If user is currently viewing this frame, update the UI
                if (currentDaysRef.current === frame) {
                    setDashboardData(prev => prev ? { ...prev, briefing } : null);
                }
            } catch (e) {
                // Silently fail pre-fetches
            }
            completed++;
        }
        
        // Persist entire cache to disk after all frames are loaded
        if (activeId) saveCacheToDisk(activeId, dashboardCache.current);
    };

    // Dismiss web splash on cache hits too
    useEffect(() => {
        if (dashboardData && !loading) {
            if (Platform.OS === 'web' && typeof window !== 'undefined') {
                window.dispatchEvent(new Event('savoriq-ready'));
            }
        }
    }, [dashboardData, loading]);

    // Reset data when restaurant changes
    useEffect(() => {
        if (!activeId) {
            setDashboardData(null);
            setGuests([]);
            setReviews([]);
            setReviewStats(null);
            setOperations(null);
            setBriefingLoaded(false);
            dashboardCache.current = {};
            lastFetchedParams.current = { id: null, days: null };
            diskCacheHydrated.current = false;
        }
    }, [activeId]);

    return (
        <DataContext.Provider value={{
            dashboardData,
            guests,
            reviews,
            reviewStats,
            operations,
            priorities,
            loading,
            progress,
            loadingStep,
            estimatedSecondsRemaining,
            error,
            refreshAll,
            briefingLoaded,
            timeRange,
            setTimeRange,
        }}>
            {children}
        </DataContext.Provider>
    );
}

export function useData() {
    return useContext(DataContext);
}
