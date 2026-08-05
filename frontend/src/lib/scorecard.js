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

export function scorecardSummary(scorecard) {
  if (!scorecard) return null
  const fields = scorecardInputFields(scorecard)
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
        }
      : null,
  }
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
