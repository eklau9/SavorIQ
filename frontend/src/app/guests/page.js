"use client";

import { useEffect, useState } from "react";
import GuestPulseCard from "@/components/GuestPulseCard";
import { fetchGuests } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function GuestRegistryPage() {
    const [guests, setGuests] = useState([]);
    const [pulses, setPulses] = useState({});
    const [filter, setFilter] = useState("all");
    const [sortBy, setSortBy] = useState("recent");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, [sortBy]);

    async function loadData() {
        setLoading(true);
        try {
            const guestsData = await fetchGuests({
                limit: 1000,
                sort_by: sortBy
            });
            setGuests(guestsData);
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
                    {["all", "vip", "regular", "new", "slipping"].map((t) => (
                        <button
                            key={t}
                            className={`filter-btn ${filter === t ? "active" : ""}`}
                            onClick={() => setFilter(t)}
                        >
                            {t === "all" ? "All Guests" : t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                    ))}
                </div>

                <div className="sort-options" style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                    <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Sort by:</span>
                    {[
                        { id: "recent", label: "Recent Activity" },
                        { id: "rating", label: "Top Rated" },
                        { id: "reviews", label: "Most Reviews" }
                    ].map((s) => (
                        <button
                            key={s.id}
                            className={`sort-tab ${sortBy === s.id ? "active" : ""}`}
                            onClick={() => setSortBy(s.id)}
                            style={{
                                background: "none",
                                border: "none",
                                borderBottom: sortBy === s.id ? "2px solid var(--accent-gold)" : "2px solid transparent",
                                color: sortBy === s.id ? "var(--accent-gold)" : "var(--text-secondary)",
                                padding: "4px 8px",
                                cursor: "pointer",
                                fontSize: "0.85rem",
                                fontWeight: sortBy === s.id ? "600" : "400"
                            }}
                        >
                            {s.label}
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
                            new: { label: "New", color: "var(--accent-gold)", bg: "rgba(234, 179, 8, 0.15)" },
                            slipping: { label: "Slipping", color: "var(--accent-red)", bg: "rgba(239, 68, 68, 0.15)" },
                        }[guest.tier] || { label: "Regular", color: "var(--accent-emerald)", bg: "rgba(52, 211, 153, 0.15)" };

                        return (
                            <a
                                href={`/guest/${guest.id}`}
                                key={guest.id}
                                className="simplified-guest-row clickable"
                                style={{ display: "flex", textDecoration: "none", color: "inherit", transition: "all 0.2s" }}
                            >
                                <div className="guest-info" style={{ flex: 1 }}>
                                    <h3 style={{ margin: 0, fontSize: "1.1rem" }}>{guest.name}</h3>
                                    <div style={{ display: "flex", gap: "12px", alignItems: "center", marginTop: "6px" }}>
                                        <span style={{
                                            background: meta.bg,
                                            color: meta.color,
                                            padding: "2px 10px",
                                            borderRadius: "12px",
                                            fontSize: "0.75rem",
                                            fontWeight: "600",
                                            textTransform: "uppercase",
                                            letterSpacing: "0.5px"
                                        }}>
                                            {meta.label}
                                        </span>
                                        {guest.avg_rating > 0 && (
                                            <span style={{ fontSize: "0.9rem", color: "var(--accent-gold)", fontWeight: "600", display: "flex", alignItems: "center", gap: "4px" }}>
                                                ★ {guest.avg_rating.toFixed(1)}
                                            </span>
                                        )}
                                        <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                                            • {guest.visit_count || 0} review{guest.visit_count !== 1 ? 's' : ''}
                                        </span>
                                    </div>
                                </div>
                                <div className="guest-visits" style={{ fontSize: "0.85rem", color: "var(--text-muted)", textAlign: "right" }}>
                                    <div>Last seen: {new Date(guest.last_visit || guest.created_at).toLocaleDateString()}</div>
                                    <div style={{ fontSize: "0.75rem", marginTop: "2px" }}>Member since: {new Date(guest.created_at).toLocaleDateString()}</div>
                                </div>
                            </a>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
