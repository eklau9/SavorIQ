import { NavLink } from 'react-router-dom'

const NAV_ITEMS = [
  { path: '/quotas', label: 'API Quotas', icon: '⚡' },
  // Future pages — just add entries here:
  // { path: '/logs', label: 'Sync Logs', icon: '📋' },
  // { path: '/settings', label: 'Settings', icon: '⚙️' },
]

export default function Sidebar() {
  return (
    <aside className="sidebar">
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
