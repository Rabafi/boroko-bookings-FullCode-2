// @ts-check

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function cents(value, field) {
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(String(value))
  if (!match) throw new Error(`The local budget ${field} is invalid. Refresh before relying on the result.`)
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 100 + Number((match[3] || '').padEnd(2, '0') || 0))
}

/** Adapter for the established Accounting Pro budgets page. */
export function createBarLocalBudgetsApi(bridge, expectedScope) {
  const scope = {
    business_id: String(expectedScope?.businessId || ''),
    outlet_id: String(expectedScope?.outletId || ''),
    actor_staff_id: String(expectedScope?.staffId || '')
  }
  if (!bridge || typeof bridge.query !== 'function' || typeof bridge.command !== 'function'
    || Object.values(scope).some((value) => !UUID.test(value))) throw new Error('Local budgets need a verified business, outlet and operator session.')

  async function list(name, filters) {
    const rows = []
    const ids = new Set()
    const cursors = new Set()
    let cursor = null
    let watermark = null
    for (let page = 0; page < 100; page += 1) {
      const result = await bridge.query(name, { ...filters, limit: 200, ...(cursor ? { cursor } : {}) })
      if (!isRecord(result?.scope) || result.scope.business_id !== scope.business_id
        || result.scope.outlet_id !== scope.outlet_id || result.scope.actor_staff_id !== scope.actor_staff_id) throw new Error('Local budget data belongs to another Bar session. No hosted data was used.')
      if (result.complete !== true || !Array.isArray(result.data) || !Array.isArray(result.unavailable)
        || result.unavailable.length !== 0 || !Number.isSafeInteger(result.snapshot_watermark)
        || typeof result.pagination?.has_more !== 'boolean') throw new Error('The local budget snapshot is incomplete. Refresh before relying on it.')
      if (watermark !== null && watermark !== result.snapshot_watermark) throw new Error('Local budget data changed while loading. Refresh before relying on it.')
      watermark = result.snapshot_watermark
      for (const row of result.data) {
        const id = row?.id ?? row?.account_code
        if (!isRecord(row) || typeof id !== 'string' || !id || ids.has(id)) throw new Error('The local budget snapshot contains an invalid or duplicate record.')
        ids.add(id); rows.push(row)
      }
      if (!result.pagination.has_more) return { rows, watermark }
      cursor = result.pagination.next_cursor
      if (typeof cursor !== 'string' || !cursor || cursors.has(cursor) || result.data.length === 0) throw new Error('The local budget pagination is invalid. Refresh before relying on the list.')
      cursors.add(cursor)
    }
    throw new Error('The local budget snapshot exceeded its safe paging limit.')
  }

  function validateAccount(row) {
    if (!isRecord(row) || typeof row.account_code !== 'string' || typeof row.name !== 'string'
      || !['asset', 'liability', 'equity', 'revenue', 'expense'].includes(row.type)
      || typeof row.active !== 'boolean' || !Number.isSafeInteger(row.version) || row.version < 1) throw new Error('The local chart of accounts contains an invalid budget account.')
    return { code: row.account_code, name: row.name, type: row.type, active: row.active, version: row.version }
  }

  function validateBudget(row) {
    if (!isRecord(row) || !UUID.test(String(row.id || '')) || typeof row.name !== 'string' || !row.name
      || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.period_start || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.period_end || ''))
      || row.period_end < row.period_start || typeof row.active !== 'boolean' || !Number.isSafeInteger(row.version) || row.version < 1) throw new Error('The local budget list contains an invalid record.')
    return row
  }

  return {
    async load() {
      const [budgets, accounts] = await Promise.all([
        list('accounting.records', { kind: 'budgets' }),
        list('accounting.accounts.list', { include_inactive: true })
      ])
      if (budgets.watermark !== accounts.watermark) throw new Error('Local accounting changed while budgets were loading. Refresh before relying on them.')
      return { budgets: budgets.rows.map(validateBudget), accounts: accounts.rows.map(validateAccount), snapshot_watermark: budgets.watermark }
    },
    async loadBudget(budgetId) {
      if (!UUID.test(String(budgetId || ''))) throw new Error('Select a valid local budget before loading actuals.')
      const [detail, accounts] = await Promise.all([
        list('accounting.records', { kind: 'budgets', record_id: budgetId }),
        list('accounting.accounts.list', { include_inactive: true })
      ])
      if (detail.rows.length !== 1 || detail.rows[0].id !== budgetId) throw new Error('The selected budget is missing from this outlet. Refresh before continuing.')
      const budget = validateBudget(detail.rows[0])
      if (!Array.isArray(budget.lines) || !budget.lines.length || accounts.watermark !== detail.watermark) throw new Error('The selected budget detail is incomplete or changed while loading.')
      const accountMap = new Map(accounts.rows.map((row) => {
        const account = validateAccount(row)
        return [account.code, account]
      }))
      const lines = budget.lines.map((line) => {
        if (!isRecord(line) || typeof line.account_code !== 'string' || typeof line.amount !== 'string'
          || !accountMap.has(line.account_code) || cents(line.amount, 'amount') < 0) throw new Error('The selected budget contains an invalid or inactive account line.')
        return { account_code: line.account_code, amount: line.amount, description: String(line.description || '') }
      })
      const journals = await list('accounting.journal_entries', { from: budget.period_start, to: budget.period_end })
      if (journals.watermark !== detail.watermark) throw new Error('Local accounting changed while budget actuals were loading. Refresh before relying on the result.')
      const actuals = new Map()
      for (const entry of journals.rows) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(entry.entry_date || ''))
          || entry.entry_date < budget.period_start || entry.entry_date > budget.period_end || !Array.isArray(entry.lines)) throw new Error('The local journal snapshot is invalid for budget actuals.')
        for (const line of entry.lines) {
          if (!isRecord(line) || typeof line.account_code !== 'string') throw new Error('The local journal line is invalid for budget actuals.')
          const debit = cents(line.debit, 'journal debit'), credit = cents(line.credit, 'journal credit')
          const account = accountMap.get(line.account_code)
          if (!account) continue
          const signed = ['revenue', 'liability', 'equity'].includes(account.type) ? credit - debit : debit - credit
          actuals.set(account.code, (actuals.get(account.code) || 0) + signed)
        }
      }
      return { ...budget, lines: lines.map((line) => ({ ...line, account_name: accountMap.get(line.account_code).name,
        account_type: accountMap.get(line.account_code).type, actual_amount: ((actuals.get(line.account_code) || 0) / 100).toFixed(2),
        variance: (((actuals.get(line.account_code) || 0) - cents(line.amount, 'amount')) / 100).toFixed(2) })), snapshot_watermark: detail.watermark }
    },
    async submit(payload, operationKey) {
      if (!isRecord(payload) || !/^[a-z0-9][a-z0-9:_-]{0,180}$/i.test(String(operationKey || ''))
        || typeof payload.name !== 'string' || !payload.name.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(String(payload.period_start || ''))
        || !/^\d{4}-\d{2}-\d{2}$/.test(String(payload.period_end || '')) || payload.period_end < payload.period_start
        || !Array.isArray(payload.lines) || !payload.lines.length) throw new Error('Enter a valid budget period and at least one budget line before saving.')
      if (payload.budget_id != null && !UUID.test(String(payload.budget_id))) throw new Error('The selected budget identity is invalid.')
      if (payload.expected_version != null && (!Number.isSafeInteger(payload.expected_version) || payload.expected_version < 1)) throw new Error('The selected budget version is invalid. Refresh before saving.')
      for (const line of payload.lines) {
        if (!isRecord(line) || typeof line.account_code !== 'string' || cents(line.amount, 'amount') < 0) throw new Error('Every budget line must have an account and a non-negative amount.')
      }
      if (typeof bridge.getOpenIntents !== 'function' || typeof bridge.retryOperation !== 'function') throw new Error('Local budget operation recovery is unavailable. No change was submitted.')
      const storage = globalThis.localStorage
      if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') throw new Error('Durable local retry storage is unavailable. No budget change was submitted.')
      const key = `bar-local:budget:${scope.business_id}:${scope.actor_staff_id}:${operationKey}`
      let saved = null
      try { saved = JSON.parse(storage.getItem(key) || 'null') } catch { throw new Error('Saved budget recovery data could not be read. Stop before retrying this operation.') }
      if (saved && (saved.command !== 'accounting.budget.upsert' || JSON.stringify(saved.payload) !== JSON.stringify(payload)
        || !UUID.test(String(saved.operation_id || '')))) throw new Error('A saved budget operation has different details. Retry the original details before starting another change.')
      const open = await bridge.getOpenIntents()
      if (!Array.isArray(open)) throw new Error('The local operation journal could not be checked. No budget change was submitted.')
      const pending = saved && open.find((item) => item.operation_id === saved.operation_id)
      if (pending && pending.command !== 'accounting.budget.upsert') throw new Error('The saved local operation does not match this budget action. Contact support before continuing.')
      if (!pending && open.length) throw new Error('Resolve the existing local operation before starting another budget change.')
      if (!saved) {
        const operation_id = globalThis.crypto?.randomUUID?.()
        if (!UUID.test(String(operation_id || ''))) throw new Error('A stable local operation ID could not be created. No budget change was submitted.')
        saved = { command: 'accounting.budget.upsert', payload, operation_id }
        try { storage.setItem(key, JSON.stringify(saved)) } catch { throw new Error('The budget operation could not be saved for safe retry. No change was submitted.') }
      }
      const result = pending ? await bridge.retryOperation(saved.operation_id)
        : await bridge.command({ command: saved.command, payload, operation_id: saved.operation_id })
      if (result?.outcome === 'committed_local' || result?.outcome === 'refused') storage.removeItem(key)
      if (!['committed_local', 'refused'].includes(result?.outcome)) throw new Error('The local budget result is unresolved. Retry the same saved action before continuing.')
      return result
    }
  }
}
