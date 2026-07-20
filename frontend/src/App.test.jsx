import { render, screen, within } from '@testing-library/react'
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
  it('presents the studio workflow and can populate a detailed example brief', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(
      screen.getByRole('heading', {
        name: /Turn any agent idea into a thoughtful input experience/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', {
        name: /Your agent input experience will appear here/i,
      }),
    ).toBeInTheDocument()

    const progress = screen.getByRole('navigation', { name: 'Build progress' })
    expect(progress.querySelector('[aria-current="step"]')).toHaveTextContent(
      'Describe',
    )

    await user.click(
      screen.getByRole('button', { name: 'Use Research agent example' }),
    )
    expect(screen.getByLabelText('Describe your agent').value).toContain(
      'research agent',
    )
    expect(within(screen.getByLabelText('Agent configuration')).getByRole('button', {
      name: 'Generate',
    })).toBeEnabled()
  })

  it('keeps preview and saving unavailable until review is complete', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(
      screen.getByLabelText('Describe your agent'),
      'An agent that researches a topic',
    )
    await user.click(screen.getByRole('button', { name: 'Generate' }))

    expect(await screen.findByRole('heading', { name: 'Review suggested inputs' })).toBeInTheDocument()
    expect(
      screen
        .getByRole('navigation', { name: 'Build progress' })
        .querySelector('[aria-current="step"]'),
    ).toHaveTextContent('Review')
    expect(screen.queryByLabelText('Save this screen')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to preview' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Approve all' }))
    await user.click(screen.getByRole('button', { name: 'Continue to preview' }))

    expect(validateScreen).toHaveBeenCalledOnce()
    expect(await screen.findByLabelText('Save this screen')).toBeInTheDocument()
    expect(await screen.findByLabelText(/Topic/)).toBeInTheDocument()
    expect(
      screen
        .getByRole('navigation', { name: 'Build progress' })
        .querySelector('[aria-current="step"]'),
    ).toHaveTextContent('Preview')
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

  it('includes human-authored inputs in validation and preview', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(
      screen.getByLabelText('Describe your agent'),
      'An agent that researches a topic',
    )
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await screen.findByRole('heading', { name: 'Review suggested inputs' })

    await user.click(screen.getByRole('button', { name: /Add your own input/ }))
    await user.type(
      await screen.findByLabelText('Input label'),
      'Target language',
    )
    await user.selectOptions(screen.getByLabelText('Input type'), 'text')
    await user.click(
      screen.getByRole('checkbox', { name: 'Make this input required' }),
    )
    await user.click(screen.getByRole('button', { name: 'Add input' }))
    await user.click(screen.getByRole('button', { name: 'Approve all' }))
    await user.click(
      screen.getByRole('button', { name: 'Continue to preview' }),
    )

    expect(validateScreen).toHaveBeenCalledOnce()
    const reviewedManifest = validateScreen.mock.calls[0][0]
    expect(reviewedManifest.input_schema.properties.target_language).toEqual({
      type: 'string',
      title: 'Target language',
    })
    expect(reviewedManifest.input_schema.required).toContain('target_language')
    expect(reviewedManifest.ui_hints.field_order).toContain('target_language')
    expect(await screen.findByLabelText(/Target language/)).toBeInTheDocument()
  })
})
