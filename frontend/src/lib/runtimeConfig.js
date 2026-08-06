/**
 * Project runtime auth + endpoint catalog helpers (Studio + publish).
 */

import {
  normalizeScorecard,
  parseScorecardText,
  scorecardInputFields,
  scorecardTextWithoutSecrets,
} from './scorecard.js'

export const AUTH_TYPES = [
  { value: 'none', label: 'None' },
  { value: 'bearer', label: 'Bearer token (Authorization header)' },
  { value: 'api_key_header', label: 'API key header' },
  { value: 'api_key_query', label: 'API key query parameter' },
]

export const BODY_FORMATS = [
  { value: 'auto', label: 'Auto' },
  { value: 'json', label: 'JSON' },
  { value: 'multipart', label: 'Multipart form' },
]

export function defaultRuntime() {
  return {
    auth: {
      type: 'bearer',
      header_name: 'Authorization',
      scheme: 'Bearer',
      query_param: 'api_key',
      secret: '',
      has_secret: false,
    },
    defaults: {
      base_url: '',
      timeout_ms: 30000,
      body_format: 'auto',
    },
  }
}

export function emptyEndpoint(index = 0) {
  return {
    id: `endpoint-${index + 1}`,
    name: index === 0 ? 'Primary endpoint' : `Endpoint ${index + 1}`,
    url: '',
    method: 'POST',
    body_format: 'auto',
    input_schema: {},
    output_schema: {},
    enabled: true,
  }
}

export function normalizeRuntime(raw, { secret = '' } = {}) {
  const base = defaultRuntime()
  if (!raw || typeof raw !== 'object') {
    if (secret) base.auth.secret = secret
    return base
  }
  const auth = raw.auth && typeof raw.auth === 'object' ? raw.auth : {}
  const defaults = raw.defaults && typeof raw.defaults === 'object' ? raw.defaults : {}
  let type = typeof auth.type === 'string' ? auth.type.trim().toLowerCase() : 'bearer'
  if (!AUTH_TYPES.some((item) => item.value === type)) type = 'bearer'
  const nextSecret = typeof secret === 'string' && secret.trim()
    ? secret.trim()
    : (typeof auth.secret === 'string' ? auth.secret.trim() : '')
  return {
    auth: {
      type,
      header_name: (auth.header_name || 'Authorization').trim() || 'Authorization',
      scheme: auth.scheme == null ? 'Bearer' : String(auth.scheme),
      query_param: (auth.query_param || 'api_key').trim() || 'api_key',
      secret: nextSecret,
      has_secret: Boolean(auth.has_secret) || Boolean(nextSecret),
    },
    defaults: {
      base_url: typeof defaults.base_url === 'string' ? defaults.base_url.trim() : '',
      timeout_ms: Number.isInteger(defaults.timeout_ms) && defaults.timeout_ms > 0
        ? defaults.timeout_ms
        : 30000,
      body_format: ['auto', 'json', 'multipart'].includes(defaults.body_format)
        ? defaults.body_format
        : 'auto',
    },
  }
}

export function normalizeEndpoints(raw) {
  if (!Array.isArray(raw)) return []
  return raw.map((item, index) => {
    const source = item && typeof item === 'object' ? item : {}
    const id = typeof source.id === 'string' && source.id.trim()
      ? source.id.trim()
      : `endpoint-${index + 1}`
    return {
      id,
      name: typeof source.name === 'string' && source.name.trim()
        ? source.name.trim()
        : `Endpoint ${index + 1}`,
      url: typeof source.url === 'string' ? source.url.trim() : '',
      method: typeof source.method === 'string' && source.method.trim()
        ? source.method.trim().toUpperCase()
        : 'POST',
      body_format: ['auto', 'json', 'multipart'].includes(source.body_format)
        ? source.body_format
        : 'auto',
      input_schema: source.input_schema && typeof source.input_schema === 'object'
        ? source.input_schema
        : {},
      output_schema: source.output_schema && typeof source.output_schema === 'object'
        ? source.output_schema
        : {},
      enabled: source.enabled !== false,
    }
  })
}

