// @ts-check
/**
 * Pre-authorize shift resolution for Till-gated mutations.
 *
 * An interactive retry replays its original bytes, including a shift_id that
 * may have closed since the first attempt. The server-payload rewrite in
 * createPosOrder runs AFTER the Till session gate, so without a pre-check
 * rewrite every retry fails the shift comparison identically, the gate clears
 * the session, the Till re-prompts unlock, and the operator loops forever.
 *
 * resolveAuthorizeShiftId mirrors the queue-replay / retry reattribution
 * (resolveCurrentOpenShiftId) for the authorize check ONLY: amounts, waiter,
 * outlet and timestamps are untouched, the submit journal keeps the original
 * bytes (its digest is computed downstream on the unmodified payload), and
 * any doubt keeps the original shift (fail closed to the previous behavior).
 */
/** @param {{requestedShiftId?: unknown, outletId?: unknown, openShift?: unknown}} [options] */
export function resolveAuthorizeShiftId({ requestedShiftId = null, outletId = null, openShift = null } = {}) {
  const requested = String(requestedShiftId || '').trim()
  if (!requested) return requestedShiftId
  if (!openShift || typeof openShift !== 'object') return requestedShiftId
  // This projection mirrors the existing property reads; no row validation is implied.
  const openShiftFields = /** @type {Record<string, unknown>} */ (openShift)
  const openId = String(openShiftFields.id || openShiftFields.shift_id || '').trim()
  if (!openId || openId === requested) return requestedShiftId
  if (String(openShiftFields.status || 'open').toLowerCase() !== 'open') return requestedShiftId
  const openOutlet = openShiftFields.outlet_id ?? openShiftFields.outletId ?? null
  if (outletId && openOutlet && String(outletId) !== String(openOutlet)) return requestedShiftId
  return openId
}
