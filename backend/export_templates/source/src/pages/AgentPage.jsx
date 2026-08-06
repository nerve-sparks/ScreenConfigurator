import { useState } from 'react'
import AgentFlow from '../components/AgentFlow.jsx'
import { AgentGlyph } from '../components/RuntimePrimitives.jsx'
import { runAgent } from '../lib/api.js'
import { loadAgentRelease } from '../lib/releaseLoader.js'
import { normalizePresentation, presentationStyle } from '../lib/presentation.js'

const release = loadAgentRelease()

function formatJson(value) {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function downloadResponses(valuesByScreen) {
  const payload = {
    agent_id: release.agent_id,
    release_version: release.version,
    values_by_screen: valuesByScreen,
  }
  const blob = new Blob(
    [`${JSON.stringify(payload, null, 2)}\n`],
    { type: 'application/json' },
  )
  let url = ''
  let link = null
  try {
    url = URL.createObjectURL(blob)
    link = document.createElement('a')
    link.href = url
    link.download = `${release.agent_id}-responses.json`
    link.hidden = true
    document.body.appendChild(link)
    link.click()
  } finally {
    link?.remove()
    if (url) URL.revokeObjectURL(url)
  }
}

export default function AgentPage() {
  const [submitted, setSubmitted] = useState(null)
  const [runResult, setRunResult] = useState(null)
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [flowKey, setFlowKey] = useState(0)
  const presentation = normalizePresentation(release.presentation, {
    name: release.name,
    description: release.description,
  })
  const endpoints = Array.isArray(release.endpoints) ? release.endpoints : []
  const enabledUrls = endpoints
    .filter((item) => item?.enabled !== false && item?.url)
    .map((item) => item.url)
  const connectionUrl = enabledUrls[0]
    || release.scorecard?.connection?.url
    || ''

  const handleComplete = async (valuesByScreen) => {
    if (submitting) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const result = await runAgent({
        agentId: release.agent_id,
        releaseVersion: release.version,
        valuesByScreen,
        release,
      })
      setRunResult(result)
      setSubmitted(valuesByScreen)
    } catch (error) {
      setSubmitError(error instanceof Error
        ? error.message
        : 'The agent request failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const startAgain = () => {
    setSubmitted(null)
    setRunResult(null)
    setSubmitError('')
    setFlowKey((key) => key + 1)
  }

  return (
    <div
      className="published-screen-page published-agent-page"
      style={presentationStyle(presentation)}
    >
      <header className="published-header">
        <div className="published-brand">
          <span className="published-brand-mark">
            <AgentGlyph icon={presentation.icon} size={24} />
          </span>
          <span>
            <strong>{release.name}</strong>
            <small>{release.description || 'Published agent experience'}</small>
          </span>
        </div>
        <span className="published-status">
          <i /> Published release {release.version}
        </span>
      </header>

      <main className="published-main published-agent-main">
        {submitError && (
          <div className="alert alert-danger" role="alert">
            <strong>Could not reach the agent</strong>
            <span>{submitError}</span>
          </div>
        )}
        {!submitted ? (
          <>
            <AgentFlow
              key={flowKey}
              screens={release.screens}
              screenIds={release.screen_ids}
              startScreenId={release.start_screen_id}
              agentName={release.name}
              agentDescription={release.description}
              onComplete={handleComplete}
            />
            {submitting && (
              <div className="workspace-loading" role="status">
                <strong>
                  {connectionUrl ? 'Sending to the agent…' : 'Finishing…'}
                </strong>
              </div>
            )}
          </>
        ) : (
          <section className="published-success" role="status">
            <span className="result-check" aria-hidden="true">✓</span>
            <span className="section-kicker">Experience complete</span>
            <h1>
              {runResult?.status === 'submitted' ? 'Sent to the agent' : 'You’re all set'}
            </h1>
            <p>
              {runResult?.status === 'submitted'
                ? (runResult.message || `Answers were posted to ${runResult.requestUrl || 'the agent backend'}.`)
                : 'Your answers remain in this browser until the page is refreshed.'}
            </p>
            {Array.isArray(runResult?.results) && runResult.results.length > 0 ? (
              runResult.results.map((result) => (
                <div key={result.endpoint_id || result.request_url} style={{ width: '100%', maxWidth: '40rem' }}>
                  <strong>
                    {result.endpoint_name || result.endpoint_id || 'Endpoint'}
                  </strong>
                  {result.agent_response != null && (
                    <pre className="agent-runtime-response">
                      {formatJson(result.agent_response)}
                    </pre>
                  )}
                </div>
              ))
            ) : runResult?.agentResponse != null ? (
              <pre className="agent-runtime-response">
                {formatJson(runResult.agentResponse)}
              </pre>
            ) : null}
            <div className="route-state-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => downloadResponses(submitted)}
              >
                Download responses JSON
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={startAgain}
              >
                Start again
              </button>
            </div>
          </section>
        )}
      </main>

      <footer className="published-footer">
        <span>Agent release {release.version}</span>
        <span>
          {connectionUrl
            ? `Connected · ${release.screens.length} screens`
            : `${release.screens.length} screens · local only`}
        </span>
      </footer>
    </div>
  )
}
