import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createAgentProject } from './api.js'
import { DEFAULT_PRESENTATION, normalizePresentation } from './presentation.js'
import { screenIdFrom } from './screenIdentity.js'
import { SparkIcon } from './StudioShell.jsx'

export default function AgentCreatePage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const agentId = screenIdFrom(name)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!agentId || !description.trim()) return
    setBusy(true)
    setError('')
    try {
      const project = await createAgentProject({
        name: name.trim(),
        description: description.trim(),
        presentation: normalizePresentation({
          ...DEFAULT_PRESENTATION,
          display_name: name.trim(),
          welcome_description: description.trim().slice(0, 240),
        }),
      })
      navigate(`/studio/agents/${encodeURIComponent(project.agent_id)}`, {
        state: { openScreenPlan: true },
      })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="app-main agent-create-page">
      <section className="agent-create-card">
        <span className="empty-spark"><SparkIcon size={28} /></span>
        <span className="section-kicker">New agent project</span>
        <h1>Describe the complete agent experience</h1>
        <p>
          AI will first propose an ordered screen plan. You remain in control of
          every screen, field, content block, and published release.
        </p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="new-agent-name">Agent name</label>
            <input
              id="new-agent-name"
              className="form-control"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Inbound Calling Agent"
              maxLength={80}
              required
            />
            <small>Agent ID: {agentId || 'enter a name containing letters or numbers'}</small>
          </div>
          <div className="form-group">
            <label htmlFor="new-agent-description">Describe the agent</label>
            <textarea
              id="new-agent-description"
              className="form-control"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={8}
              maxLength={5000}
              placeholder="Explain who uses the agent, what they need to accomplish, and the information or guidance each part of the experience should provide."
              required
            />
            <small>{description.length}/5000</small>
          </div>
          {error && <div className="alert alert-danger" role="alert">{error}</div>}
          <div className="agent-create-actions">
            <button type="button" className="btn btn-outline-secondary" onClick={() => navigate('/library')}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !agentId || !description.trim()}>
              {busy ? 'Creating workspace...' : 'Create agent and plan screens'}
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}
