import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  listScreens,
  loadDraft,
  loadScreen,
  publishDraft,
  saveDraft,
  saveScreen,
  validateScreen,
} from './api.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('validateScreen', () => {
  it('posts the reviewed manifest and returns the validated copy', async () => {
    const manifest = { input_schema: {}, ui_hints: {} }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true, manifest }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(validateScreen(manifest)).resolves.toEqual(manifest)
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/validate$/), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest }),
    })
  })

  it('rejects malformed successful responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ valid: true }),
      }),
    )

    await expect(validateScreen({})).rejects.toThrow(/invalid validation response/i)
  })
})

describe('listScreens', () => {
  it('returns the saved-screen summaries', async () => {
    const screens = [{ agent_id: 'email-agent', latest_version: 3 }]
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ screens }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(listScreens()).resolves.toEqual(screens)
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/screens$/))
  })

  it('rejects malformed successful library responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ screens: {} }),
      }),
    )

    await expect(listScreens()).rejects.toThrow(/invalid screen-library response/i)
  })
})

describe('saveScreen', () => {
  it('stores presentation settings beside the validated manifest', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ agent_id: 'research-copilot', version: 1 }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const payload = {
      manifest: { input_schema: {}, ui_hints: {} },
      description: 'A research agent',
      name: 'Research Copilot',
      presentation: {
        display_name: 'Research Copilot',
        icon: 'compass',
        accent_color: '#0e9384',
      },
    }

    await saveScreen(payload)

    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/screens$/), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  })
})

describe('draft lifecycle', () => {
  it('autosaves editor state through the mutable draft endpoint', async () => {
    const response = {
      agent_id: 'research-agent',
      status: 'draft',
      revision: 'revision-1',
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => response,
    })
    vi.stubGlobal('fetch', fetchMock)
    const payload = {
      manifest: { input_schema: {}, ui_hints: {} },
      approvedManifest: { input_schema: {}, ui_hints: {} },
      description: 'Research assistant',
      name: 'Research Agent',
      presentation: { display_name: 'Research Agent' },
      editorState: { fields: {} },
    }

    await expect(saveDraft('research-agent', payload)).resolves.toEqual(response)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/screens\/research-agent\/draft$/),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          manifest: payload.manifest,
          approved_manifest: payload.approvedManifest,
          description: payload.description,
          name: payload.name,
          source: 'llm',
          presentation: payload.presentation,
          editor_state: payload.editorState,
        }),
      }),
    )
  })

  it('loads drafts and preserves the HTTP status on API errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'No working draft found' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const error = await loadDraft('missing-agent').catch((caught) => caught)
    expect(error).toBeInstanceOf(Error)
    expect(error.status).toBe(404)
  })

  it('publishes an exact draft revision with its change summary', async () => {
    const result = {
      agent_id: 'research-agent',
      status: 'published',
      version: 3,
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => result,
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(publishDraft('research-agent', {
      draftRevision: 'revision-3',
      changeSummary: 'Added scheduling fields',
    })).resolves.toEqual(result)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/screens\/research-agent\/publish$/),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          draft_revision: 'revision-3',
          change_summary: 'Added scheduling fields',
        }),
      }),
    )
  })

  it('can load an older immutable version explicitly', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ agent_id: 'research-agent', version: 2 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await loadScreen('research-agent', 2)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/screens\/research-agent\?version=2$/),
    )
  })
})
