import { ContentBlocks } from './LayoutRenderer.jsx'
import { normalizePresentation, presentationStyle } from '../lib/presentation.js'
import { AgentGlyph } from './RuntimePrimitives.jsx'

export default function ContentExperience({
  manifest,
  presentation,
  name,
  description = '',
  framed = true,
}) {
  const identity = normalizePresentation(presentation, { name, description })
  const content = (
    <div className="preview-content" style={presentationStyle(identity)}>
      <div className="preview-agent-heading">
        <span className="preview-agent-icon">
          <AgentGlyph icon={identity.icon} size={21} />
        </span>
        <div>
          <span>{identity.display_name || name} · Information</span>
          <h1>{identity.welcome_title}</h1>
          <p>{identity.welcome_description}</p>
        </div>
      </div>
      <ContentBlocks blocks={manifest?.blocks ?? []} />
    </div>
  )

  if (!framed) {
    return (
      <section className="published-experience" style={presentationStyle(identity)}>
        {content}
      </section>
    )
  }

  return (
    <section className="agent-preview-frame" aria-label="Generated content screen">
      <div className="preview-window-bar" aria-hidden="true">
        <span />
        <span />
        <span />
        <small>{identity.display_name || name} · Content screen</small>
      </div>
      {content}
    </section>
  )
}
