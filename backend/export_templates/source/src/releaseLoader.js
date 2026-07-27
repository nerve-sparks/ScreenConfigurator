import bundledRelease from './agent-release.json'

const EMBEDDED_RELEASE_ID = 'agent-release-data'

function decodeBase64Utf8(value) {
  const binary = globalThis.atob(value)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function loadAgentRelease() {
  const embedded = document.getElementById(EMBEDDED_RELEASE_ID)
  const encoded = embedded?.textContent?.trim()
  if (!encoded) return bundledRelease
  return JSON.parse(decodeBase64Utf8(encoded))
}
