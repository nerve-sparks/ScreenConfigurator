import { describe, expect, it } from 'vitest'
import {
  LAYOUT_MODE,
  isWizardManifest,
  layoutModeFor,
  schemaForGroup,
  toUiSchema,
} from './manifestLayout.js'

const properties = {
  to: { type: 'string', title: 'Recipient' },
  subject: { type: 'string', title: 'Subject' },
  body: { type: 'string', title: 'Message' },
}

describe('layoutModeFor', () => {
  it('uses an explicit single-screen declaration', () => {
    const manifest = {
      ui_hints: {
        mode: 'single',
        groups: [{ fields: ['to'] }],
      },
    }

    expect(layoutModeFor(manifest)).toBe(LAYOUT_MODE.SINGLE)
    expect(isWizardManifest(manifest)).toBe(false)
  })

  it('uses an explicit wizard declaration when groups are present', () => {
    const manifest = {
      ui_hints: {
        mode: 'wizard',
        groups: [{ fields: ['to'] }],
      },
    }

    expect(layoutModeFor(manifest)).toBe(LAYOUT_MODE.WIZARD)
    expect(isWizardManifest(manifest)).toBe(true)
  })

  it('does not render an incomplete wizard declaration', () => {
    const manifest = { ui_hints: { mode: 'wizard' } }

    expect(layoutModeFor(manifest)).toBe(LAYOUT_MODE.WIZARD)
    expect(isWizardManifest(manifest)).toBe(false)
  })

  it('supports legacy saved manifests that only contain groups', () => {
    const manifest = { ui_hints: { groups: [{ fields: ['to'] }] } }

    expect(layoutModeFor(manifest)).toBe(LAYOUT_MODE.WIZARD)
    expect(isWizardManifest(manifest)).toBe(true)
  })

  it('defaults legacy manifests without groups to a single screen', () => {
    expect(layoutModeFor({ ui_hints: {} })).toBe(LAYOUT_MODE.SINGLE)
  })
})

describe('toUiSchema', () => {
  it('keeps known fields in order and drops unknown names', () => {
    const manifest = {
      input_schema: { properties },
      ui_hints: { field_order: ['subject', 'unknown', 'to', 'body'] },
    }

    expect(toUiSchema(manifest)).toEqual({
      'ui:order': ['subject', 'to', 'body', '*'],
    })
  })

  it('maps data-url fields to the polished file-drop widget', () => {
    const manifest = {
      input_schema: {
        properties: {
          attachment: {
            type: 'string',
            format: 'data-url',
            title: 'Attachment',
          },
        },
      },
      ui_hints: { field_order: ['attachment'] },
    }

    expect(toUiSchema(manifest)).toEqual({
      'ui:order': ['attachment', '*'],
      attachment: { 'ui:widget': 'FileWidget' },
    })
  })
})

describe('schemaForGroup', () => {
  it('selects group fields, filters required fields, and preserves metadata', () => {
    const inputSchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $defs: { shared: { type: 'string' } },
      type: 'object',
      properties,
      required: ['to', 'subject', 'body'],
    }

    expect(schemaForGroup(inputSchema, { fields: ['subject', 'body'] })).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $defs: { shared: { type: 'string' } },
      type: 'object',
      properties: {
        subject: properties.subject,
        body: properties.body,
      },
      required: ['subject', 'body'],
    })
  })
})
