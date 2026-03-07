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
    GuestPrioritized
} from './api';
import { useRestaurant } from './RestaurantContext';

interface DataContextType {
    dashboardData: DeepAnalytics | null;
    guests: Guest[];
    reviews: Review[];
    reviewStats: ReviewStats | null;
    priorities: GuestPrioritized[];
    loading: boolean;
    refreshAll: () => Promise<void>;
}

const DataContext = createContext<DataContextType>({
    dashboardData: null,
    guests: [],
    reviews: [],
    reviewStats: null,
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
    const [priorities, setPriorities] = useState<GuestPrioritized[]>([]);
    const [loading, setLoading] = useState(false);

    const refreshAll = useCallback(async () => {
        if (!activeId) return;
        setLoading(true);
        try {
            const [deep, gs, rs, stats, inc] = await Promise.all([
                fetchDeepAnalytics(),
                fetchGuests(),
                fetchAllReviews(),
                fetchReviewStats(),
                fetchGuestPriorities(),
            ]);
            setDashboardData(deep);
            setGuests(gs);
            setReviews(rs);
            setReviewStats(stats);
            setPriorities(inc);
        } catch (e: any) {
            console.error('Failed to refresh data:', e);
            // Optionally set error in context if we want global error handling
        } finally {
            setLoading(false);
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
            setPriorities([]);
        }
    }, [activeId, refreshAll]);

    return (
        <DataContext.Provider value={{
            dashboardData,
            guests,
            reviews,
            reviewStats,
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
