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
    fetchBriefing,
    fetchHistoricalTrends,
    HistoricalTrends,
} from './api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRestaurant } from './RestaurantContext';

// AsyncStorage cache helpers
const CACHE_KEY_PREFIX = 'savoriq_dashboard_cache_';
const BG_CACHE_KEY_PREFIX = 'savoriq_bgdata_cache_';
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
        await AsyncStorage.removeItem(BG_CACHE_KEY_PREFIX + restaurantId);
    } catch (e) {
        // ignore
    }
}

// Background data cache (guests, reviews, stats, priorities, operations)
async function saveBgCacheToDisk(restaurantId: string, data: {
    guests: Guest[]; reviews: Review[]; reviewStats: ReviewStats | null;
    priorities: GuestPrioritized[]; operations: OperationsAnalytics | null;
}) {
    try {
        const payload = { timestamp: Date.now(), data };
        await AsyncStorage.setItem(BG_CACHE_KEY_PREFIX + restaurantId, JSON.stringify(payload));
    } catch (e) {
        console.warn('Failed to save bg cache to disk:', e);
    }
}

async function loadBgCacheFromDisk(restaurantId: string): Promise<{
    guests: Guest[]; reviews: Review[]; reviewStats: ReviewStats | null;
    priorities: GuestPrioritized[]; operations: OperationsAnalytics | null;
} | null> {
    try {
        const raw = await AsyncStorage.getItem(BG_CACHE_KEY_PREFIX + restaurantId);
        if (!raw) return null;
        const { timestamp, data } = JSON.parse(raw);
        if (Date.now() - timestamp > CACHE_TTL_MS) {
            await AsyncStorage.removeItem(BG_CACHE_KEY_PREFIX + restaurantId);
            return null;
        }
        return data;
    } catch (e) {
        console.warn('Failed to load bg cache from disk:', e);
        return null;
    }
}

interface DataContextType {
    dashboardData: DeepAnalytics | null;
    guests: Guest[];
    reviews: Review[];
    reviewStats: ReviewStats | null;
    operations: OperationsAnalytics | null;
    priorities: GuestPrioritized[];
    historicalTrends: HistoricalTrends | null;
    loading: boolean;
    progress: number;
    loadingStep: string;
    estimatedSecondsRemaining: number;
    error: string | null;
    briefingLoaded: boolean;
    timeRange: number | null;
    setTimeRange: (range: number | null) => void;
    refreshAll: (days?: number | null) => Promise<void>;
    skipLoading: () => void;
    cacheReady: boolean;
}

const DataContext = createContext<DataContextType>({
    dashboardData: null,
    guests: [],
    reviews: [],
    reviewStats: null,
    operations: null,
    priorities: [],
    historicalTrends: null,
    loading: false,
    progress: 0,
    loadingStep: '',
    estimatedSecondsRemaining: 0,
    error: null,
    briefingLoaded: false,
    timeRange: 30,
    setTimeRange: () => {},
    refreshAll: async (days?: number | null) => { },
    skipLoading: () => {},
    cacheReady: false,
});

