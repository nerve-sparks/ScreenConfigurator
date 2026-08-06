/**
 * Parse and summarize agent scorecard JSON attached at create time.
 * Scorecards map published screens onto an existing agent runtime contract.
 */

export function parseScorecardText(text) {
  const trimmed = typeof text === 'string' ? text.trim() : ''
  if (!trimmed) {
    throw new Error('Scorecard JSON is empty.')
  }
  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error('Scorecard must be valid JSON.')
  }
  return normalizeScorecard(parsed)
}

export function normalizeScorecard(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Scorecard must be a JSON object.')
  }

  const allowed = [
    'sla',
    'name',
    'intent',
    'status',
    'node_id',
    'version',
    'agent_id',
    'metadata',
    'node_type',
    'connection',
    'checkpoints',
    'capabilities',
    'error_schema',
    'input_schema',
    'output_schema',
    'owner_orchestrator',
  ]
  const cleaned = {}
  for (const key of allowed) {
    if (Object.hasOwn(raw, key)) cleaned[key] = raw[key]
  }
  if (Object.keys(cleaned).length === 0) {
    throw new Error(
      'Unrecognized scorecard. Include name, agent_id, input_schema, or connection.',
    )
  }
  if (cleaned.name != null && (typeof cleaned.name !== 'string' || !cleaned.name.trim())) {
    throw new Error('Scorecard name must be a non-empty string when present.')
  }
  if (cleaned.input_schema != null && typeof cleaned.input_schema !== 'object') {
    throw new Error('Scorecard input_schema must be an object.')
  }
  return cleaned
}

export function scorecardInputFields(scorecard) {
  const properties = scorecard?.input_schema?.properties
  if (!properties || typeof properties !== 'object') return []
  const required = new Set(
    Array.isArray(scorecard.input_schema?.required)
      ? scorecard.input_schema.required
      : [],
  )
  return Object.entries(properties).map(([name, definition]) => ({
    name,
    type: definition?.type ?? 'string',
    title: definition?.title || name,
    description: definition?.description || '',
    required: required.has(name),
  }))
}

export function scorecardSummary(scorecard, apiKey = '') {
  if (!scorecard) return null
  const fields = scorecardInputFields(scorecard)
  const hasKeyFromCard = Boolean(
    scorecard.connection?.api_key
      || scorecard.connection?.authorization
      || scorecard.connection?.token
      || scorecard.connection?.has_api_key,
  )
  return {
    name: typeof scorecard.name === 'string' ? scorecard.name.trim() : '',
    runtimeId: scorecard.agent_id || scorecard.node_id || '',
    version: scorecard.version || '',
    capabilities: Array.isArray(scorecard.capabilities) ? scorecard.capabilities : [],
    fieldCount: fields.length,
    fields,
    connection: scorecard.connection && typeof scorecard.connection === 'object'
      ? {
          protocol: scorecard.connection.protocol || '',
          method: scorecard.connection.method || '',
          url: scorecard.connection.url || '',
          hasApiKey: hasKeyFromCard || Boolean(typeof apiKey === 'string' && apiKey.trim()),
        }
      : (typeof apiKey === 'string' && apiKey.trim()
        ? { protocol: '', method: '', url: '', hasApiKey: true }
        : null),
  }
}

/** Merge a separately entered API key / auth prefs into scorecard.connection. */
export function withConnectionApiKey(scorecard, apiKey, options = {}) {
  if (!scorecard || typeof scorecard !== 'object') return scorecard
  const key = typeof apiKey === 'string' ? apiKey.trim() : ''
  const authMode = options.authMode || 'api_key'
  const authScheme = options.authScheme != null ? options.authScheme : 'Bearer'
  const connection = {
    ...(scorecard.connection && typeof scorecard.connection === 'object'
      ? scorecard.connection
      : {}),
    auth_mode: authMode,
    auth_scheme: authScheme,
  }
  if (key) {
    connection.api_key = key
  } else if (authMode === 'session') {
    delete connection.api_key
  }
  return { ...scorecard, connection }
}

export function extractConnectionAuthMode(scorecard) {
  const mode = scorecard?.connection?.auth_mode
  if (mode === 'session' || mode === 'api_key_or_session' || mode === 'api_key') {
    return mode
  }
  return extractConnectionApiKey(scorecard) ? 'api_key' : 'session'
}

export function extractConnectionAuthScheme(scorecard) {
  const scheme = scorecard?.connection?.auth_scheme
  if (typeof scheme === 'string') return scheme
  return 'Bearer'
}

/** Scorecard JSON for the textarea — secrets stay in the dedicated key field. */
export function scorecardTextWithoutSecrets(scorecard) {
  if (!scorecard || typeof scorecard !== 'object') return ''
  const clone = structuredClone(scorecard)
  if (clone.connection && typeof clone.connection === 'object') {
    delete clone.connection.api_key
    delete clone.connection.token
    delete clone.connection.access_token
    delete clone.connection.bearer_token
    delete clone.connection.authorization
  }
  return JSON.stringify(clone, null, 2)
}

export function extractConnectionApiKey(scorecard) {
  if (!scorecard?.connection || typeof scorecard.connection !== 'object') return ''
  for (const key of ['api_key', 'token', 'access_token', 'bearer_token']) {
    const value = scorecard.connection[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

export function descriptionFromScorecard(scorecard, fallback = '') {
  if (!scorecard) return fallback
  const parts = []
  if (typeof scorecard.name === 'string' && scorecard.name.trim()) {
    parts.push(`${scorecard.name.trim()} agent.`)
  }
  const intent = scorecard.intent?.intent_desc
  if (typeof intent === 'string' && intent.trim()) {
    parts.push(intent.trim())
  }
  const fields = scorecardInputFields(scorecard)
  if (fields.length) {
    parts.push(
      `Collect these inputs for the agent run: ${fields
        .map((field) => field.name)
        .join(', ')}.`,
    )
  }
  const caps = Array.isArray(scorecard.capabilities) ? scorecard.capabilities : []
  if (caps.length) {
    parts.push(`Capabilities: ${caps.join(', ')}.`)
  }
  return parts.join(' ').trim() || fallback
}

export async function readScorecardFile(file) {
  if (!file) throw new Error('Choose a scorecard JSON file.')
  if (file.size > 200_000) throw new Error('Scorecard file is too large.')
  const text = await file.text()
  return parseScorecardText(text)
}
