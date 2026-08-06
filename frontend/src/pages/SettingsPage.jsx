import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import { getApiBaseUrl } from '../lib/api.js'
import {
  userDisplayName,
  userEmail,
  userInitials,
} from '../lib/userDisplay.js'
import { SparkIcon } from '../components/RuntimePrimitives.jsx'

export default function SettingsPage() {
  const { user } = useAuth()
  const name = userDisplayName(user)
  const email = userEmail(user)
  const initials = userInitials(user)
  const apiBase = getApiBaseUrl()

  return (
    <main className="app-main settings-page">
      <section className="route-page-heading settings-heading" aria-labelledby="settings-title">
        <div>
          <span className="hero-eyebrow">
            <SparkIcon size={16} /> Account
          </span>
          <h1 id="settings-title">Settings</h1>
          <p>Profile, session, and studio connection details.</p>
        </div>
      </section>

      <section className="settings-profile" aria-labelledby="profile-heading">
        <div className="settings-profile-identity">
          <span className="user-avatar user-avatar-lg" aria-hidden="true">
            {initials}
          </span>
          <div>
            <h2 id="profile-heading">{name}</h2>
            {email ? <p className="settings-email">{email}</p> : (
              <p className="settings-email">Signed in to Agent Screen Studio</p>
            )}
            {user?.role ? (
              <span className="settings-role">{user.role}</span>
            ) : null}
          </div>
        </div>

        <dl className="settings-meta">
          <div>
            <dt>Display name</dt>
            <dd>{name}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{email || '—'}</dd>
          </div>
          {user?.uid || user?.sub ? (
            <div>
              <dt>User ID</dt>
              <dd className="settings-mono">{user.uid || user.sub}</dd>
            </div>
          ) : null}
          {user?.tenant_id || user?.tenantId ? (
            <div>
              <dt>Tenant</dt>
              <dd className="settings-mono">{user.tenant_id || user.tenantId}</dd>
            </div>
          ) : null}
        </dl>

        <div className="settings-actions">
              <Link className="btn btn-primary" to="/logout">
            Sign out
          </Link>
        </div>
      </section>
    </main>
  )
}
