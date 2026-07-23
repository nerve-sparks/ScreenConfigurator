import { describe, expect, it } from 'vitest'
import {
  REVIEW_STATUS,
  addContentBlock,
  addHumanField,
  approveAllFields,
  approveLayout,
  buildApprovedManifest,
  canContinueReview,
  createReviewDraft,
  deleteField,
  fieldNameFromLabel,
  orderedReviewFields,
  reviewProgress,
  setFieldRequired,
  setFieldStatus,
  updateFieldDefinition,
} from './reviewModel.js'

const wizardManifest = {
  input_schema: {
    type: 'object',
    properties: {
      to: { type: 'string', format: 'email', title: 'Recipient' },
      subject: { type: 'string', title: 'Subject' },
      body: { type: 'string', title: 'Message' },
      send_at: { type: 'string', format: 'date-time', title: 'Send at' },
    },
    required: ['to', 'subject', 'body'],
  },
  ui_hints: {
    mode: 'wizard',
    field_order: ['to', 'subject', 'body', 'send_at'],
    groups: [
      {
        id: 'recipient',
        title: 'Recipient',
        description: 'Choose the recipient.',
        fields: ['to'],
      },
      {
        id: 'message',
        title: 'Message',
        description: 'Write the message.',
        fields: ['subject', 'body'],
      },
      {
        id: 'delivery',
        title: 'Delivery',
        description: 'Choose when to send it.',
        fields: ['send_at'],
      },
    ],
  },
}

const singleManifest = {
  input_schema: wizardManifest.input_schema,
  ui_hints: {
    mode: 'single',
    field_order: ['to', 'subject', 'body', 'send_at'],
  },
}

