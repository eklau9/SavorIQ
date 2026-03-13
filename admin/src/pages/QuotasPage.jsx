import { useState, useEffect, useCallback } from 'react'
import TokenCard from '../components/TokenCard'
import ServiceCard from '../components/ServiceCard'

const API_BASE = '/api/admin'
const AUTO_REFRESH_MS = 60_000 // 60 seconds

export default function QuotasPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)

  const fetchQuotas = useCallback(async () => {
    try {
      setError(null)
      const resp = await fetch(`${API_BASE}/quotas`, {
        headers: { 'X-Access-Key': 'SavorIQ' },
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const json = await resp.json()
      setData(json)
      setLastRefresh(new Date())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchQuotas()
    const interval = setInterval(fetchQuotas, AUTO_REFRESH_MS)
    return () => clearInterval(interval)
  }, [fetchQuotas])

  // Find the first active token index for "Next Up" badge
  const nextUpIndex = data?.apify?.findIndex(t => t.is_active) ?? -1

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner" />
        <span>Loading quota data...</span>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="loading-container">
        <span style={{ color: 'var(--accent-rose)' }}>⚠ Failed to load: {error}</span>
        <button className="refresh-btn" onClick={fetchQuotas}>Retry</button>
      </div>
    )
  }

  return (
    <>
      <div className="page-header">
        <h1>API Quotas</h1>
        <p>Live usage across all external services</p>
      </div>

      <div className="refresh-row">
        <span className="auto-refresh-note">
          {lastRefresh
            ? `Last updated: ${lastRefresh.toLocaleTimeString()} · Auto-refreshes every 60s`
            : 'Fetching...'}
        </span>
        <button className="refresh-btn" onClick={() => { setLoading(true); fetchQuotas(); }}>
          ↻ Refresh
        </button>
      </div>

      {/* ── Apify Token Waterfall ── */}
      <div className="section">
        <div className="section-title">
          <span className="dot" />
          Apify Token Waterfall — {data?.apify?.filter(t => t.is_active).length ?? 0} active
        </div>
        <div className="token-grid">
          {data?.apify?.map(token => (
            <TokenCard
              key={token.index}
              token={token}
              isNextUp={token.index === nextUpIndex}
            />
          ))}
        </div>
      </div>

      {/* ── Other Services ── */}
      <div className="section">
        <div className="section-title">
          <span className="dot" style={{ background: 'var(--accent-blue)' }} />
          Other Services
        </div>
        <div className="service-grid">
          {/* Yelp */}
          <ServiceCard title="Yelp Fusion" icon="🔍">
            {data?.yelp?.configured ? (
              data.yelp.error ? (
                <div className="token-error">{data.yelp.error}</div>
              ) : (
                <>
                  <div className="token-stats">
                    <div>
                      <div className="stat-label">Remaining Today</div>
                      <div className="stat-value" style={{ color: 'var(--accent-emerald)' }}>
                        {data.yelp.remaining ?? '—'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="stat-label">Daily Limit</div>
                      <div className="stat-value" style={{ color: 'var(--text-secondary)' }}>
                        {data.yelp.daily_limit ?? '—'}
                      </div>
                    </div>
                  </div>
                  <div className="meta-row">
                    <span>Resets: {data.yelp.resets_at ? new Date(data.yelp.resets_at).toLocaleDateString() : 'Daily'}</span>
                  </div>
                </>
              )
            ) : (
              <div className="stat-label">Not configured</div>
            )}
          </ServiceCard>

          {/* Supabase */}
          <ServiceCard title="Supabase DB" icon="🗄️">
            {data?.supabase?.configured ? (
              data.supabase.error ? (
                <div className="token-error">{data.supabase.error}</div>
              ) : (
                <>
                  <div className="token-stats">
                    <div>
                      <div className="stat-label">Storage Used</div>
                      <div className="stat-value" style={{ color: 'var(--accent-blue)' }}>
                        {data.supabase.used ?? '—'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="stat-label">Free Tier Limit</div>
                      <div className="stat-value" style={{ color: 'var(--text-secondary)' }}>
                        {data.supabase.limit ?? '—'}
                      </div>
                    </div>
                  </div>
                </>
              )
            ) : (
              <div className="stat-label">{data?.supabase?.note ?? 'Not configured'}</div>
            )}
          </ServiceCard>

          {/* Google Places */}
          <ServiceCard title="Google Places" icon="📍">
            {data?.google?.places?.configured ? (
              <>
                <div className="stat-label" style={{ marginBottom: 8 }}>{data.google.places.note}</div>
                <a
                  href={data.google.places.console_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="service-link"
                >
                  View in Cloud Console →
                </a>
              </>
            ) : (
              <div className="stat-label">Not configured</div>
            )}
          </ServiceCard>

          {/* Gemini AI */}
          <ServiceCard title="Gemini AI" icon="✨">
            {data?.google?.gemini?.configured ? (
              <>
                <div className="stat-label" style={{ marginBottom: 8 }}>{data.google.gemini.note}</div>
                <a
                  href={data.google.gemini.console_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="service-link"
                >
                  View Plan Info →
                </a>
              </>
            ) : (
              <div className="stat-label">Not configured</div>
            )}
          </ServiceCard>
        </div>
      </div>
    </>
  )
}
