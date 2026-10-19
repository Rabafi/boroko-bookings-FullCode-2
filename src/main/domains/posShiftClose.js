// @ts-check

/** @typedef {Record<string, unknown> & { id?: unknown, idempotency_key?: unknown }} ShiftCloseCashup */
/**
 * The fields consumed here mirror the JSON object returned by
 * `get_pos_shift_close_resolution` (see
 * `supabase/migrations/20260806100000_authoritative_pos_shift_close_resolution.sql`).
 * This is an expected wire shape, not runtime validation; callers receive raw
 * JSONB and this classifier keeps its existing fail-closed checks.
 * @typedef {Record<string, unknown> & {
 *   exists?: unknown,
 *   status?: unknown,
 *   finalized?: unknown,
 *   close_idempotency_key?: unknown,
 *   shift?: Record<string, unknown> | null,
 *   cashup_session?: ShiftCloseCashup | null,
 *   cashup?: ShiftCloseCashup | null
 * }} ShiftCloseResolution
 */

const CLOSED_STATUSES = new Set(['closed'])
const INVALID_STATUSES = new Set(['missing', 'locked', 'void', 'voided', 'unknown', ''])

// This is deliberately a pure classifier so the close domain and its tests
// share the same fail-closed evidence rules without treating cache state as
// proof of financial finalization.
/**
 * @param {ShiftCloseResolution | null | undefined} resolution
 * @param {string | null} [expectedIdempotencyKey]
 */
export function classifyAuthoritativeShiftClose(resolution, expectedIdempotencyKey = null) {
  const status = String(resolution?.status || resolution?.shift?.status || '').trim().toLowerCase()
  if (resolution?.exists !== true) {
    return { success: false, code: 'shift_missing', error: 'The Till shift was not found on the server. Manager review is required.' }
  }
  if (INVALID_STATUSES.has(status) || !CLOSED_STATUSES.has(status)) {
    return { success: false, code: status === 'open' ? 'shift_not_closed' : 'shift_close_unresolved', error: 'The server has not confirmed a valid finalized close for this Till shift. Keep it open and ask a manager to review.' }
  }
  const cashup = resolution.cashup_session || resolution.cashup || null
  const cashupKey = String(cashup?.idempotency_key || '').trim()
  const shiftKey = String(resolution?.shift?.close_idempotency_key || resolution?.close_idempotency_key || '').trim()
  const expectedKey = String(expectedIdempotencyKey || '').trim()
  const keyMatches = Boolean(cashup?.id && cashupKey && (!expectedKey || cashupKey === expectedKey) && (!shiftKey || shiftKey === cashupKey))
  if (!keyMatches || resolution.finalized !== true) {
    return { success: false, code: 'shift_close_evidence_missing', error: 'The shift appears closed but matching cash-up finalization evidence is missing. Manager review is required.' }
  }
  // keyMatches includes a truthy cashup?.id check before this success branch.
  const finalizedCashup = /** @type {ShiftCloseCashup} */ (cashup);
  return {
    success: true,
    already_closed: true,
    shift: resolution.shift || null,
    cashup_id: finalizedCashup.id,
    close_idempotency_key: cashupKey,
    cashup_session: finalizedCashup
  }
}
