import { state } from '../state.js'

function requireOnline() {
  if (!state.isOnline) {
    throw new Error('Connect to the internet so this Starter action can be recorded in the authoritative audit trail.')
  }
  if (!state.supabase || !state.lodgeId) {
    throw new Error('An active lodge session is required before recording Starter audit evidence.')
  }
}

/**
 * Records a Starter backup/report artifact through the server-side append-only
 * audit RPC. The UI entitlement is deliberately not consulted here: recording
 * is universal, while viewing the audit remains a paid capability.
 */
export async function recordStarterArtifactAudit({ action, artifactId, metadata = {} } = {}) {
  requireOnline()
  const { data, error } = await state.supabase.rpc('record_starter_artifact_audit', {
    p_lodge_id: state.lodgeId,
    p_action: action,
    p_artifact_id: artifactId,
    p_metadata: metadata
  })
  if (error) throw new Error(error.message || 'Starter artifact audit could not be recorded.')
  if (data?.success === false) throw new Error(data.error || 'Starter artifact audit could not be recorded.')
  return data
}
