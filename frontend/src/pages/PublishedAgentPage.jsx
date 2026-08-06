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

  useEffect(() => {
    if (!release?.name) return undefined
    const previous = document.title
    document.title = release.name
    return () => {
      document.title = previous
    }
  }, [release?.name])

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
    <div
      className="agent-runtime"
      style={presentationStyle(presentation)}
    >
      <div className="agent-runtime-atmosphere" aria-hidden="true" />

      <header className="agent-runtime-topbar">
        <div className="agent-runtime-identity">
          <span className="agent-runtime-mark">
            <AgentGlyph icon={presentation.icon} size={20} />
          </span>
          <div>
            <p className="agent-runtime-kicker">Agent</p>
            <h1>{release.name}</h1>
          </div>
        </div>
        {release.description ? (
          <p className="agent-runtime-lede">{release.description}</p>
        ) : null}
      </header>

      <main className="agent-runtime-body">
        {submitError && (
          <div className="agent-runtime-alert" role="alert">
            <strong>Couldn’t finish</strong>
            <span>{submitError}</span>
          </div>
        )}

        {!submitted ? (
          <div className={`agent-runtime-stage${submitting ? ' is-busy' : ''}`}>
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
              <div className="agent-runtime-busy" role="status">
                <span className="agent-runtime-busy-pulse" aria-hidden="true" />
                {connectionUrl ? 'Sending to the agent…' : 'Finishing…'}
              </div>
            )}
          </div>
        ) : (
          <section className="agent-runtime-complete" role="status">
            <span className="agent-runtime-complete-mark" aria-hidden="true">✓</span>
            <h2>
              {runResult?.status === 'submitted' ? 'Done' : 'You’re all set'}
            </h2>
            <p>
              {runResult?.status === 'submitted'
                ? 'Your answers were sent to the agent.'
                : (runResult?.message || 'The journey finished.')}
            </p>
            {runResult?.agent_response != null && (
              <div className="agent-runtime-panel">
                <strong>Agent response</strong>
                <pre className="agent-runtime-response">
                  {formatJson(runResult.agent_response)}
                </pre>
              </div>
            )}
            <button
              type="button"
              className="btn btn-primary agent-runtime-restart"
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
