import { useEffect, useMemo, useRef, useState } from 'react'
import ContentExperience from './ContentExperience.jsx'
import { normalizePresentation } from '../lib/presentation.js'
import ScreenExperience from './ScreenExperience.jsx'
import { ArrowLeft, ArrowRight, Check, FileText, Layers, X } from './ui/Icons.jsx'
import '../runtime.css'

export function orderedJourney(screens, screenIds, startScreenId) {
  const byId = new Map(screens.map((screen) => [screen.screen_id, screen]))
  const ordered = screenIds.map((screenId) => byId.get(screenId)).filter(Boolean)
  const startIndex = ordered.findIndex(
    (screen) => screen.screen_id === startScreenId,
  )
  if (startIndex <= 0) return ordered
  return [...ordered.slice(startIndex), ...ordered.slice(0, startIndex)]
}

/** Sidebar entry for one screen in the journey. */
function ScreenNavItem({ screen, index, state, onSelect, showMeta }) {
  const clickable = state === 'complete' || state === 'active'

  return (
    <li className={`ar-nav-item is-${state}`}>
      <button
        type="button"
        className="ar-nav-button"
        onClick={clickable ? () => onSelect(index) : undefined}
        disabled={!clickable}
        aria-current={state === 'active' ? 'step' : undefined}
      >
        <span className="ar-nav-marker" aria-hidden="true">
          {state === 'complete' ? <Check size={13} /> : index + 1}
        </span>
        <span className="ar-nav-copy">
          <strong>{screen.name}</strong>
          {showMeta ? (
            <small>
              {screen.screen_type === 'form' ? 'Form' : 'Information'}
              {screen.purpose ? ` · ${screen.purpose}` : ''}
            </small>
          ) : null}
        </span>
        {state === 'complete' ? (
          <span className="ar-nav-status">Done</span>
        ) : null}
      </button>
    </li>
  )
}

