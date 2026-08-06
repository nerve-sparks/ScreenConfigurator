/**
 * Agent backend client for the exported frontend.
 *
 * Uses scorecard.connection.url from agent-release.json. API keys are never
 * bundled — set VITE_AGENT_API_KEY in `.env` when the agent requires auth.
 */

const DATA_URL_RE =
  /^data:(?<mime>[\w/+.-]+)(?:;charset=[\w-]+)?;base64,(?<data>.+)$/i

function flattenValues(valuesByScreen) {
  const flat = {}
  if (!valuesByScreen || typeof valuesByScreen !== 'object') return flat
  for (const screenValues of Object.values(valuesByScreen)) {
    if (screenValues && typeof screenValues === 'object') {
      Object.assign(flat, screenValues)
    }
  }
  return flat
}

export function buildAgentPayload(scorecard, valuesByScreen) {
  const flat = flattenValues(valuesByScreen)
  const properties = scorecard?.input_schema?.properties
  if (!properties || typeof properties !== 'object') {
    return { values_by_screen: valuesByScreen, flat_values: flat }
  }

  const payload = {}
  for (const name of Object.keys(properties)) {
    if (Object.hasOwn(flat, name)) payload[name] = flat[name]
  }

  if (Object.hasOwn(properties, 'input') && !Object.hasOwn(payload, 'input')) {
    const values = Object.values(flat)
    if (values.length === 1) payload.input = values[0]
    else if (values.length > 0) payload.input = JSON.stringify(flat)
  }

  // Optional agent-builder extras collected on screens.
  for (const key of ['thread_id', 'human_input']) {
    if (Object.hasOwn(flat, key) && !Object.hasOwn(payload, key)) {
      payload[key] = flat[key]
    }
  }

  return payload
}

function connectionFromScorecard(scorecard) {
  const connection = scorecard?.connection && typeof scorecard.connection === 'object'
    ? scorecard.connection
    : {}
  const url = typeof connection.url === 'string' ? connection.url.trim() : ''
  const method = (connection.method || 'POST').toUpperCase()
  let bodyFormat = String(connection.body_format || '').toLowerCase()
  if (bodyFormat.includes('multipart') || bodyFormat === 'form' || bodyFormat === 'form-data') {
    bodyFormat = 'multipart'
  } else if (bodyFormat.includes('json') || bodyFormat === 'application/json') {
    bodyFormat = 'json'
  } else if (url.includes('agent-builder.nervesparks.com') && url.includes('/pipeline')) {
    bodyFormat = 'multipart'
  } else {
    bodyFormat = 'json'
  }

  return {
    url,
    method,
    bodyFormat,
    authHeader: connection.auth_header || 'Authorization',
    authScheme: connection.auth_scheme == null ? 'Bearer' : connection.auth_scheme,
    hasApiKey: Boolean(connection.has_api_key),
    timeoutMs: Number(connection.timeout_ms) > 0 ? Number(connection.timeout_ms) : 30000,
  }
}

function resolveApiKey() {
  const raw = import.meta.env?.VITE_AGENT_API_KEY
  return typeof raw === 'string' ? raw.trim() : ''
}

function authHeaderValue(apiKey, authScheme) {
  if (!apiKey) return ''
  const lowered = apiKey.toLowerCase()
  if (lowered.startsWith('bearer ') || lowered.startsWith('token ')) return apiKey
  if (authScheme) return `${authScheme} ${apiKey}`
  return apiKey
}

function scalarFormValue(value) {
  if (value == null) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function appendDataUrlFile(form, key, value) {
  const match = DATA_URL_RE.exec(value.trim())
  if (!match?.groups) return false
  const mime = match.groups.mime || 'application/octet-stream'
  const binary = atob(match.groups.data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  const ext = mime.includes('/') ? mime.split('/').pop() : 'bin'
  form.append(key, new Blob([bytes], { type: mime }), `${key}.${ext}`)
  return true
}

function toMultipartBody(payload) {
  const form = new FormData()
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string' && appendDataUrlFile(form, key, value)) continue
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === 'string' && appendDataUrlFile(form, key, item)) return
        form.append(key, scalarFormValue(item))
      })
      continue
    }
    form.append(key, scalarFormValue(value))
  }
  if (![...form.keys()].length) form.append('_', '')
  return form
}

async function readResponseBody(response) {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return response.json()
  }
  return response.text()
}

/**
 * Submit collected screen values to the agent backend URL.
 */
export async function runAgent({
  agentId,
  releaseVersion,
  valuesByScreen,
  scorecard,
}) {
  const connection = connectionFromScorecard(scorecard)
  const payload = buildAgentPayload(scorecard, valuesByScreen)

  if (!connection.url) {
    return {
      status: 'local',
      message: 'No connection.url on the scorecard. Values were kept locally.',
      agentId,
      releaseVersion,
      payload,
      agentResponse: null,
    }
  }

  const headers = {
    Accept: 'application/json',
    'X-Screen-Studio-Agent-Id': agentId,
    'X-Screen-Studio-Release': String(releaseVersion),
  }
  const runtimeId = scorecard?.agent_id || scorecard?.node_id
  if (runtimeId) headers['X-Runtime-Agent-Id'] = String(runtimeId)

  const apiKey = resolveApiKey()
  const authValue = authHeaderValue(apiKey, connection.authScheme)
  if (authValue) headers[connection.authHeader] = authValue

  const controller = new AbortController()
  const timeout = window.setTimeout(
    () => controller.abort(),
    Math.min(Math.max(connection.timeoutMs, 1000), 120000),
  )

  let response
  try {
    const init = {
      method: connection.method,
      headers,
      signal: controller.signal,
    }
    if (connection.bodyFormat === 'multipart') {
      init.body = toMultipartBody(payload)
    } else {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(payload)
    }
    response = await fetch(connection.url, init)
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('The agent request timed out.')
    }
    throw new Error(
      `Could not reach the agent connection URL (${connection.url}).`,
    )
  } finally {
    window.clearTimeout(timeout)
  }

  const agentResponse = await readResponseBody(response)
  if (!response.ok) {
    const detail = typeof agentResponse === 'string'
      ? agentResponse
      : JSON.stringify(agentResponse)
    const authHint = response.status === 401 && !apiKey
      ? ' Set VITE_AGENT_API_KEY in .env to a Bearer JWT if the agent requires auth.'
      : ''
    throw new Error(`Agent request failed (${response.status}): ${detail}.${authHint}`)
  }

  return {
    status: 'submitted',
    message: 'Collected inputs were sent to the agent connection URL.',
    agentId,
    releaseVersion,
    requestUrl: connection.url,
    requestMethod: connection.method,
    bodyFormat: connection.bodyFormat,
    authApplied: Boolean(authValue),
    payload,
    agentStatus: response.status,
    agentResponse,
  }
}

/** @deprecated Use runAgent — kept for older customizations. */
export async function submitAgent(options) {
  return runAgent(options)
}
