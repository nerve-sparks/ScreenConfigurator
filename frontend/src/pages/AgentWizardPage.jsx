import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  createAgentProject,
  createProjectScreenDraft,
  generateProjectScreen,
  generateScreenPlan,
  loadAgentProject,
  loadProjectScreenDraft,
  publishAgentProject,
  saveProjectScreenDraft,
  updateAgentScorecard,
  validateScreen,
} from '../lib/api.js'
import AgentFlow, { orderedJourney } from '../components/AgentFlow.jsx'
import { DEFAULT_PRESENTATION, normalizePresentation } from '../lib/presentation.js'
import {
  approveAllFields,
  approveLayout,
  buildApprovedManifest,
  createReviewDraft,
  normalizeReviewDraft,
} from '../lib/reviewModel.js'
import { screenIdFrom } from '../lib/screenIdentity.js'
import {
  descriptionFromScorecard,
  extractConnectionApiKey,
  extractConnectionAuthMode,
  extractConnectionAuthScheme,
  parseScorecardText,
  scorecardSummary,
  scorecardTextWithoutSecrets,
  withConnectionApiKey,
} from '../lib/scorecard.js'
import { WorkspaceLoading } from '../components/StudioShell.jsx'

const STEPS = [
  { id: 'describe', label: 'Describe' },
  { id: 'plan', label: 'Plan' },
  { id: 'approve', label: 'Approve' },
  { id: 'publish', label: 'Publish' },
]

function defaultPurpose(screenType) {
  return screenType === 'form' ? 'intake' : 'information'
}

function reviewDraftForScreen(screen) {
  const manifest = screen.draft_manifest ?? screen.manifest
  const origin = screen.source === 'manual' || screen.source === 'human' ? 'human' : 'llm'
  if (screen.editor_state?.fields && screen.editor_state?.manifest) {
    return normalizeReviewDraft({ ...screen.editor_state, manifest })
  }
  return createReviewDraft(manifest, { origin, layoutApproved: false })
}

async function approveOneScreen(agentId, screen) {
  const presentation = screen.presentation ?? {}
  const name = screen.name || screen.screen_id
  const description = screen.description || ''
  const purpose = screen.purpose
    || (screen.screen_type === 'content' ? 'information' : 'intake')
  const source = screen.source || 'llm'
  const generation = screen.generation ?? {}

  if (screen.screen_type === 'content') {
    const manifest = screen.draft_manifest ?? screen.manifest
    return saveProjectScreenDraft(agentId, screen.screen_id, {
      screenType: 'content',
      purpose,
      manifest,
      approvedManifest: manifest,
      description,
      name,
      source,
      presentation,
      editorState: { layoutApproved: true },
      generation,
    })
  }

  let review = approveLayout(approveAllFields(reviewDraftForScreen(screen)))
  const validated = await validateScreen(buildApprovedManifest(review))
  return saveProjectScreenDraft(agentId, screen.screen_id, {
    screenType: 'form',
    purpose,
    manifest: review.manifest,
    approvedManifest: validated,
    description,
    name,
    source,
    presentation,
    editorState: review,
    generation,
  })
}

function WizardSteps({ current }) {
  const currentIndex = STEPS.findIndex((step) => step.id === current)
  return (
    <ol className="simple-steps" aria-label="Build steps">
      {STEPS.map((step, index) => {
        const state = index < currentIndex
          ? 'is-done'
          : index === currentIndex
            ? 'is-current'
            : ''
        return (
          <li key={step.id} className={state}>
            <span>{index + 1}</span>
            <strong>{step.label}</strong>
          </li>
        )
      })}
    </ol>
  )
}

