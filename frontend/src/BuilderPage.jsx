import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { generate, loadScreen, validateScreen } from './api.js'
import { isWizardManifest } from './manifestLayout.js'
import {
  REVIEW_STATUS,
  buildApprovedManifest,
  canContinueReview,
  createReviewDraft,
  orderedReviewFields,
  reviewProgress,
  setFieldRequired,
  setFieldStatus,
} from './reviewModel.js'
import {
  ACCENT_COLORS,
  AGENT_ICONS,
  normalizePresentation,
  presentationStyle,
} from './presentation.js'
import { savePreviewDraft } from './routeDraft.js'
import ScreenExperience from './ScreenExperience.jsx'
import { AgentGlyph, SparkIcon, WorkspaceLoading } from './StudioShell.jsx'

const ManifestReview = lazy(() => import('./ManifestReview.jsx'))

const AGENT_EXAMPLES = [
  {
    label: 'Email assistant',
    description:
      'An email assistant that asks for recipients, subject, message, tone, and an optional send time.',
  },
  {
    label: 'Research agent',
    description:
      'A research agent that asks for a topic, target audience, depth, trusted sources, and output format.',
  },
  {
    label: 'Support triage',
    description:
      'A customer support triage agent that collects the issue, urgency, product area, account ID, and attachments.',
  },
]

const DEVICE_OPTIONS = [
  { value: 'desktop', label: 'Desktop', icon: '▭' },
  { value: 'tablet', label: 'Tablet', icon: '▯' },
  { value: 'mobile', label: 'Mobile', icon: '▯' },
]

function DeviceToggle({ value, onChange }) {
  return (
    <div className="device-toggle" role="group" aria-label="Preview device">
      {DEVICE_OPTIONS.map((device) => (
        <button
          key={device.value}
          type="button"
          className={value === device.value ? 'is-active' : ''}
          aria-label={`${device.label} preview`}
          aria-pressed={value === device.value}
          onClick={() => onChange(device.value)}
        >
          <span aria-hidden="true">{device.icon}</span>
          <span>{device.label}</span>
        </button>
      ))}
    </div>
  )
}

function EditorEmptyState({ loading }) {
  if (loading) return <WorkspaceLoading message="Opening saved screen..." />
  return (
    <div className="editor-empty-state">
      <span className="editor-empty-icon"><SparkIcon size={30} /></span>
      <span className="section-kicker">Canvas ready</span>
      <h2>Describe an agent to create its input experience</h2>
      <p>The live canvas will appear here after the AI proposes the first set of fields.</p>
      <div className="editor-empty-steps" aria-label="Creation workflow">
        <span><strong>01</strong> Write the brief</span>
        <span><strong>02</strong> Review field cards</span>
        <span><strong>03</strong> Validate and preview</span>
      </div>
    </div>
  )
}

