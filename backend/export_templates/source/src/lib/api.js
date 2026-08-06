/**
 * Agent backend client for the exported frontend.
 *
 * Uses release.runtime + release.endpoints (with legacy scorecard fallback).
 * Secrets are never bundled — set VITE_AGENT_API_KEY when auth is required.
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

export function buildAgentPayload(inputSchema, valuesByScreen) {
  const flat = flattenValues(valuesByScreen)
  const properties = inputSchema?.properties
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

  for (const key of ['thread_id', 'human_input']) {
    if (Object.hasOwn(flat, key) && !Object.hasOwn(payload, key)) {
      payload[key] = flat[key]
    }
  }

  return payload
}

function defaultRuntime() {
  return {
    auth: {
      type: 'bearer',
      header_name: 'Authorization',
      scheme: 'Bearer',
      query_param: 'api_key',
      has_secret: false,
    },
    defaults: {
      base_url: '',
      timeout_ms: 30000,
      body_format: 'auto',
    },
  }
}

function migrateFromScorecard(scorecard) {
  const runtime = defaultRuntime()
  const connection = scorecard?.connection && typeof scorecard.connection === 'object'
    ? scorecard.connection
    : {}
  const url = typeof connection.url === 'string' ? connection.url.trim() : ''
  if (connection.body_format) {
    const format = String(connection.body_format).toLowerCase()
    runtime.defaults.body_format = format.includes('multipart') ? 'multipart'
      : format.includes('json') ? 'json'
        : 'auto'
  }
  if (connection.timeout_ms > 0) runtime.defaults.timeout_ms = connection.timeout_ms
  runtime.auth.has_secret = Boolean(connection.has_api_key)
  const endpoints = []
  if (url || scorecard?.input_schema) {
    endpoints.push({
      id: scorecard?.agent_id || 'primary',
      name: scorecard?.name || 'Primary endpoint',
      url,
      method: (connection.method || 'POST').toUpperCase(),
      body_format: runtime.defaults.body_format,
      input_schema: scorecard?.input_schema || {},
      enabled: true,
    })
  }
  return { runtime, endpoints }
}

function releaseConfig(release) {
  const hasRuntime = release?.runtime && typeof release.runtime === 'object'
  const hasEndpoints = Array.isArray(release?.endpoints)
  if (hasRuntime || hasEndpoints) {
    return {
      runtime: {
        ...defaultRuntime(),
        ...release.runtime,
        auth: { ...defaultRuntime().auth, ...(release.runtime?.auth || {}) },
        defaults: {
          ...defaultRuntime().defaults,
          ...(release.runtime?.defaults || {}),
        },
      },
      endpoints: Array.isArray(release.endpoints) ? release.endpoints : [],
    }
  }
  return migrateFromScorecard(release?.scorecard || {})
}

function resolveApiKey() {
  const raw = import.meta.env?.VITE_AGENT_API_KEY
  return typeof raw === 'string' ? raw.trim() : ''
}

function resolveUrl(runtime, endpoint) {
  const url = typeof endpoint.url === 'string' ? endpoint.url.trim() : ''
  if (!url) return ''
  try {
    return new URL(url).toString()
  } catch {
    const base = runtime?.defaults?.base_url || ''
    if (!base) return url
    return `${base.replace(/\/$/, '')}/${url.replace(/^\//, '')}`
  }
}

function applyAuth(runtime, url) {
  const auth = runtime?.auth || {}
  const type = (auth.type || 'bearer').toLowerCase()
  const secret = resolveApiKey()
  const headers = {}
  let nextUrl = url

  if (type === 'none') {
    return { url: nextUrl, headers, authApplied: false }
  }

  if (type === 'api_key_query') {
    if (!secret) return { url: nextUrl, headers, authApplied: false }
    const parsed = new URL(nextUrl)
    parsed.searchParams.set(auth.query_param || 'api_key', secret)
    return { url: parsed.toString(), headers, authApplied: true }
  }

  if (type === 'api_key_header') {
    if (!secret) return { url: nextUrl, headers, authApplied: false }
    headers[auth.header_name || 'X-API-Key'] = secret
    return { url: nextUrl, headers, authApplied: true }
  }

  // bearer
  if (!secret) return { url: nextUrl, headers, authApplied: false }
  const lowered = secret.toLowerCase()
  const value = lowered.startsWith('bearer ') || lowered.startsWith('token ')
    ? secret
    : (auth.scheme ? `${auth.scheme} ${secret}` : secret)
  headers[auth.header_name || 'Authorization'] = value
  return { url: nextUrl, headers, authApplied: true }
}

function resolveBodyFormat(endpoint, url, runtime) {
  const raw = String(endpoint.body_format || runtime?.defaults?.body_format || 'auto').toLowerCase()
  if (raw.includes('multipart')) return 'multipart'
  if (raw.includes('json')) return 'json'
  if (url.includes('agent-builder.nervesparks.com') && url.includes('/pipeline')) {
    return 'multipart'
  }
  return 'json'
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
      value.forEach((item) => {
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
  if (contentType.includes('application/json')) return response.json()
  return response.text()
}

async function callEndpoint({
  runtime,
  endpoint,
  valuesByScreen,
  agentId,
  releaseVersion,
}) {
  const resolved = resolveUrl(runtime, endpoint)
  if (!resolved) {
    throw new Error(`Endpoint '${endpoint.id || endpoint.name}' has no URL.`)
  }
  const { url, headers: authHeaders, authApplied } = applyAuth(runtime, resolved)
  const method = (endpoint.method || 'POST').toUpperCase()
  const payload = buildAgentPayload(endpoint.input_schema || {}, valuesByScreen)
  const bodyFormat = resolveBodyFormat(endpoint, url, runtime)
  const headers = {
    Accept: 'application/json',
    'X-Screen-Studio-Agent-Id': agentId,
    'X-Screen-Studio-Release': String(releaseVersion),
    'X-Screen-Studio-Endpoint': String(endpoint.id || ''),
    ...authHeaders,
  }

  const controller = new AbortController()
  const timeoutMs = Math.min(
    Math.max(Number(runtime?.defaults?.timeout_ms) || 30000, 1000),
    120000,
  )
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)

  let response
  try {
    const init = { method, headers, signal: controller.signal }
    if (method === 'GET') {
      const parsed = new URL(url)
      for (const [key, value] of Object.entries(payload)) {
        parsed.searchParams.set(key, scalarFormValue(value))
      }
      response = await fetch(parsed.toString(), init)
    } else if (bodyFormat === 'multipart') {
      init.body = toMultipartBody(payload)
      response = await fetch(url, init)
    } else {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(payload)
      response = await fetch(url, init)
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Endpoint '${endpoint.id}' timed out.`)
    }
    throw new Error(`Could not reach endpoint '${endpoint.id}' (${url}).`)
  } finally {
    window.clearTimeout(timeout)
  }

  const agentResponse = await readResponseBody(response)
  if (!response.ok) {
    const detail = typeof agentResponse === 'string'
      ? agentResponse
      : JSON.stringify(agentResponse)
    const authHint = response.status === 401 && !resolveApiKey()
      ? ' Set VITE_AGENT_API_KEY in .env if the agent requires auth.'
      : ''
    throw new Error(
      `Endpoint '${endpoint.id}' failed (${response.status}): ${detail}.${authHint}`,
    )
  }

  return {
    endpoint_id: endpoint.id,
    endpoint_name: endpoint.name,
    request_url: url,
    request_method: method,
    body_format: bodyFormat,
    auth_applied: authApplied,
    payload,
    agent_status: response.status,
    agent_response: agentResponse,
  }
}

/**
 * Submit collected screen values to every enabled endpoint in order.
 */
