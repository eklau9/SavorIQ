import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
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
    OperationsAnalytics
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
    refreshAll: () => Promise<void>;
}

const DataContext = createContext<DataContextType>({
    dashboardData: null,
    guests: [],
    reviews: [],
    reviewStats: null,
    operations: null,
    priorities: [],
    loading: false,
    refreshAll: async () => { },
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

    const abortControllerRef = React.useRef<AbortController | null>(null);

    const refreshAll = useCallback(async () => {
        if (!activeId) return;

        // Cancel any existing request
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        const controller = new AbortController();
        abortControllerRef.current = controller;

        setLoading(true);
        try {
            const [deep, gs, rs, stats, inc, ops] = await Promise.all([
                fetchDeepAnalytics(controller.signal),
                fetchGuests({ limit: 5000 }, controller.signal),
                fetchAllReviews({ limit: 1000 }, controller.signal),
                fetchReviewStats(undefined, controller.signal),
                fetchGuestPriorities(controller.signal),
                fetchOperationsAnalytics(controller.signal),
            ]);
            setDashboardData(deep);
            setGuests(gs);
            setReviews(rs);
            setReviewStats(stats);
            setPriorities(inc);
            setOperations(ops);
        } catch (e: any) {
            if (e.name === 'AbortError') return;
            console.error('Failed to refresh data:', e);
        } finally {
            if (abortControllerRef.current === controller) {
                setLoading(false);
            }
        }
    }, [activeId]);

    // Refresh when restaurant changes
    useEffect(() => {
        if (activeId) {
            refreshAll();
        } else {
            setDashboardData(null);
            setGuests([]);
            setReviews([]);
            setReviewStats(null);
            setOperations(null);
            setPriorities([]);
        }
    }, [activeId, refreshAll]);

    return (
        <DataContext.Provider value={{
            dashboardData,
            guests,
            reviews,
            reviewStats,
            operations,
            priorities,
            loading,
            refreshAll
        }}>
            {children}
        </DataContext.Provider>
    );
}

export function useData() {
    return useContext(DataContext);
}
