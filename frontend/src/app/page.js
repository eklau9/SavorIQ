"use client";

import { useEffect, useState } from "react";
import GuestPulseCard from "../components/GuestPulseCard";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function DashboardPage() {
  const [guests, setGuests] = useState([]);
  const [pulses, setPulses] = useState({});
  const [overview, setOverview] = useState(null);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      // Fetch overview stats
      const overviewRes = await fetch(`${API_BASE}/api/analytics/overview`);
      if (overviewRes.ok) setOverview(await overviewRes.json());

      // Fetch guests
      const guestsRes = await fetch(`${API_BASE}/api/guests?limit=50`);
      if (!guestsRes.ok) throw new Error();
      const guestsData = await guestsRes.json();
      setGuests(guestsData);

      // Fetch pulse data for each guest
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
    } catch (err) {
      console.error("Failed to load data:", err);
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
    <>
      <div className="page-header">
        <h2>Guest Pulse Dashboard</h2>
        <p className="subtitle">
          Real-time guest intelligence — F&B orders × review sentiment
        </p>
      </div>

      {overview && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="label">Total Guests</div>
            <div className="value">{overview.total_guests}</div>
          </div>
          <div className="stat-card">
            <div className="label">Total Orders</div>
            <div className="value">{overview.total_orders}</div>
          </div>
          <div className="stat-card">
            <div className="label">Total Reviews</div>
            <div className="value">{overview.total_reviews}</div>
          </div>
          <div className="stat-card">
            <div className="label">Avg Rating</div>
            <div className="value">{overview.avg_rating.toFixed(1)} ★</div>
          </div>
        </div>
      )}

      <div className="filter-bar">
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

      {filteredGuests.length === 0 ? (
        <div className="empty-state">
          <div className="icon">👤</div>
          <p>No guests found. Ingest some review or order data to get started.</p>
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
    </>
  );
}
