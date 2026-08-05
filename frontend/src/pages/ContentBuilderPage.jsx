import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  loadProjectScreenDraft,
  saveProjectScreenDraft,
} from '../lib/api.js'
import ContentExperience from '../components/ContentExperience.jsx'
import LayoutEditor from '../components/LayoutEditor.jsx'
import { normalizePresentation, presentationStyle } from '../lib/presentation.js'
import { approveLayout } from '../lib/reviewModel.js'
import { AgentGlyph, WorkspaceLoading } from '../components/StudioShell.jsx'

const AUTOSAVE_DELAY = 600

function editorDraft(manifest, layoutApproved) {
  return {
    manifest: {
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
      },
      ui_hints: {
        mode: 'single',
        field_order: [],
        blocks: manifest.blocks,
      },
    },
    fields: {},
    deletedFields: [],
    layoutApproved: Boolean(layoutApproved),
  }
}

function contentManifest(draft) {
  return { blocks: draft.manifest.ui_hints.blocks }
}

export default function ContentBuilderPage() {
  const { agentId, screenId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const returnStep = new URLSearchParams(location.search).get('return') || 'approve'
  const returnPath = `/studio/agents/${encodeURIComponent(agentId)}?step=${encodeURIComponent(returnStep)}`
  const [document, setDocument] = useState(null)
  const [layoutDraft, setLayoutDraft] = useState(null)
  const [presentation, setPresentation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('Loading draft...')
  const [error, setError] = useState('')
  const lastSaved = useRef(null)
  const saveQueue = useRef(Promise.resolve())

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadProjectScreenDraft(agentId, screenId)
      .then((loaded) => {
        if (cancelled) return
        if (loaded.screen_type !== 'content') {
          throw new Error('This route can edit content screens only.')
        }
        const nextLayout = editorDraft(
          loaded.draft_manifest,
          loaded.editor_state?.layoutApproved,
        )
        const nextPresentation = normalizePresentation(loaded.presentation, {
          name: loaded.name,
          description: loaded.description,
        })
        setDocument(loaded)
        setLayoutDraft(nextLayout)
        setPresentation(nextPresentation)
        lastSaved.current = JSON.stringify({
          manifest: loaded.draft_manifest,
          presentation: nextPresentation,
          editorState: { layoutApproved: nextLayout.layoutApproved },
        })
        setStatus('Draft saved')
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [agentId, screenId])

  const snapshot = useMemo(() => {
    if (!layoutDraft || !presentation || !document) return null
    return JSON.stringify({
      manifest: contentManifest(layoutDraft),
      presentation,
      editorState: { layoutApproved: layoutDraft.layoutApproved },
    })
  }, [document, layoutDraft, presentation])

  useEffect(() => {
    if (!snapshot || snapshot === lastSaved.current || loading) return undefined
    let cancelled = false
    setStatus('Unsaved changes')
    const timer = window.setTimeout(() => {
      setSaving(true)
      setStatus('Saving draft...')
      const manifest = contentManifest(layoutDraft)
      const operation = saveQueue.current
        .catch(() => undefined)
        .then(() => saveProjectScreenDraft(agentId, screenId, {
          screenType: 'content',
          purpose: document.purpose,
          manifest,
          description: document.description,
          name: document.name,
          source: document.source,
          presentation,
          editorState: { layoutApproved: layoutDraft.layoutApproved },
          generation: document.generation ?? {},
        }))
      saveQueue.current = operation
      operation
        .then((saved) => {
          lastSaved.current = snapshot
          if (cancelled) return
          setDocument(saved)
          setStatus('Draft saved')
        })
        .catch((requestError) => {
          if (!cancelled) {
            setError(`Draft autosave failed: ${requestError.message}`)
            setStatus('Draft save failed')
          }
        })
        .finally(() => {
          if (!cancelled) setSaving(false)
        })
    }, AUTOSAVE_DELAY)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    agentId,
    document,
    layoutDraft,
    loading,
    presentation,
    screenId,
    snapshot,
  ])

  const handleApprove = async () => {
    const approved = approveLayout(layoutDraft)
    const manifest = contentManifest(approved)
    setSaving(true)
    setError('')
    try {
      await saveQueue.current.catch(() => undefined)
      const saved = await saveProjectScreenDraft(agentId, screenId, {
        screenType: 'content',
        purpose: document.purpose,
        manifest,
        approvedManifest: manifest,
        description: document.description,
        name: document.name,
        source: document.source,
        presentation,
        editorState: { layoutApproved: true },
        generation: document.generation ?? {},
      })
      setLayoutDraft(approved)
      setDocument(saved)
      const nextSnapshot = JSON.stringify({
        manifest,
        presentation,
        editorState: { layoutApproved: true },
      })
      lastSaved.current = nextSnapshot
      setStatus('Content approved')
      navigate(returnPath)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <main className="app-main"><WorkspaceLoading message="Opening content screen..." /></main>
  }
  if (error && !document) {
    return (
      <main className="route-state-page">
        <h1>Content screen unavailable</h1>
        <p>{error}</p>
        <Link to={returnPath}>Back to approve</Link>
      </main>
    )
  }

  return (
    <main className="content-builder-page" style={presentationStyle(presentation)}>
      <header className="content-builder-header">
        <div>
          <span className="section-kicker">Content screen</span>
          <h1>{document.name}</h1>
          <code>{screenId}</code>
        </div>
        <div>
          <span className={`badge ${layoutDraft.layoutApproved ? 'badge-success' : 'badge-warning'}`}>
            {layoutDraft.layoutApproved ? 'Approved' : 'Needs approval'}
          </span>
          <span className="content-save-status">{status}</span>
          <Link className="btn btn-outline-secondary" to={returnPath}>
            Back to approve
          </Link>
          <button
            type="button"
            className="btn btn-success"
            onClick={handleApprove}
            disabled={saving || layoutDraft.layoutApproved}
          >
            Approve &amp; return
          </button>
        </div>
      </header>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      <div className="content-builder-shell">
        <section className="content-builder-preview">
          <span className="section-kicker">Live preview</span>
          <ContentExperience
            manifest={contentManifest(layoutDraft)}
            presentation={presentation}
            name={document.name}
            description={document.description}
          />
        </section>
        <section className="content-builder-editor">
          <LayoutEditor
            draft={layoutDraft}
            onChange={setLayoutDraft}
            disabled={saving}
            showApproval={false}
          />
        </section>
        <aside className="content-builder-appearance">
          <span className="section-kicker">Screen appearance</span>
          <h2>Presentation</h2>
          <label>
            Welcome title
            <input
              className="form-control"
              value={presentation.welcome_title}
              onChange={(event) => setPresentation((current) => ({
                ...current,
                welcome_title: event.target.value,
              }))}
              maxLength={100}
            />
          </label>
          <label>
            Welcome description
            <textarea
              className="form-control"
              value={presentation.welcome_description}
              onChange={(event) => setPresentation((current) => ({
                ...current,
                welcome_description: event.target.value,
              }))}
              maxLength={240}
              rows={5}
            />
          </label>
          <div className="content-agent-mark">
            <AgentGlyph icon={presentation.icon} size={20} />
            <span>Agent-level branding remains controlled by the creator.</span>
          </div>
        </aside>
      </div>
    </main>
  )
}
