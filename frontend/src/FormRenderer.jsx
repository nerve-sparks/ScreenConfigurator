import Form from '@rjsf/bootstrap-4'
import validator from '@rjsf/validator-ajv8'

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
    <Form
      schema={schema}
      uiSchema={uiSchema}
      validator={validator}
      formData={formData}
      onChange={handleChange}
      onSubmit={handleSubmit}
    >
      {children}
    </Form>
  )
}
