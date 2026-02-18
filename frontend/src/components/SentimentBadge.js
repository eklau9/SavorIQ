export default function SentimentBadge({ bucket, score }) {
    const cls = score >= 0.3 ? "positive" : score <= -0.3 ? "negative" : "neutral";
    const label = score >= 0.3 ? "Great" : score <= -0.3 ? "Poor" : "Neutral";

    return (
        <span className={`sentiment-badge ${cls}`}>
            {bucket}: {label}
        </span>
    );
}
