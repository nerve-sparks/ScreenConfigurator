import { useId } from 'react'

/**
 * Tabs — controlled, with roving arrow-key navigation per the ARIA tabs
 * pattern. `items` is [{ id, label, badge?, disabled? }].
 */
export function Tabs({ items, value, onChange, ariaLabel = 'Tabs', className = '' }) {
  const baseId = useId()

  const move = (direction) => {
    const enabled = items.filter((item) => !item.disabled)
    const index = enabled.findIndex((item) => item.id === value)
    if (index === -1) return
    const next = (index + direction + enabled.length) % enabled.length
    onChange(enabled[next].id)
  }

  const onKeyDown = (event) => {
    if (event.key === 'ArrowRight') { event.preventDefault(); move(1) }
    if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1) }
    if (event.key === 'Home') {
      event.preventDefault()
      const first = items.find((item) => !item.disabled)
      if (first) onChange(first.id)
    }
    if (event.key === 'End') {
      event.preventDefault()
      const last = [...items].reverse().find((item) => !item.disabled)
      if (last) onChange(last.id)
    }
  }

  return (
    <div
      className={`ui-tabs ${className}`.trim()}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => {
        const selected = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${baseId}-${item.id}`}
            aria-selected={selected}
            aria-controls={`${baseId}-${item.id}-panel`}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            className={`ui-tab ${selected ? 'is-active' : ''}`.trim()}
            onClick={() => onChange(item.id)}
          >
            {item.label}
            {item.badge != null ? (
              <span className="ui-tab-badge">{item.badge}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/** Segmented control — same interaction, denser presentation. */
export function SegmentedControl({ items, value, onChange, ariaLabel = 'Options' }) {
  return (
    <div className="ui-segmented" role="group" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`ui-segment ${item.id === value ? 'is-active' : ''}`.trim()}
          aria-pressed={item.id === value}
          disabled={item.disabled}
          onClick={() => onChange(item.id)}
        >
          {item.icon ? <span className="ui-segment-icon">{item.icon}</span> : null}
          {item.label}
        </button>
      ))}
    </div>
  )
}

export default Tabs
