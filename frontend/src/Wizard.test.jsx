import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import Wizard from './Wizard.jsx'

const manifest = {
  input_schema: {
    type: 'object',
    properties: {
      to: { type: 'string', format: 'email', title: 'Recipient' },
      subject: { type: 'string', title: 'Subject' },
      body: { type: 'string', title: 'Message' },
      attachment: {
        type: 'string',
        format: 'data-url',
        title: 'Attachment',
        contentMediaType: 'text/plain',
      },
    },
    required: ['to', 'subject', 'body'],
  },
  ui_hints: {
    mode: 'wizard',
    field_order: ['to', 'subject', 'body', 'attachment'],
    groups: [
      {
        id: 'recipient',
        title: 'Recipient details',
        description: 'Choose who should receive the email.',
        fields: ['to'],
        blocks: [
          {
            id: 'recipient-copy',
            type: 'paragraph',
            text: 'Use the primary recipient address.',
          },
          { id: 'field-to', type: 'field', field: 'to' },
        ],
      },
      {
        id: 'message',
        title: 'Message details',
        description: 'Write the subject and message body.',
        fields: ['subject', 'body', 'attachment'],
        blocks: [
          {
            id: 'message-heading',
            type: 'heading',
            text: 'Compose the message',
            level: 3,
          },
          { id: 'field-subject', type: 'field', field: 'subject' },
          { id: 'field-body', type: 'field', field: 'body' },
          { id: 'field-attachment', type: 'field', field: 'attachment' },
        ],
      },
    ],
  },
}

describe('Wizard', () => {
  it('preserves step data and submits the merged payload', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Wizard manifest={manifest} onSubmit={onSubmit} />)

    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()
    expect(
      screen
        .getByRole('list', { name: 'Form steps' })
        .querySelector('[aria-current="step"]'),
    ).toHaveTextContent('Recipient details: current')
    expect(screen.getByText(manifest.ui_hints.groups[0].description)).toBeInTheDocument()
    expect(screen.getByText('Use the primary recipient address.')).toBeInTheDocument()

    const recipient = screen.getByLabelText(/Recipient/)
    await user.type(recipient, 'person@example.com')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument()
    expect(
      screen
        .getByRole('list', { name: 'Form steps' })
        .querySelector('[aria-current="step"]'),
    ).toHaveTextContent('Message details: current')
    expect(screen.getByText(manifest.ui_hints.groups[1].description)).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 3, name: 'Compose the message' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Choose or drop a file')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText(/Recipient/)).toHaveValue('person@example.com')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    await user.type(screen.getByLabelText(/Subject/), 'Hello')
    await user.type(screen.getByLabelText(/Message/), 'Welcome aboard')
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledWith({
      to: 'person@example.com',
      subject: 'Hello',
      body: 'Welcome aboard',
    })
  })

  it('can show a final answer summary before submission', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <Wizard
        manifest={manifest}
        onSubmit={onSubmit}
        showSummary
        submitLabel="Send to agent"
      />,
    )

    await user.type(screen.getByLabelText(/Recipient/), 'person@example.com')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.type(screen.getByLabelText(/Subject/), 'Hello')
    await user.type(screen.getByLabelText(/Message/), 'Welcome aboard')
    await user.click(screen.getByRole('button', { name: 'Review answers' }))

    expect(screen.getByRole('heading', { name: 'Check your information' })).toBeInTheDocument()
    expect(screen.getByText('person@example.com')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Send to agent' }))
    expect(onSubmit).toHaveBeenCalledWith({
      to: 'person@example.com',
      subject: 'Hello',
      body: 'Welcome aboard',
    })
  })

  it('shows a controlled step and exposes direct navigation only in a disabled preview', async () => {
    const user = userEvent.setup()
    const onActiveGroupChange = vi.fn()
    render(
      <Wizard
        manifest={manifest}
        onSubmit={vi.fn()}
        disabled
        activeGroupId="message"
        onActiveGroupChange={onActiveGroupChange}
      />,
    )

    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument()
    expect(screen.getByText(manifest.ui_hints.groups[1].description)).toBeInTheDocument()
    expect(screen.getByLabelText(/Subject/)).toBeDisabled()

    await user.click(screen.getByRole('button', {
      name: 'Preview Recipient details step',
    }))
    expect(onActiveGroupChange).toHaveBeenCalledWith('recipient')
  })

  it('does not expose direct step selection in an interactive wizard', () => {
    render(<Wizard manifest={manifest} onSubmit={vi.fn()} />)

    expect(
      screen.queryByRole('button', { name: /Preview Message details step/ }),
    ).not.toBeInTheDocument()
  })
})
