import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  frontendArchiveFilename,
  saveFrontendArchive,
} from './frontendDownload.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('standalone frontend downloads', () => {
  it('constructs the local filename only from a validated ID and version', () => {
    expect(frontendArchiveFilename('inbound-calling-agent', 3)).toBe(
      'inbound-calling-agent-frontend-v3.zip',
    )
    expect(() => frontendArchiveFilename('../unsafe', 3)).toThrow(/safe/)
    expect(() => frontendArchiveFilename('safe-agent', 0)).toThrow(/safe/)
  })

  it('clicks a temporary object URL and always revokes it', () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:frontend-archive')
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {})
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})
    const archive = new Blob(['zip'], { type: 'application/zip' })

    saveFrontendArchive(archive, 'calling-agent', 2)

    expect(createObjectURL).toHaveBeenCalledWith(archive)
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:frontend-archive')
    expect(document.querySelector('a[download]')).not.toBeInTheDocument()
  })
})
