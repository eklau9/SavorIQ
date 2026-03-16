import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
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
import { useRestaurant } from './RestaurantContext';

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

    const abortControllerRef = useRef<AbortController | null>(null);
    const dashboardCache = useRef<Record<string, DeepAnalytics>>({});
    const lastFetchedParams = useRef<{ id: string | null, days: number | null }>({ id: null, days: null });
    const currentDaysRef = useRef<number | null | undefined>(undefined);

    const refreshAll = useCallback(async (days?: number | null) => {
        if (!activeId) return;

        const cacheKey = days ? String(days) : 'all';
        currentDaysRef.current = days;

        // 1. Instant Cache HIT - Show data immediately
        if (dashboardCache.current[cacheKey]) {
            setDashboardData(dashboardCache.current[cacheKey]);
            // If this exact view was just fetched, we can skip the remote call
            if (lastFetchedParams.current.id === activeId && lastFetchedParams.current.days === (days || null)) {
                return;
            }
        } else {
            // No cache: show loading screen ONLY if we don't have any data for this frame
            setDashboardData(null); 
            setLoading(true);
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
            // Fetch critical dashboard data
            const deepData = await fetchDeepAnalytics(days, controller.signal);
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

            // Fetch briefing in background
            fetchBriefing(days, controller.signal).then((briefing) => {
                const updated = { ...freshData, briefing };
                dashboardCache.current[cacheKey] = updated;
                
                // Only update state if this frame is still active
                if (currentDaysRef.current === days) {
                    setDashboardData(updated);
                }
            }).catch((e: any) => {
                if (e.name !== 'AbortError') {
                    console.warn('Briefing background fetch failed:', e);
                    // Clear the null state so it doesn't spin forever
                    // Setting to undefined or a fallback briefing object
                    const fallback = {
                        summary: "Briefing temporarily unavailable.",
                        insights: []
                    };
                    dashboardCache.current[cacheKey] = { ...freshData, briefing: fallback };
                    if (currentDaysRef.current === days) {
                        setDashboardData(prev => prev ? { ...prev, briefing: fallback } : null);
                    }
                }
            });

            // Fetch other background metrics
            const bgOps = [
                fetchGuests({ limit: 50 }, controller.signal).then(setGuests),
                fetchAllReviews({ limit: 50 }, controller.signal).then(setReviews),
                fetchReviewStats(undefined, controller.signal).then(setReviewStats),
                fetchGuestPriorities(controller.signal).then(setPriorities),
                fetchOperationsAnalytics(controller.signal).then(setOperations),
            ];

            Promise.allSettled(bgOps);
            
        } catch (err: any) {
            if (err.name === 'AbortError') {
                console.info('Sync aborted');
            } else {
                console.error('RefreshAll failed:', err);
                setError(err.message || 'Data sync failed');
            }
        } finally {
            if (abortControllerRef.current === controller) {
                clearInterval(progressInterval);
                setLoading(false);
                setProgress(100);
                setLoadingStep('Sync Complete');
                setEstimatedSecondsRemaining(0);
                lastFetchedParams.current = { id: activeId, days: days || null };

                // TRIGGER PRE-FETCH for other frames sequentially
                if (days === 30 || days === 90) { // If user is near current, pre-fetch others
                    prefetchOtherFrames(controller.signal);
                }
            }
        }
    }, [activeId]);

    const prefetchOtherFrames = async (signal: AbortSignal) => {
        const frames = [30, 90, 180, 365, null]; 
        for (const frame of frames) {
            // Don't pre-fetch what we are currently looking at
            if (frame === currentDaysRef.current) continue;
            
            const key = frame ? String(frame) : 'all';
            if (dashboardCache.current[key]) continue; // Already cached
            
            try {
                // WAIT 5 SECONDS between frames to stay under 15 RPM limit
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                const data = await fetchDeepAnalytics(frame, signal);
                const frameData = { ...data, briefing: null };
                dashboardCache.current[key] = frameData;
                
                // Briefing too
                fetchBriefing(frame, signal).then(briefing => {
                    dashboardCache.current[key] = { ...frameData, briefing };
                    // If user switched to this frame while we were pre-fetching, update it!
                    if (currentDaysRef.current === frame) {
                        setDashboardData(dashboardCache.current[key]);
                    }
                }).catch(() => {});
            } catch (e) {
                // Silently fail pre-fetches
            }
        }
    };

    // Reset data when restaurant changes
    useEffect(() => {
        if (!activeId) {
            setDashboardData(null);
            setGuests([]);
            setReviews([]);
            setReviewStats(null);
            setOperations(null);
            dashboardCache.current = {};
            lastFetchedParams.current = { id: null, days: null };
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
            refreshAll
        }}>
            {children}
        </DataContext.Provider>
    );
}

export function useData() {
    return useContext(DataContext);
}
