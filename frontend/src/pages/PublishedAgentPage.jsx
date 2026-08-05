import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { loadAgentRelease } from '../lib/api.js'
import AgentFlow from '../components/AgentFlow.jsx'
import { normalizePresentation, presentationStyle } from '../lib/presentation.js'
import { AgentGlyph, SparkIcon, WorkspaceLoading } from '../components/StudioShell.jsx'

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
        {!submitted ? (
          <AgentFlow
            key={flowKey}
            screens={release.screens}
            screenIds={release.screen_ids}
            startScreenId={release.start_screen_id}
            agentName={release.name}
            agentDescription={release.description}
            onComplete={setSubmitted}
            variant="published"
          />
        ) : (
          <section className="agent-runtime-complete" role="status">
            <span className="result-check" aria-hidden="true">✓</span>
            <h2>You’re all set</h2>
            <p>
              The agent journey finished. Form values were collected; content
              screens were not submitted.
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
    </div>
  )
}
