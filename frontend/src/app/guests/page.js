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
                <div className="guest-list-simplified">
                    {filteredGuests.map((guest) => {
                        const meta = {
                            vip: { label: "VIP", color: "var(--accent-violet)", bg: "rgba(124, 58, 237, 0.15)" },
                            regular: { label: "Regular", color: "var(--accent-emerald)", bg: "rgba(52, 211, 153, 0.15)" },
                            new: { label: "New", color: "var(--text-secondary)", bg: "rgba(100, 116, 139, 0.15)" },
                        }[guest.tier] || {};

                        return (
                            <div key={guest.id} className="simplified-guest-row">
                                <div className="guest-info">
                                    <h3 style={{ margin: 0, fontSize: "1.1rem" }}>{guest.name}</h3>
                                    <span style={{
                                        background: meta.bg,
                                        color: meta.color,
                                        padding: "2px 8px",
                                        borderRadius: "12px",
                                        fontSize: "0.8rem",
                                        marginTop: "4px",
                                        display: "inline-block"
                                    }}>
                                        {meta.label}
                                    </span>
                                </div>
                                <div className="guest-visits" style={{ fontSize: "0.9rem", color: "var(--text-secondary)", textAlign: "right" }}>
                                    <div>First Visit: {new Date(guest.first_visit).toLocaleDateString()}</div>
                                    <div>Last Visit: {new Date(guest.last_visit).toLocaleDateString()}</div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
