import { state } from '../state.js'
import { logActivity, refreshCache } from './infrastructure.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * @param {{p_lodge_id?: unknown, p_event_id?: unknown, p_original_payment_id?: unknown, p_duplicate_payment_id?: unknown, p_expected_amount?: unknown, p_reason?: unknown, p_idempotency_key?: unknown}|null|undefined} input
 */
export async function voidDuplicateEventPayment(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('A duplicate receipt correction request is required')
  if (!state.isOnline) throw new Error('Receipt corrections require an online, server-verified Lodge session')
  if (!state.currentUser?.id || !state.supabase) throw new Error('Sign in to the lodge before correcting a receipt')

  const lodgeId = String(input.p_lodge_id || '').trim().toLowerCase()
  const currentLodgeId = String(state.lodgeId || '').trim().toLowerCase()
  const eventId = String(input.p_event_id || '').trim().toLowerCase()
  const originalPaymentId = String(input.p_original_payment_id || '').trim().toLowerCase()
  const duplicatePaymentId = String(input.p_duplicate_payment_id || '').trim().toLowerCase()
  const expectedAmount = Number(input.p_expected_amount)
  const reason = String(input.p_reason || '').trim()
  const idempotencyKey = String(input.p_idempotency_key || '').trim()

  if (!lodgeId || lodgeId !== currentLodgeId) throw new Error('The correction lodge must match the signed-in lodge')
  if (![eventId, originalPaymentId, duplicatePaymentId].every((id) => UUID_PATTERN.test(id))) {
    throw new Error('Event and receipt IDs must be valid UUIDs')
  }
  if (originalPaymentId === duplicatePaymentId) throw new Error('The original receipt cannot be voided as its own duplicate')
  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0 || Math.abs(expectedAmount * 100 - Math.round(expectedAmount * 100)) > 1e-7) {
    throw new Error('Expected duplicate amount must be positive with at most two decimals')
  }
  if (reason.length < 8 || reason.length > 500) throw new Error('A correction reason of 8 to 500 characters is required')
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(idempotencyKey)) {
    throw new Error('A stable correction idempotency key is required')
  }

  const rpcArgs = {
    p_lodge_id: lodgeId,
    p_event_id: eventId,
    p_original_payment_id: originalPaymentId,
    p_duplicate_payment_id: duplicatePaymentId,
    p_expected_amount: Number(expectedAmount.toFixed(2)),
    p_reason: reason,
    p_idempotency_key: idempotencyKey
  }
  const { data, error } = await state.supabase.rpc('void_duplicate_event_payment', rpcArgs)
  if (error) throw error
  if (!data?.success) return data || { success: false, error: 'The server rejected this receipt correction' }

  await Promise.allSettled([refreshCache('conference-bookings'), refreshCache('bookings')])
  try { logActivity('event_duplicate_payment_voided', `Duplicate event receipt voided · ${rpcArgs.p_expected_amount.toFixed(2)} · ${idempotencyKey}`) } catch { /* server audit is authoritative */ }
  return { ...data, idempotency_key: idempotencyKey }
}