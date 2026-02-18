"use client";

import Link from "next/link";

function getInitials(name) {
    return name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
}

function getSentimentLabel(score, count) {
    if (count === 0) return "Ordered";
    if (score >= 0.3) return "Great";
    if (score <= -0.3) return "Poor";
    return "Neutral";
}

function getSentimentClass(score) {
    if (score >= 0.3) return "positive";
    if (score <= -0.3) return "negative";
    return "neutral";
}

export default function GuestPulseCard({ pulse }) {
    const { guest, total_orders, total_spend, visit_count, sentiment_summary, favorite_items } = pulse;

    return (
        <Link href={`/guest/${guest.id}`} className="pulse-card">
            <div className="pulse-card-header">
                <div className={`guest-avatar ${guest.tier}`}>
                    {getInitials(guest.name)}
                </div>
                <div className="guest-info">
                    <h3>{guest.name}</h3>
                    <span className="email">{guest.email || "No email"}</span>
                </div>
                <span className={`tier-badge ${guest.tier}`}>{guest.tier}</span>
            </div>

            <div className="pulse-stats">
                <div className="pulse-stat">
                    <div className="value">{total_orders}</div>
                    <div className="label">Orders</div>
                </div>
                <div className="pulse-stat">
                    <div className="value">${total_spend.toFixed(0)}</div>
                    <div className="label">Spent</div>
                </div>
                <div className="pulse-stat">
                    <div className="value">{visit_count}</div>
                    <div className="label">Visits</div>
                </div>
            </div>

            {sentiment_summary && sentiment_summary.length > 0 && (
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
                                <span className={`sentiment-score`}>
                                    {getSentimentLabel(s.avg_score, s.review_count)}
                                    {s.review_count > 0 && ` (${s.review_count})`}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}

            {favorite_items && favorite_items.length > 0 && (
                <div className="pulse-card-footer">
                    <div className="favorite-items">
                        {favorite_items.map((item) => (
                            <span className="fav-pill" key={item}>
                                {item}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </Link>
    );
}
