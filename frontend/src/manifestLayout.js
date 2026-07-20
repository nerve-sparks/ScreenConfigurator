export const LAYOUT_MODE = Object.freeze({
  SINGLE: 'single',
  WIZARD: 'wizard',
})

/**
 * Return the manifest's declared layout mode.
 *
 * Manifests generated under the current contract always declare `mode`.
 * The groups fallback keeps previously saved manifests renderable while the
 * backend remains strict for all newly generated and newly saved manifests.
 */
export function layoutModeFor(manifest) {
  const mode = manifest?.ui_hints?.mode
  if (mode === LAYOUT_MODE.SINGLE || mode === LAYOUT_MODE.WIZARD) {
    return mode
  }

  const groups = manifest?.ui_hints?.groups
  return Array.isArray(groups) && groups.length > 0
    ? LAYOUT_MODE.WIZARD
    : LAYOUT_MODE.SINGLE
}

export function isWizardManifest(manifest) {
  const groups = manifest?.ui_hints?.groups
  return (
    layoutModeFor(manifest) === LAYOUT_MODE.WIZARD &&
    Array.isArray(groups) &&
    groups.length > 0
  )
}

/** Translate the manifest's global field ordering into an RJSF uiSchema. */
export function toUiSchema(manifest) {
  const order = manifest?.ui_hints?.field_order
  const properties = manifest?.input_schema?.properties
  if (!Array.isArray(order) || !properties) return undefined

  const known = order.filter((name) => Object.hasOwn(properties, name))
  if (known.length === 0) return undefined
  return { 'ui:order': [...known, '*'] }
}

/** Build the JSON Schema for one wizard group without dropping schema metadata. */
export function schemaForGroup(inputSchema, group) {
  const allProperties = inputSchema?.properties ?? {}
  const groupFields = Array.isArray(group?.fields) ? group.fields : []
  const properties = {}

  for (const name of groupFields) {
    if (Object.hasOwn(allProperties, name)) {
      properties[name] = allProperties[name]
    }
  }

  const required = (inputSchema?.required ?? []).filter((name) =>
    Object.hasOwn(properties, name),
  )

  return {
    ...inputSchema,
    type: 'object',
    properties,
    required,
  }
}
