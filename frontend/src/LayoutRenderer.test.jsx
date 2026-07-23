import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FormRenderer from './FormRenderer.jsx'

const schema = {
  type: 'object',
  properties: {
    name: { type: 'string', title: 'Your name' },
    email: { type: 'string', format: 'email', title: 'Email address' },
  },
  required: ['name'],
}

const blocks = [
  { id: 'intro-heading', type: 'heading', text: 'Before you begin', level: 2 },
  { id: 'intro-copy', type: 'paragraph', text: '<script>alert("no")</script>' },
  { id: 'field-name', type: 'field', field: 'name' },
  {
    id: 'contact-section',
    type: 'section',
    title: 'Contact',
    description: 'Used only for replies.',
    children: [
      {
        id: 'contact-note',
        type: 'callout',
        text: 'Double-check this address.',
        tone: 'warning',
      },
      { id: 'field-email', type: 'field', field: 'email' },
    ],
  },
]

describe('safe layout renderer', () => {
  it('interleaves controlled content and RJSF fields without executing text', () => {
    const { container } = render(
      <FormRenderer schema={schema} blocks={blocks} onSubmit={vi.fn()} />,
    )

    expect(screen.getByRole('heading', { level: 2, name: 'Before you begin' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Contact' })).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('Double-check this address.')
    expect(screen.getByLabelText(/Your name/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Email address/)).toBeInTheDocument()
    expect(screen.getByText('<script>alert("no")</script>')).toBeInTheDocument()
    expect(container.querySelector('script')).toBeNull()

    const heading = screen.getByText('Before you begin')
    const name = screen.getByLabelText(/Your name/)
    const contact = screen.getByText('Contact')
    expect(heading.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(name.compareDocumentPosition(contact) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('falls back to rendering an unplaced property for defensive compatibility', () => {
    render(
      <FormRenderer
        schema={schema}
        blocks={[{ id: 'field-name', type: 'field', field: 'name' }]}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByLabelText(/Your name/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Email address/)).toBeInTheDocument()
  })
})
