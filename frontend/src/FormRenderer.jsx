import Form from '@rjsf/bootstrap-4'
import validator from '@rjsf/validator-ajv8'
import { LayoutObjectFieldTemplate } from './LayoutRenderer.jsx'

function RootLayoutTemplate(props) {
  return (
    <LayoutObjectFieldTemplate
      {...props}
      blocks={props.registry?.formContext?.layoutBlocks ?? []}
    />
  )
}

const FORM_TEMPLATES = {
  ObjectFieldTemplate: RootLayoutTemplate,
}

function FileWidget({
  id,
  value,
  required,
  disabled,
  readonly,
  onChange,
  schema,
}) {
  const handleFile = (event) => {
    const file = event.target.files?.[0]
    if (!file) {
      onChange(undefined)
      return
    }
    const reader = new FileReader()
    reader.addEventListener('load', () => onChange(reader.result))
    reader.readAsDataURL(file)
  }

  return (
    <div className={`file-drop-widget ${value ? 'has-file' : ''}`}>
      <input
        id={id}
        type="file"
        accept={schema.contentMediaType}
        required={required && !value}
        disabled={disabled || readonly}
        onChange={handleFile}
      />
      <span className="file-drop-icon" aria-hidden="true">↑</span>
      <strong>{value ? 'File ready' : 'Choose or drop a file'}</strong>
      <small>{value ? 'Choose another file to replace it' : 'Your file stays in this form until submission'}</small>
    </div>
  )
}

/**
 * Generic form renderer.
 *
 * Knows nothing about any specific agent — it just draws a form
 * for whatever JSON Schema it is given.
 *
 * Props:
 * - schema:   JSON Schema object describing the fields to collect (required)
 * - uiSchema: optional RJSF uiSchema with presentation hints
 * - onSubmit: called with the collected formData when the form
 *             passes validation and is submitted
 * - formData: optional initial/controlled form data (used by the wizard)
 * - onChange: optional, called with formData on every edit (used by the wizard)
 * - children: optional custom footer (e.g. Back/Next buttons); when absent,
 *             RJSF renders its default Submit button
 */
export default function FormRenderer({
  schema,
  uiSchema,
  onSubmit,
  formData,
  onChange,
  children,
  disabled = false,
  submitLabel = 'Submit',
  blocks = [],
}) {
  const handleSubmit = ({ formData: data }) => {
    if (onSubmit) {
      onSubmit(data)
    }
  }

  const handleChange = onChange
    ? ({ formData: data }) => onChange(data)
    : undefined

  return (
    <div className="agent-form">
      <Form
        schema={schema}
        uiSchema={uiSchema}
        validator={validator}
        formData={formData}
        onChange={handleChange}
        onSubmit={handleSubmit}
        disabled={disabled}
        widgets={{ FileWidget }}
        templates={FORM_TEMPLATES}
        formContext={{ layoutBlocks: blocks }}
      >
        {children ?? (
          <button type="submit" className="btn btn-primary agent-submit-button">
            {submitLabel}
          </button>
        )}
      </Form>
    </div>
  )
}
