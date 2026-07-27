const AGENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function frontendArchiveFilename(agentId, version) {
  if (
    !AGENT_ID_PATTERN.test(agentId)
    || !Number.isInteger(version)
    || version < 1
  ) {
    throw new Error('Cannot construct a safe frontend archive filename.')
  }
  return `${agentId}-frontend-v${version}.zip`
}

export function saveFrontendArchive(archive, agentId, version) {
  const filename = frontendArchiveFilename(agentId, version)
  let objectUrl = ''
  let link = null
  try {
    objectUrl = URL.createObjectURL(archive)
    link = document.createElement('a')
    link.href = objectUrl
    link.download = filename
    link.hidden = true
    document.body.appendChild(link)
    link.click()
  } finally {
    link?.remove()
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}
