import { forwardRef, useId } from 'react'

/**
 * Field — label + control + description + error, wired for accessibility.
 *
 * Always use this instead of a bare <input>: it generates the id, links the
 * label, and points aria-describedby at the description and error text so
 * screen readers announce them.
 */
export function Field({
  label,
  description,
  error,
  required = false,
  htmlFor,
  className = '',
  children,
}) {
  const generatedId = useId()
  const fieldId = htmlFor || generatedId

  return (
    <div className={`ui-field ${error ? 'has-error' : ''} ${className}`.trim()}>
      {label ? (
        <label className="ui-field-label" htmlFor={fieldId}>
          {label}
          {required ? <span className="ui-field-required" aria-hidden="true">*</span> : null}
        </label>
      ) : null}

      {typeof children === 'function'
        ? children({
          id: fieldId,
          'aria-describedby': [
            description ? `${fieldId}-description` : null,
            error ? `${fieldId}-error` : null,
          ].filter(Boolean).join(' ') || undefined,
          'aria-invalid': error ? true : undefined,
          required,
        })
        : children}

      {description && !error ? (
        <p className="ui-field-description" id={`${fieldId}-description`}>
          {description}
        </p>
      ) : null}

      {error ? (
        <p className="ui-field-error" id={`${fieldId}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export const Input = forwardRef(function Input(
  { className = '', invalid = false, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={`form-control ${invalid ? 'is-invalid' : ''} ${className}`.trim()}
      {...rest}
    />
  )
})

export const Textarea = forwardRef(function Textarea(
  { className = '', invalid = false, rows = 4, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={`form-control ${invalid ? 'is-invalid' : ''} ${className}`.trim()}
      {...rest}
    />
  )
})

export const Select = forwardRef(function Select(
  { className = '', invalid = false, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={`form-control ${invalid ? 'is-invalid' : ''} ${className}`.trim()}
      {...rest}
    >
      {children}
    </select>
  )
})

/** Search input with a leading icon and optional clear button. */
export const SearchInput = forwardRef(function SearchInput(
  { className = '', onClear, value, icon, ...rest },
  ref,
) {
  return (
    <div className={`ui-search ${className}`.trim()}>
      {icon ? <span className="ui-search-icon">{icon}</span> : null}
      <input ref={ref} className="form-control" type="search" value={value} {...rest} />
      {onClear && value ? (
        <button
          type="button"
          className="ui-search-clear"
          onClick={onClear}
          aria-label="Clear search"
        >
          ×
        </button>
      ) : null}
    </div>
  )
})

export default Field
