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
  updateAgentEndpoints,
  updateAgentRuntime,
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
  scorecardSummary,
  scorecardTextWithoutSecrets,
} from '../lib/scorecard.js'
import {
  AUTH_TYPES,
  BODY_FORMATS,
  defaultRuntime,
  emptyEndpoint,
  endpointFromScorecardText,
  hydrateProjectConfig,
  normalizeEndpoints,
  normalizeRuntime,
  runtimeForSave,
  runtimeSummary,
} from '../lib/runtimeConfig.js'
import { WorkspaceLoading } from '../components/StudioShell.jsx'
import { publishedAgentHref } from '../lib/userDisplay.js'

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
    <nav className="wizard-step-chrome" aria-label="Build progress">
      <ol className="simple-steps">
        {STEPS.map((step, index) => {
          const state = index < currentIndex
            ? 'is-done'
            : index === currentIndex
              ? 'is-current'
              : ''
          return (
            <li key={step.id} className={state}>
              <span aria-hidden="true">{index + 1}</span>
              <strong>{step.label}</strong>
            </li>
          )
        })}
      </ol>
      <p className="wizard-step-caption">
        Step {Math.max(currentIndex + 1, 1)} of {STEPS.length}
        {' · '}
        {STEPS[Math.max(currentIndex, 0)]?.label}
      </p>
    </nav>
  )
}

