import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import {
  clearTokens,
  getAuthSnapshot,
  loginWithPassword,
  logoutFromGateway,
  refreshAccessToken,
  subscribeAuth,
} from './auth.js'

const AuthContext = createContext(null)

function subscribe(listener) {
  return subscribeAuth(listener)
}

function getSnapshot() {
  return getAuthSnapshot()
}

export function AuthProvider({ children }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [busy, setBusy] = useState(false)

  // Restore an access token from refresh when the tab only has a refresh token.
  useEffect(() => {
    if (snapshot.accessToken || !snapshot.refreshToken) return
    let cancelled = false
    ;(async () => {
      try {
        await refreshAccessToken()
      } catch {
        if (!cancelled) clearTokens()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [snapshot.accessToken, snapshot.refreshToken])

  const login = useCallback(async (credentials) => {
    setBusy(true)
    try {
      return await loginWithPassword(credentials)
    } finally {
      setBusy(false)
    }
  }, [])

  const logout = useCallback(async () => {
    setBusy(true)
    try {
      await logoutFromGateway()
    } finally {
      setBusy(false)
    }
  }, [])

  const clearSession = useCallback(() => {
    clearTokens()
  }, [])

  const value = useMemo(() => ({
    ...snapshot,
    busy,
    login,
    logout,
    clearSession,
  }), [snapshot, busy, login, logout, clearSession])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth must be used within AuthProvider.')
  }
  return value
}

export function RequireAuth({ children }) {
  const { isAuthenticated } = useAuth()
  const location = useLocation()

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    )
  }

  return children
}

export function GuestOnly({ children }) {
  const { isAuthenticated } = useAuth()

  if (isAuthenticated) {
    return <Navigate to="/library" replace />
  }

  return children
}
