// @ts-check
import { useEffect, useRef, useState } from 'react'
import { centsToMoney, isValidQuantity, moneyToCents } from './tenderMath.js'
import BarLocalFinanceWorkspace from '../BarLocalFinanceWorkspace.jsx'
import BarLocalLoyaltyAdjustment from '../BarLocalLoyaltyAdjustment.jsx'
import BarLocalTipActions from '../BarLocalTipActions.jsx'
import { HposNotice } from '../HposUi.jsx'

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense']
const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical']
const STOCK_MODES = [
  ['receive', 'Receive stock'],
  ['adjust', 'Negative adjustment'],
  ['stocktake', 'Stocktake count'],
  ['waste', 'Waste'],
  ['transfer', 'Transfer to another outlet']
]

function messageOf(error) {
  return error && typeof error === 'object' && typeof error.message === 'string'
    ? error.message
    : 'The local Bar service could not complete that request.'
}

function displayMoney(value) {
  if (value === null || value === undefined || value === '') return '-'
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(2) : String(value)
}

function displayQuantity(value) {
  if (value === null || value === undefined || value === '') return '-'
  const number = Number(value)
  return Number.isFinite(number) ? String(Number(number.toFixed(6))) : String(value)
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7)
}

function minor(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 100) : null
}

/** @param {Array<Record<string, unknown>>} rows @param {string} methodField */
function accountsFor(rows, types) {
  return rows.filter((row) => row.active !== false && types.includes(String(row.type)))
}

/**
 * @param {{
 *   session: Record<string, any>,
 *   capabilities: string[],
 *   shift: Record<string, unknown>|null,
 *   staffRows: Array<Record<string, unknown>>,
 *   customers: Array<Record<string, unknown>>,
 *   version: number,
 *   blocked: boolean,
 *   localReady: boolean,
 *   onCommand: (command: string, payload: Record<string, unknown>) => Promise<unknown>|unknown,
 *   onApprovedCommand: (command: string, payload: Record<string, unknown>, pin: string) => Promise<unknown>|unknown
 * }} props
 */