/** Build editable scorecard-shaped JSON for one endpoint editor. */
function jsonTextForEndpoint(endpoint, scorecardFallback = null) {
  if (scorecardFallback && typeof scorecardFallback === 'object'
    && Object.keys(scorecardFallback).length) {
    return scorecardTextWithoutSecrets(scorecardFallback)
  }
  if (!endpoint || typeof endpoint !== 'object') return ''
  const hasSchema = endpoint.input_schema
    && typeof endpoint.input_schema === 'object'
    && Object.keys(endpoint.input_schema).length > 0
  if (!endpoint.url && !hasSchema) return ''
  const payload = {
    name: endpoint.name || undefined,
    connection: {
      url: endpoint.url || undefined,
      method: endpoint.method || 'POST',
      body_format: endpoint.body_format || 'auto',
    },
    input_schema: hasSchema ? endpoint.input_schema : undefined,
    output_schema: endpoint.output_schema
      && typeof endpoint.output_schema === 'object'
      && Object.keys(endpoint.output_schema).length
      ? endpoint.output_schema
      : undefined,
  }
  return JSON.stringify(payload, null, 2)
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
  const [endpointJsonTexts, setEndpointJsonTexts] = useState(() => [''])
  const [runtime, setRuntime] = useState(() => defaultRuntime())
  const [endpoints, setEndpoints] = useState(() => [emptyEndpoint(0)])
  const [authSecret, setAuthSecret] = useState('')
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
    const hydrated = hydrateProjectConfig(loaded)
    const nextEndpoints = hydrated.endpoints.length ? hydrated.endpoints : [emptyEndpoint(0)]
    setRuntime(hydrated.runtime)
    setEndpoints(nextEndpoints)
    setAuthSecret(hydrated.runtime.auth.secret || '')
    setScorecard(hydrated.scorecard && Object.keys(hydrated.scorecard).length
      ? hydrated.scorecard
      : null)
    setEndpointJsonTexts(nextEndpoints.map((endpoint, index) => (
      jsonTextForEndpoint(
        endpoint,
        index === 0 ? hydrated.scorecard : null,
      )
    )))
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

  const configSummary = useMemo(
    () => runtimeSummary(runtime, endpoints, authSecret),
    [runtime, endpoints, authSecret],
  )
  const scorecardInfo = useMemo(
    () => scorecardSummary(scorecard || project?.scorecard, authSecret),
    [scorecard, project, authSecret],
  )

  const updateRuntimeAuth = (changes) => {
    setRuntime((current) => normalizeRuntime({
      ...current,
      auth: { ...current.auth, ...changes },
    }, { secret: authSecret }))
  }

  const updateRuntimeDefaults = (changes) => {
    setRuntime((current) => normalizeRuntime({
      ...current,
      defaults: { ...current.defaults, ...changes },
    }, { secret: authSecret }))
  }

  const updateEndpointAt = (index, changes) => {
    setEndpoints((current) => current.map((item, i) => (
      i === index ? { ...item, ...changes } : item
    )))
  }

  const applyScorecardToEndpoint = (index, text, {
    syncProjectMeta = index === 0,
  } = {}) => {
    const trimmed = text.trim()
    if (!trimmed) return null
    const { endpoint, runtimePatch, scorecard: parsed } = endpointFromScorecardText(
      trimmed,
      index,
    )
    updateEndpointAt(index, endpoint)
    setEndpointJsonTexts((current) => {
      const next = [...current]
      while (next.length <= index) next.push('')
      next[index] = scorecardTextWithoutSecrets(parsed)
      return next
    })
    if (runtimePatch.secret && !authSecret.trim()) {
      setAuthSecret(runtimePatch.secret)
    }
    setRuntime((current) => normalizeRuntime({
      ...current,
      auth: {
        ...current.auth,
        header_name: runtimePatch.header_name || current.auth.header_name,
        scheme: runtimePatch.scheme ?? current.auth.scheme,
      },
      defaults: {
        ...current.defaults,
        timeout_ms: runtimePatch.timeout_ms || current.defaults.timeout_ms,
        body_format: runtimePatch.body_format || current.defaults.body_format,
      },
    }, { secret: authSecret || runtimePatch.secret || '' }))
    if (syncProjectMeta) {
      setScorecard(parsed)
      if (!name.trim() && parsed.name) setName(String(parsed.name).slice(0, 80))
      if (!description.trim()) {
        setDescription(descriptionFromScorecard(parsed).slice(0, 5000))
      }
    }
    return { endpoint, runtimePatch, scorecard: parsed }
  }

  const handleEndpointJsonBlur = (index) => {
    const text = endpointJsonTexts[index] || ''
    if (!text.trim()) return
    try {
      setError('')
      applyScorecardToEndpoint(index, text)
    } catch (err) {
      setError(err.message)
    }
  }

  const clearConnectionConfig = () => {
    setScorecard(null)
    setEndpointJsonTexts([''])
    setAuthSecret('')
    setRuntime(defaultRuntime())
    setEndpoints([emptyEndpoint(0)])
  }

  /** Apply pasted JSON for every endpoint and return synced create/save payload pieces. */
  const materializeEndpointConfig = () => {
    let nextEndpoints = normalizeEndpoints(endpoints)
    let nextRuntime = normalizeRuntime(runtime, { secret: authSecret })
    let nextSecret = authSecret
    let nextScorecard = scorecard
    const nextTexts = [...endpointJsonTexts]
    const parsedByIndex = []

    endpointJsonTexts.forEach((text, index) => {
      const trimmed = typeof text === 'string' ? text.trim() : ''
      if (!trimmed) return
      const { endpoint, runtimePatch, scorecard: parsed } = endpointFromScorecardText(
        trimmed,
        index,
      )
      while (nextEndpoints.length <= index) {
        nextEndpoints.push(emptyEndpoint(nextEndpoints.length))
      }
      nextEndpoints[index] = { ...nextEndpoints[index], ...endpoint }
      nextTexts[index] = scorecardTextWithoutSecrets(parsed)
      parsedByIndex[index] = parsed
      if (runtimePatch.secret && !String(nextSecret || '').trim()) {
        nextSecret = runtimePatch.secret
      }
      nextRuntime = normalizeRuntime({
        ...nextRuntime,
        auth: {
          ...nextRuntime.auth,
          header_name: runtimePatch.header_name || nextRuntime.auth.header_name,
          scheme: runtimePatch.scheme ?? nextRuntime.auth.scheme,
        },
        defaults: {
          ...nextRuntime.defaults,
          timeout_ms: runtimePatch.timeout_ms || nextRuntime.defaults.timeout_ms,
          body_format: runtimePatch.body_format || nextRuntime.defaults.body_format,
        },
      }, { secret: nextSecret || '' })
      if (index === 0) nextScorecard = parsed
    })

    nextEndpoints = normalizeEndpoints(nextEndpoints)
    setEndpoints(nextEndpoints)
    setEndpointJsonTexts(nextTexts.slice(0, Math.max(nextEndpoints.length, 1)))
    setRuntime(nextRuntime)
    if (nextSecret !== authSecret) setAuthSecret(nextSecret)
    if (nextScorecard) setScorecard(nextScorecard)
    return {
      endpoints: nextEndpoints,
      runtime: nextRuntime,
      secret: nextSecret,
      scorecard: nextScorecard,
      parsedByIndex,
    }
  }

  const descriptionFromEndpoints = (endpointList, parsedByIndex = []) => {
    const fieldNames = []
    const seen = new Set()
    endpointList.forEach((endpoint, index) => {
      const schema = parsedByIndex[index]?.input_schema || endpoint.input_schema
      const properties = schema?.properties
      if (!properties || typeof properties !== 'object') return
      Object.keys(properties).forEach((name) => {
        if (seen.has(name)) return
        seen.add(name)
        fieldNames.push(name)
      })
    })
    if (!fieldNames.length) return ''
    const names = endpointList
      .map((endpoint) => endpoint.name)
      .filter(Boolean)
      .join(' + ')
    const prefix = names ? `${names}. ` : ''
    return `${prefix}Collect these inputs for the agent run: ${fieldNames.join(', ')}.`.slice(0, 5000)
  }

  const handleCreate = async (event) => {
    event.preventDefault()
    const id = screenIdFrom(name)
    if (!id) return
    setBusy(true)
    setError('')
    try {
      let materialized
      try {
        materialized = materializeEndpointConfig()
      } catch (err) {
        setError(err.message)
        setBusy(false)
        return
      }
      let nextName = name.trim()
      let nextDescription = description.trim()
      if (!nextName && materialized.scorecard?.name) {
        nextName = String(materialized.scorecard.name).slice(0, 80)
        setName(nextName)
      }
      if (!nextDescription) {
        nextDescription = descriptionFromEndpoints(
          materialized.endpoints,
          materialized.parsedByIndex,
        ) || (materialized.scorecard
          ? descriptionFromScorecard(materialized.scorecard).slice(0, 5000)
          : '')
        if (nextDescription) setDescription(nextDescription)
      }
      if (!nextName || !nextDescription) {
        setError('Agent name and description are required.')
        setBusy(false)
        return
      }
      const runtimePayload = runtimeForSave(materialized.runtime, materialized.secret, {
        preserveEmptySecret: false,
      })
      const created = await createAgentProject({
        name: nextName,
        description: nextDescription,
        presentation: normalizePresentation({
          ...DEFAULT_PRESENTATION,
          display_name: nextName,
          welcome_description: nextDescription.slice(0, 240),
        }),
        runtime: runtimePayload,
        endpoints: materialized.endpoints,
        scorecard: materialized.scorecard || undefined,
      })
      setScorecard(created.scorecard || materialized.scorecard)
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
      let materialized
      try {
        materialized = materializeEndpointConfig()
      } catch (err) {
        setError(err.message)
        setBusy(false)
        return
      }
      const runtimePayload = runtimeForSave(materialized.runtime, materialized.secret)
      let nextProject = await updateAgentRuntime(agentId, runtimePayload)
      nextProject = await updateAgentEndpoints(agentId, materialized.endpoints)
      setProject(nextProject)
      if (materialized.scorecard) {
        try {
          nextProject = await updateAgentScorecard(agentId, materialized.scorecard)
          setScorecard(materialized.scorecard)
          setProject(nextProject)
        } catch {
          // Endpoints already saved; scorecard mirror is derived server-side.
        }
      }
      const release = await publishAgentProject(agentId, {
        projectRevision: nextProject.revision,
        screenRevisions: Object.fromEntries(
          screens.map((screen) => [screen.screen_id, screen.revision]),
        ),
        changeSummary: changeSummary.trim(),
      })
      setPublishedVersion(release.version)
      setNotice(`Published release ${release.version}. Open it in a new tab below.`)
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
            {/* <Link className="btn btn-outline-secondary create-library-link" to="/library">
              Library
            </Link> */}
          </div>

          <section className="create-panel">
            <div className="create-panel-copy">
              <p className="simple-kicker">New agent</p>
              <h1>Describe the agent</h1>
              <p>
                Configure shared auth for this project, add one or more agent
                endpoints (scorecard input contracts), then write a short brief.
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
                    <strong>Project runtime auth</strong>
                    <p>
                      Auth is shared by every endpoint. Secrets stay out of the
                      scorecard JSON. Bearer mode can also fall back to your
                      Studio login JWT when no token is stored.
                    </p>
                  </div>
                  <button type="button" className="btn btn-link" onClick={clearConnectionConfig}>
                    Reset
                  </button>
                </div>
                <label className="scorecard-api-key">
                  Auth type
                  <select
                    className="form-control"
                    value={runtime.auth.type}
                    onChange={(event) => updateRuntimeAuth({ type: event.target.value })}
                  >
                    {AUTH_TYPES.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>
                {runtime.auth.type === 'api_key_header' && (
                  <label className="scorecard-api-key">
                    Header name
                    <input
                      className="form-control"
                      value={runtime.auth.header_name}
                      onChange={(event) => updateRuntimeAuth({ header_name: event.target.value })}
                    />
                  </label>
                )}
                {runtime.auth.type === 'api_key_query' && (
                  <label className="scorecard-api-key">
                    Query parameter
                    <input
                      className="form-control"
                      value={runtime.auth.query_param}
                      onChange={(event) => updateRuntimeAuth({ query_param: event.target.value })}
                    />
                  </label>
                )}
                {runtime.auth.type === 'bearer' && (
                  <label className="scorecard-api-key">
                    Scheme
                    <select
                      className="form-control"
                      value={runtime.auth.scheme}
                      onChange={(event) => updateRuntimeAuth({ scheme: event.target.value })}
                    >
                      <option value="Bearer">Bearer</option>
                      <option value="">Raw token</option>
                    </select>
                  </label>
                )}
                {runtime.auth.type !== 'none' && (
                  <label className="scorecard-api-key">
                    Secret / access token
                    <input
                      className="form-control"
                      type="password"
                      autoComplete="off"
                      value={authSecret}
                      onChange={(event) => setAuthSecret(event.target.value)}
                      placeholder={
                        runtime.auth.has_secret && !authSecret
                          ? 'Saved on server — leave blank to keep'
                          : 'Paste token only'
                      }
                    />
                  </label>
                )}
                <label className="scorecard-api-key">
                  Optional base URL
                  <input
                    className="form-control"
                    value={runtime.defaults.base_url}
                    onChange={(event) => updateRuntimeDefaults({ base_url: event.target.value })}
                    placeholder="https://agent-builder.example.com"
                  />
                </label>
              </div>

              <div className="scorecard-attach">
                <div className="scorecard-attach-head">
                  <div>
                    <strong>Endpoints</strong>
                    <p>
                      Each endpoint has a URL and an input_schema (scorecard). On
                      finish, Studio calls every enabled endpoint in order.
                      Screen planning uses the union of all endpoint input fields.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => {
                      setEndpoints((current) => [...current, emptyEndpoint(current.length)])
                      setEndpointJsonTexts((current) => [...current, ''])
                    }}
                  >
                    Add endpoint
                  </button>
                </div>

                {endpoints.map((endpoint, index) => (
                  <div className="endpoint-editor" key={`${endpoint.id}-${index}`}>
                    <div className="scorecard-attach-head">
                      <strong>{endpoint.name || `Endpoint ${index + 1}`}</strong>
                      {endpoints.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-link"
                          onClick={() => {
                            setEndpoints((current) => current.filter((_, i) => i !== index))
                            setEndpointJsonTexts((current) => current.filter((_, i) => i !== index))
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <label className="scorecard-api-key">
                      Name
                      <input
                        className="form-control"
                        value={endpoint.name}
                        onChange={(event) => updateEndpointAt(index, { name: event.target.value })}
                      />
                    </label>
                    <label className="scorecard-api-key">
                      URL
                      <input
                        className="form-control"
                        value={endpoint.url}
                        onChange={(event) => updateEndpointAt(index, { url: event.target.value })}
                        placeholder="https://…/pipeline"
                      />
                    </label>
                    <div className="endpoint-editor-row">
                      <label className="scorecard-api-key">
                        Method
                        <select
                          className="form-control"
                          value={endpoint.method}
                          onChange={(event) => updateEndpointAt(index, { method: event.target.value })}
                        >
                          {['POST', 'PUT', 'PATCH', 'GET'].map((method) => (
                            <option key={method} value={method}>{method}</option>
                          ))}
                        </select>
                      </label>
                      <label className="scorecard-api-key">
                        Body
                        <select
                          className="form-control"
                          value={endpoint.body_format}
                          onChange={(event) => updateEndpointAt(index, {
                            body_format: event.target.value,
                          })}
                        >
                          {BODY_FORMATS.map((item) => (
                            <option key={item.value} value={item.value}>{item.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="scorecard-paste">
                      Paste scorecard JSON (fills this endpoint)
                      <textarea
                        className="form-control"
                        rows={5}
                        value={endpointJsonTexts[index] || ''}
                        onChange={(event) => {
                          const value = event.target.value
                          setEndpointJsonTexts((current) => {
                            const next = [...current]
                            while (next.length <= index) next.push('')
                            next[index] = value
                            return next
                          })
                        }}
                        onBlur={() => handleEndpointJsonBlur(index)}
                        placeholder='{ "name": "...", "connection": { "url": "https://..." }, "input_schema": { ... } }'
                        spellCheck={false}
                      />
                    </label>
                    <p className="scorecard-hint">
                      {Object.keys(endpoint.input_schema?.properties || {}).length
                        ? `${Object.keys(endpoint.input_schema.properties).length} input field(s)`
                        : 'No input_schema yet — paste a scorecard or plan from the description.'}
                    </p>
                  </div>
                ))}

                {configSummary.endpointCount > 0 ? (
                  <div className="scorecard-summary">
                    <div className="scorecard-summary-meta">
                      <span>Connection ready</span>
                      <code>{configSummary.authType}</code>
                      <em>{configSummary.endpointCount} endpoint(s)</em>
                    </div>
                    <ul>
                      {configSummary.urls.map((url) => (
                        <li key={url}>
                          <strong>url</strong>
                          <span>{url}</span>
                        </li>
                      ))}
                      <li>
                        <strong>secret</strong>
                        <span>
                          {configSummary.hasSecret
                            ? 'set'
                            : runtime.auth.type === 'bearer'
                              ? 'optional — Studio login JWT can be forwarded'
                              : 'optional'}
                        </span>
                      </li>
                    </ul>
                  </div>
                ) : (
                  <p className="scorecard-hint">
                    Optional. Without endpoints, screens are planned from the description only.
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
            Describe, plan, approve, then publish an immutable agent release.
          </p>
        </div>
        <Link className="btn btn-outline-secondary" to="/library">Library</Link>
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
          {(configSummary.endpointCount > 0 || scorecardInfo) && (
            <div className="simple-brief scorecard-plan-brief">
              <strong>Endpoint mapping</strong>
              <p>
                Screens will map onto{' '}
                <code>
                  {configSummary.endpointCount
                    ? `${configSummary.endpointCount} endpoint(s)`
                    : scorecardInfo?.runtimeId || scorecardInfo?.name || 'attached'}
                </code>
                {configSummary.fieldCount
                  ? ` · ${configSummary.fieldCount} input field(s)`
                  : scorecardInfo?.fieldCount
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
                    <strong>Runtime auth & endpoints</strong>
                    <p>
                      Shared project auth applies to every endpoint. On finish,
                      enabled endpoints are called in order.
                    </p>
                  </div>
                </div>
                <label className="scorecard-api-key">
                  Auth type
                  <select
                    className="form-control"
                    value={runtime.auth.type}
                    onChange={(event) => updateRuntimeAuth({ type: event.target.value })}
                  >
                    {AUTH_TYPES.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>
                {runtime.auth.type !== 'none' && (
                  <label className="scorecard-api-key">
                    Secret / access token
                    <input
                      className="form-control"
                      type="password"
                      autoComplete="off"
                      value={authSecret}
                      onChange={(event) => setAuthSecret(event.target.value)}
                      placeholder={
                        runtime.auth.has_secret && !authSecret
                          ? 'Saved on server — leave blank to keep'
                          : 'Paste token only'
                      }
                    />
                  </label>
                )}
                <p className="scorecard-hint">
                  {configSummary.urls.length
                    ? `${configSummary.endpointCount} endpoint(s): ${configSummary.urls.join(' · ')}`
                    : 'No endpoint URLs configured yet.'}
                  {' · '}
                  {configSummary.hasSecret ? 'secret set' : 'no stored secret'}
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
                <div className="publish-success">
                  <div>
                    <strong>
                      {publishedVersion
                        ? `Release ${publishedVersion} is live`
                        : `Release ${project.latest_release} is published`}
                    </strong>
                    <p>
                      Open the published agent runtime in a new browser tab.
                      Studio stays here so you can keep editing.
                    </p>
                  </div>
                  <div className="simple-actions">
                    <a
                      className="btn btn-primary"
                      href={publishedAgentHref(
                        agentId,
                        publishedVersion || project.latest_release,
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open published agent
                    </a>
                    <Link className="btn btn-outline-secondary" to="/library">
                      Back to library
                    </Link>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </main>
  )
}
