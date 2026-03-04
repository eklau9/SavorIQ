"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { fetchRestaurants } from "@/lib/api";

const RestaurantContext = createContext();

export function RestaurantProvider({ children }) {
    const [restaurants, setRestaurants] = useState([]);
    const [activeRestaurant, setActiveRestaurant] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const load = async () => {
            try {
                const data = await fetchRestaurants();
                setRestaurants(data);

                // Restore from localStorage
                const savedId = localStorage.getItem("activeRestaurantId");
                const found = data.find(r => r.id === savedId) || data[0];

                if (found) {
                    setActiveRestaurant(found);
                    localStorage.setItem("activeRestaurantId", found.id);
                }
            } catch (err) {
                console.error("Failed to load restaurants", err);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    const switchRestaurant = (restaurant) => {
        setActiveRestaurant(restaurant);
        localStorage.setItem("activeRestaurantId", restaurant.id);
        // Hard reload to ensure all data-fetching hooks across all pages 
        // refresh with the new X-Restaurant-ID header.
        window.location.reload();
    };

    return (
        <RestaurantContext.Provider value={{ restaurants, activeRestaurant, switchRestaurant, loading }}>
            {children}
        </RestaurantContext.Provider>
    );
}

export const useRestaurant = () => useContext(RestaurantContext);
