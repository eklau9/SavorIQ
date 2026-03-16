import { Routes, Route, Navigate } from 'react-router-dom'
import { AdminProvider } from './AdminContext'
import Sidebar from './components/Sidebar'
import QuotasPage from './pages/QuotasPage'
import LocationsPage from './pages/LocationsPage'

export default function App() {
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
