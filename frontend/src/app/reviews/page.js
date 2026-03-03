"use client";

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { fetchAllReviews, fetchReviewStats } from "@/lib/api";
import SentimentBadge from "@/components/SentimentBadge";

function renderStars(rating) {
    const stars = [];
    for (let i = 1; i <= 5; i++) {
        let className = "star";
        if (i <= Math.floor(rating)) {
            className += " full";
        } else if (i === Math.ceil(rating) && rating % 1 >= 0.5) {
            className += " half";
        } else {
            className += " empty";
        }
        stars.push(<span key={i} className={className}>★</span>);
    }
    return stars;
}

function RatingPopover({ stats, onClose, onViewAll }) {
    if (!stats || !stats.rating_distribution) return null;

    const distribution = stats.rating_distribution;
    const maxCount = Math.max(...Object.values(distribution), 1);
    const sortedStars = [5, 4, 3, 2, 1];

    return (
        <div className="rating-popover">
            <div className="popover-header">
                <h3>Overall rating</h3>
                <div className="summary-section">
                    <div className="summary-left">
                        <div className="stars-row">
                            {renderStars(stats.avg_rating)}
                        </div>
                        <span className="summary-count">{stats.total} reviews</span>
                    </div>
                </div>
            </div>

            <div className="distribution-chart">
                {sortedStars.map(star => {
                    const count = distribution[star] || 0;
                    const percentage = (count / maxCount) * 100;
                    return (
                        <div key={star} className="distribution-row">
                            <span className="star-label">{star}</span>
                            <div className="bar-container">
                                <div
                                    className="bar-fill"
                                    style={{ width: `${percentage}%` }}
                                ></div>
                            </div>
                        </div>
                    );
                })}
            </div>

        </div>
    );
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
    return (
        <Suspense fallback={<div className="loading-state"><div className="loading-spinner" /></div>}>
            <ReviewsPageInner />
        </Suspense>
    );
}

