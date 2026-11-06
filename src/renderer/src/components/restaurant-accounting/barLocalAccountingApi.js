// @ts-check
import { loadCompleteBarList } from '../../../../shared/barLocalPagination.js'

const PENDING_PREFIX = 'hpos:bar-local:accounting.account.upsert:'
const JOURNAL_PENDING_PREFIX = 'hpos:bar-local:accounting.journal.post:'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** @param {any} bridge @param {{businessId?:string, outletId?:string, staffId?:string}} scope */
export function createBarLocalAccountingApi(bridge, scope = {}) {
  const businessId = typeof scope.businessId === 'string' ? scope.businessId : ''
  const outletId = typeof scope.outletId === 'string' ? scope.outletId : ''
  const staffId = typeof scope.staffId === 'string' ? scope.staffId : ''
  if (!bridge || !businessId || !outletId || !staffId) throw new Error('Local Bar accounting scope is unavailable. Sign in again before continuing.')
  const accountKey = `${PENDING_PREFIX}${businessId}:${staffId}`
  const journalKey = `${JOURNAL_PENDING_PREFIX}${businessId}:${staffId}`
  const pending = (storage, key) => {
    try {
      const intent = JSON.parse(storage?.getItem(key) || 'null')
      return isRecord(intent) && UUID.test(String(intent.operation_id)) && isRecord(intent.payload)
        ? { command: intent.command, operation_id: intent.operation_id, payload: intent.payload } : null
    } catch { return null }
  }
  const run = async (storage, key, command, payload) => {
    const saved = pending(storage, key)
    if (saved && (saved.command !== command || JSON.stringify(saved.payload) !== JSON.stringify(payload))) {
      throw new Error('A saved local accounting operation is unresolved. Retry it before making another change.')
    }
    const intent = saved || { command, operation_id: globalThis.crypto?.randomUUID?.(), payload }
    if (!UUID.test(String(intent.operation_id || ''))) throw new Error('A stable operation ID could not be created. No accounting change was submitted.')
    if (!saved) storage?.setItem(key, JSON.stringify(intent))
    const result = saved
      ? await bridge.retryOperation(intent.operation_id)
      : await bridge.command({ command, operation_id: intent.operation_id, payload: intent.payload })
    if (result?.outcome === 'committed_local') { storage?.removeItem(key); return result }
    if (result?.outcome === 'refused') { storage?.removeItem(key); throw new Error(result.error?.message || 'The local authority refused this accounting change.') }
    throw new Error('The accounting result is unresolved. Retry the saved operation; do not submit it again.')
  }
  return {
    async list(includeInactive = true) {
      const rows = await loadCompleteBarList(async (name, filters) => {
        const result = await bridge.query(name, filters)
        if (!isRecord(result?.scope) || result.scope.business_id !== businessId || result.scope.outlet_id !== outletId
          || result.scope.actor_staff_id !== staffId) throw new Error('The accounting list belongs to another Bar session. No hosted data was used.')
        return result
      }, 'accounting.accounts.list', { include_inactive: includeInactive })
      return rows.map((row) => {
        if (typeof row.account_code !== 'string' || typeof row.name !== 'string'
          || !['asset', 'liability', 'equity', 'revenue', 'expense'].includes(String(row.type))
          || typeof row.active !== 'boolean' || !Number.isSafeInteger(row.version) || row.version < 1
          || !/^-?\d+(?:\.\d{1,2})?$/.test(String(row.balance))) throw new Error('The local chart of accounts returned an invalid account.')
        return { id: row.account_code, code: row.account_code, name: row.name, account_type: row.type,
          is_active: row.active, version: row.version, balance: row.balance }
      })
    },
    save(storage, account) {
      const code = typeof account?.code === 'string' ? account.code.trim() : ''
      const name = typeof account?.name === 'string' ? account.name.trim() : ''
      const type = typeof account?.type === 'string' ? account.type : ''
      const active = account?.active !== false
      const expectedVersion = account?.expected_version
      if (!code || !name || !['asset', 'liability', 'equity', 'revenue', 'expense'].includes(type)
        || (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1))) {
        throw new Error('Enter a valid account code, name and type before saving.')
      }
      return run(storage, accountKey, 'accounting.account.upsert', {
        code, name, type, active, ...(expectedVersion === undefined ? {} : { expected_version: expectedVersion })
      })
    },
    postOpening(storage, input) {
      const amount = typeof input?.amount === 'string' ? input.amount.trim() : ''
      if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) throw new Error('Enter a positive opening amount with no more than two decimal places.')
      const [whole, fraction = ''] = amount.split('.')
      const amountExact = `${whole}.${fraction.padEnd(2, '0')}`
      const account = typeof input?.account_code === 'string' ? input.account_code : ''
      const accountType = typeof input?.account_type === 'string' ? input.account_type : ''
      const equity = typeof input?.equity_code === 'string' ? input.equity_code : ''
      const entryDate = typeof input?.entry_date === 'string' ? input.entry_date : ''
      if (!account || !equity || account === equity || !['asset', 'liability', 'equity', 'revenue', 'expense'].includes(accountType) || !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) throw new Error('Choose two different active accounts, a valid account type and a valid entry date.')
      const debitNormal = ['asset', 'expense'].includes(accountType)
      return run(storage, journalKey, 'accounting.journal.post', {
        entry_date: entryDate, memo: 'Opening balance', source_type: 'opening_balance',
        lines: [
          { account_code: account, debit: debitNormal ? amountExact : '0.00', credit: debitNormal ? '0.00' : amountExact, description: 'Opening balance' },
          { account_code: equity, debit: debitNormal ? '0.00' : amountExact, credit: debitNormal ? amountExact : '0.00', description: 'Opening balance equity offset' }
        ]
      })
    },
    retry(storage) {
      const savedAccount = pending(storage, accountKey)
      if (savedAccount) return run(storage, accountKey, savedAccount.command, savedAccount.payload)
      const savedJournal = pending(storage, journalKey)
      if (savedJournal) return run(storage, journalKey, savedJournal.command, savedJournal.payload)
      throw new Error('There is no saved local accounting operation to retry.')
    },
    hasPending(storage) { return pending(storage, accountKey) || pending(storage, journalKey) }
  }
}
