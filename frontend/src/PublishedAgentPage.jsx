import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { loadAgentRelease } from './api.js'
import AgentFlow from './AgentFlow.jsx'
import { normalizePresentation, presentationStyle } from './presentation.js'
import { AgentGlyph, SparkIcon, WorkspaceLoading } from './StudioShell.jsx'

export default function PublishedAgentPage() {
  const { agentId } = useParams()
  const location = useLocation()
  const [release, setRelease] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(null)
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

  if (loading) {
    return (
      <main className="published-screen-page published-route-state">
        <WorkspaceLoading message="Opening agent experience..." />
      </main>
    )
  }
  if (error || !release) {
    return (
      <main className="published-screen-page published-route-state">
        <span className="published-brand-mark"><SparkIcon size={24} /></span>
        <h1>Agent experience unavailable</h1>
        <p>{error || 'No published release exists for this agent.'}</p>
        <Link to="/library">Return to the Agent Library</Link>
      </main>
    )
  }

  const presentation = normalizePresentation(release.presentation, {
    name: release.name,
    description: release.description,
  })

  return (
    <div className="published-screen-page published-agent-page" style={presentationStyle(presentation)}>
      <header className="published-header">
        <div className="published-brand">
          <span className="published-brand-mark"><AgentGlyph icon={presentation.icon} size={24} /></span>
          <span>
            <strong>{release.name}</strong>
            <small>{release.description || 'Published agent experience'}</small>
          </span>
        </div>
        <span className="published-status"><i /> Published release {release.version}</span>
      </header>

      <main className="published-main published-agent-main">
        {!submitted ? (
          <AgentFlow
            key={flowKey}
            screens={release.screens}
            screenIds={release.screen_ids}
            startScreenId={release.start_screen_id}
            agentName={release.name}
            agentDescription={release.description}
            onComplete={setSubmitted}
          />
        ) : (
          <section className="published-success" role="status">
            <span className="result-check" aria-hidden="true">✓</span>
            <span className="section-kicker">Experience complete</span>
            <h1>Your information is ready</h1>
            <p>
              The complete agent journey finished successfully. Values were
              collected per form screen and decorative content was not submitted.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setSubmitted(null)
                setFlowKey((key) => key + 1)
              }}
            >
              Start again
            </button>
          </section>
        )}
      </main>

      <footer className="published-footer">
        <span>Agent release {release.version}</span>
        <span>{release.screens.length} secure screens</span>
      </footer>
    </div>
  )
}
