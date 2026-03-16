import { useState } from 'react'
import { useAdminContext } from '../AdminContext'
import Header from '../components/Header'

const API_BASE = '/api/admin'

function timeAgo(isoString) {
  if (!isoString) return 'Never'
  // Append Z to ensure it's parsed as UTC if no timezone is present
  const doc = isoString.endsWith('Z') ? isoString : `${isoString}Z`
  const diff = Date.now() - new Date(doc).getTime()
  
  if (diff < 60000) return 'Just now'
  
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function formatLastSync(isoString) {
  if (!isoString) return 'Never'
  const date = new Date(isoString.endsWith('Z') ? isoString : `${isoString}Z`)
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

function isStale(isoString) {
  if (!isoString) return true
  const diff = Date.now() - new Date(isoString).getTime()
  return diff > 3 * 24 * 60 * 60 * 1000 // 3 days
}

const STATUS_BADGES = {
  active: { label: 'Active', className: 'badge badge-active' },
  trial: { label: 'Trial', className: 'badge badge-next' },
  none: { label: 'Not Subscribed', className: 'badge badge-exhausted' },
}

export default function LocationsPage() {
  const { locations, loading, error, refresh } = useAdminContext()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all') // all | stale | synced
  const [deleteModal, setDeleteModal] = useState(null) // { id, name }
  const [deleteInput, setDeleteInput] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [expandedIds, setExpandedIds] = useState(new Set())

  const toggleExpand = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const expandAll = () => setExpandedIds(new Set((locations || []).map(l => l.id)))
  const collapseAll = () => setExpandedIds(new Set())

  const handleDelete = async () => {
    if (!deleteModal || deleteInput.trim() !== deleteModal.name.trim()) return
    setDeleting(true)
    try {
      const resp = await fetch(`${API_BASE}/locations/${deleteModal.id}`, {
        method: 'DELETE',
        headers: {
          'X-Access-Key': 'SavorIQ',
          'X-Confirm-Delete': deleteInput.trim(),
        },
      })
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}))
        throw new Error(body.detail || `HTTP ${resp.status}`)
      }
      setDeleteModal(null)
      setDeleteInput('')
      refresh()
    } catch (err) {
      alert(`Delete failed: ${err.message}`)
    } finally {
      setDeleting(false)
    }
  }

  // Filtering
  const filtered = (locations || []).filter(loc => {
    if (search && !loc.name.toLowerCase().includes(search.toLowerCase())) return false
    if (statusFilter === 'stale') {
      return isStale(loc.google_last_synced) || isStale(loc.yelp_last_synced)
    }
    if (statusFilter === 'synced') {
      return !isStale(loc.google_last_synced) && !isStale(loc.yelp_last_synced)
    }
    return true
  })

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner" />
        <span>Loading locations...</span>
      </div>
    )
  }

  if (error && (!locations || !locations.length)) {
    return (
      <div className="loading-container">
        <span style={{ color: 'var(--accent-rose)' }}>⚠ {error}</span>
        <button className="refresh-btn" onClick={refresh}>Retry</button>
      </div>
    )
  }

  return (
    <>
      <Header 
        title="Locations" 
        subtitle="Manage all restaurant locations and their review data" 
      />

      {/* Filter Bar */}
      <div className="loc-filters">
        <input
          type="text"
          className="loc-search"
          placeholder="Search locations..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="loc-filter-pills">
          {['all', 'stale', 'synced'].map(f => (
            <button
              key={f}
              className={`loc-pill ${statusFilter === f ? 'loc-pill-active' : ''}`}
              onClick={() => setStatusFilter(f)}
            >
              {f === 'all' ? `All (${locations.length})` :
               f === 'stale' ? '⚠ Stale' : '✅ Up to Date'}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="loc-pill" onClick={expandAll}>Expand All</button>
          <button className="loc-pill" onClick={collapseAll}>Collapse All</button>
        </div>
      </div>

      {/* Location Waterfall */}
      <div className="loc-grid">
        {(filtered || []).map(loc => {
          const isExpanded = expandedIds.has(loc.id)
          return (
            <div key={loc.id} className="card loc-card fade-in">
              {/* Header - Clickable */}
              <div className="loc-card-header" onClick={() => toggleExpand(loc.id)}>
                <div className="loc-name-group">
                  <span className={`toggle-arrow ${isExpanded ? 'expanded' : ''}`}>▶</span>
                  <div>
                    <div className="loc-name">{loc.name}</div>
                    {loc.address && <div className="loc-address">{loc.address}</div>}
                  </div>
                </div>
                <div className="loc-sub-badge">
                  {STATUS_BADGES[loc.subscription_status] ? (
                    <span className={STATUS_BADGES[loc.subscription_status].className}>
                      {STATUS_BADGES[loc.subscription_status].label}
                    </span>
                  ) : (
                    <span className="badge badge-exhausted">Unknown</span>
                  )}
                </div>
              </div>

              {/* Collapsible Content */}
              {isExpanded && (
                <div className="loc-card-expanded">
                  {/* Review Stats */}
                  <div className="loc-stats">
                    <div className="loc-stat">
                      <div className="loc-stat-icon">📍</div>
                      <div>
                        <div className="stat-value" style={{ fontSize: 16, color: 'var(--accent-blue)' }}>
                          {loc.google_reviews.toLocaleString()}
                        </div>
                        <div className="stat-label">Google Reviews</div>
                      </div>
                      <div className={`loc-sync-tag ${isStale(loc.google_last_synced) ? 'loc-sync-stale' : 'loc-sync-ok'}`}>
                        Last Synced: {timeAgo(loc.google_last_synced)}
                      </div>
                    </div>

                    <div className="loc-stat">
                      <div className="loc-stat-icon">🔍</div>
                      <div>
                        <div className="stat-value" style={{ fontSize: 16, color: 'var(--accent-emerald)' }}>
                          {loc.yelp_reviews.toLocaleString()}
                        </div>
                        <div className="stat-label">Yelp Reviews</div>
                      </div>
                      <div className={`loc-sync-tag ${isStale(loc.yelp_last_synced) ? 'loc-sync-stale' : 'loc-sync-ok'}`}>
                        Last Synced: {timeAgo(loc.yelp_last_synced)}
                      </div>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="loc-footer" style={{ marginTop: 20 }}>
                    <div className="loc-meta">
                      <span>👥 {loc.guest_count} guests linked</span>
                      <span>📝 {loc.total_reviews.toLocaleString()} total reviews tracked</span>
                    </div>
                    <button
                      className="loc-delete-btn"
                      onClick={() => { setDeleteModal({ id: loc.id, name: loc.name }); setDeleteInput('') }}
                    >
                      Delete Location
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div className="loading-container" style={{ height: 200 }}>
            <span>No locations match your filter.</span>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteModal && (
        <div className="loc-modal-overlay" onClick={() => setDeleteModal(null)}>
          <div className="loc-modal" onClick={e => e.stopPropagation()}>
            <h3 style={{ color: 'var(--accent-rose)', marginBottom: 8 }}>⚠ Delete Location</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 16 }}>
              This will permanently delete <strong style={{ color: 'var(--text-primary)' }}>{deleteModal.name}</strong> and
              ALL associated reviews, guests, orders, and sentiment data. This cannot be undone.
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 8 }}>
              Type <strong style={{ color: 'var(--accent-rose)' }}>{deleteModal.name}</strong> to confirm:
            </p>
            <input
              type="text"
              className="loc-modal-input"
              value={deleteInput}
              onChange={e => setDeleteInput(e.target.value)}
              placeholder={deleteModal.name}
              autoFocus
            />
            <div className="loc-modal-actions">
              <button className="loc-modal-cancel" onClick={() => setDeleteModal(null)}>Cancel</button>
              <button
                className="loc-modal-confirm"
                disabled={deleteInput.trim() !== deleteModal.name.trim() || deleting}
                onClick={handleDelete}
              >
                {deleting ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
