import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  createProjectScreenDraft,
  downloadAgentFrontend,
  duplicateProjectScreen,
  generateProjectScreen,
  generateScreenPlan,
  listAgentReleases,
  loadAgentProject,
  restoreAgentRelease,
  saveAgentProject,
  setProjectScreenArchived,
} from './api.js'
import { saveFrontendArchive } from './frontendDownload.js'
import { normalizePresentation } from './presentation.js'
import { createReviewDraft } from './reviewModel.js'
import { screenIdFrom } from './screenIdentity.js'
import { AgentGlyph, SparkIcon, WorkspaceLoading } from './StudioShell.jsx'

const EMPTY_FORM_MANIFEST = {
  input_schema: {
    type: 'object',
    properties: {
      details: {
        type: 'string',
        title: 'Details',
        description: 'Provide the information needed for this screen.',
      },
    },
    required: [],
  },
  ui_hints: {
    mode: 'single',
    field_order: ['details'],
    blocks: [
      { id: 'screen-heading', type: 'heading', text: 'Tell us more', level: 2 },
      { id: 'field-details', type: 'field', field: 'details' },
    ],
  },
}

const EMPTY_CONTENT_MANIFEST = {
  blocks: [
    {
      id: 'screen-heading',
      type: 'heading',
      text: 'Helpful information',
      level: 2,
    },
    {
      id: 'screen-content',
      type: 'paragraph',
      text: 'Add the content your users need on this screen.',
    },
  ],
}

function defaultPurpose(screenType) {
  return screenType === 'form' ? 'intake' : 'information'
}

function PlanRow({ item, index, onChange, onRemove, disabled }) {
  const update = (changes) => onChange(index, { ...item, ...changes })
  return (
    <article className="screen-plan-row">
      <div className="screen-plan-number">{index + 1}</div>
      <div className="screen-plan-fields">
        <label>
          Screen name
          <input
            className="form-control"
            value={item.name}
            maxLength={80}
            onChange={(event) => update({ name: event.target.value })}
            disabled={disabled}
          />
          <small>Screen ID: {screenIdFrom(item.name) || 'invalid name'}</small>
        </label>
        <label>
          Type
          <select
            className="form-control"
            value={item.screen_type}
            onChange={(event) => update({
              screen_type: event.target.value,
              purpose: defaultPurpose(event.target.value),
            })}
            disabled={disabled}
          >
            <option value="form">Form</option>
            <option value="content">Content</option>
          </select>
        </label>
        <label>
          Purpose
          <select
            className="form-control"
            value={item.purpose}
            onChange={(event) => update({ purpose: event.target.value })}
            disabled={disabled}
          >
            {item.screen_type === 'form' ? (
              <>
                <option value="intake">Intake</option>
                <option value="settings">Settings</option>
              </>
            ) : (
              <>
                <option value="information">Information</option>
                <option value="confirmation">Confirmation</option>
              </>
            )}
          </select>
        </label>
        <label className="screen-plan-description">
          Screen brief
          <textarea
            className="form-control"
            value={item.description}
            maxLength={500}
            rows={3}
            onChange={(event) => update({ description: event.target.value })}
            disabled={disabled}
          />
        </label>
      </div>
      <button
        type="button"
        className="btn btn-link"
        onClick={() => onRemove(index)}
        disabled={disabled}
      >
        Remove
      </button>
    </article>
  )
}

