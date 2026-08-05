// NerveSparks Auth gateway client + token storage.
// Access token is kept in memory and mirrored to sessionStorage.
// Refresh token is stored in localStorage so a session can be renewed.
// Login / refresh / logout go through the ScreenConfigurator backend,
// which proxies to the Auth gateway and returns the JWT.

const ACCESS_STORAGE_KEY = 'sc_access_token'
const REFRESH_STORAGE_KEY = 'sc_refresh_token'
const USER_STORAGE_KEY = 'sc_auth_user'

const API_BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/$/, '')
const AUTH_TENANT_ID = (import.meta.env.VITE_AUTH_TENANT_ID ?? '').trim() || null

let memoryAccessToken = null
let refreshInFlight = null
let cachedSnapshot = null
const listeners = new Set()

function readStorage(storage, key) {
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(storage, key, value) {
  try {
    if (value == null || value === '') storage.removeItem(key)
    else storage.setItem(key, value)
  } catch {
    // Storage may be unavailable (private mode / blocked).
  }
}

function buildAuthSnapshot() {
  const accessToken = getAccessToken()
  const refreshToken = getRefreshToken()
  return {
    accessToken,
    refreshToken,
    user: getStoredUser(),
    isAuthenticated: Boolean(accessToken || refreshToken),
  }
}

function notify() {
  // Invalidate so the next getSnapshot() builds a fresh object.
  cachedSnapshot = buildAuthSnapshot()
  const snapshot = cachedSnapshot
  listeners.forEach((listener) => {
    try {
      listener(snapshot)
    } catch {
      // Listener errors must not break auth updates.
    }
  })
}

export function subscribeAuth(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Cached snapshot for useSyncExternalStore — same reference until tokens change. */
export function getAuthSnapshot() {
  if (!cachedSnapshot) {
    cachedSnapshot = buildAuthSnapshot()
  }
  return cachedSnapshot
}

export function getAccessToken() {
  if (memoryAccessToken) return memoryAccessToken
  memoryAccessToken = readStorage(sessionStorage, ACCESS_STORAGE_KEY)
  return memoryAccessToken
}

export function getRefreshToken() {
  return readStorage(localStorage, REFRESH_STORAGE_KEY)
}

export function getStoredUser() {
  const raw = readStorage(sessionStorage, USER_STORAGE_KEY)
    ?? readStorage(localStorage, USER_STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function setTokens({ accessToken, refreshToken, user } = {}) {
  if (accessToken !== undefined) {
    memoryAccessToken = accessToken || null
    writeStorage(sessionStorage, ACCESS_STORAGE_KEY, memoryAccessToken)
  }
  if (refreshToken !== undefined) {
    writeStorage(localStorage, REFRESH_STORAGE_KEY, refreshToken || null)
  }
  if (user !== undefined) {
    const serialized = user ? JSON.stringify(user) : null
    writeStorage(sessionStorage, USER_STORAGE_KEY, serialized)
    writeStorage(localStorage, USER_STORAGE_KEY, serialized)
  }
  notify()
}

export function clearTokens() {
  memoryAccessToken = null
  writeStorage(sessionStorage, ACCESS_STORAGE_KEY, null)
  writeStorage(localStorage, REFRESH_STORAGE_KEY, null)
  writeStorage(sessionStorage, USER_STORAGE_KEY, null)
  writeStorage(localStorage, USER_STORAGE_KEY, null)
  notify()
}

async function backendAuthErrorMessage(response) {
  try {
    const payload = await response.json()
    const detail = payload?.detail
    if (typeof detail === 'string' && detail) return detail
    if (typeof payload?.message === 'string' && payload.message) return payload.message
    if (typeof payload?.error?.message === 'string') return payload.error.message
  } catch {
    // Non-JSON body.
  }
  return `Auth request failed with status ${response.status}`
}

function extractTokens(payload) {
  const data = payload && typeof payload === 'object' ? payload : {}
  const accessToken = data.access_token ?? data.accessToken ?? null
  const refreshToken = data.refresh_token ?? data.refreshToken ?? null
  const user = data.user
    ?? (data.email || data.uid || data.sub
      ? {
          email: data.email ?? null,
          uid: data.uid ?? data.sub ?? null,
          display_name: data.display_name ?? data.displayName ?? null,
          tenant_id: data.tenant_id ?? data.tenantId ?? null,
          role: data.role ?? null,
        }
      : null)
  return { accessToken, refreshToken, user }
}

/** Call backend auth proxies (no Bearer required; do not use apiFetch). */
async function backendAuthFetch(path, body) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = new Error(await backendAuthErrorMessage(response))
    error.status = response.status
    throw error
  }

  if (response.status === 204) return null
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return null
  return response.json()
}

export async function loginWithPassword({ email, password, tenantId } = {}) {
  const trimmedEmail = String(email ?? '').trim()
  const body = {
    email: trimmedEmail,
    password: String(password ?? ''),
  }
  const resolvedTenant = (tenantId ?? AUTH_TENANT_ID)?.trim?.() || AUTH_TENANT_ID
  if (resolvedTenant) body.tenant_id = resolvedTenant

  const payload = await backendAuthFetch('/auth/login', body)
  const { accessToken, refreshToken, user } = extractTokens(payload)
  if (!accessToken) {
    throw new Error('Backend did not return an access token.')
  }
  setTokens({
    accessToken,
    refreshToken: refreshToken ?? getRefreshToken(),
    user: user ?? { email: trimmedEmail },
  })
  return getAuthSnapshot()
}

export async function refreshAccessToken() {
  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    clearTokens()
    throw new Error('No refresh token available.')
  }

  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    try {
      const payload = await backendAuthFetch('/auth/refresh', {
        refresh_token: refreshToken,
      })
      const tokens = extractTokens(payload)
      if (!tokens.accessToken) {
        throw new Error('Backend did not return an access token.')
      }
      setTokens({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? refreshToken,
        user: tokens.user ?? getStoredUser(),
      })
      return tokens.accessToken
    } catch (error) {
      clearTokens()
      throw error
    } finally {
      refreshInFlight = null
    }
  })()

  return refreshInFlight
}

export async function logoutFromGateway() {
  const refreshToken = getRefreshToken()
  const accessToken = getAccessToken()
  if (!refreshToken) {
    clearTokens()
    return
  }

  try {
    await backendAuthFetch('/auth/logout', {
      refresh_token: refreshToken,
      ...(accessToken ? { access_token: accessToken } : {}),
    })
  } catch {
    // Always clear local session even if the backend logout call fails.
  } finally {
    clearTokens()
  }
}

export function authLoginPath() {
  return '/login'
}

export function redirectToLogin(replace = true) {
  if (typeof window === 'undefined') return
  const target = authLoginPath()
  const current = `${window.location.pathname}${window.location.search}`
  if (current.startsWith(target)) return
  if (replace) window.location.replace(target)
  else window.location.assign(target)
}
