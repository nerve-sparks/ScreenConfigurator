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

async function responseError(response) {
  const error = new Error(await errorMessageFrom(response))
  error.status = response.status
  return error
}

export async function generate(description) {
  const response = await fetch(`${API_BASE_URL}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  })
  if (!response.ok) {
    throw await responseError(response)
  }
  return response.json()
}

// Validate a human-reviewed manifest before previewing or saving it.
export async function validateScreen(manifest) {
  const response = await fetch(`${API_BASE_URL}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ manifest }),
  })
  if (!response.ok) {
    throw await responseError(response)
  }
  const result = await response.json()
  if (!result?.valid || !result?.manifest) {
    throw new Error('Backend returned an invalid validation response.')
  }
  return result.manifest
}

// Save a validated screen; returns {agent_id, version}.
export async function saveScreen({ manifest, description, name, presentation }) {
  const response = await fetch(`${API_BASE_URL}/screens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ manifest, description, name, presentation }),
  })
  if (!response.ok) {
    throw await responseError(response)
  }
  return response.json()
}

// Load a saved screen document by agent_id (latest version).
export async function loadScreen(agentId, version = null) {
  const query = Number.isInteger(version) ? `?version=${version}` : ''
  const response = await fetch(
    `${API_BASE_URL}/screens/${encodeURIComponent(agentId)}${query}`,
  )
  if (!response.ok) {
    throw await responseError(response)
  }
  return response.json()
}

// Update the one mutable editor draft. This never creates a published version.
export async function saveDraft(agentId, {
  manifest,
  approvedManifest,
  description,
  name,
  source = 'llm',
  presentation,
  editorState,
}) {
  const response = await fetch(
    `${API_BASE_URL}/screens/${encodeURIComponent(agentId)}/draft`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manifest,
        ...(approvedManifest ? { approved_manifest: approvedManifest } : {}),
        description,
        name,
        source,
        presentation,
        editor_state: editorState,
      }),
    },
  )
  if (!response.ok) throw await responseError(response)
  const result = await response.json()
  if (result?.status !== 'draft' || !result?.revision) {
    throw new Error('Backend returned an invalid draft response.')
  }
  return result
}

export async function loadDraft(agentId) {
  const response = await fetch(
    `${API_BASE_URL}/screens/${encodeURIComponent(agentId)}/draft`,
  )
  if (!response.ok) throw await responseError(response)
  const result = await response.json()
  if (result?.status !== 'draft' || !result?.draft_manifest) {
    throw new Error('Backend returned an invalid draft response.')
  }
  return result
}

// Publish the exact validated draft revision opened in preview.
export async function publishDraft(agentId, { draftRevision, changeSummary }) {
  const response = await fetch(
    `${API_BASE_URL}/screens/${encodeURIComponent(agentId)}/publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draft_revision: draftRevision,
        change_summary: changeSummary,
      }),
    },
  )
  if (!response.ok) throw await responseError(response)
  const result = await response.json()
  if (result?.status !== 'published' || !Number.isInteger(result?.version)) {
    throw new Error('Backend returned an invalid publish response.')
  }
  return result
}

// List saved screen IDs with their latest immutable version.
export async function listScreens() {
  const response = await fetch(`${API_BASE_URL}/screens`)
  if (!response.ok) {
    throw await responseError(response)
  }
  const result = await response.json()
  if (!Array.isArray(result?.screens)) {
    throw new Error('Backend returned an invalid screen-library response.')
  }
  return result.screens
}

// Load lightweight immutable-version summaries for the library history panel.
export async function listScreenVersions(agentId) {
  const response = await fetch(
    `${API_BASE_URL}/screens/${encodeURIComponent(agentId)}/versions`,
  )
  if (!response.ok) throw await responseError(response)
  const result = await response.json()
  if (!Array.isArray(result?.versions)) {
    throw new Error('Backend returned an invalid version-history response.')
  }
  return result.versions
}

// Duplicate the latest working state into a new, unpublished draft.
export async function duplicateScreen(agentId, name) {
  const response = await fetch(
    `${API_BASE_URL}/screens/${encodeURIComponent(agentId)}/duplicate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
  )
  if (!response.ok) throw await responseError(response)
  const result = await response.json()
  if (result?.status !== 'draft' || !result?.agent_id || !result?.revision) {
    throw new Error('Backend returned an invalid duplicate-screen response.')
  }
  return result
}

// Copy an immutable version over the mutable working draft.
export async function restoreScreenVersion(agentId, version) {
  const response = await fetch(
    `${API_BASE_URL}/screens/${encodeURIComponent(agentId)}/versions/${version}/restore`,
    { method: 'POST' },
  )
  if (!response.ok) throw await responseError(response)
  const result = await response.json()
  if (result?.status !== 'draft' || !result?.revision) {
    throw new Error('Backend returned an invalid restore-version response.')
  }
  return result
}

// Archive is a reversible metadata change; no draft or version is deleted.
export async function setScreenArchived(agentId, archived) {
  const response = await fetch(
    `${API_BASE_URL}/screens/${encodeURIComponent(agentId)}/archive`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived }),
    },
  )
  if (!response.ok) throw await responseError(response)
  const result = await response.json()
  if (result?.agent_id !== agentId || typeof result?.is_archived !== 'boolean') {
    throw new Error('Backend returned an invalid archive response.')
  }
  return result
}
