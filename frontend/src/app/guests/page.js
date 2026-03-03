"use client";

import { useEffect, useState } from "react";
import GuestPulseCard from "@/components/GuestPulseCard";
import { fetchGuests } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function GuestRegistryPage() {
    const [guests, setGuests] = useState([]);
    const [pulses, setPulses] = useState({});
    const [filter, setFilter] = useState("all");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setLoading(true);
        try {
            const guestsRes = await fetch(`${API_BASE}/api/guests?limit=100`);
            if (guestsRes.ok) {
                const guestsData = await guestsRes.json();
                setGuests(guestsData);

                // Fetch pulses for the guests
                const pulseMap = {};
                for (const guest of guestsData) {
                    try {
                        const pulseRes = await fetch(`${API_BASE}/api/guests/${guest.id}/pulse`);
                        if (pulseRes.ok) {
                            pulseMap[guest.id] = await pulseRes.json();
                        }
                    } catch { }
                }
                setPulses(pulseMap);
            }
        } catch (err) {
            console.error("Failed to load guests:", err);
        } finally {
            setLoading(false);
        }
    }

    const filteredGuests =
        filter === "all" ? guests : guests.filter((g) => g.tier === filter);

    if (loading) {
        return (
            <div className="loading-state">
                <div className="loading-spinner" />
            </div>
        );
    }

    return (
        <div className="guest-registry-page">
            <div className="page-header">
                <h2>👤 Guest Registry</h2>
                <p className="subtitle">
                    Guest Profiles — Comprehensive listing of guest loyalty tiers and spending history
                </p>
            </div>

            <div className="filter-bar" style={{ marginBottom: 20 }}>
                <div className="filter-options">
                    {["all", "vip", "regular", "new"].map((t) => (
                        <button
                            key={t}
                            className={`filter-btn ${filter === t ? "active" : ""}`}
                            onClick={() => setFilter(t)}
                        >
                            {t === "all" ? "All Guests" : t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                    ))}
                </div>
            </div>

            {filteredGuests.length === 0 ? (
                <div className="empty-state">
                    <div className="icon">👥</div>
                    <p>No guests found matching this tier.</p>
                </div>
            ) : (
                <div className="pulse-grid">
                    {filteredGuests.map((guest) =>
                        pulses[guest.id] ? (
                            <GuestPulseCard key={guest.id} pulse={pulses[guest.id]} />
                        ) : null
                    )}
                </div>
            )}
        </div>
    );
}
