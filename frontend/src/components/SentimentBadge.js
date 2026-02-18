export default function SentimentBadge({ bucket, score }) {
    const cls = score > 0.2 ? "positive" : score < -0.2 ? "negative" : "neutral";
    const icon = score > 0.2 ? "↑" : score < -0.2 ? "↓" : "→";

    return (
        <span className={`sentiment-badge ${cls}`}>
            {icon} {bucket}: {score > 0 ? "+" : ""}{score.toFixed(1)}
        </span>
    );
}
