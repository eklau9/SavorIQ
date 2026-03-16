import { useEffect } from 'react'
import { NavLink } from 'react-router-dom'

const NAV_ITEMS = [
  { path: '/locations', label: 'Locations', icon: '📍' },
  { path: '/quotas', label: 'System Quotas', icon: '⚡' },
  // Future pages — just add entries here:
  // { path: '/logs', label: 'Sync Logs', icon: '📋' },
  // { path: '/settings', label: 'Settings', icon: '⚙️' },
]

export default function Sidebar() {
  // Set the window name on load so the main app can target it
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.name = 'savoriq-admin'
    }
  }, [])

  const handleBackToApp = (e) => {
    e.preventDefault()
    // 1. Try to focus the opener if it exists
    if (window.opener && !window.opener.closed) {
      window.opener.focus()
      return
    }
    // 2. Fallback: target by name. This stays in the same tab if named, 
    // or focuses the existing tab if it was opened with that name.
    window.open('http://localhost:8081', 'savoriq-app')
  }

  return (
    <aside className="sidebar">
      <a
        href="http://localhost:8081"
        className="sidebar-back"
        onClick={handleBackToApp}
      >
        ← Back to App
      </a>

      <div className="sidebar-brand">
        <div className="sidebar-logo">S</div>
        <div>
          <div className="sidebar-title">SavorIQ</div>
          <div className="sidebar-subtitle">Command Center</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`
            }
          >
            <span className="sidebar-link-icon">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <span className="sidebar-version">v1.0.0</span>
      </div>
    </aside>
  )
}
