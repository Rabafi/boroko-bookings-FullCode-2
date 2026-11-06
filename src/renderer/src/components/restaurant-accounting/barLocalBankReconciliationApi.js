// @ts-check

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function cents(value, field) {
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(String(value))
  if (!match) throw new Error(`The local bank ${field} is invalid. Refresh before relying on the result.`)
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 100 + Number((match[3] || '').padEnd(2, '0') || 0))
}

/** Adapter for the established Accounting Pro bank reconciliation page. */
export function createBarLocalBankReconciliationApi(bridge, expectedScope) {
  const scope = {
    business_id: String(expectedScope?.businessId || ''),
    outlet_id: String(expectedScope?.outletId || ''),
    actor_staff_id: String(expectedScope?.staffId || '')
  }
  if (!bridge || typeof bridge.query !== 'function' || typeof bridge.command !== 'function'
    || Object.values(scope).some((value) => !UUID.test(value))) {
    throw new Error('The local bank workspace needs a verified business, outlet and operator session.')
  }

  const query = async (name, filters) => {
    const result = await bridge.query(name, filters)
    if (!isRecord(result?.scope) || result.scope.business_id !== scope.business_id
      || result.scope.outlet_id !== scope.outlet_id || result.scope.actor_staff_id !== scope.actor_staff_id) {
      throw new Error('Local bank data belongs to another Bar session. No hosted data was used.')
    }
    return result
  }

  async function list(name, filters = {}) {
    const rows = []
    const ids = new Set()
    const cursors = new Set()
    let cursor = null
    let watermark = null
    for (let page = 0; page < 100; page += 1) {
      const result = await query(name, { ...filters, limit: 200, ...(cursor ? { cursor } : {}) })
      if (result?.complete !== true || !Array.isArray(result.data) || !Array.isArray(result.unavailable)
        || result.unavailable.length !== 0 || !Number.isSafeInteger(result.snapshot_watermark)
        || typeof result.pagination?.has_more !== 'boolean') {
        throw new Error('The local bank snapshot is incomplete. Refresh before relying on it.')
      }
      if (watermark !== null && watermark !== result.snapshot_watermark) throw new Error('Local accounting records changed while loading. Refresh before using this snapshot.')
      watermark = result.snapshot_watermark
      for (const row of result.data) {
        const id = row?.id ?? row?.account_code
        if (!isRecord(row) || typeof id !== 'string' || ids.has(id)) throw new Error('The local bank snapshot contains an invalid or duplicate record.')
        ids.add(id); rows.push(row)
      }
      if (!result.pagination.has_more) return { rows, watermark }
      cursor = result.pagination.next_cursor
      if (typeof cursor !== 'string' || !cursor || cursors.has(cursor) || result.data.length === 0) throw new Error('The local bank pagination is invalid. Refresh before relying on the list.')
      cursors.add(cursor)
    }
    throw new Error('The local bank snapshot exceeded its safe paging limit.')
  }
  const records = (kind) => list('accounting.records', { kind })

  function validateBankData(data) {
    if (!isRecord(data) || !Array.isArray(data.accounts) || !Array.isArray(data.lines)
      || !Array.isArray(data.reconciliations) || !Array.isArray(data.payments) || !Array.isArray(data.journals)) {
      throw new Error('The local bank snapshot is incomplete. Refresh before reconciling any statement line.')
    }
    const accounts = new Map()
    for (const account of data.accounts) {
      if (!isRecord(account) || !UUID.test(String(account.id || '')) || typeof account.name !== 'string'
        || typeof account.account_code !== 'string' || typeof account.active !== 'boolean'
        || !Number.isSafeInteger(account.version) || account.version < 1 || accounts.has(account.id)) {
        throw new Error('The local bank account list contains an invalid or duplicate account.')
      }
      accounts.set(account.id, account)
    }
    const reconciledLines = new Set()
    const reconciledEntries = new Set()
    const reconciledPayments = new Set()
    for (const reconciliation of data.reconciliations) {
      if (!isRecord(reconciliation) || !UUID.test(String(reconciliation.id || ''))
        || !UUID.test(String(reconciliation.statement_line_id || ''))
        || !UUID.test(String(reconciliation.bank_account_id || ''))
        || !UUID.test(String(reconciliation.operation_id || ''))
        || (reconciliation.journal_entry_id != null && !UUID.test(String(reconciliation.journal_entry_id)))
        || (reconciliation.ap_payment_id != null && !UUID.test(String(reconciliation.ap_payment_id)))
        || reconciledLines.has(reconciliation.statement_line_id)) {
        throw new Error('The local reconciliation history contains an invalid or duplicate link.')
      }
      reconciledLines.add(reconciliation.statement_line_id)
      if (reconciliation.journal_entry_id) reconciledEntries.add(reconciliation.journal_entry_id)
      if (reconciliation.ap_payment_id) reconciledPayments.add(reconciliation.ap_payment_id)
    }
    const lineIds = new Set()
    for (const line of data.lines) {
      if (!isRecord(line) || !UUID.test(String(line.id || '')) || !accounts.has(line.bank_account_id)
        || !/^\d{4}-\d{2}-\d{2}$/.test(String(line.statement_date || ''))
        || typeof line.external_ref !== 'string' || !line.external_ref.trim()
        || cents(line.amount, 'statement amount') === 0 || lineIds.has(line.id)) {
        throw new Error('The local statement list contains an invalid or duplicate row.')
      }
      lineIds.add(line.id)
    }
    for (const reconciliation of data.reconciliations) {
      const line = data.lines.find((row) => row.id === reconciliation.statement_line_id)
      if (!line || line.bank_account_id !== reconciliation.bank_account_id
        || (reconciliation.evidence_type === 'journal' && (!reconciliation.journal_entry_id || reconciliation.ap_payment_id))
        || (reconciliation.evidence_type === 'ap_payment' && (!reconciliation.ap_payment_id || !reconciliation.journal_entry_id))) {
        throw new Error('The local reconciliation links do not match their statement line and evidence type.')
      }
    }
    for (const payment of data.payments) {
      if (!isRecord(payment) || !UUID.test(String(payment.id || ''))
        || !UUID.test(String(payment.journal_entry_id || '')) || typeof payment.payment_account_code !== 'string'
        || !['posted', 'reversal'].includes(String(payment.status)) || cents(payment.amount, 'payment amount') <= 0) {
        throw new Error('The local payable payment list contains an invalid record.')
      }
    }
    for (const entry of data.journals) {
      if (!isRecord(entry) || !UUID.test(String(entry.id || ''))
        || !/^\d{4}-\d{2}-\d{2}$/.test(String(entry.entry_date || ''))
        || typeof entry.description !== 'string' || !Array.isArray(entry.lines)) {
        throw new Error('The local journal evidence list is invalid.')
      }
      for (const line of entry.lines) {
        if (!isRecord(line) || typeof line.account_code !== 'string') throw new Error('A local journal line is invalid.')
        cents(line.debit, 'journal debit'); cents(line.credit, 'journal credit')
      }
    }
    return { accounts, reconciledLines, reconciledEntries, reconciledPayments }
  }

  return {
    async load() {
      const [accounts, bankAccounts, lines, reconciliations, payments, journals] = await Promise.all([
        list('accounting.accounts.list', { include_inactive: true }),
        records('bank_accounts'), records('bank_statement_lines'), records('bank_reconciliations'),
        records('ap_payments'), list('accounting.journal_entries', { from: '1970-01-01', to: '9999-12-31' })
      ])
      const lists = [accounts, bankAccounts, lines, reconciliations, payments, journals]
      if (lists.some((result) => result.watermark !== lists[0].watermark)) throw new Error('Local accounting changed while the bank workspace was loading. Refresh before reconciling.')
      const snapshot = { accounts: bankAccounts.rows, lines: lines.rows, reconciliations: reconciliations.rows,
        payments: payments.rows, journals: journals.rows, snapshot_watermark: lists[0].watermark }
      validateBankData(snapshot)
      const ledgerAccounts = accounts.rows.map((row) => {
        if (!isRecord(row) || typeof row.account_code !== 'string' || typeof row.name !== 'string'
          || typeof row.type !== 'string' || typeof row.active !== 'boolean') throw new Error('The local chart of accounts is invalid.')
        return { id: row.account_code, code: row.account_code, name: row.name, account_type: row.type, is_active: row.active }
      })
      return { ...snapshot, ledgerAccounts }
    },
    getCandidates(snapshot, statementLineId) {
      const { accounts, reconciledLines, reconciledEntries, reconciledPayments } = validateBankData(snapshot)
      const line = snapshot.lines.find((row) => row.id === statementLineId)
      if (!line || reconciledLines.has(statementLineId)) throw new Error('This statement line is missing or already reconciled. Refresh before continuing.')
      const account = accounts.get(line.bank_account_id)
      const target = cents(line.amount, 'statement amount')
      const candidates = []
      const payableJournalEntries = new Set(snapshot.payments.map((payment) => payment.journal_entry_id))
      for (const entry of snapshot.journals) {
        if (reconciledEntries.has(entry.id) || payableJournalEntries.has(entry.id)) continue
        const matched = entry.lines.reduce((sum, journalLine) => journalLine.account_code === account.account_code
          ? sum + cents(journalLine.debit, 'journal debit') - cents(journalLine.credit, 'journal credit') : sum, 0)
        if (matched === target) candidates.push({ id: entry.id, type: 'journal', entry_date: entry.entry_date,
          description: entry.description, source_type: entry.source_type || 'journal', amount: line.amount,
          journal_entry_id: entry.id })
      }
      if (target < 0) {
        for (const payment of snapshot.payments) {
          if (payment.status !== 'posted' || payment.payment_account_code !== account.account_code
            || reconciledPayments.has(payment.id) || snapshot.payments.some((row) => row.reverses_payment_id === payment.id)
            || -cents(payment.amount, 'payment amount') !== target) continue
          candidates.push({ id: payment.id, type: 'ap_payment', entry_date: payment.payment_date,
            description: payment.reference || `Supplier payment ${payment.id}`, source_type: 'supplier payment',
            amount: line.amount, ap_payment_id: payment.id })
        }
      }
      return candidates.sort((a, b) => String(b.entry_date).localeCompare(String(a.entry_date)) || a.id.localeCompare(b.id))
    },
    async submit(command, payload, operationKey) {
      if (!['accounting.bank_account.upsert', 'accounting.bank_statement.import', 'accounting.bank.reconcile'].includes(command)
        || !/^[a-z0-9][a-z0-9:_-]{0,180}$/i.test(String(operationKey || '')) || !isRecord(payload)) {
        throw new Error('The local bank operation is invalid and was not submitted.')
      }
      if (typeof bridge.getOpenIntents !== 'function' || typeof bridge.retryOperation !== 'function') throw new Error('Local operation recovery is unavailable. No bank change was submitted.')
      const storage = globalThis.localStorage
      if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') throw new Error('Durable local retry storage is unavailable. No bank change was submitted.')
      const key = `bar-local:bank:${scope.business_id}:${scope.actor_staff_id}:${operationKey}`
      let saved = null
      try { saved = JSON.parse(storage.getItem(key) || 'null') } catch { throw new Error('Saved bank recovery data could not be read. Stop before retrying this operation.') }
      if (saved && (saved.command !== command || JSON.stringify(saved.payload) !== JSON.stringify(payload)
        || !UUID.test(String(saved.operation_id || '')))) throw new Error('A saved bank operation has different details. Retry the original details before starting another change.')
      const open = await bridge.getOpenIntents()
      if (!Array.isArray(open)) throw new Error('The local operation journal could not be checked. No bank change was submitted.')
      const pending = saved && open.find((item) => item.operation_id === saved.operation_id)
      if (pending && pending.command !== command) throw new Error('The saved local operation does not match this bank action. Contact support before continuing.')
      if (!pending && open.length) throw new Error('Resolve the existing local operation before starting another bank change.')
      if (!saved) {
        const operation_id = globalThis.crypto?.randomUUID?.()
        if (!UUID.test(String(operation_id || ''))) throw new Error('A stable local operation ID could not be created. No bank change was submitted.')
        saved = { command, payload, operation_id }
        try { storage.setItem(key, JSON.stringify(saved)) } catch { throw new Error('The bank operation could not be saved for safe retry. No change was submitted.') }
      }
      const result = pending ? await bridge.retryOperation(saved.operation_id)
        : await bridge.command({ command, payload, operation_id: saved.operation_id })
      if (result?.outcome === 'committed_local' || result?.outcome === 'refused') storage.removeItem(key)
      if (!['committed_local', 'refused'].includes(result?.outcome)) throw new Error('The local bank result is unresolved. Retry the same saved action before continuing.')
      return result
    }
  }
}
