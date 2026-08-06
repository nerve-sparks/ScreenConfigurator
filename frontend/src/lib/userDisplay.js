/** Display helpers for the signed-in AuthContext user. */

export function userDisplayName(user) {
  if (!user || typeof user !== 'object') return 'Account'
  const name = String(user.display_name || user.displayName || '').trim()
  if (name) return name
  const email = String(user.email || '').trim()
  if (email) return email.split('@')[0] || email
  return 'Account'
}

export function userEmail(user) {
  if (!user || typeof user !== 'object') return ''
  return String(user.email || '').trim()
}

export function userInitials(user) {
  const name = userDisplayName(user)
  if (!name || name === 'Account') return '?'
  const parts = name.replace(/[._-]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }
  const email = userEmail(user)
  if (email.includes('@')) {
    const local = email.split('@')[0]
    if (local.length >= 2) return local.slice(0, 2).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

export function formatRelativeTime(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const seconds = Math.round((date.getTime() - Date.now()) / 1000)
  const abs = Math.abs(seconds)
  const divisions = [
    { amount: 60, unit: 'second' },
    { amount: 60, unit: 'minute' },
    { amount: 24, unit: 'hour' },
    { amount: 7, unit: 'day' },
    { amount: 4.34524, unit: 'week' },
    { amount: 12, unit: 'month' },
    { amount: Number.POSITIVE_INFINITY, unit: 'year' },
  ]

  let duration = seconds
  for (const division of divisions) {
    if (Math.abs(duration) < division.amount) {
      try {
        return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
          Math.round(duration),
          division.unit,
        )
      } catch {
        break
      }
    }
    duration /= division.amount
  }

  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function publishedAgentHref(agentId, version = null) {
  const base = `/agents/${encodeURIComponent(agentId)}`
  return Number.isInteger(version) ? `${base}?version=${version}` : base
}

/** Open the published agent runtime in a new browser tab. */
export function openPublishedAgent(agentId, version = null) {
  if (typeof window === 'undefined' || !agentId) return
  window.open(publishedAgentHref(agentId, version), '_blank', 'noopener,noreferrer')
}
