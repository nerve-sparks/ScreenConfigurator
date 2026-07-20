// Fetch helpers for the backend API.

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

// FastAPI errors carry a JSON body of the form {"detail": ...}.
// Our validation gate returns {"detail": {"message": ..., "errors": [...]}}.
async function errorMessageFrom(response) {
  try {
    const data = await response.json()
    const detail = data.detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail?.errors)) {
      return [detail.message ?? 'Validation failed.', ...detail.errors].join('\n')
    }
    if (detail !== undefined) return JSON.stringify(detail)
  } catch {
    // Body was not JSON; fall through to the generic message.
  }
  return `Request failed with status ${response.status}`
}

export async function generate(description) {
  const response = await fetch(`${API_BASE_URL}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  })
  if (!response.ok) {
    throw new Error(await errorMessageFrom(response))
  }
  return response.json()
}

// Save a validated screen; returns {agent_id, version}.
export async function saveScreen({ manifest, description, name }) {
  const response = await fetch(`${API_BASE_URL}/screens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ manifest, description, name }),
  })
  if (!response.ok) {
    throw new Error(await errorMessageFrom(response))
  }
  return response.json()
}

// Load a saved screen document by agent_id (latest version).
export async function loadScreen(agentId) {
  const response = await fetch(
    `${API_BASE_URL}/screens/${encodeURIComponent(agentId)}`,
  )
  if (!response.ok) {
    throw new Error(await errorMessageFrom(response))
  }
  return response.json()
}
