import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import Toast from './components/Toast'

const AdminContext = createContext()

const API_BASE = import.meta.env.PROD
  ? 'https://savoriq-api.onrender.com/api/admin'
  : '/api/admin'
const AUTO_REFRESH_MS = 60_000

export function AdminProvider({ children }) {
  const [locations, setLocations] = useState([])
  const [quotas, setQuotas] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [toasts, setToasts] = useState([])

  const showToast = useCallback((message, type = 'success') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const fetchAll = useCallback(async () => {
    try {
      const headers = { 'X-Access-Key': 'SavorIQ' }
      
      // Fetch both in parallel for speed
      const [locResp, quotaResp] = await Promise.all([
        fetch(`${API_BASE}/locations`, { headers }),
        fetch(`${API_BASE}/quotas`, { headers })
      ])

      if (!locResp.ok || !quotaResp.ok) {
        throw new Error(`HTTP Error: Loc=${locResp.status}, Quota=${quotaResp.status}`)
      }

      const [locJson, quotaJson] = await Promise.all([
        locResp.json(),
        quotaResp.json()
      ])

      setLocations(locJson)
      setQuotas(quotaJson)
      setLastRefresh(new Date())
      setError(null)
    } catch (err) {
      console.error('Fetch error:', err)
      setError(err.message || 'Failed to sync with backend')
    } finally {
      // Small delay prevents flickering and ensures state is settled
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, AUTO_REFRESH_MS)
    return () => clearInterval(interval)
  }, [fetchAll])

  const refresh = () => fetchAll()

  return (
    <AdminContext.Provider value={{
      locations,
      setLocations,
      quotas,
      setQuotas,
      loading,
      error,
      lastRefresh,
      refresh,
      showToast
    }}>
      {children}
      <div className="toast-container">
        {toasts.map(toast => (
          <Toast 
            key={toast.id} 
            {...toast} 
            onClose={() => removeToast(toast.id)} 
          />
        ))}
      </div>
    </AdminContext.Provider>
  )
}

export function useAdminContext() {
  const context = useContext(AdminContext)
  if (!context) throw new Error('useAdminContext must be used within an AdminProvider')
  return context
}
