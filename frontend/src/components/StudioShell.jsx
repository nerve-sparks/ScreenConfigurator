import { Link, NavLink, Outlet } from 'react-router-dom'
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
  return (
    <div className="app-shell is-simple">
      <header className="app-header simple-header">
        <div className="app-header-inner">
          <Link className="brand" to="/library" aria-label="Agent Screen Studio home">
            <span className="brand-mark">
              <SparkIcon size={20} />
            </span>
            <span>
              <strong>Agent Screen</strong>
              <small>Studio</small>
            </span>
          </Link>

          <nav className="app-navigation" aria-label="Studio navigation">
            <NavLink
              className={({ isActive }) => (isActive ? 'is-active' : '')}
              to="/studio/agents/new"
            >
              New agent
            </NavLink>
            <NavLink
              className={({ isActive }) => (isActive ? 'is-active' : '')}
              to="/library"
            >
              Library
            </NavLink>
          </nav>
        </div>
      </header>

      <Outlet />
    </div>
  )
}

export function NotFoundPage() {
  return (
    <main className="route-state-page">
      <h1>Page not found</h1>
      <p>Return to create an agent or open the library.</p>
      <div className="route-state-actions">
        <Link className="btn btn-primary" to="/studio/agents/new">
          New agent
        </Link>
        <Link className="btn btn-outline-secondary" to="/library">
          Library
        </Link>
      </div>
    </main>
  )
}
