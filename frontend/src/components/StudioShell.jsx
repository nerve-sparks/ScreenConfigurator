import { useEffect, useId, useRef, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import {
  SparkIcon,
  WorkspaceLoading,
} from './RuntimePrimitives.jsx'
import { useAuth } from '../lib/AuthContext.jsx'
import {
  userDisplayName,
  userEmail,
  userInitials,
} from '../lib/userDisplay.js'

import xsparks_logo from "../assets/xparks_logo.svg"

export {
  AgentGlyph,
  SparkIcon,
  WorkspaceLoading,
} from './RuntimePrimitives.jsx'

function UserAvatar({ user, size = 'md' }) {
  return (
    <span
      className={`user-avatar user-avatar-${size}`}
      aria-hidden="true"
    >
      {userInitials(user)}
    </span>
  )
}

function UserMenu({ user }) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const rootRef = useRef(null)
  const name = userDisplayName(user)
  const email = userEmail(user)

  useEffect(() => {
    if (!open) return undefined

    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className={`user-menu${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="user-menu-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
      >
        <UserAvatar user={user} />
        <span className="user-menu-label">
          <strong>{name}</strong>
          {email ? <small>{email}</small> : null}
        </span>
      </button>

      {open ? (
        <div className="user-menu-panel" id={menuId} role="menu">
          <div className="user-menu-summary">
            {/* <UserAvatar user={user} size="lg" /> */}
            <div>
              <strong>{name}</strong>
              {email ? <span>{email}</span> : null}
            </div>
          </div>
          <Link
            role="menuitem"
            to="/settings"
            onClick={() => setOpen(false)}
          >
            Settings
          </Link>
          <Link
            role="menuitem"
            to="/library"
            onClick={() => setOpen(false)}
          >
            Library
          </Link>
          <Link
            role="menuitem"
            to="/studio/agents/new"
            onClick={() => setOpen(false)}
          >
            New agent
          </Link>
          <Link
            role="menuitem"
            className="is-danger"
            to="/logout"
            onClick={() => setOpen(false)}
          >
            Sign out
          </Link>
        </div>
      ) : null}
    </div>
  )
}

export function StudioLayout() {
  const { user } = useAuth()

  return (
    <div className="app-shell is-simple">
      <header className="app-header simple-header">
        <div className="app-header-inner">
          <Link className="brand" to="/library" aria-label="Agent Screen Studio home">
            <img src={xsparks_logo} alt="NerveSparks" className="brand-logo-image" width={240} height={40} />
          </Link>

          <div className="app-header-actions">
            <nav className="app-navigation" aria-label="Studio navigation">
              <NavLink
                className={({ isActive }) => (isActive ? 'is-active' : '')}
                to="/library"
                end
              >
                Library
              </NavLink>
              <NavLink
                className={({ isActive }) => (isActive ? 'is-active' : '')}
                to="/studio/agents/new"
              >
                New agent
              </NavLink>
              {/* <NavLink
                className={({ isActive }) => (isActive ? 'is-active' : '')}
                to="/settings"
              >
                Settings
              </NavLink> */}
            </nav>

            <UserMenu user={user} />
          </div>
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
      <p>Return to the library or create a new agent.</p>
      <div className="route-state-actions">
        <Link className="btn btn-primary" to="/library">
          Library
        </Link>
        <Link className="btn btn-outline-secondary" to="/studio/agents/new">
          New agent
        </Link>
      </div>
    </main>
  )
}
