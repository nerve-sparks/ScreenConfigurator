import { describe, expect, it } from 'vitest'
import {
  convertWizardLayoutToSingle,
  createLayoutBlock,
  fieldNamesInBlocks,
  moveLayoutBlock,
  moveLayoutBlockTo,
  normalizeLayoutBlocks,
  pruneLayoutToFields,
  removeLayoutBlock,
} from './layoutBlocks.js'

const singleManifest = {
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', title: 'Name' },
      email: { type: 'string', title: 'Email' },
    },
    required: ['name'],
  },
  ui_hints: {
    mode: 'single',
    field_order: ['name', 'email'],
  },
}

const wizardManifest = {
  ...singleManifest,
  ui_hints: {
    mode: 'wizard',
    field_order: ['name', 'email'],
    groups: [
      {
        id: 'identity',
        title: 'Identity',
        description: 'Tell us who you are.',
        fields: ['name'],
      },
      {
        id: 'contact',
        title: 'Contact',
        description: 'Tell us how to reach you.',
        fields: ['email'],
      },
    ],
  },
}

describe('layout block helpers', () => {
  it('derives field-only blocks for legacy single and wizard manifests', () => {
    const single = normalizeLayoutBlocks(singleManifest)
    const wizard = normalizeLayoutBlocks(wizardManifest)

    expect(fieldNamesInBlocks(single.ui_hints.blocks)).toEqual(['name', 'email'])
    expect(wizard.ui_hints.groups.map((group) =>
      fieldNamesInBlocks(group.blocks))).toEqual([['name'], ['email']])
    expect(singleManifest.ui_hints).not.toHaveProperty('blocks')
    expect(wizardManifest.ui_hints.groups[0]).not.toHaveProperty('blocks')
  })

  it('creates valid, non-empty sections with safe unique block IDs', () => {
    const manifest = normalizeLayoutBlocks(singleManifest)
    const section = createLayoutBlock('section', manifest)

    expect(section.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    expect(section.id.length).toBeLessThanOrEqual(64)
    expect(section.children).toHaveLength(1)
    expect(section.children[0]).toMatchObject({ type: 'paragraph' })
    expect(section.children[0].id).not.toBe(section.id)
  })

  it('keeps field_order synchronized when blocks move into sections', () => {
    const manifest = normalizeLayoutBlocks(singleManifest)
    manifest.ui_hints.blocks.unshift({
      id: 'contact-section',
      type: 'section',
      title: 'Contact',
      children: [{
        id: 'contact-note',
        type: 'paragraph',
        text: 'Where should we reply?',
      }],
    })
    const emailBlock = manifest.ui_hints.blocks.find(
      (block) => block.type === 'field' && block.field === 'email',
    )
    const moved = moveLayoutBlockTo(manifest, emailBlock.id, 'contact-section')
    const reordered = moveLayoutBlock(
      moved,
      moved.ui_hints.blocks.find((block) => block.field === 'name').id,
      -1,
    )

    expect(fieldNamesInBlocks(
      moved.ui_hints.blocks.find((block) => block.id === 'contact-section').children,
    )).toEqual(['email'])
    expect(reordered.ui_hints.field_order).toEqual(['name', 'email'])
  })

  it('moves section children to the former root position when deleting a section', () => {
    const manifest = normalizeLayoutBlocks(singleManifest)
    manifest.ui_hints.blocks.splice(1, 0, {
      id: 'help-section',
      type: 'section',
      title: 'Helpful details',
      children: [
        { id: 'help-copy', type: 'paragraph', text: 'Use a work address.' },
        { id: 'help-rule', type: 'divider' },
      ],
    })

    const updated = removeLayoutBlock(manifest, 'help-section')

    expect(updated.ui_hints.blocks.map((block) => block.id)).toEqual([
      manifest.ui_hints.blocks[0].id,
      'help-copy',
      'help-rule',
      manifest.ui_hints.blocks[2].id,
    ])
  })

  it('prunes field blocks while retaining safe decorative content', () => {
    const manifest = normalizeLayoutBlocks(wizardManifest)
    manifest.ui_hints.groups[1].blocks.unshift({
      id: 'contact-heading',
      type: 'heading',
      text: 'Contact details',
      level: 2,
    })

    const pruned = pruneLayoutToFields(manifest, new Set(['email']))
    pruned.ui_hints.groups = [pruned.ui_hints.groups[1]]
    const single = convertWizardLayoutToSingle(pruned)

    expect(single.ui_hints.mode).toBe('single')
    expect(single.ui_hints.field_order).toEqual(['email'])
    expect(single.ui_hints.blocks.map((block) => block.id)).toContain('contact-heading')
  })
})
