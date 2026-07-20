import { Suspense, lazy, useState } from 'react'
import { generate, loadScreen, saveScreen, validateScreen } from './api.js'
import { isWizardManifest, toUiSchema } from './manifestLayout.js'
import { buildApprovedManifest, createReviewDraft } from './reviewModel.js'

const FormRenderer = lazy(() => import('./FormRenderer.jsx'))
const ManifestReview = lazy(() => import('./ManifestReview.jsx'))
const Wizard = lazy(() => import('./Wizard.jsx'))

const WORKFLOW_STEPS = [
  { number: '01', label: 'Describe', detail: 'Define the agent' },
  { number: '02', label: 'Review', detail: 'Approve the inputs' },
  { number: '03', label: 'Preview', detail: 'Test and save' },
]

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

function SparkIcon({ size = 20 }) {
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

function WorkflowProgress({ stage }) {
  return (
    <nav className="workflow-progress" aria-label="Build progress">
      <ol>
        {WORKFLOW_STEPS.map((step, index) => {
          const stepNumber = index + 1
          const isCurrent = stepNumber === stage
          const isComplete = stepNumber < stage
          return (
            <li
              key={step.label}
              className={`${isCurrent ? 'is-current' : ''} ${
                isComplete ? 'is-complete' : ''
              }`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span className="workflow-step-number">
                {isComplete ? '✓' : step.number}
              </span>
              <span>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function EmptyWorkspace() {
  return (
    <div className="empty-workspace">
      <div className="empty-workspace-visual" aria-hidden="true">
        <div className="empty-orbit empty-orbit-one" />
        <div className="empty-orbit empty-orbit-two" />
        <span className="empty-spark">
          <SparkIcon size={34} />
        </span>
      </div>
      <span className="section-kicker">Workspace ready</span>
      <h2>Your agent input experience will appear here</h2>
      <p>
        Describe what your agent does. The AI will identify the information it
        needs, then you stay in control of every field before preview.
      </p>
      <div className="empty-feature-grid">
        <div>
          <span>01</span>
          <strong>Adaptive layout</strong>
          <small>Single screen or guided wizard</small>
        </div>
        <div>
          <span>02</span>
          <strong>Human controlled</strong>
          <small>Approve, edit, exclude, or add inputs</small>
        </div>
        <div>
          <span>03</span>
          <strong>Validation guarded</strong>
          <small>Checked before preview and storage</small>
        </div>
      </div>
    </div>
  )
}

function WorkspaceLoading({ message }) {
  return (
    <div className="workspace-loading" role="status">
      <span className="loading-orb" aria-hidden="true">
        <SparkIcon size={22} />
      </span>
      <strong>{message}</strong>
    </div>
  )
}

export default function App() {
  const [description, setDescription] = useState('')
  const [manifest, setManifest] = useState(null)
  const [reviewDraft, setReviewDraft] = useState(null)
  // The description that actually produced the current manifest -- this,
  // not the (possibly edited) textarea value, is what gets saved with it.
  const [sourceDescription, setSourceDescription] = useState('')
  const [formKey, setFormKey] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [submitted, setSubmitted] = useState(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadId, setLoadId] = useState('')
  const [loadingSaved, setLoadingSaved] = useState(false)
  const [validatingReview, setValidatingReview] = useState(false)
  const stage = manifest ? 3 : reviewDraft ? 2 : 1
  const fieldCount = Object.keys(manifest?.input_schema?.properties ?? {}).length
  const wizardMode = manifest ? isWizardManifest(manifest) : false

  const handleGenerate = async () => {
    setLoading(true)
    setError(null)
    setNotice(null)
    setSubmitted(null)
    setManifest(null)
    setReviewDraft(null)
    try {
      const result = await generate(description.trim())
      if (!result?.input_schema) {
        throw new Error('Backend response is missing "input_schema".')
      }
      setReviewDraft(createReviewDraft(result))
      setSourceDescription(description.trim())
    } catch (err) {
      setManifest(null)
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
    setSubmitted(null)
    try {
      const candidate = buildApprovedManifest(reviewDraft)
      const validated = await validateScreen(candidate)
      setManifest(validated)
      setNotice('Review complete. The approved inputs are ready to preview.')
      // New key remounts the form so no stale field values survive.
      setFormKey((key) => key + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setValidatingReview(false)
    }
  }

  const handleReturnToReview = () => {
    if (!reviewDraft) return
    setManifest(null)
    setSubmitted(null)
    setError(null)
    setNotice(null)
  }

  const handleSave = async () => {
    if (!manifest) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const result = await saveScreen({
        manifest,
        description: sourceDescription,
        name,
      })
      setNotice(`Saved as "${result.agent_id}" (version ${result.version}).`)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleLoad = async () => {
    const agentId = loadId.trim()
    if (!agentId) return
    setLoadingSaved(true)
    setError(null)
    setNotice(null)
    setSubmitted(null)
    try {
      const document = await loadScreen(agentId)
      if (!document?.manifest?.input_schema) {
        throw new Error('Saved screen is missing its manifest.')
      }
      setManifest(document.manifest)
      setReviewDraft(null)
      setSourceDescription(document.description ?? '')
      setDescription(document.description ?? '')
      setNotice(`Loaded "${document.agent_id}" (version ${document.version}).`)
      setFormKey((key) => key + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingSaved(false)
    }
  }

  const handleSubmit = (formData) => {
    setSubmitted(formData)
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <a className="brand" href="#top" aria-label="Agent Screen Studio home">
            <span className="brand-mark">
              <SparkIcon size={22} />
            </span>
            <span>
              <strong>Agent Screen</strong>
              <small>Studio</small>
            </span>
          </a>
          <div className="header-status">
            <span className="status-dot" aria-hidden="true" />
            Validation guarded
          </div>
        </div>
      </header>

      <main id="top" className="app-main">
        <section className="studio-hero" aria-labelledby="studio-title">
          <div className="hero-copy">
            <span className="hero-eyebrow">
              <SparkIcon size={16} /> AI-assisted interface builder
            </span>
            <h1 id="studio-title">Turn any agent idea into a thoughtful input experience.</h1>
            <p>
              Describe the job. Review what the AI proposes. Ship a validated
              interface your users will understand.
            </p>
          </div>
          <WorkflowProgress stage={stage} />
        </section>

        <div className="studio-grid">
          <aside className="builder-sidebar" aria-label="Agent configuration">
            <section className="studio-panel prompt-panel">
              <div className="panel-heading">
                <span className="panel-step">01</span>
                <div>
                  <span className="section-kicker">Agent brief</span>
                  <h2>What does your agent do?</h2>
                </div>
              </div>

              <div className="form-group prompt-field">
                <label htmlFor="description">Describe your agent</label>
                <textarea
                  id="description"
                  className="form-control"
                  rows={7}
                  placeholder="Explain the agent’s job, who uses it, and what information it needs..."
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  disabled={loading}
                />
                <div className="prompt-meta">
                  <span>Be specific for better input suggestions</span>
                  <span>{description.trim().length} characters</span>
                </div>
              </div>

              <div className="example-prompts" aria-label="Example agent descriptions">
                <span>Try an example</span>
                <div>
                  {AGENT_EXAMPLES.map((example) => (
                    <button
                      key={example.label}
                      type="button"
                      className="example-chip"
                      onClick={() => setDescription(example.description)}
                      disabled={loading}
                      aria-label={`Use ${example.label} example`}
                    >
                      {example.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                className="btn btn-primary btn-generate"
                onClick={handleGenerate}
                disabled={loading || !description.trim()}
              >
                {loading && <span className="button-spinner" aria-hidden="true" />}
                <span>{loading ? 'Generating...' : 'Generate'}</span>
                {!loading && <span aria-hidden="true">→</span>}
              </button>
            </section>

            <section className="studio-panel saved-panel">
              <div className="saved-panel-heading">
                <div>
                  <span className="section-kicker">Continue your work</span>
                  <label htmlFor="load-id">Or load a saved screen</label>
                </div>
                <span className="saved-icon" aria-hidden="true">↗</span>
              </div>
              <div className="input-group">
                <input
                  id="load-id"
                  className="form-control"
                  type="text"
                  placeholder="agent-id, e.g. email-agent"
                  value={loadId}
                  onChange={(event) => setLoadId(event.target.value)}
                />
                <div className="input-group-append">
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={handleLoad}
                    disabled={loadingSaved || !loadId.trim()}
                  >
                    {loadingSaved ? 'Loading...' : 'Load'}
                  </button>
                </div>
              </div>
            </section>

            <div className="guardrail-note">
              <span className="guardrail-icon" aria-hidden="true">✓</span>
              <div>
                <strong>Built-in guardrails</strong>
                <p>Every manifest is validated before it reaches preview or storage.</p>
              </div>
            </div>
          </aside>

          <section className="workspace-canvas" aria-label="Screen workspace">
            {(error || notice) && (
              <div className="message-stack">
                {error && (
                  <div className="alert alert-danger" role="alert">
                    <strong>Something needs attention</strong>
                    <span>{error}</span>
                  </div>
                )}
                {notice && (
                  <div className="alert alert-success" role="status">
                    <strong>All set</strong>
                    <span>{notice}</span>
                  </div>
                )}
              </div>
            )}

            {!reviewDraft && !manifest && <EmptyWorkspace />}

            {reviewDraft && !manifest && (
              <Suspense fallback={<WorkspaceLoading message="Opening input review..." />}>
                <ManifestReview
                  draft={reviewDraft}
                  onChange={setReviewDraft}
                  onContinue={handleReviewComplete}
                  continuing={validatingReview}
                />
              </Suspense>
            )}

            {manifest && (
              <div className="preview-workspace">
                <div className="preview-toolbar">
                  <div>
                    <span className="section-kicker">Live preview</span>
                    <h2>Your agent input experience</h2>
                    <div className="preview-meta">
                      <span>{wizardMode ? 'Guided wizard' : 'Single screen'}</span>
                      <span>{fieldCount} {fieldCount === 1 ? 'input' : 'inputs'}</span>
                      <span>Validated</span>
                    </div>
                  </div>
                  {reviewDraft && (
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-back-review"
                      onClick={handleReturnToReview}
                    >
                      ← Back to input review
                    </button>
                  )}
                </div>

                <div className="preview-grid">
                  <section className="agent-preview-frame" aria-label="Generated agent screen">
                    <div className="preview-window-bar" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                      <small>Generated agent · Input screen</small>
                    </div>
                    <div className="preview-content">
                      <div className="preview-agent-heading">
                        <span className="preview-agent-icon">
                          <SparkIcon size={20} />
                        </span>
                        <div>
                          <span>Agent input</span>
                          <h3>Let’s get started</h3>
                          <p>Provide the details below so the agent can do its best work.</p>
                        </div>
                      </div>
                      <Suspense
                        fallback={<WorkspaceLoading message="Rendering your input screen..." />}
                      >
                        {wizardMode ? (
                          <Wizard
                            key={formKey}
                            manifest={manifest}
                            onSubmit={handleSubmit}
                          />
                        ) : (
                          <FormRenderer
                            key={formKey}
                            schema={manifest.input_schema}
                            uiSchema={toUiSchema(manifest)}
                            onSubmit={handleSubmit}
                          />
                        )}
                      </Suspense>
                    </div>
                  </section>

                  <aside className="save-screen-card">
                    <span className="save-card-icon" aria-hidden="true">↓</span>
                    <span className="section-kicker">Reusable screen</span>
                    <h3>Save this configuration</h3>
                    <p>Give the approved input experience a memorable name for later use.</p>
                    <div className="form-group">
                      <label htmlFor="screen-name">Save this screen</label>
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
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <small>Leaving the name empty creates one from the agent brief.</small>
                  </aside>
                </div>
              </div>
            )}

            {submitted !== null && (
              <section className="submission-result" aria-labelledby="submission-heading">
                <div>
                  <span className="result-check" aria-hidden="true">✓</span>
                  <div>
                    <span className="section-kicker">Test submission</span>
                    <h2 id="submission-heading">The input screen works</h2>
                  </div>
                </div>
                <pre>{JSON.stringify(submitted, null, 2)}</pre>
              </section>
            )}
          </section>
        </div>
      </main>

      <footer className="app-footer">
        <span>Agent Screen Studio</span>
        <span>AI proposed · Human approved · Backend validated</span>
      </footer>
    </div>
  )
}
