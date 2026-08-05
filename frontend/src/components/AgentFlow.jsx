import { useMemo, useState } from 'react'
import ContentExperience from './ContentExperience.jsx'
import { normalizePresentation } from '../lib/presentation.js'
import ScreenExperience from './ScreenExperience.jsx'

export function orderedJourney(screens, screenIds, startScreenId) {
  const byId = new Map(screens.map((screen) => [screen.screen_id, screen]))
  const ordered = screenIds.map((screenId) => byId.get(screenId)).filter(Boolean)
  const startIndex = ordered.findIndex(
    (screen) => screen.screen_id === startScreenId,
  )
  if (startIndex <= 0) return ordered
  return [...ordered.slice(startIndex), ...ordered.slice(0, startIndex)]
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
  const current = journey[screenIndex]
  const isLast = screenIndex === journey.length - 1

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
    setScreenIndex((index) => index + 1)
  }

  if (!current) {
    return (
      <section className="agent-flow-empty">
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

  return (
    <section
      className={`agent-flow ${isPublished ? 'is-published' : ''}`}
      aria-label={`${agentName} screens`}
    >
      <ol
        className={`agent-flow-rail ${isPublished ? 'is-compact' : ''}`}
        aria-label="Agent screen progress"
      >
        {journey.map((screen, index) => {
          const approved = Boolean(screen.approved_manifest)
          return (
            <li
              key={screen.screen_id}
              className={`${index === screenIndex ? 'is-active' : ''} ${
                index < screenIndex ? 'is-complete' : ''
              } ${showApprovalStatus && approved ? 'is-approved' : ''} ${
                showApprovalStatus && !approved ? 'needs-approval' : ''
              }`}
              aria-current={index === screenIndex ? 'step' : undefined}
            >
              <span>{index < screenIndex ? '✓' : index + 1}</span>
              {!isPublished && (
                <div>
                  <strong>{screen.name}</strong>
                  <small>
                    {screen.screen_type} · {screen.purpose}
                    {showApprovalStatus
                      ? ` · ${approved ? 'Approved' : 'Needs approval'}`
                      : ''}
                  </small>
                </div>
              )}
              {isPublished && <strong>{screen.name}</strong>}
            </li>
          )
        })}
      </ol>

      {!isPublished && (
        <div className="agent-flow-meta">
          <span className="section-kicker">
            Screen {screenIndex + 1} of {journey.length}
          </span>
          <span>{current.screen_type === 'form' ? 'Validated form' : 'Information screen'}</span>
        </div>
      )}

      {isPublished && (
        <p className="agent-flow-step-label">
          Step {screenIndex + 1} of {journey.length}
        </p>
      )}

      <div className="agent-flow-screen">
        {current.screen_type === 'content' ? (
          <>
            <ContentExperience
              manifest={current.manifest}
              presentation={presentation}
              name={current.name}
              description={current.description}
              framed={false}
            />
            <div className="agent-flow-actions">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={moveBack}
                disabled={screenIndex === 0}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => moveForward()}
              >
                {isLast ? 'Finish' : 'Continue'}
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
            {screenIndex > 0 && (
              <div className="agent-flow-back-row">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={moveBack}
                >
                  Back
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