/** Migrate legacy scorecard.connection into runtime + endpoints. */
export function migrateFromScorecard(scorecard) {
  const runtime = defaultRuntime()
  if (!scorecard || typeof scorecard !== 'object') {
    return { runtime, endpoints: [] }
  }
  const connection = scorecard.connection && typeof scorecard.connection === 'object'
    ? scorecard.connection
    : {}
  const secret = [
    connection.api_key,
    connection.authorization,
    connection.token,
    connection.access_token,
  ].find((value) => typeof value === 'string' && value.trim())
  runtime.auth.secret = secret ? String(secret).trim() : ''
  runtime.auth.has_secret = Boolean(runtime.auth.secret || connection.has_api_key)
  runtime.auth.header_name = connection.auth_header || 'Authorization'
  runtime.auth.scheme = connection.auth_scheme == null ? 'Bearer' : connection.auth_scheme
  if (connection.timeout_ms > 0) runtime.defaults.timeout_ms = connection.timeout_ms
  if (connection.body_format) {
    const format = String(connection.body_format).toLowerCase()
    runtime.defaults.body_format = format.includes('multipart') ? 'multipart'
      : format.includes('json') ? 'json'
        : 'auto'
  }

  const url = typeof connection.url === 'string' ? connection.url.trim() : ''
  const hasSchema = scorecard.input_schema && typeof scorecard.input_schema === 'object'
  const endpoints = []
  if (url || hasSchema) {
    endpoints.push({
      id: typeof scorecard.agent_id === 'string' && scorecard.agent_id.trim()
        ? scorecard.agent_id.trim()
        : 'primary',
      name: typeof scorecard.name === 'string' && scorecard.name.trim()
        ? scorecard.name.trim()
        : 'Primary endpoint',
      url,
      method: (connection.method || 'POST').toUpperCase(),
      body_format: runtime.defaults.body_format,
      input_schema: hasSchema ? scorecard.input_schema : {},
      output_schema: scorecard.output_schema && typeof scorecard.output_schema === 'object'
        ? scorecard.output_schema
        : {},
      enabled: true,
    })
  }
  return { runtime, endpoints }
}

export function hydrateProjectConfig(project) {
  if (!project) {
    return { runtime: defaultRuntime(), endpoints: [], scorecard: null }
  }
  const hasRuntime = project.runtime && typeof project.runtime === 'object'
  const hasEndpoints = Array.isArray(project.endpoints)
  if (hasRuntime || hasEndpoints) {
    return {
      runtime: normalizeRuntime(project.runtime),
      endpoints: normalizeEndpoints(project.endpoints),
      scorecard: project.scorecard || null,
    }
  }
  const migrated = migrateFromScorecard(project.scorecard)
  return {
    ...migrated,
    scorecard: project.scorecard || null,
  }
}

export function endpointFromScorecardText(text, index = 0) {
  const parsed = parseScorecardText(text)
  const migrated = migrateFromScorecard(parsed)
  const endpoint = migrated.endpoints[0] || emptyEndpoint(index)
  return {
    endpoint,
    runtimePatch: {
      secret: migrated.runtime.auth.secret,
      header_name: migrated.runtime.auth.header_name,
      scheme: migrated.runtime.auth.scheme,
      timeout_ms: migrated.runtime.defaults.timeout_ms,
      body_format: migrated.runtime.defaults.body_format,
    },
    scorecard: parsed,
  }
}

export function runtimeSummary(runtime, endpoints, secret = '') {
  const normalized = normalizeRuntime(runtime, { secret })
  const list = normalizeEndpoints(endpoints)
  const enabled = list.filter((item) => item.enabled !== false)
  const fields = enabled.flatMap((item) => scorecardInputFields({
    input_schema: item.input_schema,
  }))
  return {
    authType: normalized.auth.type,
    hasSecret: Boolean(normalized.auth.secret || normalized.auth.has_secret),
    baseUrl: normalized.defaults.base_url,
    endpointCount: enabled.length,
    urls: enabled.map((item) => item.url).filter(Boolean),
    fieldCount: fields.length,
    fields,
  }
}

export function scorecardPasteWithoutSecrets(text) {
  try {
    const parsed = normalizeScorecard(JSON.parse(text))
    return scorecardTextWithoutSecrets(parsed)
  } catch {
    return text
  }
}

/** Payload for PUT /runtime — omit empty secret to preserve server secret. */
export function runtimeForSave(runtime, secret, { preserveEmptySecret = true } = {}) {
  const normalized = normalizeRuntime(runtime, { secret })
  const payload = {
    auth: {
      type: normalized.auth.type,
      header_name: normalized.auth.header_name,
      scheme: normalized.auth.scheme,
      query_param: normalized.auth.query_param,
    },
    defaults: {
      base_url: normalized.defaults.base_url,
      timeout_ms: normalized.defaults.timeout_ms,
      body_format: normalized.defaults.body_format,
    },
  }
  if (normalized.auth.secret) {
    payload.auth.secret = normalized.auth.secret
  } else if (!preserveEmptySecret) {
    payload.auth.secret = ''
  }
  return payload
}
