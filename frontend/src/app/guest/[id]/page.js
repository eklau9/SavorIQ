"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import OrderTimeline from "../../../components/OrderTimeline";
import ReviewFeed from "../../../components/ReviewFeed";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function getInitials(name) {
    return name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
}

function getSentimentClass(score) {
    if (score > 0.2) return "positive";
    if (score < -0.2) return "negative";
    return "neutral";
}

export default function GuestDetailPage() {
    const params = useParams();
    const [pulse, setPulse] = useState(null);
    const [orders, setOrders] = useState([]);
    const [reviews, setReviews] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (params.id) loadGuestData(params.id);
    }, [params.id]);

    async function loadGuestData(guestId) {
        try {
            const [pulseRes, ordersRes, reviewsRes] = await Promise.all([
                fetch(`${API_BASE}/api/guests/${guestId}/pulse`),
                fetch(`${API_BASE}/api/guests/${guestId}/orders`),
                fetch(`${API_BASE}/api/guests/${guestId}/reviews`),
            ]);

            if (pulseRes.ok) setPulse(await pulseRes.json());
            if (ordersRes.ok) setOrders(await ordersRes.json());
            if (reviewsRes.ok) setReviews(await reviewsRes.json());
        } catch (err) {
            console.error("Failed to load guest data:", err);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return (
            <div className="loading-state">
                <div className="loading-spinner" />
            </div>
        );
    }

    if (!pulse) {
        return (
            <div className="empty-state">
                <div className="icon">❌</div>
                <p>Guest not found</p>
                <Link href="/" className="back-link">
                    ← Back to Dashboard
                </Link>
            </div>
        );
    }

    const { guest, total_orders, total_spend, visit_count, sentiment_summary, favorite_items } = pulse;

    return (
        <>
            <Link href="/" className="back-link">
                ← Back to Dashboard
            </Link>

            <div className="guest-detail-header">
                <div className={`guest-detail-avatar ${guest.tier}`}>
                    {getInitials(guest.name)}
                </div>
                <div className="detail-meta">
                    <h2>
                        {guest.name}
                        <span className={`tier-badge ${guest.tier}`} style={{ marginLeft: 12, verticalAlign: "middle" }}>
                            {guest.tier}
                        </span>
                    </h2>
                    <div className="meta-row">
                        <span>📧 {guest.email || "N/A"}</span>
                        <span>📦 {total_orders} orders</span>
                        <span>💰 ${total_spend.toFixed(2)} total</span>
                        <span>📍 {visit_count} visits</span>
                    </div>
                </div>
            </div>

            <div className="stats-grid" style={{ marginBottom: 24 }}>
                <div className="stat-card">
                    <div className="label">Total Spend</div>
                    <div className="value">${total_spend.toFixed(0)}</div>
                </div>
                <div className="stat-card">
                    <div className="label">Total Orders</div>
                    <div className="value">{total_orders}</div>
                </div>
                <div className="stat-card">
                    <div className="label">Visits</div>
                    <div className="value">{visit_count}</div>
                </div>
                <div className="stat-card">
                    <div className="label">Favorites</div>
                    <div className="value" style={{ fontSize: "0.9rem" }}>
                        {favorite_items.join(", ") || "—"}
                    </div>
                </div>
            </div>

            {sentiment_summary && sentiment_summary.length > 0 && (
                <div className="detail-section" style={{ marginBottom: 24 }}>
                    <h3>🎯 Sentiment Overview</h3>
                    <div className="sentiment-bars">
                        {sentiment_summary.map((s) => {
                            const pct = Math.round(((s.avg_score + 1) / 2) * 100);
                            const cls = getSentimentClass(s.avg_score);
                            return (
                                <div className="sentiment-row" key={s.bucket}>
                                    <span className="bucket-label">{s.bucket}</span>
                                    <div className="sentiment-bar-track">
                                        <div
                                            className={`sentiment-bar-fill ${cls}`}
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                    <span className="sentiment-score">
                                        {s.avg_score > 0 ? "+" : ""}
                                        {s.avg_score.toFixed(2)} ({s.review_count})
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className="detail-columns">
                <div className="detail-section">
                    <h3>📋 Order History</h3>
                    <OrderTimeline orders={orders} />
                </div>
                <div className="detail-section">
                    <h3>💬 Reviews</h3>
                    <ReviewFeed reviews={reviews} />
                </div>
            </div>
        </>
    );
}
