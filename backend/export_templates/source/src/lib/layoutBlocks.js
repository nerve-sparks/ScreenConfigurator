const BLOCK_ID_PATTERN = /[^a-z0-9]+/g

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function fieldBlockId(fieldName, usedIds) {
  const safeName = String(fieldName)
    .toLowerCase()
    .replace(BLOCK_ID_PATTERN, '-')
    .replace(/^-+|-+$/g, '') || 'input'
  const base = `field-${safeName}`.slice(0, 64).replace(/-+$/g, '')
  let candidate = base
  let suffix = 2
  while (usedIds.has(candidate)) {
    const suffixText = `-${suffix}`
    candidate = `${base.slice(0, 64 - suffixText.length).replace(/-+$/g, '')}${suffixText}`
    suffix += 1
  }
  usedIds.add(candidate)
  return candidate
}

export function flattenBlocks(blocks = []) {
  return blocks.flatMap((block) => (
    block.type === 'section'
      ? [block, ...(block.children ?? [])]
      : [block]
  ))
}

export function fieldNamesInBlocks(blocks = []) {
  return flattenBlocks(blocks)
    .filter((block) => block.type === 'field')
    .map((block) => block.field)
}

export function layoutRoots(manifest) {
  const uiHints = manifest?.ui_hints
  if (!uiHints) return []
  if (uiHints.mode === 'wizard') {
    return (uiHints.groups ?? []).map((group) => ({
      groupId: group.id,
      label: group.title,
      blocks: group.blocks ?? [],
    }))
  }
  return [{
    groupId: null,
    label: 'Single screen',
    blocks: uiHints.blocks ?? [],
  }]
}

export function normalizeLayoutBlocks(manifest) {
  if (!manifest?.ui_hints) return manifest
  const normalized = clone(manifest)
  const usedIds = new Set(
    layoutRoots(normalized).flatMap((root) =>
      flattenBlocks(root.blocks).map((block) => block.id).filter(Boolean),
    ),
  )

  if (normalized.ui_hints.mode === 'wizard') {
    normalized.ui_hints.groups = (normalized.ui_hints.groups ?? []).map((group) => ({
      ...group,
      blocks: Array.isArray(group.blocks)
        ? group.blocks
        : (group.fields ?? []).map((field) => ({
            id: fieldBlockId(field, usedIds),
            type: 'field',
            field,
          })),
    }))
    delete normalized.ui_hints.blocks
  } else {
    normalized.ui_hints.blocks = Array.isArray(normalized.ui_hints.blocks)
      ? normalized.ui_hints.blocks
      : (normalized.ui_hints.field_order ?? []).map((field) => ({
          id: fieldBlockId(field, usedIds),
          type: 'field',
          field,
        }))
    delete normalized.ui_hints.groups
  }
  return normalized
}

function updateRoot(manifest, groupId, updater) {
  const next = clone(manifest)
  const updateBlocks = (blocks) => updater(blocks).filter(
    (block) => block.type !== 'section' || (block.children ?? []).length > 0,
  )
  if (next.ui_hints.mode === 'wizard') {
    next.ui_hints.groups = next.ui_hints.groups.map((group) => (
      group.id === groupId ? { ...group, blocks: updateBlocks(group.blocks ?? []) } : group
    ))
  } else {
    next.ui_hints.blocks = updateBlocks(next.ui_hints.blocks ?? [])
  }
  return next
}

function locateBlock(manifest, blockId) {
  for (const root of layoutRoots(manifest)) {
    const rootIndex = root.blocks.findIndex((block) => block.id === blockId)
    if (rootIndex >= 0) {
      return {
        groupId: root.groupId,
        sectionId: null,
        index: rootIndex,
        block: root.blocks[rootIndex],
      }
    }
    for (const section of root.blocks.filter((block) => block.type === 'section')) {
      const childIndex = (section.children ?? []).findIndex((block) => block.id === blockId)
      if (childIndex >= 0) {
        return {
          groupId: root.groupId,
          sectionId: section.id,
          index: childIndex,
          block: section.children[childIndex],
        }
      }
    }
  }
  return null
}

function updateContainer(blocks, sectionId, updater) {
  if (!sectionId) return updater(blocks)
  return blocks.map((block) => (
    block.id === sectionId && block.type === 'section'
      ? { ...block, children: updater(block.children ?? []) }
      : block
  ))
}

export function syncFieldOrder(manifest) {
  const next = clone(manifest)
  if (next.ui_hints.mode === 'wizard') {
    next.ui_hints.groups = next.ui_hints.groups.map((group) => ({
      ...group,
      fields: fieldNamesInBlocks(group.blocks),
    }))
    next.ui_hints.field_order = next.ui_hints.groups.flatMap((group) => group.fields)
  } else {
    next.ui_hints.field_order = fieldNamesInBlocks(next.ui_hints.blocks)
  }
  return next
}

