import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  SparkIcon,
  WorkspaceLoading,
} from './RuntimePrimitives.jsx'

export {
  AgentGlyph,
  SparkIcon,
  WorkspaceLoading,
} from './RuntimePrimitives.jsx'

export function StudioLayout() {
  const location = useLocation()
  const builderActive = location.pathname.startsWith('/builder')
    || location.pathname.startsWith('/studio/agents')

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <Link className="brand" to="/library" aria-label="Agent Screen Studio home">
            <span className="brand-mark">
              <SparkIcon size={22} />
            </span>
            <span>
              <strong>Agent Screen</strong>
              <small>Studio</small>
            </span>
          </Link>

          <nav className="app-navigation" aria-label="Studio navigation">
            <Link
              className={builderActive ? 'is-active' : ''}
              to="/studio/agents/new"
              aria-current={builderActive ? 'page' : undefined}
            >
              Builder
            </Link>
            <NavLink
              className={({ isActive }) => (isActive ? 'is-active' : '')}
              to="/library"
            >
              Library
            </NavLink>
          </nav>

          <div className="header-status">
            <span className="status-dot" aria-hidden="true" />
            Validation guarded
          </div>
        </div>
      </header>

      <Outlet />

      <footer className="app-footer">
        <span>Agent Screen Studio</span>
        <span>AI proposed · Human approved · Backend validated</span>
      </footer>
    </div>
  )
}

export function NotFoundPage() {
  return (
    <main className="route-state-page">
      <span className="section-kicker">404</span>
      <h1>This screen does not exist</h1>
      <p>Return to the builder or choose a saved screen from the library.</p>
      <div className="route-state-actions">
        <Link className="btn btn-primary" to="/builder/new">
          Open builder
        </Link>
        <Link className="btn btn-outline-secondary" to="/library">
          View library
        </Link>
      </div>
    </main>
  )
}
