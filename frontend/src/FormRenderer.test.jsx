import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FormRenderer from './FormRenderer.jsx'
import { toUiSchema } from './manifestLayout.js'

describe('FormRenderer', () => {
  it('renders data-url inputs as accessible file drop areas', () => {
    const manifest = {
      input_schema: {
        type: 'object',
        properties: {
          reference_file: {
            type: 'string',
            format: 'data-url',
            title: 'Reference file',
            description: 'Upload the source material for the agent.',
          },
        },
        required: ['reference_file'],
      },
      ui_hints: {
        mode: 'single',
        field_order: ['reference_file'],
      },
    }

    render(
      <FormRenderer
        schema={manifest.input_schema}
        uiSchema={toUiSchema(manifest)}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByLabelText(/Reference file/)).toHaveAttribute('type', 'file')
    expect(screen.getByText('Choose or drop a file')).toBeInTheDocument()
    expect(screen.getByText('Upload the source material for the agent.')).toBeInTheDocument()
  })
})
