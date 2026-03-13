/**
 * TokenCard — Displays the status of a single Apify API token.
 *
 * Props:
 *  - token: { index, label, is_active, max_usd, used_usd, remaining_usd, resets_at, token_hint, error }
 *  - isNextUp: boolean — whether this is the next token to be used
 */
export default function TokenCard({ token, isNextUp }) {
  const { label, is_active, max_usd, used_usd, remaining_usd, resets_at, token_hint, error } = token

  // Calculate percent used
  const percentUsed = max_usd > 0 ? Math.min(100, (used_usd / max_usd) * 100) : 0
  const percentRemaining = 100 - percentUsed

  // Color logic
  let fillClass = 'green'
  if (percentRemaining < 20) fillClass = 'red'
  else if (percentRemaining < 50) fillClass = 'amber'

  // Format reset date
  const resetDisplay = resets_at
    ? new Date(resets_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Unknown'

  return (
    <div className={`card fade-in ${!is_active ? 'card-exhausted' : ''}`}>
      <div className="token-card-header">
        <span className="token-label">{label}</span>
        {error ? (
          <span className="badge badge-exhausted">Error</span>
        ) : is_active ? (
          isNextUp ? (
            <span className="badge badge-next">● Next Up</span>
          ) : (
            <span className="badge badge-active">● Active</span>
          )
        ) : (
          <span className="badge badge-exhausted">● Exhausted</span>
        )}
      </div>

      {error ? (
        <div className="token-error">{error}</div>
      ) : (
        <>
          <div className="token-stats">
            <div>
              <div className="stat-label">Remaining</div>
              <div className="stat-value" style={{ color: is_active ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}>
                ${(remaining_usd ?? 0).toFixed(2)}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="stat-label">Used</div>
              <div className="stat-value" style={{ color: 'var(--text-secondary)' }}>
                ${(used_usd ?? 0).toFixed(2)}
              </div>
            </div>
          </div>

          <div className="progress-bar">
            <div
              className={`progress-fill ${fillClass}`}
              style={{ width: `${percentRemaining}%` }}
            />
          </div>

          <div className="meta-row">
            <span>Resets: {resetDisplay}</span>
            <span className="token-hint">{token_hint}</span>
          </div>
        </>
      )}
    </div>
  )
}
