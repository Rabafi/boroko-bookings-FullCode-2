// @ts-check

/**
 * @typedef {Record<string, unknown> & {
 *   row_count?: unknown,
 *   rowCount?: unknown,
 *   returned_count?: unknown,
 *   payload?: AccountingRowCountSource | null,
 *   data?: AccountingRowCountSource | null
 * }} AccountingRowCountSource
 */

/**
 * @param {AccountingRowCountSource | null | undefined} source
 * @returns {number}
 */
export function accountingExportRowCount(source) {
  const payload = source?.payload && typeof source.payload === 'object'
    ? source.payload
    : source?.data && typeof source.data === 'object'
      ? source.data
      : source
  const candidates = [source?.row_count, source?.rowCount, payload?.row_count, payload?.rowCount, payload?.returned_count]
  for (const value of candidates) {
    if (value === null || value === undefined || value === '') continue
    const count = Number(value)
    if (Number.isSafeInteger(count) && count >= 0) return count
  }
  for (const key of ['accounts', 'entries', 'bills', 'transactions', 'allocations', 'rows']) {
    if (Array.isArray(payload?.[key])) return payload[key].length
  }
  return 0
}
