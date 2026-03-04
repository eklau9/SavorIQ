"use client";

import { useState, useEffect } from "react";
import { searchBusiness, syncApifyReviews, fetchSyncStatus } from "@/lib/api";

export default function SyncPage() {
    const [name, setName] = useState("");
    const [location, setLocation] = useState("");
    const [searching, setSearching] = useState(false);
    const [results, setResults] = useState(null);
    const [syncing, setSyncing] = useState({});
    const [syncResults, setSyncResults] = useState([]);
    const [syncLogs, setSyncLogs] = useState([]);
    const [error, setError] = useState(null);

    useEffect(() => {
        loadSyncStatus();
    }, []);

    async function loadSyncStatus() {
        try {
            const logs = await fetchSyncStatus();
            setSyncLogs(logs);
        } catch { }
    }

    async function getCoordinates() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error("Geolocation is not supported by your browser"));
            } else {
                navigator.geolocation.getCurrentPosition(
                    (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                    (err) => reject(new Error("Please enable location access or type a city name"))
                );
            }
        });
    }

    async function handleSearch(e) {
        e.preventDefault();
        if (!name.trim()) return;

        // If location is provided, it must be at least 2 chars
        if (location.trim() && location.trim().length < 2) return;

        setSearching(true);
        setError(null);
        setResults(null);
        setSyncResults([]);

        try {
            let lat = null;
            let lng = null;
            let searchLocation = location.trim();

            // If location is blank, try to get coordinates
            if (!searchLocation) {
                try {
                    const coords = await getCoordinates();
                    lat = coords.lat;
                    lng = coords.lng;
                } catch (geoErr) {
                    throw new Error(geoErr.message);
                }
            }

            const data = await searchBusiness(name.trim(), searchLocation, lat, lng);
            setResults(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setSearching(false);
        }
    }

    async function handleSync(platform, businessId, businessName, businessUrl) {
        // For Apify sync, the URL is the unique identifier
        const identifier = businessUrl || businessId;
        const key = `${platform}:${identifier}`;
        setSyncing((prev) => ({ ...prev, [key]: true }));
        try {
            const result = await syncApifyReviews(platform, identifier, businessName);
            setSyncResults((prev) => [...prev, { platform, businessName, ...result }]);
            await loadSyncStatus();
        } catch (err) {
            setSyncResults((prev) => [
                ...prev,
                { platform, businessName, status: "error", message: err.message },
            ]);
        } finally {
            setSyncing((prev) => ({ ...prev, [key]: false }));
        }
    }

    function formatTimeAgo(isoStr) {
        const diff = Date.now() - new Date(isoStr).getTime();
        const hours = Math.floor(diff / 3600000);
        if (hours < 1) return "just now";
        if (hours < 24) return `${hours}h ago`;
        return `${Math.floor(hours / 24)}d ago`;
    }

    return (
        <div className="sync-page">
            <div className="page-header">
                <h2>🔄 Review Sync</h2>
                <p className="subtitle">
                    Search for a business and sync reviews from Google &amp; Yelp
                </p>
            </div>

            {/* Search Form */}
            <form className="sync-search-form" onSubmit={handleSearch}>
                <div className="sync-inputs">
                    <div className="sync-input-group">
                        <label>Business Name</label>
                        <input
                            type="text"
                            placeholder="e.g. Heytea"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="sync-input"
                        />
                    </div>
                    <div className="sync-input-group">
                        <label>Location (Optional)</label>
                        <input
                            type="text"
                            placeholder="e.g. Milpitas, CA (or leave blank for 'near me')"
                            value={location}
                            onChange={(e) => setLocation(e.target.value)}
                            className="sync-input"
                        />
                    </div>
                    <button
                        type="submit"
                        className="sync-search-btn"
                        disabled={searching || !name.trim()}
                    >
                        {searching ? (
                            <span className="btn-spinner" />
                        ) : (
                            "🔍 Search"
                        )}
                    </button>
                </div>
            </form>

            {error && (
                <div className="sync-error">
                    <span>⚠️</span> {error}
                </div>
            )}

            {/* Sync Activity (Moved to top for visibility) */}
            {syncResults.length > 0 && (
                <div className="sync-activity">
                    <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <h3 style={{ margin: 0 }}>⚡ Recent Activity</h3>
                        <button
                            onClick={() => setSyncResults([])}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-muted)',
                                cursor: 'pointer',
                                fontSize: '0.8rem'
                            }}
                        >
                            Clear All
                        </button>
                    </div>
                    {syncResults.slice().reverse().map((r, i) => (
                        <div
                            key={i}
                            className={`sync-result-card ${r.status === "error" ? "error" : r.status === "skipped" ? "skipped" : "success"}`}
                        >
                            <div className="sync-result-header">
                                <span className={`platform-dot ${r.platform}`} />
                                <strong>{r.businessName}</strong>
                                <span className={`sync-status-badge ${r.status}`}>
                                    {r.status === "synced"
                                        ? "✓ Synced"
                                        : r.status === "skipped"
                                            ? "⏳ Cooldown"
                                            : "✕ Error"}
                                </span>
                            </div>
                            {r.status === "synced" && (
                                <p className="sync-result-detail">
                                    Fetched {r.total_fetched} reviews •{" "}
                                    <strong>{r.new_ingested} new</strong> •{" "}
                                    {r.duplicates_skipped} duplicates skipped
                                </p>
                            )}
                            {r.status === "skipped" && (
                                <p className="sync-result-detail">{r.message}</p>
                            )}
                            {r.status === "error" && (
                                <p className="sync-result-detail">{r.message}</p>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Search Results */}
            {results && (
                <div className="sync-results">
                    {/* Google Results */}
                    {results.google && results.google.length > 0 && (
                        <div className="platform-results">
                            <h3 className="platform-heading google">
                                <span className="platform-dot google" />
                                Google Places
                                <span className="platform-note">Up to 5 reviews per sync</span>
                            </h3>
                            {results.google.map((biz) => (
                                <div className="biz-card" key={`g-${biz.id}`}>
                                    <div className="biz-info">
                                        <h4>{biz.name}</h4>
                                        <p className="biz-address">{biz.address}</p>
                                        <div className="biz-meta">
                                            <span className="biz-rating">⭐ {biz.rating}</span>
                                            <span className="biz-reviews">
                                                {biz.review_count} reviews
                                            </span>
                                            {biz.last_sync && (
                                                <span className={`biz-last-sync ${biz.last_sync.on_cooldown ? 'cooldown' : ''}`}>
                                                    🕒 Last synced {biz.last_sync.ago} ago
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        className="sync-btn"
                                        disabled={syncing[`google:${biz.place_url || biz.id}`] || biz.last_sync?.on_cooldown}
                                        onClick={() =>
                                            handleSync("google", biz.id, biz.name, biz.place_url)
                                        }
                                    >
                                        {syncing[`google:${biz.place_url || biz.id}`] ? (
                                            <span className="btn-spinner" />
                                        ) : biz.last_sync?.on_cooldown ? (
                                            "⏳ Cooldown"
                                        ) : (
                                            "Sync Reviews"
                                        )}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    {results.google_error && (
                        <div className="sync-error mini">Google: {results.google_error}</div>
                    )}

                    {/* Yelp Results */}
                    {results.yelp && results.yelp.length > 0 && (
                        <div className="platform-results">
                            <h3 className="platform-heading yelp">
                                <span className="platform-dot yelp" />
                                Yelp
                                <span className="platform-note">Up to 3 review excerpts per sync</span>
                            </h3>
                            {results.yelp.map((biz) => (
                                <div className="biz-card" key={`y-${biz.id}`}>
                                    <div className="biz-info">
                                        <h4>{biz.name}</h4>
                                        <p className="biz-address">{biz.address}</p>
                                        <div className="biz-meta">
                                            <span className="biz-rating">⭐ {biz.rating}</span>
                                            <span className="biz-reviews">
                                                {biz.review_count} reviews
                                            </span>
                                            {biz.last_sync && (
                                                <span className={`biz-last-sync ${biz.last_sync.on_cooldown ? 'cooldown' : ''}`}>
                                                    🕒 Last synced {biz.last_sync.ago} ago
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        className="sync-btn"
                                        disabled={syncing[`yelp:${biz.url || biz.id}`] || biz.last_sync?.on_cooldown}
                                        onClick={() =>
                                            handleSync("yelp", biz.id, biz.name, biz.url)
                                        }
                                    >
                                        {syncing[`yelp:${biz.url || biz.id}`] ? (
                                            <span className="btn-spinner" />
                                        ) : biz.last_sync?.on_cooldown ? (
                                            "⏳ Cooldown"
                                        ) : (
                                            "Sync Reviews"
                                        )}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    {results.yelp_error && (
                        <div className="sync-error mini">Yelp: {results.yelp_error}</div>
                    )}

                    {results.google?.length === 0 && results.yelp?.length === 0 && (
                        <div className="empty-state">
                            <div className="icon">🔍</div>
                            <p>No businesses found. Try a different search.</p>
                        </div>
                    )}
                </div>
            )}

            {/* Sync History */}
            {syncLogs.length > 0 && (
                <div className="sync-history">
                    <h3>📜 Sync History</h3>
                    <div className="sync-log-grid">
                        {syncLogs.map((log, i) => (
                            <div className="sync-log-card" key={i}>
                                <div className="log-header">
                                    <span className={`platform-dot ${log.platform}`} />
                                    <strong>{log.business_name}</strong>
                                </div>
                                <div className="log-meta">
                                    <span>Last synced: {formatTimeAgo(log.last_synced_at)}</span>
                                    <span>{log.reviews_fetched} reviews</span>
                                    <span>{log.new_reviews} new</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
