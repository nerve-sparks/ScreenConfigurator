import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  duplicateScreen,
  listScreens,
  listScreenVersions,
  restoreScreenVersion,
  setScreenArchived,
} from './api.js'
import { screenIdFrom } from './screenIdentity.js'
import { SparkIcon, WorkspaceLoading } from './StudioShell.jsx'

const FILTERS = [
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Drafts' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
]

function screenPath(prefix, screenId, suffix = '') {
  return `${prefix}/${encodeURIComponent(screenId)}${suffix}`
}

function screenName(screen) {
  return screen.name || screen.agent_id
}

function publishedDate(version) {
  const value = version.published_at || version.created_at
  if (!value) return 'Publication date unavailable'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Publication date unavailable'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function LibraryDialog({ dialog, busy, error, duplicateName, onDuplicateName, onClose, onConfirm }) {
  if (!dialog) return null
  const name = screenName(dialog.screen)
  const isDuplicate = dialog.type === 'duplicate'
  const isArchive = dialog.type === 'archive'
  const isRestore = dialog.type === 'restore'
  const title = isDuplicate
    ? `Duplicate ${name}`
    : isArchive
      ? `${dialog.screen.is_archived ? 'Unarchive' : 'Archive'} ${name}?`
      : `Restore version ${dialog.version.version}?`
  const confirmLabel = isDuplicate
    ? 'Create duplicate'
    : isArchive
      ? dialog.screen.is_archived ? 'Unarchive screen' : 'Archive screen'
      : 'Restore as draft'
  const duplicateId = screenIdFrom(duplicateName)

  return (
    <div
      className="library-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <section
        className="library-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-dialog-title"
      >
        <span className="library-dialog-icon" aria-hidden="true">
          {isDuplicate ? '⧉' : isRestore ? '↺' : dialog.screen.is_archived ? '↑' : '◇'}
        </span>
        <h2 id="library-dialog-title">{title}</h2>

        {isDuplicate && (
          <>
            <p>The latest working state will become a separate unpublished draft. Published history is not copied.</p>
            <div className="library-dialog-field">
              <label htmlFor="duplicate-screen-name">New screen name</label>
              <input
                id="duplicate-screen-name"
                autoFocus
                type="text"
                maxLength={80}
                value={duplicateName}
                onChange={(event) => onDuplicateName(event.target.value)}
                disabled={busy}
                aria-describedby="duplicate-screen-id"
              />
              <small id="duplicate-screen-id">New agent ID: <strong>{duplicateId || 'Enter a valid name'}</strong></small>
            </div>
          </>
        )}

        {isArchive && (
          <p>
            {dialog.screen.is_archived
              ? 'This screen will return to the active library with its draft and every published version intact.'
              : 'This hides the screen from the active library. Its draft and every published version remain intact and can be restored later.'}
          </p>
        )}

        {isRestore && (
          <p>
            Version {dialog.version.version} will replace the current working draft. All published versions remain immutable and loadable.
          </p>
        )}

        {error && <div className="alert alert-danger" role="alert">{error}</div>}

        <div className="library-dialog-actions">
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={isArchive && !dialog.screen.is_archived ? 'btn btn-library-danger' : 'btn btn-primary'}
            onClick={onConfirm}
            disabled={busy || (isDuplicate && !duplicateId)}
          >
            {busy ? 'Working...' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}

export default function LibraryPage() {
  const navigate = useNavigate()
  const [screens, setScreens] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('active')
  const [notice, setNotice] = useState('')
  const [expandedHistory, setExpandedHistory] = useState(null)
  const [historyByScreen, setHistoryByScreen] = useState({})
  const [historyLoading, setHistoryLoading] = useState(null)
  const [historyError, setHistoryError] = useState('')
  const [dialog, setDialog] = useState(null)
  const [dialogBusy, setDialogBusy] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const [duplicateName, setDuplicateName] = useState('')

  const refresh = useCallback(async ({ showLoading = true } = {}) => {
    if (showLoading) setLoading(true)
    setError(null)
    try {
      setScreens(await listScreens())
    } catch (err) {
      setError(err.message)
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!dialog) return undefined
    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && !dialogBusy) setDialog(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [dialog, dialogBusy])

  const filterCounts = useMemo(() => ({
    active: screens.filter((screen) => !screen.is_archived).length,
    draft: screens.filter((screen) => !screen.is_archived && screen.has_draft).length,
    published: screens.filter(
      (screen) => !screen.is_archived && Number.isInteger(screen.latest_version),
    ).length,
    archived: screens.filter((screen) => screen.is_archived).length,
  }), [screens])

  const visibleScreens = useMemo(() => {
    const search = query.trim().toLowerCase()
    return screens.filter((screen) => {
      const matchesSearch = !search
        || screen.agent_id.toLowerCase().includes(search)
        || screenName(screen).toLowerCase().includes(search)
      if (!matchesSearch) return false
      if (filter === 'archived') return Boolean(screen.is_archived)
      if (screen.is_archived) return false
      if (filter === 'draft') return Boolean(screen.has_draft)
      if (filter === 'published') return Number.isInteger(screen.latest_version)
      return true
    })
  }, [filter, query, screens])

  const openDialog = (type, screen, version = null) => {
    setDialog({ type, screen, version })
    setDialogError('')
    if (type === 'duplicate') setDuplicateName(`${screenName(screen)} Copy`)
  }

  const toggleHistory = async (screen) => {
    const agentId = screen.agent_id
    setHistoryError('')
    if (expandedHistory === agentId) {
      setExpandedHistory(null)
      return
    }
    setExpandedHistory(agentId)
    if (historyByScreen[agentId]) return
    setHistoryLoading(agentId)
    try {
      const versions = await listScreenVersions(agentId)
      setHistoryByScreen((current) => ({ ...current, [agentId]: versions }))
    } catch (err) {
      setHistoryError(err.message)
    } finally {
      setHistoryLoading(null)
    }
  }

  const confirmDialog = async () => {
    if (!dialog) return
    setDialogBusy(true)
    setDialogError('')
    try {
      if (dialog.type === 'duplicate') {
        const result = await duplicateScreen(dialog.screen.agent_id, duplicateName.trim())
        setDialog(null)
        navigate(screenPath('/builder', result.agent_id, '/edit'))
        return
      }
      if (dialog.type === 'restore') {
        await restoreScreenVersion(dialog.screen.agent_id, dialog.version.version)
        setDialog(null)
        navigate(screenPath('/builder', dialog.screen.agent_id, '/edit'))
        return
      }

      const archived = !dialog.screen.is_archived
      await setScreenArchived(dialog.screen.agent_id, archived)
      await refresh({ showLoading: false })
      setDialog(null)
      setNotice(`${screenName(dialog.screen)} was ${archived ? 'archived' : 'returned to the active library'}.`)
    } catch (err) {
      setDialogError(err.message)
    } finally {
      setDialogBusy(false)
    }
  }

  return (
    <main className="app-main library-page">
      <section className="route-page-heading library-heading" aria-labelledby="library-title">
        <div>
          <span className="hero-eyebrow"><SparkIcon size={16} /> Saved configurations</span>
          <h1 id="library-title">Screen library</h1>
          <p>Find, edit, duplicate, and publish agent input experiences without remembering an agent ID.</p>
        </div>
        <Link className="btn btn-primary" to="/builder/new">+ Create new screen</Link>
      </section>

      {notice && (
        <div className="library-notice alert alert-success" role="status">
          <span>{notice}</span>
          <button type="button" aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button>
        </div>
      )}

      {error && (
        <div className="library-error alert alert-danger" role="alert">
          <div>
            <strong>Could not load the screen library</strong>
            <span>{error}</span>
          </div>
          <button type="button" className="btn btn-outline-secondary" onClick={() => refresh()}>Retry</button>
        </div>
      )}

      {loading && <WorkspaceLoading message="Loading saved screens..." />}

      {!loading && !error && screens.length === 0 && (
        <section className="library-empty">
          <span className="empty-spark"><SparkIcon size={32} /></span>
          <span className="section-kicker">No saved screens yet</span>
          <h2>Create and save your first agent input experience</h2>
          <p>It will appear here with a working draft and immutable published-version history.</p>
          <Link className="btn btn-primary" to="/builder/new">Open builder</Link>
        </section>
      )}

      {!loading && !error && screens.length > 0 && (
        <>
          <section className="library-toolbar" aria-label="Find and filter screens">
            <label className="library-search">
              <span>Search screens</span>
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
            <div className="library-filter-group" role="group" aria-label="Screen status">
              {FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={filter === option.value}
                  onClick={() => setFilter(option.value)}
                >
                  {option.label} <span>{filterCounts[option.value]}</span>
                </button>
              ))}
            </div>
          </section>

          <div className="library-results-meta" role="status">
            <span>{visibleScreens.length} of {screens.length} screens</span>
            {(query || filter !== 'active') && (
              <button
                type="button"
                className="btn btn-link"
                onClick={() => { setQuery(''); setFilter('active') }}
              >
                Clear filters
              </button>
            )}
          </div>

          {visibleScreens.length === 0 ? (
            <section className="library-empty library-no-results">
              <span className="section-kicker">No matching screens</span>
              <h2>Try another name, agent ID, or status</h2>
              <button type="button" className="btn btn-outline-secondary" onClick={() => { setQuery(''); setFilter('active') }}>
                Clear filters
              </button>
            </section>
          ) : (
            <section className="screen-library-grid" aria-label="Saved screens">
              {visibleScreens.map((screen) => {
                const name = screenName(screen)
                const versions = historyByScreen[screen.agent_id]
                const historyOpen = expandedHistory === screen.agent_id
                return (
                  <article
                    className={`screen-library-card${screen.is_archived ? ' is-archived' : ''}`}
                    key={screen.agent_id}
                  >
                    <div className="library-card-heading">
                      <span className="library-card-icon"><SparkIcon size={20} /></span>
                      <div>
                        <span className="section-kicker">
                          {screen.is_archived ? 'Archived screen' : screen.has_draft ? 'Working draft' : 'Published screen'}
                        </span>
                        <h2>{name}</h2>
                        {screen.name && <small>{screen.agent_id}</small>}
                      </div>
                      <div className="library-statuses">
                        {screen.is_archived && <span className="library-archived-status">Archived</span>}
                        {screen.has_draft && <span className="library-draft-status">Draft</span>}
                        {Number.isInteger(screen.latest_version) && (
                          <span className="library-version">v{screen.latest_version}</span>
                        )}
                      </div>
                    </div>

                    <p>
                      {Number.isInteger(screen.latest_version)
                        ? `${screen.version_count || screen.latest_version} published version${(screen.version_count || screen.latest_version) === 1 ? '' : 's'}${screen.has_unpublished_changes ? ' · unpublished edits saved' : screen.has_draft ? ' · draft is up to date' : ''}`
                        : 'Draft only · publish it when review and validation are complete'}
                    </p>

                    <div className="library-card-actions">
                      {!screen.is_archived && (
                        <Link className="btn btn-primary" to={screenPath('/builder', screen.agent_id, '/edit')}>
                          {screen.has_draft ? 'Open latest draft' : 'Create draft'}
                        </Link>
                      )}
                      {Number.isInteger(screen.latest_version) && (
                        <Link className="btn btn-outline-secondary" to={screenPath('/preview', screen.agent_id)}>
                          Preview latest
                        </Link>
                      )}
                      <button
                        type="button"
                        className="btn btn-outline-secondary"
                        onClick={() => openDialog('duplicate', screen)}
                        aria-label={`Duplicate ${name}`}
                      >
                        Duplicate
                      </button>
                    </div>

                    <div className="library-card-secondary-actions">
                      {Number.isInteger(screen.latest_version) && (
                        <button
                          type="button"
                          className="btn btn-link"
                          aria-expanded={historyOpen}
                          aria-controls={`history-${screen.agent_id}`}
                          onClick={() => toggleHistory(screen)}
                        >
                          {historyOpen ? 'Hide history' : `Version history (${screen.version_count || screen.latest_version})`}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-link library-archive-action"
                        onClick={() => openDialog('archive', screen)}
                        aria-label={`${screen.is_archived ? 'Unarchive' : 'Archive'} ${name}`}
                      >
                        {screen.is_archived ? 'Unarchive' : 'Archive'}
                      </button>
                      {Number.isInteger(screen.latest_version) && (
                        <Link className="btn btn-link" to={screenPath('/screens', screen.agent_id)}>
                          Published UI ↗
                        </Link>
                      )}
                    </div>

                    {historyOpen && (
                      <section className="library-history" id={`history-${screen.agent_id}`} aria-label={`Version history for ${name}`}>
                        <div className="library-history-heading">
                          <div>
                            <span className="section-kicker">Immutable versions</span>
                            <h3>Publication history</h3>
                          </div>
                          <span>{screen.version_count || screen.latest_version} total</span>
                        </div>
                        {historyLoading === screen.agent_id && <WorkspaceLoading message="Loading version history..." />}
                        {historyError && historyLoading !== screen.agent_id && (
                          <div className="alert alert-danger" role="alert">{historyError}</div>
                        )}
                        {versions?.length === 0 && <p className="library-history-empty">No published versions found.</p>}
                        {versions?.length > 0 && (
                          <ol className="library-version-list">
                            {versions.map((version) => (
                              <li key={version.version}>
                                <span className="library-version-number">v{version.version}</span>
                                <div>
                                  <strong>{version.change_summary || `Published version ${version.version}`}</strong>
                                  <small>{publishedDate(version)}</small>
                                </div>
                                <div className="library-version-actions">
                                  <Link className="btn btn-link" to={screenPath('/preview', screen.agent_id, `?version=${version.version}`)}>
                                    Preview
                                  </Link>
                                  {!screen.is_archived && (
                                    <button type="button" className="btn btn-link" onClick={() => openDialog('restore', screen, version)}>
                                      Restore
                                    </button>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ol>
                        )}
                      </section>
                    )}
                  </article>
                )
              })}
            </section>
          )}
        </>
      )}

      <LibraryDialog
        dialog={dialog}
        busy={dialogBusy}
        error={dialogError}
        duplicateName={duplicateName}
        onDuplicateName={setDuplicateName}
        onClose={() => setDialog(null)}
        onConfirm={confirmDialog}
      />
    </main>
  )
}
