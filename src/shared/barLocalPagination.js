// @ts-check

/**
 * Read a complete list without publishing partial, mixed-scope or mixed-version
 * data. A concurrent commit restarts the read once, then asks for a refresh.
 * @param {(name: string, filters: Record<string, unknown>) => Promise<{ data: unknown, complete?: boolean, scope?: Record<string, unknown>, snapshot_watermark?: number, pagination?: { has_more?: boolean, next_cursor?: string|null } }>} query
 * @param {string} name
 * @param {Record<string, unknown>} [filters]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function loadCompleteBarList(query, name, filters = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    /** @type {Record<string, unknown>[]} */
    const rows = []
    const cursors = new Set()
    let cursor = null
    let watermark = null
    let scope = null
    let changed = false
    for (let page = 0; page < 1000; page += 1) {
      const result = await query(name, { ...filters, limit: 200, ...(cursor ? { cursor } : {}) })
      if (result?.complete !== true || !Array.isArray(result.data) ||
          !result.scope?.business_id || !result.scope.outlet_id ||
          !Number.isSafeInteger(result.snapshot_watermark)) {
        throw new Error('The local list is incomplete or cannot be verified. Refresh before relying on it.')
      }
      const currentScope = JSON.stringify([result.scope.business_id, result.scope.outlet_id, result.scope.device_id, result.scope.actor_staff_id])
      if (scope !== null && currentScope !== scope) throw new Error('The local list changed business or operator. Sign in again before continuing.')
      if (watermark !== null && watermark !== result.snapshot_watermark) { changed = true; break }
      scope = currentScope
      watermark = result.snapshot_watermark
      for (const row of result.data) {
        if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new Error('The local list contains an invalid record. Refresh it.')
        rows.push(row)
      }
      if (result.pagination?.has_more === false) return rows
      const next = result.pagination?.next_cursor
      if (typeof next !== 'string' || !next || cursors.has(next) || result.data.length === 0) {
        throw new Error('The local list could not finish loading. Refresh it; no partial list has been accepted.')
      }
      cursors.add(next)
      cursor = next
    }
    if (!changed) throw new Error('The local list exceeds the safe loading limit. Use a scoped export.')
  }
  throw new Error('Local records changed while loading. Refresh the list before continuing.')
}
