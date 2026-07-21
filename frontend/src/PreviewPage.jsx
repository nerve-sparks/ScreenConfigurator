import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { loadScreen, publishDraft } from './api.js'
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
  const [publishing, setPublishing] = useState(false)
  const [changeSummary, setChangeSummary] = useState('Initial published version')
  const [submitted, setSubmitted] = useState(null)
  const [formKey, setFormKey] = useState(0)

  useEffect(() => {
    if (statePreview) {
      setPayload(statePreview)
      setLoading(false)
      setError(null)
      savePreviewDraft(statePreview)
      return undefined
    }

    if (isDraftRoute) {
      const stored = loadPreviewDraft()
      if (stored) {
        setPayload(stored)
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
    const requestedVersion = Number.parseInt(
      new URLSearchParams(location.search).get('version'),
      10,
    )
    loadScreen(screenId, Number.isInteger(requestedVersion) ? requestedVersion : null)
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
  }, [isDraftRoute, location.search, screenId, statePreview])

  const handlePublish = async () => {
    if (!payload?.draftAgentId || !payload?.draftRevision) return
    setPublishing(true)
    setError(null)
    setNotice(null)
    try {
      const result = await publishDraft(payload.draftAgentId, {
        draftRevision: payload.draftRevision,
        changeSummary: changeSummary.trim(),
      })
      const publishedPayload = {
        ...payload,
        name: result.agent_id,
        savedAgentId: result.agent_id,
        version: result.version,
        returnPath: encodedPath('/builder', result.agent_id, '/edit'),
        reviewDraft: null,
      }
      setPayload(publishedPayload)
      setNotice(`Published “${result.agent_id}” version ${result.version}.`)
      savePreviewDraft(publishedPayload)
      navigate(`${encodedPath('/preview', result.agent_id)}?version=${result.version}`, {
        replace: true,
        state: { preview: publishedPayload },
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setPublishing(false)
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
  const savedAgentId = payload.version
    ? (payload.savedAgentId ?? (!isDraftRoute ? screenId : null))
    : null
  const canPublishDraft = Boolean(
    payload.reviewDraft && payload.draftAgentId && payload.draftRevision,
  )
  const editorAgentId = payload.draftAgentId ?? savedAgentId
  const builderPath = payload.returnPath ?? (editorAgentId
    ? encodedPath('/builder', editorAgentId, '/edit')
    : '/builder/new')
  const builderState = payload.reviewDraft
    ? {
        builderDraft: {
          description: payload.description ?? '',
          sourceDescription: payload.sourceDescription ?? payload.description ?? '',
          reviewDraft: payload.reviewDraft,
          presentation: payload.presentation,
          savedVersion: payload.version ?? null,
          draftAgentId: payload.draftAgentId,
          draftRevision: payload.draftRevision,
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
              to={`${encodedPath('/screens', savedAgentId)}?version=${payload.version}`}
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

      <div className={`preview-grid ${canPublishDraft ? '' : 'preview-grid-solo'}`}>
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
            agentName={savedAgentId ?? payload.draftAgentId ?? payload.name}
          />
        </div>

        {canPublishDraft && (
          <aside className="save-screen-card">
            <span className="save-card-icon" aria-hidden="true">↑</span>
            <span className="section-kicker">Draft validated</span>
            <h2>Publish this version</h2>
            <p>Your working draft is already saved. Publishing creates one immutable version without storing test inputs.</p>
            <div className="form-group">
              <label htmlFor="screen-id">Screen ID</label>
              <input
                id="screen-id"
                className="form-control"
                type="text"
                value={payload.draftAgentId}
                readOnly
              />
            </div>
            <div className="form-group">
              <label htmlFor="change-summary">What changed?</label>
              <textarea
                id="change-summary"
                className="form-control"
                rows={3}
                maxLength={240}
                value={changeSummary}
                onChange={(event) => setChangeSummary(event.target.value)}
                placeholder="Summarize this version"
              />
            </div>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={handlePublish}
              disabled={publishing || !changeSummary.trim()}
            >
              {publishing ? 'Publishing...' : 'Publish version'}
            </button>
            <small>Publishing the same draft revision twice is safely idempotent.</small>
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
