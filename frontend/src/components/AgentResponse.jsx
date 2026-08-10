import { useState } from 'react'
import { Check, FileText } from './ui/Icons.jsx'

/**
 * Renders an agent's response as readable structure instead of a raw JSON dump.
 *
 * Agent responses are arbitrary provider-shaped JSON, so this walks the value
 * defensively: objects become labelled rows, arrays become numbered groups,
 * scalars render inline, and long strings get their own block. A raw view is
 * always one click away for anyone who needs the literal payload.
 */

function humanizeKey(key) {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^\w/, (character) => character.toUpperCase())
}

function ScalarValue({ value }) {
  if (value === null || value === undefined) {
    return <span className="ar-value is-empty">—</span>
  }
  if (typeof value === 'boolean') {
    return (
      <span className={`ar-value is-boolean ${value ? 'is-true' : 'is-false'}`}>
        {value ? 'Yes' : 'No'}
      </span>
    )
  }
  if (typeof value === 'number') {
    return <span className="ar-value is-number">{value.toLocaleString()}</span>
  }

  const text = String(value)
  const isUrl = /^https?:\/\/\S+$/i.test(text)

  if (isUrl) {
    return (
      <a className="ar-value is-link" href={text} target="_blank" rel="noreferrer noopener">
        {text}
      </a>
    )
  }
  if (text.length > 160 || text.includes('\n')) {
    return <p className="ar-value is-long">{text}</p>
  }
  return <span className="ar-value">{text}</span>
}

function ValueNode({ value, depth = 0 }) {
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="ar-value is-empty">None</span>
    return (
      <ol className="ar-value-list">
        {value.map((item, index) => (
          // Response arrays are positional and immutable here, so the index
          // is the only stable identity available.
          // eslint-disable-next-line react/no-array-index-key
          <li key={index}>
            <ValueNode value={item} depth={depth + 1} />
          </li>
        ))}
      </ol>
    )
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) return <span className="ar-value is-empty">None</span>
    return (
      <dl className={`ar-value-object depth-${Math.min(depth, 3)}`}>
        {entries.map(([key, child]) => (
          <div className="ar-value-row" key={key}>
            <dt>{humanizeKey(key)}</dt>
            <dd><ValueNode value={child} depth={depth + 1} /></dd>
          </div>
        ))}
      </dl>
    )
  }

  return <ScalarValue value={value} />
}

function rawText(value) {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export default function AgentResponse({ label, value }) {
  const [showRaw, setShowRaw] = useState(false)
  const [copied, setCopied] = useState(false)
  const raw = rawText(value)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked — the raw view is still selectable by hand */
    }
  }

  return (
    <section className="ar-response">
      <header className="ar-response-head">
        <span className="ar-response-label">
          <FileText size={15} />
          {label || 'Agent response'}
        </span>
        <div className="ar-response-tools">
          <button
            type="button"
            className="ar-response-tool"
            onClick={() => setShowRaw((current) => !current)}
            aria-pressed={showRaw}
          >
            {showRaw ? 'Formatted' : 'Raw'}
          </button>
          <button type="button" className="ar-response-tool" onClick={copy}>
            {copied ? <><Check size={13} /> Copied</> : 'Copy'}
          </button>
        </div>
      </header>

      <div className="ar-response-body">
        {showRaw ? (
          <pre className="ar-response-raw">{raw}</pre>
        ) : (
          <ValueNode value={value} />
        )}
      </div>
    </section>
  )
}
