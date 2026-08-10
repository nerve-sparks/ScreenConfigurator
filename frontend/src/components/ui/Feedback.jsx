import Button from './Button.jsx'
import { AlertCircle, AlertTriangle, CheckCircle, Info } from './Icons.jsx'

/**
 * The four states every data surface needs: loading, empty, error, and the
 * inline alert. Having them as primitives is what stops each page inventing
 * its own spinner and its own "nothing here yet" copy.
 */

export function Skeleton({ width, height = 14, radius = 'var(--radius-sm)', className = '' }) {
  return (
    <span
      className={`ui-skeleton ${className}`.trim()}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  )
}

export function SkeletonCard() {
  return (
    <div className="ui-skeleton-card" aria-hidden="true">
      <Skeleton width="42%" height={16} />
      <Skeleton width="88%" height={12} />
      <Skeleton width="64%" height={12} />
      <div className="ui-skeleton-card-footer">
        <Skeleton width={72} height={22} radius="var(--radius-full)" />
        <Skeleton width={54} height={22} radius="var(--radius-full)" />
      </div>
    </div>
  )
}

export function Spinner({ size = 18, label }) {
  return (
    <span className="ui-spinner-wrap" role="status">
      <span
        className="ui-spinner"
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
      {label ? <span className="ui-spinner-label">{label}</span> : null}
    </span>
  )
}

export function LoadingState({ message = 'Loading…' }) {
  return (
    <div className="ui-loading-state" role="status">
      <span className="ui-loading-orb" aria-hidden="true" />
      <strong>{message}</strong>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  compact = false,
}) {
  return (
    <div className={`ui-empty-state ${compact ? 'is-compact' : ''}`.trim()}>
      {icon ? <span className="ui-empty-icon">{icon}</span> : null}
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action || secondaryAction ? (
        <div className="ui-empty-actions">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  )
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
  retryLabel = 'Try again',
}) {
  return (
    <div className="ui-error-state" role="alert">
      <span className="ui-error-icon"><AlertTriangle size={22} /></span>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>{retryLabel}</Button>
      ) : null}
    </div>
  )
}

const ALERT_ICON = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: AlertCircle,
}

export function Alert({ tone = 'info', title, children, onDismiss }) {
  const ToneIcon = ALERT_ICON[tone] ?? Info
  return (
    <div
      className={`ui-alert ui-alert-${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <span className="ui-alert-icon"><ToneIcon size={18} /></span>
      <div className="ui-alert-copy">
        {title ? <strong>{title}</strong> : null}
        {children ? <span>{children}</span> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          className="ui-alert-close"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          ×
        </button>
      ) : null}
    </div>
  )
}
