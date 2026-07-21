import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRESENTATION,
  normalizePresentation,
  presentationStyle,
} from './presentation.js'

describe('presentation settings', () => {
  it('normalizes legacy screens with meaningful fallbacks', () => {
    expect(
      normalizePresentation(null, {
        name: 'research-agent',
        description: 'Researches a topic for the user.',
      }),
    ).toEqual({
      ...DEFAULT_PRESENTATION,
      display_name: 'research-agent',
      welcome_description: 'Researches a topic for the user.',
    })
  })

  it('rejects unsafe visual values without breaking the screen', () => {
    const result = normalizePresentation({
      icon: 'unknown',
      accent_color: 'red',
      display_name: '  ',
      show_summary: false,
    })

    expect(result.icon).toBe(DEFAULT_PRESENTATION.icon)
    expect(result.accent_color).toBe(DEFAULT_PRESENTATION.accent_color)
    expect(result.show_summary).toBe(false)
  })

  it('exposes scoped CSS variables for the agent accent', () => {
    expect(presentationStyle({ accent_color: '#0e9384' })).toEqual({
      '--agent-accent': '#0e9384',
      '--agent-accent-soft': '#0e938418',
      '--agent-accent-faint': '#0e93840d',
    })
  })
})
