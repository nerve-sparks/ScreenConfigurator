import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'

export function SparkIcon({ size = 20 }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        d="M12 2.75c.5 4.47 2.78 6.75 7.25 7.25-4.47.5-6.75 2.78-7.25 7.25-.5-4.47-2.78-6.75-7.25-7.25C9.22 9.5 11.5 7.22 12 2.75Z"
        fill="currentColor"
      />
      <path
        d="M19 15.75c.2 1.8 1.2 2.8 3 3-1.8.2-2.8 1.2-3 3-.2-1.8-1.2-2.8-3-3 1.8-.2 2.8-1.2 3-3ZM5.25 2c.17 1.53.97 2.33 2.5 2.5-1.53.17-2.33.97-2.5 2.5-.17-1.53-.97-2.33-2.5-2.5 1.53-.17 2.33-.97 2.5-2.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function AgentGlyph({ icon = 'sparkles', size = 22 }) {
  if (icon === 'bolt') {
    return (
      <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M13.4 2.5 5.8 13h5.1l-.7 8.5L18.3 10h-5.1l.2-7.5Z" fill="currentColor" />
      </svg>
    )
  }
  if (icon === 'compass') {
    return (
      <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="m15.7 8.3-2.1 5.3-5.3 2.1 2.1-5.3 5.3-2.1Z" fill="currentColor" />
      </svg>
    )
  }
  if (icon === 'message') {
    return (
      <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M5.2 5.2h13.6v10.2H11l-4.4 3v-3H5.2V5.2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M8.3 9h7.4M8.3 12h4.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  return <SparkIcon size={size} />
}

export function WorkspaceLoading({ message }) {
  return (
    <div className="workspace-loading" role="status">
      <span className="loading-orb" aria-hidden="true">
        <SparkIcon size={22} />
      </span>
      <strong>{message}</strong>
    </div>
  )
}

export function StudioLayout() {
  const location = useLocation()
  const builderActive = location.pathname.startsWith('/builder')

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <Link className="brand" to="/builder/new" aria-label="Agent Screen Studio home">
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
              to="/builder/new"
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
