import { useState } from 'react'
import AgentFlow from './AgentFlow.jsx'
import { AgentGlyph } from './RuntimePrimitives.jsx'
import { normalizePresentation, presentationStyle } from './presentation.js'
import { loadAgentRelease } from './releaseLoader.js'
import { submitAgent } from './submitAgent.js'

const release = loadAgentRelease()

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

export default function App() {
  const [submitted, setSubmitted] = useState(null)
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [flowKey, setFlowKey] = useState(0)
  const presentation = normalizePresentation(release.presentation, {
    name: release.name,
    description: release.description,
  })

  const handleComplete = async (valuesByScreen) => {
    if (submitting) return
    setSubmitting(true)
    setSubmitError('')
    try {
      await submitAgent({
        agentId: release.agent_id,
        releaseVersion: release.version,
        valuesByScreen,
        scorecard: release.scorecard,
      })
      setSubmitted(valuesByScreen)
    } catch (error) {
      setSubmitError(error instanceof Error
        ? error.message
        : 'The completion integration failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const startAgain = () => {
    setSubmitted(null)
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
            <strong>Could not complete the integration</strong>
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
                <strong>Completing the agent experience…</strong>
              </div>
            )}
          </>
        ) : (
          <section className="published-success" role="status">
            <span className="result-check" aria-hidden="true">✓</span>
            <span className="section-kicker">Experience complete</span>
            <h1>Your information is ready</h1>
            <p>
              Your answers remain in this browser until the page is refreshed.
              Download them now or start again.
            </p>
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
        <span>{release.screens.length} secure screens</span>
      </footer>
    </div>
  )
}
