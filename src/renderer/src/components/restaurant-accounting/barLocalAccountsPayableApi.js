const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const amountCents = (value, field) => {
  const text = String(value)
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(text)
  if (!match) throw new Error(`The local Accounts Payable ${field} is invalid. Refresh before relying on the totals.`)
  return Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0') || 0)
}

export function createBarLocalAccountsPayableApi(bridge, expectedScope) {
  const scope = {
    business_id: String(expectedScope?.businessId || '').trim(),
    outlet_id: String(expectedScope?.outletId || '').trim(),
    actor_staff_id: String(expectedScope?.staffId || '').trim()
  }
  if (!bridge || typeof bridge.query !== 'function' || !UUID.test(scope.business_id) || !UUID.test(scope.outlet_id) || !UUID.test(scope.actor_staff_id)) {
    throw new Error('The local Accounts Payable scope could not be verified. Sign in again before continuing.')
  }

  const read = async (kind) => {
    const rows = []
    const ids = new Set()
    const cursors = new Set()
    let cursor = null
    let watermark = null
    let pageScope = null
    for (let page = 0; page < 100; page += 1) {
      const result = await bridge.query('accounting.records', { kind, limit: 200, ...(cursor ? { cursor } : {}) })
      const nextScope = result?.scope
      if (result?.complete !== true || !Array.isArray(result.data) || !Array.isArray(result.unavailable) || result.unavailable.length !== 0 ||
          !Number.isSafeInteger(result.snapshot_watermark) || result.snapshot_watermark < 0 ||
          nextScope?.business_id !== scope.business_id || nextScope?.outlet_id !== scope.outlet_id ||
          nextScope?.actor_staff_id !== scope.actor_staff_id || typeof result.pagination?.has_more !== 'boolean') {
        throw new Error('The local Accounts Payable list is incomplete or has the wrong operator/outlet scope. Refresh before relying on it.')
      }
      const currentScope = JSON.stringify([nextScope.business_id, nextScope.outlet_id, nextScope.actor_staff_id])
      if (pageScope !== null && pageScope !== currentScope) throw new Error('The local Accounts Payable scope changed while loading. Sign in again.')
      if (watermark !== null && watermark !== result.snapshot_watermark) throw new Error('Local accounting records changed while loading. Refresh before relying on the totals.')
      pageScope = currentScope
      watermark = result.snapshot_watermark
      for (const row of result.data) {
        if (!row || typeof row !== 'object' || Array.isArray(row) || !UUID.test(String(row.id || '')) || ids.has(row.id)) throw new Error('The local Accounts Payable list contains an invalid or duplicated record.')
        ids.add(row.id)
        rows.push(row)
      }
      if (!result.pagination.has_more) return { rows, watermark }
      cursor = result.pagination.next_cursor
      if (typeof cursor !== 'string' || !cursor || cursors.has(cursor) || result.data.length === 0) throw new Error('Local Accounts Payable pagination is invalid. Refresh before relying on the totals.')
      cursors.add(cursor)
    }
    throw new Error('Local Accounts Payable exceeds the safe loading limit. Use a scoped export.')
  }

  const list = async (query, filters = {}) => {
    const rows = []
    const cursors = new Set()
    let cursor = null
    let watermark = null
    for (let page = 0; page < 100; page += 1) {
      const result = await bridge.query(query, { ...filters, limit: 200, ...(cursor ? { cursor } : {}) })
      if (result?.complete !== true || !Array.isArray(result.data) || !Array.isArray(result.unavailable) || result.unavailable.length !== 0 ||
          !Number.isSafeInteger(result.snapshot_watermark) || result.scope?.business_id !== scope.business_id ||
          result.scope?.outlet_id !== scope.outlet_id || result.scope?.actor_staff_id !== scope.actor_staff_id ||
          typeof result.pagination?.has_more !== 'boolean') {
        throw new Error('The local Accounts Payable list is incomplete or has the wrong operator/outlet scope. Refresh before relying on it.')
      }
      if (watermark !== null && watermark !== result.snapshot_watermark) throw new Error('Local accounting records changed while loading. Refresh before relying on them.')
      watermark = result.snapshot_watermark
      rows.push(...result.data)
      if (!result.pagination.has_more) return { rows, watermark }
      cursor = result.pagination.next_cursor
      if (typeof cursor !== 'string' || !cursor || cursors.has(cursor) || result.data.length === 0) throw new Error('Local Accounts Payable pagination is invalid.')
      cursors.add(cursor)
    }
    throw new Error('Local Accounts Payable exceeds the safe loading limit.')
  }

  const submit = async (command, payload, operationId) => {
    if (!UUID.test(String(operationId || ''))) throw new Error('A stable local operation ID is required.')
    const storage = globalThis.localStorage
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') throw new Error('Secure local retry storage is unavailable. No invoice draft was submitted.')
    const storageKey = `bar-local:ap:command:${scope.business_id}:${scope.actor_staff_id}:${operationId}`
    let recorded = null
    try { recorded = JSON.parse(storage.getItem(storageKey) || 'null') } catch { throw new Error('Saved local invoice recovery data could not be read. Stop and contact support before retrying.') }
    if (recorded && (recorded.command !== command || JSON.stringify(recorded.payload) !== JSON.stringify(payload))) {
      throw new Error('This saved operation belongs to different invoice data. Retry the original details or contact support before continuing.')
    }
    const open = await bridge.getOpenIntents()
    if (!Array.isArray(open)) throw new Error('Saved local operations could not be checked. Resolve the operation journal before continuing.')
    const saved = open.find((item) => item.operation_id === operationId)
    if (saved && (!recorded || saved.command !== command)) throw new Error('This unresolved operation does not match the saved invoice details. Contact support before retrying.')
    if (!saved && open.length) throw new Error('A prior local accounting operation is unresolved. Retry it before starting another change.')
    if (!recorded) {
      try { storage.setItem(storageKey, JSON.stringify({ command, payload })) } catch { throw new Error('The invoice could not be saved for safe retry. Nothing was submitted.') }
    }
    const result = saved ? await bridge.retryOperation(operationId) : await bridge.command({ command, payload, operation_id: operationId })
    if (result?.outcome === 'committed_local' || result?.outcome === 'refused') storage.removeItem(storageKey)
    if (result?.outcome === 'committed_local') return result
    if (result?.outcome === 'refused') return result
    throw Object.assign(new Error('The local result is unresolved. Retry the same saved operation before starting another.'), { outcome: 'unknown', operationId })
  }

  const commitApproved = async (command, payload, operationId, pin) => {
    if (!UUID.test(String(operationId || ''))) throw new Error('A stable local operation ID is required.')
    if (!bridge.requestApprovalForCommand || !bridge.getOpenIntents || !bridge.retryOperation) throw new Error('The local approval and recovery bridge is unavailable.')
    const storage = globalThis.localStorage
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') {
      throw new Error('Secure local retry storage is unavailable. No invoice approval or payment was submitted.')
    }
    const storageKey = `bar-local:ap:${scope.business_id}:${scope.actor_staff_id}:${operationId}`
    let saved = null
    try { saved = JSON.parse(storage.getItem(storageKey) || 'null') } catch { throw new Error('Saved local approval recovery data could not be read. Stop and contact support before retrying.') }
    const samePayload = (left, right) => JSON.stringify(left) === JSON.stringify(right)
    if (saved && (saved.command !== command || !samePayload(saved.payload, payload) || !UUID.test(String(saved.approval_id || '')))) {
      throw new Error('This saved approval belongs to different accounting data. Refresh and contact support before retrying.')
    }
    const open = await bridge.getOpenIntents()
    if (!Array.isArray(open)) throw new Error('Saved local operations could not be checked. Resolve the operation journal before continuing.')
    const pending = open.find((item) => item.operation_id === operationId)
    if (pending) {
      if (!saved || pending.command !== command) throw new Error('The saved approval operation does not match this invoice or payment. Contact support before retrying.')
      const result = await bridge.retryOperation(operationId)
      if (result?.outcome === 'committed_local' || result?.outcome === 'refused') storage.removeItem(storageKey)
      if (!['committed_local', 'refused'].includes(result?.outcome)) throw Object.assign(new Error('The approved accounting result is unresolved. Retry this same operation before continuing.'), { outcome: 'unknown', operationId })
      return result
    }
    if (open.length) throw new Error('A prior local accounting operation is unresolved. Retry it before starting another change.')
    if (!saved) {
      if (!/^\d{4,12}$/.test(String(pin || ''))) throw new Error('Enter a different authorized manager PIN for this approval.')
      const approval = await bridge.requestApprovalForCommand({ command, payload, pin: String(pin), operation_id: operationId })
      if (!UUID.test(String(approval?.approval_id || ''))) throw new Error('Manager approval was not confirmed. Nothing was submitted.')
      saved = { command, payload, approval_id: approval.approval_id }
      try { storage.setItem(storageKey, JSON.stringify(saved)) } catch { throw new Error('The approval could not be saved for safe recovery. Nothing was submitted.') }
    }
    const result = await bridge.command({ command, payload: { ...payload, approval_id: saved.approval_id }, operation_id: operationId })
    if (result?.outcome === 'committed_local' || result?.outcome === 'refused') storage.removeItem(storageKey)
    if (!['committed_local', 'refused'].includes(result?.outcome)) throw Object.assign(new Error('The approved accounting result is unresolved. Retry this same operation before continuing.'), { outcome: 'unknown', operationId })
    return result
  }

  return {
    async load() {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const [invoices, payments, suppliers] = await Promise.all([
          read('ap_invoices'), read('ap_payments'), read('suppliers')
        ])
        const accounts = await list('accounting.accounts.list', { include_inactive: false })
        if (invoices.watermark !== payments.watermark || invoices.watermark !== suppliers.watermark || invoices.watermark !== accounts.watermark) continue
        const details = await Promise.all(invoices.rows.map(async (invoice) => {
          const result = await bridge.query('accounting.records', { kind: 'ap_invoices', record_id: invoice.id, limit: 1 })
          if (result?.complete !== true || result.snapshot_watermark !== invoices.watermark || result.scope?.business_id !== scope.business_id ||
              result.scope?.outlet_id !== scope.outlet_id || result.scope?.actor_staff_id !== scope.actor_staff_id ||
              !Array.isArray(result.data) || result.data.length !== 1 || result.data[0]?.id !== invoice.id || !Array.isArray(result.data[0].lines)) {
            throw new Error('A local supplier invoice detail changed or is incomplete. Refresh before relying on it.')
          }
          return [invoice.id, result.data[0].lines]
        }))
        const linesByInvoice = new Map(details)
        for (const account of accounts.rows) {
          if (!account || typeof account.account_code !== 'string' || typeof account.name !== 'string' ||
              !['asset', 'liability', 'equity', 'revenue', 'expense'].includes(account.type) || account.active !== true) {
            throw new Error('The local chart returned an invalid active account. Refresh before recording an invoice.')
          }
        }
        for (const supplier of suppliers.rows) {
          if (!supplier || !UUID.test(String(supplier.id || '')) || typeof supplier.name !== 'string' || typeof supplier.active !== 'boolean') {
            throw new Error('The local supplier list is invalid or incomplete. Refresh before recording an invoice.')
          }
        }
        const supplierNames = new Map(suppliers.rows.map(row => [row.id, String(row.name || '')]))
        const paidByInvoice = new Map()
        for (const payment of payments.rows) {
          const invoiceId = String(payment.ap_invoice_id || '')
          if (!UUID.test(invoiceId) || !['posted', 'reversal'].includes(payment.status)) throw new Error('A local supplier payment has invalid invoice or posting status.')
          const delta = amountCents(payment.amount, 'payment amount') * (payment.status === 'reversal' ? -1 : 1)
          paidByInvoice.set(invoiceId, (paidByInvoice.get(invoiceId) || 0) + delta)
        }
        const invoiceIds = new Set(invoices.rows.map(invoice => invoice.id))
        if ([...paidByInvoice.keys()].some(invoiceId => !invoiceIds.has(invoiceId))) throw new Error('A local supplier payment refers to an invoice outside this outlet snapshot.')
        const bills = invoices.rows.map(invoice => {
          if (!UUID.test(String(invoice.supplier_id || '')) || !['draft', 'approved'].includes(invoice.status) ||
              typeof invoice.invoice_number !== 'string' || !invoice.invoice_number || typeof invoice.invoice_date !== 'string' ||
              !supplierNames.has(invoice.supplier_id)) throw new Error('A local supplier invoice is missing required supplier or status data.')
          const totalCents = amountCents(invoice.total, 'invoice total')
          const amountPaidCents = paidByInvoice.get(invoice.id) || 0
          if (amountPaidCents < 0 || amountPaidCents > totalCents) throw new Error('Local supplier payments do not reconcile to the invoice total. Refresh and review the ledger before relying on this balance.')
          const outstandingCents = totalCents - amountPaidCents
          const total = totalCents / 100
          const amountPaid = amountPaidCents / 100
          const outstanding = outstandingCents / 100
          const status = invoice.status === 'approved' ? (outstanding === 0 ? 'paid' : amountPaid > 0 ? 'partially_paid' : invoice.due_date && invoice.due_date < new Date().toISOString().slice(0, 10) ? 'overdue' : 'approved') : 'draft'
          return {
            id: invoice.id,
            supplier_id: invoice.supplier_id,
            supplier_name: supplierNames.get(invoice.supplier_id) || 'Unknown supplier',
            bill_number: invoice.invoice_number,
            bill_date: invoice.invoice_date,
            due_date: invoice.due_date,
            total,
            amount_paid: amountPaid,
            credited_amount: 0,
            outstanding,
            status,
            currency: 'BWP',
            items: (linesByInvoice.get(invoice.id) || []).map((line) => ({
              description: line.description,
              quantity: line.quantity,
              unit_price: line.unit_price,
              tax_rate: line.tax_rate,
              line_total: Number(line.quantity) * Number(line.unit_price) * (1 + Number(line.tax_rate || 0))
            })),
            evidence: [],
            credit_notes: []
          }
        })
        return {
          bills,
          suppliers: suppliers.rows.filter((supplier) => supplier.active).map((supplier) => ({ id: supplier.id, name: supplier.name, active: true })),
          accounts: accounts.rows.map((account) => ({ id: account.account_code, code: account.account_code, name: account.name, account_type: account.type, is_active: account.active === true })),
          summary: {
            open_bills: bills.filter(bill => ['approved', 'partially_paid', 'overdue'].includes(bill.status) && bill.outstanding > 0).length,
            total_outstanding: bills.reduce((sum, bill) => sum + Math.round(bill.outstanding * 100), 0) / 100,
            overdue_outstanding: bills.filter(bill => bill.status === 'overdue').reduce((sum, bill) => sum + Math.round(bill.outstanding * 100), 0) / 100,
            unrecognized_bills: bills.filter(bill => bill.status === 'draft').length
          },
          controls: {},
          snapshot_watermark: invoices.watermark
        }
      }
      throw new Error('Local Accounts Payable records changed during both snapshot attempts. Refresh before relying on the totals.')
    },
    createDraft(input, operationId) {
      const lines = Array.isArray(input?.lines) ? input.lines : []
      const rounded = (value) => Math.round(Number(value) * 100) / 100
      const normalized = lines.map((line) => {
        const quantity = Number(line.quantity)
        const unitPrice = Number(line.unit_cost)
        const taxRate = Number(line.tax_rate ?? (Number(line.tax_amount || 0) / 100))
        if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(taxRate) || taxRate < 0 || taxRate > 1) {
          throw new Error('Enter a positive invoice quantity, non-negative unit cost and tax rate from 0% to 100%.')
        }
        return { description: String(line.description || '').trim(), quantity: String(quantity), unit_price: String(unitPrice), tax_rate: String(taxRate), expense_account_code: String(line.expense_account_id || '') }
      })
      if (!UUID.test(String(input?.supplier_id || '')) || !input?.invoice_number || !/^\d{4}-\d{2}-\d{2}$/.test(String(input?.invoice_date || '')) || !input?.payable_account_code || !normalized.length) {
        throw new Error('Choose a supplier, payable account and invoice date, then add at least one complete invoice line.')
      }
      const subtotal = rounded(normalized.reduce((sum, line) => sum + rounded(Number(line.quantity) * Number(line.unit_price)), 0))
      const taxTotal = rounded(normalized.reduce((sum, line) => sum + rounded(rounded(Number(line.quantity) * Number(line.unit_price)) * Number(line.tax_rate)), 0))
      const payload = { supplier_id: input.supplier_id, invoice_number: String(input.invoice_number).trim(), invoice_date: input.invoice_date,
        due_date: input.due_date || null, payable_account_code: input.payable_account_code,
        tax_account_code: taxTotal > 0 ? input.tax_account_code : null,
        lines: normalized, subtotal: subtotal.toFixed(2), tax_total: taxTotal.toFixed(2), total: (subtotal + taxTotal).toFixed(2) }
      if (taxTotal > 0 && !payload.tax_account_code) throw new Error('Choose an input tax account when any invoice line includes tax.')
      return submit('accounting.ap.invoice.upsert', payload, operationId)
    },
    approveInvoice(invoiceId, pin, operationId) {
      if (!UUID.test(String(invoiceId || ''))) throw new Error('Refresh the invoice list before approval.')
      return commitApproved('accounting.ap.invoice.approve', { invoice_id: invoiceId }, operationId, pin)
    },
    postPayment(input, pin, operationId) {
      const amount = String(input?.amount || '').trim()
      if (!UUID.test(String(input?.invoice_id || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(input?.payment_date || '')) ||
          !/^\d{1,12}(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || !input?.payment_account_code) {
        throw new Error('Choose an approved invoice, date and active payment asset account, then enter a positive amount.')
      }
      const payload = { invoice_id: input.invoice_id, payment_date: input.payment_date,
        amount: (Math.round(Number(amount) * 100) / 100).toFixed(2), payment_account_code: input.payment_account_code,
        method: ['bank', 'cash', 'card', 'mobile_money', 'other'].includes(input.method) ? input.method : 'bank',
        reference: String(input.reference || '').trim() || null }
      return commitApproved('accounting.ap.payment.post', payload, operationId, pin)
    }
  }
}
