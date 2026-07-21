import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.jsx'
import {
  generate,
  listScreens,
  loadScreen,
  saveScreen,
  validateScreen,
} from './api.js'
import { savePreviewDraft } from './routeDraft.js'

vi.mock('./api.js', () => ({
  generate: vi.fn(),
  validateScreen: vi.fn(),
  loadScreen: vi.fn(),
  saveScreen: vi.fn(),
  listScreens: vi.fn(),
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

const savedDocument = {
  agent_id: 'research-agent',
  version: 2,
  description: 'A saved research agent',
  manifest: generatedManifest,
  presentation: {
    display_name: 'Research Copilot',
    icon: 'compass',
    accent_color: '#0e9384',
    welcome_title: 'Plan your research',
    welcome_description: 'Tell us what you need to investigate.',
    submit_label: 'Create brief',
    show_summary: true,
  },
}

function renderApp(path = '/builder/new') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  window.sessionStorage.clear()
  generate.mockResolvedValue(generatedManifest)
  validateScreen.mockImplementation(async (manifest) => manifest)
  loadScreen.mockResolvedValue(savedDocument)
  listScreens.mockResolvedValue([])
  saveScreen.mockResolvedValue({ agent_id: 'research-agent', version: 1 })
})

describe('builder route', () => {
  it('presents the studio workflow and can populate a detailed example brief', async () => {
    const user = userEvent.setup()
    renderApp()

    expect(
      await screen.findByRole('heading', {
        name: /Create agent input UI/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', {
        name: /Describe an agent to create its input experience/i,
      }),
    ).toBeInTheDocument()

    expect(screen.getByRole('navigation', { name: 'Builder sections' })).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Use Research agent example' }),
    )
    expect(screen.getByLabelText('Describe your agent').value).toContain(
      'research agent',
    )
    expect(
      within(screen.getByLabelText('Agent configuration')).getByRole('button', {
        name: 'Generate',
      }),
    ).toBeEnabled()
  })

  it('navigates to an isolated preview only after review is complete', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.type(
      await screen.findByLabelText('Describe your agent'),
      'An agent that researches a topic',
    )
    await user.click(screen.getByRole('button', { name: 'Generate' }))

    expect(
      await screen.findByRole('heading', { name: 'Review suggested inputs' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Screen name')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to preview' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Approve all' }))
    await user.click(screen.getByRole('button', { name: 'Continue to preview' }))

    expect(validateScreen).toHaveBeenCalledOnce()
    expect(
      await screen.findByRole('heading', {
        name: 'Test the generated input experience',
      }),
    ).toBeInTheDocument()
    expect(await screen.findByLabelText(/Topic/)).toBeInTheDocument()
    expect(screen.getByLabelText('Screen name')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back to builder/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('Describe your agent')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Review suggested inputs' })).not.toBeInTheDocument()
  })

  it('updates branding and device size on the live editor canvas', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.type(
      await screen.findByLabelText('Describe your agent'),
      'An agent that researches a topic',
    )
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await screen.findByRole('heading', { name: 'Review suggested inputs' })

    await user.type(screen.getByLabelText('Agent name'), 'Research Copilot')
    await user.click(screen.getByRole('button', { name: 'Compass icon' }))
    await user.clear(screen.getByLabelText('Welcome title'))
    await user.type(screen.getByLabelText('Welcome title'), 'Plan your research')
    await user.click(screen.getByRole('button', { name: 'Mobile preview' }))

    const preview = screen.getByLabelText('Generated agent screen')
    expect(within(preview).getByText('Research Copilot · Agent input')).toBeInTheDocument()
    expect(within(preview).getByRole('heading', { name: 'Plan your research' })).toBeInTheDocument()
    expect(document.querySelector('.device-preview-frame')).toHaveAttribute(
      'data-device',
      'mobile',
    )
  })

  it('keeps the draft in review when backend validation rejects it', async () => {
    const user = userEvent.setup()
    validateScreen.mockRejectedValueOnce(new Error('Manifest failed validation.'))
    renderApp()

    await user.type(
      await screen.findByLabelText('Describe your agent'),
      'An agent that researches a topic',
    )
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await screen.findByRole('heading', { name: 'Review suggested inputs' })
    await user.click(screen.getByRole('button', { name: 'Approve all' }))
    await user.click(screen.getByRole('button', { name: 'Continue to preview' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Manifest failed validation.',
    )
    expect(
      screen.getByRole('heading', { name: 'Review suggested inputs' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Screen name')).not.toBeInTheDocument()
  })

  it('includes human-authored inputs in validation and the preview route', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.type(
      await screen.findByLabelText('Describe your agent'),
      'An agent that researches a topic',
    )
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await screen.findByRole('heading', { name: 'Review suggested inputs' })

    await user.click(screen.getByRole('button', { name: /Add your own input/ }))
    await user.type(await screen.findByLabelText('Input label'), 'Target language')
    await user.selectOptions(screen.getByLabelText('Input type'), 'text')
    await user.click(
      screen.getByRole('checkbox', { name: 'Make this input required' }),
    )
    await user.click(screen.getByRole('button', { name: 'Add input' }))
    await user.click(screen.getByRole('button', { name: 'Approve all' }))
    await user.click(screen.getByRole('button', { name: 'Continue to preview' }))

    expect(validateScreen).toHaveBeenCalledOnce()
    const reviewedManifest = validateScreen.mock.calls[0][0]
    expect(reviewedManifest.input_schema.properties.target_language).toEqual({
      type: 'string',
      title: 'Target language',
    })
    expect(reviewedManifest.input_schema.required).toContain('target_language')
    await screen.findByRole('heading', {
      name: 'Test the generated input experience',
    })
    const preview = screen.getByLabelText('Generated agent screen')
    expect(
      await within(preview).findByLabelText(/Target language/),
    ).toBeInTheDocument()
  })

  it('loads a saved configuration into the edit route as already reviewed', async () => {
    renderApp('/builder/research-agent/edit')

    expect(
      await screen.findByRole('heading', { name: 'Review suggested inputs' }),
    ).toBeInTheDocument()
    expect(loadScreen).toHaveBeenCalledWith('research-agent')
    expect(screen.getByText(/2 of 2 reviewed/)).toBeInTheDocument()
    expect(screen.getAllByText('Saved input')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Continue to preview' })).toBeEnabled()
  })
})

describe('separated screen routes', () => {
  it('redirects the legacy root URL to the new builder route', async () => {
    renderApp('/')

    expect(
      await screen.findByRole('heading', {
        name: /Create agent input UI/i,
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Builder' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('restores a validated draft when the preview route is refreshed', async () => {
    savePreviewDraft({
      manifest: generatedManifest,
      description: 'A draft research agent',
      returnPath: '/builder/new',
    })

    renderApp('/preview/draft')

    expect(await screen.findByLabelText(/Topic/)).toBeInTheDocument()
    expect(loadScreen).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Describe your agent')).not.toBeInTheDocument()
  })

  it('renders a saved preview without builder editing controls', async () => {
    renderApp('/preview/research-agent')

    expect(await screen.findByLabelText(/Topic/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Test the generated input experience' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Describe your agent')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Review suggested inputs' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open published screen' })).toHaveAttribute(
      'href',
      '/screens/research-agent',
    )
  })

  it('renders the published route without studio navigation or administrative controls', async () => {
    renderApp('/screens/research-agent')

    expect(await screen.findByLabelText(/Topic/)).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Studio navigation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Back to builder/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Save this configuration')).not.toBeInTheDocument()
  })

  it('lists saved configurations with separate edit, preview, and published links', async () => {
    listScreens.mockResolvedValue([
      { agent_id: 'research-agent', latest_version: 2 },
    ])
    renderApp('/library')

    expect(await screen.findByRole('heading', { name: 'research-agent' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Preview' })).toHaveAttribute(
      'href',
      '/preview/research-agent',
    )
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      '/builder/research-agent/edit',
    )
    expect(screen.getByRole('link', { name: /Open published/ })).toHaveAttribute(
      'href',
      '/screens/research-agent',
    )
  })

  it('saves a draft from preview and exposes its published route', async () => {
    const user = userEvent.setup()
    savePreviewDraft({
      manifest: generatedManifest,
      description: 'A research agent',
      returnPath: '/builder/new',
      reviewDraft: { manifest: generatedManifest, fields: {}, deletedFields: [] },
    })
    renderApp('/preview/draft')

    await screen.findByLabelText(/Topic/)
    await user.type(screen.getByLabelText('Screen name'), 'Research Agent')
    await user.click(screen.getByRole('button', { name: 'Save screen' }))

    expect(saveScreen).toHaveBeenCalledWith({
      manifest: generatedManifest,
      description: 'A research agent',
      name: 'Research Agent',
      presentation: {
        accent_color: '#635bff',
        display_name: 'Research Agent',
        icon: 'sparkles',
        show_summary: true,
        submit_label: 'Submit',
        welcome_description: 'A research agent',
        welcome_title: 'Let’s get started',
      },
    })
    expect(await screen.findByRole('link', { name: 'Open published screen' })).toHaveAttribute(
      'href',
      '/screens/research-agent',
    )
    expect(screen.queryByLabelText('Screen name')).not.toBeInTheDocument()
  })
})
