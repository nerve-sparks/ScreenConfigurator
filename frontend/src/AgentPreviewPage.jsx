import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import {
  loadAgentProject,
  loadAgentRelease,
  loadProjectScreenDraft,
  publishAgentProject,
} from './api.js'
import AgentFlow from './AgentFlow.jsx'
import { WorkspaceLoading } from './StudioShell.jsx'

export default function AgentPreviewPage() {
  const { agentId } = useParams()
  const location = useLocation()
  const [project, setProject] = useState(null)
  const [screens, setScreens] = useState([])
  const [releaseVersion, setReleaseVersion] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [submitted, setSubmitted] = useState(null)
  const [changeSummary, setChangeSummary] = useState('Initial agent release')
  const [publishing, setPublishing] = useState(false)
  const publishMode = new URLSearchParams(location.search).get('publish') === '1'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    Promise.all([
      loadAgentProject(agentId),
    ])
      .then(async ([loadedProject]) => {
        let loadedScreens
        let loadedReleaseVersion = null
        try {
          loadedScreens = await Promise.all(
            loadedProject.screen_ids.map((screenId) =>
              loadProjectScreenDraft(agentId, screenId)),
          )
          loadedScreens = loadedScreens.map((screen) => ({
            ...screen,
            manifest: screen.approved_manifest ?? screen.draft_manifest,
          }))
        } catch (draftError) {
          if (
            draftError.status !== 404
            || !Number.isInteger(loadedProject.latest_release)
          ) {
            throw draftError
          }
          const release = await loadAgentRelease(
            agentId,
            loadedProject.latest_release,
          )
          loadedScreens = release.screens
          loadedReleaseVersion = release.version
        }
        if (cancelled) return
        setProject(loadedProject)
        setScreens(loadedScreens)
        setReleaseVersion(loadedReleaseVersion)
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
  }, [agentId])

  const unapproved = useMemo(
    () => (
      releaseVersion
        ? []
        : screens.filter((screen) => !screen.approved_manifest)
    ),
    [releaseVersion, screens],
  )

  const handlePublish = async () => {
    setPublishing(true)
    setError('')
    setNotice('')
    try {
      const release = await publishAgentProject(agentId, {
        projectRevision: project.revision,
        screenRevisions: Object.fromEntries(
          screens.map((screen) => [screen.screen_id, screen.revision]),
        ),
        changeSummary: changeSummary.trim(),
      })
      setNotice(`Published ${project.name} release ${release.version}.`)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setPublishing(false)
    }
  }

  if (loading) {
    return <main className="app-main"><WorkspaceLoading message="Preparing the complete agent preview..." /></main>
  }
  if (error && !project) {
    return (
      <main className="route-state-page">
        <h1>Agent preview unavailable</h1>
        <p>{error}</p>
        <Link to={`/studio/agents/${encodeURIComponent(agentId)}`}>Return to workspace</Link>
      </main>
    )
  }

  return (
    <main className="app-main agent-preview-page">
      <section className="route-page-heading">
        <div>
          <span className="section-kicker">Complete agent preview</span>
          <h1>{project.name}</h1>
          <p>Test every ordered screen. Values remain in browser memory when moving back.</p>
          {releaseVersion && <small>Showing immutable release {releaseVersion} because no working draft exists.</small>}
        </div>
        <Link className="btn btn-outline-secondary" to={`/studio/agents/${encodeURIComponent(agentId)}`}>
          ← Agent workspace
        </Link>
      </section>

      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {unapproved.length > 0 && (
        <div className="alert alert-warning" role="alert">
          Previewing {unapproved.length} unapproved draft screen{unapproved.length === 1 ? '' : 's'}.
          Publishing remains blocked until each screen is approved.
        </div>
      )}

      <div className={`agent-preview-grid ${publishMode ? '' : 'is-solo'}`}>
        <AgentFlow
          screens={screens}
          screenIds={project.screen_ids}
          startScreenId={project.start_screen_id}
          agentName={project.name}
          agentDescription={project.description}
          onComplete={setSubmitted}
        />

        {publishMode && !releaseVersion && (
          <aside className="agent-publish-card">
            <span className="section-kicker">Immutable release</span>
            <h2>Publish the complete agent</h2>
            <p>
              Publication snapshots the current project revision, ordered
              navigation, and every approved screen in one document.
            </p>
            <dl>
              <div><dt>Screens</dt><dd>{screens.length}</dd></div>
              <div><dt>Approved</dt><dd>{screens.length - unapproved.length}/{screens.length}</dd></div>
            </dl>
            <label htmlFor="agent-change-summary">
              What changed?
              <textarea
                id="agent-change-summary"
                className="form-control"
                rows={4}
                maxLength={240}
                value={changeSummary}
                onChange={(event) => setChangeSummary(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={handlePublish}
              disabled={publishing || unapproved.length > 0 || !changeSummary.trim()}
            >
              {publishing ? 'Publishing release...' : 'Publish agent release'}
            </button>
            <small>Stale project or screen revisions are rejected safely.</small>
          </aside>
        )}
      </div>

      {submitted && (
        <section className="submission-result" aria-labelledby="agent-preview-result">
          <div>
            <span className="result-check" aria-hidden="true">✓</span>
            <div>
              <span className="section-kicker">Journey complete</span>
              <h2 id="agent-preview-result">All screens work together</h2>
            </div>
          </div>
          <p>Submitted values are grouped by screen ID; decorative content is excluded.</p>
          <pre>{JSON.stringify(submitted, null, 2)}</pre>
        </section>
      )}
    </main>
  )
}
