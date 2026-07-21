import { useState } from 'react'
import { fieldNameFromLabel } from './reviewModel.js'

const INPUT_KINDS = [
  { value: 'text', label: 'Text', schema: { type: 'string' } },
  {
    value: 'email',
    label: 'Email address',
    schema: { type: 'string', format: 'email' },
  },
  {
    value: 'url',
    label: 'Website URL',
    schema: { type: 'string', format: 'uri' },
  },
  {
    value: 'date',
    label: 'Date',
    schema: { type: 'string', format: 'date' },
  },
  {
    value: 'date-time',
    label: 'Date and time',
    schema: { type: 'string', format: 'date-time' },
  },
  {
    value: 'file',
    label: 'File upload',
    schema: { type: 'string', format: 'data-url' },
  },
  { value: 'number', label: 'Number', schema: { type: 'number' } },
  { value: 'integer', label: 'Whole number', schema: { type: 'integer' } },
  { value: 'boolean', label: 'Yes / No', schema: { type: 'boolean' } },
]

function definitionFor(kind, title, description) {
  const selected = INPUT_KINDS.find((option) => option.value === kind)
  const definition = {
    ...(selected?.schema ?? INPUT_KINDS[0].schema),
    title: title.trim(),
  }
  const trimmedDescription = description.trim()
  if (trimmedDescription) definition.description = trimmedDescription
  return definition
}

export default function AddFieldForm({
  groups = [],
  onAdd,
  onCancel,
  disabled = false,
}) {
  const [label, setLabel] = useState('')
  const [name, setName] = useState('')
  const [nameWasEdited, setNameWasEdited] = useState(false)
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState('text')
  const [required, setRequired] = useState(false)
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '')
  const [error, setError] = useState(null)

  const handleLabelChange = (event) => {
    const nextLabel = event.target.value
    setError(null)
    setLabel(nextLabel)
    if (!nameWasEdited) setName(fieldNameFromLabel(nextLabel))
  }

  const handleNameChange = (event) => {
    setError(null)
    setNameWasEdited(true)
    setName(event.target.value.toLowerCase())
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    setError(null)
    try {
      onAdd({
        name,
        definition: definitionFor(kind, label, description),
        required,
        groupId: groups.length > 0 ? groupId : null,
      })
    } catch (submissionError) {
      setError(submissionError.message)
    }
  }

  const canSubmit =
    !disabled &&
    Boolean(label.trim()) &&
    Boolean(name.trim()) &&
    (groups.length === 0 || Boolean(groupId))

  return (
    <form
      id="add-field-form"
      className="custom-field-builder card mb-3"
      onSubmit={handleSubmit}
    >
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-start mb-3">
          <div>
            <h3 className="h5 mb-1">Add your own input</h3>
            <p className="small text-muted mb-0">
              Add information the AI suggestion did not include.
            </p>
          </div>
          <span className="badge badge-primary">Human added</span>
        </div>

        {error && (
          <div className="alert alert-danger" role="alert">
            {error}
          </div>
        )}

        <div className="form-row">
          <div className="form-group col-md-7">
            <label htmlFor="new-field-label">Input label</label>
            <input
              id="new-field-label"
              className="form-control"
              value={label}
              onChange={handleLabelChange}
              placeholder="e.g. Target language"
              disabled={disabled}
              autoFocus
              required
            />
          </div>
          <div className="form-group col-md-5">
            <label htmlFor="new-field-name">Field name</label>
            <input
              id="new-field-name"
              className="form-control"
              value={name}
              onChange={handleNameChange}
              placeholder="target_language"
              aria-describedby="new-field-name-help"
              maxLength={64}
              disabled={disabled}
              required
            />
            <small id="new-field-name-help" className="form-text text-muted">
              Used as the submitted data key.
            </small>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="new-field-description">Help text</label>
          <textarea
            id="new-field-description"
            className="form-control"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Explain what the user should provide."
            disabled={disabled}
          />
        </div>

        <div className="form-row">
          <div
            className={`form-group ${
              groups.length > 0 ? 'col-md-6' : 'col-md-12'
            }`}
          >
            <label htmlFor="new-field-kind">Input type</label>
            <select
              id="new-field-kind"
              className="form-control"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              disabled={disabled}
            >
              {INPUT_KINDS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {groups.length > 0 && (
            <div className="form-group col-md-6">
              <label htmlFor="new-field-group">Wizard step</label>
              <select
                id="new-field-group"
                className="form-control"
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
                disabled={disabled}
                required
              >
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.title}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="custom-control custom-checkbox mb-3">
          <input
            id="new-field-required"
            type="checkbox"
            className="custom-control-input"
            checked={required}
            onChange={(event) => setRequired(event.target.checked)}
            disabled={disabled}
          />
          <label className="custom-control-label" htmlFor="new-field-required">
            Make this input required
          </label>
        </div>

        <div className="d-flex justify-content-end">
          <button
            type="button"
            className="btn btn-link"
            onClick={onCancel}
            disabled={disabled}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!canSubmit}
          >
            Add input
          </button>
        </div>
      </div>
    </form>
  )
}
