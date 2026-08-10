import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from './Icons.jsx'

const ToastContext = createContext({ toast: () => {}, dismiss: () => {} })

const TONE_ICON = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())
  const nextId = useRef(0)

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((item) => item.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      window.clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const toast = useCallback(
    ({ title, description, tone = 'info', duration = 5000 }) => {
      nextId.current += 1
      const id = nextId.current
      setToasts((current) => [...current, { id, title, description, tone }])

      if (duration > 0) {
        timers.current.set(
          id,
          window.setTimeout(() => dismiss(id), duration),
        )
      }
      return id
    },
    [dismiss],
  )

  // Clear any pending timers if the provider unmounts.
  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer))
      pending.clear()
    }
  }, [])

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== 'undefined'
        ? createPortal(
          <div className="ui-toast-region" role="region" aria-label="Notifications">
            {toasts.map((item) => {
              const ToneIcon = TONE_ICON[item.tone] ?? Info
              return (
                <div
                  key={item.id}
                  className={`ui-toast ui-toast-${item.tone}`}
                  role={item.tone === 'error' ? 'alert' : 'status'}
                >
                  <span className="ui-toast-icon"><ToneIcon size={18} /></span>
                  <div className="ui-toast-copy">
                    {item.title ? <strong>{item.title}</strong> : null}
                    {item.description ? <span>{item.description}</span> : null}
                  </div>
                  <button
                    type="button"
                    className="ui-toast-close"
                    onClick={() => dismiss(item.id)}
                    aria-label="Dismiss notification"
                  >
                    <X size={15} />
                  </button>
                </div>
              )
            })}
          </div>,
          document.body,
        )
        : null}
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

export default ToastProvider