export default function AgentWizardPage() {
  const { agentId: routeAgentId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const [project, setProject] = useState(null)
  const [screens, setScreens] = useState([])
  const [plan, setPlan] = useState([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scorecard, setScorecard] = useState(null)
  const [scorecardText, setScorecardText] = useState('')
  const [connectionApiKey, setConnectionApiKey] = useState('')
  const [authMode, setAuthMode] = useState('session')
  const [authScheme, setAuthScheme] = useState('Bearer')
  const [changeSummary, setChangeSummary] = useState('Initial agent release')
  const [loading, setLoading] = useState(Boolean(routeAgentId))
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [publishedVersion, setPublishedVersion] = useState(null)

  const stepParam = searchParams.get('step')
  const agentId = routeAgentId || project?.agent_id

  const journey = useMemo(
    () => (project ? orderedJourney(screens, project.screen_ids, project.start_screen_id) : []),
    [project, screens],
  )
  const unapproved = useMemo(
    () => journey.filter((screen) => !screen.approved_manifest),
    [journey],
  )
  const allApproved = journey.length > 0 && unapproved.length === 0

  const inferredStep = !agentId
    ? 'describe'
    : journey.length === 0
      ? 'plan'
      : !allApproved
        ? 'approve'
        : 'publish'

  const step = STEPS.some((item) => item.id === stepParam) ? stepParam : inferredStep

  const reload = useCallback(async (id) => {
    const loaded = await loadAgentProject(id)
    const drafts = await Promise.all(
      (loaded.screen_ids ?? []).map((screenId) => loadProjectScreenDraft(id, screenId)),
    )
    setProject(loaded)
    setScreens(drafts.map((screen) => ({
      ...screen,
      manifest: screen.approved_manifest ?? screen.draft_manifest,
    })))
    setDescription(loaded.description || '')
    setName(loaded.name || '')
    setScorecard(loaded.scorecard && Object.keys(loaded.scorecard).length
      ? loaded.scorecard
      : null)
    setConnectionApiKey(extractConnectionApiKey(loaded.scorecard))
    setAuthMode(extractConnectionAuthMode(loaded.scorecard))
    setAuthScheme(extractConnectionAuthScheme(loaded.scorecard))
    setScorecardText(
      loaded.scorecard && Object.keys(loaded.scorecard).length
        ? scorecardTextWithoutSecrets(loaded.scorecard)
        : '',
    )
    return loaded
  }, [])

  useEffect(() => {
    if (!routeAgentId) {
      setLoading(false)
      return undefined
    }
    let cancelled = false
    setLoading(true)
    setError('')
    reload(routeAgentId)
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [routeAgentId, reload])

  const goStep = (next) => {
    setSearchParams({ step: next }, { replace: true })
  }

  const scorecardInfo = useMemo(
    () => scorecardSummary(scorecard || project?.scorecard, connectionApiKey),
    [scorecard, project, connectionApiKey],
  )

  const applyScorecardText = (text, { fillEmpty = true } = {}) => {
    const trimmed = text.trim()
    if (!trimmed) {
      setScorecard(null)
      setScorecardText('')
      return
    }
    const parsed = parseScorecardText(trimmed)
    const keyFromJson = extractConnectionApiKey(parsed)
    if (keyFromJson && !connectionApiKey.trim()) {
      setConnectionApiKey(keyFromJson)
    }
    const withoutSecrets = (() => {
      if (!parsed.connection || typeof parsed.connection !== 'object') return parsed
      const connection = { ...parsed.connection }
      delete connection.api_key
      delete connection.token
      delete connection.access_token
      delete connection.bearer_token
      delete connection.authorization
      return { ...parsed, connection }
    })()
    setScorecard(withoutSecrets)
    setScorecardText(scorecardTextWithoutSecrets(withoutSecrets))
    if (fillEmpty && !name.trim() && parsed.name) {
      setName(String(parsed.name).slice(0, 80))
    }
    if (fillEmpty && !description.trim()) {
      setDescription(descriptionFromScorecard(parsed).slice(0, 5000))
    }
  }

  const buildScorecardForSave = () => {
    let next = scorecard
    if (scorecardText.trim()) {
      next = parseScorecardText(scorecardText)
    }
    if (!next) return null
    return withConnectionApiKey(next, connectionApiKey, {
      authMode,
      authScheme,
    })
  }

  const handleScorecardBlur = () => {
    if (!scorecardText.trim()) {
      setScorecard(null)
      return
    }
    try {
      setError('')
      applyScorecardText(scorecardText)
    } catch (err) {
      setScorecard(null)
      setError(err.message)
    }
  }

  const clearScorecard = () => {
    setScorecard(null)
    setScorecardText('')
    setConnectionApiKey('')
    setAuthMode('session')
    setAuthScheme('Bearer')
  }

  const handleCreate = async (event) => {
    event.preventDefault()
    const id = screenIdFrom(name)
    if (!id || !description.trim()) return
    setBusy(true)
    setError('')
    try {
      const nextScorecard = buildScorecardForSave()
      if (nextScorecard) setScorecard(nextScorecard)
      const created = await createAgentProject({
        name: name.trim(),
        description: description.trim(),
        presentation: normalizePresentation({
          ...DEFAULT_PRESENTATION,
          display_name: name.trim(),
          welcome_description: description.trim().slice(0, 240),
        }),
        scorecard: nextScorecard || undefined,
      })
      navigate(`/studio/agents/${encodeURIComponent(created.agent_id)}?step=plan`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleGeneratePlan = async () => {
    if (!agentId) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await generateScreenPlan(agentId, description)
      setPlan(result.screens)
      setNotice('Review the plan, then generate the screens.')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const updatePlanItem = (index, changes) => {
    setPlan((current) => current.map((item, i) => (
      i === index ? { ...item, ...changes } : item
    )))
  }

  const validPlan = () => {
    const known = new Set((project?.screens ?? []).map((screen) => screen.screen_id))
    const next = new Set()
    for (const item of plan) {
      const id = screenIdFrom(item.name)
      if (!id || !item.description?.trim()) return false
      if (known.has(id) || next.has(id)) return false
      next.add(id)
    }
    return plan.length > 0
  }

  const handleGenerateScreens = async () => {
    if (!validPlan()) {
      setError('Each screen needs a unique name and a short description.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    setProgress({ current: 0, total: plan.length, label: plan[0]?.name })
    const failures = []
    let done = 0

    for (const definition of plan) {
      setProgress({ current: done, total: plan.length, label: definition.name })
      try {
        const generated = await generateProjectScreen(agentId, definition)
        const presentation = normalizePresentation({
          display_name: definition.name.trim(),
          welcome_title: definition.name.trim(),
          welcome_description: definition.description.trim().slice(0, 240),
        })
        const editorState = definition.screen_type === 'form'
          ? createReviewDraft(generated.manifest, { origin: 'llm', layoutApproved: false })
          : { layoutApproved: false }
        await createProjectScreenDraft(agentId, generated.screen_id, {
          screenType: definition.screen_type,
          purpose: definition.purpose,
          manifest: generated.manifest,
          description: definition.description.trim(),
          name: definition.name.trim(),
          source: 'llm',
          presentation,
          editorState,
          generation: generated.generation ?? {},
        })
      } catch (err) {
        failures.push(`${definition.name}: ${err.message}`)
      } finally {
        done += 1
        setProgress({ current: done, total: plan.length, label: definition.name })
      }
    }

    await reload(agentId)
    setBusy(false)
    setProgress(null)
    if (failures.length) {
      setError(`Some screens failed:\n${failures.join('\n')}`)
    } else {
      setPlan([])
      setNotice('Screens are ready. Approve them to continue.')
      goStep('approve')
    }
  }

  const handleApproveAll = async () => {
    if (!unapproved.length) {
      goStep('publish')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    setProgress({ current: 0, total: unapproved.length, label: unapproved[0]?.name })
    const failures = []
    let done = 0
    for (const screen of unapproved) {
      setProgress({
        current: done,
        total: unapproved.length,
        label: screen.name || screen.screen_id,
      })
      try {
        await approveOneScreen(agentId, screen)
      } catch (err) {
        failures.push(`${screen.name || screen.screen_id}: ${err.message}`)
      } finally {
        done += 1
        setProgress({
          current: done,
          total: unapproved.length,
          label: screen.name || screen.screen_id,
        })
      }
    }
    await reload(agentId)
    setBusy(false)
    setProgress(null)
    if (failures.length) {
      setError(`Could not approve every screen:\n${failures.join('\n')}`)
    } else {
      setNotice('All screens and layouts are approved.')
      goStep('publish')
    }
  }

  const handlePublish = async () => {
    if (!project || !allApproved) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      let nextProject = project
      const nextScorecard = buildScorecardForSave()
        || (project.scorecard
          ? withConnectionApiKey(project.scorecard, connectionApiKey, {
            authMode,
            authScheme,
          })
          : null)
      if (nextScorecard) {
        setScorecard(nextScorecard)
        nextProject = await updateAgentScorecard(agentId, nextScorecard)
        setProject(nextProject)
      }
      const release = await publishAgentProject(agentId, {
        projectRevision: nextProject.revision,
        screenRevisions: Object.fromEntries(
          screens.map((screen) => [screen.screen_id, screen.revision]),
        ),
        changeSummary: changeSummary.trim(),
      })
      setPublishedVersion(release.version)
      setNotice(`Published release ${release.version}.`)
      await reload(agentId)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <main className="simple-wizard">
        <WorkspaceLoading message="Opening agent…" />
      </main>
    )
  }

  if (step === 'describe') {
    return (
      <main className="simple-wizard is-create">
        <div className="create-stage">
          <div className="create-stage-top">
            <WizardSteps current="describe" />
            <Link className="btn btn-outline-secondary create-library-link" to="/library">
              All agents
            </Link>
          </div>

          <section className="create-panel">
            <div className="create-panel-copy">
              <p className="simple-kicker">New agent</p>
              <h1>Describe the agent</h1>
              <p>
                Add a short brief and paste the agent scorecard JSON so screens
                map to that agent’s input contract.
              </p>
            </div>

            {error && <div className="simple-alert is-error" role="alert">{error}</div>}

            <form className="create-form" onSubmit={handleCreate}>
              <label>
                Agent name
                <input
                  className="form-control"
                  value={name}
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. AI Business proposal agent"
                  required
                />
                <small>ID: {screenIdFrom(name) || '—'}</small>
              </label>

              <div className="scorecard-attach">
                <div className="scorecard-attach-head">
                  <div>
                    <strong>Agent scorecard</strong>
                    <p>
                      Paste the agent scorecard JSON (input_schema, connection.url,
                      agent_id). Put the API key in the field below — not in the JSON.
                    </p>
                  </div>
                  {scorecardText.trim() && (
                    <button type="button" className="btn btn-link" onClick={clearScorecard}>
                      Clear
                    </button>
                  )}
                </div>
                <label className="scorecard-paste">
                  <span className="sr-only">Scorecard JSON</span>
                  <textarea
                    className="form-control"
                    rows={6}
                    value={scorecardText}
                    onChange={(event) => setScorecardText(event.target.value)}
                    onBlur={handleScorecardBlur}
                    placeholder='{ "name": "...", "connection": { "url": "https://..." }, "input_schema": { ... } }'
                    spellCheck={false}
                  />
                </label>
                <label className="scorecard-api-key">
                  Agent auth
                  <select
                    className="form-control"
                    value={authMode}
                    onChange={(event) => setAuthMode(event.target.value)}
                  >
                    <option value="session">Use my Studio login token</option>
                    <option value="api_key">API key / access token</option>
                    <option value="api_key_or_session">API key, else Studio login</option>
                  </select>
                </label>
                {authMode !== 'session' && (
                  <>
                    <label className="scorecard-api-key">
                      Token format
                      <select
                        className="form-control"
                        value={authScheme}
                        onChange={(event) => setAuthScheme(event.target.value)}
                      >
                        <option value="Bearer">Authorization: Bearer &lt;token&gt;</option>
                        <option value="">Authorization: &lt;token&gt; (raw)</option>
                      </select>
                    </label>
                    <label className="scorecard-api-key">
                      Agent API key / access token
                      <input
                        className="form-control"
                        type="password"
                        autoComplete="off"
                        value={connectionApiKey}
                        onChange={(event) => setConnectionApiKey(event.target.value)}
                        placeholder="Paste token only — do not include the word Bearer"
                      />
                    </label>
                  </>
                )}
                {authMode === 'session' && (
                  <p className="scorecard-hint">
                    Studio will forward your logged-in access token as{' '}
                    <code>Authorization: Bearer …</code> to the agent URL.
                  </p>
                )}
                {scorecardInfo ? (
                  <div className="scorecard-summary">
                    <div className="scorecard-summary-meta">
                      <span>Scorecard ready</span>
                      {scorecardInfo.runtimeId && <code>{scorecardInfo.runtimeId}</code>}
                      {scorecardInfo.version && <em>v{scorecardInfo.version}</em>}
                    </div>
                    <ul>
                      {scorecardInfo.connection?.url ? (
                        <li>
                          <strong>connection.url</strong>
                          <span>{scorecardInfo.connection.url}</span>
                        </li>
                      ) : null}
                      <li>
                        <strong>api_key</strong>
                        <span>
                          {authMode === 'session'
                            ? 'using Studio login token'
                            : connectionApiKey.trim() || scorecardInfo.connection?.hasApiKey
                              ? 'set in the field above'
                              : 'optional — needed if the agent requires Authorization'}
                        </span>
                      </li>
                      {scorecardInfo.fieldCount > 0 ? (
                        scorecardInfo.fields.map((field) => (
                          <li key={field.name}>
                            <strong>{field.name}</strong>
                            <span>
                              {field.type}
                              {field.required ? ' · required' : ''}
                            </span>
                          </li>
                        ))
                      ) : (
                        <li>No input_schema fields found — plan will use your description.</li>
                      )}
                    </ul>
                  </div>
                ) : (
                  <p className="scorecard-hint">
                    Optional. Without a scorecard, screens are planned from the description only.
                  </p>
                )}
              </div>

              <label className="create-description">
                Description
                <textarea
                  className="form-control"
                  maxLength={5000}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Who uses it, what they need to do, and what each part of the experience should cover."
                  required
                />
              </label>
              <div className="create-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy || !screenIdFrom(name) || !description.trim()}
                >
                  {busy ? 'Creating…' : 'Continue to plan'}
                </button>
              </div>
            </form>
          </section>
        </div>
      </main>
    )
  }

  return (
    <main className="simple-wizard">
      <header className="simple-wizard-header">
        <div>
          <p className="simple-kicker">Agent Screen Studio</p>
          <h1>{project?.name || 'New agent'}</h1>
          <p className="simple-lead">
            Four clear steps: describe the agent, plan screens, approve them, then publish.
          </p>
        </div>
        <Link className="btn btn-outline-secondary" to="/library">All agents</Link>
      </header>

      <WizardSteps current={step} />

      {notice && <div className="simple-alert is-success" role="status">{notice}</div>}
      {error && <div className="simple-alert is-error" role="alert">{error}</div>}

      {progress && (
        <div className="simple-progress" role="status">
          <div>
            <strong>{progress.current}/{progress.total}</strong>
            <span>{progress.label}</span>
          </div>
          <div className="simple-progress-bar">
            <span style={{ width: `${(progress.current / Math.max(progress.total, 1)) * 100}%` }} />
          </div>
        </div>
      )}

      {step === 'plan' && agentId && (
        <section className="simple-card">
          <h2>2. Plan the screens</h2>
          <p>AI proposes an ordered journey. Edit names and briefs, then generate.</p>
          <div className="simple-brief">
            <strong>Agent brief</strong>
            <p>{description || project?.description}</p>
          </div>
          {(scorecardInfo) && (
            <div className="simple-brief scorecard-plan-brief">
              <strong>Scorecard mapping</strong>
              <p>
                Screens will map onto runtime agent{' '}
                <code>
                  {scorecardInfo.runtimeId || scorecardInfo.name || 'attached'}
                </code>
                {scorecardInfo.fieldCount
                  ? ` · ${scorecardInfo.fieldCount} input field(s)`
                  : ''}
                .
              </p>
            </div>
          )}
          <div className="simple-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleGeneratePlan}
              disabled={busy}
            >
              {busy && !plan.length ? 'Planning…' : plan.length ? 'Regenerate plan' : 'Generate plan'}
            </button>
            {journey.length > 0 && (
              <button type="button" className="btn btn-outline-secondary" onClick={() => goStep('approve')}>
                Skip to approve
              </button>
            )}
          </div>

          {plan.length > 0 && (
            <div className="simple-plan-list">
              {plan.map((item, index) => (
                <article key={`${index}-${item.name}`} className="simple-plan-row">
                  <span>{index + 1}</span>
                  <div className="simple-plan-fields">
                    <label>
                      Screen name
                      <input
                        className="form-control"
                        value={item.name}
                        disabled={busy}
                        onChange={(event) => updatePlanItem(index, { name: event.target.value })}
                      />
                    </label>
                    <label>
                      Type
                      <select
                        className="form-control"
                        value={item.screen_type}
                        disabled={busy}
                        onChange={(event) => updatePlanItem(index, {
                          screen_type: event.target.value,
                          purpose: defaultPurpose(event.target.value),
                        })}
                      >
                        <option value="form">Form</option>
                        <option value="content">Content</option>
                      </select>
                    </label>
                    <label className="is-wide">
                      Brief
                      <textarea
                        className="form-control"
                        rows={2}
                        value={item.description}
                        disabled={busy}
                        onChange={(event) => updatePlanItem(index, { description: event.target.value })}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="btn btn-link"
                    disabled={busy}
                    onClick={() => setPlan((current) => current.filter((_, i) => i !== index))}
                  >
                    Remove
                  </button>
                </article>
              ))}
              <div className="simple-actions">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  disabled={busy || plan.length >= 20}
                  onClick={() => setPlan((current) => [...current, {
                    name: 'New screen',
                    screen_type: 'form',
                    purpose: 'intake',
                    description: 'Describe what this screen should collect.',
                  }])}
                >
                  Add screen
                </button>
                <button
                  type="button"
                  className="btn btn-success"
                  disabled={busy}
                  onClick={handleGenerateScreens}
                >
                  {busy ? 'Generating screens…' : `Generate ${plan.length} screens`}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {step === 'approve' && agentId && (
        <section className="simple-card">
          <h2>3. Approve screens</h2>
          <p>
            Inspect each screen start to end. Edit layouts and fields where needed,
            then approve all when ready.
          </p>
          {journey.length === 0 ? (
            <div className="simple-empty">
              <p>No screens yet. Go back and generate a plan.</p>
              <button type="button" className="btn btn-primary" onClick={() => goStep('plan')}>
                Back to plan
              </button>
            </div>
          ) : (
            <>
              <ol className="simple-screen-list">
                {journey.map((screen, index) => {
                  const editPath = screen.screen_type === 'content'
                    ? `/studio/agents/${encodeURIComponent(agentId)}/screens/${encodeURIComponent(screen.screen_id)}/content?return=approve`
                    : `/studio/agents/${encodeURIComponent(agentId)}/screens/${encodeURIComponent(screen.screen_id)}/edit?return=approve`
                  return (
                    <li key={screen.screen_id}>
                      <span>{index + 1}</span>
                      <div>
                        <strong>{screen.name || screen.screen_id}</strong>
                        <small>
                          {screen.screen_type}
                          {index === 0 ? ' · Start' : ''}
                          {index === journey.length - 1 ? ' · End' : ''}
                        </small>
                      </div>
                      <div className="simple-screen-actions">
                        <em className={screen.approved_manifest ? 'is-ok' : 'is-wait'}>
                          {screen.approved_manifest ? 'Approved' : 'Needs approval'}
                        </em>
                        <Link className="btn btn-outline-secondary btn-sm" to={editPath}>
                          Edit screen
                        </Link>
                      </div>
                    </li>
                  )
                })}
              </ol>
              <div className="simple-actions">
                <button type="button" className="btn btn-outline-secondary" onClick={() => goStep('plan')}>
                  Back
                </button>
                <button
                  type="button"
                  className="btn btn-success"
                  disabled={busy}
                  onClick={handleApproveAll}
                >
                  {busy
                    ? 'Approving…'
                    : unapproved.length === 0
                      ? 'Continue to publish'
                      : `Approve all (${unapproved.length})`}
                </button>
              </div>
              <div className="simple-preview">
                <p className="simple-preview-note">
                  Live walkthrough — use Edit screen above to change boxes and fields.
                </p>
                <AgentFlow
                  screens={screens}
                  screenIds={project.screen_ids}
                  startScreenId={project.start_screen_id}
                  agentName={project.name}
                  agentDescription={project.description}
                  onComplete={() => undefined}
                  showApprovalStatus
                />
              </div>
            </>
          )}
        </section>
      )}

      {step === 'publish' && agentId && (
        <section className="simple-card">
          <h2>4. Publish</h2>
          <p>Publishing creates an immutable release of the full agent journey.</p>
          {!allApproved ? (
            <div className="simple-empty">
              <p>Approve every screen before publishing.</p>
              <button type="button" className="btn btn-primary" onClick={() => goStep('approve')}>
                Back to approve
              </button>
            </div>
          ) : (
            <>
              <dl className="simple-stats">
                <div><dt>Screens</dt><dd>{journey.length}</dd></div>
                <div><dt>Approved</dt><dd>{journey.length}/{journey.length}</dd></div>
                {Number.isInteger(project?.latest_release) && (
                  <div><dt>Latest release</dt><dd>{project.latest_release}</dd></div>
                )}
              </dl>
              <div className="scorecard-attach">
                <div className="scorecard-attach-head">
                  <div>
                    <strong>Agent authentication</strong>
                    <p>
                      agent-builder.nervesparks.com needs your Studio login JWT
                      (<code>Authorization: Bearer &lt;access_token&gt;</code>),
                      not a short API key string. Prefer “Use my Studio login token”.
                    </p>
                  </div>
                </div>
                <label className="scorecard-api-key">
                  Auth mode
                  <select
                    className="form-control"
                    value={authMode}
                    onChange={(event) => setAuthMode(event.target.value)}
                  >
                    <option value="session">Use my Studio login token</option>
                    <option value="api_key">API key / access token</option>
                    <option value="api_key_or_session">API key, else Studio login</option>
                  </select>
                </label>
                {authMode !== 'session' && (
                  <>
                    <label className="scorecard-api-key">
                      Token format
                      <select
                        className="form-control"
                        value={authScheme}
                        onChange={(event) => setAuthScheme(event.target.value)}
                      >
                        <option value="Bearer">Authorization: Bearer &lt;token&gt;</option>
                        <option value="">Authorization: &lt;token&gt; (raw)</option>
                      </select>
                    </label>
                    <label className="scorecard-api-key">
                      <span className="sr-only">Agent API key</span>
                      <input
                        className="form-control"
                        type="password"
                        autoComplete="off"
                        value={connectionApiKey}
                        onChange={(event) => setConnectionApiKey(event.target.value)}
                        placeholder="Paste token only — do not include Bearer"
                      />
                    </label>
                  </>
                )}
                <p className="scorecard-hint">
                  {scorecardInfo?.connection?.url
                    ? `URL: ${scorecardInfo.connection.url}`
                    : 'No connection.url on the scorecard yet.'}
                  {' · '}
                  {authMode === 'session'
                    ? 'Will forward Studio login token'
                    : connectionApiKey.trim()
                      ? 'API key ready'
                      : 'API key empty'}
                </p>
              </div>
              <label className="simple-form">
                What changed?
                <textarea
                  className="form-control"
                  rows={3}
                  maxLength={240}
                  value={changeSummary}
                  onChange={(event) => setChangeSummary(event.target.value)}
                />
              </label>
              <div className="simple-actions">
                <button type="button" className="btn btn-outline-secondary" onClick={() => goStep('approve')}>
                  Back
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !changeSummary.trim()}
                  onClick={handlePublish}
                >
                  {busy ? 'Publishing…' : 'Publish agent'}
                </button>
              </div>
              {(publishedVersion || project?.latest_release) && (
                <div className="simple-actions" style={{ marginTop: 16 }}>
                  <Link
                    className="btn btn-outline-secondary"
                    to={`/agents/${encodeURIComponent(agentId)}?version=${publishedVersion || project.latest_release}`}
                  >
                    Open published agent
                  </Link>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </main>
  )
}
