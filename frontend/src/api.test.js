import { afterEach, describe, expect, it, vi } from 'vitest'
import { listScreens, saveScreen, validateScreen } from './api.js'

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