export default function BarLocalOperationsPanel({ session, capabilities, shift, staffRows, customers, version, blocked, localReady, onCommand, onApprovedCommand }) {
  const canInventoryView = capabilities.includes('inventory.view')
  const canInventoryManage = capabilities.includes('inventory.manage')
  const canCustomers = capabilities.includes('customers.manage')
  const canVouchers = capabilities.includes('vouchers.manage')
  const canAccountingRead = capabilities.includes('accounting.read')
  const canAccountingManage = capabilities.includes('accounting.manage')
  const canStaff = capabilities.includes('staff.manage')
  const canPosManage = capabilities.includes('pos.manage')
  const canReports = capabilities.includes('pos.reports')
  const capabilityKey = capabilities.join('|')

  const tabs = [
    ...(canInventoryView ? [{ id: 'stock', label: 'Stock' }] : []),
    ...(canInventoryView ? [{ id: 'purchasing', label: 'Purchasing' }] : []),
    ...(canCustomers ? [{ id: 'customers', label: 'Customers' }] : []),
    ...(canAccountingRead ? [{ id: 'accounting', label: 'Accounting' }] : []),
    ...(canStaff ? [{ id: 'workforce', label: 'Workforce' }] : []),
    ...(canPosManage ? [{ id: 'control', label: 'Control' }] : [])
  ]
  const [activeTab, setActiveTab] = useState(tabs[0]?.id ?? 'stock')
  const [refreshKey, setRefreshKey] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionMessage, setActionMessage] = useState('')

  const [stockRows, setStockRows] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [stockLotBalances, setStockLotBalances] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [suppliers, setSuppliers] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [purchaseOrders, setPurchaseOrders] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [selectedPo, setSelectedPo] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [customerRows, setCustomerRows] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [vouchers, setVouchers] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [salesRows, setSalesRows] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [expenseRows, setExpenseRows] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [accountRows, setAccountRows] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [trialRows, setTrialRows] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [staffList, setStaffList] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [rosterRows, setRosterRows] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [attendanceRows, setAttendanceRows] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [controlTemplates, setControlTemplates] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [checklists, setChecklists] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [selectedChecklist, setSelectedChecklist] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [incidents, setIncidents] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))

  const [rosterFrom, setRosterFrom] = useState(todayIso())
  const [rosterTo, setRosterTo] = useState(todayIso())
  const [incidentFrom, setIncidentFrom] = useState(todayIso())
  const [incidentTo, setIncidentTo] = useState(todayIso())
  const [trialFrom, setTrialFrom] = useState('')
  const [trialTo, setTrialTo] = useState(todayIso())
  const [expenseFrom, setExpenseFrom] = useState('')
  const [expenseTo, setExpenseTo] = useState(todayIso())

  const [stockForm, setStockForm] = useState({ mode: 'receive', product_id: '', quantity: '', unit_cost: '', supplier_ref: '', lot_code: '', expires_on: '', delta: '', counted_quantity: '', reason: '', to_outlet_id: '', lot_id: '', pin: '' })
  const [lotReleaseForm, setLotReleaseForm] = useState({ lot_id: '', verified_lot_code: '', verified_expires_on: '', no_expiry_confirmed: false, reason: '', pin: '' })
  const [supplierForm, setSupplierForm] = useState({ supplier_id: '', expected_version: '', name: '', contact_name: '', phone: '', email: '', address: '', notes: '', active: true })
  const [poDraft, setPoDraft] = useState({ supplier_id: '', expected_on: '', notes: '', pin: '' })
  const [poLines, setPoLines] = useState(/** @type {Array<{key: string, product_id: string, quantity: string, unit_cost: string, tax_rate: string}>} */ ([{ key: 'line-1', product_id: '', quantity: '', unit_cost: '', tax_rate: '' }]))
  const [poCancelDraft, setPoCancelDraft] = useState({ reason: '', pin: '' })
  const [poReceiveDraft, setPoReceiveDraft] = useState(/** @type {Record<string, {quantity: string, unit_cost: string, lot_code: string, expires_on: string}>} */ ({}))
  const [poReceiveMeta, setPoReceiveMeta] = useState({ supplier_reference: '', notes: '', received_on: todayIso() })
  const [customerForm, setCustomerForm] = useState({ name: '', phone: '', email: '', credit_limit: '0.00' })
  const [creditForm, setCreditForm] = useState({ customer_id: '', amount: '', method: 'cash', reference: '' })
  const [voucherForm, setVoucherForm] = useState({ amount: '', code: '', expires_on: '', customer_id: '', pin: '' })
  const [loyaltyForm, setLoyaltyForm] = useState({ customer_id: '', sale_id: '', points: '', reference: '', mode: 'enrol' })
  const [loyaltyBalance, setLoyaltyBalance] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [loyaltyBalanceAsOf, setLoyaltyBalanceAsOf] = useState('')
  const [loyaltyBalanceError, setLoyaltyBalanceError] = useState('')
  const [loyaltyBalanceLoading, setLoyaltyBalanceLoading] = useState(false)
  const loyaltyBalanceRequest = useRef(0)
  const [expenseForm, setExpenseForm] = useState({ expense_date: todayIso(), category: '', description: '', amount: '', expense_account_code: '', payment_account_code: '', supplier_id: '', reference: '' })
  const [voidForm, setVoidForm] = useState({ expense_id: '', expected_version: '', reason: '', pin: '' })
  const [accountForm, setAccountForm] = useState({ code: '', name: '', type: 'asset', active: true, expected_version: '' })
  const [journalDraft, setJournalDraft] = useState({ entry_date: todayIso(), memo: '', source_type: 'manual', lines: [{ key: 'jl-1', account_code: '', debit: '', credit: '', description: '' }, { key: 'jl-2', account_code: '', debit: '', credit: '', description: '' }] })
  const [periodDraft, setPeriodDraft] = useState({ period: currentMonth(), pin: '' })
  const [rosterForm, setRosterForm] = useState({ staff_id: '', work_date: todayIso(), starts_at: '09:00', ends_at: '17:00', break_minutes: '0', role_label: '', notes: '' })
  const [rosterCancel, setRosterCancel] = useState({ shift_id: '', expected_version: '', reason: '' })
  const [clockForm, setClockForm] = useState({ staff_id: '', workforce_shift_id: '', note: '' })
  const [clockOutForm, setClockOutForm] = useState({ attendance_id: '', note: '' })
  const [staffStatusForm, setStaffStatusForm] = useState({ staff_id: '', status: 'suspended', reason: '', pin: '' })
  const [checklistForm, setChecklistForm] = useState({ template_key: '', checklist_date: todayIso(), shift_id: '' })
  const [checklistNotes, setChecklistNotes] = useState(/** @type {Record<string, string>} */ ({}))
  const [incidentForm, setIncidentForm] = useState({ incident_date: todayIso(), category: '', severity: 'medium', description: '', immediate_action: '' })
  const [incidentResolveForm, setIncidentResolveForm] = useState({ incident_id: '', expected_version: '', resolution: '' })

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) setActiveTab(tabs[0]?.id ?? 'stock')
  }, [capabilityKey])

  const readQuery = async (name, filters = {}) => {
    const result = await window.api.barLocal.query(name, filters)
    if (!result || result.complete !== true || !result.scope || result.scope.business_id !== session.business_id || result.scope.outlet_id !== session.outlet_id) {
      throw new Error(`The ${name} result is incomplete or outside this outlet. Refresh before relying on it.`)
    }
    if (Array.isArray(result.unavailable) && result.unavailable.length > 0) {
      throw new Error(`The ${name} result is incomplete: ${result.unavailable.join(', ')}.`)
    }
    return result.data
  }

  useEffect(() => {
    if (!session) return undefined
    let cancelled = false
    setLoading(true); setLoadError('')
    const run = async () => {
      if (activeTab === 'stock') {
        const [data, lots] = await Promise.all([
          readQuery('stock.list', { limit: 300 }),
          readQuery('stock.lot_balances', { limit: 500 })
        ])
        if (!cancelled) {
          setStockRows(Array.isArray(data) ? data : [])
          setStockLotBalances(Array.isArray(lots) ? lots : [])
        }
      } else if (activeTab === 'purchasing') {
        const [supplierData, poData] = await Promise.all([
          readQuery('suppliers.list', { include_inactive: true, limit: 200 }),
          readQuery('purchase_orders.list', { limit: 100 })
        ])
        if (!cancelled) {
          setSuppliers(Array.isArray(supplierData) ? supplierData : [])
          setPurchaseOrders(Array.isArray(poData) ? poData : [])
          const [stockData, lots] = canInventoryView ? await Promise.all([
            readQuery('stock.list', { limit: 300 }), readQuery('stock.lot_balances', { limit: 500 })
          ]) : [[], []]
          if (!cancelled) {
            setStockRows(Array.isArray(stockData) ? stockData : [])
            setStockLotBalances(Array.isArray(lots) ? lots : [])
          }
        }
      } else if (activeTab === 'customers') {
        const data = await readQuery('customers.list', { limit: 300 })
        if (!cancelled) setCustomerRows(Array.isArray(data) ? data : [])
        if (canVouchers) {
          const voucherData = await readQuery('vouchers.list', { limit: 200 })
          if (!cancelled) setVouchers(Array.isArray(voucherData) ? voucherData : [])
        }
        if (canReports) {
          const saleData = await readQuery('sales.list', { limit: 50 })
          if (!cancelled) setSalesRows(Array.isArray(saleData) ? saleData : [])
        }
      } else if (activeTab === 'accounting') {
        const tasks = [
          readQuery('expenses.list', { from: expenseFrom || undefined, to: expenseTo || undefined, limit: 100 }).then((data) => { if (!cancelled) setExpenseRows(Array.isArray(data) ? data : []) }),
          readQuery('accounting.accounts.list', { include_inactive: true, limit: 300 }).then((data) => { if (!cancelled) setAccountRows(Array.isArray(data) ? data : []) }),
          readQuery('suppliers.list', { include_inactive: true, limit: 200 }).then((data) => { if (!cancelled) setSuppliers(Array.isArray(data) ? data : []) })
        ]
        if (canAccountingRead) {
          tasks.push(readQuery('accounting.trial_balance', { from: trialFrom || undefined, to: trialTo || undefined }).then((data) => { if (!cancelled) setTrialRows(Array.isArray(data) ? data : []) }))
        }
        await Promise.all(tasks)
      } else if (activeTab === 'workforce') {
        const [staffData, rosterData, attendanceData] = await Promise.all([
          readQuery('staff.list', { include_suspended: true }),
          readQuery('workforce.roster', { from: rosterFrom, to: rosterTo, limit: 200 }),
          readQuery('workforce.attendance.current', {})
        ])
        if (!cancelled) {
          setStaffList(Array.isArray(staffData) ? staffData : [])
          setRosterRows(Array.isArray(rosterData) ? rosterData : [])
          setAttendanceRows(Array.isArray(attendanceData) ? attendanceData : [])
        }
        if (canReports) {
          const saleData = await readQuery('sales.list', { limit: 50 })
          if (!cancelled) setSalesRows(Array.isArray(saleData) ? saleData : [])
        }
      } else if (activeTab === 'control') {
        const [templateData, checklistData, incidentData] = await Promise.all([
          readQuery('control.templates.list', {}),
          readQuery('control.checklists.list', { from: incidentFrom, to: incidentTo, limit: 100 }),
          readQuery('control.incidents.list', { from: incidentFrom, to: incidentTo, limit: 100 })
        ])
        if (!cancelled) {
          setControlTemplates(Array.isArray(templateData) ? templateData : [])
          setChecklists(Array.isArray(checklistData) ? checklistData : [])
          setIncidents(Array.isArray(incidentData) ? incidentData : [])
        }
      }
    }
    void run().catch((cause) => { if (!cancelled) setLoadError(messageOf(cause)) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [session, activeTab, version, refreshKey, capabilityKey, rosterFrom, rosterTo, incidentFrom, incidentTo, expenseFrom, expenseTo, trialFrom, trialTo])

  const run = async (command, payload, pin = '') => {
    setActionError(''); setActionMessage('')
    const result = pin
      ? await onApprovedCommand(command, payload, pin)
      : await onCommand(command, payload)
    if (result) {
      setActionMessage('Committed by the local authority.')
      setRefreshKey((key) => key + 1)
    }
    return result
  }

  const selectedStock = stockRows.find((row) => String(row.product_id) === stockForm.product_id)
  const selectedWasteLot = stockLotBalances.find((row) => String(row.lot_id) === stockForm.lot_id)
  const quarantinedLots = stockLotBalances.filter((row) => row.sale_eligible === false && Number(row.remaining_quantity) > 0)

  const submitStock = async (event) => {
    event.preventDefault()
    setActionError(''); setActionMessage('')
    if (!selectedStock) { setActionError('Select the stock product for this movement.'); return }
    const mode = stockForm.mode
    try {
      if (mode === 'receive') {
        if (!isValidQuantity(stockForm.quantity)) throw new Error('Receive quantity must be greater than zero with up to six decimals.')
        if (stockForm.unit_cost.trim() && moneyToCents(stockForm.unit_cost) === null) throw new Error('Unit cost must be a non-negative amount with up to two decimals.')
        if (stockForm.expires_on && !/^\d{4}-\d{2}-\d{2}$/.test(stockForm.expires_on)) throw new Error('Expiry must be a YYYY-MM-DD date.')
        await run('stock.receive', { product_id: selectedStock.product_id, quantity: stockForm.quantity.trim(), unit_cost: stockForm.unit_cost.trim() || undefined, supplier_ref: stockForm.supplier_ref.trim() || undefined, lot_code: stockForm.lot_code.trim() || undefined, expires_on: stockForm.expires_on || undefined })
      } else if (mode === 'adjust') {
        if (!/^-\d+(?:\.\d{1,6})?$/.test(stockForm.delta.trim()) || Number(stockForm.delta) >= 0) throw new Error('Adjustment delta must be a negative quantity with up to six decimals.')
        if (Number(selectedStock.quantity) + Number(stockForm.delta) < 0) throw new Error('This adjustment would make the on-hand balance negative.')
        if (!stockForm.reason.trim()) throw new Error('Enter the reason for the stock adjustment.')
        if (!/^\d{4,12}$/.test(stockForm.pin)) throw new Error('A different manager PIN is required for an adjustment.')
        await run('stock.adjust', { product_id: selectedStock.product_id, delta: stockForm.delta.trim(), reason: stockForm.reason.trim() }, stockForm.pin)
      } else if (mode === 'stocktake') {
        if (!/^\d+(?:\.\d{1,6})?$/.test(stockForm.counted_quantity.trim())) throw new Error('Counted quantity must be zero or greater with up to six decimals.')
        await run('stock.stocktake', { product_id: selectedStock.product_id, counted_quantity: stockForm.counted_quantity.trim(), reason: stockForm.reason.trim() || undefined })
      } else if (mode === 'waste') {
        if (!isValidQuantity(stockForm.quantity)) throw new Error('Waste quantity must be greater than zero with up to six decimals.')
        if (!selectedWasteLot || selectedWasteLot.product_id !== selectedStock.product_id) throw new Error('Select the exact lot being discarded.')
        if (Number(stockForm.quantity) > Number(selectedWasteLot.remaining_quantity)) throw new Error('Waste cannot exceed the selected lot balance.')
        if (!stockForm.reason.trim()) throw new Error('Enter the reason for the waste.')
        if (!/^\d{4,12}$/.test(stockForm.pin)) throw new Error('A different manager PIN is required for waste.')
        await run('stock.lot.waste', { lot_id: selectedWasteLot.lot_id, product_id: selectedStock.product_id, expected_version: Number(selectedWasteLot.version), quantity: stockForm.quantity.trim(), reason: stockForm.reason.trim() }, stockForm.pin)
      } else if (mode === 'transfer') {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stockForm.to_outlet_id.trim())) throw new Error('Enter the destination outlet UUID supplied by your administrator.')
        if (!isValidQuantity(stockForm.quantity)) throw new Error('Transfer quantity must be greater than zero with up to six decimals.')
        if (Number(stockForm.quantity) > Number(selectedStock.quantity)) throw new Error('Transfer cannot exceed the recorded on-hand quantity.')
        if (!stockForm.reason.trim()) throw new Error('Enter the reason for the stock transfer.')
        await run('stock.transfer', { product_id: selectedStock.product_id, to_outlet_id: stockForm.to_outlet_id.trim(), quantity: stockForm.quantity.trim(), reason: stockForm.reason.trim() })
      }
    } catch (cause) { setActionError(messageOf(cause)) }
  }

  const submitLotRelease = async (event) => {
    event.preventDefault(); setActionError(''); setActionMessage('')
    const lot = quarantinedLots.find((row) => String(row.lot_id) === lotReleaseForm.lot_id)
    if (!lot) { setActionError('Select a quarantined return lot to inspect.'); return }
    if (!lotReleaseForm.verified_lot_code.trim()) { setActionError('Enter the lot code confirmed from the product packaging.'); return }
    if (!lotReleaseForm.verified_expires_on && !lotReleaseForm.no_expiry_confirmed) { setActionError('Enter the verified expiry or confirm that the inspected item has no expiry date.'); return }
    if (lotReleaseForm.verified_expires_on && lotReleaseForm.no_expiry_confirmed) { setActionError('Choose either a verified expiry date or no-expiry confirmation, not both.'); return }
    if (!lotReleaseForm.reason.trim()) { setActionError('Record the physical inspection result and reason.'); return }
    if (!/^\d{4,12}$/.test(lotReleaseForm.pin)) { setActionError('A different manager PIN is required to release quarantined stock.'); return }
    await run('stock.lot.release', { lot_id: lot.lot_id, expected_version: Number(lot.version), verified_lot_code: lotReleaseForm.verified_lot_code.trim(), verified_expires_on: lotReleaseForm.verified_expires_on || null, no_expiry_confirmed: lotReleaseForm.no_expiry_confirmed, reason: lotReleaseForm.reason.trim() }, lotReleaseForm.pin)
    setLotReleaseForm({ lot_id: '', verified_lot_code: '', verified_expires_on: '', no_expiry_confirmed: false, reason: '', pin: '' })
  }

  const chooseSupplier = (supplierId) => {
    if (!supplierId) { setSupplierForm({ supplier_id: '', expected_version: '', name: '', contact_name: '', phone: '', email: '', address: '', notes: '', active: true }); return }
    const supplier = suppliers.find((row) => String(row.supplier_id) === supplierId)
    if (!supplier) return
    setSupplierForm({
      supplier_id: supplierId, expected_version: String(supplier.version ?? ''), name: String(supplier.name ?? ''),
      contact_name: String(supplier.contact_name ?? ''), phone: String(supplier.phone ?? ''), email: String(supplier.email ?? ''),
      address: String(supplier.address ?? ''), notes: String(supplier.notes ?? ''), active: supplier.active !== false
    })
  }

  const saveSupplier = async (event) => {
    event.preventDefault()
    setActionError(''); setActionMessage('')
    if (!supplierForm.name.trim()) { setActionError('Enter the supplier name.'); return }
    if (supplierForm.supplier_id && !Number.isSafeInteger(Number(supplierForm.expected_version))) { setActionError('The supplier version is unavailable. Refresh before editing.'); return }
    const payload = {
      supplier_id: supplierForm.supplier_id || undefined,
      expected_version: supplierForm.supplier_id ? Number(supplierForm.expected_version) : undefined,
      name: supplierForm.name.trim(), contact_name: supplierForm.contact_name.trim() || undefined,
      phone: supplierForm.phone.trim() || undefined, email: supplierForm.email.trim() || undefined,
      address: supplierForm.address.trim() || undefined, notes: supplierForm.notes.trim() || undefined,
      active: supplierForm.active
    }
    await run('supplier.upsert', payload)
    setSupplierForm({ supplier_id: '', expected_version: '', name: '', contact_name: '', phone: '', email: '', address: '', notes: '', active: true })
  }

  const submitPurchaseOrder = async (event) => {
    event.preventDefault()
    setActionError(''); setActionMessage('')
    if (!poDraft.supplier_id) { setActionError('Select a supplier for the purchase order.'); return }
    if (!/^\d{4,12}$/.test(poDraft.pin)) { setActionError('A different manager PIN is required to create a purchase order.'); return }
    const lines = poLines.filter((line) => line.product_id)
    if (lines.length === 0) { setActionError('Add at least one product line.'); return }
    const ids = lines.map((line) => line.product_id)
    if (new Set(ids).size !== ids.length) { setActionError('Each product can appear only once on a purchase order.'); return }
    for (const line of lines) {
      if (!isValidQuantity(line.quantity)) { setActionError('Each line quantity must be greater than zero with up to six decimals.'); return }
      if (moneyToCents(line.unit_cost) === null) { setActionError('Each line needs a non-negative unit cost with up to two decimals.'); return }
      if (line.tax_rate.trim() && (moneyToCents(line.tax_rate) === null || Number(line.tax_rate) > 1)) { setActionError('Tax rate must be between 0 and 1.'); return }
    }
    const supplier = suppliers.find((row) => String(row.supplier_id) === poDraft.supplier_id)
    await run('purchase_order.create', {
      supplier_id: poDraft.supplier_id,
      expected_supplier_version: supplier && Number.isSafeInteger(Number(supplier.version)) ? Number(supplier.version) : undefined,
      expected_on: poDraft.expected_on || undefined,
      notes: poDraft.notes.trim() || undefined,
      lines: lines.map((line) => ({ product_id: line.product_id, quantity: line.quantity.trim(), unit_cost: line.unit_cost.trim(), tax_rate: line.tax_rate.trim() || undefined }))
    }, poDraft.pin)
  }

  const loadPurchaseOrder = async (purchaseOrderId) => {
    setActionError(''); setActionMessage(''); setSelectedPo(null)
    try {
      const data = await readQuery('purchase_order.get', { purchase_order_id: purchaseOrderId })
      if (!data || typeof data !== 'object') throw new Error('The purchase order detail is unavailable.')
      setSelectedPo(data)
      const receive = {}
      for (const line of Array.isArray(data.lines) ? data.lines : []) {
        receive[String(line.purchase_order_line_id)] = { quantity: String(line.quantity_remaining ?? ''), unit_cost: '', lot_code: '', expires_on: '' }
      }
      setPoReceiveDraft(receive)
      setPoReceiveMeta({ supplier_reference: '', notes: '', received_on: todayIso() })
      setPoCancelDraft({ reason: '', pin: '' })
    } catch (cause) { setActionError(messageOf(cause)) }
  }

  const cancelPurchaseOrder = async (event) => {
    event.preventDefault()
    if (!selectedPo) return
    if (!poCancelDraft.reason.trim()) { setActionError('Enter the cancellation reason.'); return }
    if (!/^\d{4,12}$/.test(poCancelDraft.pin)) { setActionError('A different manager PIN is required to cancel a purchase order.'); return }
    await run('purchase_order.cancel', { purchase_order_id: selectedPo.purchase_order_id, expected_version: selectedPo.version, reason: poCancelDraft.reason.trim() }, poCancelDraft.pin)
    await loadPurchaseOrder(String(selectedPo.purchase_order_id))
  }

  const receivePurchaseOrder = async (event) => {
    event.preventDefault()
    if (!selectedPo) return
    const lines = (Array.isArray(selectedPo.lines) ? selectedPo.lines : [])
      .map((line) => {
        const draft = poReceiveDraft[String(line.purchase_order_line_id)] ?? { quantity: '', unit_cost: '', lot_code: '', expires_on: '' }
        return { line, draft, quantity: String(draft.quantity ?? '').trim() }
      })
      .filter(({ quantity }) => quantity !== '')
    if (lines.length === 0) { setActionError('Enter received quantities for at least one line.'); return }
    for (const { line, draft, quantity } of lines) {
      if (!isValidQuantity(quantity)) { setActionError('Received quantities must be greater than zero with up to six decimals.'); return }
      if (Number(quantity) > Number(line.quantity_remaining) + 0.000001) { setActionError(`Received quantity for ${String(line.name_snapshot)} exceeds the remaining quantity.`); return }
      if (draft.unit_cost.trim() && moneyToCents(draft.unit_cost) === null) { setActionError('Received unit costs must be non-negative with up to two decimals.'); return }
      if (draft.expires_on && !/^\d{4}-\d{2}-\d{2}$/.test(draft.expires_on)) { setActionError('Expiry must be a YYYY-MM-DD date.'); return }
    }
    await run('purchase_order.receive', {
      purchase_order_id: selectedPo.purchase_order_id,
      expected_version: selectedPo.version,
      supplier_reference: poReceiveMeta.supplier_reference.trim() || undefined,
      notes: poReceiveMeta.notes.trim() || undefined,
      received_on: poReceiveMeta.received_on || undefined,
      lines: lines.map(({ line, draft, quantity }) => ({
        purchase_order_line_id: line.purchase_order_line_id,
        quantity,
        unit_cost: draft.unit_cost.trim() || undefined,
        lot_code: draft.lot_code.trim() || undefined,
        expires_on: draft.expires_on || undefined
      }))
    })
    await loadPurchaseOrder(String(selectedPo.purchase_order_id))
  }

  const createCustomer = async (event) => {
    event.preventDefault()
    if (!customerForm.name.trim()) { setActionError('Enter the customer name.'); return }
    if (moneyToCents(customerForm.credit_limit) === null) { setActionError('Credit limit must be a non-negative amount with up to two decimals.'); return }
    await run('customer.create', { name: customerForm.name.trim(), phone: customerForm.phone.trim() || undefined, email: customerForm.email.trim() || undefined, credit_limit: customerForm.credit_limit.trim() })
    setCustomerForm({ name: '', phone: '', email: '', credit_limit: '0.00' })
  }

  const submitCreditPayment = async (event) => {
    event.preventDefault()
    if (!creditForm.customer_id) { setActionError('Select the customer account receiving the payment.'); return }
    if (!shift) { setActionError('Open a trading shift before recording a credit payment.'); return }
    const amount = moneyToCents(creditForm.amount)
    if (amount === null || amount <= 0) { setActionError('Enter a credit payment greater than zero with up to two decimals.'); return }
    const customer = customerRows.find((row) => String(row.customer_id) === creditForm.customer_id)
    if (customer && amount > minor(customer.outstanding)) { setActionError('The payment cannot exceed the outstanding credit balance.'); return }
    await run('customer.credit.payment', { customer_id: creditForm.customer_id, amount: creditForm.amount.trim(), method: creditForm.method, shift_id: shift.shift_id, reference: creditForm.reference.trim() || undefined })
    setCreditForm({ customer_id: '', amount: '', method: 'cash', reference: '' })
  }

  const issueVoucher = async (event) => {
    event.preventDefault()
    if (moneyToCents(voucherForm.amount) === null || Number(voucherForm.amount) <= 0) { setActionError('Voucher amount must be greater than zero with up to two decimals.'); return }
    if (!/^\d{4,12}$/.test(voucherForm.pin)) { setActionError('A different manager PIN is required to issue a voucher.'); return }
    await run('voucher.issue', {
      amount: voucherForm.amount.trim(), code: voucherForm.code.trim() || undefined,
      expires_on: voucherForm.expires_on || undefined, customer_id: voucherForm.customer_id || undefined
    }, voucherForm.pin)
    setVoucherForm({ amount: '', code: '', expires_on: '', customer_id: '', pin: '' })
  }

  const runLoyalty = async (event) => {
    event.preventDefault()
    if (!loyaltyForm.customer_id) { setActionError('Select the loyalty customer.'); return }
    if (loyaltyForm.mode === 'enrol') {
      await run('loyalty.account.enrol', { customer_id: loyaltyForm.customer_id })
      await refreshLoyaltyBalance(loyaltyForm.customer_id)
      return
    }
    if (!/^[0-9a-f-]{36}$/i.test(loyaltyForm.sale_id.trim())) { setActionError('Enter the sale UUID for loyalty points.'); return }
    if (loyaltyForm.mode === 'earn') {
      await run('loyalty.points.earn', { sale_id: loyaltyForm.sale_id.trim(), customer_id: loyaltyForm.customer_id, reference: loyaltyForm.reference.trim() || undefined })
      await refreshLoyaltyBalance(loyaltyForm.customer_id)
      return
    }
    if (!/^\d+$/.test(loyaltyForm.points.trim()) || Number(loyaltyForm.points) <= 0) { setActionError('Redeem points must be a whole number greater than zero.'); return }
    if (!loyaltyForm.reference.trim()) { setActionError('Enter a reference for the points redemption.'); return }
    await run('loyalty.points.redeem', { customer_id: loyaltyForm.customer_id, points: loyaltyForm.points.trim(), reference: loyaltyForm.reference.trim(), sale_id: loyaltyForm.sale_id.trim() || undefined })
    await refreshLoyaltyBalance(loyaltyForm.customer_id)
  }

  const refreshLoyaltyBalance = async (customerId) => {
    const requestId = ++loyaltyBalanceRequest.current
    if (!customerId) {
      setLoyaltyBalance(null); setLoyaltyBalanceAsOf(''); setLoyaltyBalanceError('')
      setLoyaltyBalanceLoading(false)
      return
    }
    setLoyaltyBalanceLoading(true); setLoyaltyBalanceError('')
    try {
      const result = await window.api.barLocal.query('loyalty.account.get', { customer_id: customerId })
      if (!result || result.complete !== true || !result.scope
        || result.scope.business_id !== session.business_id || result.scope.outlet_id !== session.outlet_id
        || (Array.isArray(result.unavailable) && result.unavailable.length > 0)) {
        throw new Error('The local loyalty balance is incomplete or outside this outlet.')
      }
      if (requestId !== loyaltyBalanceRequest.current) return
      setLoyaltyBalance(result.data && typeof result.data === 'object' ? result.data : null)
      setLoyaltyBalanceAsOf(String(result.as_of ?? ''))
    } catch (cause) {
      if (requestId !== loyaltyBalanceRequest.current) return
      setLoyaltyBalance(null); setLoyaltyBalanceAsOf(''); setLoyaltyBalanceError(cause instanceof Error ? cause.message : 'Loyalty balance is unavailable.')
    } finally {
      if (requestId === loyaltyBalanceRequest.current) setLoyaltyBalanceLoading(false)
    }
  }

  const createExpense = async (event) => {
    event.preventDefault()
    if (!expenseForm.category.trim() || !expenseForm.description.trim()) { setActionError('Enter an expense category and description.'); return }
    if (moneyToCents(expenseForm.amount) === null || Number(expenseForm.amount) <= 0) { setActionError('Expense amount must be greater than zero with up to two decimals.'); return }
    if (!expenseForm.expense_account_code || !expenseForm.payment_account_code) { setActionError('Select the expense and payment accounts from the local chart.'); return }
    await run('expense.create', {
      expense_date: expenseForm.expense_date, category: expenseForm.category.trim(), description: expenseForm.description.trim(),
      amount: expenseForm.amount.trim(), expense_account_code: expenseForm.expense_account_code,
      payment_account_code: expenseForm.payment_account_code, supplier_id: expenseForm.supplier_id || undefined,
      reference: expenseForm.reference.trim() || undefined
    })
    setExpenseForm((draft) => ({ ...draft, category: '', description: '', amount: '', reference: '' }))
  }

  const voidExpense = async (event) => {
    event.preventDefault()
    if (!voidForm.expense_id) { setActionError('Select a posted expense to void.'); return }
    if (!voidForm.reason.trim()) { setActionError('Enter the reason for voiding the expense.'); return }
    if (!/^\d{4,12}$/.test(voidForm.pin)) { setActionError('A different manager PIN is required to void an expense.'); return }
    await run('expense.void', { expense_id: voidForm.expense_id, expected_version: Number(voidForm.expected_version), reason: voidForm.reason.trim() }, voidForm.pin)
    setVoidForm({ expense_id: '', expected_version: '', reason: '', pin: '' })
  }

  const saveAccount = async (event) => {
    event.preventDefault()
    if (!accountForm.code.trim() || !accountForm.name.trim()) { setActionError('Enter an account code and name.'); return }
    if (accountForm.expected_version && !Number.isSafeInteger(Number(accountForm.expected_version))) { setActionError('The account version is unavailable. Refresh before editing.'); return }
    await run('accounting.account.upsert', {
      code: accountForm.code.trim(), name: accountForm.name.trim(), type: accountForm.type, active: accountForm.active,
      expected_version: accountForm.expected_version ? Number(accountForm.expected_version) : undefined
    })
    setAccountForm({ code: '', name: '', type: 'asset', active: true, expected_version: '' })
  }

  const postJournal = async (event) => {
    event.preventDefault()
    if (!journalDraft.memo.trim()) { setActionError('Enter a journal memo.'); return }
    let debit = 0
    let credit = 0
    const lines = []
    for (const line of journalDraft.lines) {
      if (!line.account_code) { setActionError('Every journal line needs an account code.'); return }
      const debitCents = line.debit.trim() ? moneyToCents(line.debit) : 0
      const creditCents = line.credit.trim() ? moneyToCents(line.credit) : 0
      if (debitCents === null || creditCents === null) { setActionError('Journal amounts must be non-negative with up to two decimals.'); return }
      if ((debitCents > 0) === (creditCents > 0)) { setActionError('Each journal line must have either a debit or a credit, not both.'); return }
      debit += debitCents
      credit += creditCents
      lines.push({ account_code: line.account_code, debit: line.debit.trim() || '0.00', credit: line.credit.trim() || '0.00', description: line.description.trim() || undefined })
    }
    if (debit !== credit) { setActionError(`Journal is not balanced: debits ${centsToMoney(debit)} and credits ${centsToMoney(credit)}.`); return }
    await run('accounting.journal.post', { entry_date: journalDraft.entry_date, memo: journalDraft.memo.trim(), lines, source_type: journalDraft.source_type.trim() || 'manual' })
    setJournalDraft((draft) => ({ ...draft, memo: '', lines: [{ key: 'jl-1', account_code: '', debit: '', credit: '', description: '' }, { key: 'jl-2', account_code: '', debit: '', credit: '', description: '' }] }))
  }

  const closePeriod = async (event) => {
    event.preventDefault()
    if (!/^\d{4}-\d{2}$/.test(periodDraft.period)) { setActionError('Enter the period as YYYY-MM.'); return }
    if (!/^\d{4,12}$/.test(periodDraft.pin)) { setActionError('A different manager PIN is required to close a period.'); return }
    await run('accounting.period.close', { period: periodDraft.period }, periodDraft.pin)
    setPeriodDraft((draft) => ({ ...draft, pin: '' }))
  }

  const scheduleShift = async (event) => {
    event.preventDefault()
    if (!rosterForm.staff_id) { setActionError('Select the staff member to schedule.'); return }
    await run('workforce.shift.schedule', {
      staff_id: rosterForm.staff_id, work_date: rosterForm.work_date, starts_at: rosterForm.starts_at, ends_at: rosterForm.ends_at,
      break_minutes: Number(rosterForm.break_minutes || 0), role_label: rosterForm.role_label.trim() || undefined, notes: rosterForm.notes.trim() || undefined
    })
  }

  const cancelRosterShift = async (event) => {
    event.preventDefault()
    if (!rosterCancel.shift_id) { setActionError('Select a scheduled roster shift to cancel.'); return }
    if (!rosterCancel.reason.trim()) { setActionError('Enter the cancellation reason.'); return }
    await run('workforce.shift.cancel', { shift_id: rosterCancel.shift_id, expected_version: Number(rosterCancel.expected_version), reason: rosterCancel.reason.trim() })
    setRosterCancel({ shift_id: '', expected_version: '', reason: '' })
  }

  const clockIn = async (event) => {
    event.preventDefault()
    if (!clockForm.staff_id) { setActionError('Select the staff member clocking in.'); return }
    await run('workforce.clock.in', {
      staff_id: clockForm.staff_id, workforce_shift_id: clockForm.workforce_shift_id || undefined,
      trading_shift_id: shift?.shift_id || undefined, note: clockForm.note.trim() || undefined
    })
  }

  const clockOut = async (event) => {
    event.preventDefault()
    if (!clockOutForm.attendance_id) { setActionError('Select the open attendance record to close.'); return }
    await run('workforce.clock.out', { attendance_id: clockOutForm.attendance_id, note: clockOutForm.note.trim() || undefined })
    setClockOutForm({ attendance_id: '', note: '' })
  }

  const changeStaffStatus = async (event) => {
    event.preventDefault()
    if (!staffStatusForm.staff_id) { setActionError('Select the staff member.'); return }
    if (!staffStatusForm.reason.trim()) { setActionError('Enter the reason for changing this staff status.'); return }
    if (!/^\d{4,12}$/.test(staffStatusForm.pin)) { setActionError('A different manager PIN is required to change staff status.'); return }
    await run('staff.status', { staff_id: staffStatusForm.staff_id, status: staffStatusForm.status, reason: staffStatusForm.reason.trim() }, staffStatusForm.pin)
    setStaffStatusForm({ staff_id: '', status: 'suspended', reason: '', pin: '' })
  }

  const startChecklist = async (event) => {
    event.preventDefault()
    if (!checklistForm.template_key) { setActionError('Select a checklist template.'); return }
    await run('control.checklist.start', { template_key: checklistForm.template_key, checklist_date: checklistForm.checklist_date || undefined, shift_id: checklistForm.shift_id || undefined })
  }

  const loadChecklist = async (checklistId) => {
    setActionError(''); setActionMessage(''); setSelectedChecklist(null)
    try {
      const data = await readQuery('control.checklist.get', { checklist_id: checklistId })
      if (!data || typeof data !== 'object') throw new Error('The checklist detail is unavailable.')
      setSelectedChecklist(data)
      setChecklistNotes({})
    } catch (cause) { setActionError(messageOf(cause)) }
  }

  const setChecklistItem = async (item, completed) => {
    if (!selectedChecklist) return
    const result = await run('control.checklist.item.set', {
      checklist_id: selectedChecklist.checklist_id, item_id: item.item_id, completed,
      note: String(checklistNotes[String(item.item_id)] ?? item.note ?? '').trim() || undefined,
      expected_version: selectedChecklist.version
    })
    if (result) await loadChecklist(String(selectedChecklist.checklist_id))
  }

  const logIncident = async (event) => {
    event.preventDefault()
    if (!incidentForm.category.trim() || !incidentForm.description.trim()) { setActionError('Enter an incident category and description.'); return }
    await run('control.incident.log', {
      incident_date: incidentForm.incident_date || undefined, category: incidentForm.category.trim(),
      severity: incidentForm.severity, description: incidentForm.description.trim(), immediate_action: incidentForm.immediate_action.trim() || undefined
    })
    setIncidentForm((draft) => ({ ...draft, category: '', description: '', immediate_action: '' }))
  }

  const resolveIncident = async (event) => {
    event.preventDefault()
    if (!incidentResolveForm.incident_id) { setActionError('Select the incident to resolve.'); return }
    if (!incidentResolveForm.resolution.trim()) { setActionError('Enter the resolution evidence.'); return }
    await run('control.incident.resolve', { incident_id: incidentResolveForm.incident_id, expected_version: Number(incidentResolveForm.expected_version), resolution: incidentResolveForm.resolution.trim() })
    setIncidentResolveForm({ incident_id: '', expected_version: '', resolution: '' })
  }

  const trialDebit = trialRows.reduce((total, row) => total + (minor(row.debit) ?? 0), 0)
  const trialCredit = trialRows.reduce((total, row) => total + (minor(row.credit) ?? 0), 0)

  return (
    <section className="mt-5 rounded-xl border border-slate-700 bg-slate-950/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Outlet operations</h2>
          <p className="mt-1 text-xs text-slate-400">Local authority workflows for stock, purchasing, customers, accounting, workforce and operational control. Every financial or stock action is atomic and audited.</p>
        </div>
        <button type="button" disabled={blocked || loading} onClick={() => setRefreshKey((key) => key + 1)} className="rounded border border-slate-600 px-3 py-1 text-xs disabled:opacity-40">Refresh</button>
      </div>

      <nav className="mt-4 flex flex-wrap gap-2" aria-label="Operations sections">
        {tabs.map((tab) => <button key={tab.id} type="button" disabled={blocked} onClick={() => { setActiveTab(tab.id); setActionError(''); setActionMessage('') }} className={`rounded border px-3 py-1.5 text-sm ${activeTab === tab.id ? 'border-amber-400 bg-amber-500 font-semibold text-slate-950' : 'border-slate-700 bg-slate-900 text-slate-200'} disabled:opacity-40`}>{tab.label}</button>)}
      </nav>

      {loading && <p className="mt-3 text-xs text-slate-400">Loading the authorized local records...</p>}
      {loadError && <HposNotice tone="error">{loadError}</HposNotice>}
      {actionError && <HposNotice tone="error">{actionError}</HposNotice>}
      {actionMessage && <p role="status" className="mt-3 rounded border border-emerald-700 bg-emerald-950/40 p-3 text-sm text-emerald-100">{actionMessage}</p>}
      {!localReady && <p className="mt-3 rounded border border-amber-700 bg-amber-950/40 p-3 text-xs text-amber-100">Trading readiness is not confirmed. Financial and stock submits stay disabled until the local service reports ready.</p>}

      {activeTab === 'stock' && <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_25rem]">
        <div>
          <h3 className="font-semibold">Stock balances</h3>
          <div className="mt-2 overflow-x-auto rounded border border-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-400"><tr><th className="p-2">Product</th><th className="p-2">SKU</th><th className="p-2">On hand</th><th className="p-2">Tracked</th></tr></thead>
              <tbody>{stockRows.map((row) => <tr key={String(row.product_id)} className="border-t border-slate-800"><td className="p-2">{String(row.name)}</td><td className="p-2 text-slate-400">{String(row.sku)}</td><td className="p-2">{displayQuantity(row.quantity)}</td><td className="p-2">{row.track_stock ? 'Yes' : 'No'}</td></tr>)}</tbody>
            </table>
            {stockRows.length === 0 && <p className="p-3 text-sm text-slate-300">No local stock products are published.</p>}
          </div>
          <p className="mt-2 text-xs text-slate-400">On-hand balances come from the local stock movement ledger. A manager approval is bound to the exact adjustment or waste operation.</p>
        </div>
        <aside className="h-fit rounded-xl border border-slate-700 bg-slate-900 p-4">
          <h3 className="font-semibold">Record a stock movement</h3>
          {!canInventoryManage ? <p className="mt-2 text-sm text-amber-200">Your role can view stock but cannot change it.</p> : <form onSubmit={submitStock} className="mt-2 space-y-2">
            <label className="block text-xs">Movement<select value={stockForm.mode} onChange={(event) => setStockForm((draft) => ({ ...draft, mode: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm">{STOCK_MODES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="block text-xs">Product<select value={stockForm.product_id} onChange={(event) => setStockForm((draft) => ({ ...draft, product_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select a product</option>{stockRows.map((row) => <option key={String(row.product_id)} value={String(row.product_id)}>{String(row.name)} ({String(row.sku)}) - {displayQuantity(row.quantity)}</option>)}</select></label>
            {selectedStock && <p className="text-xs text-slate-400">Current on-hand: {displayQuantity(selectedStock.quantity)}</p>}
            {['receive', 'waste', 'transfer'].includes(stockForm.mode) && <label className="block text-xs">Quantity<input inputMode="decimal" value={stockForm.quantity} onChange={(event) => setStockForm((draft) => ({ ...draft, quantity: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>}
            {stockForm.mode === 'waste' && <label className="block text-xs">Lot to discard<select required value={stockForm.lot_id} onChange={(event) => setStockForm((draft) => ({ ...draft, lot_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select the exact lot</option>{stockLotBalances.filter((row) => row.product_id === selectedStock?.product_id && Number(row.remaining_quantity) > 0).map((row) => <option key={String(row.lot_id)} value={String(row.lot_id)}>{String(row.lot_code || 'Unknown lot')} · {displayQuantity(row.remaining_quantity)} remaining · {String(row.expiry_status)}</option>)}</select></label>}
            {stockForm.mode === 'receive' && <>
              <label className="block text-xs">Unit cost (optional)<input inputMode="decimal" value={stockForm.unit_cost} onChange={(event) => setStockForm((draft) => ({ ...draft, unit_cost: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
              <label className="block text-xs">Supplier reference<input maxLength={160} value={stockForm.supplier_ref} onChange={(event) => setStockForm((draft) => ({ ...draft, supplier_ref: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
              <div className="grid gap-2 sm:grid-cols-2"><label className="text-xs">Lot code<input maxLength={120} value={stockForm.lot_code} onChange={(event) => setStockForm((draft) => ({ ...draft, lot_code: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Expires on<input type="date" value={stockForm.expires_on} onChange={(event) => setStockForm((draft) => ({ ...draft, expires_on: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label></div>
            </>}
            {stockForm.mode === 'adjust' && <label className="block text-xs">Negative delta<input inputMode="decimal" placeholder="-2.000000" value={stockForm.delta} onChange={(event) => setStockForm((draft) => ({ ...draft, delta: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>}
            {stockForm.mode === 'stocktake' && <label className="block text-xs">Counted quantity<input inputMode="decimal" value={stockForm.counted_quantity} onChange={(event) => setStockForm((draft) => ({ ...draft, counted_quantity: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>}
            {stockForm.mode === 'transfer' && <label className="block text-xs">Destination outlet UUID<input value={stockForm.to_outlet_id} onChange={(event) => setStockForm((draft) => ({ ...draft, to_outlet_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 font-mono text-xs" /></label>}
            {stockForm.mode !== 'receive' && <label className="block text-xs">Reason<input maxLength={500} value={stockForm.reason} onChange={(event) => setStockForm((draft) => ({ ...draft, reason: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>}
            {['adjust', 'waste'].includes(stockForm.mode) && <label className="block text-xs">Different manager PIN<input type="password" inputMode="numeric" maxLength={12} autoComplete="off" value={stockForm.pin} onChange={(event) => setStockForm((draft) => ({ ...draft, pin: event.target.value.replace(/\D/g, '') }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>}
            {stockForm.mode === 'transfer' && <p className="text-xs text-amber-200">The destination outlet must belong to the same local authority. Ask your administrator for the target outlet UUID.</p>}
            <button disabled={blocked || !localReady || !selectedStock} className="w-full rounded bg-emerald-600 p-2 text-sm font-semibold disabled:opacity-40">Record stock movement</button>
            {['adjust', 'waste'].includes(stockForm.mode) && <p className="text-xs text-amber-200">Adjustments and waste require a different manager to approve the exact operation.</p>}
          </form>}
        </aside>
        {canInventoryManage && quarantinedLots.length > 0 && <form onSubmit={submitLotRelease} className="lg:col-span-2 rounded-xl border border-amber-800 bg-amber-950/20 p-4">
          <h3 className="font-semibold text-amber-100">Inspect and release a quarantined return</h3>
          <p className="mt-1 text-xs text-slate-300">Physically inspect the returned item and packaging. An expired lot cannot be released. Leave expiry blank only when the item has no expiry date.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs">Quarantined lot<select required value={lotReleaseForm.lot_id} onChange={(event) => setLotReleaseForm((draft) => ({ ...draft, lot_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select a return lot</option>{quarantinedLots.map((row) => <option key={String(row.lot_id)} value={String(row.lot_id)}>{String(row.name)} · {String(row.lot_code || 'unknown lot')} · {displayQuantity(row.remaining_quantity)} remaining</option>)}</select></label><label className="text-xs">Verified lot code<input required maxLength={120} value={lotReleaseForm.verified_lot_code} onChange={(event) => setLotReleaseForm((draft) => ({ ...draft, verified_lot_code: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Verified expiry date (blank only if none)<input type="date" value={lotReleaseForm.verified_expires_on} onChange={(event) => setLotReleaseForm((draft) => ({ ...draft, verified_expires_on: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Different manager PIN<input required type="password" inputMode="numeric" maxLength={12} autoComplete="off" value={lotReleaseForm.pin} onChange={(event) => setLotReleaseForm((draft) => ({ ...draft, pin: event.target.value.replace(/\D/g, '') }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label></div>
          <label className="mt-3 block text-xs">Inspection result and reason<textarea required maxLength={500} value={lotReleaseForm.reason} onChange={(event) => setLotReleaseForm((draft) => ({ ...draft, reason: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
          <label className="mt-3 inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={lotReleaseForm.no_expiry_confirmed} onChange={(event) => setLotReleaseForm((draft) => ({ ...draft, no_expiry_confirmed: event.target.checked }))} />I verified the item has no expiry date</label>
          <button disabled={blocked || !localReady} className="mt-3 rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">Approve and release inspected lot</button>
        </form>}
      </div>}

      {activeTab === 'purchasing' && <div className="mt-4 space-y-5">
        <div className="grid gap-4 lg:grid-cols-2">
          <form onSubmit={saveSupplier} className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h3 className="font-semibold">Supplier record</h3>
            <label className="mt-2 block text-xs">Existing supplier<select value={supplierForm.supplier_id} onChange={(event) => chooseSupplier(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Create a new supplier</option>{suppliers.map((row) => <option key={String(row.supplier_id)} value={String(row.supplier_id)}>{String(row.name)}{row.active === false ? ' (inactive)' : ''}</option>)}</select></label>
            <div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-xs">Name<input maxLength={160} value={supplierForm.name} onChange={(event) => setSupplierForm((draft) => ({ ...draft, name: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Contact<input maxLength={160} value={supplierForm.contact_name} onChange={(event) => setSupplierForm((draft) => ({ ...draft, contact_name: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Phone<input maxLength={40} value={supplierForm.phone} onChange={(event) => setSupplierForm((draft) => ({ ...draft, phone: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Email<input maxLength={200} value={supplierForm.email} onChange={(event) => setSupplierForm((draft) => ({ ...draft, email: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label></div>
            <label className="mt-2 block text-xs">Address<input maxLength={500} value={supplierForm.address} onChange={(event) => setSupplierForm((draft) => ({ ...draft, address: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            <label className="mt-2 block text-xs">Notes<textarea maxLength={2000} value={supplierForm.notes} onChange={(event) => setSupplierForm((draft) => ({ ...draft, notes: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            <label className="mt-2 inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={supplierForm.active} onChange={(event) => setSupplierForm((draft) => ({ ...draft, active: event.target.checked }))} />Active supplier</label>
            <button disabled={blocked || !localReady || !canInventoryManage} className="mt-3 rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">{supplierForm.supplier_id ? 'Save supplier changes' : 'Create supplier'}</button>
            {supplierForm.supplier_id && <p className="mt-2 text-xs text-slate-400">Version {supplierForm.expected_version}. A concurrent edit is rejected; refresh and review it before retrying.</p>}
          </form>

          <form onSubmit={submitPurchaseOrder} className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h3 className="font-semibold">Create purchase order</h3>
            <label className="mt-2 block text-xs">Supplier<select value={poDraft.supplier_id} onChange={(event) => setPoDraft((draft) => ({ ...draft, supplier_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select a supplier</option>{suppliers.filter((row) => row.active !== false).map((row) => <option key={String(row.supplier_id)} value={String(row.supplier_id)}>{String(row.name)}</option>)}</select></label>
            <div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-xs">Expected on<input type="date" value={poDraft.expected_on} onChange={(event) => setPoDraft((draft) => ({ ...draft, expected_on: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Notes<input maxLength={2000} value={poDraft.notes} onChange={(event) => setPoDraft((draft) => ({ ...draft, notes: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label></div>
            <div className="mt-3 space-y-2">{poLines.map((line, index) => <div key={line.key} className="rounded border border-slate-800 p-2"><div className="grid gap-2 sm:grid-cols-2"><label className="text-xs">Product<select value={line.product_id} onChange={(event) => setPoLines((rows) => rows.map((row) => row.key === line.key ? { ...row, product_id: event.target.value } : row))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select product</option>{stockRows.map((row) => <option key={String(row.product_id)} value={String(row.product_id)}>{String(row.name)} ({String(row.sku)})</option>)}</select></label><label className="text-xs">Quantity<input inputMode="decimal" value={line.quantity} onChange={(event) => setPoLines((rows) => rows.map((row) => row.key === line.key ? { ...row, quantity: event.target.value } : row))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label></div><div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-xs">Unit cost<input inputMode="decimal" value={line.unit_cost} onChange={(event) => setPoLines((rows) => rows.map((row) => row.key === line.key ? { ...row, unit_cost: event.target.value } : row))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Tax rate (0-1)<input inputMode="decimal" value={line.tax_rate} onChange={(event) => setPoLines((rows) => rows.map((row) => row.key === line.key ? { ...row, tax_rate: event.target.value } : row))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label></div>{poLines.length > 1 && <button type="button" onClick={() => setPoLines((rows) => rows.filter((row) => row.key !== line.key))} className="mt-1 text-xs text-amber-300">Remove line {index + 1}</button>}</div>)}</div>
            <button type="button" disabled={blocked || poLines.length >= 200} onClick={() => setPoLines((rows) => [...rows, { key: `line-${Date.now()}-${rows.length}`, product_id: '', quantity: '', unit_cost: '', tax_rate: '' }])} className="mt-2 rounded border border-slate-600 px-3 py-1 text-xs disabled:opacity-40">Add line</button>
            <label className="mt-3 block text-xs">Different manager PIN<input type="password" inputMode="numeric" maxLength={12} autoComplete="off" value={poDraft.pin} onChange={(event) => setPoDraft((draft) => ({ ...draft, pin: event.target.value.replace(/\D/g, '') }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            <button disabled={blocked || !localReady || !canInventoryManage} className="mt-3 w-full rounded bg-emerald-600 p-2 text-sm font-semibold disabled:opacity-40">Approve and create purchase order</button>
          </form>
        </div>

        <div className="grid gap-4 lg:grid-cols-[24rem_1fr]">
          <div>
            <div className="flex items-center justify-between"><h3 className="font-semibold">Purchase orders</h3><button type="button" disabled={blocked} onClick={() => setRefreshKey((key) => key + 1)} className="rounded border border-slate-600 px-3 py-1 text-xs disabled:opacity-40">Refresh</button></div>
            <ul className="mt-2 space-y-2">{purchaseOrders.map((row) => <li key={String(row.purchase_order_id)}><button type="button" disabled={blocked} onClick={() => void loadPurchaseOrder(String(row.purchase_order_id))} className={`w-full rounded border p-3 text-left text-sm ${String(selectedPo?.purchase_order_id) === String(row.purchase_order_id) ? 'border-amber-400 bg-amber-950/30' : 'border-slate-700 bg-slate-900'}`}><span className="flex justify-between gap-2"><span className="font-semibold">{String(row.po_number)}</span><span>{displayMoney(row.total)}</span></span><span className="mt-1 block text-xs text-slate-400">{String(row.supplier_name)} - {String(row.status)} - ordered {String(row.ordered_on)}</span></button></li>)}</ul>
            {purchaseOrders.length === 0 && <p className="mt-2 text-sm text-slate-300">No purchase orders are recorded for this outlet.</p>}
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            {!selectedPo ? <p className="text-sm text-slate-300">Select a purchase order to review its lines, receipts, cancel it or receive stock.</p> : <div>
              <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold">{String(selectedPo.po_number)} - {String(selectedPo.status)}</h3><p className="mt-1 text-xs text-slate-400">Supplier {String(selectedPo.supplier?.name)} - ordered {String(selectedPo.ordered_on)} - total {displayMoney(selectedPo.total)} - version {String(selectedPo.version)}</p></div><p className="text-sm font-semibold">{displayMoney(selectedPo.total)}</p></div>
              <div className="mt-3 overflow-x-auto rounded border border-slate-800"><table className="w-full text-left text-sm"><thead className="bg-slate-950 text-xs uppercase tracking-wide text-slate-400"><tr><th className="p-2">Product</th><th className="p-2">Ordered</th><th className="p-2">Received</th><th className="p-2">Remaining</th><th className="p-2">Unit cost</th></tr></thead><tbody>{(Array.isArray(selectedPo.lines) ? selectedPo.lines : []).map((line) => <tr key={String(line.purchase_order_line_id)} className="border-t border-slate-800"><td className="p-2">{String(line.name_snapshot)} <span className="text-xs text-slate-400">{String(line.sku_snapshot)}</span></td><td className="p-2">{displayQuantity(line.quantity_ordered)}</td><td className="p-2">{displayQuantity(line.quantity_received)}</td><td className="p-2">{displayQuantity(line.quantity_remaining)}</td><td className="p-2">{displayMoney(line.unit_cost)}</td></tr>)}</tbody></table></div>

              {selectedPo.status === 'ordered' && <form onSubmit={cancelPurchaseOrder} className="mt-4 rounded border border-rose-800 p-3"><h4 className="text-sm font-semibold text-rose-200">Cancel unreceived purchase order</h4><label className="mt-2 block text-xs">Reason<input maxLength={1000} value={poCancelDraft.reason} onChange={(event) => setPoCancelDraft((draft) => ({ ...draft, reason: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="mt-2 block text-xs">Different manager PIN<input type="password" inputMode="numeric" maxLength={12} autoComplete="off" value={poCancelDraft.pin} onChange={(event) => setPoCancelDraft((draft) => ({ ...draft, pin: event.target.value.replace(/\D/g, '') }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><button disabled={blocked || !localReady} className="mt-2 rounded border border-rose-600 px-3 py-2 text-sm font-semibold text-rose-200 disabled:opacity-40">Approve and cancel order</button></form>}

              {['ordered', 'partially_received'].includes(String(selectedPo.status)) && <form onSubmit={receivePurchaseOrder} className="mt-4 rounded border border-emerald-800 p-3"><h4 className="text-sm font-semibold text-emerald-200">Receive stock against this order</h4><div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-xs">Supplier reference<input maxLength={160} value={poReceiveMeta.supplier_reference} onChange={(event) => setPoReceiveMeta((draft) => ({ ...draft, supplier_reference: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Received on<input type="date" value={poReceiveMeta.received_on} onChange={(event) => setPoReceiveMeta((draft) => ({ ...draft, received_on: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label></div><label className="mt-2 block text-xs">Notes<input maxLength={2000} value={poReceiveMeta.notes} onChange={(event) => setPoReceiveMeta((draft) => ({ ...draft, notes: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
                <div className="mt-2 space-y-2">{(Array.isArray(selectedPo.lines) ? selectedPo.lines : []).map((line) => { const id = String(line.purchase_order_line_id); const draft = poReceiveDraft[id] ?? { quantity: '', unit_cost: '', lot_code: '', expires_on: '' }; return <div key={id} className="rounded border border-slate-800 p-2"><p className="text-xs text-slate-300">{String(line.name_snapshot)} - remaining {displayQuantity(line.quantity_remaining)}</p><div className="mt-1 grid gap-2 sm:grid-cols-2"><label className="text-xs">Quantity<input inputMode="decimal" value={draft.quantity} onChange={(event) => setPoReceiveDraft((rows) => ({ ...rows, [id]: { ...draft, quantity: event.target.value } }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Unit cost<input inputMode="decimal" value={draft.unit_cost} onChange={(event) => setPoReceiveDraft((rows) => ({ ...rows, [id]: { ...draft, unit_cost: event.target.value } }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Lot code<input maxLength={120} value={draft.lot_code} onChange={(event) => setPoReceiveDraft((rows) => ({ ...rows, [id]: { ...draft, lot_code: event.target.value } }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Expires on<input type="date" value={draft.expires_on} onChange={(event) => setPoReceiveDraft((rows) => ({ ...rows, [id]: { ...draft, expires_on: event.target.value } }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label></div></div> })}</div>
                <button disabled={blocked || !localReady || !canInventoryManage} className="mt-3 rounded bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-40">Receive into stock</button>
              </form>}

              {Array.isArray(selectedPo.receipts) && selectedPo.receipts.length > 0 && <div className="mt-4"><h4 className="text-sm font-semibold">Receipts</h4><ul className="mt-2 space-y-1 text-xs">{selectedPo.receipts.map((receipt) => <li key={String(receipt.receipt_id)} className="rounded border border-slate-800 p-2">{String(receipt.received_on)} - {displayMoney(receipt.total)} - {Array.isArray(receipt.lines) ? receipt.lines.length : 0} line(s){receipt.supplier_reference ? ` - ref ${String(receipt.supplier_reference)}` : ''}</li>)}</ul></div>}
            </div>}
          </div>
        </div>
      </div>}

      {activeTab === 'customers' && <div className="mt-4 space-y-5">
        <div className="grid gap-4 lg:grid-cols-3">
          <form onSubmit={createCustomer} className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="font-semibold">Create customer</h3><label className="mt-2 block text-xs">Name<input maxLength={160} value={customerForm.name} onChange={(event) => setCustomerForm((draft) => ({ ...draft, name: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="mt-2 block text-xs">Phone<input maxLength={40} value={customerForm.phone} onChange={(event) => setCustomerForm((draft) => ({ ...draft, phone: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="mt-2 block text-xs">Email<input maxLength={200} value={customerForm.email} onChange={(event) => setCustomerForm((draft) => ({ ...draft, email: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="mt-2 block text-xs">Credit limit<input inputMode="decimal" value={customerForm.credit_limit} onChange={(event) => setCustomerForm((draft) => ({ ...draft, credit_limit: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><button disabled={blocked || !localReady || !canCustomers} className="mt-3 w-full rounded bg-amber-500 p-2 text-sm font-semibold text-slate-950 disabled:opacity-40">Create customer</button></form>

          <form onSubmit={submitCreditPayment} className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="font-semibold">Customer credit payment</h3><label className="mt-2 block text-xs">Customer<select value={creditForm.customer_id} onChange={(event) => setCreditForm((draft) => ({ ...draft, customer_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select customer</option>{customerRows.map((row) => <option key={String(row.customer_id)} value={String(row.customer_id)}>{String(row.name)} - outstanding {displayMoney(row.outstanding)}</option>)}</select></label><label className="mt-2 block text-xs">Amount<input inputMode="decimal" value={creditForm.amount} onChange={(event) => setCreditForm((draft) => ({ ...draft, amount: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="mt-2 block text-xs">Method<select value={creditForm.method} onChange={(event) => setCreditForm((draft) => ({ ...draft, method: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="cash">Cash</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option></select></label><label className="mt-2 block text-xs">Reference<input maxLength={120} value={creditForm.reference} onChange={(event) => setCreditForm((draft) => ({ ...draft, reference: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><button disabled={blocked || !localReady || !shift} className="mt-3 w-full rounded bg-emerald-600 p-2 text-sm font-semibold disabled:opacity-40">Record credit payment</button>{!shift && <p className="mt-2 text-xs text-amber-200">Open a trading shift before taking a credit payment.</p>}</form>

          <form onSubmit={issueVoucher} className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="font-semibold">Issue voucher</h3>{!canVouchers ? <p className="mt-2 text-sm text-slate-300">Your role cannot issue vouchers.</p> : <><label className="mt-2 block text-xs">Amount<input inputMode="decimal" value={voucherForm.amount} onChange={(event) => setVoucherForm((draft) => ({ ...draft, amount: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="mt-2 block text-xs">Code (optional)<input maxLength={60} value={voucherForm.code} onChange={(event) => setVoucherForm((draft) => ({ ...draft, code: event.target.value.toUpperCase() }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-xs">Expires on<input type="date" value={voucherForm.expires_on} onChange={(event) => setVoucherForm((draft) => ({ ...draft, expires_on: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Customer (optional)<select value={voucherForm.customer_id} onChange={(event) => setVoucherForm((draft) => ({ ...draft, customer_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Unassigned</option>{customerRows.map((row) => <option key={String(row.customer_id)} value={String(row.customer_id)}>{String(row.name)}</option>)}</select></label></div><label className="mt-2 block text-xs">Different manager PIN<input type="password" inputMode="numeric" maxLength={12} autoComplete="off" value={voucherForm.pin} onChange={(event) => setVoucherForm((draft) => ({ ...draft, pin: event.target.value.replace(/\D/g, '') }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><button disabled={blocked || !localReady} className="mt-3 w-full rounded bg-sky-600 p-2 text-sm font-semibold disabled:opacity-40">Approve and issue voucher</button></>}</form>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="font-semibold">Customer accounts</h3><div className="mt-2 overflow-x-auto rounded border border-slate-800"><table className="w-full text-left text-sm"><thead className="bg-slate-950 text-xs uppercase tracking-wide text-slate-400"><tr><th className="p-2">Name</th><th className="p-2">Phone</th><th className="p-2">Outstanding</th><th className="p-2">Limit</th><th className="p-2">Status</th></tr></thead><tbody>{customerRows.map((row) => <tr key={String(row.customer_id)} className="border-t border-slate-800"><td className="p-2">{String(row.name)}</td><td className="p-2 text-slate-400">{String(row.phone || '-')}</td><td className="p-2">{displayMoney(row.outstanding)}</td><td className="p-2">{displayMoney(row.credit_limit)}</td><td className="p-2">{String(row.status)}</td></tr>)}</tbody></table>{customerRows.length === 0 && <p className="p-3 text-sm text-slate-300">No customer accounts are recorded.</p>}</div></div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="font-semibold">Vouchers</h3>{canVouchers ? <div className="mt-2 overflow-x-auto rounded border border-slate-800"><table className="w-full text-left text-sm"><thead className="bg-slate-950 text-xs uppercase tracking-wide text-slate-400"><tr><th className="p-2">Code</th><th className="p-2">Initial</th><th className="p-2">Balance</th><th className="p-2">Status</th><th className="p-2">Expires</th></tr></thead><tbody>{vouchers.map((row) => <tr key={String(row.voucher_id)} className="border-t border-slate-800"><td className="p-2 font-mono text-xs">{String(row.code)}</td><td className="p-2">{displayMoney(row.initial_amount)}</td><td className="p-2">{displayMoney(row.balance)}</td><td className="p-2">{String(row.status)}</td><td className="p-2">{String(row.expires_on || '-')}</td></tr>)}</tbody></table>{vouchers.length === 0 && <p className="p-3 text-sm text-slate-300">No vouchers are recorded.</p>}</div> : <p className="mt-2 text-sm text-slate-300">Voucher listing requires the vouchers capability and the multi-outlet growth feature.</p>}</div>
        </div>

          <form onSubmit={runLoyalty} className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="font-semibold">Loyalty</h3><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5"><label className="text-xs">Action<select value={loyaltyForm.mode} onChange={(event) => setLoyaltyForm((draft) => ({ ...draft, mode: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="enrol">Enrol customer</option><option value="earn">Earn points</option><option value="redeem">Redeem points</option></select></label><label className="text-xs">Customer<select value={loyaltyForm.customer_id} onChange={(event) => { const id = event.target.value; setLoyaltyForm((draft) => ({ ...draft, customer_id: id })); void refreshLoyaltyBalance(id) }} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select customer</option>{customerRows.map((row) => <option key={String(row.customer_id)} value={String(row.customer_id)}>{String(row.name)}</option>)}</select></label>{loyaltyForm.mode !== 'enrol' && <label className="text-xs">Sale<select value={loyaltyForm.sale_id} onChange={(event) => setLoyaltyForm((draft) => ({ ...draft, sale_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select a recent sale</option>{salesRows.map((row) => <option key={String(row.sale_id)} value={String(row.sale_id)}>Receipt {String(row.receipt_number)} - {displayMoney(row.total)}</option>)}</select></label>}{loyaltyForm.mode === 'redeem' && <label className="text-xs">Points<input inputMode="numeric" value={loyaltyForm.points} onChange={(event) => setLoyaltyForm((draft) => ({ ...draft, points: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>}<label className="text-xs">Reference<input maxLength={200} value={loyaltyForm.reference} onChange={(event) => setLoyaltyForm((draft) => ({ ...draft, reference: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label></div>{loyaltyBalanceLoading && <p role="status" className="mt-2 text-xs text-slate-300">Checking the local loyalty balance…</p>}{loyaltyBalanceError && <p role="alert" className="mt-2 text-xs text-amber-200">{loyaltyBalanceError}</p>}{loyaltyForm.customer_id && !loyaltyBalanceLoading && !loyaltyBalanceError && <p role="status" className="mt-2 rounded border border-slate-700 bg-slate-950 p-2 text-xs">{loyaltyBalance ? `${String(loyaltyBalance.points_balance)} points · ${String(loyaltyBalance.status)} · checked ${loyaltyBalanceAsOf || 'time unavailable'}` : 'This customer is not enrolled in the local loyalty programme.'}</p>}<button disabled={blocked || !localReady} className="mt-3 rounded bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-40">Record loyalty action</button><p className="mt-2 text-xs text-slate-400">This is a current service read, not a promise that redemption will be accepted. The local authority rechecks balance and programme rules when the operation commits. Earn uses a completed sale exactly once.</p></form>
      </div>}

      {activeTab === 'accounting' && <div className="mt-4 space-y-5">
        <div className="grid gap-4 lg:grid-cols-2">
          <form onSubmit={createExpense} className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="font-semibold">Record expense</h3><div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-xs">Date<input type="date" value={expenseForm.expense_date} onChange={(event) => setExpenseForm((draft) => ({ ...draft, expense_date: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Category<input maxLength={80} value={expenseForm.category} onChange={(event) => setExpenseForm((draft) => ({ ...draft, category: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label></div><label className="mt-2 block text-xs">Description<textarea maxLength={500} value={expenseForm.description} onChange={(event) => setExpenseForm((draft) => ({ ...draft, description: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-xs">Amount<input inputMode="decimal" value={expenseForm.amount} onChange={(event) => setExpenseForm((draft) => ({ ...draft, amount: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Expense account<select value={expenseForm.expense_account_code} onChange={(event) => setExpenseForm((draft) => ({ ...draft, expense_account_code: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select expense account</option>{accountsFor(accountRows, ['expense']).map((row) => <option key={String(row.account_code)} value={String(row.account_code)}>{String(row.account_code)} - {String(row.name)}</option>)}</select></label><label className="text-xs">Payment account<select value={expenseForm.payment_account_code} onChange={(event) => setExpenseForm((draft) => ({ ...draft, payment_account_code: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select payment account</option>{accountsFor(accountRows, ['asset', 'liability']).map((row) => <option key={String(row.account_code)} value={String(row.account_code)}>{String(row.account_code)} - {String(row.name)}</option>)}</select></label><label className="text-xs">Supplier (optional)<select value={expenseForm.supplier_id} onChange={(event) => setExpenseForm((draft) => ({ ...draft, supplier_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">No supplier</option>{suppliers.map((row) => <option key={String(row.supplier_id)} value={String(row.supplier_id)}>{String(row.name)}</option>)}</select></label><label className="text-xs">Reference<input maxLength={120} value={expenseForm.reference} onChange={(event) => setExpenseForm((draft) => ({ ...draft, reference: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label></div><button disabled={blocked || !localReady || !canAccountingManage} className="mt-3 rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">Post expense</button>{!canAccountingManage && <p className="mt-2 text-xs text-amber-200">Your role has read-only accounting access.</p>}</form>

          <form onSubmit={saveAccount} className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="font-semibold">Chart of accounts</h3><div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-xs">Code<input maxLength={32} value={accountForm.code} onChange={(event) => setAccountForm((draft) => ({ ...draft, code: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Name<input maxLength={120} value={accountForm.name} onChange={(event) => setAccountForm((draft) => ({ ...draft, name: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Type<select value={accountForm.type} onChange={(event) => setAccountForm((draft) => ({ ...draft, type: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm">{ACCOUNT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label><label className="text-xs">Active<select value={accountForm.active ? 'yes' : 'no'} onChange={(event) => setAccountForm((draft) => ({ ...draft, active: event.target.value === 'yes' }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="yes">Active</option><option value="no">Inactive</option></select></label></div><button disabled={blocked || !localReady || !canAccountingManage} className="mt-3 rounded bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-40">{accountForm.expected_version ? 'Save account changes' : 'Create or update account'}</button>{accountForm.expected_version && <p className="mt-2 text-xs text-slate-400">Editing version {accountForm.expected_version}. A concurrent edit is rejected.</p>}<button type="button" onClick={() => setAccountForm({ code: '', name: '', type: 'asset', active: true, expected_version: '' })} className="ml-2 mt-3 rounded border border-slate-600 px-3 py-2 text-sm">New account</button></form>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Expenses</h3><div className="flex gap-2"><input type="date" value={expenseFrom} onChange={(event) => setExpenseFrom(event.target.value)} className="rounded bg-slate-800 p-1 text-xs" aria-label="Expense from date" /><input type="date" value={expenseTo} onChange={(event) => setExpenseTo(event.target.value)} className="rounded bg-slate-800 p-1 text-xs" aria-label="Expense to date" /></div></div><ul className="mt-2 max-h-72 space-y-5 overflow-auto">{expenseRows.map((row) => <li key={String(row.expense_id)} className="rounded border border-slate-800 p-2 text-sm"><div className="flex justify-between gap-2"><span className="font-medium">{String(row.category)} - {displayMoney(row.amount)}</span><span className="text-xs">{String(row.status)}</span></div><p className="mt-1 text-xs text-slate-400">{String(row.expense_date)} - {String(row.description)} - v{String(row.version)}</p><button type="button" disabled={blocked || row.status !== 'posted'} onClick={() => setVoidForm({ expense_id: String(row.expense_id), expected_version: String(row.version), reason: '', pin: '' })} className="mt-1 text-xs text-amber-300 disabled:opacity-40">Void this expense</button></li>)}</ul>{expenseRows.length === 0 && <p className="mt-2 text-sm text-slate-300">No expenses in this period.</p>}
            {voidForm.expense_id && <form onSubmit={voidExpense} className="mt-3 rounded border border-rose-800 p-3"><h4 className="text-sm font-semibold text-rose-200">Void expense</h4><label className="mt-2 block text-xs">Reason<input maxLength={500} value={voidForm.reason} onChange={(event) => setVoidForm((draft) => ({ ...draft, reason: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="mt-2 block text-xs">Different manager PIN<input type="password" inputMode="numeric" maxLength={12} autoComplete="off" value={voidForm.pin} onChange={(event) => setVoidForm((draft) => ({ ...draft, pin: event.target.value.replace(/\D/g, '') }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><div className="mt-2 flex gap-2"><button disabled={blocked || !localReady} className="rounded border border-rose-600 px-3 py-2 text-sm font-semibold text-rose-200 disabled:opacity-40">Approve and void</button><button type="button" onClick={() => setVoidForm({ expense_id: '', expected_version: '', reason: '', pin: '' })} className="rounded border border-slate-600 px-3 py-2 text-sm">Cancel</button></div></form>}
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Trial balance</h3><div className="flex gap-2"><input type="date" value={trialFrom} onChange={(event) => setTrialFrom(event.target.value)} className="rounded bg-slate-800 p-1 text-xs" aria-label="Trial balance from date" /><input type="date" value={trialTo} onChange={(event) => setTrialTo(event.target.value)} className="rounded bg-slate-800 p-1 text-xs" aria-label="Trial balance to date" /></div></div><p className={`mt-2 text-xs ${trialDebit === trialCredit ? 'text-emerald-200' : 'text-amber-200'}`}>Debits {centsToMoney(trialDebit)} - credits {centsToMoney(trialCredit)} - {trialDebit === trialCredit ? 'balanced' : 'not balanced'}</p><div className="mt-2 max-h-72 overflow-auto rounded border border-slate-800"><table className="w-full text-left text-xs"><thead className="bg-slate-950 uppercase tracking-wide text-slate-400"><tr><th className="p-2">Account</th><th className="p-2">Debit</th><th className="p-2">Credit</th><th className="p-2">Balance</th></tr></thead><tbody>{trialRows.map((row) => <tr key={String(row.account_code)} className="border-t border-slate-800"><td className="p-2">{String(row.account_code)} {String(row.name)}</td><td className="p-2">{displayMoney(row.debit)}</td><td className="p-2">{displayMoney(row.credit)}</td><td className="p-2">{displayMoney(row.balance)}</td></tr>)}</tbody></table></div><button type="button" disabled={loading} onClick={() => setRefreshKey((key) => key + 1)} className="mt-2 rounded border border-slate-600 px-3 py-1 text-xs disabled:opacity-40">Reload trial balance</button></div>
        </div>

        <form onSubmit={postJournal} className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="font-semibold">Manual journal</h3><div className="mt-2 grid gap-2 sm:grid-cols-3"><label className="text-xs">Entry date<input type="date" value={journalDraft.entry_date} onChange={(event) => setJournalDraft((draft) => ({ ...draft, entry_date: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Source type<input maxLength={60} value={journalDraft.source_type} onChange={(event) => setJournalDraft((draft) => ({ ...draft, source_type: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Memo<input maxLength={1000} value={journalDraft.memo} onChange={(event) => setJournalDraft((draft) => ({ ...draft, memo: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label></div><div className="mt-3 space-y-2">{journalDraft.lines.map((line, index) => <div key={line.key} className="grid gap-2 rounded border border-slate-800 p-2 sm:grid-cols-4"><label className="text-xs">Account<select value={line.account_code} onChange={(event) => setJournalDraft((draft) => ({ ...draft, lines: draft.lines.map((row) => row.key === line.key ? { ...row, account_code: event.target.value } : row) }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select account</option>{accountsFor(accountRows, ACCOUNT_TYPES).map((row) => <option key={String(row.account_code)} value={String(row.account_code)}>{String(row.account_code)} - {String(row.name)}</option>)}</select></label><label className="text-xs">Debit<input inputMode="decimal" value={line.debit} onChange={(event) => setJournalDraft((draft) => ({ ...draft, lines: draft.lines.map((row) => row.key === line.key ? { ...row, debit: event.target.value, credit: event.target.value ? '' : row.credit } : row) }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Credit<input inputMode="decimal" value={line.credit} onChange={(event) => setJournalDraft((draft) => ({ ...draft, lines: draft.lines.map((row) => row.key === line.key ? { ...row, credit: event.target.value, debit: event.target.value ? '' : row.debit } : row) }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Description<input maxLength={500} value={line.description} onChange={(event) => setJournalDraft((draft) => ({ ...draft, lines: draft.lines.map((row) => row.key === line.key ? { ...row, description: event.target.value } : row) }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>{journalDraft.lines.length > 2 && <button type="button" onClick={() => setJournalDraft((draft) => ({ ...draft, lines: draft.lines.filter((row) => row.key !== line.key) }))} className="text-left text-xs text-amber-300 sm:col-span-4">Remove line {index + 1}</button>}</div>)}</div><button type="button" disabled={blocked || journalDraft.lines.length >= 500} onClick={() => setJournalDraft((draft) => ({ ...draft, lines: [...draft.lines, { key: `jl-${Date.now()}-${draft.lines.length}`, account_code: '', debit: '', credit: '', description: '' }] }))} className="mt-2 rounded border border-slate-600 px-3 py-1 text-xs disabled:opacity-40">Add journal line</button><button disabled={blocked || !localReady || !canAccountingManage} className="ml-2 mt-2 rounded bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-40">Post balanced journal</button></form>

        <form onSubmit={closePeriod} className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="font-semibold">Close accounting period</h3><div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-xs">Period<input type="month" value={periodDraft.period} onChange={(event) => setPeriodDraft((draft) => ({ ...draft, period: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Different manager PIN<input type="password" inputMode="numeric" maxLength={12} autoComplete="off" value={periodDraft.pin} onChange={(event) => setPeriodDraft((draft) => ({ ...draft, pin: event.target.value.replace(/\D/g, '') }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label></div><button disabled={blocked || !localReady || !canAccountingManage} className="mt-3 rounded bg-amber-600 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">Approve and close period</button><p className="mt-2 text-xs text-slate-400">Closing is irreversible for the period. The local service requires balanced postings and maker-checker approval.</p></form>
      </div>}

      {activeTab === 'workforce' && <div className="mt-4 space-y-5">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="font-semibold">Staff</h3><ul className="mt-2 max-h-64 space-y-2 overflow-auto">{staffList.map((row) => <li key={String(row.staff_id)} className="rounded border border-slate-800 p-2 text-sm"><div className="flex justify-between gap-2"><span className="font-medium">{String(row.display_name)}</span><span className="text-xs">{String(row.role)} - {String(row.status)}</span></div><p className="mt-1 font-mono text-[10px] text-slate-500">{String(row.staff_id)}</p><button type="button" disabled={blocked} onClick={() => setStaffStatusForm({ staff_id: String(row.staff_id), status: row.status === 'active' ? 'suspended' : 'active', reason: '', pin: '' })} className="mt-1 text-xs text-amber-300 disabled:opacity-40">{row.status === 'active' ? 'Suspend staff member' : 'Reactivate staff member'}</button></li>)}</ul>{staffList.length === 0 && <p className="mt-2 text-sm text-slate-300">No staff records are loaded.</p>}
            {staffStatusForm.staff_id && <form onSubmit={changeStaffStatus} className="mt-3 rounded border border-rose-800 p-3"><h4 className="text-sm font-semibold">{staffStatusForm.status === 'suspended' ? 'Suspend staff member' : 'Reactivate staff member'}</h4><label className="mt-2 block text-xs">Reason<input maxLength={500} value={staffStatusForm.reason} onChange={(event) => setStaffStatusForm((draft) => ({ ...draft, reason: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="mt-2 block text-xs">Different manager PIN<input type="password" inputMode="numeric" maxLength={12} autoComplete="off" value={staffStatusForm.pin} onChange={(event) => setStaffStatusForm((draft) => ({ ...draft, pin: event.target.value.replace(/\D/g, '') }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><div className="mt-2 flex gap-2"><button disabled={blocked || !localReady} className="rounded border border-amber-600 px-3 py-2 text-sm font-semibold disabled:opacity-40">Approve status change</button><button type="button" onClick={() => setStaffStatusForm({ staff_id: '', status: 'suspended', reason: '', pin: '' })} className="rounded border border-slate-600 px-3 py-2 text-sm">Cancel</button></div></form>}
          </div>

        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Roster</h3><div className="flex gap-2"><input type="date" value={rosterFrom} onChange={(event) => setRosterFrom(event.target.value)} className="rounded bg-slate-800 p-1 text-xs" aria-label="Roster from date" /><input type="date" value={rosterTo} onChange={(event) => setRosterTo(event.target.value)} className="rounded bg-slate-800 p-1 text-xs" aria-label="Roster to date" /></div></div><div className="mt-2 overflow-x-auto rounded border border-slate-800"><table className="w-full text-left text-sm"><thead className="bg-slate-950 text-xs uppercase tracking-wide text-slate-400"><tr><th className="p-2">Date</th><th className="p-2">Staff</th><th className="p-2">Time</th><th className="p-2">Break</th><th className="p-2">Status</th><th className="p-2">Action</th></tr></thead><tbody>{rosterRows.map((row) => <tr key={String(row.shift_id)} className="border-t border-slate-800"><td className="p-2">{String(row.work_date)}</td><td className="p-2">{String(row.display_name)}</td><td className="p-2">{String(row.starts_at)}-{String(row.ends_at)}</td><td className="p-2">{String(row.break_minutes)} min</td><td className="p-2">{String(row.status)}</td><td className="p-2">{row.status === 'scheduled' && <button type="button" disabled={blocked} onClick={() => setRosterCancel({ shift_id: String(row.shift_id), expected_version: String(row.version), reason: '' })} className="text-xs text-amber-300 disabled:opacity-40">Cancel</button>}</td></tr>)}</tbody></table>{rosterRows.length === 0 && <p className="p-3 text-sm text-slate-300">No roster shifts in this period.</p>}</div>
          <form onSubmit={scheduleShift} className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs">Staff<select value={rosterForm.staff_id} onChange={(event) => setRosterForm((draft) => ({ ...draft, staff_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select active staff</option>{staffList.filter((row) => row.status === 'active').map((row) => <option key={String(row.staff_id)} value={String(row.staff_id)}>{String(row.display_name)}</option>)}</select></label><label className="text-xs">Date<input type="date" value={rosterForm.work_date} onChange={(event) => setRosterForm((draft) => ({ ...draft, work_date: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Starts<input type="time" value={rosterForm.starts_at} onChange={(event) => setRosterForm((draft) => ({ ...draft, starts_at: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Ends<input type="time" value={rosterForm.ends_at} onChange={(event) => setRosterForm((draft) => ({ ...draft, ends_at: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Break minutes<input inputMode="numeric" value={rosterForm.break_minutes} onChange={(event) => setRosterForm((draft) => ({ ...draft, break_minutes: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Role label<input maxLength={80} value={rosterForm.role_label} onChange={(event) => setRosterForm((draft) => ({ ...draft, role_label: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs sm:col-span-2">Notes<input maxLength={500} value={rosterForm.notes} onChange={(event) => setRosterForm((draft) => ({ ...draft, notes: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><button disabled={blocked || !localReady} className="self-end rounded bg-amber-500 p-2 text-sm font-semibold text-slate-950 disabled:opacity-40">Schedule shift</button></form>
          {rosterCancel.shift_id && <form onSubmit={cancelRosterShift} className="mt-3 rounded border border-rose-800 p-3"><h4 className="text-sm font-semibold text-rose-200">Cancel roster shift</h4><div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-xs">Reason<input maxLength={500} value={rosterCancel.reason} onChange={(event) => setRosterCancel((draft) => ({ ...draft, reason: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><div className="flex items-end gap-2"><button disabled={blocked || !localReady} className="rounded border border-rose-600 px-3 py-2 text-sm font-semibold text-rose-200 disabled:opacity-40">Cancel shift</button><button type="button" onClick={() => setRosterCancel({ shift_id: '', expected_version: '', reason: '' })} className="rounded border border-slate-600 px-3 py-2 text-sm">Keep shift</button></div></div></form>}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="font-semibold">Clock in</h3><form onSubmit={clockIn} className="mt-2 space-y-2"><label className="block text-xs">Staff<select value={clockForm.staff_id} onChange={(event) => setClockForm((draft) => ({ ...draft, staff_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select active staff</option>{staffList.filter((row) => row.status === 'active').map((row) => <option key={String(row.staff_id)} value={String(row.staff_id)}>{String(row.display_name)}</option>)}</select></label><label className="block text-xs">Roster shift (optional)<select value={clockForm.workforce_shift_id} onChange={(event) => setClockForm((draft) => ({ ...draft, workforce_shift_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">No linked roster shift</option>{rosterRows.filter((row) => row.status === 'scheduled' && (!clockForm.staff_id || String(row.staff_id) === clockForm.staff_id)).map((row) => <option key={String(row.shift_id)} value={String(row.shift_id)}>{String(row.work_date)} {String(row.starts_at)}-{String(row.ends_at)} - {String(row.display_name)}</option>)}</select></label><label className="block text-xs">Note<input maxLength={500} value={clockForm.note} onChange={(event) => setClockForm((draft) => ({ ...draft, note: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><button disabled={blocked || !localReady || !shift} className="w-full rounded bg-emerald-600 p-2 text-sm font-semibold disabled:opacity-40">Clock in</button>{!shift && <p className="text-xs text-amber-200">Open a trading shift before clocking staff in against it.</p>}</form></div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="font-semibold">Open attendance</h3><ul className="mt-2 max-h-48 space-y-2 overflow-auto">{attendanceRows.map((row) => <li key={String(row.attendance_id)} className="rounded border border-slate-800 p-2 text-sm"><div className="flex justify-between gap-2"><span>{String(row.display_name)}</span><span className="text-xs">{String(row.clocked_in_at)}</span></div><button type="button" disabled={blocked} onClick={() => setClockOutForm((draft) => ({ ...draft, attendance_id: String(row.attendance_id) }))} className="mt-1 text-xs text-amber-300 disabled:opacity-40">Close this attendance</button></li>)}</ul>{attendanceRows.length === 0 && <p className="mt-2 text-sm text-slate-300">No open attendance records.</p>}{clockOutForm.attendance_id && <form onSubmit={clockOut} className="mt-2 rounded border border-slate-700 p-2"><label className="block text-xs">Clock-out note<input maxLength={500} value={clockOutForm.note} onChange={(event) => setClockOutForm((draft) => ({ ...draft, note: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><button disabled={blocked || !localReady} className="mt-2 rounded bg-amber-600 px-3 py-1.5 text-sm font-semibold text-slate-950 disabled:opacity-40">Clock out</button></form>}</div>
        </div>
      </div>}

      {activeTab === 'control' && <div className="mt-4 space-y-5">
        <div className="grid gap-4 lg:grid-cols-2">
          <form onSubmit={startChecklist} className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="font-semibold">Start checklist</h3><label className="mt-2 block text-xs">Template<select value={checklistForm.template_key} onChange={(event) => setChecklistForm((draft) => ({ ...draft, template_key: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select a template</option>{controlTemplates.map((row) => <option key={String(row.template_key)} value={String(row.template_key)}>{String(row.name)} - {String(row.checklist_type)}</option>)}</select></label><div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-xs">Date<input type="date" value={checklistForm.checklist_date} onChange={(event) => setChecklistForm((draft) => ({ ...draft, checklist_date: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Trading shift (optional)<input aria-label="Trading shift UUID" value={checklistForm.shift_id} onChange={(event) => setChecklistForm((draft) => ({ ...draft, shift_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 font-mono text-xs" placeholder={shift ? String(shift.shift_id) : 'Shift UUID'} /></label></div><button type="button" disabled={blocked || !shift || !checklistForm.shift_id} onClick={() => setChecklistForm((draft) => ({ ...draft, shift_id: String(shift?.shift_id ?? '') }))} className="mt-2 text-xs text-amber-300 disabled:opacity-40">Use current shift</button><button disabled={blocked || !localReady} className="mt-3 w-full rounded bg-amber-500 p-2 text-sm font-semibold text-slate-950 disabled:opacity-40">Start checklist</button></form>

          <form onSubmit={logIncident} className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="font-semibold">Log incident</h3><div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-xs">Date<input type="date" value={incidentForm.incident_date} onChange={(event) => setIncidentForm((draft) => ({ ...draft, incident_date: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Severity<select value={incidentForm.severity} onChange={(event) => setIncidentForm((draft) => ({ ...draft, severity: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm">{INCIDENT_SEVERITIES.map((severity) => <option key={severity} value={severity}>{severity}</option>)}</select></label></div><label className="mt-2 block text-xs">Category<input maxLength={80} value={incidentForm.category} onChange={(event) => setIncidentForm((draft) => ({ ...draft, category: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="mt-2 block text-xs">Description<textarea maxLength={2000} value={incidentForm.description} onChange={(event) => setIncidentForm((draft) => ({ ...draft, description: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="mt-2 block text-xs">Immediate action<input maxLength={1000} value={incidentForm.immediate_action} onChange={(event) => setIncidentForm((draft) => ({ ...draft, immediate_action: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><button disabled={blocked || !localReady} className="mt-3 rounded bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-40">Log incident</button></form>
        </div>

        <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Checklists</h3><div className="flex gap-2"><input type="date" value={incidentFrom} onChange={(event) => setIncidentFrom(event.target.value)} className="rounded bg-slate-800 p-1 text-xs" aria-label="Checklist from date" /><input type="date" value={incidentTo} onChange={(event) => setIncidentTo(event.target.value)} className="rounded bg-slate-800 p-1 text-xs" aria-label="Checklist to date" /></div></div><ul className="mt-2 max-h-64 space-y-2 overflow-auto">{checklists.map((row) => <li key={String(row.checklist_id)}><button type="button" disabled={blocked} onClick={() => void loadChecklist(String(row.checklist_id))} className={`w-full rounded border p-2 text-left text-xs ${String(selectedChecklist?.checklist_id) === String(row.checklist_id) ? 'border-amber-400 bg-amber-950/30' : 'border-slate-800 bg-slate-950'}`}><span className="font-semibold">{String(row.template_name)} - {String(row.checklist_date)}</span><span className="mt-1 block text-slate-400">{String(row.status)} - {Array.isArray(row.items) ? row.items.filter((item) => item.completed).length : 0}/{Array.isArray(row.items) ? row.items.length : 0} complete - v{String(row.version)}</span></button></li>)}</ul>{checklists.length === 0 && <p className="mt-2 text-sm text-slate-300">No checklists in this period.</p>}</div>

          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">{!selectedChecklist ? <p className="text-sm text-slate-300">Select a checklist to complete its items. Items require the current checklist version and are audited individually.</p> : <div><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold">{String(selectedChecklist.template_name)}</h3><p className="mt-1 text-xs text-slate-400">{String(selectedChecklist.checklist_date)} - {String(selectedChecklist.status)} - version {String(selectedChecklist.version)}</p></div><button type="button" disabled={blocked} onClick={() => void loadChecklist(String(selectedChecklist.checklist_id))} className="rounded border border-slate-600 px-3 py-1 text-xs disabled:opacity-40">Reload</button></div><ul className="mt-3 space-y-2">{(Array.isArray(selectedChecklist.items) ? selectedChecklist.items : []).map((item) => <li key={String(item.item_id)} className="rounded border border-slate-800 p-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={item.completed === true} disabled={blocked || !localReady} onChange={(event) => void setChecklistItem(item, event.target.checked)} /><span>{String(item.label)}{item.required ? ' (required)' : ''}</span></label><input aria-label={`Note for ${String(item.label)}`} maxLength={500} placeholder="Completion note (optional)" value={checklistNotes[String(item.item_id)] ?? ''} onChange={(event) => setChecklistNotes((notes) => ({ ...notes, [String(item.item_id)]: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-xs" /></li>)}</ul></div>}</div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Incidents</h3><span className="text-xs text-slate-400">{incidentFrom} to {incidentTo}</span></div><div className="mt-2 overflow-x-auto rounded border border-slate-800"><table className="w-full text-left text-sm"><thead className="bg-slate-950 text-xs uppercase tracking-wide text-slate-400"><tr><th className="p-2">Date</th><th className="p-2">Category</th><th className="p-2">Severity</th><th className="p-2">Status</th><th className="p-2">Description</th><th className="p-2">Action</th></tr></thead><tbody>{incidents.map((row) => <tr key={String(row.id)} className="border-t border-slate-800"><td className="p-2">{String(row.incident_date)}</td><td className="p-2">{String(row.category)}</td><td className="p-2">{String(row.severity)}</td><td className="p-2">{String(row.status)}</td><td className="p-2 max-w-md truncate">{String(row.description)}</td><td className="p-2">{row.status !== 'resolved' && <button type="button" disabled={blocked} onClick={() => setIncidentResolveForm({ incident_id: String(row.id), expected_version: String(row.version), resolution: '' })} className="text-xs text-amber-300 disabled:opacity-40">Resolve</button>}</td></tr>)}</tbody></table>{incidents.length === 0 && <p className="p-3 text-sm text-slate-300">No incidents in this period.</p>}</div>
          {incidentResolveForm.incident_id && <form onSubmit={resolveIncident} className="mt-3 rounded border border-emerald-800 p-3"><h4 className="text-sm font-semibold text-emerald-200">Resolve incident</h4><label className="mt-2 block text-xs">Resolution evidence<textarea maxLength={2000} value={incidentResolveForm.resolution} onChange={(event) => setIncidentResolveForm((draft) => ({ ...draft, resolution: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><div className="mt-2 flex gap-2"><button disabled={blocked || !localReady} className="rounded border border-emerald-600 px-3 py-2 text-sm font-semibold text-emerald-200 disabled:opacity-40">Resolve incident</button><button type="button" onClick={() => setIncidentResolveForm({ incident_id: '', expected_version: '', resolution: '' })} className="rounded border border-slate-600 px-3 py-2 text-sm">Cancel</button></div></form>}
        </div>
      </div>}
      {activeTab === 'accounting' && canAccountingManage && <BarLocalFinanceWorkspace
        query={(name,filters)=>window.api.barLocal.query(name,filters)} onRun={run}
        blocked={blocked || !localReady} refreshKey={`${version}:${refreshKey}`} />}
      {activeTab === 'customers' && canAccountingManage && <BarLocalLoyaltyAdjustment customers={customerRows}
        blocked={blocked||!localReady} onApproved={run} onCommitted={()=>refreshLoyaltyBalance(loyaltyForm.customer_id)}/>}
      {activeTab === 'workforce' && capabilities.includes('pos.cashup') && <BarLocalTipActions
        query={(name,filters)=>window.api.barLocal.query(name,filters)} staffRows={staffList} shift={shift}
        blocked={blocked||!localReady} canReadSales={canReports} onRun={run} refreshKey={`${version}:${refreshKey}`}/>}
    </section>
  )
}
