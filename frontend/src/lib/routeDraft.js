const PREVIEW_DRAFT_KEY = 'agent-screen-studio.preview-draft.v1'

function getStorage() {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function isPreviewDraft(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      value.manifest?.input_schema?.properties &&
      value.manifest?.ui_hints,
  )
}

export function savePreviewDraft(draft) {
  const storage = getStorage()
  if (!storage || !isPreviewDraft(draft)) return false
  try {
    storage.setItem(PREVIEW_DRAFT_KEY, JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}

export function loadPreviewDraft() {
  const storage = getStorage()
  if (!storage) return null
  try {
    const raw = storage.getItem(PREVIEW_DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return isPreviewDraft(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function clearPreviewDraft() {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.removeItem(PREVIEW_DRAFT_KEY)
  } catch {
    // Storage can be unavailable in locked-down browsers; there is no cleanup
    // action to take when removal itself is blocked.
  }
}
