import { describe, expect, it } from 'vitest'
import { screenIdFrom } from './screenIdentity.js'

describe('screenIdFrom', () => {
  it('creates the same kebab-case IDs as the backend', () => {
    expect(screenIdFrom('  Email Agent 2! ')).toBe('email-agent-2')
  })

  it('returns an empty ID for punctuation-only names', () => {
    expect(screenIdFrom('!!!')).toBe('')
  })

  it('caps IDs at 64 characters without a trailing separator', () => {
    const result = screenIdFrom('word '.repeat(50))
    expect(result.length).toBeLessThanOrEqual(64)
    expect(result.endsWith('-')).toBe(false)
  })
})
