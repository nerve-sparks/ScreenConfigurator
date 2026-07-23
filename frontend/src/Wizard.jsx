import { useState } from 'react'
import FormRenderer from './FormRenderer.jsx'
import { schemaForGroup, toUiSchema } from './manifestLayout.js'

/**
 * Multi-screen wizard (Step 6): one step per ui_hints.group.
 *
 * Each step is a normal RJSF form, so per-step validation is unchanged;
 * "Next"/"Submit" only advance when the current step validates. Data is
 * kept per step (so Back/Next never loses input) and merged into one
 * object which is handed to onSubmit at the very end.
 */
function summaryValue(value) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string' && value.startsWith('data:')) return 'File attached'
  if (value === undefined || value === null || value === '') return 'Not provided'
  return String(value)
}

export default function Wizard({
  manifest,
  onSubmit,
  disabled = false,
  showSummary = false,
  submitLabel = 'Submit',
  activeGroupId,
  onActiveGroupChange,
}) {
  const groups = Array.isArray(manifest?.ui_hints?.groups)
    ? manifest.ui_hints.groups
    : []
  const [stepIndex, setStepIndex] = useState(0)
  const [stepData, setStepData] = useState(() => groups.map(() => ({})))
  const [showingSummary, setShowingSummary] = useState(false)
  const previewNavigation = disabled && typeof onActiveGroupChange === 'function'
  const requestedStepIndex = previewNavigation
    ? groups.findIndex((candidate) => candidate.id === activeGroupId)
    : -1
  const currentStepIndex = requestedStepIndex >= 0 ? requestedStepIndex : stepIndex

  const isLastStep = currentStepIndex === groups.length - 1
  const group = groups[currentStepIndex]
  const schema = group ? schemaForGroup(manifest.input_schema, group) : null
  const uiSchema = group && schema
    ? toUiSchema({
        input_schema: schema,
        ui_hints: { field_order: group.fields },
      })
    : undefined

  const handleChange = (formData) => {
    setStepData((previous) => {
      const next = [...previous]
      next[currentStepIndex] = formData
      return next
    })
  }

  const handleStepSubmit = (formData) => {
    // RJSF has already validated this step's fields.
    const next = [...stepData]
    next[currentStepIndex] = formData
    setStepData(next)
    if (isLastStep) {
      if (showSummary) setShowingSummary(true)
      else onSubmit(Object.assign({}, ...next))
    } else {
      setStepIndex((index) => index + 1)
    }
  }

  const handleBack = () => {
    setStepIndex((index) => Math.max(0, index - 1))
  }

  // Generated and saved manifests pass backend validation, but this guard
  // keeps the component safe if it is ever called with incomplete draft data.
  if (!group || !schema) return null

  const mergedData = Object.assign({}, ...stepData)

  if (showingSummary) {
    return (
      <section className="wizard-summary" aria-labelledby="wizard-summary-title">
        <div className="wizard-summary-heading">
          <span className="wizard-step-count">Final review</span>
          <h2 id="wizard-summary-title">Check your information</h2>
          <p>Review the details below before sending them to the agent.</p>
        </div>
        <dl className="wizard-summary-list">
          {manifest.ui_hints.field_order.map((name) => (
            <div key={name}>
              <dt>{manifest.input_schema.properties[name]?.title ?? name}</dt>
              <dd>{summaryValue(mergedData[name])}</dd>
            </div>
          ))}
        </dl>
        <div className="wizard-actions">
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => setShowingSummary(false)}
            disabled={disabled}
          >
            Back to fields
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onSubmit(mergedData)}
            disabled={disabled}
          >
            {submitLabel}
          </button>
        </div>
      </section>
    )
  }

  return (
    <div className="wizard-shell">
      <ol className="wizard-step-rail" aria-label="Form steps">
        {groups.map((step, index) => {
          const isCurrent = index === currentStepIndex
          const isComplete = !previewNavigation && index < currentStepIndex
          const content = (
            <>
              <span className="wizard-step-marker" aria-hidden="true">
                {isComplete ? '✓' : index + 1}
              </span>
              <span className="wizard-step-label" aria-hidden="true">{step.title}</span>
              <span className="sr-only">
                {step.title}: {isCurrent ? 'current' : isComplete ? 'complete' : 'available'}
              </span>
            </>
          )
          return (
            <li
              key={step.id ?? index}
              className={`${isCurrent ? 'is-active' : ''} ${
                isComplete ? 'is-complete' : ''
              }`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {previewNavigation ? (
                <button
                  type="button"
                  className="wizard-step-selector"
                  aria-label={`Preview ${step.title} step`}
                  onClick={() => onActiveGroupChange(step.id)}
                >
                  {content}
                </button>
              ) : content}
            </li>
          )
        })}
      </ol>
      <p className="wizard-step-count text-muted mb-1">
        Step {currentStepIndex + 1} of {groups.length}
      </p>
      <h2 className="h5 mb-3">{group.title}</h2>
      <p className="wizard-description text-muted">{group.description}</p>
      <FormRenderer
        key={group.id ?? currentStepIndex}
        schema={schema}
        uiSchema={uiSchema}
        blocks={group.blocks}
        formData={stepData[currentStepIndex]}
        onChange={handleChange}
        onSubmit={handleStepSubmit}
        disabled={disabled}
      >
        <div className="wizard-actions d-flex justify-content-between mt-3">
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={handleBack}
            disabled={disabled || stepIndex === 0}
          >
            Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={disabled}>
            {isLastStep ? (showSummary ? 'Review answers' : submitLabel) : 'Next'}
          </button>
        </div>
      </FormRenderer>
    </div>
  )
}