export default function AgentFlow({
  screens,
  screenIds,
  startScreenId,
  agentName,
  agentDescription,
  onComplete,
  showApprovalStatus = false,
  variant = 'studio',
}) {
  const isPublished = variant === 'published'
  const journey = useMemo(
    () => orderedJourney(screens, screenIds, startScreenId),
    [screenIds, screens, startScreenId],
  )
  const [screenIndex, setScreenIndex] = useState(0)
  const [valuesByScreen, setValuesByScreen] = useState({})
  const [furthestIndex, setFurthestIndex] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const stageRef = useRef(null)

  const current = journey[screenIndex]
  const isLast = screenIndex === journey.length - 1
  const progress = journey.length
    ? Math.round(((screenIndex + 1) / journey.length) * 100)
    : 0

  // Move focus to the top of the new screen so keyboard and screen-reader
  // users are not left at the bottom of the previous one.
  useEffect(() => {
    if (screenIndex === 0) return
    stageRef.current?.focus?.()
  }, [screenIndex])

  const goToScreen = (index) => {
    if (index < 0 || index >= journey.length) return
    if (index > furthestIndex) return
    setScreenIndex(index)
    setDrawerOpen(false)
  }

  const moveBack = () => {
    setScreenIndex((index) => Math.max(0, index - 1))
  }

  const moveForward = (formData) => {
    const nextValues = current.screen_type === 'form'
      ? { ...valuesByScreen, [current.screen_id]: formData }
      : valuesByScreen
    setValuesByScreen(nextValues)
    if (isLast) {
      onComplete(nextValues)
      return
    }
    const nextIndex = screenIndex + 1
    setFurthestIndex((furthest) => Math.max(furthest, nextIndex))
    setScreenIndex(nextIndex)
  }

  if (!current) {
    return (
      <section className="ar-empty">
        <span className="ar-empty-icon"><Layers size={22} /></span>
        <h2>No screens are available</h2>
        <p>This agent experience does not contain an active screen.</p>
      </section>
    )
  }

  const screenPresentation = normalizePresentation(current.presentation, {
    name: current.name || agentName,
    description: current.description || agentDescription,
  })
  const presentation = {
    ...screenPresentation,
    submit_label: isLast ? 'Finish' : 'Continue',
  }

  const navItems = (
    <ol className="ar-nav-list">
      {journey.map((screen, index) => {
        let state = 'upcoming'
        if (index < screenIndex) state = 'complete'
        else if (index === screenIndex) state = 'active'
        else if (index <= furthestIndex) state = 'visited'

        return (
          <ScreenNavItem
            key={screen.screen_id}
            screen={screen}
            index={index}
            state={state}
            onSelect={goToScreen}
            showMeta={!isPublished}
          />
        )
      })}
    </ol>
  )

  const approvalSummary = showApprovalStatus
    ? journey.filter((screen) => screen.approved_manifest).length
    : null

  return (
    <section
      className={`ar-flow ${isPublished ? 'is-published' : 'is-studio'}`}
      aria-label={`${agentName} screens`}
    >
      {/* Compact progress header — the only nav affordance on small screens */}
      <div className="ar-progress-bar">
        <button
          type="button"
          className="ar-drawer-toggle"
          onClick={() => setDrawerOpen(true)}
          aria-expanded={drawerOpen}
        >
          <Layers size={16} />
          <span>
            Step {screenIndex + 1} of {journey.length}
          </span>
        </button>
        <div className="ar-progress-track" aria-hidden="true">
          <span className="ar-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="ar-layout">
        <aside
          className={`ar-sidebar ${drawerOpen ? 'is-open' : ''}`.trim()}
          aria-label="Screen navigation"
        >
          <div className="ar-sidebar-head">
            <span className="ar-sidebar-title">Screens</span>
            <button
              type="button"
              className="ar-drawer-close"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close screen navigation"
            >
              <X size={17} />
            </button>
          </div>

          {navItems}

          <div className="ar-sidebar-foot">
            <div className="ar-sidebar-progress" aria-hidden="true">
              <span style={{ width: `${progress}%` }} />
            </div>
            <span className="ar-sidebar-count">
              {screenIndex + 1} of {journey.length}
              {approvalSummary != null
                ? ` · ${approvalSummary}/${journey.length} approved`
                : ''}
            </span>
          </div>
        </aside>

        {drawerOpen ? (
          <button
            type="button"
            className="ar-drawer-scrim"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close screen navigation"
          />
        ) : null}

        <div className="ar-main">
          <div
            className="ar-stage"
            key={current.screen_id}
            ref={stageRef}
            tabIndex={-1}
          >
            {!isPublished ? (
              <div className="ar-stage-meta">
                <span className="ar-stage-kicker">
                  Screen {screenIndex + 1} of {journey.length}
                </span>
                <span>
                  {current.screen_type === 'form'
                    ? 'Validated form'
                    : 'Information screen'}
                </span>
              </div>
            ) : null}

            {current.screen_type === 'content' ? (
              <>
                <ContentExperience
                  manifest={current.manifest}
                  presentation={presentation}
                  name={current.name}
                  description={current.description}
                  framed={false}
                />
                <div className="ar-actions">
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={moveBack}
                    disabled={screenIndex === 0}
                  >
                    <ArrowLeft size={16} />
                    Back
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => moveForward()}
                  >
                    {isLast ? 'Finish' : 'Continue'}
                    <ArrowRight size={16} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <ScreenExperience
                  key={current.screen_id}
                  manifest={current.manifest}
                  presentation={presentation}
                  description={current.description}
                  agentName={current.name}
                  framed={false}
                  formData={valuesByScreen[current.screen_id] ?? {}}
                  onChange={(formData) => setValuesByScreen((stored) => ({
                    ...stored,
                    [current.screen_id]: formData,
                  }))}
                  onSubmit={moveForward}
                />
                {screenIndex > 0 ? (
                  <div className="ar-back-row">
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={moveBack}
                    >
                      <ArrowLeft size={16} />
                      Back
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>

          <p className="ar-stage-note">
            <FileText size={13} />
            Your answers stay in this browser until you finish.
          </p>
        </div>
      </div>
    </section>
  )
}