describe('review draft lifecycle', () => {
  it('creates safe field names from user-facing labels', () => {
    expect(fieldNameFromLabel('Target Language')).toBe('target_language')
    expect(fieldNameFromLabel('  2nd Reviewer  ')).toBe('field_2nd_reviewer')
    expect(fieldNameFromLabel('Crème brûlée')).toBe('creme_brulee')
    expect(fieldNameFromLabel('---')).toBe('')
  })

  it('starts every LLM field as pending without mutating the manifest', () => {
    const draft = createReviewDraft(wizardManifest)

    expect(orderedReviewFields(draft).map((field) => field.name)).toEqual([
      'to',
      'subject',
      'body',
      'send_at',
    ])
    expect(reviewProgress(draft)).toEqual({
      total: 4,
      pending: 4,
      approved: 0,
      rejected: 0,
      deleted: 0,
    })
    expect(canContinueReview(draft)).toBe(false)
    expect(wizardManifest.input_schema.properties.to.title).toBe('Recipient')
  })

  it('can initialize saved fields as approved for the edit route', () => {
    const draft = createReviewDraft(wizardManifest, {
      status: REVIEW_STATUS.APPROVED,
      origin: 'saved',
    })

    expect(reviewProgress(draft)).toEqual({
      total: 4,
      pending: 0,
      approved: 4,
      rejected: 0,
      deleted: 0,
    })
    expect(orderedReviewFields(draft).every((field) => field.review.origin === 'saved')).toBe(true)
    expect(canContinueReview(draft)).toBe(true)
  })

  it('rejects an unsupported initial review status', () => {
    expect(() => createReviewDraft(wizardManifest, { status: 'unknown' })).toThrow(
      /valid initial review status/i,
    )
  })

  it('requires every field decision and at least one approval', () => {
    let draft = createReviewDraft(wizardManifest)
    draft = setFieldStatus(draft, 'to', REVIEW_STATUS.APPROVED)
    draft = setFieldStatus(draft, 'subject', REVIEW_STATUS.REJECTED)

    expect(canContinueReview(draft)).toBe(false)
    expect(() => buildApprovedManifest(draft)).toThrow(/every suggested input/i)

    draft = setFieldStatus(draft, 'body', REVIEW_STATUS.REJECTED)
    draft = setFieldStatus(draft, 'send_at', REVIEW_STATUS.REJECTED)
    expect(canContinueReview(draft)).toBe(false)
    draft = approveLayout(draft)
    expect(canContinueReview(draft)).toBe(true)
  })

  it('removes rejected fields from schema, required, order, and groups', () => {
    let draft = approveLayout(approveAllFields(createReviewDraft(wizardManifest)))
    draft = setFieldStatus(draft, 'subject', REVIEW_STATUS.REJECTED)
    const approved = buildApprovedManifest(draft)

    expect(Object.keys(approved.input_schema.properties)).toEqual([
      'to',
      'body',
      'send_at',
    ])
    expect(approved.input_schema.required).toEqual(['to', 'body'])
    expect(approved.ui_hints.field_order).toEqual(['to', 'body', 'send_at'])
    expect(approved.ui_hints.groups.map((group) => group.fields)).toEqual([
      ['to'],
      ['body'],
      ['send_at'],
    ])
  })

  it('converts a wizard to a single screen when fewer than two groups remain', () => {
    let draft = approveLayout(approveAllFields(createReviewDraft(wizardManifest)))
    draft = setFieldStatus(draft, 'to', REVIEW_STATUS.REJECTED)
    draft = setFieldStatus(draft, 'send_at', REVIEW_STATUS.REJECTED)
    const approved = buildApprovedManifest(draft)

    expect(approved.ui_hints.mode).toBe('single')
    expect(approved.ui_hints).not.toHaveProperty('groups')
    expect(approved.ui_hints.field_order).toEqual(['subject', 'body'])
    expect(approved.ui_hints.blocks.map((block) => block.field)).toEqual([
      'subject',
      'body',
    ])
  })

  it('retains human edits and marks the field approved and modified', () => {
    const draft = createReviewDraft(wizardManifest)
    const updated = updateFieldDefinition(draft, 'subject', {
      type: 'string',
      title: 'Campaign subject',
      description: 'Keep it concise.',
    })

    expect(updated.manifest.input_schema.properties.subject.title).toBe(
      'Campaign subject',
    )
    expect(updated.fields.subject).toEqual({
      status: REVIEW_STATUS.APPROVED,
      origin: 'llm',
      modified: true,
    })
    expect(draft.manifest.input_schema.properties.subject.title).toBe('Subject')
  })

  it('updates required state in field order and treats it as approval', () => {
    let draft = createReviewDraft(wizardManifest)
    draft = setFieldRequired(draft, 'send_at', true)
    draft = setFieldRequired(draft, 'subject', false)

    expect(draft.manifest.input_schema.required).toEqual(['to', 'body', 'send_at'])
    expect(draft.fields.send_at.modified).toBe(true)
    expect(draft.fields.send_at.status).toBe(REVIEW_STATUS.APPROVED)
  })

  it('deletes a field from the draft and records the explicit removal', () => {
    const draft = deleteField(createReviewDraft(wizardManifest), 'to')

    expect(draft.fields).not.toHaveProperty('to')
    expect(draft.manifest.input_schema.properties).not.toHaveProperty('to')
    expect(draft.deletedFields).toEqual([
      { name: 'to', title: 'Recipient', origin: 'llm' },
    ])
  })

  it('adds an approved, required human field to a review draft', () => {
    const draft = addHumanField(createReviewDraft(wizardManifest), {
      name: 'review_notes',
      definition: {
        type: 'string',
        title: 'Review notes',
        description: 'Anything else the reviewer should know.',
      },
      required: true,
      groupId: 'delivery',
    })

    expect(draft.manifest.input_schema.properties.review_notes).toEqual({
      type: 'string',
      title: 'Review notes',
      description: 'Anything else the reviewer should know.',
    })
    expect(draft.manifest.input_schema.required).toContain('review_notes')
    expect(draft.manifest.ui_hints.groups[2].fields).toEqual([
      'send_at',
      'review_notes',
    ])
    expect(draft.manifest.ui_hints.field_order).toEqual([
      'to',
      'subject',
      'body',
      'send_at',
      'review_notes',
    ])
    expect(
      draft.manifest.ui_hints.groups[2].blocks.at(-1),
    ).toMatchObject({ type: 'field', field: 'review_notes' })
    expect(draft.layoutApproved).toBe(false)
    expect(draft.fields.review_notes).toEqual({
      status: REVIEW_STATUS.APPROVED,
      origin: 'human',
      modified: true,
    })
  })

  it('appends a human field to a single-screen layout', () => {
    const draft = addHumanField(createReviewDraft(singleManifest), {
      name: 'tone',
      definition: { type: 'string', title: 'Tone' },
    })

    expect(draft.manifest.ui_hints.field_order).toEqual([
      'to',
      'subject',
      'body',
      'send_at',
      'tone',
    ])
    expect(draft.manifest.ui_hints).not.toHaveProperty('groups')
  })

  it('places a wizard field inside its chosen step without breaking order', () => {
    const draft = addHumanField(createReviewDraft(wizardManifest), {
      name: 'cc',
      definition: { type: 'string', format: 'email', title: 'CC' },
      groupId: 'recipient',
    })

    expect(draft.manifest.ui_hints.groups[0].fields).toEqual(['to', 'cc'])
    expect(draft.manifest.ui_hints.field_order).toEqual([
      'to',
      'cc',
      'subject',
      'body',
      'send_at',
    ])
  })

  it('rejects duplicate, unsafe, and unassigned human fields', () => {
    const draft = createReviewDraft(wizardManifest)
    const definition = { type: 'string', title: 'Custom input' }

    expect(() =>
      addHumanField(draft, {
        name: 'subject',
        definition,
        groupId: 'message',
      }),
    ).toThrow(/already exists/i)
    expect(() =>
      addHumanField(draft, {
        name: '__proto__',
        definition,
        groupId: 'message',
      }),
    ).toThrow(/field name of at most 64 characters/i)
    expect(() =>
      addHumanField(draft, {
        name: 'a'.repeat(65),
        definition,
        groupId: 'message',
      }),
    ).toThrow(/at most 64 characters/i)
    expect(() =>
      addHumanField(draft, {
        name: 'custom_input',
        definition,
        groupId: 'missing',
      }),
    ).toThrow(/valid wizard step/i)
    expect(draft.manifest.input_schema.properties).not.toHaveProperty(
      'custom_input',
    )
  })

  it('rejects finalization when every field is excluded', () => {
    let draft = createReviewDraft(wizardManifest)
    for (const name of Object.keys(draft.fields)) {
      draft = setFieldStatus(draft, name, REVIEW_STATUS.REJECTED)
    }

    expect(canContinueReview(draft)).toBe(false)
    expect(() => buildApprovedManifest(draft)).toThrow(/at least one input/i)
  })

  it('requires approval for an AI layout and resets it after a content change', () => {
    let draft = approveAllFields(createReviewDraft(singleManifest))

    expect(draft.layoutApproved).toBe(false)
    expect(() => buildApprovedManifest(draft)).toThrow(/content and layout/i)

    draft = approveLayout(draft)
    expect(canContinueReview(draft)).toBe(true)

    draft = addContentBlock(draft, 'heading')
    expect(draft.layoutApproved).toBe(false)
    expect(draft.manifest.ui_hints.blocks.at(-1)).toMatchObject({
      type: 'heading',
      text: 'New heading',
    })
  })
})
