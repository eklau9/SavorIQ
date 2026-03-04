"use client";

import { useRestaurant } from "@/context/RestaurantContext";

export default function RestaurantSwitcher() {
    const { restaurants, activeRestaurant, switchRestaurant, loading } = useRestaurant();

    if (loading) {
        return (
            <div className="restaurant-switcher loading">
                <div className="spinner-small"></div>
                <span>Loading locations...</span>
            </div>
        );
    }

    if (!restaurants || restaurants.length === 0) return null;

    return (
        <div className="restaurant-switcher">
            <div className="switcher-header">
                <span className="icon">📍</span>
                <label>Active Location</label>
            </div>
            <div className="select-wrapper">
                <select
                    value={activeRestaurant?.id || ""}
                    onChange={(e) => {
                        const found = restaurants.find(r => r.id === e.target.value);
                        if (found) switchRestaurant(found);
                    }}
                >
                    {restaurants.map(r => (
                        <option key={r.id} value={r.id}>
                            {r.name}
                        </option>
                    ))}
                </select>
                <div className="select-arrow">▼</div>
            </div>
        </div>
    );
}