export function createLayoutBlock(type, manifest) {
  const usedIds = new Set(
    layoutRoots(manifest).flatMap((root) =>
      flattenBlocks(root.blocks).map((block) => block.id),
    ),
  )
  const randomPart = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const base = `${type}-${randomPart}`
    .toLowerCase()
    .replace(BLOCK_ID_PATTERN, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  let id = base
  let suffix = 2
  while (usedIds.has(id)) {
    const suffixText = `-${suffix}`
    id = `${base.slice(0, 64 - suffixText.length).replace(/-+$/g, '')}${suffixText}`
    suffix += 1
  }

  if (type === 'heading') return { id, type, text: 'New heading', level: 2 }
  if (type === 'paragraph') return { id, type, text: 'Add helpful information here.' }
  if (type === 'divider') return { id, type }
  if (type === 'callout') {
    return { id, type, text: 'Add an important note here.', tone: 'information' }
  }
  if (type === 'section') {
    usedIds.add(id)
    const childBase = `${id.slice(0, 56).replace(/-+$/g, '')}-content`
    let childId = childBase
    let childSuffix = 2
    while (usedIds.has(childId)) {
      const suffixText = `-${childSuffix}`
      childId = `${childBase.slice(0, 64 - suffixText.length).replace(/-+$/g, '')}${suffixText}`
      childSuffix += 1
    }
    return {
      id,
      type,
      title: 'New section',
      children: [{
        id: childId,
        type: 'paragraph',
        text: 'Add helpful information here.',
      }],
    }
  }
  throw new Error('Choose a supported content block.')
}

export function addLayoutBlock(manifest, block, groupId = null) {
  return updateRoot(manifest, groupId, (blocks) => [...blocks, clone(block)])
}

export function updateLayoutBlock(manifest, blockId, changes) {
  const location = locateBlock(manifest, blockId)
  if (!location) return manifest
  return updateRoot(manifest, location.groupId, (blocks) =>
    updateContainer(blocks, location.sectionId, (container) =>
      container.map((block) => {
        if (block.id !== blockId) return block
        const updated = {
          ...block,
          ...clone(changes),
          id: block.id,
          type: block.type,
        }
        if (Object.hasOwn(changes, 'description') && !changes.description) {
          delete updated.description
        }
        return updated
      }),
    ),
  )
}

export function removeLayoutBlock(manifest, blockId) {
  const location = locateBlock(manifest, blockId)
  if (!location || location.block.type === 'field') return manifest
  return updateRoot(manifest, location.groupId, (blocks) => {
    if (!location.sectionId && location.block.type === 'section') {
      return blocks.flatMap((block) => (
        block.id === blockId ? (block.children ?? []) : [block]
      ))
    }
    return updateContainer(blocks, location.sectionId, (container) =>
      container.filter((block) => block.id !== blockId),
    )
  })
}

export function moveLayoutBlock(manifest, blockId, direction) {
  const location = locateBlock(manifest, blockId)
  if (!location || ![-1, 1].includes(direction)) return manifest
  const moved = updateRoot(manifest, location.groupId, (blocks) =>
    updateContainer(blocks, location.sectionId, (container) => {
      const destination = location.index + direction
      if (destination < 0 || destination >= container.length) return container
      const next = [...container]
      const [block] = next.splice(location.index, 1)
      next.splice(destination, 0, block)
      return next
    }),
  )
  return syncFieldOrder(moved)
}

export function moveLayoutBlockTo(manifest, blockId, sectionId) {
  const location = locateBlock(manifest, blockId)
  if (!location || location.block.type === 'section' || location.sectionId === sectionId) {
    return manifest
  }
  const root = layoutRoots(manifest).find((entry) => entry.groupId === location.groupId)
  if (sectionId && !root?.blocks.some(
    (block) => block.id === sectionId && block.type === 'section',
  )) {
    return manifest
  }

  const movedBlock = clone(location.block)
  let next = updateRoot(manifest, location.groupId, (blocks) =>
    updateContainer(blocks, location.sectionId, (container) =>
      container.filter((block) => block.id !== blockId),
    ),
  )
  next = updateRoot(next, location.groupId, (blocks) => {
    if (!sectionId) return [...blocks, movedBlock]
    return blocks.map((block) => (
      block.id === sectionId
        ? { ...block, children: [...(block.children ?? []), movedBlock] }
        : block
    ))
  })
  return syncFieldOrder(next)
}

export function appendFieldBlock(manifest, fieldName, groupId = null) {
  const next = normalizeLayoutBlocks(manifest)
  const usedIds = new Set(
    layoutRoots(next).flatMap((root) =>
      flattenBlocks(root.blocks).map((block) => block.id),
    ),
  )
  const block = {
    id: fieldBlockId(fieldName, usedIds),
    type: 'field',
    field: fieldName,
  }
  return syncFieldOrder(addLayoutBlock(next, block, groupId))
}

function pruneBlocks(blocks, includedFields) {
  return blocks.flatMap((block) => {
    if (block.type === 'field') {
      return includedFields.has(block.field) ? [block] : []
    }
    if (block.type !== 'section') return [block]
    const children = pruneBlocks(block.children ?? [], includedFields)
    return children.length > 0 ? [{ ...block, children }] : []
  })
}

export function pruneLayoutToFields(manifest, includedFields) {
  const next = normalizeLayoutBlocks(manifest)
  if (next.ui_hints.mode === 'wizard') {
    next.ui_hints.groups = next.ui_hints.groups.map((group) => ({
      ...group,
      blocks: pruneBlocks(group.blocks ?? [], includedFields),
    }))
  } else {
    next.ui_hints.blocks = pruneBlocks(next.ui_hints.blocks ?? [], includedFields)
  }
  return syncFieldOrder(next)
}

export function convertWizardLayoutToSingle(manifest) {
  const next = clone(manifest)
  if (next.ui_hints.mode !== 'wizard') return next
  next.ui_hints.blocks = (next.ui_hints.groups ?? []).flatMap(
    (group) => group.blocks ?? [],
  )
  next.ui_hints.mode = 'single'
  delete next.ui_hints.groups
  return syncFieldOrder(next)
}

export function layoutBlockById(manifest, blockId) {
  return locateBlock(manifest, blockId)?.block ?? null
}

export function blockLocation(manifest, blockId) {
  return locateBlock(manifest, blockId)
}
