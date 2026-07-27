import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  downloadAgentFrontend,
  duplicateAgentProject,
  listAgents,
  setAgentArchived,
} from './api.js'
import { saveFrontendArchive } from './frontendDownload.js'
import { screenIdFrom } from './screenIdentity.js'
import { SparkIcon, WorkspaceLoading } from './StudioShell.jsx'

const FILTERS = [
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Drafts' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
]

export default function AgentLibraryPage() {
  const navigate = useNavigate()
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('active')
  const [dialog, setDialog] = useState(null)
  const [duplicateName, setDuplicateName] = useState('')
  const [dialogError, setDialogError] = useState('')
  const [busy, setBusy] = useState(false)
  const [exportingAgentIds, setExportingAgentIds] = useState([])
  const exportRequests = useRef(new Set())

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setAgents(await listAgents())
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const counts = useMemo(() => ({
    active: agents.filter((agent) => !agent.is_archived).length,
    draft: agents.filter((agent) =>
      !agent.is_archived && agent.has_unpublished_changes).length,
    published: agents.filter((agent) =>
      !agent.is_archived && Number.isInteger(agent.latest_release)).length,
    archived: agents.filter((agent) => agent.is_archived).length,
  }), [agents])

  const visible = useMemo(() => {
    const search = query.trim().toLowerCase()
    return agents.filter((agent) => {
      if (search && !agent.agent_id.toLowerCase().includes(search)
        && !agent.name.toLowerCase().includes(search)) return false
      if (filter === 'archived') return Boolean(agent.is_archived)
      if (agent.is_archived) return false
      if (filter === 'draft') return Boolean(agent.has_unpublished_changes)
      if (filter === 'published') return Number.isInteger(agent.latest_release)
      return true
    })
  }, [agents, filter, query])

  const openDuplicate = (agent) => {
    setDuplicateName(`${agent.name} Copy`)
    setDialog({ type: 'duplicate', agent })
    setDialogError('')
  }

  const downloadFrontend = async (agent) => {
    if (
      exportRequests.current.has(agent.agent_id)
      || !Number.isInteger(agent.latest_release)
    ) return
    exportRequests.current.add(agent.agent_id)
    setExportingAgentIds((current) => [...current, agent.agent_id])
    setActionError('')
    setNotice('')
    try {
      const archive = await downloadAgentFrontend(
        agent.agent_id,
        agent.latest_release,
      )
      saveFrontendArchive(archive, agent.agent_id, agent.latest_release)
      setNotice(
        `${agent.name} release ${agent.latest_release} frontend was downloaded.`,
      )
    } catch (requestError) {
      setActionError(
        requestError instanceof Error
          ? requestError.message
          : 'The frontend download could not be prepared.',
      )
    } finally {
      exportRequests.current.delete(agent.agent_id)
      setExportingAgentIds((current) =>
        current.filter((agentId) => agentId !== agent.agent_id))
    }
  }

  const confirmDialog = async () => {
    if (!dialog) return
    setBusy(true)
    setDialogError('')
    try {
      if (dialog.type === 'duplicate') {
        const project = await duplicateAgentProject(
          dialog.agent.agent_id,
          duplicateName.trim(),
        )
        setDialog(null)
        navigate(`/studio/agents/${encodeURIComponent(project.agent_id)}`)
        return
      }
      const archived = !dialog.agent.is_archived
      await setAgentArchived(dialog.agent.agent_id, archived)
      setDialog(null)
      setNotice(
        `${dialog.agent.name} was ${archived ? 'archived' : 'returned to the library'}.`,
      )
      await refresh()
    } catch (requestError) {
      setDialogError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="app-main library-page agent-library-page">
      <section className="route-page-heading library-heading" aria-labelledby="library-title">
        <div>
          <span className="hero-eyebrow"><SparkIcon size={16} /> Agent projects</span>
          <h1 id="library-title">Agent library</h1>
          <p>Open an agent workspace to create, arrange, preview, and publish its screens.</p>
        </div>
        <Link className="btn btn-primary" to="/studio/agents/new">+ Create agent</Link>
      </section>

      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      {actionError && (
        <div className="alert alert-danger" role="alert">
          <strong>Could not download the frontend</strong>
          <span>{actionError}</span>
        </div>
      )}
      {error && (
        <div className="library-error alert alert-danger" role="alert">
          <div><strong>Could not load the agent library</strong><span>{error}</span></div>
          <button type="button" className="btn btn-outline-secondary" onClick={refresh}>Retry</button>
        </div>
      )}
      {loading && <WorkspaceLoading message="Loading agent projects..." />}

      {!loading && !error && agents.length === 0 && (
        <section className="library-empty">
          <span className="empty-spark"><SparkIcon size={32} /></span>
          <span className="section-kicker">No agent projects yet</span>
          <h2>Create your first multi-screen agent experience</h2>
          <p>AI can propose its screens, then you approve and publish one stable release.</p>
          <Link className="btn btn-primary" to="/studio/agents/new">Create agent</Link>
        </section>
      )}

      {!loading && !error && agents.length > 0 && (
        <>
          <section className="library-toolbar" aria-label="Find and filter agents">
            <label className="library-search">
              <span>Search agents</span>
              <span className="library-search-input">
                <span aria-hidden="true">⌕</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by name or agent ID"
                />
              </span>
            </label>
            <div className="library-filter-group" role="group" aria-label="Agent status">
              {FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={filter === option.value}
                  onClick={() => setFilter(option.value)}
                >
                  {option.label} <span>{counts[option.value]}</span>
                </button>
              ))}
            </div>
          </section>

          <div className="library-results-meta" role="status">
            <span>{visible.length} of {agents.length} agents</span>
          </div>

          <section className="screen-library-grid" aria-label="Agent projects">
            {visible.map((agent) => (
              <article
                className={`screen-library-card agent-project-card${agent.is_archived ? ' is-archived' : ''}`}
                key={agent.agent_id}
              >
                <div className="library-card-heading">
                  <span className="library-card-icon"><SparkIcon size={20} /></span>
                  <div>
                    <span className="section-kicker">
                      {agent.is_archived ? 'Archived agent' : 'Agent project'}
                    </span>
                    <h2>{agent.name || agent.agent_id}</h2>
                    <small>{agent.agent_id}</small>
                  </div>
                  <div className="library-statuses">
                    {agent.is_archived && <span className="library-archived-status">Archived</span>}
                    {agent.has_unpublished_changes && <span className="library-draft-status">Draft</span>}
                    {Number.isInteger(agent.latest_release) && (
                      <span className="library-version">release {agent.latest_release}</span>
                    )}
                  </div>
                </div>
                <p>
                  {agent.screen_count} active screen{agent.screen_count === 1 ? '' : 's'}
                  {' · '}
                  {Number.isInteger(agent.latest_release)
                    ? `published release ${agent.latest_release}`
                    : 'not published yet'}
                </p>
                <div className="library-card-actions">
                  {!agent.is_archived && (
                    <Link
                      className="btn btn-primary"
                      to={`/studio/agents/${encodeURIComponent(agent.agent_id)}`}
                    >
                      Open workspace
                    </Link>
                  )}
                  {Number.isInteger(agent.latest_release) && (
                    <Link
                      className="btn btn-outline-secondary"
                      to={`/studio/agents/${encodeURIComponent(agent.agent_id)}/preview`}
                    >
                      Preview agent
                    </Link>
                  )}
                  {Number.isInteger(agent.latest_release) ? (
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      disabled={exportingAgentIds.includes(agent.agent_id)}
                      onClick={() => downloadFrontend(agent)}
                    >
                      {exportingAgentIds.includes(agent.agent_id)
                        ? 'Preparing download…'
                        : 'Download frontend'}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn btn-outline-secondary"
                        disabled
                        aria-describedby={`${agent.agent_id}-download-help`}
                      >
                        Publish to download
                      </button>
                      <span
                        id={`${agent.agent_id}-download-help`}
                        className="sr-only"
                      >
                        Publish a validated immutable release before downloading
                        this agent frontend.
                      </span>
                    </>
                  )}
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => openDuplicate(agent)}
                  >
                    Duplicate
                  </button>
                </div>
                <div className="library-card-secondary-actions">
                  <button
                    type="button"
                    className="btn btn-link library-archive-action"
                    aria-label={`${agent.is_archived ? 'Unarchive' : 'Archive'} ${agent.name}`}
                    onClick={() => {
                      setDialog({ type: 'archive', agent })
                      setDialogError('')
                    }}
                  >
                    {agent.is_archived ? 'Unarchive' : 'Archive'}
                  </button>
                  {Number.isInteger(agent.latest_release) && (
                    <Link className="btn btn-link" to={`/agents/${encodeURIComponent(agent.agent_id)}`}>
                      Published agent ↗
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </section>
        </>
      )}

      {dialog && (
        <div className="library-dialog-backdrop" role="presentation">
          <section className="library-dialog" role="dialog" aria-modal="true">
            <span className="section-kicker">
              {dialog.type === 'duplicate' ? 'Duplicate agent' : 'Archive status'}
            </span>
            <h2>
              {dialog.type === 'duplicate'
                ? `Duplicate ${dialog.agent.name}?`
                : `${dialog.agent.is_archived ? 'Unarchive' : 'Archive'} ${dialog.agent.name}?`}
            </h2>
            {dialog.type === 'duplicate' && (
              <label>
                New agent name
                <input
                  className="form-control"
                  value={duplicateName}
                  onChange={(event) => setDuplicateName(event.target.value)}
                />
                <small>Agent ID: {screenIdFrom(duplicateName) || 'enter a valid name'}</small>
              </label>
            )}
            {dialog.type === 'archive' && (
              <p>Draft screens and published releases remain intact.</p>
            )}
            {dialogError && <div className="alert alert-danger" role="alert">{dialogError}</div>}
            <div className="library-dialog-actions">
              <button type="button" className="btn btn-outline-secondary" onClick={() => setDialog(null)} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={confirmDialog}
                aria-label={dialog.type === 'duplicate'
                  ? 'Create duplicate agent'
                  : `${dialog.agent.is_archived ? 'Unarchive' : 'Archive'} agent`}
                disabled={busy || (dialog.type === 'duplicate' && !screenIdFrom(duplicateName))}
              >
                {busy ? 'Working...' : 'Confirm'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
