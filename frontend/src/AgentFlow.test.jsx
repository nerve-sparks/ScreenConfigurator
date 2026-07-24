import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AgentFlow from './AgentFlow.jsx'

const contentScreen = {
  screen_id: 'welcome',
  screen_type: 'content',
  purpose: 'information',
  name: 'Welcome',
  description: 'Prepare for the request.',
  presentation: {
    display_name: 'Welcome',
    welcome_title: 'Before you begin',
    welcome_description: 'Read this information.',
  },
  manifest: {
    blocks: [
      {
        id: 'welcome-heading',
        type: 'heading',
        level: 2,
        text: 'What you need',
      },
      {
        id: 'welcome-copy',
        type: 'paragraph',
        text: 'Keep your topic ready.',
      },
    ],
  },
}

const formScreen = {
  screen_id: 'research-request',
  screen_type: 'form',
  purpose: 'intake',
  name: 'Research Request',
  description: 'Collect the research topic.',
  presentation: {
    display_name: 'Research Request',
    welcome_title: 'Request details',
    welcome_description: 'Tell us what to research.',
  },
  manifest: {
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', title: 'Research topic' },
      },
      required: ['topic'],
    },
    ui_hints: {
      mode: 'single',
      field_order: ['topic'],
      blocks: [{ id: 'field-topic', type: 'field', field: 'topic' }],
    },
  },
}

describe('AgentFlow', () => {
  it('moves through content and validated form screens in order', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    render(
      <AgentFlow
        screens={[contentScreen, formScreen]}
        screenIds={['welcome', 'research-request']}
        startScreenId="welcome"
        agentName="Research Agent"
        agentDescription="Research safely"
        onComplete={onComplete}
      />,
    )

    expect(screen.getByRole('heading', { name: 'What you need' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    const topic = await screen.findByLabelText(
      /Research topic/,
      {},
      { timeout: 3000 },
    )
    expect(topic).toBeRequired()
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(onComplete).not.toHaveBeenCalled()

    await user.type(topic, 'Safe AI interfaces')
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(onComplete).toHaveBeenCalledWith({
      'research-request': { topic: 'Safe AI interfaces' },
    })
  })

  it('preserves form values when navigating back from a later content screen', async () => {
    const user = userEvent.setup()
    render(
      <AgentFlow
        screens={[formScreen, contentScreen]}
        screenIds={['research-request', 'welcome']}
        startScreenId="research-request"
        agentName="Research Agent"
        agentDescription="Research safely"
        onComplete={() => {}}
      />,
    )

    await user.type(
      await screen.findByLabelText(/Research topic/, {}, { timeout: 3000 }),
      'Agent safety',
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(
      await screen.findByLabelText(/Research topic/, {}, { timeout: 3000 }),
    ).toHaveValue('Agent safety')
  })

  it('rotates the ordered journey so the configured start screen opens first', () => {
    render(
      <AgentFlow
        screens={[contentScreen, formScreen]}
        screenIds={['welcome', 'research-request']}
        startScreenId="research-request"
        agentName="Research Agent"
        agentDescription="Research safely"
        onComplete={() => {}}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Request details' })).toBeInTheDocument()
    expect(screen.getByText('Screen 1 of 2')).toBeInTheDocument()
  })
})
