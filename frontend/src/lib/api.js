// Fetch helpers for the backend API.
// Every request sends Authorization: Bearer <access_token> when available.
// On 401, one refresh attempt is made before clearing the session.

import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  redirectToLogin,
  refreshAccessToken,
} from './auth.js'

const API_BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/$/, '')

export function getApiBaseUrl() {
  return API_BASE_URL
}

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
    if (detail && typeof detail === 'object') {
      const parts = []
      if (typeof detail.message === 'string') parts.push(detail.message)
      if (typeof detail.hint === 'string') parts.push(detail.hint)
      if (detail.agent_body != null) {
        const body = detail.agent_body
        const output = body?.result?.output
        if (typeof output === 'string') {
          parts.push(output)
        } else {
          parts.push(typeof body === 'string' ? body : JSON.stringify(body))
        }
      }
      if (parts.length) return parts.join('\n')
      return JSON.stringify(detail)
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

function buildHeaders(initHeaders, { json = false, token } = {}) {
  const headers = new Headers(initHeaders ?? undefined)
  if (json && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  } else {
    headers.delete('Authorization')
  }
  return headers
}

async function handleUnauthorized() {
  clearTokens()
  redirectToLogin(true)
}

export async function apiFetch(path, init = {}, { retry = true } = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`
  const method = (init.method ?? 'GET').toUpperCase()
  const hasJsonBody = init.body != null && !(init.body instanceof FormData)
  const token = getAccessToken()

  const response = await fetch(url, {
    ...init,
    headers: buildHeaders(init.headers, {
      json: hasJsonBody && method !== 'GET' && method !== 'HEAD',
      token,
    }),
  })

  if (response.status !== 401) {
    return response
  }

  // Attempt a single refresh when we have a refresh token.
  if (retry && getRefreshToken()) {
    try {
      const nextToken = await refreshAccessToken()
      const retryResponse = await fetch(url, {
        ...init,
        headers: buildHeaders(init.headers, {
          json: hasJsonBody && method !== 'GET' && method !== 'HEAD',
          token: nextToken,
        }),
      })
      if (retryResponse.status !== 401) {
        return retryResponse
      }
    } catch {
      // Refresh failed; fall through to session clear.
    }
  }

  await handleUnauthorized()
  throw await responseError(response)
}

export async function generate(description) {
  const response = await apiFetch('/generate', {
    method: 'POST',
    body: JSON.stringify({ description }),
  })
  if (!response.ok) {
    throw await responseError(response)
  }
  return response.json()
}

// Validate a human-reviewed manifest before previewing or saving it.
export async function validateScreen(manifest) {
  const response = await apiFetch('/validate', {
    method: 'POST',
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
  const response = await apiFetch('/screens', {
    method: 'POST',
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
  const response = await apiFetch(
    `/screens/${encodeURIComponent(agentId)}${query}`,
  )
  if (!response.ok) {
    throw await responseError(response)
  }
  return response.json()
}

async function writeDraft(agentId, method, {
  manifest,
  approvedManifest,
  description,
  name,
  source = 'llm',
  presentation,
  editorState,
}) {
  const response = await apiFetch(
    `/screens/${encodeURIComponent(agentId)}/draft`,
    {
      method,
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

// Create the first mutable draft. The backend refuses an existing agent ID.
export async function createDraft(agentId, payload) {
  return writeDraft(agentId, 'POST', payload)
}

// Update the one mutable editor draft. This never creates a published version.
export async function saveDraft(agentId, payload) {
  return writeDraft(agentId, 'PUT', payload)
}

export async function loadDraft(agentId) {
  const response = await apiFetch(
    `/screens/${encodeURIComponent(agentId)}/draft`,
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
  const response = await apiFetch(
    `/screens/${encodeURIComponent(agentId)}/publish`,
    {
      method: 'POST',
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
  const response = await apiFetch('/screens')
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
  const response = await apiFetch(
    `/screens/${encodeURIComponent(agentId)}/versions`,
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
  const response = await apiFetch(
    `/screens/${encodeURIComponent(agentId)}/duplicate`,
    {
      method: 'POST',
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
  const response = await apiFetch(
    `/screens/${encodeURIComponent(agentId)}/versions/${version}/restore`,
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
  const response = await apiFetch(
    `/screens/${encodeURIComponent(agentId)}/archive`,
    {
      method: 'PATCH',
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

export async function createAgentProject({
  name,
  description,
  presentation,
  scorecard,
  runtime,
  endpoints,
}) {
  const response = await apiFetch('/agents', {
    method: 'POST',
    body: JSON.stringify({
      name,
      description,
      presentation,
      ...(scorecard ? { scorecard } : {}),
      ...(runtime ? { runtime } : {}),
      ...(endpoints ? { endpoints } : {}),
    }),
  })
  if (!response.ok) throw await responseError(response)
  return response.json()
}

export async function listAgents() {
  const response = await apiFetch('/agents')
  if (!response.ok) throw await responseError(response)
  const result = await response.json()
  if (!Array.isArray(result?.agents)) {
    throw new Error('Backend returned an invalid agent-library response.')
  }
  return result.agents
}

export async function loadAgentProject(agentId) {
  const response = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}`,
  )
  if (!response.ok) throw await responseError(response)
  const result = await response.json()
  if (result?.agent_id !== agentId || !Array.isArray(result?.screens)) {
    throw new Error('Backend returned an invalid agent-project response.')
  }
  return result
}