export function DataProvider({ children }: { children: React.ReactNode }) {
    const { activeId } = useRestaurant();
    const [dashboardData, setDashboardData] = useState<DeepAnalytics | null>(null);
    const [guests, setGuests] = useState<Guest[]>([]);
    const [reviews, setReviews] = useState<Review[]>([]);
    const [reviewStats, setReviewStats] = useState<ReviewStats | null>(null);
    const [operations, setOperations] = useState<OperationsAnalytics | null>(null);
    const [priorities, setPriorities] = useState<GuestPrioritized[]>([]);
    const [historicalTrends, setHistoricalTrends] = useState<HistoricalTrends | null>(null);
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [loadingStep, setLoadingStep] = useState('');
    const [estimatedSecondsRemaining, setEstimatedSecondsRemaining] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [briefingLoaded, setBriefingLoaded] = useState(false);
    const [timeRange, setTimeRange] = useState<number | null>(30);
    const [cacheReady, setCacheReady] = useState(false);

    const abortControllerRef = useRef<AbortController | null>(null);
    const dashboardCache = useRef<Record<string, DeepAnalytics>>({});
    const lastFetchedParams = useRef<{ id: string | null, days: number | null }>({ id: null, days: null });
    const bgDataLoaded = useRef(false);

    // Fetch historical trends when switching to 1Y/ALL
    useEffect(() => {
        if (!activeId) return;
        if (timeRange === 365 || timeRange === null) {
            fetchHistoricalTrends(timeRange).then(trends => {
                setHistoricalTrends(trends);
            }).catch(e => {
                console.warn('Historical trends fetch failed:', e);
            });
        } else {
            setHistoricalTrends(null);
        }
    }, [timeRange, activeId]);

    // Lazily fetch reviews, guests, priorities, etc. — called once per session
    const fetchBackgroundData = useCallback(() => {
        if (bgDataLoaded.current || !activeId) return;
        bgDataLoaded.current = true;

        const withTimeout = (promise: Promise<any>, ms = 15000) =>
            Promise.race([
                promise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Background fetch timed out')), ms))
            ]);

        Promise.allSettled([
            withTimeout(fetchGuests({})).then(setGuests),
            withTimeout(fetchAllReviews({})).then(setReviews),
            withTimeout(fetchReviewStats()).then(setReviewStats),
            withTimeout(fetchGuestPriorities()).then(setPriorities),
            withTimeout(fetchOperationsAnalytics()).then(setOperations),
        ]);
    }, [activeId]);
    const currentDaysRef = useRef<number | null | undefined>(undefined);
    const coldLoadRef = useRef(true); // True until first successful load
    const diskCacheHydrated = useRef(false);
    const prevActiveId = useRef<string | null>(null);

    // Hydrate in-memory cache from AsyncStorage on mount
    useEffect(() => {
        if (!activeId || diskCacheHydrated.current) return;
        diskCacheHydrated.current = true;
        
        (async () => {
            // Load dashboard cache
            const diskCache = await loadCacheFromDisk(activeId);
            // Load background data cache (guests, reviews, etc.)
            const bgCache = await loadBgCacheFromDisk(activeId);

            if (bgCache) {
                setGuests(bgCache.guests || []);
                setReviews(bgCache.reviews || []);
                setReviewStats(bgCache.reviewStats);
                setPriorities(bgCache.priorities || []);
                setOperations(bgCache.operations);
                bgDataLoaded.current = true;
                console.log('[DataContext] Hydrated bg data from disk cache — no API calls needed');
            }

            if (diskCache) {
                dashboardCache.current = diskCache;
                const ALL_KEYS = ['30', '90', '180', '365', 'all'];
                const allLoaded = ALL_KEYS.every(k => diskCache[k]?.briefing);
                if (allLoaded) {
                    coldLoadRef.current = false;
                    const currentKey = timeRange ? String(timeRange) : 'all';
                    if (diskCache[currentKey]) {
                        setDashboardData(diskCache[currentKey]);
                        setBriefingLoaded(true);
                    }
                    console.log('[DataContext] Hydrated all 5 frames from disk cache — skipping Gemini');
                    // If bg data was also cached, skip ALL fetches
                    if (bgCache) {
                        setLoading(false);
                        if (Platform.OS === 'web' && typeof window !== 'undefined') {
                            window.dispatchEvent(new Event('savoriq-ready'));
                        }
                        setCacheReady(true);
                        return; // Fully cached — zero API calls!
                    }
                    fetchBackgroundData();
                } else {
                    console.log('[DataContext] Partial disk cache — will fetch missing briefings');
                }
            }
            setCacheReady(true);
        })();
    }, [activeId]);

    const timeRangeRef = useRef<number | null>(timeRange);
    useEffect(() => { timeRangeRef.current = timeRange; }, [timeRange]);

    const refreshAll = useCallback(async (days?: number | null) => {
        if (!activeId) return;

        // Default to current timeRange when called without arguments
        // (e.g., from Inbox focus, pull-to-refresh, action handlers)
        // undefined = "use current filter", null = "ALL time", number = specific days
        const effectiveDays: number | null = days === undefined ? timeRangeRef.current : days;
        const cacheKey = effectiveDays ? String(effectiveDays) : 'all';
        currentDaysRef.current = effectiveDays;

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
                fetchBackgroundData(); // Ensure reviews, guests, etc. are loaded
                return;
            }
            // Cache has analytics but no briefing — show data, retry briefing only (lightweight)
            setLoading(false);
            fetchBackgroundData(); // Ensure reviews, guests, etc. are loaded
            fetchBriefing(effectiveDays).then((briefing) => {
                const updated = { ...dashboardCache.current[cacheKey], briefing };
                dashboardCache.current[cacheKey] = updated;
                if (currentDaysRef.current === effectiveDays) {
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
                // Fast ramp to 85, then slow asymptotic creep toward 98
                if (prev < 85) return prev + 2;
                if (prev < 98) return prev + 0.3;
                return prev;
            });
            
            if (elapsed > 1) setLoadingStep('Analyzing Guest Profiles...');
            if (elapsed > 2.5) setLoadingStep('Fetching Deep Analytics...');
            if (elapsed > 4) setLoadingStep('Finalizing Sync...');
        }, 300);

        try {
            // Fetch critical dashboard data with a 15s timeout
            const deepData = await Promise.race([
                fetchDeepAnalytics(effectiveDays, controller.signal),
                new Promise<never>((_, reject) => 
                    setTimeout(() => reject(new Error('Dashboard load timed out. Please try refreshing.')), 15000)
                )
            ]);
            const freshData = { ...deepData, briefing: null };
            
            // Update active view if still on this frame
            if (currentDaysRef.current === effectiveDays) {
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

            // Fetch briefing in background — dashboard shows inline spinner until it resolves
            const briefingPromise = Promise.race([
                fetchBriefing(effectiveDays, controller.signal),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('Briefing timed out')), 30000)
                )
            ]).then((briefing) => {
                const updated = { ...freshData, briefing };
                dashboardCache.current[cacheKey] = updated;
                
                // Only update state if this frame is still active
                if (currentDaysRef.current === effectiveDays) {
                    setDashboardData(updated);
                }
                setBriefingLoaded(true);
                coldLoadRef.current = false;
                // Persist to disk after briefing loads
                if (activeId) saveCacheToDisk(activeId, dashboardCache.current);
                // Dismiss splash now that briefing is complete
                if (Platform.OS === 'web' && typeof window !== 'undefined') {
                    window.dispatchEvent(new Event('savoriq-ready'));
                }
            }).catch((e: any) => {
                if (e.name !== 'AbortError') {
                    console.warn('Briefing fetch failed:', e);
                    if (currentDaysRef.current === effectiveDays) {
                        setDashboardData(prev => prev ? { ...prev, briefing: {
                            summary: "AI Briefing is temporarily paused due to API limits. Go to More → Review Sync to refresh, or try a different time range.",
                            insights: [],
                            review_count_note: null,
                        }} : null);
                    }
                }
                // Don't mark briefingLoaded on failure — badge stays 'Syncing...' until real data arrives
                coldLoadRef.current = false;
                // Dismiss splash even on briefing failure
                if (Platform.OS === 'web' && typeof window !== 'undefined') {
                    window.dispatchEvent(new Event('savoriq-ready'));
                }
            });

            // Fetch other background metrics with timeouts to prevent hanging
            const withTimeout = (promise: Promise<any>, ms = 15000) => {
                return Promise.race([
                    promise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Background fetch timed out')), ms))
                ]);
            };

            // Track bg data via refs so we can save to disk after all complete
            const bgResults = {
                guests: [] as Guest[],
                reviews: [] as Review[],
                reviewStats: null as ReviewStats | null,
                priorities: [] as GuestPrioritized[],
                operations: null as OperationsAnalytics | null,
            };

            const bgOps = [
                withTimeout(fetchGuests({}, controller.signal)).then(d => { setGuests(d); bgResults.guests = d; }),
                withTimeout(fetchAllReviews({}, controller.signal)).then(d => { setReviews(d); bgResults.reviews = d; }),
                withTimeout(fetchReviewStats(undefined, controller.signal)).then(d => { setReviewStats(d); bgResults.reviewStats = d; }),
                withTimeout(fetchGuestPriorities(controller.signal)).then(d => { setPriorities(d); bgResults.priorities = d; }),
                withTimeout(fetchOperationsAnalytics(controller.signal)).then(d => { setOperations(d); bgResults.operations = d; }),
            ];

            Promise.allSettled(bgOps).then(() => {
                if (activeId) saveBgCacheToDisk(activeId, bgResults);
            });
            bgDataLoaded.current = true;

            // Fetch historical trends for 1Y/ALL (pure SQL, no Gemini cost)
            if (effectiveDays === null || effectiveDays >= 365) {
                fetchHistoricalTrends(effectiveDays).then(trends => {
                    setHistoricalTrends(trends);
                }).catch(e => {
                    console.warn('Historical trends fetch failed:', e);
                });
            } else {
                setHistoricalTrends(null);
            }

            // Prefetch other frames in the background (don't block splash)
            if (abortControllerRef.current === controller) {
                prefetchOtherFrames(controller.signal, false);
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
                lastFetchedParams.current = { id: activeId, days: effectiveDays || null };

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

    // Reset data when restaurant changes (not just on null)
    useEffect(() => {
        if (prevActiveId.current !== null && prevActiveId.current !== activeId) {
            setDashboardData(null);
            setGuests([]);
            setReviews([]);
            setReviewStats(null);
            setOperations(null);
            setBriefingLoaded(false);
            setLoading(true);
            setCacheReady(false);
            dashboardCache.current = {};
            lastFetchedParams.current = { id: null, days: null };
            diskCacheHydrated.current = false;
            bgDataLoaded.current = false;
        }
        prevActiveId.current = activeId;
    }, [activeId]);

    const skipLoading = useCallback(() => {
        setLoading(false);
        // Dismiss splash immediately when user taps Skip
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
            window.dispatchEvent(new Event('savoriq-ready'));
        }
    }, []);

    return (
        <DataContext.Provider value={{
            dashboardData,
            guests,
            reviews,
            reviewStats,
            operations,
            priorities,
            historicalTrends,
            loading,
            progress,
            loadingStep,
            estimatedSecondsRemaining,
            error,
            refreshAll,
            briefingLoaded,
            timeRange,
            setTimeRange,
            skipLoading,
            cacheReady,
        }}>
            {children}
        </DataContext.Provider>
    );
}

export function useData() {
    return useContext(DataContext);
}
