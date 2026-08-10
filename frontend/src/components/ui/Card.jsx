import { Link } from 'react-router-dom'

/**
 * Card — the standard content container.
 *
 *   tone:        default | subtle | brand | outline
 *   interactive: adds hover lift; pair with `to` or `onClick`
 */
export function Card({
  tone = 'default',
  interactive = false,
  padded = true,
  to,
  className = '',
  children,
  ...rest
}) {
  const classes = [
    'ui-card',
    `ui-card-${tone}`,
    interactive || to ? 'is-interactive' : '',
    padded ? 'is-padded' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  if (to) {
    return (
      <Link className={classes} to={to} {...rest}>
        {children}
      </Link>
    )
  }

  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  )
}

export function CardHeader({ title, description, icon, actions, className = '' }) {
  return (
    <div className={`ui-card-header ${className}`.trim()}>
      {icon ? <span className="ui-card-icon">{icon}</span> : null}
      <div className="ui-card-heading">
        {title ? <h3>{title}</h3> : null}
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="ui-card-actions">{actions}</div> : null}
    </div>
  )
}

export function CardBody({ className = '', children }) {
  return <div className={`ui-card-body ${className}`.trim()}>{children}</div>
}

export function CardFooter({ className = '', children }) {
  return <div className={`ui-card-footer ${className}`.trim()}>{children}</div>
}

export default Card