function AppearanceInspector({
  presentation,
  onChange,
  selectedField,
  onReviewChange,
  wizardMode,
  disabled,
}) {
  const updatePresentation = (key, value) => {
    onChange((current) => ({ ...current, [key]: value }))
  }

  const updateSelected = (updater) => {
    if (!selectedField || disabled) return
    onReviewChange((current) => updater(current, selectedField.name))
  }

  return (
    <aside id="appearance" className="editor-inspector" aria-label="Appearance properties">
      <div className="inspector-heading">
        <span className="section-kicker">Properties</span>
        <h2>Agent identity</h2>
        <p>These settings affect preview and published routes, never the validated manifest.</p>
      </div>

      <div className="inspector-section">
        <label htmlFor="agent-display-name">Agent name</label>
        <input
          id="agent-display-name"
          className="form-control"
          value={presentation.display_name}
          onChange={(event) => updatePresentation('display_name', event.target.value)}
          placeholder="e.g. Research Copilot"
          maxLength={80}
          disabled={disabled}
        />
      </div>

      <fieldset className="inspector-section icon-property">
        <legend>Agent icon</legend>
        <div className="icon-choice-grid">
          {AGENT_ICONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-label={`${option.label} icon`}
              aria-pressed={presentation.icon === option.value}
              className={presentation.icon === option.value ? 'is-selected' : ''}
              onClick={() => updatePresentation('icon', option.value)}
              disabled={disabled}
            >
              <AgentGlyph icon={option.value} size={20} />
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="inspector-section color-property">
        <legend>Accent color</legend>
        <div className="color-choice-row">
          {ACCENT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Use ${color} accent`}
              aria-pressed={presentation.accent_color === color}
              className={presentation.accent_color === color ? 'is-selected' : ''}
              style={{ backgroundColor: color }}
              onClick={() => updatePresentation('accent_color', color)}
              disabled={disabled}
            />
          ))}
          <input
            type="color"
            aria-label="Custom accent color"
            value={presentation.accent_color}
            onChange={(event) => updatePresentation('accent_color', event.target.value)}
            disabled={disabled}
          />
        </div>
      </fieldset>

      <div className="inspector-section">
        <label htmlFor="welcome-title">Welcome title</label>
        <input
          id="welcome-title"
          className="form-control"
          value={presentation.welcome_title}
          onChange={(event) => updatePresentation('welcome_title', event.target.value)}
          maxLength={100}
          disabled={disabled}
        />
      </div>

      <div className="inspector-section">
        <label htmlFor="welcome-description">Welcome description</label>
        <textarea
          id="welcome-description"
          className="form-control"
          rows={3}
          value={presentation.welcome_description}
          onChange={(event) => updatePresentation('welcome_description', event.target.value)}
          maxLength={240}
          disabled={disabled}
        />
      </div>

      <div className="inspector-section">
        <label htmlFor="submit-label">Submit button label</label>
        <input
          id="submit-label"
          className="form-control"
          value={presentation.submit_label}
          onChange={(event) => updatePresentation('submit_label', event.target.value)}
          maxLength={40}
          disabled={disabled}
        />
      </div>

      <div className="inspector-section inspector-switch-row">
        <div>
          <strong>Final answer summary</strong>
          <small>{wizardMode ? 'Adds a review step before submission.' : 'Used when this screen becomes a wizard.'}</small>
        </div>
        <label className="editor-switch">
          <input
            type="checkbox"
            aria-label="Show final answer summary"
            checked={presentation.show_summary}
            onChange={(event) => updatePresentation('show_summary', event.target.checked)}
            disabled={disabled}
          />
          <span />
        </label>
      </div>

      <div className="inspector-divider" />

      <div className="inspector-heading inspector-field-heading">
        <span className="section-kicker">Selected input</span>
        <h2>{selectedField?.schema.title ?? 'No input selected'}</h2>
        <p>{selectedField ? 'Adjust approval and requirement settings here.' : 'Choose Inspect on a field card to see its properties.'}</p>
      </div>

      {selectedField && (
        <div className="selected-field-properties">
          <div className="selected-field-meta">
            <code>{selectedField.name}</code>
            <span>{selectedField.schema.format ?? selectedField.schema.type}</span>
            <span className={`badge badge-${selectedField.review.status === REVIEW_STATUS.APPROVED ? 'success' : selectedField.review.status === REVIEW_STATUS.REJECTED ? 'warning' : 'secondary'}`}>
              {selectedField.review.status}
            </span>
          </div>
          {selectedField.schema.description && <p>{selectedField.schema.description}</p>}
          <div className="inspector-switch-row">
            <div>
              <strong>Required input</strong>
              <small>Users must provide a value.</small>
            </div>
            <label className="editor-switch">
              <input
                type="checkbox"
                aria-label={`Require ${selectedField.schema.title ?? selectedField.name}`}
                checked={selectedField.required}
                onChange={(event) => updateSelected((draft, name) => setFieldRequired(draft, name, event.target.checked))}
                disabled={disabled}
              />
              <span />
            </label>
          </div>
          <div className="selected-field-actions">
            <button
              type="button"
              className="btn btn-sm btn-outline-success"
              onClick={() => updateSelected((draft, name) => setFieldStatus(draft, name, REVIEW_STATUS.APPROVED))}
              disabled={disabled || selectedField.review.status === REVIEW_STATUS.APPROVED}
            >
              Approve
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline-warning"
              onClick={() => updateSelected((draft, name) => setFieldStatus(draft, name, REVIEW_STATUS.REJECTED))}
              disabled={disabled || selectedField.review.status === REVIEW_STATUS.REJECTED}
            >
              Exclude
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}

export default function BuilderPage() {
  const { screenId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const resumed = location.state?.builderDraft
  const editing = Boolean(screenId)
  const returnPath = editing ? `/builder/${encodeURIComponent(screenId)}/edit` : '/builder/new'

  const initialState = useMemo(
    () => ({
      description: resumed?.description ?? '',
      sourceDescription: resumed?.sourceDescription ?? resumed?.description ?? '',
      reviewDraft: resumed?.reviewDraft ?? null,
      presentation: normalizePresentation(resumed?.presentation, {
        name: screenId ?? '',
        description: resumed?.description ?? '',
      }),
      savedVersion: resumed?.savedVersion ?? null,
    }),
    [resumed, screenId],
  )

  const [description, setDescription] = useState(initialState.description)
  const [sourceDescription, setSourceDescription] = useState(initialState.sourceDescription)
  const [reviewDraft, setReviewDraft] = useState(initialState.reviewDraft)
  const [presentation, setPresentation] = useState(initialState.presentation)
  const [savedVersion, setSavedVersion] = useState(initialState.savedVersion)
  const [selectedFieldName, setSelectedFieldName] = useState(null)
  const [device, setDevice] = useState('desktop')
  const [loading, setLoading] = useState(false)
  const [loadingSaved, setLoadingSaved] = useState(editing && !resumed)
  const [validatingReview, setValidatingReview] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const fields = useMemo(() => orderedReviewFields(reviewDraft), [reviewDraft])
  const selectedField = fields.find((field) => field.name === selectedFieldName) ?? null
  const progress = reviewProgress(reviewDraft)
  const reviewedCount = progress.approved + progress.rejected
  const progressPercent = progress.total ? Math.round((reviewedCount / progress.total) * 100) : 0
  const wizardMode = Boolean(reviewDraft && isWizardManifest(reviewDraft.manifest))
  const projectTitle = presentation.display_name || screenId || 'Untitled agent'

  useEffect(() => {
    if (fields.length === 0) {
      setSelectedFieldName(null)
      return
    }
    if (!fields.some((field) => field.name === selectedFieldName)) {
      setSelectedFieldName(fields[0].name)
    }
  }, [fields, selectedFieldName])

  useEffect(() => {
    if (resumed) {
      setDescription(resumed.description ?? '')
      setSourceDescription(resumed.sourceDescription ?? resumed.description ?? '')
      setReviewDraft(resumed.reviewDraft ?? null)
      setPresentation(normalizePresentation(resumed.presentation, {
        name: screenId ?? '',
        description: resumed.description ?? '',
      }))
      setSavedVersion(resumed.savedVersion ?? null)
      setLoadingSaved(false)
      return undefined
    }

    if (!screenId) {
      setDescription('')
      setSourceDescription('')
      setReviewDraft(null)
      setPresentation(normalizePresentation(null))
      setSavedVersion(null)
      setLoadingSaved(false)
      setError(null)
      setNotice(null)
      return undefined
    }

    let cancelled = false
    setLoadingSaved(true)
    setError(null)
    setNotice(null)
    loadScreen(screenId)
      .then((document) => {
        if (cancelled) return
        if (!document?.manifest?.input_schema) throw new Error('Saved screen is missing its manifest.')
        setDescription(document.description ?? '')
        setSourceDescription(document.description ?? '')
        setPresentation(normalizePresentation(document.presentation, {
          name: document.agent_id,
          description: document.description ?? '',
        }))
        setSavedVersion(document.version)
        setReviewDraft(createReviewDraft(document.manifest, {
          status: REVIEW_STATUS.APPROVED,
          origin: 'saved',
        }))
        setNotice(`Editing “${document.agent_id}” version ${document.version}.`)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoadingSaved(false)
      })

    return () => {
      cancelled = true
    }
  }, [resumed, screenId])

  const handleGenerate = async () => {
    setLoading(true)
    setError(null)
    setNotice(null)
    setReviewDraft(null)
    try {
      const cleanDescription = description.trim()
      const result = await generate(cleanDescription)
      if (!result?.input_schema) throw new Error('Backend response is missing “input_schema”.')
      setReviewDraft(createReviewDraft(result))
      setSourceDescription(cleanDescription)
      setPresentation((current) => normalizePresentation(current, {
        name: screenId ?? '',
        description: cleanDescription,
      }))
      setNotice('AI suggestions are ready. Review every field before previewing.')
    } catch (err) {
      setReviewDraft(null)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleReviewComplete = async () => {
    if (!reviewDraft) return
    setValidatingReview(true)
    setError(null)
    setNotice(null)
    try {
      const candidate = buildApprovedManifest(reviewDraft)
      const manifest = await validateScreen(candidate)
      const preview = {
        manifest,
        description: sourceDescription,
        name: screenId ?? presentation.display_name,
        presentation: normalizePresentation(presentation, {
          name: screenId ?? '',
          description: sourceDescription,
        }),
        returnPath,
        reviewDraft,
        sourceDescription,
        savedVersion,
      }
      savePreviewDraft(preview)
      navigate('/preview/draft', { state: { preview } })
    } catch (err) {
      setError(err.message)
    } finally {
      setValidatingReview(false)
    }
  }

  return (
    <main className="builder-editor-page" style={presentationStyle(presentation)}>
      <div className="modern-editor-shell">
        <aside className="project-sidebar" aria-label="Project navigation">
          <div className="project-summary">
            <span className="project-icon"><AgentGlyph icon={presentation.icon} size={22} /></span>
            <div>
              <span>Current project</span>
              <strong>{projectTitle}</strong>
            </div>
          </div>

          <nav className="project-navigation" aria-label="Builder sections">
            <a href="#agent-brief"><span>01</span><div><strong>Agent brief</strong><small>Describe the job</small></div></a>
            <a href="#preview-canvas"><span>02</span><div><strong>Live canvas</strong><small>Check the experience</small></div></a>
            <a href="#input-fields"><span>03</span><div><strong>Input fields</strong><small>Human approval</small></div></a>
            <a href="#appearance"><span>04</span><div><strong>Appearance</strong><small>Brand the screen</small></div></a>
          </nav>

          <section id="agent-brief" className="editor-prompt-panel" aria-label="Agent configuration">
            <div className="editor-panel-title">
              <span className="section-kicker">Prompt</span>
              <h2>What does your agent do?</h2>
            </div>
            <label htmlFor="description">Describe your agent</label>
            <textarea
              id="description"
              className="form-control"
              rows={7}
              placeholder="Explain the agent’s job, who uses it, and what information it needs..."
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={loading || loadingSaved}
            />
            <div className="prompt-meta">
              <span>Be specific for better suggestions</span>
              <span>{description.trim().length} characters</span>
            </div>
            <div className="example-prompts" aria-label="Example agent descriptions">
              {AGENT_EXAMPLES.map((example) => (
                <button
                  key={example.label}
                  type="button"
                  className="example-chip"
                  onClick={() => setDescription(example.description)}
                  disabled={loading || loadingSaved}
                  aria-label={`Use ${example.label} example`}
                >
                  {example.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-primary btn-generate"
              aria-label={editing ? 'Regenerate inputs' : 'Generate'}
              onClick={handleGenerate}
              disabled={loading || loadingSaved || !description.trim()}
            >
              {loading && <span className="button-spinner" aria-hidden="true" />}
              <span>{loading ? 'Generating...' : editing ? 'Regenerate inputs' : 'Generate inputs'}</span>
              {!loading && <span aria-hidden="true">→</span>}
            </button>
          </section>

          <div className="project-sidebar-footer">
            <Link to="/library">← Screen library</Link>
            <span><i /> Backend validation active</span>
          </div>
        </aside>

        <section className="editor-workbench">
          <header className="editor-topbar">
            <div>
              <span className="editor-breadcrumb">Agent Screen Studio / Builder</span>
              <h1>{editing ? `Edit ${projectTitle}` : 'Create agent input UI'}</h1>
            </div>
            <div className="editor-topbar-actions">
              <span className="editor-status-pill is-draft"><i /> Draft</span>
              {savedVersion && <span className="editor-status-pill is-published">Published v{savedVersion}</span>}
              <span className="editor-review-meter" aria-label={`${progressPercent}% of fields reviewed`}>
                <span style={{ width: `${progressPercent}%` }} />
                {progress.total ? `${reviewedCount}/${progress.total} reviewed` : 'Awaiting fields'}
              </span>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleReviewComplete}
                disabled={!canContinueReview(reviewDraft) || validatingReview}
              >
                {validatingReview ? 'Validating...' : 'Validate & preview'}
              </button>
            </div>
          </header>

          {(error || notice) && (
            <div className="editor-message-stack">
              {error && <div className="alert alert-danger" role="alert"><strong>Something needs attention</strong><span>{error}</span></div>}
              {notice && <div className="alert alert-success" role="status"><strong>Workspace updated</strong><span>{notice}</span></div>}
            </div>
          )}

          <div className="editor-layout">
            <div className="editor-canvas-stack">
              <section id="preview-canvas" className="central-preview-canvas" aria-labelledby="canvas-title">
                <div className="canvas-toolbar">
                  <div>
                    <span className="section-kicker">Live canvas</span>
                    <h2 id="canvas-title">Input experience</h2>
                  </div>
                  <DeviceToggle value={device} onChange={setDevice} />
                </div>
                <div className="canvas-surface">
                  <div className={`device-preview-frame is-${device}`} data-device={device}>
                    {reviewDraft ? (
                      <ScreenExperience
                        manifest={reviewDraft.manifest}
                        onSubmit={() => {}}
                        presentation={presentation}
                        description={sourceDescription || description}
                        agentName={screenId ?? ''}
                        interactive={false}
                      />
                    ) : (
                      <EditorEmptyState loading={loadingSaved} />
                    )}
                  </div>
                </div>
                {reviewDraft && (
                  <p className="canvas-readonly-note"><span>●</span> Editor preview · Inputs unlock on the isolated preview route</p>
                )}
              </section>

              <section id="input-fields" className="editor-fields-section" aria-label="Input field review">
                {loadingSaved && <WorkspaceLoading message="Loading saved inputs..." />}
                {!loadingSaved && reviewDraft && (
                  <Suspense fallback={<WorkspaceLoading message="Opening input review..." />}>
                    <ManifestReview
                      draft={reviewDraft}
                      onChange={setReviewDraft}
                      onContinue={handleReviewComplete}
                      continuing={validatingReview}
                      selectedFieldName={selectedFieldName}
                      onSelectField={setSelectedFieldName}
                    />
                  </Suspense>
                )}
                {!loadingSaved && !reviewDraft && (
                  <div className="field-plan-placeholder">
                    <span>03</span>
                    <div><strong>Field cards will appear here</strong><small>Generate inputs to begin human approval.</small></div>
                  </div>
                )}
              </section>
            </div>

            <AppearanceInspector
              presentation={presentation}
              onChange={setPresentation}
              selectedField={selectedField}
              onReviewChange={setReviewDraft}
              wizardMode={wizardMode}
              disabled={loadingSaved || validatingReview}
            />
          </div>
        </section>
      </div>
    </main>
  )
}
