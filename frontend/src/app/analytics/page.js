"use client";

import { useEffect, useState } from "react";
import { fetchOperationsAnalytics } from "@/lib/api";

const TIER_META = {
    vip: { label: "VIP", color: "var(--accent-violet)", bg: "rgba(124, 58, 237, 0.15)" },
    regular: { label: "Regular", color: "var(--accent-emerald)", bg: "rgba(52, 211, 153, 0.15)" },
    new: { label: "New", color: "var(--text-secondary)", bg: "rgba(100, 116, 139, 0.15)" },
};

export default function AnalyticsPage() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchOperationsAnalytics()
            .then(setData)
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="loading-state">
                <div className="loading-spinner" />
            </div>
        );
    }

    if (!data) return null;

    const totalCatRevenue = data.category_breakdown.reduce((s, c) => s + c.revenue, 0) || 1;
    const totalTierCount = data.tier_distribution.reduce((s, t) => s + t.count, 0) || 1;

    return (
        <div className="analytics-page">
            <div className="page-header">
                <h2>📈 Operations Analytics</h2>
                <p className="subtitle">
                    Revenue performance, guest segmentation, and data health metrics
                </p>
            </div>

            {/* Revenue KPIs */}
            <div className="analytics-kpi-grid">
                <div className="analytics-kpi">
                    <div className="kpi-icon revenue-icon">💰</div>
                    <div className="kpi-body">
                        <div className="kpi-val">${data.total_revenue.toLocaleString()}</div>
                        <div className="kpi-lbl">Total Revenue</div>
                    </div>
                </div>
                <div className="analytics-kpi">
                    <div className="kpi-icon aov-icon">🧾</div>
                    <div className="kpi-body">
                        <div className="kpi-val">${data.avg_order_value}</div>
                        <div className="kpi-lbl">Avg Order Value</div>
                    </div>
                </div>
                <div className="analytics-kpi">
                    <div className="kpi-icon opg-icon">📦</div>
                    <div className="kpi-body">
                        <div className="kpi-val">{data.orders_per_guest}</div>
                        <div className="kpi-lbl">Orders per Guest</div>
                    </div>
                </div>
            </div>

            {/* Category Breakdown + Platform Split */}
            <div className="analytics-two-col">
                <div className="analytics-card">
                    <h3>Revenue by Category</h3>
                    <div className="cat-breakdown">
                        {data.category_breakdown.map((cat) => {
                            const pct = Math.round((cat.revenue / totalCatRevenue) * 100);
                            const isFood = cat.category === "food";
                            return (
                                <div key={cat.category} className="cat-row">
                                    <div className="cat-label">
                                        <span className="cat-emoji">{isFood ? "🍽️" : "☕"}</span>
                                        <span className="cat-name">{isFood ? "Food" : "Drink"}</span>
                                    </div>
                                    <div className="cat-bar-track">
                                        <div
                                            className={`cat-bar-fill ${cat.category}`}
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                    <div className="cat-stats">
                                        <span className="cat-revenue">${cat.revenue.toLocaleString()}</span>
                                        <span className="cat-pct">{pct}%</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="analytics-card">
                    <h3>Platform Distribution</h3>
                    <div className="platform-breakdown">
                        {Object.entries(data.platform_split).map(([platform, count]) => {
                            const totalReviews = Object.values(data.platform_split).reduce((s, c) => s + c, 0) || 1;
                            const pct = Math.round((count / totalReviews) * 100);
                            return (
                                <div key={platform} className="platform-row">
                                    <div className="platform-label">
                                        <span className={`platform-dot ${platform}`} />
                                        <span>{platform === "google" ? "Google" : "Yelp"}</span>
                                    </div>
                                    <div className="cat-bar-track">
                                        <div
                                            className={`cat-bar-fill ${platform}`}
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                    <div className="cat-stats">
                                        <span className="cat-revenue">{count} reviews</span>
                                        <span className="cat-pct">{pct}%</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Guest Segments + Data Health */}
            <div className="analytics-two-col">
                <div className="analytics-card">
                    <h3>Guest Segments</h3>
                    <div className="tier-donut-container">
                        <div className="tier-donut">
                            <svg viewBox="0 0 36 36" className="donut-svg">
                                {(() => {
                                    let offset = 0;
                                    return data.tier_distribution.map((t) => {
                                        const meta = TIER_META[t.tier] || {};
                                        const pct = (t.count / totalTierCount) * 100;
                                        const el = (
                                            <circle
                                                key={t.tier}
                                                cx="18" cy="18" r="15.915"
                                                fill="none"
                                                stroke={meta.color}
                                                strokeWidth="3"
                                                strokeDasharray={`${pct} ${100 - pct}`}
                                                strokeDashoffset={-offset}
                                                strokeLinecap="round"
                                            />
                                        );
                                        offset += pct;
                                        return el;
                                    });
                                })()}
                            </svg>
                            <div className="donut-center">
                                <div className="donut-total">{totalTierCount}</div>
                                <div className="donut-label">Guests</div>
                            </div>
                        </div>
                        <div className="tier-legend">
                            {data.tier_distribution.map((t) => {
                                const meta = TIER_META[t.tier] || {};
                                const pct = Math.round((t.count / totalTierCount) * 100);
                                return (
                                    <div key={t.tier} className="tier-legend-item">
                                        <span className="tier-dot" style={{ background: meta.color }} />
                                        <span className="tier-name">{meta.label}</span>
                                        <span className="tier-count">{t.count}</span>
                                        <span className="tier-pct">{pct}%</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="analytics-card">
                    <h3>Data Health</h3>
                    <p className="data-health-desc">
                        Guests with both order history and review data linked
                    </p>
                    <div className="data-health-ring-container">
                        <div className="data-health-ring">
                            <svg viewBox="0 0 36 36" className="donut-svg">
                                <circle
                                    cx="18" cy="18" r="15.915"
                                    fill="none"
                                    stroke="rgba(255,255,255,0.06)"
                                    strokeWidth="3"
                                />
                                <circle
                                    cx="18" cy="18" r="15.915"
                                    fill="none"
                                    stroke="var(--accent-cyan)"
                                    strokeWidth="3"
                                    strokeDasharray={`${data.data_completeness * 100} ${100 - data.data_completeness * 100}`}
                                    strokeDashoffset="25"
                                    strokeLinecap="round"
                                />
                            </svg>
                            <div className="donut-center">
                                <div className="donut-total">{Math.round(data.data_completeness * 100)}%</div>
                                <div className="donut-label">Complete</div>
                            </div>
                        </div>
                    </div>
                    <div className="data-health-stats">
                        <div className="dh-stat">
                            <span className="dh-val">{data.total_guests}</span>
                            <span className="dh-lbl">Total Guests</span>
                        </div>
                        <div className="dh-stat">
                            <span className="dh-val">{data.guests_with_both}</span>
                            <span className="dh-lbl">Fully Linked</span>
                        </div>
                        <div className="dh-stat">
                            <span className="dh-val">{data.total_guests - data.guests_with_both}</span>
                            <span className="dh-lbl">Missing Data</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
