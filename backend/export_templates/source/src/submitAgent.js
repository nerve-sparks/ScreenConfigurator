/**
 * Integration hook for the exported frontend.
 *
 * When the published release includes a scorecard connection.url, collected
 * answers are POSTed (or PUT/PATCH) there using the scorecard input_schema
 * mapping. Without a URL, values stay local.
 */

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

function buildPayload(scorecard, valuesByScreen) {
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
  return payload
}

export async function submitAgent({
  agentId,
  releaseVersion,
  valuesByScreen,
  scorecard,
}) {
  const connection = scorecard?.connection || {}
  const url = typeof connection.url === 'string' ? connection.url.trim() : ''
  const method = (connection.method || 'POST').toUpperCase()
  const payload = buildPayload(scorecard, valuesByScreen)

  if (!url) {
    return {
      status: 'local',
      agentId,
      releaseVersion,
      valuesByScreen,
      payload,
    }
  }

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Screen-Studio-Agent-Id': agentId,
      'X-Screen-Studio-Release': String(releaseVersion),
    },
    body: JSON.stringify(payload),
  })

  const contentType = response.headers.get('content-type') || ''
  let agentResponse
  if (contentType.includes('application/json')) {
    agentResponse = await response.json()
  } else {
    agentResponse = await response.text()
  }

  if (!response.ok) {
    const detail = typeof agentResponse === 'string'
      ? agentResponse
      : JSON.stringify(agentResponse)
    throw new Error(`Agent request failed (${response.status}): ${detail}`)
  }

  return {
    status: 'submitted',
    agentId,
    releaseVersion,
    payload,
    agentResponse,
  }
}
