import { describe, expect, it } from 'vitest'
import {
  REVIEW_STATUS,
  approveAllFields,
  buildApprovedManifest,
  canContinueReview,
  createReviewDraft,
  deleteField,
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

describe('review draft lifecycle', () => {
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

  it('requires every field decision and at least one approval', () => {
    let draft = createReviewDraft(wizardManifest)
    draft = setFieldStatus(draft, 'to', REVIEW_STATUS.APPROVED)
    draft = setFieldStatus(draft, 'subject', REVIEW_STATUS.REJECTED)

    expect(canContinueReview(draft)).toBe(false)
    expect(() => buildApprovedManifest(draft)).toThrow(/every suggested input/i)

    draft = setFieldStatus(draft, 'body', REVIEW_STATUS.REJECTED)
    draft = setFieldStatus(draft, 'send_at', REVIEW_STATUS.REJECTED)
    expect(canContinueReview(draft)).toBe(true)
  })

  it('removes rejected fields from schema, required, order, and groups', () => {
    let draft = approveAllFields(createReviewDraft(wizardManifest))
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
    let draft = approveAllFields(createReviewDraft(wizardManifest))
    draft = setFieldStatus(draft, 'to', REVIEW_STATUS.REJECTED)
    draft = setFieldStatus(draft, 'send_at', REVIEW_STATUS.REJECTED)
    const approved = buildApprovedManifest(draft)

    expect(approved.ui_hints.mode).toBe('single')
    expect(approved.ui_hints).not.toHaveProperty('groups')
    expect(approved.ui_hints.field_order).toEqual(['subject', 'body'])
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

  it('rejects finalization when every field is excluded', () => {
    let draft = createReviewDraft(wizardManifest)
    for (const name of Object.keys(draft.fields)) {
      draft = setFieldStatus(draft, name, REVIEW_STATUS.REJECTED)
    }

    expect(canContinueReview(draft)).toBe(false)
    expect(() => buildApprovedManifest(draft)).toThrow(/at least one input/i)
  })
})
