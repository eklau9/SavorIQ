import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { AdminProvider } from './AdminContext'
import Sidebar from './components/Sidebar'
import QuotasPage from './pages/QuotasPage'
import LocationsPage from './pages/LocationsPage'

export default function App() {
  // Dismiss the HTML splash screen once React mounts
  useEffect(() => {
    const splash = document.getElementById('savoriq-splash')
    if (splash) {
      splash.classList.add('hide')
      setTimeout(() => splash.remove(), 400)
    }
  }, [])
  return (
    <AdminProvider>
      <div className="app-layout">
        <Sidebar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Navigate to="/locations" replace />} />
            <Route path="/locations" element={<LocationsPage />} />
            <Route path="/quotas" element={<QuotasPage />} />
          </Routes>
        </main>
      </div>
    </AdminProvider>
  )
}
