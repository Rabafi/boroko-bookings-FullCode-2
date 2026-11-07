// @ts-check

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
function cents(value, field) {
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(String(value))
  if (!match) throw new Error(`The local financial statement ${field} is invalid. Refresh before relying on it.`)
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 100 + Number((match[3] || '').padEnd(2, '0') || 0))
}

/** Read-only financial statement projections from one complete local journal snapshot. */
export function createBarLocalBalanceSheetApi(bridge, expectedScope) {
  const scope = { business_id: String(expectedScope?.businessId || ''), outlet_id: String(expectedScope?.outletId || ''), actor_staff_id: String(expectedScope?.staffId || '') }
  if (!bridge || typeof bridge.query !== 'function' || Object.values(scope).some((value) => !UUID.test(value))) throw new Error('Local financial statements need a verified business, outlet and operator session.')

  async function list(name, filters) {
    const rows = [], ids = new Set(), cursors = new Set()
    let cursor = null, watermark = null
    for (let page = 0; page < 100; page += 1) {
      const result = await bridge.query(name, { ...filters, limit: 200, ...(cursor ? { cursor } : {}) })
      if (!isRecord(result?.scope) || result.scope.business_id !== scope.business_id || result.scope.outlet_id !== scope.outlet_id
        || result.scope.actor_staff_id !== scope.actor_staff_id) throw new Error('Local statement data belongs to another Bar session. No hosted data was used.')
      if (result.complete !== true || !Array.isArray(result.data) || !Array.isArray(result.unavailable) || result.unavailable.length
        || !Number.isSafeInteger(result.snapshot_watermark) || typeof result.pagination?.has_more !== 'boolean') throw new Error('The local financial statement snapshot is incomplete.')
      if (watermark !== null && watermark !== result.snapshot_watermark) throw new Error('Local accounting changed while the statement was loading. Refresh before relying on it.')
      watermark = result.snapshot_watermark
      for (const row of result.data) {
        const id = row?.id ?? row?.account_code
        if (!isRecord(row) || typeof id !== 'string' || !id || ids.has(id)) throw new Error('The local financial statement contains invalid or duplicate records.')
        ids.add(id); rows.push(row)
      }
      if (!result.pagination.has_more) return { rows, watermark }
      cursor = result.pagination.next_cursor
      if (typeof cursor !== 'string' || !cursor || cursors.has(cursor) || result.data.length === 0) throw new Error('The local financial statement pagination is invalid.')
      cursors.add(cursor)
    }
    throw new Error('The local financial statement exceeded its safe paging limit.')
  }

  return {
    async load(startDate, endDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(endDate)) || endDate < startDate) throw new Error('Choose a valid financial statement date range.')
      const [accountRows, journalRows] = await Promise.all([
        list('accounting.accounts.list', { include_inactive: true }),
        list('accounting.journal_entries', { from: '1970-01-01', to: endDate })
      ])
      if (accountRows.watermark !== journalRows.watermark) throw new Error('Local accounting changed while the statement was loading. Refresh before relying on it.')
      const accounts = new Map()
      for (const row of accountRows.rows) {
        if (typeof row.account_code !== 'string' || typeof row.name !== 'string'
          || !['asset', 'liability', 'equity', 'revenue', 'expense'].includes(row.type) || typeof row.active !== 'boolean') throw new Error('The local chart of accounts is invalid for financial statements.')
        accounts.set(row.account_code, { code: row.account_code, name: row.name, type: row.type, is_active: row.active, id: row.account_code, balance: 0, period: 0 })
      }
      for (const entry of journalRows.rows) {
        if (!UUID.test(String(entry.id || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(entry.entry_date || ''))
          || entry.entry_date > endDate || !Array.isArray(entry.lines)) throw new Error('The local journal snapshot is invalid for financial statements.')
        for (const line of entry.lines) {
          if (!isRecord(line) || typeof line.account_code !== 'string') throw new Error('A local journal line is invalid for financial statements.')
          const account = accounts.get(line.account_code)
          if (!account) continue
          const debit = cents(line.debit, 'journal debit'), credit = cents(line.credit, 'journal credit')
          const signed = ['liability', 'equity', 'revenue'].includes(account.type) ? credit - debit : debit - credit
          account.balance += signed
          if (entry.entry_date >= startDate && ['revenue', 'expense'].includes(account.type)) account.period += signed
        }
      }
      const project = (account, key) => ({ id: account.id, code: account.code, name: account.name, is_active: account.is_active, [key]: (account[key] / 100).toFixed(2) })
      const byType = (type, key) => [...accounts.values()].filter((account) => account.type === type).map((account) => project(account, key))
      const total = (rows, key) => rows.reduce((sum, row) => sum + cents(row[key], key), 0)
      const assets = byType('asset', 'balance'), liabilities = byType('liability', 'balance'), equity = byType('equity', 'balance')
      const revenue = byType('revenue', 'period'), expenses = byType('expense', 'period')
      const assetsTotal = total(assets, 'balance'), liabilitiesTotal = total(liabilities, 'balance'), equityTotal = total(equity, 'balance')
      const revenueTotal = total(revenue, 'period'), expenseTotal = total(expenses, 'period')
      const earnings = revenueTotal - expenseTotal, liabilitiesAndEquity = liabilitiesTotal + equityTotal + earnings
      return {
        balance_sheet: { assets, liabilities, equity, assets_total: (assetsTotal / 100).toFixed(2), liabilities_total: (liabilitiesTotal / 100).toFixed(2),
          equity_total: (equityTotal / 100).toFixed(2), current_period_earnings: (earnings / 100).toFixed(2),
          liabilities_and_equity_total: (liabilitiesAndEquity / 100).toFixed(2), difference: ((assetsTotal - liabilitiesAndEquity) / 100).toFixed(2) },
        income_statement: { revenue, expenses, revenue_total: (revenueTotal / 100).toFixed(2), expense_total: (expenseTotal / 100).toFixed(2), net_income: (earnings / 100).toFixed(2) },
        cash_flow_available: false, snapshot_watermark: accountRows.watermark
      }
    }
  }
}
