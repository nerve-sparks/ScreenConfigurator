import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { loadScreen, saveScreen } from './api.js'
import { isWizardManifest } from './manifestLayout.js'
import ScreenExperience from './ScreenExperience.jsx'
import { normalizePresentation } from './presentation.js'
import { loadPreviewDraft, savePreviewDraft } from './routeDraft.js'
import { WorkspaceLoading } from './StudioShell.jsx'

function encodedPath(prefix, screenId, suffix = '') {
  return `${prefix}/${encodeURIComponent(screenId)}${suffix}`
}

export default function PreviewPage() {
  const { screenId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const statePreview = location.state?.preview
  const isDraftRoute = screenId === 'draft'
  const [payload, setPayload] = useState(
    () => statePreview ?? (isDraftRoute ? loadPreviewDraft() : null),
  )
  const [loading, setLoading] = useState(!statePreview && !isDraftRoute)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState(statePreview?.name ?? '')
  const [submitted, setSubmitted] = useState(null)
  const [formKey, setFormKey] = useState(0)

  useEffect(() => {
    if (statePreview) {
      setPayload(statePreview)
      setName(statePreview.name ?? '')
      setLoading(false)
      setError(null)
      savePreviewDraft(statePreview)
      return undefined
    }

    if (isDraftRoute) {
      const stored = loadPreviewDraft()
      if (stored) {
        setPayload(stored)
        setName(stored.name ?? '')
        setError(null)
      } else {
        setError('This preview draft is no longer available. Return to the builder and validate it again.')
      }
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    loadScreen(screenId)
      .then((document) => {
        if (cancelled) return
        if (!document?.manifest?.input_schema) {
          throw new Error('Saved screen is missing its manifest.')
        }
        setPayload({
          manifest: document.manifest,
          description: document.description ?? '',
          name: document.agent_id,
          savedAgentId: document.agent_id,
          version: document.version,
          presentation: normalizePresentation(document.presentation, {
            name: document.agent_id,
            description: document.description ?? '',
          }),
          returnPath: encodedPath('/builder', document.agent_id, '/edit'),
          reviewDraft: null,
        })
        setName(document.agent_id)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [isDraftRoute, screenId, statePreview])

  const handleSave = async () => {
    if (!payload?.manifest) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const result = await saveScreen({
        manifest: payload.manifest,
        description: payload.description ?? '',
        name,
        presentation: normalizePresentation(payload.presentation, {
          name,
          description: payload.description ?? '',
        }),
      })
      const savedPayload = {
        ...payload,
        name: result.agent_id,
        savedAgentId: result.agent_id,
        version: result.version,
        returnPath: encodedPath('/builder', result.agent_id, '/edit'),
        reviewDraft: null,
      }
      setPayload(savedPayload)
      setName(result.agent_id)
      setNotice(`Saved as “${result.agent_id}” version ${result.version}.`)
      savePreviewDraft(savedPayload)
      navigate(encodedPath('/preview', result.agent_id), {
        replace: true,
        state: { preview: savedPayload },
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <main className="route-state-page">
        <WorkspaceLoading message="Loading preview..." />
      </main>
    )
  }

  if (error && !payload) {
    return (
      <main className="route-state-page">
        <span className="section-kicker">Preview unavailable</span>
        <h1>We could not open this preview</h1>
        <div className="alert alert-danger" role="alert">{error}</div>
        <div className="route-state-actions">
          <Link className="btn btn-primary" to="/builder/new">Open builder</Link>
          <Link className="btn btn-outline-secondary" to="/library">View library</Link>
        </div>
      </main>
    )
  }

  if (!payload?.manifest) return null

  const fieldCount = Object.keys(payload.manifest.input_schema?.properties ?? {}).length
  const wizardMode = isWizardManifest(payload.manifest)
  const savedAgentId = payload.savedAgentId ?? (!isDraftRoute ? screenId : null)
  const canSaveDraft = Boolean(payload.reviewDraft) || isDraftRoute
  const builderPath = payload.returnPath ?? (savedAgentId
    ? encodedPath('/builder', savedAgentId, '/edit')
    : '/builder/new')
  const builderState = payload.reviewDraft
    ? {
        builderDraft: {
          description: payload.description ?? '',
          sourceDescription: payload.sourceDescription ?? payload.description ?? '',
          reviewDraft: payload.reviewDraft,
          presentation: payload.presentation,
          savedVersion: payload.version ?? null,
        },
      }
    : undefined

  return (
    <main className="app-main preview-route-page">
      <section className="route-page-heading" aria-labelledby="preview-title">
        <div>
          <span className="section-kicker">Isolated preview</span>
          <h1 id="preview-title">Test the generated input experience</h1>
          <p>Only the user-facing form is shown below; description and field-editing controls remain in the builder.</p>
        </div>
        <div className="route-heading-actions">
          <Link className="btn btn-outline-secondary" to={builderPath} state={builderState}>
            ← Back to builder
          </Link>
          {savedAgentId && (
            <Link
              className="btn btn-primary"
              to={encodedPath('/screens', savedAgentId)}
            >
              Open published screen
            </Link>
          )}
        </div>
      </section>

      {(error || notice) && (
        <div className="message-stack route-message-stack">
          {error && <div className="alert alert-danger" role="alert">{error}</div>}
          {notice && <div className="alert alert-success" role="status">{notice}</div>}
        </div>
      )}

      <div className={`preview-grid ${canSaveDraft ? '' : 'preview-grid-solo'}`}>
        <div>
          <div className="preview-route-meta" aria-label="Preview details">
            <span>{wizardMode ? 'Guided wizard' : 'Single screen'}</span>
            <span>{fieldCount} {fieldCount === 1 ? 'input' : 'inputs'}</span>
            <span>Backend validated</span>
            {payload.version && <span>Version {payload.version}</span>}
          </div>
          <ScreenExperience
            formKey={formKey}
            manifest={payload.manifest}
            onSubmit={(formData) => setSubmitted(formData)}
            presentation={payload.presentation}
            description={payload.description ?? ''}
            agentName={savedAgentId ?? name}
          />
        </div>

        {canSaveDraft && (
          <aside className="save-screen-card">
            <span className="save-card-icon" aria-hidden="true">↓</span>
            <span className="section-kicker">Reusable screen</span>
            <h2>Save this configuration</h2>
            <p>Saving creates a new immutable version and makes the clean published route available.</p>
            <div className="form-group">
              <label htmlFor="screen-name">Screen name</label>
              <input
                id="screen-name"
                className="form-control"
                type="text"
                placeholder="e.g. Email Agent"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save screen'}
            </button>
            <small>Leaving the name empty creates one from the agent brief.</small>
          </aside>
        )}
      </div>

      {submitted !== null && (
        <section className="submission-result" aria-labelledby="submission-heading">
          <div>
            <span className="result-check" aria-hidden="true">✓</span>
            <div>
              <span className="section-kicker">Test submission</span>
              <h2 id="submission-heading">The isolated input screen works</h2>
            </div>
          </div>
          <pre>{JSON.stringify(submitted, null, 2)}</pre>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => {
              setSubmitted(null)
              setFormKey((key) => key + 1)
            }}
          >
            Reset test
          </button>
        </section>
      )}
    </main>
  )
}
