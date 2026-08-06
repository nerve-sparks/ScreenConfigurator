import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { loadAgentRelease, runPublishedAgent } from '../lib/api.js'
import AgentFlow from '../components/AgentFlow.jsx'
import { normalizePresentation, presentationStyle } from '../lib/presentation.js'
import { AgentGlyph, SparkIcon, WorkspaceLoading } from '../components/StudioShell.jsx'

function formatJson(value) {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export default function PublishedAgentPage() {
  const { agentId } = useParams()
  const location = useLocation()
  const [release, setRelease] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(null)
  const [runResult, setRunResult] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [flowKey, setFlowKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    const requestedVersion = Number.parseInt(
      new URLSearchParams(location.search).get('version'),
      10,
    )
    setLoading(true)
    setError('')
    setSubmitted(null)
    setRunResult(null)
    setSubmitError('')
    loadAgentRelease(
      agentId,
      Number.isInteger(requestedVersion) ? requestedVersion : null,
    )
      .then((loaded) => {
        if (!cancelled) setRelease(loaded)
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [agentId, location.search])

  const handleComplete = async (valuesByScreen) => {
    if (submitting) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const result = await runPublishedAgent(agentId, {
        valuesByScreen,
        version: release?.version,
      })
      setRunResult(result)
      setSubmitted(valuesByScreen)
    } catch (requestError) {
      setSubmitError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <main className="agent-runtime agent-runtime-state">
        <WorkspaceLoading message="Opening agent…" />
      </main>
    )
  }
  if (error || !release) {
    return (
      <main className="agent-runtime agent-runtime-state">
        <span className="agent-runtime-mark"><SparkIcon size={28} /></span>
        <h1>Agent unavailable</h1>
        <p>{error || 'No published release exists for this agent.'}</p>
        <Link to="/library">Return to library</Link>
      </main>
    )
  }

  const presentation = normalizePresentation(release.presentation, {
    name: release.name,
    description: release.description,
  })
  const connectionUrl = release.scorecard?.connection?.url || ''

  return (
    <div className="agent-runtime" style={presentationStyle(presentation)}>
      <header className="agent-runtime-header">
        <div className="agent-runtime-identity">
          <span className="agent-runtime-mark"><AgentGlyph icon={presentation.icon} size={28} /></span>
          <div>
            <h1>{release.name}</h1>
            {release.description ? <p>{release.description}</p> : null}
          </div>
        </div>
      </header>

      <main className="agent-runtime-body">
        {submitError && (
          <div className="alert alert-danger" role="alert">
            <strong>Agent request failed</strong>
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
              variant="published"
            />
            {submitting && (
              <div className="workspace-loading" role="status">
                <strong>
                  {connectionUrl
                    ? 'Sending answers to the agent…'
                    : 'Finishing the journey…'}
                </strong>
              </div>
            )}
          </>
        ) : (
          <section className="agent-runtime-complete" role="status">
            <span className="result-check" aria-hidden="true">✓</span>
            <h2>
              {runResult?.status === 'submitted'
                ? 'Sent to the agent'
                : 'You’re all set'}
            </h2>
            <p>
              {runResult?.message
                || 'The agent journey finished and answers were collected.'}
            </p>
            {runResult?.status === 'submitted' && runResult?.request_url ? (
              <p className="agent-runtime-forwarded">
                Forwarded to{' '}
                <code>{runResult.request_url}</code>
                {runResult.request_method
                  ? ` (${runResult.request_method})`
                  : ''}
                {typeof runResult.agent_status === 'number'
                  ? ` · HTTP ${runResult.agent_status}`
                  : ''}
                {runResult.auth_applied ? ' · Authorization sent' : ' · no API key'}
              </p>
            ) : null}
            {runResult?.status === 'local' && connectionUrl ? (
              <p className="agent-runtime-forwarded">
                Scorecard URL is set, but this run stayed local. Re-publish the
                agent so the release includes <code>connection.url</code>.
              </p>
            ) : null}
            {runResult?.payload != null && (
              <div className="agent-runtime-panel">
                <strong>Payload sent</strong>
                <pre className="agent-runtime-response">
                  {formatJson(runResult.payload)}
                </pre>
              </div>
            )}
            <div className="agent-runtime-panel">
              <strong>Agent response</strong>
              {runResult?.agent_response != null ? (
                <pre className="agent-runtime-response">
                  {formatJson(runResult.agent_response)}
                </pre>
              ) : (
                <p className="agent-runtime-empty-response">
                  {runResult?.status === 'submitted'
                    ? 'The agent returned an empty body.'
                    : 'No remote agent call was made, so there is no agent response.'}
                </p>
              )}
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setSubmitted(null)
                setRunResult(null)
                setSubmitError('')
                setFlowKey((key) => key + 1)
              }}
            >
              Start again
            </button>
          </section>
        )}
      </main>
    </div>
  )
}
