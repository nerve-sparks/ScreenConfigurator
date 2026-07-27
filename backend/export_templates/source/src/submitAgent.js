/**
 * Integration hook for the exported frontend.
 *
 * The default implementation is deliberately local: it performs no logging,
 * persistence, webhook, or network request. Replace this function when the
 * frontend is integrated with an application backend.
 */
export async function submitAgent({
  agentId,
  releaseVersion,
  valuesByScreen,
}) {
  return {
    status: 'local',
    agentId,
    releaseVersion,
    valuesByScreen,
  }
}
