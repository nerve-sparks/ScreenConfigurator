import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import { SparkIcon, WorkspaceLoading } from '../components/RuntimePrimitives.jsx'

export default function LogoutPage() {
  const { logout } = useAuth()
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        await logout()
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Signed out locally.')
      } finally {
        // Always send the user to login after sign-out.
        window.location.replace('/login')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [logout])

  return (
    <div className="app-shell is-simple auth-shell">
      <header className="app-header simple-header">
        <div className="app-header-inner">
          <Link className="brand" to="/login" aria-label="Agent Screen Studio">
            <span className="brand-mark">
              <SparkIcon size={20} />
            </span>
            <span>
              <strong>Agent Screen</strong>
              <small>Studio</small>
            </span>
          </Link>
        </div>
      </header>

      <main className="auth-page">
        <section className="create-panel auth-panel">
          <div className="create-panel-copy">
            <h1>Signing out</h1>
            <p>Clearing your session and returning to sign in.</p>
          </div>
          {error ? (
            <div className="simple-alert is-error" role="alert">
              {error}
            </div>
          ) : (
            <WorkspaceLoading message="Signing out…" />
          )}
        </section>
      </main>
    </div>
  )
}