export async function runAgent({
  agentId,
  releaseVersion,
  valuesByScreen,
  scorecard,
  runtime,
  endpoints,
  release,
}) {
  const config = releaseConfig(
    release || { scorecard, runtime, endpoints },
  )
  const enabled = (config.endpoints || []).filter(
    (item) => item && item.enabled !== false && String(item.url || '').trim(),
  )

  if (!enabled.length) {
    return {
      status: 'local',
      message: 'No enabled endpoints with URLs. Values were kept locally.',
      agentId,
      releaseVersion,
      results: [],
      agentResponse: null,
    }
  }

  const results = []
  for (const endpoint of enabled) {
    const result = await callEndpoint({
      runtime: config.runtime,
      endpoint,
      valuesByScreen,
      agentId,
      releaseVersion,
    })
    results.push(result)
  }

  const last = results[results.length - 1]
  return {
    status: 'submitted',
    message: `Collected inputs were sent to ${results.length} endpoint(s).`,
    agentId,
    releaseVersion,
    results,
    requestUrl: last?.request_url,
    requestMethod: last?.request_method,
    payload: last?.payload,
    agentStatus: last?.agent_status,
    agentResponse: last?.agent_response,
  }
}

/** @deprecated Use runAgent */
export async function submitAgent(options) {
  return runAgent(options)
}
