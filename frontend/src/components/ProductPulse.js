"use client";

function getSentimentLabel(score) {
    if (score === null || score === undefined) return "No data";
    if (score >= 0.3) return "Great";
    if (score <= -0.3) return "Poor";
    return "Neutral";
}

function getSentimentClass(score) {
    if (score === null || score === undefined) return "none";
    if (score >= 0.3) return "positive";
    if (score <= -0.3) return "negative";
    return "neutral";
}

export default function ProductPulse({ items, title, type }) {
    return (
        <div className={`product-pulse-section ${type}`}>
            <h3>{title}</h3>
            <div className="product-list">
                {items.length === 0 ? (
                    <div className="empty-mini">No {title.toLowerCase()} identified.</div>
                ) : (
                    items.map((item, idx) => (
                        <div key={idx} className="product-row">
                            <div className="product-info">
                                <span className="name">{item.item_name}</span>
                                <span className="cat">{item.category}</span>
                            </div>
                            <div className="product-stats">
                                <div className="stat">
                                    <span className="val">{item.order_count}</span>
                                    <span className="lbl">Orders</span>
                                </div>
                                <div className={`sentiment-indicator ${getSentimentClass(item.avg_sentiment)}`}>
                                    <span className="val">{getSentimentLabel(item.avg_sentiment)}</span>
                                    <span className="lbl">{item.review_count > 0 ? `${item.review_count} reviews` : "No mentions"}</span>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
