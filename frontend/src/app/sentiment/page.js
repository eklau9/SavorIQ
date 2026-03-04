"use client";

import { useEffect, useState } from "react";
import { fetchSentimentAnalytics } from "@/lib/api";

function scoreToPct(score) {
    // Convert -1..1 to 0..100%
    return Math.round(((score + 1) / 2) * 100);
}

function scoreLabel(score) {
    if (score >= 0.5) return "Excellent";
    if (score >= 0.2) return "Good";
    if (score >= -0.2) return "Neutral";
    if (score >= -0.5) return "Poor";
    return "Critical";
}

function scoreColor(score) {
    if (score >= 0.5) return "var(--accent-emerald)";
    if (score >= 0.2) return "var(--accent-cyan)";
    if (score >= -0.2) return "var(--accent-amber)";
    return "var(--accent-rose)";
}

const BUCKET_META = {
    food: { emoji: "🍽️", label: "Food", gradient: "var(--gradient-warm)" },
    drink: { emoji: "☕", label: "Drink", gradient: "var(--gradient-primary)" },
    ambiance: { emoji: "✨", label: "Ambiance", gradient: "var(--gradient-success)" },
};

export default function SentimentPage() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchSentimentAnalytics()
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

    const maxTrendScore = 1.0;

    return (
        <div className="sentiment-page">
            <div className="page-header">
                <h2>🎯 Sentiment Analysis</h2>
                <p className="subtitle">
                    Deep dive into guest sentiment across Food, Drink, and Ambiance categories
                </p>
            </div>

            {/* Bucket Scorecards */}
            <div className="sentiment-scorecards">
                {data.buckets.map((b) => {
                    const meta = BUCKET_META[b.bucket] || {};
                    const pct = scoreToPct(b.avg_score);
                    return (
                        <div key={b.bucket} className="sentiment-scorecard">
                            <div className="scorecard-header">
                                <span className="scorecard-emoji">{meta.emoji}</span>
                                <span className="scorecard-title">{meta.label}</span>
                                <span className="scorecard-count">{b.review_count} reviews</span>
                            </div>
                            <div className="scorecard-score" style={{ color: scoreColor(b.avg_score) }}>
                                {b.avg_score > 0 ? "+" : ""}{b.avg_score.toFixed(2)}
                            </div>
                            <div className="scorecard-label">{scoreLabel(b.avg_score)}</div>
                            <div className="gauge-track">
                                <div
                                    className="gauge-fill"
                                    style={{
                                        width: `${pct}%`,
                                        background: scoreColor(b.avg_score),
                                    }}
                                />
                                <div className="gauge-midline" />
                            </div>
                            <div className="gauge-labels">
                                <span>Critical</span>
                                <span>Neutral</span>
                                <span>Excellent</span>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Monthly Trend */}
            {data.trend.length > 0 && (
                <div className="trend-section">
                    <h3>Monthly Sentiment Trend</h3>
                    <div className="trend-chart">
                        <div className="trend-y-axis">
                            <span>+1.0</span>
                            <span>0</span>
                            <span>-1.0</span>
                        </div>
                        <div className="trend-bars-container">
                            {data.trend.map((point) => (
                                <div key={point.month} className="trend-month">
                                    <div className="trend-bar-group">
                                        {["food", "drink", "ambiance"].map((bucket) => {
                                            const val = point[`${bucket}_avg`];
                                            if (val === null || val === undefined) return null;
                                            const height = Math.abs(val) * 50;
                                            const isPositive = val >= 0;
                                            return (
                                                <div
                                                    key={bucket}
                                                    className={`trend-bar ${bucket}`}
                                                    title={`${BUCKET_META[bucket]?.label}: ${val > 0 ? "+" : ""}${val.toFixed(2)}`}
                                                    style={{
                                                        height: `${height}%`,
                                                        [isPositive ? "bottom" : "top"]: "50%",
                                                        position: "absolute",
                                                    }}
                                                />
                                            );
                                        })}
                                    </div>
                                    <div className="trend-zero-line" />
                                    <span className="trend-label">{point.month}</span>
                                </div>
                            ))}
                        </div>
                        <div className="trend-legend">
                            <span className="legend-item"><span className="legend-dot food" /> Food</span>
                            <span className="legend-item"><span className="legend-dot drink" /> Drink</span>
                            <span className="legend-item"><span className="legend-dot ambiance" /> Ambiance</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Highlights */}
            {data.highlights.length > 0 && (
                <div className="highlights-section">
                    <h3>Category Highlights</h3>
                    <div className="highlights-grid">
                        {data.highlights.map((h) => {
                            const meta = BUCKET_META[h.bucket] || {};
                            return (
                                <div key={h.bucket} className="highlight-card">
                                    <div className="highlight-header">
                                        <span>{meta.emoji} {meta.label}</span>
                                    </div>
                                    {h.best_snippet && (
                                        <div className="highlight-item best">
                                            <div className="highlight-tag">
                                                <span className="dot positive" />
                                                Best ({h.best_score > 0 ? "+" : ""}{h.best_score?.toFixed(2)})
                                            </div>
                                            <p>"{h.best_snippet}"</p>
                                        </div>
                                    )}
                                    {h.worst_snippet && (
                                        <div className="highlight-item worst">
                                            <div className="highlight-tag">
                                                <span className="dot negative" />
                                                Worst ({h.worst_score?.toFixed(2)})
                                            </div>
                                            <p>"{h.worst_snippet}"</p>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
