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
    },
    required: ['to', 'subject', 'body'],
  },
  ui_hints: {
    mode: 'wizard',
    field_order: ['to', 'subject', 'body'],
    groups: [
      {
        id: 'recipient',
        title: 'Recipient details',
        description: 'Choose who should receive the email.',
        fields: ['to'],
      },
      {
        id: 'message',
        title: 'Message details',
        description: 'Write the subject and message body.',
        fields: ['subject', 'body'],
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
    expect(screen.getByText(manifest.ui_hints.groups[0].description)).toBeInTheDocument()

    const recipient = screen.getByLabelText(/Recipient/)
    await user.type(recipient, 'person@example.com')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument()
    expect(screen.getByText(manifest.ui_hints.groups[1].description)).toBeInTheDocument()

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
})
