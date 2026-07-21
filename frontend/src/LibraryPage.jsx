import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listScreens } from './api.js'
import { SparkIcon, WorkspaceLoading } from './StudioShell.jsx'

function screenPath(prefix, screenId, suffix = '') {
  return `${prefix}/${encodeURIComponent(screenId)}${suffix}`
}

export default function LibraryPage() {
  const [screens, setScreens] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setScreens(await listScreens())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <main className="app-main library-page">
      <section className="route-page-heading library-heading" aria-labelledby="library-title">
        <div>
          <span className="hero-eyebrow"><SparkIcon size={16} /> Saved configurations</span>
          <h1 id="library-title">Screen library</h1>
          <p>Choose the right route for the job: edit the configuration, test a clean preview, or open the published input UI.</p>
        </div>
        <Link className="btn btn-primary" to="/builder/new">+ Create new screen</Link>
      </section>

      {error && (
        <div className="library-error alert alert-danger" role="alert">
          <div>
            <strong>Could not load the screen library</strong>
            <span>{error}</span>
          </div>
          <button type="button" className="btn btn-outline-secondary" onClick={refresh}>Retry</button>
        </div>
      )}

      {loading && <WorkspaceLoading message="Loading saved screens..." />}

      {!loading && !error && screens.length === 0 && (
        <section className="library-empty">
          <span className="empty-spark"><SparkIcon size={32} /></span>
          <span className="section-kicker">No saved screens yet</span>
          <h2>Create and save your first agent input experience</h2>
          <p>It will appear here with separate edit, preview, and published routes.</p>
          <Link className="btn btn-primary" to="/builder/new">Open builder</Link>
        </section>
      )}

      {!loading && !error && screens.length > 0 && (
        <section className="screen-library-grid" aria-label="Saved screens">
          {screens.map((screen) => (
            <article className="screen-library-card" key={screen.agent_id}>
              <div className="library-card-heading">
                <span className="library-card-icon"><SparkIcon size={20} /></span>
                <div>
                  <span className="section-kicker">Saved screen</span>
                  <h2>{screen.agent_id}</h2>
                </div>
                <span className="library-version">v{screen.latest_version}</span>
              </div>
              <p>Latest immutable version: {screen.latest_version}</p>
              <div className="library-card-actions">
                <Link
                  className="btn btn-primary"
                  to={screenPath('/preview', screen.agent_id)}
                >
                  Preview
                </Link>
                <Link
                  className="btn btn-outline-secondary"
                  to={screenPath('/builder', screen.agent_id, '/edit')}
                >
                  Edit
                </Link>
                <Link
                  className="btn btn-link"
                  to={screenPath('/screens', screen.agent_id)}
                >
                  Open published ↗
                </Link>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  )
}
