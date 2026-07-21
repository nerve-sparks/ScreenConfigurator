import { useState } from 'react'
import FormRenderer from './FormRenderer.jsx'
import { schemaForGroup } from './manifestLayout.js'

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
}) {
  const groups = Array.isArray(manifest?.ui_hints?.groups)
    ? manifest.ui_hints.groups
    : []
  const [stepIndex, setStepIndex] = useState(0)
  const [stepData, setStepData] = useState(() => groups.map(() => ({})))
  const [showingSummary, setShowingSummary] = useState(false)

  const isLastStep = stepIndex === groups.length - 1
  const group = groups[stepIndex]
  const schema = group ? schemaForGroup(manifest.input_schema, group) : null

  const handleChange = (formData) => {
    setStepData((previous) => {
      const next = [...previous]
      next[stepIndex] = formData
      return next
    })
  }

  const handleStepSubmit = (formData) => {
    // RJSF has already validated this step's fields.
    const next = [...stepData]
    next[stepIndex] = formData
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
        {groups.map((step, index) => (
          <li
            key={step.id ?? index}
            className={`${index === stepIndex ? 'is-active' : ''} ${
              index < stepIndex ? 'is-complete' : ''
            }`}
            aria-current={index === stepIndex ? 'step' : undefined}
          >
            <span className="wizard-step-marker" aria-hidden="true">
              {index < stepIndex ? '✓' : index + 1}
            </span>
            <span className="wizard-step-label" aria-hidden="true">{step.title}</span>
            <span className="sr-only">
              {step.title}: {index < stepIndex ? 'complete' : index === stepIndex ? 'current' : 'upcoming'}
            </span>
          </li>
        ))}
      </ol>
      <p className="wizard-step-count text-muted mb-1">
        Step {stepIndex + 1} of {groups.length}
      </p>
      <h2 className="h5 mb-3">{group.title}</h2>
      <p className="wizard-description text-muted">{group.description}</p>
      <FormRenderer
        key={group.id ?? stepIndex}
        schema={schema}
        formData={stepData[stepIndex]}
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
