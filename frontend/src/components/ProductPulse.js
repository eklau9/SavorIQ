"use client";

import { useRouter } from "next/navigation";

export default function ProductPulse({ items, title, type }) {
    const router = useRouter();

    // Context-aware labels based on which list this component renders
    const isRisk = type === "danger";
    const isInfo = type === "info";
    const sentimentLabel = isInfo ? "Not on Menu" : isRisk ? "Criticized" : "Praised";
    const sentimentClass = isInfo ? "info" : isRisk ? "negative" : "positive";

    return (
        <div className={`product-pulse-section ${type}`}>
            <h3>{title}</h3>
            <div className="product-list">
                {items.length === 0 ? (
                    <div className="empty-mini">No {title.toLowerCase()} identified.</div>
                ) : (
                    items.map((item, idx) => (
                        <div
                            key={idx}
                            className="product-row clickable"
                            style={{ cursor: "pointer" }}
                            onClick={() => router.push(`/reviews?search=${encodeURIComponent(item.item_name)}`)}
                            title={`View reviews for ${item.item_name}`}
                        >
                            <div className="product-info">
                                <span className="name">{item.item_name}</span>
                                {!isInfo && <span className="cat">{item.category}</span>}
                            </div>
                            <div className="product-stats">
                                <div className="stat">
                                    <span className="val">{item.review_count}</span>
                                    <span className="lbl">Mentions</span>
                                </div>
                                <div className={`sentiment-indicator ${sentimentClass}`}>
                                    <span className="val">
                                        {isInfo && item.avg_rating != null
                                            ? `${item.avg_rating.toFixed(1)} ★`
                                            : sentimentLabel}
                                    </span>
                                    <span className="lbl">
                                        {isInfo ? "avg rating" : isRisk ? "in 1-3★ reviews" : "in 4-5★ reviews"}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
