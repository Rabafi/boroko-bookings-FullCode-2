// @ts-check

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const MONEY = /^-?\d+(?:\.\d{1,2})?$/

function validateScope(result, scope) {
  if (result?.complete !== true || !Number.isSafeInteger(result.snapshot_watermark)
    || !isRecord(result.scope) || result.scope.business_id !== scope.businessId
    || result.scope.outlet_id !== scope.outletId || result.scope.actor_staff_id !== scope.staffId) {
    throw new Error('The local ledger snapshot is incomplete or belongs to another Bar session. Refresh before relying on it.')
  }
}

function validateLedgerPage(result, scope) {
  validateScope(result, scope)
  const pagination = result.pagination
  if (!Array.isArray(result.data) || !isRecord(pagination)
    || typeof pagination.has_more !== 'boolean'
    || (pagination.has_more && (typeof pagination.next_cursor !== 'string' || !pagination.next_cursor))) {
    throw new Error('The local journal list is incomplete. Refresh before relying on it.')
  }
  const entries = result.data.map((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(String(entry.entry_date))
      || typeof entry.description !== 'string' || !Array.isArray(entry.lines)) {
      throw new Error('The local authority returned an invalid journal entry. No hosted data was used.')
    }
    const lines = entry.lines.map((line) => {
      if (!isRecord(line) || typeof line.id !== 'string' || typeof line.account_code !== 'string'
        || typeof line.account_name !== 'string' || !MONEY.test(String(line.debit)) || !MONEY.test(String(line.credit))) {
        throw new Error('The local authority returned an invalid journal line. No hosted data was used.')
      }
      return line
    })
    return { ...entry, lines }
  })
  return {
    entries,
    next_cursor: pagination.next_cursor || null,
    has_more: pagination.has_more,
    snapshot_watermark: result.snapshot_watermark
  }
}

function validateTrialBalance(result, scope) {
  validateScope(result, scope)
  if (!Array.isArray(result.data)) throw new Error('The local trial balance is incomplete. Refresh before relying on it.')
  const trialBalance = result.data.map((row) => {
    if (!isRecord(row) || typeof row.account_code !== 'string' || typeof row.name !== 'string'
      || !MONEY.test(String(row.debit)) || !MONEY.test(String(row.credit)) || !MONEY.test(String(row.balance))) {
      throw new Error('The local authority returned an invalid trial balance row. No hosted data was used.')
    }
    return { ...row, account_id: row.account_code, code: row.account_code,
      debit: Number(row.debit), credit: Number(row.credit), balance: Number(row.balance) }
  })
  return { trialBalance, snapshot_watermark: result.snapshot_watermark }
}

/** Read-only local projection for the established Accounting Pro General Ledger page. */
export function createBarLocalGeneralLedgerApi(bridge, scope = {}) {
  const resolvedScope = {
    businessId: typeof scope.businessId === 'string' ? scope.businessId : '',
    outletId: typeof scope.outletId === 'string' ? scope.outletId : '',
    staffId: typeof scope.staffId === 'string' ? scope.staffId : ''
  }
  if (!bridge || typeof bridge.query !== 'function' || Object.values(resolvedScope).some((value) => !value)) {
    throw new Error('The local ledger bridge and verified business, outlet and staff scope are required.')
  }

  const readLedgerPage = async (filters) => {
    const result = await bridge.query('accounting.journal_entries', {
      from: filters.from,
      to: filters.to,
      ...(filters.account_code ? { account_code: filters.account_code } : {}),
      limit: 100,
      ...(filters.cursor ? { cursor: filters.cursor } : {})
    })
    return validateLedgerPage(result, resolvedScope)
  }

  const readTrialBalance = async (filters) => {
    const result = await bridge.query('accounting.trial_balance', { from: filters.from, to: filters.to })
    return validateTrialBalance(result, resolvedScope)
  }

  return {
    async loadFirstPage(filters) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const [ledger, balance] = await Promise.all([readLedgerPage(filters), readTrialBalance(filters)])
        if (ledger.snapshot_watermark === balance.snapshot_watermark) {
          return { ...ledger, trialBalance: balance.trialBalance }
        }
      }
      throw new Error('The ledger changed while its totals were loading. Refresh to read one consistent snapshot.')
    },
    readNextPage: readLedgerPage
  }
}