export async function saveAgentProject(agentId, payload) {
  const response = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}/draft`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
  )
  if (!response.ok) throw await responseError(response)
  return response.json()
}

export async function updateAgentScorecard(agentId, scorecard) {
  const response = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}/scorecard`,
    {
      method: 'PUT',
      body: JSON.stringify({ scorecard }),
    },
  )
  if (!response.ok) throw await responseError(response)
  return response.json()
}

export async function updateAgentRuntime(agentId, runtime) {
  const response = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}/runtime`,
    {
      method: 'PUT',
      body: JSON.stringify({ runtime }),
    },
  )
  if (!response.ok) throw await responseError(response)
  return response.json()
}

export async function updateAgentEndpoints(agentId, endpoints) {
  const response = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}/endpoints`,
    {
      method: 'PUT',
      body: JSON.stringify({ endpoints }),
    },
  )
  if (!response.ok) throw await responseError(response)
  return response.json()
}

export async function generateScreenPlan(agentId, description = '') {
  const response = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}/screen-plan/generate`,
    {
      method: 'POST',
      body: JSON.stringify({ description }),
    },
  )
  if (!response.ok) throw await responseError(response)
  const result = await response.json()
  if (!Array.isArray(result?.screens)) {
    throw new Error('Backend returned an invalid screen plan.')
  }
  return result
}

export async function generateProjectScreen(agentId, payload) {
  const response = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}/screens/generate`,
    {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        ...(payload.screenId ? { screen_id: payload.screenId } : {}),
      }),
    },
  )
  if (!response.ok) throw await responseError(response)
  const result = await response.json()
  if (!result?.screen_id || !result?.manifest || !result?.screen_type) {
    throw new Error('Backend returned an invalid generated screen.')
  }
  return result
}

