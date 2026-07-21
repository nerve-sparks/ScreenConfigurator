import { Suspense, lazy } from 'react'
import { isWizardManifest, toUiSchema } from './manifestLayout.js'
import { normalizePresentation, presentationStyle } from './presentation.js'
import { AgentGlyph, WorkspaceLoading } from './StudioShell.jsx'

const FormRenderer = lazy(() => import('./FormRenderer.jsx'))
const Wizard = lazy(() => import('./Wizard.jsx'))

export default function ScreenExperience({
  manifest,
  onSubmit,
  formKey = 0,
  framed = true,
  presentation,
  description = '',
  agentName = '',
  interactive = true,
}) {
  const wizardMode = isWizardManifest(manifest)
  const identity = normalizePresentation(presentation, {
    name: agentName,
    description,
  })
  const displayName = identity.display_name || agentName || 'Your agent'
  const content = (
    <div className="preview-content" style={presentationStyle(identity)}>
      <div className="preview-agent-heading">
        <span className="preview-agent-icon">
          <AgentGlyph icon={identity.icon} size={21} />
        </span>
        <div>
          <span>{displayName} · Agent input</span>
          <h1>{identity.welcome_title}</h1>
          <p>{identity.welcome_description}</p>
        </div>
      </div>
      <Suspense fallback={<WorkspaceLoading message="Rendering the input screen..." />}>
        {wizardMode ? (
          <Wizard
            key={formKey}
            manifest={manifest}
            onSubmit={onSubmit}
            disabled={!interactive}
            showSummary={identity.show_summary}
            submitLabel={identity.submit_label}
          />
        ) : (
          <FormRenderer
            key={formKey}
            schema={manifest.input_schema}
            uiSchema={toUiSchema(manifest)}
            onSubmit={onSubmit}
            disabled={!interactive}
            submitLabel={identity.submit_label}
          />
        )}
      </Suspense>
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
    <section className="agent-preview-frame" aria-label="Generated agent screen">
      <div className="preview-window-bar" aria-hidden="true">
        <span />
        <span />
        <span />
        <small>{displayName} · Input screen</small>
      </div>
      {content}
    </section>
  )
}
