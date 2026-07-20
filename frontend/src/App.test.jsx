import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.jsx'
import { generate, validateScreen } from './api.js'

vi.mock('./api.js', () => ({
  generate: vi.fn(),
  validateScreen: vi.fn(),
  loadScreen: vi.fn(),
  saveScreen: vi.fn(),
}))

const generatedManifest = {
  input_schema: {
    type: 'object',
    properties: {
      topic: { type: 'string', title: 'Topic' },
      length: { type: 'integer', title: 'Summary length' },
    },
    required: ['topic'],
  },
  ui_hints: {
    mode: 'single',
    field_order: ['topic', 'length'],
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  generate.mockResolvedValue(generatedManifest)
  validateScreen.mockImplementation(async (manifest) => manifest)
})

describe('App review workflow', () => {
  it('keeps preview and saving unavailable until review is complete', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(
      screen.getByLabelText('Describe your agent'),
      'An agent that researches a topic',
    )
    await user.click(screen.getByRole('button', { name: 'Generate' }))

    expect(await screen.findByRole('heading', { name: 'Review suggested inputs' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Save this screen')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to preview' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Approve all' }))
    await user.click(screen.getByRole('button', { name: 'Continue to preview' }))

    expect(validateScreen).toHaveBeenCalledOnce()
    expect(await screen.findByLabelText('Save this screen')).toBeInTheDocument()
    expect(screen.getByLabelText(/Topic/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Back to input review/ })).toBeInTheDocument()
  })

  it('keeps the draft in review when backend validation rejects it', async () => {
    const user = userEvent.setup()
    validateScreen.mockRejectedValueOnce(new Error('Manifest failed validation.'))
    render(<App />)

    await user.type(
      screen.getByLabelText('Describe your agent'),
      'An agent that researches a topic',
    )
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await screen.findByRole('heading', { name: 'Review suggested inputs' })
    await user.click(screen.getByRole('button', { name: 'Approve all' }))
    await user.click(screen.getByRole('button', { name: 'Continue to preview' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Manifest failed validation.',
    )
    expect(screen.getByRole('heading', { name: 'Review suggested inputs' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Save this screen')).not.toBeInTheDocument()
  })
})
