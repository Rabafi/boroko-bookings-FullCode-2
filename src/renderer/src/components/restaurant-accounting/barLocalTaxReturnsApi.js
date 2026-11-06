// @ts-check

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Adapter for the existing Accounting Pro tax working-papers page. */
export function createBarLocalTaxReturnsApi(bridge, expectedScope) {
  const scope = {
    business_id: String(expectedScope?.businessId || ''),
    outlet_id: String(expectedScope?.outletId || ''),
    actor_staff_id: String(expectedScope?.staffId || '')
  }
  if (!bridge || typeof bridge.query !== 'function' || typeof bridge.command !== 'function'
    || Object.values(scope).some((value) => !UUID.test(value))) {
    throw new Error('Local tax working papers need a verified business, outlet and operator session.')
  }

  async function list(name, filters) {
    const rows = []
    const ids = new Set()
    const cursors = new Set()
    let cursor = null
    let watermark = null
    for (let page = 0; page < 100; page += 1) {
      const result = await bridge.query(name, { ...filters, limit: 200, ...(cursor ? { cursor } : {}) })
      if (!isRecord(result?.scope) || result.scope.business_id !== scope.business_id
        || result.scope.outlet_id !== scope.outlet_id || result.scope.actor_staff_id !== scope.actor_staff_id) {
        throw new Error('Local tax records belong to another Bar session. No hosted data was used.')
      }
      if (result.complete !== true || !Array.isArray(result.data) || !Array.isArray(result.unavailable)
        || result.unavailable.length !== 0 || !Number.isSafeInteger(result.snapshot_watermark)
        || typeof result.pagination?.has_more !== 'boolean') {
        throw new Error('The local tax snapshot is incomplete. Refresh before relying on it.')
      }
      if (watermark !== null && watermark !== result.snapshot_watermark) throw new Error('Local tax records changed while loading. Refresh before relying on them.')
      watermark = result.snapshot_watermark
      for (const row of result.data) {
        if (!isRecord(row) || !UUID.test(String(row.id || '')) || ids.has(row.id)) throw new Error('The local tax snapshot contains an invalid or duplicate record.')
        ids.add(row.id); rows.push(row)
      }
      if (!result.pagination.has_more) return { rows, watermark }
      cursor = result.pagination.next_cursor
      if (typeof cursor !== 'string' || !cursor || cursors.has(cursor) || result.data.length === 0) throw new Error('The local tax pagination is invalid. Refresh before relying on the list.')
      cursors.add(cursor)
    }
    throw new Error('The local tax snapshot exceeded its safe paging limit.')
  }

  return {
    async load() {
      const [codes, returns] = await Promise.all([
        list('accounting.records', { kind: 'tax_codes' }),
        list('accounting.records', { kind: 'tax_return_periods' })
      ])
      if (codes.watermark !== returns.watermark) throw new Error('Local accounting changed while tax records were loading. Refresh before relying on them.')
      for (const code of codes.rows) {
        if (typeof code.code !== 'string' || !code.code || typeof code.name !== 'string' || !code.name
          || typeof code.rate !== 'string' || !/^(?:0|1|0?\.\d{1,4})$/.test(code.rate)
          || typeof code.active !== 'boolean' || !Number.isSafeInteger(code.version) || code.version < 1) {
          throw new Error('The local tax-code list contains an invalid record.')
        }
      }
      for (const row of returns.rows) {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(row.period || ''))
          || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.period_start || ''))
          || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.period_end || ''))
          || row.status !== 'draft' || row.statutory_submission !== 'external_required'
          || !/^-?\d+(?:\.\d{1,2})?$/.test(String(row.output_tax))
          || !/^-?\d+(?:\.\d{1,2})?$/.test(String(row.input_tax))
          || !/^-?\d+(?:\.\d{1,2})?$/.test(String(row.net_due))
          || !/^[a-f0-9]{64}$/.test(String(row.snapshot_hash || ''))
          || !Number.isSafeInteger(row.revision) || row.revision < 1) {
          throw new Error('The local tax return list contains an invalid or unsupported record.')
        }
      }
      return { codes: codes.rows, returns: returns.rows, snapshot_watermark: codes.watermark }
    },
    async submit(command, payload, operationKey) {
      if (!['accounting.tax_code.upsert', 'accounting.tax_return.prepare'].includes(command)
        || !/^[a-z0-9][a-z0-9:_-]{0,180}$/i.test(String(operationKey || '')) || !isRecord(payload)) {
        throw new Error('The local tax operation is invalid and was not submitted.')
      }
      if (typeof bridge.getOpenIntents !== 'function' || typeof bridge.retryOperation !== 'function') throw new Error('Local tax operation recovery is unavailable. No change was submitted.')
      const storage = globalThis.localStorage
      if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') throw new Error('Durable local retry storage is unavailable. No tax change was submitted.')
      const key = `bar-local:tax:${scope.business_id}:${scope.actor_staff_id}:${operationKey}`
      let saved = null
      try { saved = JSON.parse(storage.getItem(key) || 'null') } catch { throw new Error('Saved tax recovery data could not be read. Stop before retrying this operation.') }
      if (saved && (saved.command !== command || JSON.stringify(saved.payload) !== JSON.stringify(payload)
        || !UUID.test(String(saved.operation_id || '')))) throw new Error('A saved tax operation has different details. Retry the original details before starting another change.')
      const open = await bridge.getOpenIntents()
      if (!Array.isArray(open)) throw new Error('The local operation journal could not be checked. No tax change was submitted.')
      const pending = saved && open.find((item) => item.operation_id === saved.operation_id)
      if (pending && pending.command !== command) throw new Error('The saved local operation does not match this tax action. Contact support before continuing.')
      if (!pending && open.length) throw new Error('Resolve the existing local operation before starting another tax change.')
      if (!saved) {
        const operation_id = globalThis.crypto?.randomUUID?.()
        if (!UUID.test(String(operation_id || ''))) throw new Error('A stable local operation ID could not be created. No tax change was submitted.')
        saved = { command, payload, operation_id }
        try { storage.setItem(key, JSON.stringify(saved)) } catch { throw new Error('The tax operation could not be saved for safe retry. No change was submitted.') }
      }
      const result = pending ? await bridge.retryOperation(saved.operation_id)
        : await bridge.command({ command, payload, operation_id: saved.operation_id })
      if (result?.outcome === 'committed_local' || result?.outcome === 'refused') storage.removeItem(key)
      if (!['committed_local', 'refused'].includes(result?.outcome)) throw new Error('The local tax result is unresolved. Retry the same saved action before continuing.')
      return result
    }
  }
}
