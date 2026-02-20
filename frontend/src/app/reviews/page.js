"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { fetchAllReviews, fetchReviewStats } from "@/lib/api";
import SentimentBadge from "@/components/SentimentBadge";

function renderStars(rating) {
    const stars = [];
    for (let i = 1; i <= 5; i++) {
        if (i <= Math.floor(rating)) {
            stars.push(<span key={i} className="star full">★</span>);
        } else if (i === Math.ceil(rating) && rating % 1 >= 0.5) {
            stars.push(<span key={i} className="star half">★</span>);
        } else {
            stars.push(<span key={i} className="star empty">★</span>);
        }
    }
    return stars;
}

function highlightSearch(text, search) {
    if (!search || !text) return text;
    const regex = new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
        regex.test(part) ? <mark key={i} className="search-highlight">{part}</mark> : part
    );
}

export default function ReviewsPage() {
    const [reviews, setReviews] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [platform, setPlatform] = useState("");
    const [sentiment, setSentiment] = useState(null);
    const [days, setDays] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [activeSearch, setActiveSearch] = useState(null);
    const [sortByRating, setSortByRating] = useState(false);

    const loadData = useCallback(() => {
        setLoading(true);
        const p = platform || null;
        const d = days ? Number(days) : null;
        Promise.all([
            fetchAllReviews(p, activeSearch, sentiment, d),
            fetchReviewStats(p, activeSearch, d),
        ])
            .then(([reviewsData, statsData]) => {
                setReviews(reviewsData);
                setStats(statsData);
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [platform, activeSearch, sentiment, days]);

    useEffect(() => { loadData(); }, [loadData]);

    // Client-side sort: by rating (high→low) or date (default from API)
    const sortedReviews = useMemo(() => {
        if (!sortByRating) return reviews;
        return [...reviews].sort((a, b) => b.rating - a.rating);
    }, [reviews, sortByRating]);

    const handleSearchSubmit = (e) => {
        e.preventDefault();
        setActiveSearch(searchInput.trim() || null);
    };

    const clearSearch = () => {
        setSearchInput("");
        setActiveSearch(null);
    };

    const toggleSentiment = (value) => {
        setSentiment(sentiment === value ? null : value);
    };

    const clearAllFilters = () => {
        setSentiment(null);
    };

    const toggleSort = () => {
        setSortByRating(!sortByRating);
    };

    return (
        <div className="reviews-page">
            <div className="page-title-bar">
                <h1>Guest Reviews</h1>
                <p className="page-subtitle">Search and filter feedback from Google &amp; Yelp</p>
            </div>

            {/* Search Bar with embedded dropdowns */}
            <form className="review-search-bar" onSubmit={handleSearchSubmit}>
                <span className="search-icon">🔍</span>
                <input
                    type="text"
                    placeholder="Search reviews…"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="search-input"
                />
                {activeSearch && (
                    <button type="button" className="search-clear" onClick={clearSearch}>✕</button>
                )}
                <div className="search-divider" />
                <select
                    className="search-select"
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                >
                    <option value="">All Platforms</option>
                    <option value="google">Google</option>
                    <option value="yelp">Yelp</option>
                </select>
                <div className="search-divider" />
                <select
                    className="search-select"
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                >
                    <option value="">All Time</option>
                    <option value="7">Last 7 Days</option>
                    <option value="30">Last 30 Days</option>
                    <option value="90">Last 90 Days</option>
                </select>
                <button type="submit" className="search-submit">Search</button>
            </form>

            {/* Stats Summary — all boxes are interactive */}
            {stats && (
                <div className="review-stats-bar">
                    <div
                        className={`review-stat clickable ${sentiment === null ? "selected" : ""}`}
                        onClick={clearAllFilters}
                        title="Show all reviews"
                    >
                        <span className="stat-value">{stats.total}</span>
                        <span className="stat-label">Total Reviews</span>
                    </div>
                    <div
                        className={`review-stat clickable ${sortByRating ? "selected" : ""}`}
                        onClick={toggleSort}
                        title={sortByRating ? "Sorting by rating — click for date order" : "Click to sort by rating"}
                    >
                        <span className="stat-value">{stats.avg_rating} ★</span>
                        <span className="stat-label">
                            {sortByRating ? "↓ By Rating" : "Avg Rating"}
                        </span>
                    </div>
                    <div
                        className={`review-stat positive clickable ${sentiment === "positive" ? "selected" : ""}`}
                        onClick={() => toggleSentiment("positive")}
                    >
                        <span className="stat-value">{stats.positive}</span>
                        <span className="stat-label">😊 Positive</span>
                    </div>
                    <div
                        className={`review-stat negative clickable ${sentiment === "negative" ? "selected" : ""}`}
                        onClick={() => toggleSentiment("negative")}
                    >
                        <span className="stat-value">{stats.negative}</span>
                        <span className="stat-label">😟 Negative</span>
                    </div>
                    <div
                        className={`review-stat neutral-stat clickable ${sentiment === "neutral" ? "selected" : ""}`}
                        onClick={() => toggleSentiment("neutral")}
                    >
                        <span className="stat-value">{stats.neutral}</span>
                        <span className="stat-label">😐 Neutral</span>
                    </div>
                </div>
            )}

            {/* Active search indicator */}
            {activeSearch && (
                <div className="active-search-tag">
                    Showing results for: <strong>"{activeSearch}"</strong>
                    <button className="tag-clear" onClick={clearSearch}>✕</button>
                </div>
            )}

            {/* Review List */}
            {loading ? (
                <div className="loading-state">
                    <div className="spinner"></div>
                    <p>Loading reviews…</p>
                </div>
            ) : sortedReviews.length === 0 ? (
                <div className="empty-state">
                    <div className="icon">💬</div>
                    <p>No reviews found matching your filters</p>
                </div>
            ) : (
                <div className="reviews-list">
                    {sortedReviews.map((review) => (
                        <div className="review-card" key={review.id}>
                            <div className="review-card-header">
                                <div className="review-card-left">
                                    <div className={`platform-badge ${review.platform}`}>
                                        {review.platform === "yelp" ? "Yelp" : "Google"}
                                    </div>
                                    <span className="review-guest-name">{review.guest_name}</span>
                                </div>
                                <div className="review-card-right">
                                    <span className="star-rating">{renderStars(review.rating)}</span>
                                    <span className="review-date">
                                        {new Date(review.reviewed_at).toLocaleDateString("en-US", {
                                            month: "short",
                                            day: "numeric",
                                            year: "numeric",
                                        })}
                                    </span>
                                </div>
                            </div>
                            <p className="review-card-content">
                                {highlightSearch(review.content, activeSearch)}
                            </p>
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
            )}
        </div>
    );
}
