import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import { SparkIcon } from '../components/RuntimePrimitives.jsx'

export default function LoginPage() {
  const { login, busy } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const redirectTo = location.state?.from && location.state.from !== '/login'
    ? location.state.from
    : '/library'

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    const trimmed = email.trim()
    if (!trimmed || !password) {
      setError('Enter your email and password.')
      return
    }

    try {
      await login({ email: trimmed, password })
      navigate(redirectTo, { replace: true })
    } catch (err) {
      setError(err?.message || 'Unable to sign in.')
    }
  }

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
        <section className="create-panel auth-panel" aria-labelledby="login-heading">
          <div className="create-panel-copy">
            <p className="auth-kicker">Agent Screen Studio</p>
            <h1 id="login-heading">Sign in</h1>
            <p>
              Use your NSAI account to open the agent library, build journeys,
              and publish releases.
            </p>
          </div>

          {error ? (
            <div className="simple-alert is-error" role="alert">
              {error}
            </div>
          ) : null}

          <form className="create-form auth-form" onSubmit={handleSubmit}>
            <label htmlFor="login-email">
              Email
              <input
                id="login-email"
                className="form-control"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                disabled={busy}
                required
              />
            </label>

            <label htmlFor="login-password">
              Password
              <input
                id="login-password"
                className="form-control"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                disabled={busy}
                minLength={8}
                required
              />
            </label>

            <div className="create-actions auth-actions">
              <button
                className="btn btn-primary"
                type="submit"
                disabled={busy}
              >
                {busy ? (
                  <>
                    <span className="button-spinner" aria-hidden="true" />
                    Signing in…
                  </>
                ) : (
                  'Sign in'
                )}
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  )
}
