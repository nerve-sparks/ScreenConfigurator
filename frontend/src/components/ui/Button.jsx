import { forwardRef } from 'react'
import { Link } from 'react-router-dom'

/**
 * Button — the single source of truth for interactive affordances.
 *
 * Renders <button>, <a>, or react-router <Link> depending on props, so callers
 * never have to hand-roll a link that looks like a button.
 *
 *   variant: primary | secondary | outline | ghost | danger | success | link
 *   size:    sm | md | lg
 */

const VARIANT_CLASS = {
  primary: 'btn-primary',
  secondary: 'btn-outline-secondary',
  outline: 'btn-outline-primary',
  ghost: 'ui-btn-ghost',
  danger: 'btn-danger',
  success: 'btn-success',
  link: 'btn-link',
}

const SIZE_CLASS = {
  sm: 'btn-sm',
  md: '',
  lg: 'btn-lg',
}

const Button = forwardRef(function Button(
  {
    variant = 'secondary',
    size = 'md',
    to,
    href,
    type = 'button',
    loading = false,
    disabled = false,
    iconLeft = null,
    iconRight = null,
    fullWidth = false,
    className = '',
    children,
    ...rest
  },
  ref,
) {
  const classes = [
    'btn',
    VARIANT_CLASS[variant] ?? VARIANT_CLASS.secondary,
    SIZE_CLASS[size] ?? '',
    fullWidth ? 'btn-block' : '',
    loading ? 'is-loading' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const content = (
    <>
      {loading ? <span className="ui-btn-spinner" aria-hidden="true" /> : iconLeft}
      {children ? <span className="ui-btn-label">{children}</span> : null}
      {iconRight}
    </>
  )

  // Disabled links are not focusable/announceable as disabled, so render a
  // real button instead of an anchor when the action is unavailable.
  const isInert = disabled || loading

  if (to && !isInert) {
    return (
      <Link ref={ref} className={classes} to={to} {...rest}>
        {content}
      </Link>
    )
  }

  if (href && !isInert) {
    return (
      <a ref={ref} className={classes} href={href} {...rest}>
        {content}
      </a>
    )
  }

  return (
    <button
      ref={ref}
      className={classes}
      type={type}
      disabled={isInert}
      aria-busy={loading || undefined}
      {...rest}
    >
      {content}
    </button>
  )
})

export default Button
