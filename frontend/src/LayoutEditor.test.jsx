import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import LayoutEditor from './LayoutEditor.jsx'
import {
  approveAllFields,
  createReviewDraft,
} from './reviewModel.js'

const manifest = {
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', title: 'Your name' },
    },
    required: ['name'],
  },
  ui_hints: {
    mode: 'single',
    field_order: ['name'],
    blocks: [
      { id: 'welcome-copy', type: 'paragraph', text: 'Tell us about yourself.' },
      { id: 'field-name', type: 'field', field: 'name' },
    ],
  },
}

const wizardManifest = {
  input_schema: {
    type: 'object',
    properties: {
      role: { type: 'string', title: 'Role' },
      resume: { type: 'string', title: 'Resume' },
    },
    required: ['role', 'resume'],
  },
  ui_hints: {
    mode: 'wizard',
    field_order: ['role', 'resume'],
    groups: [
      {
        id: 'role-details',
        title: 'Role details',
        description: 'Describe the role.',
        fields: ['role'],
        blocks: [
          { id: 'role-copy', type: 'paragraph', text: 'Start with the role.' },
          { id: 'field-role', type: 'field', field: 'role' },
        ],
      },
      {
        id: 'resume-details',
        title: 'Resume details',
        description: 'Add the resume.',
        fields: ['resume'],
        blocks: [
          { id: 'resume-copy', type: 'paragraph', text: 'Upload a current resume.' },
          { id: 'field-resume', type: 'field', field: 'resume' },
        ],
      },
    ],
  },
}

function Harness() {
  const [draft, setDraft] = useState(() =>
    approveAllFields(createReviewDraft(manifest)))
  return <LayoutEditor draft={draft} onChange={setDraft} />
}

function SynchronizedWizardHarness() {
  const [draft, setDraft] = useState(() =>
    approveAllFields(createReviewDraft(wizardManifest)))
  const [activeGroupId, setActiveGroupId] = useState('role-details')
  return (
    <>
      <button type="button" onClick={() => setActiveGroupId('resume-details')}>
        Select resume from canvas
      </button>
      <LayoutEditor
        draft={draft}
        onChange={setDraft}
        activeGroupId={activeGroupId}
        onActiveGroupChange={setActiveGroupId}
      />
    </>
  )
}

describe('LayoutEditor', () => {
  it('approves the complete layout and resets approval after a change', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    expect(screen.getByText('AI suggested')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Approve layout' }))
    expect(screen.getByText('Layout approved')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '+ Heading' }))
    expect(screen.getByText('AI suggested')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /New heading/ }))
    const headingInput = screen.getByLabelText('Heading text')
    await user.clear(headingInput)
    await user.type(headingInput, 'What we need')
    await user.click(screen.getByRole('button', { name: 'Save block' }))
    expect(screen.getByRole('button', { name: /What we need/ })).toBeInTheDocument()
  })

  it('does not expose independent removal for field blocks', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: /Your name/ }))
    expect(screen.getByText(/controlled by Input fields/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove block' })).not.toBeInTheDocument()
  })

  it('supports keyboard-operated block reordering and retains focus', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Approve layout' }))
    await user.click(screen.getByRole('button', { name: /Tell us about yourself/ }))
    const moveDown = screen.getByRole('button', { name: 'Move down' })
    moveDown.focus()
    await user.keyboard('{Enter}')

    expect(moveDown).toHaveFocus()
    expect(screen.getByText('AI suggested')).toBeInTheDocument()
    const cards = [...document.querySelectorAll('.layout-editor-card')]
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining('Your name'),
      expect.stringContaining('Tell us about yourself.'),
    ])
  })

  it('follows an externally selected wizard step and clears the previous inspector', async () => {
    const user = userEvent.setup()
    render(<SynchronizedWizardHarness />)

    await user.click(screen.getByRole('button', { name: /Start with the role/ }))
    expect(screen.getByDisplayValue('Start with the role.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Select resume from canvas' }))

    expect(
      screen.getByRole('tab', { name: 'Resume details' }),
    ).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'Resume details' })).toBeInTheDocument()
    expect(screen.getByText('No block selected')).toBeInTheDocument()
  })
})
