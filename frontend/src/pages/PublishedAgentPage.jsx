import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { loadAgentRelease, runPublishedAgent } from '../lib/api.js'
import AgentFlow from '../components/AgentFlow.jsx'
import AgentResponse from '../components/AgentResponse.jsx'
import { normalizePresentation, presentationStyle } from '../lib/presentation.js'
import { AgentGlyph } from '../components/StudioShell.jsx'
import ThemeToggle from '../components/ui/ThemeToggle.jsx'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  Download,
  Sparkles,
} from '../components/ui/Icons.jsx'
import '../runtime.css'

function downloadAnswers(agentId, values) {
  const blob = new Blob([JSON.stringify(values, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${agentId}-responses.json`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
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

  const restart = () => {
    setSubmitted(null)
    setRunResult(null)
    setSubmitError('')
    setFlowKey((key) => key + 1)
  }

  if (loading) {
    return (
      <div className="ar-shell ar-shell-state">
        <div className="ar-state-card" role="status">
          <span className="ar-state-orb" aria-hidden="true" />
          <h1>Opening agent…</h1>
          <p>Loading the published release.</p>
        </div>
      </div>
    )
  }

  if (error || !release) {
    return (
      <div className="ar-shell ar-shell-state">
        <div className="ar-state-card is-error">
          <span className="ar-state-icon"><AlertTriangle size={24} /></span>
          <h1>Agent unavailable</h1>
          <p>{error || 'No published release exists for this agent.'}</p>
          <Link className="btn btn-secondary" to="/library">
            <ArrowLeft size={16} />
            Return to library
          </Link>
        </div>
      </div>
    )
  }

  const presentation = normalizePresentation(release.presentation, {
    name: release.name,
    description: release.description,
  })
  const results = Array.isArray(runResult?.results) ? runResult.results : []
  const wasSubmitted = runResult?.status === 'submitted'

  return (
    <div className="ar-shell" style={presentationStyle(presentation)}>
      <div className="ar-atmosphere" aria-hidden="true" />

      <header className="ar-topbar">
        <div className="ar-topbar-inner">
          <div className="ar-identity">
            <span className="ar-identity-mark">
              <AgentGlyph icon={presentation.icon} size={20} />
            </span>
            <div className="ar-identity-copy">
              <span className="ar-identity-kicker">Agent</span>
              <h1>{release.name}</h1>
            </div>
          </div>

          <div className="ar-topbar-actions">
            {release.version ? (
              <span className="ar-version-pill">v{release.version}</span>
            ) : null}
            <ThemeToggle />
          </div>
        </div>

        {release.description ? (
          <p className="ar-lede">{release.description}</p>
        ) : null}
      </header>

      <main className="ar-body">
        {submitError ? (
          <div className="ar-alert" role="alert">
            <span className="ar-alert-icon"><AlertTriangle size={18} /></span>
            <div>
              <strong>Couldn&rsquo;t finish</strong>
              <span>{submitError}</span>
            </div>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={restart}>
              Start over
            </button>
          </div>
        ) : null}

        {!submitted ? (
          <div className={`ar-stage-wrap${submitting ? ' is-busy' : ''}`}>
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

            {submitting ? (
              <div className="ar-busy-overlay" role="status">
                <span className="ar-busy-orb" aria-hidden="true" />
                <strong>Sending to the agent…</strong>
                <span>This can take a few moments.</span>
              </div>
            ) : null}
          </div>
        ) : (
          <section className="ar-complete">
            <div className="ar-complete-head">
              <span className="ar-complete-mark" aria-hidden="true">
                <CheckCircle size={30} />
              </span>
              <h2>{wasSubmitted ? 'Sent to the agent' : 'You’re all set'}</h2>
              <p>
                {wasSubmitted
                  ? (runResult.message || 'Your answers were delivered successfully.')
                  : (runResult?.message || 'The journey finished.')}
              </p>
            </div>

            {results.length > 0 ? (
              <div className="ar-response-group">
                {results.map((result) => (
                  <AgentResponse
                    key={result.endpoint_id || result.request_url}
                    label={
                      result.endpoint_name
                      || result.endpoint_id
                      || 'Endpoint'
                    }
                    value={result.agent_response}
                  />
                ))}
              </div>
            ) : runResult?.agent_response != null ? (
              <div className="ar-response-group">
                <AgentResponse value={runResult.agent_response} />
              </div>
            ) : null}

            <div className="ar-complete-actions">
              <button type="button" className="btn btn-primary" onClick={restart}>
                <Sparkles size={16} />
                Start again
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => downloadAnswers(agentId, submitted)}
              >
                <Download size={16} />
                Download answers
              </button>
            </div>
          </section>
        )}
      </main>

      <footer className="ar-footer">
        <span>
          {presentation.display_name || release.name}
          {release.version ? ` · Release ${release.version}` : ''}
        </span>
        <span>Answers stay in your browser until you finish.</span>
      </footer>
    </div>
  )
}