export default function AgentWorkspacePage() {
  const { agentId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [project, setProject] = useState(null)
  const [releases, setReleases] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exportError, setExportError] = useState('')
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState(location.state?.openScreenPlan ? 'plan' : 'screens')
  const [plan, setPlan] = useState([])
  const [planning, setPlanning] = useState(false)
  const [creatingScreens, setCreatingScreens] = useState(false)
  const [manual, setManual] = useState({
    name: '',
    screen_type: 'form',
    purpose: 'intake',
    description: '',
  })
  const [duplicate, setDuplicate] = useState(null)
  const [duplicateName, setDuplicateName] = useState('')
  const [identity, setIdentity] = useState({ name: '', description: '' })
  const [savingProject, setSavingProject] = useState(false)
  const [exportingVersions, setExportingVersions] = useState([])
  const exportRequests = useRef(new Set())

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const loaded = await loadAgentProject(agentId)
      setProject(loaded)
      setIdentity({
        name: loaded.name ?? '',
        description: loaded.description ?? '',
      })
      setReleases(await listAgentReleases(agentId))
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const screensById = useMemo(
    () => new Map((project?.screens ?? []).map((screen) => [screen.screen_id, screen])),
    [project],
  )
  const orderedScreens = useMemo(
    () => (project?.screen_ids ?? []).map((screenId) => (
      screensById.get(screenId) ?? {
        agent_id: agentId,
        screen_id: screenId,
        name: screenId,
        screen_type: 'form',
        purpose: 'intake',
        approved: false,
        legacy_missing_draft: true,
      }
    )),
    [agentId, project, screensById],
  )
  const archivedScreens = useMemo(
    () => (project?.screens ?? []).filter((screen) => screen.is_archived),
    [project],
  )
  const allApproved = orderedScreens.length > 0
    && orderedScreens.every((screen) => screen.approved)

  const handleDownloadRelease = async (version) => {
    if (exportRequests.current.has(version)) return
    exportRequests.current.add(version)
    setExportingVersions((current) => [...current, version])
    setExportError('')
    setNotice('')
    try {
      const archive = await downloadAgentFrontend(agentId, version)
      saveFrontendArchive(archive, agentId, version)
      setNotice(`Release ${version} frontend was downloaded.`)
    } catch (requestError) {
      setExportError(
        requestError instanceof Error
          ? requestError.message
          : 'The frontend download could not be prepared.',
      )
    } finally {
      exportRequests.current.delete(version)
      setExportingVersions((current) =>
        current.filter((item) => item !== version))
    }
  }

  const handleGeneratePlan = async () => {
    setPlanning(true)
    setError('')
    setNotice('')
    try {
      const result = await generateScreenPlan(agentId, identity.description)
      setPlan(result.screens)
      setNotice('AI proposed an ordered screen plan. Review every item before generating.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setPlanning(false)
    }
  }

  const updatePlan = (index, value) => {
    setPlan((current) => current.map((item, itemIndex) => (
      itemIndex === index ? value : item
    )))
  }

  const createDraftFromDefinition = async (definition, generated = true) => {
    const generatedScreen = generated
      ? await generateProjectScreen(agentId, definition)
      : {
          screen_id: screenIdFrom(definition.name),
          screen_type: definition.screen_type,
          purpose: definition.purpose,
          manifest: definition.screen_type === 'form'
            ? EMPTY_FORM_MANIFEST
            : EMPTY_CONTENT_MANIFEST,
        }
    const presentation = normalizePresentation({
      display_name: definition.name.trim(),
      welcome_title: definition.name.trim(),
      welcome_description: definition.description.trim().slice(0, 240),
    })
    const editorState = definition.screen_type === 'form'
      ? createReviewDraft(generatedScreen.manifest, {
          origin: generated ? 'llm' : 'manual',
          layoutApproved: false,
        })
      : { layoutApproved: false }
    return createProjectScreenDraft(
      agentId,
      generatedScreen.screen_id,
      {
        screenType: definition.screen_type,
        purpose: definition.purpose,
        manifest: generatedScreen.manifest,
        description: definition.description.trim(),
        name: definition.name.trim(),
        source: generated ? 'llm' : 'manual',
        presentation,
        editorState,
        generation: generatedScreen.generation ?? {},
      },
    )
  }

  const validDefinitions = (definitions) => {
    const known = new Set((project?.screens ?? []).map((screen) => screen.screen_id))
    const next = new Set()
    for (const definition of definitions) {
      const screenId = screenIdFrom(definition.name)
      if (!screenId || !definition.description.trim()) return false
      if (known.has(screenId) || next.has(screenId)) return false
      next.add(screenId)
    }
    return definitions.length > 0
  }

  const handleCreatePlan = async () => {
    if (!validDefinitions(plan)) {
      setError('Every planned screen needs a unique valid name and description.')
      return
    }
    setCreatingScreens(true)
    setError('')
    setNotice('')
    const failures = []
    for (const definition of plan) {
      try {
        await createDraftFromDefinition(definition, true)
      } catch (requestError) {
        failures.push(`${definition.name}: ${requestError.message}`)
      }
    }
    await refresh()
    setCreatingScreens(false)
    if (failures.length) {
      setError(`Some screens could not be generated:\n${failures.join('\n')}`)
    } else {
      setPlan([])
      setTab('screens')
      setNotice('All approved plan items were generated as independent screen drafts.')
    }
  }

  const handleCreateManual = async (event) => {
    event.preventDefault()
    if (!validDefinitions([manual])) {
      setError('Choose a unique valid screen name and add a description.')
      return
    }
    setCreatingScreens(true)
    setError('')
    try {
      const draft = await createDraftFromDefinition(manual, false)
      await refresh()
      navigate(
        manual.screen_type === 'content'
          ? `/studio/agents/${encodeURIComponent(agentId)}/screens/${encodeURIComponent(draft.screen_id)}/content`
          : `/studio/agents/${encodeURIComponent(agentId)}/screens/${encodeURIComponent(draft.screen_id)}/edit`,
      )
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setCreatingScreens(false)
    }
  }

  const saveProjectPatch = async (changes) => {
    if (!project) return
    setSavingProject(true)
    setError('')
    try {
      const updated = await saveAgentProject(agentId, {
        name: changes.name ?? project.name,
        description: changes.description ?? project.description,
        presentation: changes.presentation ?? project.presentation,
        screen_ids: changes.screen_ids ?? project.screen_ids,
        start_screen_id: changes.start_screen_id === undefined
          ? project.start_screen_id
          : changes.start_screen_id,
        revision: project.revision,
      })
      setProject(updated)
      setNotice('Agent workspace saved.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSavingProject(false)
    }
  }

  const moveScreen = (index, direction) => {
    const destination = index + direction
    if (destination < 0 || destination >= orderedScreens.length) return
    const next = [...project.screen_ids]
    const [moved] = next.splice(index, 1)
    next.splice(destination, 0, moved)
    saveProjectPatch({ screen_ids: next })
  }

  const archiveScreen = async (screen, archived) => {
    setError('')
    try {
      await setProjectScreenArchived(agentId, screen.screen_id, archived)
      await refresh()
      setNotice(`${screen.name} was ${archived ? 'archived' : 'restored'}.`)
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  const confirmDuplicate = async () => {
    if (!duplicate || !screenIdFrom(duplicateName)) return
    setCreatingScreens(true)
    setError('')
    try {
      await duplicateProjectScreen(
        agentId,
        duplicate.screen_id,
        duplicateName.trim(),
      )
      setDuplicate(null)
      await refresh()
      setNotice('Screen duplicated as a new unapproved draft.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setCreatingScreens(false)
    }
  }

  const handleRestoreRelease = async (version) => {
    setSavingProject(true)
    setError('')
    try {
      await restoreAgentRelease(agentId, version)
      await refresh()
      setNotice(`Release ${version} was restored into editable drafts.`)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSavingProject(false)
    }
  }

  if (loading) {
    return <main className="app-main"><WorkspaceLoading message="Opening agent workspace..." /></main>
  }
  if (error && !project) {
    return (
      <main className="route-state-page">
        <h1>Agent workspace unavailable</h1>
        <p>{error}</p>
        <Link to="/library">Return to Agent Library</Link>
      </main>
    )
  }

  return (
    <main className="app-main agent-workspace-page">
      <section className="agent-workspace-heading">
        <div className="agent-workspace-identity">
          <span className="project-icon"><AgentGlyph icon={project.presentation?.icon} size={24} /></span>
          <div>
            <span className="section-kicker">Agent workspace</span>
            <h1>{project.name}</h1>
            <code>{project.agent_id}</code>
          </div>
        </div>
        <div className="agent-workspace-actions">
          <Link className="btn btn-outline-secondary" to="/library">Agent Library</Link>
          <Link
            className="btn btn-outline-secondary"
            to={`/studio/agents/${encodeURIComponent(agentId)}/preview`}
          >
            Preview agent
          </Link>
          {allApproved ? (
            <Link
              className="btn btn-primary"
              to={`/studio/agents/${encodeURIComponent(agentId)}/preview?publish=1`}
            >
              Review &amp; publish
            </Link>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled
              title="Approve every active screen before publishing."
            >
              Review &amp; publish
            </button>
          )}
        </div>
      </section>

      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      {exportError && (
        <div className="alert alert-danger workspace-error" role="alert">
          <strong>Could not download the frontend</strong>
          <span>{exportError}</span>
        </div>
      )}
      {error && <div className="alert alert-danger workspace-error" role="alert">{error}</div>}

      <nav className="agent-workspace-tabs" aria-label="Agent workspace sections">
        {[
          ['screens', `Screens (${orderedScreens.length})`],
          ['plan', 'AI screen plan'],
          ['order', 'Screen order'],
          ['settings', 'Agent settings'],
          ['releases', `Releases (${releases.length})`],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={tab === value ? 'is-active' : ''}
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'screens' && (
        <section className="workspace-panel">
          <header className="workspace-panel-heading">
            <div>
              <span className="section-kicker">Screen folder</span>
              <h2>Published-user screens</h2>
              <p>Every screen has its own safe manifest, draft, approval state, and purpose.</p>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => setTab('plan')}>
              + Add screens
            </button>
          </header>
          {orderedScreens.length === 0 ? (
            <div className="workspace-empty">
              <SparkIcon size={30} />
              <h3>This agent does not have any screens yet</h3>
              <p>Generate an AI plan or create the first screen manually.</p>
              <button type="button" className="btn btn-primary" onClick={() => setTab('plan')}>
                Plan screens
              </button>
            </div>
          ) : (
            <div className="agent-screen-folder">
              {orderedScreens.map((screen, index) => (
                <article className="agent-screen-row" key={screen.screen_id}>
                  <span className="agent-screen-index">{index + 1}</span>
                  <div className="agent-screen-details">
                    <div>
                      <span className="section-kicker">{screen.screen_type} · {screen.purpose}</span>
                      <h3>{screen.name || screen.screen_id}</h3>
                      <code>{screen.screen_id}</code>
                    </div>
                    <p>{screen.description || 'No screen description provided.'}</p>
                  </div>
                  <div className="agent-screen-statuses">
                    {project.start_screen_id === screen.screen_id && <span className="badge badge-info">Start screen</span>}
                    <span className={`badge ${screen.approved ? 'badge-success' : 'badge-warning'}`}>
                      {screen.approved ? 'Approved' : 'Needs review'}
                    </span>
                  </div>
                  <div className="agent-screen-actions">
                    {screen.legacy_missing_draft ? (
                      <Link className="btn btn-primary" to={`/builder/${encodeURIComponent(screen.screen_id)}/edit`}>
                        Create draft
                      </Link>
                    ) : (
                      <Link
                        className="btn btn-primary"
                        to={screen.screen_type === 'content'
                          ? `/studio/agents/${encodeURIComponent(agentId)}/screens/${encodeURIComponent(screen.screen_id)}/content`
                          : `/studio/agents/${encodeURIComponent(agentId)}/screens/${encodeURIComponent(screen.screen_id)}/edit`}
                      >
                        Edit screen
                      </Link>
                    )}
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={() => {
                        setDuplicate(screen)
                        setDuplicateName(`${screen.name} Copy`)
                      }}
                      disabled={screen.legacy_missing_draft}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      className="btn btn-link"
                      onClick={() => archiveScreen(screen, true)}
                      disabled={orderedScreens.length === 1 || screen.legacy_missing_draft}
                    >
                      Archive
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {archivedScreens.length > 0 && (
            <details className="archived-screen-list">
              <summary>Archived screens ({archivedScreens.length})</summary>
              {archivedScreens.map((screen) => (
                <div key={screen.screen_id}>
                  <span>{screen.name}</span>
                  <button type="button" className="btn btn-link" onClick={() => archiveScreen(screen, false)}>
                    Restore
                  </button>
                </div>
              ))}
            </details>
          )}
        </section>
      )}

      {tab === 'plan' && (
        <section className="workspace-panel screen-planner-panel">
          <header className="workspace-panel-heading">
            <div>
              <span className="section-kicker">AI screen planner</span>
              <h2>Plan, review, then generate independently</h2>
              <p>AI cannot create IDs, routes, permissions, or credentials. You approve every proposal.</p>
            </div>
            <button type="button" className="btn btn-primary" onClick={handleGeneratePlan} disabled={planning || creatingScreens}>
              {planning ? 'Planning screens...' : 'Generate screen plan'}
            </button>
          </header>

          {plan.length > 0 && (
            <div className="screen-plan-review">
              {plan.map((item, index) => (
                <PlanRow
                  key={`${index}-${item.name}`}
                  item={item}
                  index={index}
                  onChange={updatePlan}
                  onRemove={(removeIndex) => setPlan((current) =>
                    current.filter((_, itemIndex) => itemIndex !== removeIndex))}
                  disabled={creatingScreens}
                />
              ))}
              <button
                type="button"
                className="btn btn-outline-primary"
                onClick={() => setPlan((current) => [...current, {
                  name: 'New screen',
                  screen_type: 'form',
                  purpose: 'intake',
                  description: 'Describe what this screen should collect.',
                }])}
                disabled={creatingScreens || plan.length >= 20}
              >
                + Add proposal
              </button>
              <button type="button" className="btn btn-success" onClick={handleCreatePlan} disabled={creatingScreens}>
                {creatingScreens ? 'Generating approved screens...' : `Approve plan & generate ${plan.length} screens`}
              </button>
            </div>
          )}

          <div className="manual-screen-divider"><span>or create one manually</span></div>
          <form className="manual-screen-form" onSubmit={handleCreateManual}>
            <label>
              Screen name
              <input
                className="form-control"
                value={manual.name}
                onChange={(event) => setManual((current) => ({ ...current, name: event.target.value }))}
                placeholder="e.g. Business Hours"
                required
              />
              <small>Screen ID: {screenIdFrom(manual.name) || 'enter a valid name'}</small>
            </label>
            <label>
              Type
              <select
                className="form-control"
                value={manual.screen_type}
                onChange={(event) => setManual((current) => ({
                  ...current,
                  screen_type: event.target.value,
                  purpose: defaultPurpose(event.target.value),
                }))}
              >
                <option value="form">Form</option>
                <option value="content">Content</option>
              </select>
            </label>
            <label>
              Purpose
              <select
                className="form-control"
                value={manual.purpose}
                onChange={(event) => setManual((current) => ({ ...current, purpose: event.target.value }))}
              >
                {manual.screen_type === 'form'
                  ? <><option value="intake">Intake</option><option value="settings">Settings</option></>
                  : <><option value="information">Information</option><option value="confirmation">Confirmation</option></>}
              </select>
            </label>
            <label className="manual-screen-description">
              Screen description
              <textarea
                className="form-control"
                rows={4}
                value={manual.description}
                onChange={(event) => setManual((current) => ({ ...current, description: event.target.value }))}
                required
              />
            </label>
            <button type="submit" className="btn btn-outline-primary" disabled={creatingScreens}>
              Create manual draft
            </button>
          </form>
        </section>
      )}

      {tab === 'order' && (
        <section className="workspace-panel">
          <header className="workspace-panel-heading">
            <div>
              <span className="section-kicker">Ordered navigation</span>
              <h2>Choose the published journey</h2>
              <p>Forms validate before users advance. Content screens continue without submitting data.</p>
            </div>
          </header>
          <label className="start-screen-picker">
            Start screen
            <select
              className="form-control"
              value={project.start_screen_id ?? ''}
              onChange={(event) => saveProjectPatch({ start_screen_id: event.target.value || null })}
              disabled={savingProject || orderedScreens.length === 0}
            >
              {orderedScreens.map((screen) => (
                <option key={screen.screen_id} value={screen.screen_id}>{screen.name}</option>
              ))}
            </select>
          </label>
          <ol className="screen-order-list">
            {orderedScreens.map((screen, index) => (
              <li key={screen.screen_id}>
                <span>{index + 1}</span>
                <div><strong>{screen.name}</strong><small>{screen.screen_type} · {screen.purpose}</small></div>
                <button type="button" className="btn btn-outline-secondary" onClick={() => moveScreen(index, -1)} disabled={savingProject || index === 0}>Move up</button>
                <button type="button" className="btn btn-outline-secondary" onClick={() => moveScreen(index, 1)} disabled={savingProject || index === orderedScreens.length - 1}>Move down</button>
              </li>
            ))}
          </ol>
        </section>
      )}

      {tab === 'settings' && (
        <section className="workspace-panel">
          <header className="workspace-panel-heading">
            <div>
              <span className="section-kicker">Creator-only settings</span>
              <h2>Agent identity</h2>
              <p>These settings describe the project. They are separate from generated published-user settings screens.</p>
            </div>
          </header>
          <form
            className="agent-settings-form"
            onSubmit={(event) => {
              event.preventDefault()
              saveProjectPatch(identity)
            }}
          >
            <label>
              Agent name
              <input className="form-control" value={identity.name} onChange={(event) => setIdentity((current) => ({ ...current, name: event.target.value }))} maxLength={80} required />
              <small>The stable agent ID remains {project.agent_id}.</small>
            </label>
            <label>
              Agent description
              <textarea className="form-control" value={identity.description} onChange={(event) => setIdentity((current) => ({ ...current, description: event.target.value }))} maxLength={5000} rows={7} />
            </label>
            <button type="submit" className="btn btn-primary" disabled={savingProject}>Save agent settings</button>
          </form>
        </section>
      )}

      {tab === 'releases' && (
        <section className="workspace-panel">
          <header className="workspace-panel-heading">
            <div>
              <span className="section-kicker">Immutable history</span>
              <h2>Agent releases</h2>
              <p>Each release pins the complete navigation and every approved screen snapshot.</p>
            </div>
          </header>
          {releases.length === 0 ? (
            <div className="workspace-empty"><h3>No releases yet</h3><p>Approve all screens, preview the complete journey, then publish.</p></div>
          ) : (
            <ol className="agent-release-list">
              {releases.map((release) => (
                <li key={release.version}>
                  <span className="library-version">release {release.version}</span>
                  <div><strong>{release.change_summary}</strong><small>{release.published_at} · {(release.screen_ids ?? []).length} screens</small></div>
                  <Link className="btn btn-link" to={`/agents/${encodeURIComponent(agentId)}?version=${release.version}`}>Open</Link>
                  <button
                    type="button"
                    className="btn btn-link"
                    disabled={exportingVersions.includes(release.version)}
                    onClick={() => handleDownloadRelease(release.version)}
                  >
                    {exportingVersions.includes(release.version)
                      ? 'Preparing download…'
                      : 'Download frontend'}
                  </button>
                  <button type="button" className="btn btn-link" onClick={() => handleRestoreRelease(release.version)}>Restore</button>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {duplicate && (
        <div className="library-dialog-backdrop" role="presentation">
          <section className="library-dialog" role="dialog" aria-modal="true">
            <span className="section-kicker">Duplicate screen</span>
            <h2>Create a separate screen draft</h2>
            <label>
              New screen name
              <input className="form-control" value={duplicateName} onChange={(event) => setDuplicateName(event.target.value)} />
              <small>Screen ID: {screenIdFrom(duplicateName) || 'enter a valid name'}</small>
            </label>
            <p>The copied layout will require human approval again.</p>
            <div className="library-dialog-actions">
              <button type="button" className="btn btn-outline-secondary" onClick={() => setDuplicate(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={confirmDuplicate} disabled={creatingScreens || !screenIdFrom(duplicateName)}>Duplicate screen</button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