function ReviewsPageInner() {
    const searchParams = useSearchParams();
    const urlSearch = searchParams.get("search") || "";
    const urlCategory = searchParams.get("category") || "";

    const [reviews, setReviews] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [platform, setPlatform] = useState("");
    const [category, setCategory] = useState(urlCategory);
    const [sentiment, setSentiment] = useState(null);
    const [days, setDays] = useState("");
    const [searchInput, setSearchInput] = useState(urlSearch);
    const [activeSearch, setActiveSearch] = useState(urlSearch || null);
    const [viewType, setViewType] = useState("list"); // 'list' or 'calendar'
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [activeDate, setActiveDate] = useState(null);
    const [isRatingOpen, setIsRatingOpen] = useState(false);
    const popoverRef = useRef(null);

    const loadData = useCallback(() => {
        setLoading(true);
        const p = platform || null;
        const d = days ? Number(days) : null;
        const date = activeDate || null;
        const cat = category || null;
        Promise.all([
            fetchAllReviews(p, activeSearch, sentiment, d, date, cat),
            fetchReviewStats(p, activeSearch, d, date, cat),
        ])
            .then(([reviewsData, statsData]) => {
                setReviews(reviewsData);
                setStats(statsData);
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [platform, activeSearch, sentiment, days, activeDate, category]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Helper to format date without timezone shift
    const formatDateLabel = (dateStr) => {
        if (!dateStr) return "";
        const [year, month, day] = dateStr.split('-').map(Number);
        return new Date(year, month - 1, day).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });
    };

    const handleSearchSubmit = (e) => {
        e.preventDefault();
        setActiveSearch(searchInput.trim() || null);
        // Automatically switch to list view on search
        if (viewType === 'calendar') {
            setViewType('list');
        }
    };

    const clearSearch = () => {
        setSearchInput("");
        setActiveSearch(null);
    };

    const clearDateFilter = () => {
        setActiveDate(null);
    };

    const toggleSentiment = (value) => {
        setSentiment(sentiment === value ? null : value);
    };

    const clearAllFilters = () => {
        setSentiment(null);
        setActiveDate(null);
        setPlatform("");
        setDays("");
        setCategory("");
    };

    return (
        <div className="reviews-page">
            <div className="page-title-bar">
                <div className="title-left">
                    <div className="title-row">
                        <h1>Guest Reviews</h1>
                        {stats && (
                            <div className="kpi-container" ref={popoverRef}>
                                <div
                                    className={`rating-kpi-inline clickable ${isRatingOpen ? 'active' : ''}`}
                                    onClick={() => setIsRatingOpen(!isRatingOpen)}
                                    title="View rating breakdown"
                                >
                                    <div className="kpi-stars">
                                        {renderStars(stats.avg_rating)}
                                    </div>
                                    <span className="kpi-value">{Number(stats.avg_rating).toFixed(1)}</span>
                                    <span className="kpi-count">({stats.total} reviews)</span>
                                </div>
                                {isRatingOpen && (
                                    <RatingPopover
                                        stats={stats}
                                        onClose={() => setIsRatingOpen(false)}
                                        onViewAll={() => {
                                            setViewType('list');
                                            setIsRatingOpen(false);
                                        }}
                                    />
                                )}
                            </div>
                        )}
                    </div>
                    <p className="page-subtitle">Search and filter feedback from Google &amp; Yelp</p>
                </div>
            </div>

            {/* Search Bar */}
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
                <button type="submit" className="search-submit">Search</button>
            </form>

            {/* Quick Filters Row */}
            <div className="review-filter-row">
                <div className="filter-group">
                    <span className="filter-label">Platform</span>
                    <div className="filter-chips">
                        <button
                            className={`filter-chip ${platform === "" ? "active" : ""}`}
                            onClick={() => setPlatform("")}
                        >All</button>
                        <button
                            className={`filter-chip ${platform === "google" ? "active" : ""}`}
                            onClick={() => setPlatform("google")}
                        >Google</button>
                        <button
                            className={`filter-chip ${platform === "yelp" ? "active" : ""}`}
                            onClick={() => setPlatform("yelp")}
                        >Yelp</button>
                    </div>
                </div>

                <div className="filter-spacer"></div>

                <div className="filter-group">
                    <span className="filter-label">Category</span>
                    <div className="filter-chips">
                        <button
                            className={`filter-chip ${category === "" ? "active" : ""}`}
                            onClick={() => setCategory("")}
                        >All</button>
                        <button
                            className={`filter-chip ${category === "food" ? "active" : ""}`}
                            onClick={() => setCategory("food")}
                        >Food</button>
                        <button
                            className={`filter-chip ${category === "drink" ? "active" : ""}`}
                            onClick={() => setCategory("drink")}
                        >Drink</button>
                        <button
                            className={`filter-chip ${category === "ambiance" ? "active" : ""}`}
                            onClick={() => setCategory("ambiance")}
                        >Ambiance</button>
                    </div>
                </div>

                <div className="filter-group">
                    <span className="filter-label">Time Period</span>
                    <div className="filter-chips">
                        <button
                            className={`filter-chip ${days === "" ? "active" : ""}`}
                            onClick={() => {
                                setDays("");
                                setActiveDate(null);
                            }}
                        >All Time</button>
                        <button
                            className={`filter-chip ${days === "7" ? "active" : ""}`}
                            onClick={() => {
                                setDays("7");
                                setActiveDate(null);
                            }}
                        >7 Days</button>
                        <button
                            className={`filter-chip ${days === "30" ? "active" : ""}`}
                            onClick={() => {
                                setDays("30");
                                setActiveDate(null);
                            }}
                        >30 Days</button>
                        <button
                            className={`filter-chip ${days === "90" ? "active" : ""}`}
                            onClick={() => {
                                setDays("90");
                                setActiveDate(null);
                            }}
                        >90 Days</button>
                    </div>
                </div>

                <div className="view-toggle-group">
                    <button
                        className={`view-toggle-btn ${viewType === 'calendar' ? 'active' : ''}`}
                        onClick={() => setViewType(viewType === 'calendar' ? 'list' : 'calendar')}
                        title={viewType === 'calendar' ? "Switch to List View" : "Switch to Calendar View"}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                            <line x1="16" y1="2" x2="16" y2="6" />
                            <line x1="8" y1="2" x2="8" y2="6" />
                            <line x1="3" y1="10" x2="21" y2="10" />
                            <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Active Filters Row */}
            <div className="active-filters-row">
                {activeSearch && (
                    <div className="active-search-tag">
                        Showing results for "<strong>{activeSearch}</strong>"
                        <button className="tag-clear" onClick={clearSearch}>✕</button>
                    </div>
                )}
                {activeDate && (
                    <div className="active-search-tag">
                        Reviews on <strong>{formatDateLabel(activeDate)}</strong>
                        <button className="tag-clear" onClick={clearDateFilter}>✕</button>
                    </div>
                )}
            </div>

            {/* Stats Summary */}
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
                        className={`review-stat positive clickable ${sentiment === "positive" ? "selected" : ""}`}
                        onClick={() => toggleSentiment("positive")}
                    >
                        <span className="stat-value">{stats.positive}</span>
                        <span className="stat-label">Positive</span>
                    </div>
                    <div
                        className={`review-stat negative clickable ${sentiment === "negative" ? "selected" : ""}`}
                        onClick={() => toggleSentiment("negative")}
                    >
                        <span className="stat-value">{stats.negative}</span>
                        <span className="stat-label">Negative</span>
                    </div>
                    <div
                        className={`review-stat neutral-stat clickable ${sentiment === "neutral" ? "selected" : ""}`}
                        onClick={() => toggleSentiment("neutral")}
                    >
                        <span className="stat-value">{stats.neutral}</span>
                        <span className="stat-label">Neutral</span>
                    </div>
                </div>
            )}

            {/* Content Area with Loading Overlay */}
            <div className="reviews-content-container">
                {loading && (
                    <div className="loading-overlay">
                        <div className="spinner"></div>
                    </div>
                )}

                {viewType === "calendar" ? (
                    <CalendarView
                        reviews={reviews}
                        currentMonth={currentMonth}
                        setCurrentMonth={setCurrentMonth}
                        onDayClick={(dateStr) => {
                            setActiveDate(dateStr);
                            setViewType('list');
                            setDays("");
                        }}
                    />
                ) : reviews.length === 0 && !loading ? (
                    <div className="empty-state">
                        <div className="icon">💬</div>
                        <p>No reviews found matching your filters</p>
                    </div>
                ) : (
                    <div className="reviews-list">
                        {reviews.map((review) => (
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
        </div>
    );
}

function CalendarView({ reviews, currentMonth, setCurrentMonth, onDayClick }) {
    const reviewsByDate = useMemo(() => {
        const groups = {};
        reviews.forEach(r => {
            const dateStr = new Date(r.reviewed_at).toISOString().split('T')[0];
            if (!groups[dateStr]) groups[dateStr] = [];
            groups[dateStr].push(r);
        });
        return groups;
    }, [reviews]);

    const daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
    const startDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();

    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const totalDays = daysInMonth(year, month);
    const monthName = currentMonth.toLocaleString('default', { month: 'long' });

    const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
    const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));

    const grid = [];
    // Padding for start day
    for (let i = 0; i < startDay; i++) {
        grid.push(<div key={`empty-${i}`} className="calendar-day empty"></div>);
    }

    for (let day = 1; day <= totalDays; day++) {
        const date = new Date(year, month, day);
        const dateStr = date.toISOString().split('T')[0];
        const dayReviews = reviewsByDate[dateStr] || [];
        const isToday = new Date().toISOString().split('T')[0] === dateStr;

        grid.push(
            <div
                key={day}
                className={`calendar-day ${dayReviews.length > 0 ? 'has-reviews clickable' : ''} ${isToday ? 'today' : ''}`}
                onClick={() => dayReviews.length > 0 && onDayClick(dateStr)}
            >
                <span className="day-number">{day}</span>
                {dayReviews.length > 0 && (
                    <div className="review-indicators">
                        <div className="review-count-dot">{dayReviews.length}</div>
                        <div className="platform-dots">
                            {dayReviews.some(r => r.platform === 'google') && <span className="dot google"></span>}
                            {dayReviews.some(r => r.platform === 'yelp') && <span className="dot yelp"></span>}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    const dateInputRef = useRef(null);

    return (
        <div className="calendar-container">
            <div className="calendar-header">
                <button className="nav-btn" onClick={prevMonth}>←</button>
                <div className="month-year-view clickable" onClick={() => dateInputRef.current?.showPicker()}>
                    <h2>{monthName} {year}</h2>
                    <input
                        type="date"
                        ref={dateInputRef}
                        className="hidden-date-picker"
                        onChange={(e) => {
                            const val = e.target.value;
                            if (!val) return;
                            const [y, m, d] = val.split('-').map(Number);
                            const selectedDate = new Date(y, m - 1, d);
                            setCurrentMonth(new Date(y, m - 1, 1));
                            onDayClick(val);
                        }}
                    />
                </div>
                <button className="nav-btn" onClick={nextMonth}>→</button>
            </div>
            <div className="calendar-weekdays">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d}>{d}</div>)}
            </div>
            <div className="calendar-grid">
                {grid}
            </div>
        </div>
    );
}
