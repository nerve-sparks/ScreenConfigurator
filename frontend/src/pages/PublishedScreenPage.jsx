import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { loadScreen } from '../lib/api.js'
import { normalizePresentation, presentationStyle } from '../lib/presentation.js'
import ScreenExperience from '../components/ScreenExperience.jsx'
import { AgentGlyph, SparkIcon, WorkspaceLoading } from '../components/StudioShell.jsx'

export default function PublishedScreenPage() {
  const { screenId } = useParams()
  const location = useLocation()
  const [document, setDocument] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [submitted, setSubmitted] = useState(false)
  const [formKey, setFormKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSubmitted(false)
    const requestedVersion = Number.parseInt(
      new URLSearchParams(location.search).get('version'),
      10,
    )
    loadScreen(screenId, Number.isInteger(requestedVersion) ? requestedVersion : null)
      .then((result) => {
        if (cancelled) return
        if (!result?.manifest?.input_schema) {
          throw new Error('Saved screen is missing its manifest.')
        }
        setDocument(result)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [location.search, screenId])

  if (loading) {
    return (
      <main className="agent-runtime agent-runtime-state">
        <WorkspaceLoading message="Opening screen…" />
      </main>
    )
  }

  if (error || !document) {
    return (
      <main className="agent-runtime agent-runtime-state">
        <span className="agent-runtime-mark"><SparkIcon size={28} /></span>
        <h1>Screen unavailable</h1>
        <p>{error ?? 'The requested screen could not be found.'}</p>
        <Link to="/library">Return to library</Link>
      </main>
    )
  }

  const presentation = normalizePresentation(document.presentation, {
    name: document.agent_id,
    description: document.description ?? '',
  })
  const displayName = presentation.display_name || document.agent_id

  return (
    <div className="agent-runtime" style={presentationStyle(presentation)}>
      <header className="agent-runtime-header">
        <div className="agent-runtime-identity">
          <span className="agent-runtime-mark"><AgentGlyph icon={presentation.icon} size={28} /></span>
          <div>
            <h1>{displayName}</h1>
            {document.description ? <p>{document.description}</p> : null}
          </div>
        </div>
      </header>

      <main className="agent-runtime-body agent-runtime-body-narrow">
        {!submitted ? (
          <ScreenExperience
            formKey={formKey}
            manifest={document.manifest}
            framed={false}
            onSubmit={() => setSubmitted(true)}
            presentation={presentation}
            description={document.description ?? ''}
            agentName={document.agent_id}
          />
        ) : (
          <section className="agent-runtime-complete" role="status">
            <span className="result-check" aria-hidden="true">✓</span>
            <h2>You’re all set</h2>
            <p>Your inputs were collected for this agent screen.</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setSubmitted(false)
                setFormKey((key) => key + 1)
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
