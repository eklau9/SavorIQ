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
            // Don't leave it in a loading state if it fails
            setRestaurants([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadRestaurants();
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
