import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.jsx'
import {
  createDraft,
  duplicateScreen,
  generate,
  listScreenVersions,
  listScreens,
  loadDraft,
  loadScreen,
  publishDraft,
  restoreScreenVersion,
  saveDraft,
  setScreenArchived,
  validateScreen,
} from './api.js'
import { savePreviewDraft } from './routeDraft.js'

vi.mock('./api.js', () => ({
  createDraft: vi.fn(),
  duplicateScreen: vi.fn(),
  generate: vi.fn(),
  listScreenVersions: vi.fn(),
  validateScreen: vi.fn(),
  loadDraft: vi.fn(),
  loadScreen: vi.fn(),
  saveDraft: vi.fn(),
  publishDraft: vi.fn(),
  restoreScreenVersion: vi.fn(),
  setScreenArchived: vi.fn(),
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
  const notFound = new Error('No working draft found')
  notFound.status = 404
  loadDraft.mockRejectedValue(notFound)
  loadScreen.mockResolvedValue(savedDocument)
  listScreens.mockResolvedValue([])
  listScreenVersions.mockResolvedValue([])
  duplicateScreen.mockResolvedValue({
    agent_id: 'research-agent-copy',
    status: 'draft',
    revision: 'duplicate-revision-1',
  })
  restoreScreenVersion.mockResolvedValue({
    agent_id: 'research-agent',
    status: 'draft',
    revision: 'restored-revision-1',
  })
  setScreenArchived.mockResolvedValue({
    agent_id: 'research-agent',
    is_archived: true,
  })
  saveDraft.mockResolvedValue({
    agent_id: 'research-agent',
    status: 'draft',
    revision: 'draft-revision-1',
    published_version: null,
  })
  createDraft.mockResolvedValue({
    agent_id: 'research-agent',
    status: 'draft',
    revision: 'draft-revision-1',
    published_version: null,
  })
  publishDraft.mockResolvedValue({
    agent_id: 'research-agent',
    status: 'published',
    version: 1,
  })
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
    expect(screen.getByText('Draft not saved')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Use Research agent example' }),
    )
    expect(screen.getByLabelText('Describe your agent').value).toContain(
      'research agent',
    )
    const generateButton = within(
      screen.getByLabelText('Agent configuration'),
    ).getByRole('button', { name: 'Generate' })
    expect(generateButton).toBeDisabled()

    await user.type(screen.getByLabelText('Agent name'), 'Research Agent')
    expect(screen.getByText('research-agent')).toBeInTheDocument()
    expect(
      generateButton,
    ).toBeEnabled()
  })

  it('requires a name that can produce a valid screen ID', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.type(
      await screen.findByLabelText('Describe your agent'),
      'An agent that researches a topic',
    )
    await user.type(screen.getByLabelText('Agent name'), '!!!')

    expect(screen.getByText('Enter a name with letters or numbers')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled()
    expect(generate).not.toHaveBeenCalled()
  })

  it('rejects an existing screen ID before calling the LLM', async () => {
    const user = userEvent.setup()
    listScreens.mockResolvedValueOnce([{ agent_id: 'research-agent' }])
    renderApp()

    await user.type(await screen.findByLabelText('Agent name'), 'Research Agent')
    await user.type(
      screen.getByLabelText('Describe your agent'),
      'An agent that researches a topic',
    )
    await user.click(screen.getByRole('button', { name: 'Generate' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A screen with ID “research-agent” already exists.',
    )
    expect(generate).not.toHaveBeenCalled()
  })

  it('navigates to an isolated preview only after review is complete', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.type(await screen.findByLabelText('Agent name'), 'Research Agent')
    await user.type(
      screen.getByLabelText('Describe your agent'),
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
    expect(screen.getByLabelText('Screen ID')).toHaveValue('research-agent')
    expect(screen.getByRole('link', { name: /Back to builder/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('Describe your agent')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Review suggested inputs' })).not.toBeInTheDocument()
  })

  it('updates branding and device size on the live editor canvas', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.type(await screen.findByLabelText('Agent name'), 'Research Agent')
    await user.type(
      screen.getByLabelText('Describe your agent'),
      'An agent that researches a topic',
    )
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await screen.findByRole('heading', { name: 'Review suggested inputs' })

    await waitFor(() => expect(createDraft).toHaveBeenCalled(), { timeout: 2000 })
    await waitFor(() => expect(screen.getByLabelText('Agent name')).toBeEnabled())
    await user.clear(screen.getByLabelText('Agent name'))
    await user.type(screen.getByLabelText('Agent name'), 'Research Copilot')
    expect(screen.getByText('research-agent')).toBeInTheDocument()
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
    await waitFor(() => expect(saveDraft).toHaveBeenCalled(), { timeout: 2000 })
    expect(saveDraft.mock.calls.at(-1)[0]).toBe('research-agent')
    expect(saveDraft.mock.calls.at(-1)[1].name).toBe('Research Copilot')
  })

  it('autosaves edits as a draft without publishing a version', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.type(await screen.findByLabelText('Agent name'), 'Research Agent')
    await user.type(
      screen.getByLabelText('Describe your agent'),
      'An agent that researches a topic',
    )
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await screen.findByRole('heading', { name: 'Review suggested inputs' })

    await waitFor(() => expect(createDraft).toHaveBeenCalled(), { timeout: 2000 })
    expect(createDraft.mock.calls[0][0]).toBe('research-agent')
    expect(createDraft.mock.calls[0][1]).not.toHaveProperty('approvedManifest')
    expect(saveDraft).not.toHaveBeenCalled()
    expect(publishDraft).not.toHaveBeenCalled()
  })

  it('uses PUT for an edit queued while the first draft POST is pending', async () => {
    const user = userEvent.setup()
    let resolveCreate
    createDraft.mockImplementationOnce(() => new Promise((resolve) => {
      resolveCreate = resolve
    }))
    renderApp()

    await user.type(await screen.findByLabelText('Agent name'), 'Research Agent')
    await user.type(
      screen.getByLabelText('Describe your agent'),
      'An agent that researches a topic',
    )
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await screen.findByRole('heading', { name: 'Review suggested inputs' })
    await waitFor(() => expect(createDraft).toHaveBeenCalledTimes(1), { timeout: 2000 })

    await user.click(screen.getAllByRole('button', { name: 'Approve' })[0])
    await screen.findByText('Saving draft…', {}, { timeout: 2000 })
    resolveCreate({
      agent_id: 'research-agent',
      status: 'draft',
      revision: 'created-revision',
      published_version: null,
    })

    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1), { timeout: 2000 })
    expect(createDraft).toHaveBeenCalledTimes(1)
    expect(saveDraft.mock.calls[0][0]).toBe('research-agent')
  })

  it('keeps the draft in review when backend validation rejects it', async () => {
    const user = userEvent.setup()
    validateScreen.mockRejectedValueOnce(new Error('Manifest failed validation.'))
    renderApp()

    await user.type(await screen.findByLabelText('Agent name'), 'Research Agent')
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
    expect(
      screen.getByRole('heading', { name: 'Review suggested inputs' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Screen name')).not.toBeInTheDocument()
  })

  it('includes human-authored inputs in validation and the preview route', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.type(await screen.findByLabelText('Agent name'), 'Research Agent')
    await user.type(
      screen.getByLabelText('Describe your agent'),
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
    expect(loadDraft).toHaveBeenCalledWith('research-agent')
    expect(loadScreen).toHaveBeenCalledWith('research-agent')
    expect(screen.getByText(/2 of 2 reviewed/)).toBeInTheDocument()
    expect(screen.getAllByText('Saved input')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Continue to preview' })).toBeEnabled()
  })

  it('reopens the mutable draft before falling back to a published version', async () => {
    loadDraft.mockResolvedValueOnce({
      agent_id: 'research-agent',
      status: 'draft',
      revision: 'draft-revision-2',
      published_version: 2,
      description: 'A draft research agent',
      draft_manifest: generatedManifest,
      editor_state: null,
      presentation: savedDocument.presentation,
    })

    renderApp('/builder/research-agent/edit')

    expect(await screen.findByText('Draft saved')).toBeInTheDocument()
    expect(loadDraft).toHaveBeenCalledWith('research-agent')
    expect(loadScreen).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue('A draft research agent')).toBeInTheDocument()
  })

  it('shows a friendly name when opening a legacy long-ID draft', async () => {
    const legacyId = 'i-want-to-create-an-ai-travel-planner-agent'
    loadDraft.mockResolvedValueOnce({
      agent_id: legacyId,
      status: 'draft',
      revision: 'legacy-revision',
      published_version: null,
      description: 'A travel planning agent',
      draft_manifest: generatedManifest,
      editor_state: null,
      name: 'AI Travel Planner',
      presentation: {
        ...savedDocument.presentation,
        display_name: 'AI Travel Planner',
      },
    })

    renderApp(`/builder/${legacyId}/edit`)

    expect(
      await screen.findByText('Editing the working draft for “AI Travel Planner”.'),
    ).toBeInTheDocument()
    expect(screen.getByText(legacyId)).toBeInTheDocument()
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
      '/screens/research-agent?version=2',
    )
  })

  it('renders the published route without studio navigation or administrative controls', async () => {
    renderApp('/screens/research-agent')

    expect(await screen.findByLabelText(/Topic/)).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Studio navigation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Back to builder/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Save this configuration')).not.toBeInTheDocument()
  })

  it('lists saved configurations with separate draft, preview, and published links', async () => {
    listScreens.mockResolvedValue([
      { agent_id: 'research-agent', latest_version: 2 },
    ])
    renderApp('/library')

    expect(await screen.findByRole('heading', { name: 'research-agent' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Preview latest' })).toHaveAttribute(
      'href',
      '/preview/research-agent',
    )
    expect(screen.getByRole('link', { name: 'Create draft' })).toHaveAttribute(
      'href',
      '/builder/research-agent/edit',
    )
    expect(screen.getByRole('link', { name: /Published UI/ })).toHaveAttribute(
      'href',
      '/screens/research-agent',
    )
  })

  it('shows draft-only screens without a published route', async () => {
    listScreens.mockResolvedValue([
      {
        agent_id: 'draft-agent',
        name: 'Draft Agent',
        latest_version: null,
        has_draft: true,
      },
    ])
    renderApp('/library')

    expect(await screen.findByRole('heading', { name: 'Draft Agent' })).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open latest draft' })).toHaveAttribute(
      'href',
      '/builder/draft-agent/edit',
    )
    expect(screen.queryByRole('link', { name: /Published UI/ })).not.toBeInTheDocument()
  })

  it('searches by name or agent ID and filters by lifecycle status', async () => {
    const user = userEvent.setup()
    listScreens.mockResolvedValue([
      {
        agent_id: 'research-agent',
        name: 'Research Agent',
        latest_version: 1,
        has_draft: true,
        is_archived: false,
      },
      {
        agent_id: 'billing-helper',
        name: 'Invoice Assistant',
        latest_version: 2,
        has_draft: false,
        is_archived: false,
      },
      {
        agent_id: 'old-support-agent',
        name: 'Archived Support',
        latest_version: 3,
        has_draft: true,
        is_archived: true,
      },
    ])
    renderApp('/library')

    await screen.findByRole('heading', { name: 'Research Agent' })
    expect(screen.queryByRole('heading', { name: 'Archived Support' })).not.toBeInTheDocument()

    const searchInput = screen.getByRole('searchbox', { name: 'Search screens' })
    await user.type(searchInput, 'billing-helper')
    expect(screen.getByRole('heading', { name: 'Invoice Assistant' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Research Agent' })).not.toBeInTheDocument()

    await user.clear(searchInput)
    await user.click(screen.getByRole('button', { name: /^Drafts 1$/ }))
    expect(screen.getByRole('heading', { name: 'Research Agent' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Invoice Assistant' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Published 2$/ }))
    expect(screen.getByRole('heading', { name: 'Invoice Assistant' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Archived 1$/ }))
    expect(screen.getByRole('heading', { name: 'Archived Support' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Research Agent' })).not.toBeInTheDocument()
  })

  it('opens immutable version history and restores a selected version as the draft', async () => {
    const user = userEvent.setup()
    listScreens.mockResolvedValue([
      {
        agent_id: 'research-agent',
        name: 'Research Agent',
        latest_version: 2,
        version_count: 2,
        has_draft: true,
        is_archived: false,
      },
    ])
    listScreenVersions.mockResolvedValue([
      { version: 2, change_summary: 'Added sources', published_at: '2026-07-20T10:00:00Z' },
      { version: 1, change_summary: 'Initial inputs', published_at: '2026-07-19T10:00:00Z' },
    ])
    renderApp('/library')

    await user.click(await screen.findByRole('button', { name: 'Version history (2)' }))
    expect(listScreenVersions).toHaveBeenCalledWith('research-agent')
    const firstVersion = (await screen.findByText('Initial inputs')).closest('li')
    await user.click(within(firstVersion).getByRole('button', { name: 'Restore' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Restore version 1?')
    await user.click(screen.getByRole('button', { name: 'Restore as draft' }))

    await waitFor(() => {
      expect(restoreScreenVersion).toHaveBeenCalledWith('research-agent', 1)
    })
  })

  it('duplicates a screen into a separately named draft', async () => {
    const user = userEvent.setup()
    listScreens.mockResolvedValue([
      {
        agent_id: 'research-agent',
        name: 'Research Agent',
        latest_version: 2,
        version_count: 2,
        has_draft: true,
        is_archived: false,
      },
    ])
    duplicateScreen.mockResolvedValue({
      agent_id: 'customer-research-agent',
      status: 'draft',
      revision: 'duplicate-revision-1',
    })
    renderApp('/library')

    await user.click(await screen.findByRole('button', { name: 'Duplicate Research Agent' }))
    const nameInput = screen.getByLabelText('New screen name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Customer Research Agent')
    expect(screen.getByText(/customer-research-agent/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create duplicate' }))

    await waitFor(() => {
      expect(duplicateScreen).toHaveBeenCalledWith(
        'research-agent',
        'Customer Research Agent',
      )
    })
  })

  it('archives a screen without deleting it from the library', async () => {
    const user = userEvent.setup()
    const activeScreen = {
      agent_id: 'research-agent',
      name: 'Research Agent',
      latest_version: 2,
      version_count: 2,
      has_draft: true,
      is_archived: false,
    }
    listScreens
      .mockResolvedValueOnce([activeScreen])
      .mockResolvedValueOnce([{ ...activeScreen, is_archived: true }])
    renderApp('/library')

    await user.click(await screen.findByRole('button', { name: 'Archive Research Agent' }))
    expect(screen.getByRole('dialog')).toHaveTextContent(/every published version remain intact/i)
    await user.click(screen.getByRole('button', { name: 'Archive screen' }))

    await waitFor(() => {
      expect(setScreenArchived).toHaveBeenCalledWith('research-agent', true)
    })
    await user.click(screen.getByRole('button', { name: /^Archived 1$/ }))
    const archivedCard = screen.getByRole('heading', { name: 'Research Agent' }).closest('article')
    expect(within(archivedCard).getByText('Archived')).toBeInTheDocument()
  })

  it('publishes a validated draft and exposes its published route', async () => {
    const user = userEvent.setup()
    savePreviewDraft({
      manifest: generatedManifest,
      description: 'A research agent',
      name: 'Research Copilot',
      presentation: {
        ...savedDocument.presentation,
        display_name: 'Research Copilot',
      },
      returnPath: '/builder/new',
      reviewDraft: { manifest: generatedManifest, fields: {}, deletedFields: [] },
      draftAgentId: 'research-agent',
      draftRevision: 'draft-revision-1',
    })
    renderApp('/preview/draft')

    await screen.findByLabelText(/Topic/)
    await user.clear(screen.getByLabelText('What changed?'))
    await user.type(screen.getByLabelText('What changed?'), 'Initial research inputs')
    await user.click(screen.getByRole('button', { name: 'Publish version' }))

    expect(publishDraft).toHaveBeenCalledWith('research-agent', {
      draftRevision: 'draft-revision-1',
      changeSummary: 'Initial research inputs',
    })
    expect(await screen.findByRole('link', { name: 'Open published screen' })).toHaveAttribute(
      'href',
      '/screens/research-agent?version=1',
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Published “Research Copilot” version 1.',
    )
    expect(screen.queryByLabelText('Screen name')).not.toBeInTheDocument()
  })
})
