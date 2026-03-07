"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import GuestPulseCard from "../components/GuestPulseCard";
import ManagerBriefing from "../components/ManagerBriefing";
import ProductPulse from "../components/ProductPulse";
import GuestPriorityCard from "../components/GuestPriorityCard";
import { fetchDeepAnalytics, fetchGuestPriorities, fetchGuests } from "../lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function DashboardPage() {
  const [guests, setGuests] = useState([]);
  const [priorities, setPriorities] = useState([]);
  const [pulses, setPulses] = useState({});
  const [overview, setOverview] = useState(null);
  const [deepAnalytics, setDeepAnalytics] = useState(null);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData(isManualRefresh = false) {
    if (isManualRefresh) setIsRefreshing(true);
    else setLoading(true);

    try {
      // Fetch deep analytics (includes overview stats and AI briefing)
      const deepData = await fetchDeepAnalytics();
      setDeepAnalytics(deepData);
      setOverview(deepData.overview);

      // Fetch guests and priorities independently to avoid total UI block on single failure
      let guestsData = [];
      try {
        const guestsData = await fetchGuests({ limit: 50 });
        setGuests(guestsData);
      } catch (gErr) {
        console.error("Guests fetch failed:", gErr);
      }

      try {
        const priorityData = await fetchGuestPriorities();
        setPriorities(priorityData || []);
      } catch (pErr) {
        console.error("Priority fetch failed:", pErr);
        setPriorities([]);
      }

      setPulses({});
    } catch (err) {
      console.error("Failed to load data:", err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }

  async function handleRefresh() {
    await loadData(true);
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
        <h2>Hospitality Intelligence Hub</h2>
        <p className="subtitle">
          Strategic guest and product insights — AI-powered performance analysis
        </p>
      </div>

      {deepAnalytics && (
        <>
          <ManagerBriefing
            briefing={deepAnalytics.briefing}
            onRefresh={handleRefresh}
            isRefreshing={isRefreshing}
          />

          <div className="intelligence-grid">
            <ProductPulse
              items={deepAnalytics.top_performers}
              title="Top Performing Items"
              type="success"
            />
            <ProductPulse
              items={deepAnalytics.risks}
              title="At-Risk Items"
              type="danger"
            />
            {deepAnalytics.unmatched_mentions && deepAnalytics.unmatched_mentions.length > 0 && (
              <ProductPulse
                items={deepAnalytics.unmatched_mentions.map(m => ({
                  item_name: m.term,
                  category: "unknown",
                  review_count: m.mention_count,
                  avg_rating: m.avg_rating,
                }))}
                title="Customer Mentions (Not on Menu)"
                type="info"
              />
            )}
          </div>
        </>
      )}

      {overview && (
        <div className="stats-grid">
          <Link href="/guests" className="stat-card" style={{ cursor: "pointer", textDecoration: "none", color: "inherit" }}>
            <div className="label">Total Guests</div>
            <div className="value">{overview.total_guests}</div>
          </Link>
          <Link href="/reviews" className="stat-card" style={{ cursor: "pointer", textDecoration: "none", color: "inherit" }}>
            <div className="label">Total Orders</div>
            <div className="value">{overview.total_orders}</div>
          </Link>
          <Link href="/reviews" className="stat-card" style={{ cursor: "pointer", textDecoration: "none", color: "inherit" }}>
            <div className="label">Total Reviews</div>
            <div className="value">{overview.total_reviews}</div>
          </Link>
          <Link href="/reviews" className="stat-card" style={{ cursor: "pointer", textDecoration: "none", color: "inherit" }}>
            <div className="label">Avg Rating</div>
            <div className="value">{overview.avg_rating.toFixed(1)} ★</div>
          </Link>
        </div>
      )}
    </>
  );
}
