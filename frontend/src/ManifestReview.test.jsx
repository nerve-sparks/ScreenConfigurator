import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ManifestReview from './ManifestReview.jsx'
import { createReviewDraft } from './reviewModel.js'

const manifest = {
  input_schema: {
    type: 'object',
    properties: {
      to: { type: 'string', format: 'email', title: 'Recipient' },
      subject: { type: 'string', title: 'Subject' },
    },
    required: ['to'],
  },
  ui_hints: {
    mode: 'single',
    field_order: ['to', 'subject'],
  },
}

const wizardManifest = {
  ...manifest,
  ui_hints: {
    mode: 'wizard',
    field_order: ['to', 'subject'],
    groups: [
      {
        id: 'recipient',
        title: 'Recipient details',
        description: 'Choose who receives the message.',
        fields: ['to'],
      },
      {
        id: 'message',
        title: 'Message details',
        description: 'Compose the message.',
        fields: ['subject'],
      },
    ],
  },
}

function ReviewHarness({ onContinue = () => {}, initialManifest = manifest }) {
  const [draft, setDraft] = useState(() => createReviewDraft(initialManifest))
  return (
    <ManifestReview
      draft={draft}
      onChange={setDraft}
      onContinue={onContinue}
    />
  )
}

function fieldCard(title) {
  return screen.getByRole('heading', { name: title }).closest('article')
}

describe('ManifestReview', () => {
  it('blocks continuation until every field is decided', async () => {
    const user = userEvent.setup()
    const onContinue = vi.fn()
    render(<ReviewHarness onContinue={onContinue} />)

    const continueButton = screen.getByRole('button', {
      name: 'Continue to preview',
    })
    expect(continueButton).toBeDisabled()
    expect(screen.getByText(/0 of 2 reviewed/)).toBeInTheDocument()

    await user.click(within(fieldCard('Recipient')).getByRole('button', { name: 'Approve' }))
    expect(continueButton).toBeDisabled()

    await user.click(within(fieldCard('Subject')).getByRole('button', { name: 'Exclude' }))
    expect(continueButton).toBeEnabled()
    expect(screen.getByText(/2 of 2 reviewed/)).toBeInTheDocument()

    await user.click(continueButton)
    expect(onContinue).toHaveBeenCalledOnce()
  })

  it('edits a field and marks it as human edited and approved', async () => {
    const user = userEvent.setup()
    render(<ReviewHarness />)

    const card = fieldCard('Subject')
    await user.click(within(card).getByRole('button', { name: 'Edit' }))
    const labelInput = within(card).getByLabelText('Label')
    await user.clear(labelInput)
    await user.type(labelInput, 'Campaign subject')
    await user.type(within(card).getByLabelText('Help text'), 'Keep it concise.')
    await user.click(within(card).getByRole('button', { name: 'Save changes' }))

    const updatedCard = fieldCard('Campaign subject')
    expect(within(updatedCard).getByText('approved')).toBeInTheDocument()
    expect(within(updatedCard).getByText(/Human edited/)).toBeInTheDocument()
    expect(within(updatedCard).getByText('Keep it concise.')).toBeInTheDocument()
  })

  it('treats a required toggle as an explicit human approval', async () => {
    const user = userEvent.setup()
    render(<ReviewHarness />)

    const card = fieldCard('Subject')
    await user.click(within(card).getByRole('checkbox', { name: 'Required' }))

    expect(within(card).getByText('approved')).toBeInTheDocument()
    expect(within(card).getByText(/Human edited/)).toBeInTheDocument()
  })

  it('removes a field and reports the removal', async () => {
    const user = userEvent.setup()
    render(<ReviewHarness />)

    await user.click(screen.getByRole('button', { name: 'Remove Subject' }))

    expect(screen.queryByRole('heading', { name: 'Subject' })).not.toBeInTheDocument()
    expect(screen.getByText(/1 removed/)).toBeInTheDocument()
  })

  it('adds a human-authored input as an approved field', async () => {
    const user = userEvent.setup()
    render(<ReviewHarness />)

    await user.click(screen.getByRole('button', { name: /Add your own input/ }))
    await user.type(
      await screen.findByLabelText('Input label'),
      'Notification email',
    )
    expect(screen.getByLabelText('Field name')).toHaveValue('notification_email')
    await user.type(
      screen.getByLabelText('Help text'),
      'Language used for the final response.',
    )
    await user.selectOptions(screen.getByLabelText('Input type'), 'email')
    await user.click(
      screen.getByRole('checkbox', { name: 'Make this input required' }),
    )
    await user.click(screen.getByRole('button', { name: 'Add input' }))

    const card = fieldCard('Notification email')
    expect(within(card).getByText('Human added')).toBeInTheDocument()
    expect(within(card).getByText('approved')).toBeInTheDocument()
    expect(within(card).getByText('notification_email')).toBeInTheDocument()
    expect(within(card).getByText(/string · email/)).toBeInTheDocument()
    expect(
      within(card).getByRole('checkbox', { name: 'Required' }),
    ).toBeChecked()
  })

  it('keeps the input builder open and explains duplicate names', async () => {
    const user = userEvent.setup()
    render(<ReviewHarness />)

    await user.click(screen.getByRole('button', { name: /Add your own input/ }))
    await user.type(await screen.findByLabelText('Input label'), 'Subject')
    await user.click(screen.getByRole('button', { name: 'Add input' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /field name already exists/i,
    )
    expect(
      screen.getByRole('heading', { name: 'Add your own input' }),
    ).toBeInTheDocument()
  })

  it('places a human input in the selected wizard step', async () => {
    const user = userEvent.setup()
    render(<ReviewHarness initialManifest={wizardManifest} />)

    await user.click(screen.getByRole('button', { name: /Add your own input/ }))
    await user.type(await screen.findByLabelText('Input label'), 'CC')
    await user.selectOptions(screen.getByLabelText('Wizard step'), 'recipient')
    await user.click(screen.getByRole('button', { name: 'Add input' }))

    expect(
      screen
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['Recipient', 'CC', 'Subject'])
  })

  it('locks review controls while the approved draft is being validated', () => {
    render(
      <ManifestReview
        draft={createReviewDraft(manifest)}
        onChange={() => {}}
        onContinue={() => {}}
        continuing
      />,
    )

    const card = fieldCard('Recipient')
    expect(
      screen.getByRole('button', { name: /Add your own input/ }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Approve all' })).toBeDisabled()
    expect(within(card).getByRole('checkbox', { name: 'Required' })).toBeDisabled()
    expect(within(card).getByRole('button', { name: 'Approve' })).toBeDisabled()
    expect(within(card).getByRole('button', { name: 'Exclude' })).toBeDisabled()
    expect(within(card).getByRole('button', { name: 'Edit' })).toBeDisabled()
    expect(within(card).getByRole('button', { name: 'Remove Recipient' })).toBeDisabled()
  })
})
