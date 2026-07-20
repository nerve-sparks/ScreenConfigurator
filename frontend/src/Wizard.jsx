import { useState } from 'react'
import FormRenderer from './FormRenderer.jsx'

// Slice the full input_schema down to just one group's fields, preserving
// the group's own field order. Purely presentational: the set of fields was
// fixed at generation time, and the backend has already validated that
// every group field exists in properties (the Object.hasOwn filter is just
// defense in depth).
function schemaForGroup(inputSchema, group) {
  const allProperties = inputSchema.properties ?? {}
  const properties = {}
  for (const name of group.fields) {
    if (Object.hasOwn(allProperties, name)) {
      properties[name] = allProperties[name]
    }
  }
  const required = (inputSchema.required ?? []).filter((name) =>
    Object.hasOwn(properties, name),
  )
  return { type: 'object', properties, required }
}

/**
 * Multi-screen wizard (Step 6): one step per ui_hints.group.
 *
 * Each step is a normal RJSF form, so per-step validation is unchanged;
 * "Next"/"Submit" only advance when the current step validates. Data is
 * kept per step (so Back/Next never loses input) and merged into one
 * object which is handed to onSubmit at the very end.
 */
export default function Wizard({ manifest, onSubmit }) {
  const groups = manifest.ui_hints.groups
  const [stepIndex, setStepIndex] = useState(0)
  const [stepData, setStepData] = useState(() => groups.map(() => ({})))

  const isLastStep = stepIndex === groups.length - 1
  const group = groups[stepIndex]
  const schema = schemaForGroup(manifest.input_schema, group)

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
      onSubmit(Object.assign({}, ...next))
    } else {
      setStepIndex(stepIndex + 1)
    }
  }

  const handleBack = () => {
    setStepIndex((index) => Math.max(0, index - 1))
  }

  return (
    <div>
      <p className="text-muted mb-1">
        Step {stepIndex + 1} of {groups.length}
      </p>
      <h2 className="h5 mb-3">{group.title}</h2>
      <FormRenderer
        key={stepIndex}
        schema={schema}
        formData={stepData[stepIndex]}
        onChange={handleChange}
        onSubmit={handleStepSubmit}
      >
        <div className="d-flex justify-content-between mt-3">
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={handleBack}
            disabled={stepIndex === 0}
          >
            Back
          </button>
          <button type="submit" className="btn btn-primary">
            {isLastStep ? 'Submit' : 'Next'}
          </button>
        </div>
      </FormRenderer>
    </div>
  )
}
