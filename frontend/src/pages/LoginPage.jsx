import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import Button from '../components/ui/Button.jsx'
import ThemeToggle from '../components/ui/ThemeToggle.jsx'
import { Field, Input } from '../components/ui/Field.jsx'
import { Alert } from '../components/ui/Feedback.jsx'
import {
  ArrowLeft,
  Check,
  GitBranch,
  Shield,
  Sparkles,
} from '../components/ui/Icons.jsx'
import xsparksLogo from '../assets/xparks_logo.svg'
import '../auth.css'

const HIGHLIGHTS = [
  {
    icon: <Sparkles size={16} />,
    title: 'AI proposes, you approve',
    body: 'Screen plans and fields are generated for review — never published unreviewed.',
  },
  {
    icon: <Shield size={16} />,
    title: 'Validated before publish',
    body: 'Three server-side layers check every manifest for safety, structure, and semantics.',
  },
  {
    icon: <GitBranch size={16} />,
    title: 'Immutable releases',
    body: 'Publish atomically, restore any version, and never rewrite release history.',
  },
]

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
    <div className="auth">
      {/* ------------------------------------------------------- FORM SIDE */}
      <div className="auth-main">
        <header className="auth-topbar">
          <Link className="auth-brand" to="/" aria-label="Agent Screen Studio home">
            <img src={xsparksLogo} alt="NerveSparks" width={180} height={30} />
          </Link>
          <ThemeToggle />
        </header>

        <main className="auth-panel">
          <div className="auth-panel-inner">
            <Link className="auth-back" to="/">
              <ArrowLeft size={15} />
              Back to overview
            </Link>

            <h1>Sign in to Studio</h1>
            <p className="auth-sub">
              Use your NSAI account to open the agent library, build journeys,
              and publish releases.
            </p>

            {error ? (
              <Alert tone="error" title="Sign-in failed">{error}</Alert>
            ) : null}

            <form className="auth-form" onSubmit={handleSubmit} noValidate>
              <Field label="Email" htmlFor="login-email" required>
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                  disabled={busy}
                  invalid={Boolean(error)}
                  required
                />
              </Field>

              <Field label="Password" htmlFor="login-password" required>
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  disabled={busy}
                  invalid={Boolean(error)}
                  minLength={8}
                  required
                />
              </Field>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={busy}
              >
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>

            <p className="auth-note">
              Trouble signing in? Contact your workspace administrator.
            </p>
          </div>
        </main>

        <footer className="auth-footer">
          <span>&copy; {new Date().getFullYear()} NerveSparks</span>
          <Link to="/">Product overview</Link>
        </footer>
      </div>

      {/* ------------------------------------------------------ BRAND SIDE */}
      <aside className="auth-aside" aria-hidden="true">
        <div className="auth-aside-glow" />
        <div className="auth-aside-inner">
          <span className="auth-aside-kicker">Agent Screen Studio</span>
          <h2>
            From a sentence about your agent to a production input experience.
          </h2>

          <ul className="auth-highlights">
            {HIGHLIGHTS.map((item) => (
              <li key={item.title}>
                <span className="auth-highlight-icon">{item.icon}</span>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                </div>
              </li>
            ))}
          </ul>

          <div className="auth-aside-proof">
            <span className="auth-proof-item"><Check size={14} /> No raw HTML or scripts</span>
            <span className="auth-proof-item"><Check size={14} /> Secrets stay server-side</span>
            <span className="auth-proof-item"><Check size={14} /> Exportable frontends</span>
          </div>
        </div>
      </aside>
    </div>
  )
}
