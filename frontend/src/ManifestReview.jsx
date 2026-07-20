import { Suspense, lazy, useState } from 'react'
import {
  REVIEW_STATUS,
  addHumanField,
  approveAllFields,
  canContinueReview,
  deleteField,
  orderedReviewFields,
  reviewProgress,
  setFieldRequired,
  setFieldStatus,
  updateFieldDefinition,
} from './reviewModel.js'

const AddFieldForm = lazy(() => import('./AddFieldForm.jsx'))

const EDITABLE_TYPES = ['string', 'number', 'integer', 'boolean']
const STRING_FORMATS = ['', 'email', 'uri', 'date', 'date-time']

function fieldDomId(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function typeLabel(schema) {
  return schema.format ? `${schema.type} · ${schema.format}` : schema.type
}

function statusBadge(status) {
  if (status === REVIEW_STATUS.APPROVED) return 'badge-success'
  if (status === REVIEW_STATUS.REJECTED) return 'badge-warning'
  return 'badge-secondary'
}

function originBadge(review) {
  if (review.origin === 'human') {
    return { className: 'badge-primary', label: 'Human added' }
  }
  if (review.modified) {
    return { className: 'badge-info', label: 'AI suggested · Human edited' }
  }
  return { className: 'badge-info', label: 'AI suggested' }
}

function OriginBadge({ review }) {
  const source = originBadge(review)
  return <span className={`badge ${source.className}`}>{source.label}</span>
}

function FieldEditor({ name, schema, onSave, onCancel, disabled = false }) {
  const originalType = EDITABLE_TYPES.includes(schema.type) ? schema.type : 'string'
  const [title, setTitle] = useState(schema.title ?? name)
  const [description, setDescription] = useState(schema.description ?? '')
  const [type, setType] = useState(originalType)
  const [format, setFormat] = useState(
    STRING_FORMATS.includes(schema.format) ? (schema.format ?? '') : '',
  )

  const handleSubmit = (event) => {
    event.preventDefault()
    const trimmedTitle = title.trim()
    if (!trimmedTitle) return

    // Preserve constraints when the base type is unchanged. When it changes,
    // begin with a clean definition so incompatible constraints are not kept.
    const definition = type === originalType ? { ...schema } : { type }
    definition.type = type
    definition.title = trimmedTitle

    const trimmedDescription = description.trim()
    if (trimmedDescription) definition.description = trimmedDescription
    else delete definition.description

    if (type === 'string' && format) definition.format = format
    else delete definition.format

    onSave(definition)
  }

  return (
    <form className="border-top mt-3 pt-3" onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor={`edit-title-${fieldDomId(name)}`}>Label</label>
        <input
          id={`edit-title-${fieldDomId(name)}`}
          className="form-control"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={disabled}
          required
        />
      </div>
      <div className="form-group">
        <label htmlFor={`edit-description-${fieldDomId(name)}`}>Help text</label>
        <textarea
          id={`edit-description-${fieldDomId(name)}`}
          className="form-control"
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={disabled}
        />
      </div>
      <div className="form-row">
        <div className="form-group col-sm-6">
          <label htmlFor={`edit-type-${fieldDomId(name)}`}>Type</label>
          <select
            id={`edit-type-${fieldDomId(name)}`}
            className="form-control"
            value={type}
            onChange={(event) => setType(event.target.value)}
            disabled={disabled}
          >
            {EDITABLE_TYPES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        {type === 'string' && (
          <div className="form-group col-sm-6">
            <label htmlFor={`edit-format-${fieldDomId(name)}`}>Format</label>
            <select
              id={`edit-format-${fieldDomId(name)}`}
              className="form-control"
              value={format}
              onChange={(event) => setFormat(event.target.value)}
              disabled={disabled}
            >
              <option value="">Plain text</option>
              <option value="email">Email</option>
              <option value="uri">URL</option>
              <option value="date">Date</option>
              <option value="date-time">Date and time</option>
            </select>
          </div>
        )}
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
          disabled={disabled || !title.trim()}
        >
          Save changes
        </button>
      </div>
    </form>
  )
}

export default function ManifestReview({
  draft,
  onChange,
  onContinue,
  continuing = false,
}) {
  const [editingField, setEditingField] = useState(null)
  const [addingField, setAddingField] = useState(false)
  const fields = orderedReviewFields(draft)
  const wizardGroups =
    draft.manifest?.ui_hints?.mode === 'wizard'
      ? (draft.manifest.ui_hints.groups ?? [])
      : []
  const progress = reviewProgress(draft)
  const reviewed = progress.approved + progress.rejected
  const progressPercent = progress.total
    ? Math.round((reviewed / progress.total) * 100)
    : 0

  const update = (updater) => {
    if (continuing) return draft
    const updated = updater(draft)
    onChange(updated)
    return updated
  }

  return (
    <section className="card mb-4" aria-labelledby="review-heading">
      <div className="card-body">
        <div className="d-flex flex-wrap justify-content-between align-items-start mb-2">
          <div>
            <h2 id="review-heading" className="h4 mb-1">
              Review suggested inputs
            </h2>
            <p className="text-muted mb-0">
              Approve, customize, or exclude every field before previewing.
            </p>
          </div>
          <div className="d-flex flex-wrap mt-2 mt-sm-0">
            <button
              type="button"
              className="btn btn-outline-primary mr-2 mb-2"
              onClick={() => setAddingField((visible) => !visible)}
              disabled={continuing}
              aria-expanded={addingField}
              aria-controls="add-field-form"
            >
              {addingField ? 'Close input builder' : '+ Add your own input'}
            </button>
            <button
              type="button"
              className="btn btn-outline-success mb-2"
              onClick={() => update(approveAllFields)}
              disabled={
                continuing ||
                progress.total === 0 ||
                progress.approved === progress.total
              }
            >
              Approve all
            </button>
          </div>
        </div>

        <div className="progress my-3" style={{ height: '8px' }}>
          <div
            className="progress-bar"
            role="progressbar"
            aria-label="Review progress"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={progressPercent}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <p className="small text-muted" aria-live="polite">
          {reviewed} of {progress.total} reviewed · {progress.approved} approved ·{' '}
          {progress.rejected} excluded
          {progress.deleted > 0 ? ` · ${progress.deleted} removed` : ''}
        </p>

        {addingField && (
          <Suspense
            fallback={
              <div className="alert alert-info" role="status">
                Opening input builder...
              </div>
            }
          >
            <AddFieldForm
              groups={wizardGroups}
              disabled={continuing}
              onCancel={() => setAddingField(false)}
              onAdd={(field) => {
                update((current) => addHumanField(current, field))
                setAddingField(false)
              }}
            />
          </Suspense>
        )}

        {fields.map(({ name, schema, required, review }) => (
          <article
            key={name}
            className={`card mb-3 ${
              review.status === REVIEW_STATUS.APPROVED
                ? 'border-success'
                : review.status === REVIEW_STATUS.REJECTED
                  ? 'border-warning'
                  : ''
            }`}
          >
            <div className="card-body">
              <div className="d-flex flex-wrap justify-content-between align-items-start">
                <div>
                  <div className="d-flex flex-wrap align-items-center mb-1">
                    <h3 className="h6 mb-0 mr-2">{schema.title ?? name}</h3>
                    <span className={`badge ${statusBadge(review.status)} mr-1`}>
                      {review.status}
                    </span>
                    <OriginBadge review={review} />
                  </div>
                  <div className="small text-muted">
                    <code>{name}</code> · {typeLabel(schema)}
                  </div>
                  {schema.description && <p className="mt-2 mb-0">{schema.description}</p>}
                </div>
                <div className="custom-control custom-switch mt-2 mt-sm-0">
                  <input
                    id={`required-${fieldDomId(name)}`}
                    type="checkbox"
                    className="custom-control-input"
                    checked={required}
                    disabled={continuing}
                    onChange={(event) =>
                      update((current) =>
                        setFieldRequired(current, name, event.target.checked),
                      )
                    }
                  />
                  <label
                    className="custom-control-label"
                    htmlFor={`required-${fieldDomId(name)}`}
                  >
                    Required
                  </label>
                </div>
              </div>

              <div className="d-flex flex-wrap mt-3">
                <button
                  type="button"
                  className="btn btn-sm btn-outline-success mr-2 mb-2"
                  disabled={
                    continuing || review.status === REVIEW_STATUS.APPROVED
                  }
                  onClick={() =>
                    update((current) =>
                      setFieldStatus(current, name, REVIEW_STATUS.APPROVED),
                    )
                  }
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-warning mr-2 mb-2"
                  disabled={
                    continuing || review.status === REVIEW_STATUS.REJECTED
                  }
                  onClick={() =>
                    update((current) =>
                      setFieldStatus(current, name, REVIEW_STATUS.REJECTED),
                    )
                  }
                >
                  Exclude
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary mr-2 mb-2"
                  disabled={continuing}
                  onClick={() => setEditingField(editingField === name ? null : name)}
                >
                  {editingField === name ? 'Close editor' : 'Edit'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-danger mb-2"
                  aria-label={`Remove ${schema.title ?? name}`}
                  disabled={continuing}
                  onClick={() => {
                    update((current) => deleteField(current, name))
                    if (editingField === name) setEditingField(null)
                  }}
                >
                  Remove
                </button>
              </div>

              {editingField === name && (
                <FieldEditor
                  name={name}
                  schema={schema}
                  disabled={continuing}
                  onCancel={() => setEditingField(null)}
                  onSave={(definition) => {
                    update((current) =>
                      updateFieldDefinition(current, name, definition),
                    )
                    setEditingField(null)
                  }}
                />
              )}
            </div>
          </article>
        ))}

        {progress.total === 0 && (
          <div className="alert alert-warning">
            Add an input or regenerate before continuing.
          </div>
        )}
        {progress.pending === 0 && progress.approved === 0 && progress.total > 0 && (
          <div className="alert alert-warning">
            Approve at least one input before continuing.
          </div>
        )}

        <div className="d-flex justify-content-end">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onContinue}
            disabled={!canContinueReview(draft) || continuing}
          >
            {continuing ? 'Validating...' : 'Continue to preview'}
          </button>
        </div>
      </div>
    </section>
  )
}
