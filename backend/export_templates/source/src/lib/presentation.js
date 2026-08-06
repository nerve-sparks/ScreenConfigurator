export const AGENT_ICONS = Object.freeze([
  { value: 'sparkles', label: 'Sparkles' },
  { value: 'bolt', label: 'Bolt' },
  { value: 'compass', label: 'Compass' },
  { value: 'message', label: 'Message' },
])

export const ACCENT_COLORS = Object.freeze([
  '#635bff',
  '#2563eb',
  '#0e9384',
  '#db2777',
  '#ea580c',
  '#7c3aed',
])

export const DEFAULT_PRESENTATION = Object.freeze({
  display_name: '',
  icon: 'sparkles',
  accent_color: ACCENT_COLORS[0],
  welcome_title: 'Let’s get started',
  welcome_description:
    'Provide the details below so the agent can do its best work.',
  submit_label: 'Submit',
  show_summary: true,
})

const ICON_VALUES = new Set(AGENT_ICONS.map((icon) => icon.value))
const HEX_COLOR = /^#[0-9a-f]{6}$/i

function boundedText(value, fallback, maxLength) {
  if (typeof value !== 'string') return fallback
  const clean = value.trim()
  return clean ? clean.slice(0, maxLength) : fallback
}

/**
 * Return safe, complete visual settings for new and legacy saved screens.
 * The backend validates the same contract before persistence; this defensive
 * normalization keeps old database records and session drafts renderable.
 */
export function normalizePresentation(
  value,
  { name = '', description = '' } = {},
) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    display_name: boundedText(source.display_name, name, 80),
    icon: ICON_VALUES.has(source.icon) ? source.icon : DEFAULT_PRESENTATION.icon,
    accent_color: HEX_COLOR.test(source.accent_color ?? '')
      ? source.accent_color.toLowerCase()
      : DEFAULT_PRESENTATION.accent_color,
    welcome_title: boundedText(
      source.welcome_title,
      DEFAULT_PRESENTATION.welcome_title,
      100,
    ),
    welcome_description: boundedText(
      source.welcome_description,
      description || DEFAULT_PRESENTATION.welcome_description,
      240,
    ),
    submit_label: boundedText(
      source.submit_label,
      DEFAULT_PRESENTATION.submit_label,
      40,
    ),
    show_summary:
      typeof source.show_summary === 'boolean'
        ? source.show_summary
        : DEFAULT_PRESENTATION.show_summary,
  }
}

export function presentationStyle(presentation) {
  const normalized = normalizePresentation(presentation)
  return {
    '--agent-accent': normalized.accent_color,
    '--agent-accent-soft': `${normalized.accent_color}18`,
    '--agent-accent-faint': `${normalized.accent_color}0d`,
  }
}
