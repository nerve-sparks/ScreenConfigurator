import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { loadScreen } from './api.js'
import { normalizePresentation, presentationStyle } from './presentation.js'
import ScreenExperience from './ScreenExperience.jsx'
import { AgentGlyph, SparkIcon, WorkspaceLoading } from './StudioShell.jsx'

export default function PublishedScreenPage() {
  const { screenId } = useParams()
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
    loadScreen(screenId)
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
  }, [screenId])

  if (loading) {
    return (
      <main className="published-screen-page published-route-state">
        <WorkspaceLoading message="Opening input screen..." />
      </main>
    )
  }

  if (error || !document) {
    return (
      <main className="published-screen-page published-route-state">
        <span className="published-brand-mark"><SparkIcon size={24} /></span>
        <h1>Input screen unavailable</h1>
        <p>{error ?? 'The requested screen could not be found.'}</p>
        <Link to="/library">Return to the screen library</Link>
      </main>
    )
  }

  const presentation = normalizePresentation(document.presentation, {
    name: document.agent_id,
    description: document.description ?? '',
  })
  const displayName = presentation.display_name || document.agent_id

  return (
    <div className="published-screen-page" style={presentationStyle(presentation)}>
      <header className="published-header">
        <div className="published-brand">
          <span className="published-brand-mark"><AgentGlyph icon={presentation.icon} size={24} /></span>
          <span>
            <strong>{displayName}</strong>
            <small>{document.description || 'Agent input experience'}</small>
          </span>
        </div>
        <span className="published-status"><i /> Published</span>
      </header>

      <main className="published-main">
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
          <section className="published-success" role="status">
            <span className="result-check" aria-hidden="true">✓</span>
            <span className="section-kicker">Inputs collected</span>
            <h1>Your information is ready</h1>
            <p>This project demonstrates the input experience only; connecting it to the agent is intentionally outside this screen.</p>
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

      <footer className="published-footer">
        <span>Version {document.version}</span>
        <span>Secure input experience</span>
      </footer>
    </div>
  )
}
