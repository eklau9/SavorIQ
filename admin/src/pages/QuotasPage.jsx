import { useState } from 'react'
import { useAdminContext } from '../AdminContext'
import TokenCard from '../components/TokenCard'
import ServiceCard from '../components/ServiceCard'
import Header from '../components/Header'

const API_BASE = '/api/admin'

export default function QuotasPage() {
  const { quotas: data, loading, error, lastRefresh, refresh: fetchQuotas, setQuotas: setData, showToast } = useAdminContext()
  const [apifyExpanded, setApifyExpanded] = useState(false)
  const [syncingYelp, setSyncingYelp] = useState(false)
  const [syncingGemini, setSyncingGemini] = useState(false)

  const handleYelpSync = async () => {
    setSyncingYelp(true)
    try {
      const resp = await fetch(`${API_BASE}/quotas/yelp-sync`, {
        method: 'POST',
        headers: { 'X-Access-Key': 'SavorIQ' },
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const json = await resp.json()
      if (json?.status === 'success') {
        setData(prev => ({ ...prev, yelp: json.yelp }))
        showToast("Yelp quota calibrated correctly from live headers.")
      } else {
        showToast(`Sync failed: ${json?.message || 'Unexpected response'}`, 'error')
      }
    } catch (err) {
      showToast(`Sync error: ${err?.message || 'Failed to reach server'}`, 'error')
    } finally {
      setSyncingYelp(false)
    }
  }

  const handleGeminiSync = async () => {
    setSyncingGemini(true)
    try {
      const resp = await fetch(`${API_BASE}/quotas/gemini-sync`, {
        method: 'POST',
        headers: { 'X-Access-Key': 'SavorIQ' },
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const json = await resp.json()
      
      // Update usage data if returned (even on error, e.g. 429 calibration)
      if (json?.gemini) {
        setData(prev => ({ 
          ...prev, 
          google: { 
            ...prev.google, 
            gemini: { ...prev.google.gemini, usage: json.gemini } 
          } 
        }))
      }

      if (json?.status === 'success') {
        showToast("Gemini calibrated successfully. Live probe succeeded.")
      } else {
        showToast(`Sync confirmed: ${json?.message || 'Still exhausted'}`, 'error')
      }
    } catch (err) {
      showToast(`Sync error: ${err?.message || 'Failed to reach server'}`, 'error')
    } finally {
      setSyncingGemini(false)
    }
  }

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
      <Header 
        title="API Quotas" 
        subtitle="Live usage across all external services" 
      />

      <div className="refresh-row">
        <span className="auto-refresh-note">
          {lastRefresh
            ? `Last updated: ${lastRefresh.toLocaleTimeString()} · Auto-refreshes every 60s · All checks are zero-cost`
            : 'Fetching...'}
        </span>
      </div>

      {/* ── Apify Token Waterfall ── */}
      <div className="section">
        <div
          className="section-title section-toggle"
          onClick={() => setApifyExpanded(prev => !prev)}
        >
          <span className={`toggle-arrow ${apifyExpanded ? 'expanded' : ''}`}>▶</span>
          <span className="dot" />
          Apify Token Waterfall — {data?.apify?.filter(t => t.is_active).length ?? 0} of {data?.apify?.length ?? 0} active
          {(() => {
            const tokens = data?.apify ?? []
            const totalMax = tokens.reduce((s, t) => s + (t.max_usd || 0), 0)
            const totalRemaining = tokens.reduce((s, t) => s + (t.remaining_usd || 0), 0)
            const pct = totalMax > 0 ? Math.round((totalRemaining / totalMax) * 100) : 0
            const color = pct < 20 ? 'var(--accent-rose)' : pct < 50 ? 'var(--accent-gold)' : 'var(--accent-emerald)'
            return <span style={{ marginLeft: 10, fontSize: '12px', fontWeight: 500, color }}>· {pct}% remaining</span>
          })()}
        </div>
        {apifyExpanded && (
          <div className="token-grid">
            {data?.apify?.map(token => (
              <TokenCard
                key={token.index}
                token={token}
                isNextUp={token.index === nextUpIndex}
              />
            ))}
          </div>
        )}
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
                      <div className="stat-label">Used Today</div>
                      <div className="stat-value" style={{ color: 'var(--text-secondary)' }}>
                        {data.yelp.used_today ?? '—'}
                      </div>
                    </div>
                  </div>
                  <div className="meta-row" style={{ marginTop: 12, alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <div className="token-hint" style={{ marginBottom: 4 }}>
                        {data.yelp.tracking === 'internal' ? '📊 Internal tracking' : 'Live API'}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        Daily Limit: {data.yelp.daily_limit ?? '—'}
                      </div>
                    </div>
                    <button 
                      className="refresh-btn tiny" 
                      onClick={handleYelpSync}
                      disabled={syncingYelp}
                    >
                      {syncingYelp ? 'Syncing...' : 'Sync to Live'}
                    </button>
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

          {/* Google Gemini AI */}
          <ServiceCard title="Google Gemini AI" icon="✨">
            {data?.google?.gemini?.configured ? (
              <>
                {data.google.gemini.model && (
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: 8, fontFamily: 'monospace' }}>
                    Model: {data.google.gemini.model}
                  </div>
                )}
                <div className="token-stats" style={{ marginBottom: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div className="stat-label">Minute Burst (RPM)</div>
                    <div className="stat-value" style={{ color: data.google.gemini.usage.rpm >= 13 ? 'var(--accent-rose)' : data.google.gemini.usage.rpm >= 8 ? 'var(--accent-gold)' : 'var(--accent-emerald)' }}>
                      {data.google.gemini.usage.rpm} / {data.google.gemini.usage.rpm_limit}
                    </div>
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: 2 }}>Limit: {data.google.gemini.usage.rpm_limit} per minute</div>
                  </div>
                  <div style={{ flex: 1, textAlign: 'right' }}>
                    <div className="stat-label">Daily Quota (RPD)</div>
                    <div className="stat-value" style={{ color: data.google.gemini.usage.rpd >= data.google.gemini.usage.rpd_limit ? 'var(--accent-rose)' : 'var(--text-secondary)' }}>
                      {data.google.gemini.usage.rpd} / {data.google.gemini.usage.rpd_limit}
                    </div>
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: 2 }}>Limit: {data.google.gemini.usage.rpd_limit.toLocaleString()} per day</div>
                  </div>
                </div>
                
                {data.google.gemini.usage.rpm >= 12 && (
                  <div className="token-error" style={{ marginBottom: 12, padding: '4px 8px', fontSize: 11, background: 'rgba(255, 107, 107, 0.1)' }}>
                    ⚠ High Burst Pressure: Slowing down requests...
                  </div>
                )}

                <a
                  href={data.google.gemini.console_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="service-link"
                >
                  View Plan Info →
                </a>

                <div className="meta-row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
                  <button 
                    className="refresh-btn tiny" 
                    onClick={handleGeminiSync}
                    disabled={syncingGemini}
                  >
                    {syncingGemini ? 'Syncing...' : 'Sync to Live'}
                  </button>
                </div>
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
