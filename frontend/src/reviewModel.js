export const REVIEW_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
})

const VALID_REVIEW_STATUSES = new Set(Object.values(REVIEW_STATUS))

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function propertyNamesInOrder(manifest) {
  const properties = manifest?.input_schema?.properties ?? {}
  const configuredOrder = manifest?.ui_hints?.field_order ?? []
  const ordered = configuredOrder.filter((name) =>
    Object.hasOwn(properties, name),
  )
  const seen = new Set(ordered)

  for (const name of Object.keys(properties)) {
    if (!seen.has(name)) ordered.push(name)
  }
  return ordered
}

export function createReviewDraft(manifest) {
  const copiedManifest = clone(manifest)
  const fields = {}

  for (const name of propertyNamesInOrder(copiedManifest)) {
    fields[name] = {
      status: REVIEW_STATUS.PENDING,
      origin: 'llm',
      modified: false,
    }
  }

  return {
    manifest: copiedManifest,
    fields,
    deletedFields: [],
  }
}

export function orderedReviewFields(draft) {
  if (!draft) return []
  const properties = draft.manifest?.input_schema?.properties ?? {}
  const required = new Set(draft.manifest?.input_schema?.required ?? [])

  return propertyNamesInOrder(draft.manifest)
    .filter((name) => Object.hasOwn(draft.fields, name))
    .map((name) => ({
      name,
      schema: properties[name],
      required: required.has(name),
      review: draft.fields[name],
    }))
}

export function reviewProgress(draft) {
  const progress = {
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    deleted: draft?.deletedFields?.length ?? 0,
  }

  for (const field of Object.values(draft?.fields ?? {})) {
    progress.total += 1
    if (field.status === REVIEW_STATUS.APPROVED) progress.approved += 1
    if (field.status === REVIEW_STATUS.REJECTED) progress.rejected += 1
    if (field.status === REVIEW_STATUS.PENDING) progress.pending += 1
  }
  return progress
}

export function canContinueReview(draft) {
  const progress = reviewProgress(draft)
  return progress.pending === 0 && progress.approved > 0
}

export function setFieldStatus(draft, name, status) {
  if (!draft?.fields?.[name] || !VALID_REVIEW_STATUSES.has(status)) {
    return draft
  }

  return {
    ...draft,
    fields: {
      ...draft.fields,
      [name]: {
        ...draft.fields[name],
        status,
      },
    },
  }
}

export function approveAllFields(draft) {
  if (!draft) return draft
  const fields = {}
  for (const [name, review] of Object.entries(draft.fields)) {
    fields[name] = { ...review, status: REVIEW_STATUS.APPROVED }
  }
  return { ...draft, fields }
}

function markFieldAsHumanEdited(draft, name) {
  return {
    ...draft,
    fields: {
      ...draft.fields,
      [name]: {
        ...draft.fields[name],
        status: REVIEW_STATUS.APPROVED,
        modified: true,
      },
    },
  }
}

export function updateFieldDefinition(draft, name, definition) {
  if (!draft?.fields?.[name] || !definition || typeof definition !== 'object') {
    return draft
  }

  const manifest = clone(draft.manifest)
  manifest.input_schema.properties[name] = clone(definition)
  return markFieldAsHumanEdited({ ...draft, manifest }, name)
}

export function setFieldRequired(draft, name, isRequired) {
  if (!draft?.fields?.[name]) return draft

  const manifest = clone(draft.manifest)
  const required = new Set(manifest.input_schema.required ?? [])
  if (isRequired) required.add(name)
  else required.delete(name)

  manifest.input_schema.required = propertyNamesInOrder(manifest).filter((field) =>
    required.has(field),
  )
  return markFieldAsHumanEdited({ ...draft, manifest }, name)
}

function pruneManifestToFields(manifest, includedFields) {
  const pruned = clone(manifest)
  const fieldOrder = propertyNamesInOrder(pruned).filter((name) =>
    includedFields.has(name),
  )
  const originalProperties = pruned.input_schema.properties
  const properties = {}

  for (const name of fieldOrder) {
    properties[name] = originalProperties[name]
  }

  pruned.input_schema.properties = properties
  pruned.input_schema.required = (pruned.input_schema.required ?? []).filter(
    (name) => includedFields.has(name),
  )
  pruned.ui_hints.field_order = fieldOrder

  if (pruned.ui_hints.fields && typeof pruned.ui_hints.fields === 'object') {
    pruned.ui_hints.fields = Object.fromEntries(
      Object.entries(pruned.ui_hints.fields).filter(([name]) =>
        includedFields.has(name),
      ),
    )
  }

  if (pruned.ui_hints.mode === 'wizard') {
    const groups = (pruned.ui_hints.groups ?? [])
      .map((group) => ({
        ...group,
        fields: group.fields.filter((name) => includedFields.has(name)),
      }))
      .filter((group) => group.fields.length > 0)

    if (groups.length >= 2) {
      pruned.ui_hints.groups = groups
    } else {
      pruned.ui_hints.mode = 'single'
      delete pruned.ui_hints.groups
    }
  } else {
    delete pruned.ui_hints.groups
  }

  return pruned
}

export function deleteField(draft, name) {
  const review = draft?.fields?.[name]
  const definition = draft?.manifest?.input_schema?.properties?.[name]
  if (!review || !definition) return draft

  const remainingFields = new Set(
    Object.keys(draft.fields).filter((fieldName) => fieldName !== name),
  )
  const manifest = pruneManifestToFields(draft.manifest, remainingFields)
  const fields = { ...draft.fields }
  delete fields[name]

  return {
    manifest,
    fields,
    deletedFields: [
      ...(draft.deletedFields ?? []),
      {
        name,
        title: definition.title ?? name,
        origin: review.origin,
      },
    ],
  }
}

export function buildApprovedManifest(draft) {
  if (!draft || reviewProgress(draft).pending > 0) {
    throw new Error('Every suggested input must be reviewed before preview.')
  }

  const approvedFields = new Set(
    Object.entries(draft.fields)
      .filter(([, review]) => review.status === REVIEW_STATUS.APPROVED)
      .map(([name]) => name),
  )
  if (approvedFields.size === 0) {
    throw new Error('Approve at least one input before preview.')
  }

  return pruneManifestToFields(draft.manifest, approvedFields)
}
