import SentimentBadge from "./SentimentBadge";

function renderStars(rating) {
    const full = Math.floor(rating);
    const half = rating % 1 >= 0.5 ? 1 : 0;
    const empty = 5 - full - half;
    return "★".repeat(full) + (half ? "½" : "") + "☆".repeat(empty);
}

export default function ReviewFeed({ reviews }) {
    if (!reviews || reviews.length === 0) {
        return (
            <div className="empty-state">
                <div className="icon">💬</div>
                <p>No reviews yet</p>
            </div>
        );
    }

    return (
        <div className="review-feed">
            {reviews.map((review) => (
                <div className="review-item" key={review.id}>
                    <div className="review-header">
                        <div className={`platform-icon ${review.platform}`}>
                            {review.platform === "yelp" ? "Y" : "G"}
                        </div>
                        <span className="star-rating">{renderStars(review.rating)}</span>
                        <span className="review-date">
                            {new Date(review.reviewed_at).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                            })}
                        </span>
                    </div>
                    <p className="review-content">{review.content}</p>
                    {review.sentiment_scores && review.sentiment_scores.length > 0 && (
                        <div className="review-sentiments">
                            {review.sentiment_scores.map((s) => (
                                <SentimentBadge
                                    key={s.id}
                                    bucket={s.bucket}
                                    score={s.score}
                                />
                            ))}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
