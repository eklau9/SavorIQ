import { Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import QuotasPage from './pages/QuotasPage'

export default function App() {
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Navigate to="/quotas" replace />} />
          <Route path="/quotas" element={<QuotasPage />} />
        </Routes>
      </main>
    </div>
  )
}
