import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearPreviewDraft,
  isPreviewDraft,
  loadPreviewDraft,
  savePreviewDraft,
} from './routeDraft.js'

const preview = {
  manifest: {
    input_schema: {
      type: 'object',
      properties: { topic: { type: 'string', title: 'Topic' } },
    },
    ui_hints: { mode: 'single', field_order: ['topic'] },
  },
  description: 'A research agent',
}

beforeEach(() => {
  window.sessionStorage.clear()
})

describe('preview route draft storage', () => {
  it('stores and restores valid preview payloads', () => {
    expect(savePreviewDraft(preview)).toBe(true)
    expect(loadPreviewDraft()).toEqual(preview)
  })

  it('rejects incomplete payloads and corrupt stored data', () => {
    expect(isPreviewDraft({ manifest: {} })).toBe(false)
    expect(savePreviewDraft({ manifest: {} })).toBe(false)
    window.sessionStorage.setItem('agent-screen-studio.preview-draft.v1', '{bad')
    expect(loadPreviewDraft()).toBeNull()
  })

  it('clears the current preview payload', () => {
    savePreviewDraft(preview)
    clearPreviewDraft()
    expect(loadPreviewDraft()).toBeNull()
  })
})