async function writeProjectScreenDraft(
  agentId,
  screenId,
  method,
  payload,
) {
  const response = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}/screens/${encodeURIComponent(screenId)}/draft`,
    {
      method,
      body: JSON.stringify({
        screen_type: payload.screenType,
        purpose: payload.purpose,
        manifest: payload.manifest,
        ...(payload.approvedManifest
          ? { approved_manifest: payload.approvedManifest }
          : {}),
        description: payload.description,
        name: payload.name,
        source: payload.source ?? 'llm',
        presentation: payload.presentation,
        editor_state: payload.editorState ?? {},
        generation: payload.generation ?? {},
      }),
    },
  )
  if (!response.ok) throw await responseError(response)
  const result = await response.json()
  if (result?.status !== 'draft' || !result?.revision) {
    throw new Error('Backend returned an invalid project-screen draft.')
  }
  return result
}

export function createProjectScreenDraft(agentId, screenId, payload) {
  return writeProjectScreenDraft(agentId, screenId, 'POST', payload)
}

export function saveProjectScreenDraft(agentId, screenId, payload) {
  return writeProjectScreenDraft(agentId, screenId, 'PUT', payload)
}

export async function loadProjectScreenDraft(agentId, screenId) {
  const response = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}/screens/${encodeURIComponent(screenId)}/draft`,
  )
  if (!response.ok) throw await responseError(response)
  const result = await response.json()
  if (result?.status !== 'draft' || !result?.draft_manifest) {
    throw new Error('Backend returned an invalid project-screen draft.')
  }
  return result
}

export async function duplicateProjectScreen(agentId, screenId, name) {
  const response = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}/screens/${encodeURIComponent(screenId)}/duplicate`,
    {
      method: 'POST',
      body: JSON.stringify({ name }),
    },
  )
  if (!response.ok) throw await responseError(response)
  return response.json()
}

export async function setProjectScreenArchived(
  agentId,
  screenId,
  archived,
) {
  const response = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}/screens/${encodeURIComponent(screenId)}/archive`,
    {
      method: 'PATCH',
      body: JSON.stringify({ archived }),
    },
  )
  if (!response.ok) throw await responseError(response)
  return response.json()
}

export async function publishAgentProject(
  agentId,
  { projectRevision, screenRevisions, changeSummary },
) {
  const response = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}/publish`,
    {
      method: 'POST',
      body: JSON.stringify({
        project_revision: projectRevision,
        screen_revisions: screenRevisions,
        change_summary: changeSummary,
      }),
    },
  )
  if (!response.ok) throw await responseError(response)
  return response.json()
}

export async function listAgentReleases(agentId) {
  const response = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}/releases`,
  )
  if (!response.ok) throw await responseError(response)
  const result = await response.json()
  if (!Array.isArray(result?.releases)) {
    throw new Error('Backend returned invalid release history.')
  }
  return result.releases
}

export async function loadAgentRelease(agentId, version = null) {
  const query = Number.isInteger(version) ? `?version=${version}` : ''
  const response = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}/published${query}`,
  )
  if (!response.ok) throw await responseError(response)
  const result = await response.json()
  if (!Array.isArray(result?.screens) || !Number.isInteger(result?.version)) {
    throw new Error('Backend returned an invalid agent release.')
  }
  return result
}

export async function runPublishedAgent(agentId, { valuesByScreen, version = null }) {
  const response = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}/published/run`,
    {
      method: 'POST',
      body: JSON.stringify({
        values_by_screen: valuesByScreen,
        ...(Number.isInteger(version) ? { version } : {}),
      }),
    },
  )
  if (!response.ok) throw await responseError(response)
  return response.json()
}

export async function downloadAgentFrontend(agentId, version) {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('A published release version is required for download.')
  }
  const response = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}/releases/${version}/export`,
  )
  if (!response.ok) throw await responseError(response)
  const archive = await response.blob()
  if (!archive.size) {
    throw new Error('Backend returned an empty frontend archive.')
  }
  return archive
}

export async function restoreAgentRelease(agentId, version) {
  const response = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}/releases/${version}/restore`,
    { method: 'POST' },
  )
  if (!response.ok) throw await responseError(response)
  return response.json()
}

export async function setAgentArchived(agentId, archived) {
  const response = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}/archive`,
    {
      method: 'PATCH',
      body: JSON.stringify({ archived }),
    },
  )
  if (!response.ok) throw await responseError(response)
  return response.json()
}

export async function duplicateAgentProject(agentId, name) {
  const response = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}/duplicate`,
    {
      method: 'POST',
      body: JSON.stringify({ name }),
    },
  )
  if (!response.ok) throw await responseError(response)
  return response.json()
}
