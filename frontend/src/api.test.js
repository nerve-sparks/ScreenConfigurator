import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateScreen } from './api.js'

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
