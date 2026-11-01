// @ts-check
// Wording only. These functions never decide whether an action is permitted.

/** @param {unknown} error */
export function barLocalOperatorError(error) {
  const record = error && typeof error === 'object' ? /** @type {Record<string, unknown>} */ (error) : {}
  const code = typeof record.code === 'string' ? record.code : ''
  const raw = typeof record.message === 'string' ? record.message : ''
  const message = raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '').replace(/^Error:\s*/, '')
  if (record.outcomeUnknown === true || code === 'UNKNOWN_OUTCOME') {
    return 'This action may already be saved. Check the saved operation and retry that same operation; do not enter it again.'
  }
  if (['NETWORK_ERROR', 'REQUEST_TIMEOUT', 'SERVICE_UNAVAILABLE', 'ECONNREFUSED', 'ETIMEDOUT'].includes(code)
    || /^(?:fetch failed|failed to fetch|network error|network request failed)$/i.test(message)
    || /\b(?:ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ERR_CONNECTION_REFUSED)\b/.test(message)) {
    return 'Cannot reach the Bar server. Keep this sale open, check the local network and server PC, then check any saved operation before retrying.'
  }
  if (/permission denied for (?:table|schema|function)|syntax error at|relation .+ does not exist/i.test(message)) {
    return 'The Bar server needs attention. Keep this sale open and ask a manager to check the server. Check saved operations before retrying.'
  }
  return message || 'This action could not be completed. Keep your work and check the Bar server or ask a manager for help.'
}

/** @param {string} state */
export function barLocalReadinessMessage(state) {
  if (state === 'ready') return 'Ready to sell · connected to the Bar server.'
  if (state === 'blocked') return 'Trading is paused. Ask a manager to check the Bar server before continuing.'
  if (state === 'unavailable') return 'Cannot reach the Bar server. Keep this sale open and check the local network and server PC.'
  if (state === 'stale') return 'Checking the Bar server. Keep this sale open; trading will resume after a successful check.'
  return 'Connecting to the Bar server. Please wait before selling.'
}

/** Presentation guard only; the service rechecks status, money and approval atomically.
 * @param {unknown} value
 */
export function canVoidRemainingBarSale(value) {
  if (!value || typeof value !== 'object') return false
  const sale = /** @type {Record<string, unknown>} */ (value)
  if (sale.original_sale_id) return false
  if (sale.status === 'completed') return true
  if (sale.status !== 'returned') return false
  if (Number(sale.tip) > 0) return true
  return Array.isArray(sale.lines) && sale.lines.some(line => Number(line?.remaining_quantity) > 0)
}

/** @param {unknown} value */
export function canReturnBarSaleLines(value) {
  if (!value || typeof value !== 'object') return false
  const sale = /** @type {Record<string, unknown>} */ (value)
  return !sale.original_sale_id && ['completed', 'returned'].includes(String(sale.status))
    && Array.isArray(sale.lines) && sale.lines.some(line => Number(line?.remaining_quantity) > 0)
}

/** Presentation helper only. The service rechecks the closed shift, original
 * receipt, remaining quantities, tip liability, period lock, drawer cash and
 * approval atomically before posting any compensation.
 * @param {unknown} value
 */
export function barSaleShiftIsClosed(value) {
  if (!value || typeof value !== 'object') return false
  return /** @type {Record<string, unknown>} */ (value).shift_status === 'closed'
}

/** @param {unknown} value */
export function canPostCloseCorrectBarSale(value) {
  if (!value || typeof value !== 'object') return false
  const sale = /** @type {Record<string, unknown>} */ (value)
  if (sale.original_sale_id || sale.shift_status !== 'closed') return false
  if (sale.post_close_eligible !== true || sale.status === 'voided') return false
  if (Number(sale.post_close_tip_remaining) > 0) return true
  return Array.isArray(sale.lines) && sale.lines.some(line => Number(line?.remaining_quantity) > 0)
}

/** @param {unknown} value */
export function canPostCloseReturnBarSaleLines(value) {
  if (!canPostCloseCorrectBarSale(value) || !value || typeof value !== 'object') return false
  const sale = /** @type {Record<string, unknown>} */ (value)
  return Array.isArray(sale.lines) && sale.lines.some(line => Number(line?.remaining_quantity) > 0)
}

/** @param {unknown} value */
export function barPostCloseCorrectionBlockedMessage(value) {
  if (!value || typeof value !== 'object') return 'Select a closed-day original sale before preparing a correction.'
  const sale = /** @type {Record<string, unknown>} */ (value)
  if (sale.original_sale_id) return 'This is already a correction receipt. Select the original sale; a correction cannot be corrected again.'
  if (sale.status === 'voided') return 'This sale is already cancelled. No further correction is needed.'
  if (sale.shift_status !== 'closed') return 'This sale still belongs to an open drawer. Use the normal return or void workflow.'
  if (sale.post_close_eligible !== true) return 'This closed receipt has no remaining items or unallocated tip to correct.'
  return ''
}

/** @param {unknown} quantity @param {unknown} remaining */
export function barReturnQuantityWithinRemaining(quantity, remaining) {
  const units = (/** @type {unknown} */ value) => {
    const text = String(value ?? '')
    if (!/^\d{1,12}(?:\.\d{1,6})?$/.test(text)) return null
    const [whole, fraction = ''] = text.split('.')
    return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'))
  }
  const requested = units(quantity), available = units(remaining)
  return requested !== null && available !== null && requested > 0n && requested <= available
}
