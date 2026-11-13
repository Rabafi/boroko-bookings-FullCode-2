// @ts-check

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const AMOUNT = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const centsText = (value) => {
  const text = String(value ?? '').trim()
  if (!AMOUNT.test(text)) throw new Error('Enter amounts with no more than two decimal places and no negative values.')
  const [whole, fraction = ''] = text.split('.')
  return `${whole}.${fraction.padEnd(2, '0')}`
}
const exactCents = (value) => {
  const [whole, fraction] = centsText(value).split('.')
  return BigInt(whole) * 100n + BigInt(fraction)
}

/** Local adapter for the original Accounting Pro payroll page. */
export function createBarLocalPayrollApi(bridge, expectedScope) {
  const scope = {
    business_id: String(expectedScope?.businessId || ''),
    outlet_id: String(expectedScope?.outletId || ''),
    actor_staff_id: String(expectedScope?.staffId || '')
  }
  if (!bridge || typeof bridge.query !== 'function' || typeof bridge.command !== 'function'
    || Object.values(scope).some((value) => !UUID.test(value))) {
    throw new Error('Local payroll needs a verified Bar, outlet and staff session. Sign in again before continuing.')
  }
  const prefix = `bar-local:payroll:${scope.business_id}:${scope.outlet_id}:${scope.actor_staff_id}:`

  const assertScope = (result) => {
    if (!isRecord(result?.scope) || result.scope.business_id !== scope.business_id
      || result.scope.outlet_id !== scope.outlet_id || result.scope.actor_staff_id !== scope.actor_staff_id) {
      throw new Error('Local payroll data belongs to a different Bar session or outlet. No hosted data was used.')
    }
    if (result.complete !== true || !Array.isArray(result.data) || !Array.isArray(result.unavailable)
      || result.unavailable.length !== 0 || !Number.isSafeInteger(result.snapshot_watermark)
      || result.snapshot_watermark < 0 || typeof result.pagination?.has_more !== 'boolean') {
      throw new Error('The local payroll result is incomplete. Refresh before relying on it.')
    }
  }
  const validRun = (row) => isRecord(row) && UUID.test(String(row.id || ''))
    && ['draft', 'prepared', 'finalised'].includes(row.status)
    && Number.isSafeInteger(row.version) && row.version >= 1
    && DATE.test(String(row.period_start || '')) && DATE.test(String(row.period_end || ''))
    && DATE.test(String(row.pay_date || '')) && row.period_end >= row.period_start && row.pay_date >= row.period_end
    && ['gross_total', 'deductions_total', 'net_total'].every((key) => /^\d+(?:\.\d{1,2})$/.test(String(row[key])))
    && row.payment_status === 'external_required' && row.filing_status === 'external_required'
    && (row.snapshot_hash === null || /^[a-f0-9]{64}$/.test(String(row.snapshot_hash)))
    && (row.journal_entry_id === null || UUID.test(String(row.journal_entry_id)))
  const pages = async (query, filters) => {
    const rows = [], ids = new Set(), cursors = new Set()
    let cursor = null, watermark = null
    for (let page = 0; page < 100; page += 1) {
      const result = await bridge.query(query, { ...filters, limit: 200, ...(cursor ? { cursor } : {}) })
      assertScope(result)
      if (watermark !== null && result.snapshot_watermark !== watermark) throw new Error('Local accounting changed while payroll was loading. Refresh before relying on it.')
      watermark = result.snapshot_watermark
      for (const row of result.data) {
        const id = row?.id ?? row?.account_code
        if (typeof id !== 'string' || !id || ids.has(id)) throw new Error('The local payroll snapshot contains an invalid or duplicated row.')
        ids.add(id); rows.push(row)
      }
      if (!result.pagination.has_more) return { rows, watermark }
      cursor = result.pagination.next_cursor
      if (typeof cursor !== 'string' || !cursor || cursors.has(cursor) || result.data.length === 0) throw new Error('Local payroll pagination is invalid. Refresh before relying on it.')
      cursors.add(cursor)
    }
    throw new Error('The local payroll snapshot exceeds the safe loading limit.')
  }
  const storageKey = (operationKey) => `${prefix}${operationKey}`
  const readSaved = (storage, key) => {
    try {
      const value = JSON.parse(storage?.getItem(key) || 'null')
      if (value === null) return null
      if (!isRecord(value) || !UUID.test(String(value.operation_id || '')) || typeof value.command !== 'string'
        || !isRecord(value.payload) || typeof value.operation_key !== 'string') throw new Error()
      return value
    } catch {
      throw new Error('Saved payroll recovery data is unreadable. Stop and contact support before starting another payroll operation.')
    }
  }
  const pending = (storage) => {
    if (!storage || typeof storage.length !== 'number' || typeof storage.key !== 'function') return null
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (typeof key === 'string' && key.startsWith(prefix)) {
        return readSaved(storage, key) ? { key, ...readSaved(storage, key) } : null
      }
    }
    return null
  }
  const checkOpen = async (operationId, expectedCommand) => {
    if (typeof bridge.getOpenIntents !== 'function' || typeof bridge.retryOperation !== 'function') {
      throw new Error('Local payroll recovery is unavailable. No change was submitted.')
    }
    const open = await bridge.getOpenIntents()
    if (!Array.isArray(open)) throw new Error('The local operation journal could not be checked. No payroll change was submitted.')
    const same = open.find((item) => item?.operation_id === operationId)
    if (same) {
      if (same.command !== expectedCommand) throw new Error('The saved local operation does not match this payroll action. Contact support before continuing.')
    } else if (open.length) {
      throw new Error('Resolve the existing local operation before starting another payroll change.')
    }
    return Boolean(same)
  }
  const dispatch = async (storage, operationKey, command, payload, pin = '') => {
    if (!/^[a-z0-9][a-z0-9:_-]{0,160}$/i.test(operationKey)) throw new Error('The local payroll operation key is invalid.')
    const key = storageKey(operationKey)
    let saved = readSaved(storage, key)
    if (saved && (saved.command !== command || saved.operation_key !== operationKey
      || JSON.stringify(saved.base_payload) !== JSON.stringify(payload))) {
      throw new Error('A saved payroll operation has different details. Retry the original operation before changing anything.')
    }
    const other = pending(storage)
    if (other && other.key !== key) throw new Error('A different payroll operation is unresolved. Retry it before starting another change.')
    if (!saved) {
      const operation_id = globalThis.crypto?.randomUUID?.()
      if (!UUID.test(String(operation_id || ''))) throw new Error('A stable local operation ID could not be created. No payroll change was submitted.')
      saved = { command, operation_id, operation_key: operationKey, base_payload: payload, payload }
      try { storage.setItem(key, JSON.stringify(saved)) } catch { throw new Error('Payroll could not be saved for safe retry. Nothing was submitted.') }
    }
    const alreadyOpen = await checkOpen(saved.operation_id, command)
    if (alreadyOpen) {
      const result = await bridge.retryOperation(saved.operation_id)
      if (['committed_local', 'refused'].includes(result?.outcome)) storage.removeItem(key)
      if (result?.outcome === 'committed_local' || result?.outcome === 'refused') return result
      throw new Error('The payroll result remains unresolved. Retry this same saved operation before continuing.')
    }
    if (command === 'accounting.payroll_run.finalise') {
      if (!saved.approval_id) {
        if (!/^\d{4,12}$/.test(String(pin || ''))) throw new Error('Enter an authorized different manager PIN. No payroll run was finalised.')
        if (typeof bridge.requestApprovalForCommand !== 'function') throw new Error('Manager approval is unavailable. No payroll run was finalised.')
        const approval = await bridge.requestApprovalForCommand({ command, payload, pin: String(pin), operation_id: saved.operation_id })
        if (!UUID.test(String(approval?.approval_id || ''))) throw new Error('Manager approval was not confirmed. The saved finalisation remains available for retry.')
        saved = { ...saved, approval_id: approval.approval_id, payload: { ...payload, approval_id: approval.approval_id } }
        try { storage.setItem(key, JSON.stringify(saved)) } catch { throw new Error('The approval could not be saved for safe recovery. The payroll command was not submitted.') }
      }
    }
    const commandPayload = command === 'accounting.payroll_run.finalise' ? saved.payload : payload
    const result = await bridge.command({ command, payload: commandPayload, operation_id: saved.operation_id })
    if (['committed_local', 'refused'].includes(result?.outcome)) storage.removeItem(key)
    if (result?.outcome === 'committed_local' || result?.outcome === 'refused') return result
    throw new Error('The local payroll result is unresolved. Retry the same saved operation before starting another.')
  }

  return {
    async load() {
      const [runs, accounts] = await Promise.all([
        pages('accounting.records', { kind: 'payroll_runs' }),
        pages('accounting.accounts.list', { include_inactive: false })
      ])
      if (runs.watermark !== accounts.watermark) throw new Error('Local accounting changed while payroll was loading. Refresh before relying on the snapshot.')
      if (runs.rows.some((row) => !validRun(row))) throw new Error('The local payroll list contains an invalid or unsupported run.')
      if (accounts.rows.some((row) => typeof row.account_code !== 'string' || !row.account_code
        || typeof row.name !== 'string' || !['asset', 'liability', 'equity', 'revenue', 'expense'].includes(row.type)
        || row.active !== true || !Number.isSafeInteger(row.version))) throw new Error('The local chart of accounts is invalid for payroll.')
      return { runs: runs.rows, accounts: accounts.rows, snapshot_watermark: runs.watermark }
    },
    async getRun(runId, expectedWatermark) {
      if (!UUID.test(String(runId || ''))) throw new Error('Select a valid local payroll run.')
      const result = await bridge.query('accounting.records', { kind: 'payroll_runs', record_id: runId, limit: 1 })
      assertScope(result)
      if (result.snapshot_watermark !== expectedWatermark || result.data.length !== 1
        || result.data[0]?.id !== runId || !validRun(result.data[0]) || !Array.isArray(result.data[0].lines)) {
        throw new Error('The payroll detail changed or is incomplete. Refresh before reviewing the run.')
      }
      const lines = result.data[0].lines
      if (lines.some((line) => !isRecord(line) || typeof line.employee_ref !== 'string'
        || !line.employee_ref || !/^\d+(?:\.\d{1,2})$/.test(String(line.gross))
        || !/^\d+(?:\.\d{1,2})$/.test(String(line.deductions))
        || !/^\d+(?:\.\d{1,2})$/.test(String(line.net)))) {
        throw new Error('The local payroll detail contains an invalid line. Do not prepare or finalise it.')
      }
      return result.data[0]
    },
    create(storage, input) {
      const start = String(input?.period_start || ''), end = String(input?.period_end || ''), payDate = String(input?.pay_date || '')
      if (!DATE.test(start) || !DATE.test(end) || !DATE.test(payDate) || end < start || payDate < end) throw new Error('Choose payroll dates in order: start, period end, then pay date.')
      const lines = Array.isArray(input?.lines) ? input.lines.map((line) => ({
        employee_ref: String(line?.employee_ref || '').trim(), gross: centsText(line?.gross), deductions: centsText(line?.deductions)
      })) : []
      if (!lines.length || lines.length > 500 || lines.some((line) => !line.employee_ref || line.employee_ref.length > 64
        || exactCents(line.gross) <= 0n || exactCents(line.deductions) > exactCents(line.gross)) || new Set(lines.map((line) => line.employee_ref)).size !== lines.length) {
        throw new Error('Add unique opaque employee references with positive gross amounts and deductions no greater than gross.')
      }
      const payload = {
        period_start: start, period_end: end, pay_date: payDate,
        expense_account_code: String(input?.expense_account_code || ''),
        payable_account_code: String(input?.payable_account_code || ''),
        deductions_account_code: String(input?.deductions_account_code || '') || null,
        lines
      }
      if (!payload.expense_account_code || !payload.payable_account_code || payload.expense_account_code === payload.payable_account_code) throw new Error('Choose separate active expense and payable accounts.')
      return dispatch(storage, 'create', 'accounting.payroll_run.create', payload)
    },
    prepare(storage, run) {
      if (!validRun(run) || run.status !== 'draft') throw new Error('Refresh and select a current draft before preparing payroll.')
      return dispatch(storage, `prepare:${run.id}:v${run.version}`, 'accounting.payroll_run.prepare', {
        payroll_run_id: run.id, expected_version: run.version
      })
    },
    finalise(storage, run, pin) {
      if (!validRun(run) || run.status !== 'prepared' || !run.snapshot_hash) throw new Error('Refresh and select a prepared snapshot before finalising payroll.')
      return dispatch(storage, `finalise:${run.id}:v${run.version}`, 'accounting.payroll_run.finalise', {
        payroll_run_id: run.id, expected_version: run.version
      }, pin)
    },
    pending(storage) { return pending(storage) },
    async retry(storage, pin) {
      const saved = pending(storage)
      if (!saved) throw new Error('There is no saved payroll operation to retry.')
      return dispatch(storage, saved.operation_key, saved.command, saved.base_payload, pin)
    }
  }
}
