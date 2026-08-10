/**
 * Badge — compact status label.
 *
 *   tone: neutral | brand | success | warning | danger | info
 *   dot:  prefix with a status dot (for live/draft/published states)
 */
export function Badge({
  tone = 'neutral',
  dot = false,
  size = 'md',
  className = '',
  children,
  ...rest
}) {
  return (
    <span
      className={`ui-badge ui-badge-${tone} ui-badge-${size} ${className}`.trim()}
      {...rest}
    >
      {dot ? <span className="ui-badge-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  )
}

/** Larger label used above headings on marketing and workspace surfaces. */
export function Eyebrow({ icon, className = '', children }) {
  return (
    <span className={`ui-eyebrow ${className}`.trim()}>
      {icon ? <span className="ui-eyebrow-icon">{icon}</span> : null}
      {children}
    </span>
  )
}

export default Badge
