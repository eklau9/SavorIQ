import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchRestaurants, Restaurant, setActiveRestaurantId } from './api';

interface RestaurantContextType {
    restaurants: Restaurant[];
    activeId: string | null;
    activeName: string;
    switchRestaurant: (id: string) => void;
    loading: boolean;
    loadRestaurants: () => Promise<void>;
}

const RestaurantContext = createContext<RestaurantContextType>({
    restaurants: [],
    activeId: null,
    activeName: 'Loading...',
    switchRestaurant: () => { },
    loading: true,
    loadRestaurants: async () => { },
});

export function RestaurantProvider({ children }: { children: React.ReactNode }) {
    const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const loadRestaurants = async () => {
        setLoading(true);
        try {
            const stored = await AsyncStorage.getItem('activeRestaurantId');
            const list = await fetchRestaurants();
            setRestaurants(list);

            if (stored && list.find((r) => r.id === stored)) {
                setActiveId(stored);
            } else if (list.length > 0) {
                setActiveId(list[0].id);
                await setActiveRestaurantId(list[0].id);
            }
        } catch (e) {
            console.warn('Failed to load restaurants:', e);
            setRestaurants([]);
        } finally {
            setLoading(false);
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new Event('savoriq-ready'));
            }
        }
    };

    // Load restaurants on mount with retry + exponential backoff + cleanup
    useEffect(() => {
        let cancelled = false;
        let retryTimeout: ReturnType<typeof setTimeout>;

        const load = async (attempt = 0) => {
            if (cancelled) return;
            setLoading(true);
            try {
                const stored = await AsyncStorage.getItem('activeRestaurantId');
                const list = await fetchRestaurants();
                if (cancelled) return;

                setRestaurants(list);

                if (list.length === 0 && attempt < 3) {
                    const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
                    console.log(`[RestaurantContext] No restaurants returned, retrying in ${delay / 1000}s (attempt ${attempt + 1}/3)...`);
                    retryTimeout = setTimeout(() => load(attempt + 1), delay);
                    return;
                }

                if (stored && list.find((r) => r.id === stored)) {
                    setActiveId(stored);
                } else if (list.length > 0) {
                    setActiveId(list[0].id);
                    await setActiveRestaurantId(list[0].id);
                }
            } catch (e) {
                if (cancelled) return;
                console.warn(`[RestaurantContext] Fetch failed (attempt ${attempt + 1}/3):`, e);
                if (attempt < 3) {
                    const delay = Math.pow(2, attempt) * 1000;
                    retryTimeout = setTimeout(() => load(attempt + 1), delay);
                    return;
                }
                setRestaurants([]);
            } finally {
                if (!cancelled) {
                    setLoading(false);
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(new Event('savoriq-ready'));
                    }
                }
            }
        };

        load();
        return () => {
            cancelled = true;
            clearTimeout(retryTimeout);
        };
    }, []);

    const switchRestaurant = async (id: string) => {
        setActiveId(id);
        await setActiveRestaurantId(id);
    };

    const activeName = restaurants.find((r) => r.id === activeId)?.name || 'Select Location';

    return (
        <RestaurantContext.Provider
            value={{ restaurants, activeId, activeName, switchRestaurant, loading, loadRestaurants }}
        >
            {children}
        </RestaurantContext.Provider>
    );
}

export function useRestaurant() {
    return useContext(RestaurantContext);
}
