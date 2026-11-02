import BarLocalDrawerHandover from './BarLocalDrawerHandover.jsx'
import BarReplacementConnection from './BarReplacementConnection.jsx'
// @ts-check
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { estimateBarCashSale, exceedsDiscountMaximum, formatBarLocalMoney, isDiscountApprovalRequired, validateBarPromotionSnapshot } from '../../../../shared/barLocalCashEstimate.js'
import BarLocalDiscountPolicy from './BarLocalDiscountPolicy.jsx'
import BarLocalModifierManager from './BarLocalModifierManager.jsx'
import BarLocalStaffStatus from './BarLocalStaffStatus.jsx'
import BarLocalAdminPanel from './BarLocalAdminPanel.jsx'
import BarLocalTenderEditor from './bar-local/BarLocalTenderEditor.jsx'
import BarLocalTabsPanel from './bar-local/BarLocalTabsPanel.jsx'
import BarLocalOperationsPanel from './bar-local/BarLocalOperationsPanel.jsx'
import { evaluateTenders, makeTenderRow } from './bar-local/tenderMath.js'
import { loadCompleteBarList } from '../../../../shared/barLocalPagination.js'
import { barLocalOperatorError, barLocalReadinessMessage, canVoidRemainingBarSale, canReturnBarSaleLines, barReturnQuantityWithinRemaining, barSaleShiftIsClosed, canPostCloseCorrectBarSale, canPostCloseReturnBarSaleLines, barPostCloseCorrectionBlockedMessage } from '../../../../shared/barLocalOperatorMessages.js'
import { HposNotice } from './HposUi.jsx'

// MENU_EDIT_SNAPSHOT_BEGIN
/** @param {(name: string, filters: Record<string, unknown>) => Promise<any>} query */
async function loadVerifiedMenuEditSnapshot(query) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    /** @type {Array<Record<string, any>>} */
    const rows = []
    /** @type {Record<string, number>} */
    const versions = {}
    const ids = new Set()
    const cursors = new Set()
    let cursor = null
    let watermark = null
    let scope = null
    let changed = false
    for (let page = 0; page < 100; page += 1) {
      const filters = { include_inactive: true, limit: 200, ...(cursor ? { cursor } : {}) }
      const [availability, products] = await Promise.all([query('menu.availability', filters), query('menu.list', filters)])
      for (const result of [availability, products]) {
        if (result?.complete !== true || !Array.isArray(result.data) || !Array.isArray(result.unavailable) || result.unavailable.length ||
            !Number.isSafeInteger(result.snapshot_watermark) || result.snapshot_watermark < 0 ||
            !result.scope?.business_id || !result.scope?.outlet_id || !result.scope?.device_id || !result.scope?.actor_staff_id ||
            typeof result.pagination?.has_more !== 'boolean') {
          throw new Error('The local menu snapshot is incomplete. Refresh before editing a product.')
        }
        const currentScope = JSON.stringify([result.scope.business_id, result.scope.outlet_id, result.scope.device_id, result.scope.actor_staff_id])
        if (scope !== null && currentScope !== scope) throw new Error('The local menu scope changed. Sign in again before editing.')
        if (watermark !== null && result.snapshot_watermark !== watermark) { changed = true; break }
        scope = currentScope
        watermark = result.snapshot_watermark
      }
      if (changed) break
      if (availability.pagination.has_more !== products.pagination.has_more ||
          availability.pagination.next_cursor !== products.pagination.next_cursor ||
          availability.data.length !== products.data.length) throw new Error('The local menu pages do not match. Refresh before editing.')
      const pageProducts = new Map()
      for (const product of products.data) {
        if (!product || typeof product.product_id !== 'string' || !product.product_id || typeof product.sku !== 'string' ||
            !Number.isSafeInteger(product.version) || product.version < 1 || pageProducts.has(product.product_id)) {
          throw new Error('The local product versions are incomplete. Refresh before editing.')
        }
        pageProducts.set(product.product_id, product)
      }
      for (const row of availability.data) {
        const product = row && pageProducts.get(row.product_id)
        if (!product || ids.has(row.product_id) || product.sku !== row.sku) {
          throw new Error('The local menu products do not match. Refresh before editing.')
        }
        ids.add(row.product_id)
        versions[row.product_id] = product.version
        rows.push(row)
      }
      if (!availability.pagination.has_more) return { rows, versions }
      const next = availability.pagination.next_cursor
      if (typeof next !== 'string' || !next || cursors.has(next) || availability.data.length === 0) {
        throw new Error('The local menu returned an invalid cursor. Refresh before editing.')
      }
      cursors.add(next)
      cursor = next
    }
    if (!changed) throw new Error('The local menu exceeds the safe page limit. Refresh before editing.')
  }
  throw new Error('The local menu changed while loading. Refresh before editing.')
}
// MENU_EDIT_SNAPSHOT_END

const MONEY_TWO = /^\d+(?:\.\d{1,2})?$/
const QUANTITY_SIX = /^\d+(?:\.\d{1,6})?$/
const COST_FOUR = /^\d+(?:\.\d{1,4})?$/
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function messageOf(error) {
  return barLocalOperatorError(error)
}

function displayMoney(value) {
  if (value === null || value === undefined || value === '') return '—'
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(2) : String(value)
}

function displayQuantity(value) {
  if (value === null || value === undefined || value === '') return '—'
  const number = Number(value)
  return Number.isFinite(number) ? String(Number(number.toFixed(6))) : String(value)
}

function readinessStateFor(readiness, now) {
  if (readiness?.unavailable) return 'unavailable'
  if (!readiness) return 'unknown'
  if (!(readiness.checkedAt > 0) || now - readiness.checkedAt >= 45000) return 'stale'
  if (readiness.ready === true) return 'ready'
  if (readiness.ready === false) return 'blocked'
  return 'unknown'
}

/** @param {unknown} value */
function displayModifierNames(value) {
  if (!Array.isArray(value)) return ''
  return value.map((modifier) => modifier && typeof modifier === 'object' && typeof modifier.option_name === 'string' ? modifier.option_name : '').filter(Boolean).join(', ')
}

function commandNotice(command) {
  if (command === 'sale.commit') return 'Sale committed by the local authority.'
  if (command === 'sale.return') return 'Return committed by the local authority.'
  if (command === 'sale.void') return 'Sale void committed by the local authority.'
  if (command === 'sale.correct_after_close') return 'Post-close correction committed as a separate current-date compensating receipt. The original closed receipt was not changed.'
  if (command === 'shift.open') return 'Shift opened by the local authority.'
  if (command === 'shift.close') return 'Shift closed by the local authority.'
  if (command === 'cashup.submit') return 'Cash-up submitted to the local authority for review.'
  if (command === 'cashup.review') return 'Cash-up decision recorded by the local authority.'
  if (command === 'cashup.reopen') return 'A new cash-up revision was submitted; the reviewed snapshot remains in the local audit history.'
  if (command === 'tab.open') return 'Tab opened by the local authority.'
  if (command === 'tab.add') return 'Current cart added to the selected tab.'
  if (command === 'tab.settle') return 'Tab settled by the local authority.'
  if (command === 'tab.transfer') return 'Tab ownership transferred with manager approval.'
  if (command === 'tab.split') return 'Selected tab lines moved into a new tab with manager approval.'
  if (command === 'tab.merge') return 'Tab merged into the target tab with manager approval.'
  if (command === 'stock.receive') return 'Stock receipt committed by the local authority.'
  if (command === 'stock.adjust') return 'Stock adjustment committed with manager approval.'
  if (command === 'stock.stocktake') return 'Stocktake count reconciled by the local authority.'
  if (command === 'stock.waste') return 'Stock waste recorded with manager approval.'
  if (command === 'stock.transfer') return 'Stock transfer committed by the local authority.'
  if (command === 'supplier.upsert') return 'Supplier saved to the local purchasing records.'
  if (command === 'purchase_order.create') return 'Purchase order created with manager approval.'
  if (command === 'purchase_order.receive') return 'Purchase order receipt committed to stock.'
  if (command === 'purchase_order.cancel') return 'Purchase order cancelled with manager approval.'
  if (command === 'customer.create') return 'Customer account created locally.'
  if (command === 'customer.credit.payment') return 'Customer credit payment recorded locally.'
  if (command === 'voucher.issue') return 'Voucher issued with manager approval.'
  if (command === 'expense.create') return 'Expense recorded and posted locally.'
  if (command === 'expense.void') return 'Expense void committed with manager approval.'
  if (command === 'accounting.journal.post') return 'Journal entry posted by the local authority.'
  if (command === 'accounting.period.close') return 'Accounting period closed with manager approval.'
  if (command === 'workforce.shift.schedule') return 'Roster shift scheduled locally.'
  if (command === 'workforce.shift.cancel') return 'Roster shift cancelled.'
  if (command === 'workforce.clock.in') return 'Attendance clock-in recorded.'
  if (command === 'workforce.clock.out') return 'Attendance clock-out recorded.'
  if (command === 'workforce.tip.allocate') return 'Tip allocation recorded locally.'
  if (command === 'workforce.tip.payout') return 'Tip payout recorded with manager approval.'
  if (command === 'staff.status') return 'Staff status changed with manager approval.'
  if (command === 'control.checklist.start') return 'Checklist started from the local template.'
  if (command === 'control.checklist.item.set') return 'Checklist item updated.'
  if (command === 'control.incident.log') return 'Incident logged locally.'
  if (command === 'control.incident.resolve') return 'Incident resolved with evidence.'
  if (command === 'drawer.movement') return 'Drawer movement committed by the local authority.'
  if (command === 'catalogue.upsert') return 'Product saved to the local catalogue.'
  if (command === 'catalogue.availability.set') return 'Product availability saved by the local authority.'
  if (command === 'support.report.create') return 'Support report recorded locally; external delivery is disabled.'
  return 'Operation committed by the local authority.'
}

/** @param {{status: Record<string, unknown>, onLogout: () => void, initialStaffId?: string, initialLoginNotice?: string}} props */
export default function BarLocalWorkspace({ status, onLogout, initialStaffId = '', initialLoginNotice = '' }) {
  const [loginMode, setLoginMode] = useState('staff')
  const [staffId, setStaffId] = useState(initialStaffId)
  const [pin, setPin] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [recoveryPassword, setRecoveryPassword] = useState('')
  const [session, setSession] = useState(status.session ?? null)
  const [readiness, setReadiness] = useState(/** @type {{ready: boolean|null, blockers: string[], checkedAt: number, unavailable?: boolean}|null} */ (
    status.readiness && typeof status.readiness.ready === 'boolean'
      ? { ready: status.readiness.ready, blockers: Array.isArray(status.readiness.blockers) ? status.readiness.blockers : [], checkedAt: 0 }
      : null
  ))
  const [readinessChecking, setReadinessChecking] = useState(false)
  const [readinessClock, setReadinessClock] = useState(Date.now())
  const readinessRequestInFlight = useRef(false)
  const workspaceGeneration = useRef(0)
  const [catalogue, setCatalogue] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [catalogueSyncError, setCatalogueSyncError] = useState('')
  const catalogueWatermark = useRef(/** @type {number|null} */ (null))
  const [menuRows, setMenuRows] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [menuProductVersions, setMenuProductVersions] = useState(/** @type {Record<string, number>} */ ({}))
  const [modifierConfig, setModifierConfig] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [cashierPromotions, setCashierPromotions] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [discountPolicy, setDiscountPolicy] = useState(/** @type {{approval_threshold_percent: string, maximum_percent: string}|null} */ (null))
  const [promotionCode, setPromotionCode] = useState('')
  const [discountApprovalPin, setDiscountApprovalPin] = useState('')
  const [discountApprovalBusy, setDiscountApprovalBusy] = useState(false)
  const [shift, setShift] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [cart, setCart] = useState(/** @type {Array<{cartId: string, product: Record<string, unknown>, quantity: number, modifiers: string[]}>} */ ([]))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [float, setFloat] = useState('0.00')
  const [menuDraft, setMenuDraft] = useState({ productId: '', expectedVersion: '', sku: '', name: '', category: '', price: '', taxRate: '0.00', trackStock: true, active: true })
  const [pending, setPending] = useState(/** @type {{id: string, command: string, payload: Record<string, unknown>, recovered?: boolean, state?: string, createdAt?: string, count?: number}|null} */ (null))
  const [intentsChecked, setIntentsChecked] = useState(false)
  const [intentCheckError, setIntentCheckError] = useState('')
  const [activePanel, setActivePanel] = useState('counter')
  const [panelVersion, setPanelVersion] = useState(0)
  const [openTabs, setOpenTabs] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [selectedTabId, setSelectedTabId] = useState('')
  const [selectedTab, setSelectedTab] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [saleTenderRows, setSaleTenderRows] = useState(/** @type {Array<Record<string, unknown>>} */ (() => [makeTenderRow()]))
  const [customers, setCustomers] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [approvalBusy, setApprovalBusy] = useState(false)
  const [stock, setStock] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [stockLotRows, setStockLotRows] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [stockLotBalanceRows, setStockLotBalanceRows] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [stockDraft, setStockDraft] = useState({ product_id: '', quantity: '', unit_cost: '', supplier_ref: '', lot_code: '', expires_on: '' })
  const [sales, setSales] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [selectedSaleId, setSelectedSaleId] = useState('')
  const [selectedSale, setSelectedSale] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [returnDraft, setReturnDraft] = useState({ lineQuantities: /** @type {Record<string, string>} */ ({}), reason: '', disposition: 'restock' })
  const [returnApprovalPin, setReturnApprovalPin] = useState('')
  const [returnApprovalBusy, setReturnApprovalBusy] = useState(false)
  const [cashupSummary, setCashupSummary] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [cashupRows, setCashupRows] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [cashupReportComplete, setCashupReportComplete] = useState(true)
  const [selectedCashupShiftId, setSelectedCashupShiftId] = useState('')
  const [closedShift, setClosedShift] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [closeDraft, setCloseDraft] = useState({ counted_cash: '', notes: '' })
  const [cashupDraft, setCashupDraft] = useState({ counted_cash: '', counted_card: '0.00', notes: '' })
  const [cashupReviewDraft, setCashupReviewDraft] = useState({ decision: 'approved', reason: '', pin: '' })
  const [cashupApprovalBusy, setCashupApprovalBusy] = useState(false)
  const [cashupReopenDraft, setCashupReopenDraft] = useState({ counted_cash: '', counted_card: '0.00', notes: '', proof_ref: '', reason: '', pin: '' })
  const [drawerDraft, setDrawerDraft] = useState({ type: 'paid_in', amount: '', reason: '' })
  const [cashupResult, setCashupResult] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [report, setReport] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [stockReport, setStockReport] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [cashupReport, setCashupReport] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [lastReceipt, setLastReceipt] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [staffRows, setStaffRows] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [auditRows, setAuditRows] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [auditSearch, setAuditSearch] = useState('')
  const [auditAction, setAuditAction] = useState('')
  const [auditCursor, setAuditCursor] = useState('')
  const [auditHasMore, setAuditHasMore] = useState(false)
  const [auditLoading, setAuditLoading] = useState(false)
  const [supportReports, setSupportReports] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [supportReportsLoading, setSupportReportsLoading] = useState(false)
  const [supportReportsError, setSupportReportsError] = useState('')
  const [supportDraft, setSupportDraft] = useState({ category: 'operations', severity: 'normal', subject: '', message: '' })
  const [staffDraft, setStaffDraft] = useState({ display_name: '', role: 'cashier', pin: '' })
  const [pairingCode, setPairingCode] = useState(/** @type {{code: string, expiresAt: number, fingerprint: string}|null} */ (null))
  const [pairingBusy, setPairingBusy] = useState(false)

  useEffect(() => {
    if (!pairingCode) return undefined
    const remaining = Math.max(0, pairingCode.expiresAt - Date.now())
    const timer = window.setTimeout(() => setPairingCode(null), remaining)
    return () => window.clearTimeout(timer)
  }, [pairingCode])

  const refreshReadiness = useCallback(async () => {
    if (readinessRequestInFlight.current) return
    readinessRequestInFlight.current = true
    setReadinessChecking(true)
    try {
      const result = await window.api.barLocal.refreshReadiness()
      setReadiness({
        ready: typeof result?.ready === 'boolean' ? result.ready : null,
        blockers: Array.isArray(result?.blockers) ? result.blockers.filter((item) => typeof item === 'string') : [],
        checkedAt: Date.now()
      })
    } catch {
      setReadiness({ ready: null, blockers: [], checkedAt: Date.now(), unavailable: true })
    } finally {
      readinessRequestInFlight.current = false
      setReadinessChecking(false)
    }
  }, [])

  useEffect(() => {
    if (!session) return undefined
    let mounted = true
    const check = async () => {
      if (mounted) await refreshReadiness()
    }
    void check()
    const timer = window.setInterval(() => { void check() }, 15000)
    return () => { mounted = false; window.clearInterval(timer) }
  }, [session, refreshReadiness])

  useEffect(() => {
    const timer = window.setInterval(() => setReadinessClock(Date.now()), 5000)
    return () => window.clearInterval(timer)
  }, [])

  const acceptCatalogueSnapshot = (result) => {
    if (result?.complete !== true || result.unavailable?.length || !Array.isArray(result.products)) {
      throw new Error('The local product catalogue is incomplete. Ask a manager to repair the catalogue before trading.')
    }
    const watermark = Number(result.snapshot_watermark)
    if (!Number.isSafeInteger(watermark) || watermark < 0) throw new Error('The local catalogue snapshot has no valid commit watermark. Trading is paused until it can be refreshed.')
    const changed = result.catalogue_refreshed === true && catalogueWatermark.current !== null && watermark !== catalogueWatermark.current
    catalogueWatermark.current = watermark
    setCatalogue(result.products.filter((product) => product.active === true && product.available === true))
    setCatalogueSyncError('')
    if (changed) {
      setCart([])
      setPromotionCode('')
      setNotice('The shared local menu changed. Your unsent cart was cleared; review the current menu and add items again.')
    }
  }

  const refresh = useCallback(async () => {
    setError('')
    const [productsResult, shiftResult, promotionResult] = await Promise.all([
      window.api.barLocal.getCatalogueSnapshot(),
      window.api.barLocal.query('shift.current', {}),
      window.api.barLocal.query('menu.promotions', {})
    ])
    const shiftData = shiftResult?.data && typeof shiftResult.data === 'object' ? shiftResult.data : null
    const promotionSnapshot = validateBarPromotionSnapshot(promotionResult, session.business_id, session.outlet_id)
    acceptCatalogueSnapshot(productsResult)
    setShift(shiftData?.status === 'open' ? shiftData : null)
    setCashierPromotions(promotionSnapshot.promotions)
    setDiscountPolicy(promotionSnapshot.discountPolicy)
  }, [])

  useEffect(() => {
    if (!session) return undefined
    let mounted = true
    let inFlight = false
    const checkCatalogue = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const [result, promotionResult] = await Promise.all([
          window.api.barLocal.getCatalogueSnapshot(),
          window.api.barLocal.query('menu.promotions', {})
        ])
        if (mounted) {
          const promotionSnapshot = validateBarPromotionSnapshot(promotionResult, session.business_id, session.outlet_id)
          acceptCatalogueSnapshot(result)
          setCashierPromotions(promotionSnapshot.promotions)
          setDiscountPolicy(promotionSnapshot.discountPolicy)
        }
      } catch (cause) {
        if (mounted) setCatalogueSyncError(`${messageOf(cause)} The current menu could not be verified; refresh it before selling.`)
      } finally {
        inFlight = false
      }
    }
    const timer = window.setInterval(() => { void checkCatalogue() }, 15000)
    return () => { mounted = false; window.clearInterval(timer) }
  }, [session])

  const loadOpenIntent = useCallback(async () => {
    const open = await window.api.barLocal.getOpenIntents()
    if (!Array.isArray(open)) throw new Error('The local operation journal returned an invalid unresolved-operation list.')
    if (open.length === 0) return null
    const intent = open[0]
    if (!intent || typeof intent.operation_id !== 'string' || typeof intent.command !== 'string') {
      throw new Error('The local operation journal returned an unresolved operation without its original identifier and command.')
    }
    return {
      id: String(intent.operation_id),
      command: String(intent.command),
      payload: /** @type {Record<string, unknown>} */ ({}),
      recovered: true,
      state: typeof intent.state === 'string' ? intent.state : 'outcome_unknown',
      createdAt: typeof intent.created_at === 'string' ? intent.created_at : undefined,
      count: open.length
    }
  }, [])

  const recheckOpenIntents = useCallback(async () => {
    setIntentCheckError('')
    try {
      const intent = await loadOpenIntent()
      setPending(intent)
      setIntentsChecked(true)
    } catch (cause) {
      setIntentsChecked(false)
      setIntentCheckError(messageOf(cause))
    }
  }, [loadOpenIntent])

  useEffect(() => {
    if (!session) return undefined
    let mounted = true
    setIntentsChecked(false)
    setIntentCheckError('')
    const checkIntents = async () => {
      try {
        const intent = await loadOpenIntent()
        if (!mounted) return
        setPending(intent)
        setIntentsChecked(true)
      } catch (cause) {
        if (!mounted) return
        setIntentsChecked(false)
        setIntentCheckError(messageOf(cause))
      }
    }
    void checkIntents()
    void refresh().catch((cause) => { if (mounted) setError(messageOf(cause)) })
    return () => { mounted = false }
  }, [loadOpenIntent, refresh, session])

  useEffect(() => {
    if (!session || activePanel !== 'menu') return undefined
    let cancelled = false
    setMenuRows([])
    setMenuProductVersions({})
    setMenuDraft((draft) => draft.productId ? { ...draft, expectedVersion: '' } : draft)
    void (async () => {
      try {
        const { rows, versions } = await loadVerifiedMenuEditSnapshot((name, filters) => window.api.barLocal.query(name, filters))
        if (!cancelled) { setMenuRows(rows); setMenuProductVersions(versions) }
      } catch (cause) { if (!cancelled) { setMenuRows([]); setMenuProductVersions({}); setError(messageOf(cause)) } }
    })()
    return () => { cancelled = true }
  }, [session, activePanel, panelVersion])

  useEffect(() => {
    if (!session || activePanel !== 'tabs') return undefined
    let cancelled = false
    void (async () => {
      try {
        const result = await window.api.barLocal.query('tabs.list', { status: 'open', limit: 100 })
        if (cancelled) return
        if (result?.complete !== true || !Array.isArray(result.data)) throw new Error('The open tab list is incomplete. Refresh before using tabs.')
        setOpenTabs(result.data)
      } catch (cause) { if (!cancelled) setError(messageOf(cause)) }
    })()
    return () => { cancelled = true }
  }, [session, activePanel, panelVersion])

  useEffect(() => {
    if (!session || activePanel !== 'tabs' || !selectedTabId) {
      setSelectedTab(null)
      return undefined
    }
    let cancelled = false
    void (async () => {
      try {
        const result = await window.api.barLocal.query('tab.get', { tab_id: selectedTabId })
        if (cancelled) return
        if (result?.complete !== true || !result.data) throw new Error('The selected tab could not be read completely. Refresh before settling it.')
        setSelectedTab(result.data)
      } catch (cause) { if (!cancelled) setError(messageOf(cause)) }
    })()
    return () => { cancelled = true }
  }, [session, activePanel, selectedTabId, panelVersion])

  useEffect(() => {
    if (!session || activePanel !== 'returns') return undefined
    let cancelled = false
    void (async () => {
      try {
        const result = await window.api.barLocal.query('sales.list', { limit: 100 })
        if (cancelled) return
        if (result?.complete !== true || !Array.isArray(result.data)) throw new Error('The local sales list is incomplete. Refresh before starting a return.')
        setSales(result.data)
      } catch (cause) { if (!cancelled) setError(messageOf(cause)) }
    })()
    return () => { cancelled = true }
  }, [session, activePanel, panelVersion])

  useEffect(() => {
    if (!session || activePanel !== 'returns' || !selectedSaleId) {
      setSelectedSale(null)
      return undefined
    }
    let cancelled = false
    void (async () => {
      try {
        const result = await window.api.barLocal.query('sale.get', { sale_id: selectedSaleId })
        if (cancelled) return
        if (result?.complete !== true || !result.data) throw new Error('The selected sale could not be read completely.')
        setSelectedSale(result.data)
      } catch (cause) { if (!cancelled) setError(messageOf(cause)) }
    })()
    return () => { cancelled = true }
  }, [session, activePanel, selectedSaleId, panelVersion])

  useEffect(() => {
    if (!session || !['cashup', 'drawer'].includes(activePanel)) return undefined
    const targetShiftId = activePanel === 'cashup'
      ? selectedCashupShiftId || closedShift?.shift_id || shift?.shift_id
      : shift?.shift_id
    if (!targetShiftId) {
      setCashupSummary(null)
      return undefined
    }
    let cancelled = false
    void (async () => {
      try {
        const result = await window.api.barLocal.query('cashup.summary', { shift_id: targetShiftId })
        if (cancelled) return
        if (result?.complete !== true || !result.data) throw new Error('The cash-up summary is incomplete. Refresh before relying on it.')
        setCashupSummary(result.data)
      } catch (cause) { if (!cancelled) { setCashupSummary(null); setError(messageOf(cause)) } }
    })()
    return () => { cancelled = true }
  }, [session, activePanel, shift?.shift_id, closedShift?.shift_id, selectedCashupShiftId, panelVersion])

  useEffect(() => {
    if (!session || activePanel !== 'cashup') return undefined
    let cancelled = false
    void (async () => {
      try {
        const result = await window.api.barLocal.query('reports.cashup', {})
        if (cancelled) return
        const rows = result?.data && Array.isArray(result.data.shifts) ? result.data.shifts : null
        if (!rows) throw new Error('The local cash-up review list is unavailable. Refresh before reviewing a cash-up.')
        setCashupRows(rows)
        setCashupReportComplete(result.complete === true)
      } catch (cause) {
        if (!cancelled) { setCashupRows([]); setCashupReportComplete(false); setError(messageOf(cause)) }
      }
    })()
    return () => { cancelled = true }
  }, [session, activePanel, panelVersion])

  useEffect(() => {
    if (!session || activePanel !== 'stock') return undefined
    let cancelled = false
    void (async () => {
      try {
        const [stockRows, lotRows, lotBalanceRows] = await Promise.all([
          loadCompleteBarList((name, filters) => window.api.barLocal.query(name, filters), 'stock.list'),
          loadCompleteBarList((name, filters) => window.api.barLocal.query(name, filters), 'stock.lot_expiry'),
          loadCompleteBarList((name, filters) => window.api.barLocal.query(name, filters), 'stock.lot_balances')
        ])
        if (cancelled) return
        setStock(stockRows)
        setStockLotRows(lotRows)
        setStockLotBalanceRows(lotBalanceRows)
      } catch (cause) { if (!cancelled) setError(messageOf(cause)) }
    })()
    return () => { cancelled = true }
  }, [session, activePanel, panelVersion])

  useEffect(() => {
    if (!session || activePanel !== 'settings') return undefined
    let cancelled = false
    void (async () => {
      try {
        const result = await window.api.barLocal.query('staff.list', { include_suspended: true, limit: 100 })
        if (cancelled) return
        if (result?.complete !== true || !Array.isArray(result.data)) throw new Error('The staff list is incomplete. Refresh before changing access.')
        setStaffRows(result.data)
      } catch (cause) { if (!cancelled) setError(messageOf(cause)) }
    })()
    return () => { cancelled = true }
  }, [session, activePanel, panelVersion])

  const businessDate = String(closedShift?.business_date || shift?.business_date || cashupSummary?.business_date || '')

  useEffect(() => {
    if (!session || activePanel !== 'reports') return undefined
    let cancelled = false
    void (async () => {
      try {
        const filters = businessDate && DATE_ONLY.test(businessDate) ? { from: businessDate, to: businessDate } : {}
        const [result, stockResult, cashupResult] = await Promise.all([
          window.api.barLocal.query('reports.sales_summary', filters),
          window.api.barLocal.query('reports.stock', filters),
          window.api.barLocal.query('reports.cashup', filters)
        ])
        if (cancelled) return
        if (result?.complete !== true || !result.data) throw new Error('The local sales summary is incomplete. Refresh the report.')
        if (!stockResult?.data || !stockResult.scope?.business_id || !stockResult.scope?.outlet_id) throw new Error('The local stock report is incomplete or unscoped. Refresh before relying on it.')
        if (!cashupResult?.data || !cashupResult.scope?.business_id || !cashupResult.scope?.outlet_id) throw new Error('The local cash-up report is incomplete or unscoped. Refresh before relying on it.')
        setReport(result.data)
        setStockReport({ ...stockResult.data, complete: stockResult.complete === true, unavailable: stockResult.unavailable || [] })
        setCashupReport({ ...cashupResult.data, complete: cashupResult.complete === true, unavailable: cashupResult.unavailable || [] })
      } catch (cause) { if (!cancelled) setError(messageOf(cause)) }
    })()
    return () => { cancelled = true }
  }, [session, activePanel, businessDate, panelVersion])

  const saleEstimate = useMemo(() => {
    try {
      const code = promotionCode.trim().toUpperCase()
      const promotion = code ? cashierPromotions.find((row) => String(row.code).toUpperCase() === code) : null
      if (code && !promotion) return null
      if (!discountPolicy) return null
      return estimateBarCashSale(cart, promotion)
    } catch { return null }
  }, [cart, cashierPromotions, discountPolicy, promotionCode])
  const totalCents = saleEstimate && discountPolicy && !exceedsDiscountMaximum(saleEstimate.promotionDiscountCents, saleEstimate.subtotalCents, discountPolicy.maximum_percent) ? saleEstimate.totalCents : null
  const saleTenderEvaluation = useMemo(() => evaluateTenders({ totalCents: totalCents ?? 0, rows: saleTenderRows }), [totalCents, saleTenderRows])
  const promotionApprovalRequired = Boolean(saleEstimate && discountPolicy && isDiscountApprovalRequired(saleEstimate.promotionDiscountCents, saleEstimate.subtotalCents, discountPolicy.approval_threshold_percent))
  const readinessState = readinessStateFor(readiness, readinessClock)
  const localReady = readinessState === 'ready'
  const capabilities = Array.isArray(session?.staff?.capabilities) ? session.staff.capabilities : []
  const capabilityKey = capabilities.join('|')
  const canManageMenu = capabilities.includes('pos.menu_manage')
  const canApplyDiscount = capabilities.includes('pos.discount')
  const canManageTill = capabilities.includes('pos.manage')
  const canCashup = capabilities.includes('pos.cashup')
  const canInventoryView = capabilities.includes('inventory.view')
  const canInventoryManage = capabilities.includes('inventory.manage')
  const canReports = capabilities.includes('pos.reports')
  const canManageStaff = capabilities.includes('staff.manage')
  const canManageSettings = capabilities.includes('settings.manage')
  const canUseCustomers = capabilities.includes('customers.manage')
  const canUseVouchers = capabilities.includes('vouchers.manage')
  const canAccountingRead = capabilities.includes('accounting.read')
  const canViewOperations = canInventoryView || canUseCustomers || canAccountingRead || canManageStaff || canManageTill
  // Financial commands stay fenced until the durable journal has been checked
  // after this sign-in. A failed check keeps the fence closed so a saved
  // operation is never silently followed by a fresh operation id.
  const intentsFenced = !intentsChecked || Boolean(intentCheckError)
  const commandBlocked = busy || Boolean(pending) || intentsFenced || approvalBusy
  const selectedSaleClosed = barSaleShiftIsClosed(selectedSale)
  const canPostCloseSelectedSale = canPostCloseCorrectBarSale(selectedSale)
  const postCloseBlockedCopy = selectedSaleClosed ? barPostCloseCorrectionBlockedMessage(selectedSale) : ''
  const selectedSaleCorrections = selectedSale && Array.isArray(selectedSale.post_close_corrections)
    ? /** @type {Array<Record<string, unknown>>} */ (selectedSale.post_close_corrections)
    : []
  const panels = [
    { id: 'counter', label: 'Counter' },
    ...(canManageMenu ? [{ id: 'menu', label: 'Menu' }] : []),
    ...(canCashup ? [{ id: 'drawer', label: 'Drawer' }] : []),
    ...(canManageTill ? [{ id: 'tabs', label: 'Tabs' }] : []),
    ...(canManageTill && canReports ? [{ id: 'returns', label: 'Returns' }] : []),
    ...(canCashup ? [{ id: 'cashup', label: 'Cash-up' }] : []),
    ...(canInventoryView ? [{ id: 'stock', label: 'Stock' }] : []),
    ...(canViewOperations ? [{ id: 'operations', label: 'Operations' }] : []),
    ...(canReports ? [{ id: 'reports', label: 'Reports' }] : []),
    ...(canManageStaff ? [{ id: 'settings', label: 'Settings' }] : []),
    ...(canManageSettings ? [
      { id: 'audit', label: 'Audit' },
      { id: 'support', label: 'Support' },
      { id: 'admin', label: 'Administration' }
    ] : [])
  ]

  useEffect(() => {
    if (!session) return undefined
    const needStaff = canManageStaff && ['tabs', 'operations'].includes(activePanel)
    if (!canUseCustomers && !needStaff) return undefined
    let cancelled = false
    void (async () => {
      try {
        const [customerResult, staffResult] = await Promise.all([
          canUseCustomers ? window.api.barLocal.query('customers.list', { limit: 200 }) : Promise.resolve(null),
          needStaff ? window.api.barLocal.query('staff.list', { include_suspended: true }) : Promise.resolve(null)
        ])
        if (cancelled) return
        if (customerResult) {
          if (customerResult.complete !== true || !Array.isArray(customerResult.data)) throw new Error('The customer list is incomplete. Refresh before taking customer credit.')
          setCustomers(customerResult.data)
        }
        if (staffResult) {
          if (staffResult.complete !== true || !Array.isArray(staffResult.data)) throw new Error('The staff list is incomplete. Refresh before transferring or splitting a tab.')
          setStaffRows(staffResult.data)
        }
      } catch (cause) { if (!cancelled) setError(messageOf(cause)) }
    })()
    return () => { cancelled = true }
  }, [session, activePanel, panelVersion, canUseCustomers, canManageStaff, capabilityKey])

  useEffect(() => {
    if (!session || activePanel !== 'menu' || !canManageMenu) return undefined
    let cancelled = false
    void window.api.barLocal.query('menu.modifiers', {}).then((result) => {
      if (cancelled) return
      if (result?.complete !== true || !result.data || result.scope?.business_id !== session.business_id || result.scope?.outlet_id !== session.outlet_id) {
        throw new Error('The local modifier configuration could not be verified for this outlet.')
      }
      setModifierConfig(result.data)
    }).catch((cause) => { if (!cancelled) setError(messageOf(cause)) })
    return () => { cancelled = true }
  }, [session, activePanel, canManageMenu, panelVersion])

  const searchAudit = async (append = false) => {
    const generation = workspaceGeneration.current
    setAuditLoading(true)
    setError('')
    try {
      const cursor = append ? auditCursor : ''
      const result = await window.api.barLocal.query('audit.search', {
        limit: 50,
        ...(auditSearch.trim() ? { search: auditSearch.trim() } : {}),
        ...(auditAction.trim() ? { action: auditAction.trim() } : {}),
        ...(cursor ? { cursor } : {})
      })
      if (generation !== workspaceGeneration.current) return
      if (!Array.isArray(result?.data) || result.unavailable?.length || !result.scope?.business_id || !result.scope?.outlet_id) throw new Error('The local audit result is incomplete or unscoped. Refresh before relying on it.')
      setAuditRows((current) => append ? [...current, ...result.data] : result.data)
      const next = result.pagination?.next_cursor
      setAuditCursor(next === null || next === undefined ? '' : String(next))
      setAuditHasMore(result.pagination?.has_more === true)
    } catch (cause) { if (generation === workspaceGeneration.current) setError(messageOf(cause)) }
    finally { if (generation === workspaceGeneration.current) setAuditLoading(false) }
  }

  useEffect(() => {
    if (!session || activePanel !== 'audit' || !canManageSettings) return undefined
    void searchAudit(false)
    return undefined
  }, [session, activePanel, canManageSettings, panelVersion])

  const loadSupportReports = async () => {
    const generation = workspaceGeneration.current
    setSupportReportsLoading(true); setSupportReportsError('')
    try {
      const rows = await loadCompleteBarList((name, filters) => window.api.barLocal.query(name, filters), 'support.reports.list', { limit: 50 })
      if (generation !== workspaceGeneration.current) return
      setSupportReports(rows.map((row) => row && typeof row === 'object' ? row : {}))
    } catch (cause) {
      if (generation === workspaceGeneration.current) { setSupportReports([]); setSupportReportsError(messageOf(cause)) }
    } finally { if (generation === workspaceGeneration.current) setSupportReportsLoading(false) }
  }

  useEffect(() => {
    if (!session || activePanel !== 'support' || !canManageSettings) return undefined
    void loadSupportReports()
    return undefined
  }, [session, activePanel, canManageSettings, panelVersion])

  // A till is shared between staff. Clear every response-backed/private view
  // before accepting a new session so a lower-capability login never sees the
  // previous operator's reports, customers, sales, audit or management data
  // while its own scoped requests are still loading. A generation fence also
  // discards audit/support responses that cannot be cancelled at the IPC layer.
  const clearSessionWorkspace = () => {
    workspaceGeneration.current += 1
    setSession(null); setReadiness(null); setReadinessChecking(false); setCatalogue([]); setCatalogueSyncError('')
    setMenuRows([]); setMenuProductVersions({}); setModifierConfig(null)
    setCashierPromotions([]); setDiscountPolicy(null); setPromotionCode(''); setDiscountApprovalPin(''); setDiscountApprovalBusy(false)
    setShift(null); setCart([]); setFloat('0.00'); setPending(null); setIntentsChecked(false); setIntentCheckError('')
    setActivePanel('counter'); setOpenTabs([]); setSelectedTabId(''); setSelectedTab(null); setCustomers([])
    setMenuDraft({ productId: '', expectedVersion: '', sku: '', name: '', category: '', price: '', taxRate: '0.00', trackStock: true, active: true })
    setSaleTenderRows([makeTenderRow()]); setApprovalBusy(false); setStock([]); setStockLotRows([]); setStockLotBalanceRows([])
    setStockDraft({ product_id: '', quantity: '', unit_cost: '', supplier_ref: '', lot_code: '', expires_on: '' })
    setSales([]); setSelectedSaleId(''); setSelectedSale(null)
    setReturnDraft({ lineQuantities: {}, reason: '', disposition: 'restock' }); setReturnApprovalPin(''); setReturnApprovalBusy(false)
    setCashupSummary(null); setCashupRows([]); setCashupReportComplete(true); setSelectedCashupShiftId('')
    setClosedShift(null); setCloseDraft({ counted_cash: '', notes: '' })
    setCashupDraft({ counted_cash: '', counted_card: '0.00', notes: '' })
    setCashupReviewDraft({ decision: 'approved', reason: '', pin: '' })
    setCashupApprovalBusy(false)
    setCashupReopenDraft({ counted_cash: '', counted_card: '0.00', notes: '', proof_ref: '', reason: '', pin: '' })
    setDrawerDraft({ type: 'paid_in', amount: '', reason: '' }); setCashupResult(null)
    setReport(null); setStockReport(null); setCashupReport(null); setLastReceipt(null)
    setStaffRows([]); setAuditRows([]); setAuditSearch(''); setAuditAction(''); setAuditCursor(''); setAuditHasMore(false); setAuditLoading(false)
    setSupportReports([]); setSupportReportsError(''); setSupportDraft({ category: 'operations', severity: 'normal', subject: '', message: '' })
    setSupportReportsLoading(false); setStaffDraft({ display_name: '', role: 'cashier', pin: '' }); setPairingCode(null); setPairingBusy(false)
    setPin(''); setError(''); setNotice(''); catalogueWatermark.current = null
  }

  const login = async (event) => {
    event.preventDefault()
    setBusy(true); setError(''); setNotice('')
    try {
      const result = loginMode === 'owner'
        ? await window.api.barLocal.login({ email: ownerEmail.trim(), password: ownerPassword })
        : await window.api.barLocal.login({ staff_id: staffId.trim(), pin })
      clearSessionWorkspace()
      setSession(result.session)
    } catch (cause) { setError(messageOf(cause)) }
    finally { setBusy(false) }
  }

  const recoverOwnerPassword = async () => {
    setBusy(true); setError(''); setNotice('')
    try {
      await window.api.barLocal.recoverOwnerPassword({ owner_email: ownerEmail.trim(), new_password: recoveryPassword })
      setRecoveryPassword('')
      setOwnerPassword('')
      setLoginMode('owner')
      setNotice('Owner password changed. Sign in with your new password on this main Bar computer.')
    } catch (cause) { setError(messageOf(cause)) }
    finally { setBusy(false) }
  }

  const applyCommittedState = (command, payload, result) => {
    const value = result?.result && typeof result.result === 'object' ? result.result : {}
    if (command === 'sale.commit' || command === 'tab.settle') {
      const receipt = value.receipt || result?.receipt
      if (receipt && typeof receipt === 'object') setLastReceipt(receipt)
    }
    if (command === 'sale.commit' || command === 'tab.add') setCart([])
    if (command === 'sale.commit') { setPromotionCode(''); setDiscountApprovalPin(''); setSaleTenderRows([makeTenderRow()]) }
    if (command === 'catalogue.upsert') setMenuDraft({ productId: '', expectedVersion: '', sku: '', name: '', category: '', price: '', taxRate: '0.00', trackStock: true, active: true })
    if (command === 'support.report.create') setSupportDraft({ category: 'operations', severity: 'normal', subject: '', message: '' })
    if (command === 'staff.create') setStaffDraft({ display_name: '', role: 'cashier', pin: '' })
    if (command === 'tab.open' && value.tab_id) {
      setSelectedTabId(String(value.tab_id))
    }
    if (command === 'tab.settle') {
      setSelectedTabId('')
      setSelectedTab(null)
    }
    if (command === 'tab.merge') {
      setSelectedTabId('')
      setSelectedTab(null)
    }
    if (command === 'shift.close') {
      setClosedShift({
        shift_id: value.shift_id || payload.shift_id,
        business_date: value.business_date || shift?.business_date || cashupSummary?.business_date,
        expected_cash: value.expected_cash,
        counted_cash: value.counted_cash ?? payload.counted_cash,
        variance: value.variance
      })
      setCashupResult(null)
      setCashupDraft({ counted_cash: String(value.counted_cash ?? payload.counted_cash ?? ''), counted_card: '0.00', notes: String(payload.note ?? '') })
    }
    if (command === 'cashup.submit') setCashupResult(value)
    if (command === 'stock.receive') setStockDraft((draft) => ({ ...draft, quantity: '', unit_cost: '', supplier_ref: '', lot_code: '', expires_on: '' }))
    if (command === 'drawer.movement') setDrawerDraft((draft) => ({ ...draft, amount: '', reason: '' }))
  }

  const submitCommand = async (command, payload, retryId = null, operationIdOverride = null) => {
    if (intentsFenced) {
      setError('Saved local operations have not been checked yet. Resolve the saved-operation check before any financial action.')
      return null
    }
    if (!retryId && (busy || pending)) return null
    if (retryId && (!pending || pending.id !== retryId)) return null
    const operationId = retryId ?? operationIdOverride ?? crypto.randomUUID()
    setPending({ id: operationId, command, payload, ...(retryId ? { recovered: true } : {}) })
    setBusy(true); setError(''); setNotice('')
    try {
      const result = retryId
        ? await window.api.barLocal.retryOperation(operationId)
        : await window.api.barLocal.command({ command, payload, operation_id: operationId })
      if (result?.outcome === 'unknown') {
        setPending((current) => ({ ...(current ?? {}), id: operationId, command, payload, state: 'outcome_unknown' }))
        setError(`${result.error?.message || 'The local operation outcome is unknown.'} Retry the same operation below; do not create a new operation.`)
        return null
      }
      if (result?.outcome !== 'committed_local') {
        setPending(null)
        throw new Error(result?.error?.message || 'The local authority refused the operation. Nothing was committed.')
      }
      setPending(null)
      setNotice(commandNotice(command))
      if (command === 'drawer.movement' && payload?.type === 'count' && result.result && typeof result.result === 'object') {
        setNotice(`Drawer count recorded: counted ${displayMoney(result.result.counted_cash)}, expected ${displayMoney(result.result.expected_cash)}, variance ${displayMoney(result.result.variance)}. The count does not change the drawer balance.`)
      }
      applyCommittedState(command, payload, result)
      try {
        const intent = await loadOpenIntent()
        setPending(intent)
        if (intent) setError('Another saved local operation has not been resolved. Retry its original operation ID before starting another operation.')
      } catch (cause) {
        setIntentsChecked(false)
        setError(`The operation committed locally, but remaining saved operations could not be checked: ${messageOf(cause)}. Recheck the operation journal before continuing.`)
      }
      try {
        await refresh()
        setPanelVersion((version) => version + 1)
      } catch (cause) {
        setError(`The operation committed locally, but the follow-up refresh failed: ${messageOf(cause)}. Refresh before continuing.`)
      }
      return result
    } catch (cause) {
      const unknown = cause && typeof cause === 'object' && (cause.outcomeUnknown === true || cause.code === 'UNKNOWN_OUTCOME')
      if (!unknown) setPending(null)
      else setPending((current) => current ? { ...current, state: 'outcome_unknown' } : current)
      setError(unknown
        ? `${messageOf(cause)} The operation result is uncertain. Retry the same operation below; do not submit a new operation.`
        : messageOf(cause))
      return null
    } finally { setBusy(false) }
  }

  const resolvePendingOperation = async () => {
    if (!pending || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const operation = await window.api.barLocal.getOperation(pending.id)
      if (operation?.status === 'committed') {
        const result = {
          outcome: 'committed_local',
          receipt: operation.receipt,
          result: operation.result
        }
        setPending(null)
        setNotice(`${commandNotice(pending.command)} Saved operation ${pending.id} was confirmed as committed by the local authority.`)
        applyCommittedState(pending.command, pending.payload, result)
        try {
          const intent = await loadOpenIntent()
          setPending(intent)
          if (intent) setError('Another saved local operation has not been resolved. Retry its original operation ID before starting another operation.')
        } catch (cause) {
          setIntentsChecked(false)
          setError(`Operation ${pending.id} is committed locally, but remaining saved operations could not be checked: ${messageOf(cause)}. Recheck the operation journal before continuing.`)
        }
        try {
          await refresh()
          setPanelVersion((version) => version + 1)
        } catch (cause) {
          setError(`Operation ${pending.id} is committed locally, but the follow-up refresh failed: ${messageOf(cause)}. Refresh before continuing.`)
        }
        return
      }
      if (operation?.status === 'refused') {
        setPending(null)
        const refusal = operation.error?.message || `The local authority refused operation ${pending.id}; nothing was committed.`
        setError(refusal)
        try {
          const intent = await loadOpenIntent()
          setPending(intent)
          if (intent) setError(`${refusal} Another saved local operation has not been resolved.`)
        } catch (cause) {
          setIntentsChecked(false)
          setError(`${refusal} Remaining saved operations could not be checked: ${messageOf(cause)}. Recheck the operation journal before continuing.`)
        }
        try {
          await refresh()
          setPanelVersion((version) => version + 1)
        } catch { /* The refusal is authoritative even when the refresh fails. */ }
        return
      }
      setNotice(`The local authority still reports operation ${pending.id} as ${operation?.status || 'unresolved'}. Keep this screen open and retry the same operation; do not start a new sale.`)
    } catch (cause) {
      setError(`${messageOf(cause)} Keep the saved operation ${pending.id} on screen. Retry the same operation ID or recheck its status; do not create a new operation.`)
    } finally { setBusy(false) }
  }

  const submitApprovedCommand = async (command, payload, approvalPin) => {
    if (intentsFenced) {
      setError('Saved local operations have not been checked yet. Resolve the saved-operation check before any approved action.')
      return null
    }
    if (busy || pending || approvalBusy) return null
    if (!/^\d{4,12}$/.test(String(approvalPin ?? ''))) {
      setError('A different authorised operator must enter a valid 4–12 digit PIN to approve this operation.')
      return null
    }
    const operationId = crypto.randomUUID()
    setApprovalBusy(true); setError(''); setNotice('')
    try {
      const approval = await window.api.barLocal.requestApprovalForCommand({ command, payload, pin: approvalPin, operation_id: operationId })
      if (!approval?.approval_id) throw new Error('Manager approval was not confirmed. Nothing was submitted.')
      return await submitCommand(command, { ...payload, approval_id: approval.approval_id }, null, operationId)
    } catch (cause) {
      setError(messageOf(cause))
      return null
    } finally { setApprovalBusy(false) }
  }

  const openShift = (event) => {
    event.preventDefault()
    if (!MONEY_TWO.test(float)) { setError('Opening float must be a non-negative amount with up to two decimal places.'); return }
    void submitCommand('shift.open', { opening_float: float })
  }

  const saveProduct = (event) => {
    event.preventDefault()
    setError('')
    if (!menuDraft.sku.trim() || !menuDraft.name.trim() || !MONEY_TWO.test(menuDraft.price)
      || !COST_FOUR.test(menuDraft.taxRate)) {
      setError('Enter a SKU, product name, price with up to two decimals and tax multiplier with up to four decimals.')
      return
    }
    const payload = {
      sku: menuDraft.sku.trim(), name: menuDraft.name.trim(), category: menuDraft.category.trim() || undefined,
      price: menuDraft.price, tax_rate: menuDraft.taxRate, track_stock: menuDraft.trackStock, active: true
    }
    if (menuDraft.productId) {
      if (!Number.isSafeInteger(Number(menuDraft.expectedVersion)) || Number(menuDraft.expectedVersion) < 1) {
        setError('The current product version is unavailable. Refresh the menu and reopen this product before saving.'); return
      }
      payload.product_id = menuDraft.productId
      payload.expected_version = Number(menuDraft.expectedVersion)
      payload.active = menuDraft.active
    }
    void submitCommand('catalogue.upsert', payload)
  }

  const editProduct = (row) => {
    const productId = String(row.product_id)
    const expectedVersion = menuProductVersions[productId]
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      setError('The current product version is unavailable. Refresh the menu before editing this product.'); return
    }
    setMenuDraft({ productId, expectedVersion: String(expectedVersion), sku: String(row.sku || ''), name: String(row.name || ''), category: String(row.category || ''), price: String(row.price ?? ''), taxRate: String(row.tax_rate ?? '0.00'), trackStock: row.track_stock === true, active: row.product_active === true })
    setActivePanel('counter')
    setError('')
    setNotice(`Editing ${String(row.name || 'product')} at version ${expectedVersion}. A concurrent change will be rejected; refresh and review it before retrying.`)
  }

  const createSupportReport = (event) => {
    event.preventDefault()
    if (!supportDraft.subject.trim() || !supportDraft.message.trim()) { setError('Enter a subject and describe the support issue.'); return }
    void submitCommand('support.report.create', {
      ...supportDraft,
      diagnostics: { service_ready: readiness?.ready === true, readiness_blockers: Array.isArray(readiness?.blockers) ? readiness.blockers : [] },
      metadata: { application: 'hospitality-pos', authority_id: status.authority?.authority_id || null }
    })
  }

  const createCashier = (event) => {
    event.preventDefault()
    if (!staffDraft.display_name.trim()) { setError('Enter the staff member’s name.'); return }
    if (!/^\d{4,12}$/.test(staffDraft.pin)) { setError('The staff PIN must contain 4–12 digits.'); return }
    void submitCommand('staff.create', { display_name: staffDraft.display_name.trim(), role: staffDraft.role, pin: staffDraft.pin })
  }

  const generatePairingCode = async () => {
    if (commandBlocked || pairingBusy) return
    setPairingBusy(true); setError(''); setNotice('')
    try {
      const result = await window.api.barLocal.startPairing({ ttl_seconds: 300 })
      if (result?.ok !== true || typeof result.pairing_code !== 'string' || !Number.isSafeInteger(result.expires_in)) {
        throw new Error('The local service returned an invalid pairing response. No code was shown.')
      }
      if (typeof result.server_certificate_fingerprint !== 'string' || !result.server_certificate_fingerprint) throw new Error('The security details are not available yet. Refresh the Bar and try again.')
      setPairingCode({ code: result.pairing_code, expiresAt: Date.now() + result.expires_in * 1000, fingerprint: result.server_certificate_fingerprint })
      setNotice('A single-use pairing code is ready. Give it only to the till being paired; it expires shortly.')
    } catch (cause) { setError(messageOf(cause)) }
    finally { setPairingBusy(false) }
  }

  const commitSale = () => {
    if (!shift || cart.length === 0 || totalCents === null) return
    setError('')
    const evaluation = evaluateTenders({ totalCents, rows: saleTenderRows })
    if (evaluation.error || evaluation.tenders.length === 0) {
      setError(evaluation.error || 'Prepare the payment before committing the sale.')
      return
    }
    const code = promotionCode.trim().toUpperCase()
    const payload = {
      shift_id: shift.shift_id,
      items: cart.map(({ product, quantity, modifiers }) => ({ product_id: product.product_id, quantity: String(quantity), modifiers })),
      tenders: evaluation.tenders,
      discount_amount: '0.00', tip_amount: '0.00', ...(code ? { promotion_code: code } : {})
    }
    if (!code || !promotionApprovalRequired) { void submitCommand('sale.commit', payload); return }
    if (!canApplyDiscount) { setError('Your role is not authorised to apply this promotion. Ask a manager for an authorised operator.'); return }
    if (!/^\d{4,12}$/.test(discountApprovalPin)) { setError('A different manager must enter a valid PIN to approve this promotion discount.'); return }
    void (async () => {
      const operationId = crypto.randomUUID()
      setDiscountApprovalBusy(true); setError('')
      try {
        const approval = await window.api.barLocal.requestApprovalForCommand({ command: 'sale.commit', payload, pin: discountApprovalPin, operation_id: operationId })
        if (!approval?.approval_id) throw new Error('Manager approval was not confirmed. No sale was submitted.')
        setDiscountApprovalPin('')
        await submitCommand('sale.commit', { ...payload, approval_id: approval.approval_id }, null, operationId)
      } catch (cause) { setError(messageOf(cause)) }
      finally { setDiscountApprovalBusy(false) }
    })()
  }

  const addProduct = (product) => setCart((current) => {
    const found = current.find((line) => line.product.product_id === product.product_id && line.modifiers.length === 0)
    if (found) return current.map((line) => line.cartId === found.cartId ? { ...line, quantity: line.quantity + 1 } : line)
    return [...current, { cartId: crypto.randomUUID(), product, quantity: 1, modifiers: [] }]
  })

  const toggleModifier = (cartId, optionId, checked, group) => setCart((current) => current.map((line) => {
    if (line.cartId !== cartId) return line
    const groupOptions = Array.isArray(group.options) ? group.options : []
    const ids = groupOptions.map((option) => String(option.option_id ?? option.modifier_option_id))
    const selected = new Set(line.modifiers.filter((id) => !ids.includes(id)))
    const alreadySelected = line.modifiers.includes(String(optionId))
    if (checked && !alreadySelected) {
      const maximum = Number(group.max_selections ?? 1)
      const currentCount = line.modifiers.filter((id) => ids.includes(id)).length
      if (currentCount >= maximum) return line
      selected.add(String(optionId))
    } else if (!checked) selected.delete(String(optionId))
    return { ...line, modifiers: [...selected] }
  }))

  const selectTab = (tabId) => {
    setSelectedTabId(String(tabId))
    setSelectedTab(null)
  }

  const addCartToTab = () => {
    if (!selectedTab || !shift || cart.length === 0) return
    setError('')
    if (selectedTab.status !== 'open') { setError('This tab is no longer open. Select an open tab before adding lines.'); return }
    void submitCommand('tab.add', {
      tab_id: selectedTab.tab_id,
      expected_version: selectedTab.version,
      items: cart.map((line) => ({ product_id: line.product.product_id, quantity: String(line.quantity), modifiers: line.modifiers }))
    })
  }

  const selectSale = (saleId) => {
    setSelectedSaleId(String(saleId))
    setSelectedSale(null)
    setReturnDraft({ lineQuantities: {}, reason: '', disposition: 'restock' })
    setReturnApprovalPin('')
  }

  const submitReturn = async (event) => {
    event.preventDefault()
    setError(''); setNotice('')
    if (readinessStateFor(readiness, Date.now()) !== 'ready') { setError('Trading is paused until the local Bar server readiness check succeeds. Keep this return and check readiness.'); return }
    if (!selectedSale) { setError('Select a sale before preparing a return.'); return }
    if (!canReturnBarSaleLines(selectedSale)) { setError('This receipt has no remaining items to return. Refresh and check the original receipt.'); return }
    const selectedLines = (Array.isArray(selectedSale.lines) ? selectedSale.lines : [])
      .map((line) => ({ line, quantity: String(returnDraft.lineQuantities[String(line.sale_line_id)] ?? '').trim() }))
      .filter(({ quantity }) => quantity !== '')
    if (selectedLines.length === 0) { setError('Enter a return quantity for at least one sale line.'); return }
    for (const { line, quantity } of selectedLines) {
      if (!QUANTITY_SIX.test(quantity) || Number(quantity) <= 0) { setError('Each return quantity must be greater than zero with up to six decimals.'); return }
      if (!barReturnQuantityWithinRemaining(quantity, line.remaining_quantity)) { setError(`Return quantity for ${String(line.name)} exceeds the remaining returnable quantity. Refresh the receipt before trying again.`); return }
    }
    if (!returnDraft.reason.trim()) { setError('Enter a reason for the return.'); return }
    if (!/^\d{4,12}$/.test(returnApprovalPin)) { setError('A manager must enter their numeric PIN to approve this return.'); return }
    if (busy || pending || returnApprovalBusy) return
    const payload = {
      sale_id: selectedSale.sale_id,
      reason: returnDraft.reason.trim(),
      disposition: returnDraft.disposition,
      lines: selectedLines.map(({ line, quantity }) => ({ sale_line_id: String(line.sale_line_id), quantity }))
    }
    const operationId = crypto.randomUUID()
    setReturnApprovalBusy(true)
    try {
      const approval = await window.api.barLocal.requestApprovalForCommand({
        command: 'sale.return', payload, pin: returnApprovalPin, operation_id: operationId
      })
      setReturnApprovalPin('')
      await submitCommand('sale.return', { ...payload, approval_id: approval.approval_id }, null, operationId)
    } catch (cause) {
      setReturnApprovalPin('')
      setError(messageOf(cause))
    } finally { setReturnApprovalBusy(false) }
  }

  const submitSaleVoid = async () => {
    setError(''); setNotice('')
    if (readinessStateFor(readiness, Date.now()) !== 'ready') { setError('Trading is paused until the local Bar server readiness check succeeds. Keep this void and check readiness.'); return }
    if (!selectedSale) { setError('Select a sale before preparing a void.'); return }
    if (!canVoidRemainingBarSale(selectedSale)) { setError('This receipt has no remaining sale or tip to cancel. Refresh and check the original receipt.'); return }
    if (!returnDraft.reason.trim()) { setError('Enter a reason before voiding the sale.'); return }
    if (!/^\d{4,12}$/.test(returnApprovalPin)) { setError('A different manager must enter their numeric PIN.'); return }
    if (busy || pending || returnApprovalBusy) return
    if (!window.confirm(`Cancel the remaining items and unallocated tip on receipt ${String(selectedSale.receipt_number)}? Already returned items will not be refunded again. The original drawer must still be open.`)) return
    const payload = { sale_id: selectedSale.sale_id, reason: returnDraft.reason.trim() }
    const operationId = crypto.randomUUID()
    setReturnApprovalBusy(true)
    try {
      const approval = await window.api.barLocal.requestApprovalForCommand({ command: 'sale.void', payload, pin: returnApprovalPin, operation_id: operationId })
      setReturnApprovalPin('')
      await submitCommand('sale.void', { ...payload, approval_id: approval.approval_id }, null, operationId)
    } catch (cause) {
      setReturnApprovalPin('')
      setError(messageOf(cause))
    } finally { setReturnApprovalBusy(false) }
  }

  const submitPostCloseReturn = async (event) => {
    event.preventDefault()
    setError(''); setNotice('')
    if (readinessStateFor(readiness, Date.now()) !== 'ready') { setError('Trading is paused until the local Bar server readiness check succeeds. Keep this correction and check readiness.'); return }
    if (!selectedSale) { setError('Select a closed-day original sale before preparing a correction.'); return }
    if (!canPostCloseReturnBarSaleLines(selectedSale)) { setError(barPostCloseCorrectionBlockedMessage(selectedSale) || 'This receipt has no remaining items to correct.'); return }
    const selectedLines = (Array.isArray(selectedSale.lines) ? selectedSale.lines : [])
      .map((line) => ({ line, quantity: String(returnDraft.lineQuantities[String(line.sale_line_id)] ?? '').trim() }))
      .filter(({ quantity }) => quantity !== '')
    if (selectedLines.length === 0) { setError('Enter a correction quantity for at least one remaining sale line.'); return }
    for (const { line, quantity } of selectedLines) {
      if (!QUANTITY_SIX.test(quantity) || Number(quantity) <= 0) { setError('Each correction quantity must be greater than zero with up to six decimals.'); return }
      if (!barReturnQuantityWithinRemaining(quantity, line.remaining_quantity)) { setError(`Correction quantity for ${String(line.name)} exceeds the remaining quantity. Refresh the receipt before trying again.`); return }
    }
    if (!returnDraft.reason.trim()) { setError('Enter a reason for the post-close correction.'); return }
    if (!/^\d{4,12}$/.test(returnApprovalPin)) { setError('A manager must enter their numeric PIN to approve this correction.'); return }
    if (busy || pending || returnApprovalBusy) return
    if (!window.confirm(`Post a current-date compensating return for closed receipt ${String(selectedSale.receipt_number)}? The original receipt and its closed business date will not be changed.`)) return
    const payload = {
      sale_id: selectedSale.sale_id,
      kind: 'return',
      reason: returnDraft.reason.trim(),
      disposition: returnDraft.disposition,
      lines: selectedLines.map(({ line, quantity }) => ({ sale_line_id: String(line.sale_line_id), quantity }))
    }
    const operationId = crypto.randomUUID()
    setReturnApprovalBusy(true)
    try {
      const approval = await window.api.barLocal.requestApprovalForCommand({
        command: 'sale.correct_after_close', payload, pin: returnApprovalPin, operation_id: operationId
      })
      if (!approval?.approval_id) throw new Error('Manager approval was not confirmed. Nothing was submitted.')
      setReturnApprovalPin('')
      const result = await submitCommand('sale.correct_after_close', { ...payload, approval_id: approval.approval_id }, null, operationId)
      if (result) setReturnDraft({ lineQuantities: {}, reason: '', disposition: 'restock' })
    } catch (cause) {
      setReturnApprovalPin('')
      setError(messageOf(cause))
    } finally { setReturnApprovalBusy(false) }
  }

  const submitPostCloseVoid = async () => {
    setError(''); setNotice('')
    if (readinessStateFor(readiness, Date.now()) !== 'ready') { setError('Trading is paused until the local Bar server readiness check succeeds. Keep this correction and check readiness.'); return }
    if (!selectedSale) { setError('Select a closed-day original sale before preparing a correction.'); return }
    if (!canPostCloseSelectedSale) { setError(barPostCloseCorrectionBlockedMessage(selectedSale) || 'This receipt has no remaining sale or tip to cancel.'); return }
    if (!returnDraft.reason.trim()) { setError('Enter a reason before cancelling the remaining closed-day sale.'); return }
    if (!/^\d{4,12}$/.test(returnApprovalPin)) { setError('A manager must enter their numeric PIN to approve this correction.'); return }
    if (busy || pending || returnApprovalBusy) return
    if (!window.confirm(`Post a current-date cancellation for the remaining items and unallocated tip on closed receipt ${String(selectedSale.receipt_number)}? The original receipt and its closed business date will not be changed.`)) return
    const payload = { sale_id: selectedSale.sale_id, kind: 'void', reason: returnDraft.reason.trim() }
    const operationId = crypto.randomUUID()
    setReturnApprovalBusy(true)
    try {
      const approval = await window.api.barLocal.requestApprovalForCommand({
        command: 'sale.correct_after_close', payload, pin: returnApprovalPin, operation_id: operationId
      })
      if (!approval?.approval_id) throw new Error('Manager approval was not confirmed. Nothing was submitted.')
      setReturnApprovalPin('')
      const result = await submitCommand('sale.correct_after_close', { ...payload, approval_id: approval.approval_id }, null, operationId)
      if (result) setReturnDraft({ lineQuantities: {}, reason: '', disposition: 'restock' })
    } catch (cause) {
      setReturnApprovalPin('')
      setError(messageOf(cause))
    } finally { setReturnApprovalBusy(false) }
  }

  const closeShift = (event) => {
    event.preventDefault()
    setError('')
    if (!shift) return
    if (!MONEY_TWO.test(closeDraft.counted_cash)) { setError('Counted cash must be a non-negative amount with up to two decimal places.'); return }
    void submitCommand('shift.close', {
      shift_id: shift.shift_id,
      counted_cash: closeDraft.counted_cash.trim(),
      note: closeDraft.notes.trim() || undefined
    })
  }

  const submitCashup = (event) => {
    event.preventDefault()
    setError('')
    if (!closedShift) { setError('Close the shift before submitting the cash-up.'); return }
    if (!MONEY_TWO.test(cashupDraft.counted_cash)) { setError('Counted cash must be a non-negative amount with up to two decimal places.'); return }
    if (cashupDraft.counted_card.trim() && !MONEY_TWO.test(cashupDraft.counted_card)) {
      setError('Counted card must be a non-negative amount with up to two decimal places.')
      return
    }
    void submitCommand('cashup.submit', {
      shift_id: closedShift.shift_id,
      counted_cash: cashupDraft.counted_cash.trim(),
      counted_card: cashupDraft.counted_card.trim() || undefined,
      notes: cashupDraft.notes.trim() || undefined,
      proof_refs: []
    })
  }

  const submitCashupReview = async (event) => {
    event.preventDefault()
    setError(''); setNotice('')
    if (!review || review.status !== 'submitted') { setError('Refresh the cash-up summary; only a submitted cash-up can be reviewed.'); return }
    if (!canCashup) { setError('Your role cannot review cash-ups.'); return }
    if (!cashupReviewDraft.reason.trim()) { setError('Enter a reason for the cash-up decision.'); return }
    if (!/^\d{4,12}$/.test(cashupReviewDraft.pin)) { setError('A different manager must enter their numeric PIN.'); return }
    if (busy || pending || cashupApprovalBusy) return
    const payload = { cashup_id: review.cashup_id, decision: cashupReviewDraft.decision, reason: cashupReviewDraft.reason.trim() }
    const operationId = crypto.randomUUID()
    setCashupApprovalBusy(true)
    try {
      const approval = await window.api.barLocal.requestApprovalForCommand({ command: 'cashup.review', payload, pin: cashupReviewDraft.pin, operation_id: operationId })
      setCashupReviewDraft((draft) => ({ ...draft, pin: '' }))
      await submitCommand('cashup.review', { ...payload, approval_id: approval.approval_id }, null, operationId)
    } catch (cause) {
      setCashupReviewDraft((draft) => ({ ...draft, pin: '' }))
      setError(messageOf(cause))
    } finally { setCashupApprovalBusy(false) }
  }

  const submitCashupReopen = async (event) => {
    event.preventDefault()
    setError(''); setNotice('')
    if (!review || !['approved', 'rejected'].includes(String(review.status))) { setError('Refresh the cash-up summary; only a reviewed cash-up can be reopened.'); return }
    if (!canCashup) { setError('Your role cannot reopen cash-ups.'); return }
    if (!MONEY_TWO.test(cashupReopenDraft.counted_cash) || !MONEY_TWO.test(cashupReopenDraft.counted_card)) { setError('Enter valid non-negative cash and card counts with up to two decimal places.'); return }
    if (!cashupReopenDraft.reason.trim()) { setError('Enter why this reviewed cash-up must be reopened.'); return }
    if (!/^\d{4,12}$/.test(cashupReopenDraft.pin)) { setError('A different manager must enter their numeric PIN.'); return }
    if (busy || pending || cashupApprovalBusy) return
    const payload = {
      cashup_id: review.cashup_id,
      expected_status: review.status,
      counted_cash: cashupReopenDraft.counted_cash.trim(),
      counted_card: cashupReopenDraft.counted_card.trim(),
      notes: cashupReopenDraft.notes.trim() || undefined,
      proof_refs: cashupReopenDraft.proof_ref.trim() ? [cashupReopenDraft.proof_ref.trim()] : [],
      reason: cashupReopenDraft.reason.trim()
    }
    const operationId = crypto.randomUUID()
    setCashupApprovalBusy(true)
    try {
      const approval = await window.api.barLocal.requestApprovalForCommand({ command: 'cashup.reopen', payload, pin: cashupReopenDraft.pin, operation_id: operationId })
      setCashupReopenDraft((draft) => ({ ...draft, pin: '' }))
      await submitCommand('cashup.reopen', { ...payload, approval_id: approval.approval_id }, null, operationId)
      setCashupReopenDraft({ counted_cash: '', counted_card: '0.00', notes: '', proof_ref: '', reason: '', pin: '' })
    } catch (cause) {
      setCashupReopenDraft((draft) => ({ ...draft, pin: '' }))
      setError(messageOf(cause))
    } finally { setCashupApprovalBusy(false) }
  }

  const recordDrawerMovement = (event) => {
    event.preventDefault()
    setError('')
    if (!shift) { setError('Open a shift before recording drawer cash or a count.'); return }
    const counting = drawerDraft.type === 'count'
    if (!MONEY_TWO.test(drawerDraft.amount) || Number(drawerDraft.amount) < 0 || (!counting && Number(drawerDraft.amount) === 0)) {
      setError(counting ? 'Enter counted cash of zero or more with up to two decimal places.' : 'Enter an amount greater than zero with up to two decimal places.'); return
    }
    if (!drawerDraft.reason.trim()) { setError(counting ? 'Enter a note for this physical cash count.' : 'Enter the reason for this drawer movement.'); return }
    void submitCommand('drawer.movement', {
      shift_id: shift.shift_id,
      type: drawerDraft.type,
      amount: drawerDraft.amount.trim(),
      reason: drawerDraft.reason.trim()
    })
  }

  const receiveStock = (event) => {
    event.preventDefault()
    setError('')
    const product = stock.find((item) => item.product_id === stockDraft.product_id)
    if (!product) { setError('Select the product to receive.'); return }
    if (!QUANTITY_SIX.test(stockDraft.quantity) || Number(stockDraft.quantity) <= 0) {
      setError('Receive quantity must be greater than zero with up to six decimals.')
      return
    }
    if (stockDraft.unit_cost.trim() && !COST_FOUR.test(stockDraft.unit_cost)) {
      setError('Unit cost must be a non-negative amount with up to four decimals.')
      return
    }
    if (stockDraft.expires_on && !DATE_ONLY.test(stockDraft.expires_on)) {
      setError('Expiry must be a YYYY-MM-DD date.')
      return
    }
    void submitCommand('stock.receive', {
      product_id: product.product_id,
      quantity: stockDraft.quantity.trim(),
      unit_cost: stockDraft.unit_cost.trim() || undefined,
      supplier_ref: stockDraft.supplier_ref.trim() || undefined,
      lot_code: stockDraft.lot_code.trim() || undefined,
      expires_on: stockDraft.expires_on || undefined
    })
  }

  const logout = async () => {
    setBusy(true); setError(''); setNotice('')
    try {
      if (!intentsChecked || intentCheckError) {
        throw new Error('Sign-out is blocked because saved local operations have not been checked. Reconnect to the configured Bar server and recheck the operation journal before leaving this till.')
      }
      if (pending) {
        throw new Error(`Sign-out is blocked. Resolve saved operation ${pending.id} with its original operation ID, or ask a manager to recover it through the local Bar service before leaving this till.`)
      }
      let intent
      try {
        intent = await loadOpenIntent()
      } catch (cause) {
        setIntentsChecked(false)
        setIntentCheckError(messageOf(cause))
        throw new Error('Sign-out is blocked because saved local operations could not be checked. Reconnect to the configured Bar server and recheck, or ask a manager to recover the operation journal before leaving this till.')
      }
      if (intent) {
        setPending(intent)
        setIntentsChecked(true)
        throw new Error(`Sign-out is blocked. Saved operation ${intent.id} has not been resolved. Retry its original operation ID, or ask a manager to recover it through the local Bar service before leaving this till.`)
      }
      setIntentsChecked(true)
      await window.api.barLocal.logout()
      clearSessionWorkspace()
      onLogout()
    } catch (cause) { setError(messageOf(cause)) }
    finally { setBusy(false) }
  }

  if (!session) return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <form onSubmit={loginMode === 'recover' ? (event) => { event.preventDefault(); void recoverOwnerPassword() } : login} className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-8 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">Bar local authority</p>
        <h1 className="mt-3 text-2xl font-bold">Bar sign in</h1>
          {status.training !== true && <BarReplacementConnection onConnect={request => window.api.barLocal.reconnectServer(request)} />}
        <p className="mt-2 text-sm text-slate-300">Owner and staff sign-ins use the configured local Bar service and work without internet.</p>
        {initialLoginNotice && <p role="status" className="mt-4 rounded bg-amber-950 p-3 text-sm text-amber-100">{initialLoginNotice}</p>}
        {loginMode !== 'recover' && <div className="mt-5 flex gap-2" role="tablist" aria-label="Bar sign in type">
          <button type="button" role="tab" aria-selected={loginMode === 'staff'} onClick={() => { setLoginMode('staff'); setError('') }} className={`flex-1 rounded border p-2 text-sm ${loginMode === 'staff' ? 'border-amber-400 bg-amber-950' : 'border-slate-700'}`}>Staff PIN</button>
          <button type="button" role="tab" aria-selected={loginMode === 'owner'} onClick={() => { setLoginMode('owner'); setError('') }} className={`flex-1 rounded border p-2 text-sm ${loginMode === 'owner' ? 'border-amber-400 bg-amber-950' : 'border-slate-700'}`}>Owner email</button>
        </div>}
        {loginMode === 'staff' && <>
          <label className="mt-5 block text-sm">Staff ID<input required value={staffId} onChange={(event) => setStaffId(event.target.value)} className="mt-1 w-full rounded-md bg-slate-800 p-3" autoComplete="username" /></label>
          <label className="mt-4 block text-sm">PIN<input required inputMode="numeric" pattern="[0-9]{4,12}" type="password" value={pin} onChange={(event) => setPin(event.target.value)} className="mt-1 w-full rounded-md bg-slate-800 p-3" autoComplete="current-password" /></label>
        </>}
        {loginMode === 'owner' && <>
          <label className="mt-5 block text-sm">Owner email<input required type="email" maxLength={254} value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} className="mt-1 w-full rounded-md bg-slate-800 p-3" autoComplete="username" /></label>
          <label className="mt-4 block text-sm">Password<input required minLength={12} maxLength={128} type="password" value={ownerPassword} onChange={(event) => setOwnerPassword(event.target.value)} className="mt-1 w-full rounded-md bg-slate-800 p-3" autoComplete="current-password" /></label>
          <button type="button" onClick={() => { setLoginMode('recover'); setError('') }} className="mt-3 text-left text-xs text-amber-200 underline">Forgot password? Use the main Bar computer to reset it.</button>
        </>}
        {loginMode === 'recover' && <div className="mt-5 space-y-4">
          <p className="text-sm text-slate-300">Recovery must be done on the main Bar computer. It will sign out all other sessions.</p>
          <label className="block text-sm">Owner email<input required type="email" maxLength={254} value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} className="mt-1 w-full rounded-md bg-slate-800 p-3" autoComplete="username" /></label>
          <label className="block text-sm">New password<input required minLength={12} maxLength={128} type="password" value={recoveryPassword} onChange={(event) => setRecoveryPassword(event.target.value)} className="mt-1 w-full rounded-md bg-slate-800 p-3" autoComplete="new-password" /></label>
          <button type="button" onClick={() => void recoverOwnerPassword()} disabled={busy || recoveryPassword.length < 12 || !ownerEmail.trim()} className="w-full rounded-md bg-amber-500 p-3 font-semibold text-slate-950 disabled:opacity-50">{busy ? 'Resetting…' : 'Reset owner password'}</button>
          <button type="button" onClick={() => { setLoginMode('owner'); setError('') }} className="w-full rounded border border-slate-600 p-2 text-sm">Back to owner sign in</button>
        </div>}
        {error && <HposNotice tone="error">{error}</HposNotice>}
        {notice && <p role="status" className="mt-3 rounded bg-emerald-950 p-3 text-sm text-emerald-100">{notice}</p>}
        {loginMode !== 'recover' && <button disabled={busy} className="mt-5 w-full rounded-md bg-amber-500 p-3 font-semibold text-slate-950 disabled:opacity-50">{busy ? 'Signing in…' : 'Sign in'}</button>}
      </form>
    </main>
  )

  const review = cashupSummary?.cashup && typeof cashupSummary.cashup === 'object'
    ? /** @type {Record<string, unknown>} */ (cashupSummary.cashup)
    : null
  const reportDays = Array.isArray(report?.days) ? report.days : []
  const reportTenders = Array.isArray(report?.tenders) ? report.tenders : []
  const cashMovementLines = Array.isArray(cashupSummary?.cash_movements) ? cashupSummary.cash_movements : []

  return (
    <main className="min-h-screen bg-slate-950 p-5 text-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 border-b border-slate-700 pb-4">
        <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">Bar · local workspace</p><h1 className="mt-1 text-xl font-bold">Bar counter</h1><p className="text-sm text-slate-300">Signed in as {session.staff?.display_name || 'staff'} · Outlet {session.outlet_id}</p></div>
        <button type="button" disabled={busy || Boolean(pending) || !intentsChecked} onClick={logout} className="rounded border border-slate-600 px-4 py-2 text-sm">Sign out</button>
      </header>
      <section className="mx-auto mt-5 max-w-6xl">
        <div role="status" aria-live="polite" className={`flex flex-wrap items-center justify-between gap-3 rounded border p-3 text-sm ${readinessState === 'ready' ? 'border-emerald-700 bg-emerald-950/40 text-emerald-200' : readinessState === 'blocked' ? 'border-amber-700 bg-amber-950/40 text-amber-100' : 'border-red-800 bg-red-950/40 text-red-200'}`}>
          <div>
            <p>{barLocalReadinessMessage(readinessState)}</p>
            {canManageSettings && readinessState === 'blocked' && <p className="mt-1 text-xs">Manager check: {(readiness?.blockers || []).join(', ') || 'Check server diagnostics in Administration.'}</p>}
            {readiness?.checkedAt > 0 && <p className="mt-1 text-xs opacity-80">Last check: {new Date(readiness.checkedAt).toLocaleTimeString()}{readinessChecking ? ' · checking again…' : ''}</p>}
          </div>
          <button type="button" disabled={readinessChecking} onClick={() => { void refreshReadiness() }} className="rounded border border-current px-3 py-1.5 text-xs font-semibold disabled:opacity-50">{readinessChecking ? 'Checking…' : 'Check connection'}</button>
        </div>
        {catalogueSyncError && <p role="alert" className="mt-2 rounded border border-red-700 bg-red-950/40 p-3 text-sm text-red-100">{catalogueSyncError}</p>}
        {intentsFenced && <div role="status" className="mt-2 rounded border border-sky-700 bg-sky-950/40 p-3 text-sm text-sky-100"><p>Saved local operations are being checked after sign-in. Sales, stock, cash and sign-out stay paused until the operation journal has been verified.</p>{intentCheckError && <p className="mt-1 text-xs text-sky-200">{intentCheckError}</p>}<button type="button" disabled={busy} onClick={() => void recheckOpenIntents()} className="mt-2 rounded border border-sky-400 px-3 py-1 text-xs disabled:opacity-50">Recheck saved operations</button></div>}
        <nav className="mt-4 flex flex-wrap gap-2" aria-label="Bar local workflows">
          {panels.map((panel) => <button key={panel.id} type="button" disabled={busy || Boolean(pending) || intentsFenced} onClick={() => {
            if (busy || pending || intentsFenced) return
            setActivePanel(panel.id); setError(''); setNotice('')
          }} className={`rounded border px-4 py-2 text-sm ${activePanel === panel.id ? 'border-amber-400 bg-amber-500 font-semibold text-slate-950' : 'border-slate-700 bg-slate-900 text-slate-200'} disabled:opacity-50`}>{panel.label}</button>)}
        </nav>

        {activePanel === 'counter' && <>
          {canManageMenu && <form onSubmit={saveProduct} className="mt-4 rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h2 className="font-semibold">{menuDraft.productId ? 'Edit local product' : 'Add a local product'}</h2>
            <p className="mt-1 text-xs text-slate-400">Saved by the local authority. Tax multiplier 0.14 means 14%. Stock-tracked items require a separate stock receipt before they can sell.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <label className="text-xs">SKU<input required maxLength={80} value={menuDraft.sku} onChange={(event) => setMenuDraft((draft) => ({ ...draft, sku: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
              <label className="text-xs">Name<input required maxLength={200} value={menuDraft.name} onChange={(event) => setMenuDraft((draft) => ({ ...draft, name: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
              <label className="text-xs">Category<input maxLength={80} value={menuDraft.category} onChange={(event) => setMenuDraft((draft) => ({ ...draft, category: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
              <label className="text-xs">Price<input required inputMode="decimal" value={menuDraft.price} onChange={(event) => setMenuDraft((draft) => ({ ...draft, price: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
              <label className="text-xs">Tax multiplier<input required inputMode="decimal" value={menuDraft.taxRate} onChange={(event) => setMenuDraft((draft) => ({ ...draft, taxRate: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            </div>
            <label className="mt-3 inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={menuDraft.trackStock} onChange={(event) => setMenuDraft((draft) => ({ ...draft, trackStock: event.target.checked }))} />Track stock</label>
            {menuDraft.productId && <label className="ml-4 inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={menuDraft.active} onChange={(event) => setMenuDraft((draft) => ({ ...draft, active: event.target.checked }))} />Active on menu</label>}
            <button disabled={commandBlocked} className="ml-4 rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">{menuDraft.productId ? 'Save changes' : 'Save product'}</button>
            {menuDraft.productId && <button type="button" disabled={commandBlocked} onClick={() => setMenuDraft({ productId: '', expectedVersion: '', sku: '', name: '', category: '', price: '', taxRate: '0.00', trackStock: true, active: true })} className="ml-2 rounded border border-slate-600 px-4 py-2 text-sm">Cancel edit</button>}
          </form>}
          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_22rem]">
            <div>
              {!shift ? <form onSubmit={openShift} className="rounded-xl border border-amber-800 bg-amber-950/30 p-5"><h2 className="font-semibold">Open your shift</h2><p className="mt-1 text-sm text-slate-300">The local authority must accept the shift before this till can sell.</p><label className="mt-3 block text-sm">Opening cash float<input value={float} onChange={(event) => setFloat(event.target.value)} inputMode="decimal" className="mt-1 block w-48 rounded bg-slate-800 p-2" /></label><button disabled={commandBlocked || !localReady || !canManageTill} className="mt-3 rounded bg-amber-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50">Open shift</button>{!localReady && <p className="mt-2 text-xs text-amber-200">Opening is paused until the authenticated local readiness check passes{readiness?.blockers?.length ? `: ${readiness.blockers.join(', ')}` : '.'}</p>}{!canManageTill && <p className="mt-2 text-xs text-amber-200">Your role cannot open a trading shift.</p>}</form> : <><h2 className="mb-3 font-semibold">Available products</h2><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{catalogue.map((product) => <button key={String(product.product_id)} type="button" disabled={commandBlocked || !shift} onClick={() => addProduct(product)} className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-left hover:border-amber-500 disabled:opacity-50"><span className="block font-semibold">{String(product.name)}</span><span className="mt-1 block text-sm text-slate-300">{String(product.price)} · {String(product.category || 'Bar')}</span></button>)}</div>{catalogue.length === 0 && <p className="rounded border border-amber-800 p-4 text-sm">No available products are in the complete local catalogue. Ask a manager to publish products before trading.</p>}</>}
            </div>
            <aside className="h-fit rounded-xl border border-slate-700 bg-slate-900 p-4"><h2 className="font-semibold">Current sale</h2><ul className="mt-3 space-y-3">{cart.map(({ cartId, product, quantity, modifiers }) => <li key={cartId} className="border-b border-slate-700 pb-3 text-sm"><div className="flex justify-between gap-3"><span>{String(product.name)} × {quantity}</span><button type="button" disabled={Boolean(pending)} onClick={() => setCart((rows) => rows.filter((row) => row.cartId !== cartId))} className="text-amber-300">Remove</button></div>{Array.isArray(product.modifier_groups) && product.modifier_groups.map((group) => <fieldset key={String(group.modifier_group_id || group.group_id)} className="mt-2 rounded border border-slate-700 p-2"><legend className="px-1 text-xs text-slate-300">{String(group.name)}{group.required ? ' · required' : ''}</legend><div className="space-y-1">{(Array.isArray(group.options) ? group.options : []).map((option) => { const optionId = String(option.option_id || option.modifier_option_id); return <label key={optionId} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={modifiers.includes(optionId)} disabled={commandBlocked} onChange={(event) => toggleModifier(cartId, optionId, event.target.checked, group)} /><span>{String(option.name)}{Number(option.price_delta) !== 0 ? ` (+${displayMoney(option.price_delta)})` : ''}</span></label> })}</div></fieldset>)}</li>)}</ul>{canApplyDiscount ? <label className="mt-4 block text-xs">Promotion code (optional)<input maxLength={32} autoComplete="off" value={promotionCode} onChange={(event) => setPromotionCode(event.target.value.toUpperCase())} disabled={commandBlocked || !canApplyDiscount} className="mt-1 w-full rounded bg-slate-800 p-2" /></label> : <p className="mt-4 text-xs text-slate-400">Promotion entry is available only to staff authorised for discounts.</p>}{promotionApprovalRequired && <label className="mt-3 block text-xs">Different manager PIN<input required type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={discountApprovalPin} onChange={(event) => setDiscountApprovalPin(event.target.value.replace(/\D/g, ''))} disabled={discountApprovalBusy || commandBlocked} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>}<div className="mt-4 border-t border-slate-700 pt-3"><p className="flex justify-between font-semibold"><span>Estimated cash due</span><span>{totalCents === null ? '—' : formatBarLocalMoney(totalCents)}</span></p>{saleEstimate && discountPolicy && exceedsDiscountMaximum(saleEstimate.promotionDiscountCents, saleEstimate.subtotalCents, discountPolicy.maximum_percent) && <p role="alert" className="mt-2 text-xs text-red-200">This promotion exceeds the configured maximum discount and cannot be applied.</p>}{cart.length > 0 && totalCents === null && !(saleEstimate && discountPolicy && exceedsDiscountMaximum(saleEstimate.promotionDiscountCents, saleEstimate.subtotalCents, discountPolicy.maximum_percent)) && <p role="alert" className="mt-2 text-xs text-amber-200">Check modifier selections and verify that the promotion is currently available and applies to this sale.</p>}{promotionApprovalRequired && <p className="mt-2 text-xs text-amber-200">The promotion exceeds the local approval threshold. A different manager must approve the exact sale.</p>}<p className="mt-2 text-xs text-slate-400">Prices and promotion totals are estimates; the local service rechecks the code, dates, scope, minimum, discount policy and stock atomically before commit.</p>{totalCents !== null && cart.length > 0 && <BarLocalTenderEditor totalCents={totalCents} rows={saleTenderRows} onChange={setSaleTenderRows} disabled={commandBlocked || discountApprovalBusy || !localReady || !shift} customers={customers} canUseStoreCredit={canUseCustomers} canUseVoucher={canUseVouchers} />}<button type="button" disabled={commandBlocked || Boolean(catalogueSyncError) || discountApprovalBusy || Boolean(saleTenderEvaluation.error) || saleTenderEvaluation.tenders.length === 0 || (promotionApprovalRequired && !/^\d{4,12}$/.test(discountApprovalPin)) || !localReady || !shift || cart.length === 0 || totalCents === null} onClick={commitSale} className="mt-4 w-full rounded bg-emerald-600 p-3 font-semibold disabled:opacity-40">{promotionApprovalRequired ? 'Approve and commit sale' : 'Commit sale'}</button></div></aside>
          </div>
        </>}

        {activePanel === 'tabs' && <BarLocalTabsPanel
          openTabs={openTabs}
          selectedTab={selectedTab}
          selectedTabId={selectedTabId}
          onSelectTab={selectTab}
          onRefresh={() => setPanelVersion((version) => version + 1)}
          onCommand={submitCommand}
          onApprovedCommand={submitApprovedCommand}
          onAddCart={addCartToTab}
          cartCount={cart.length}
          cartTotalCents={totalCents}
          shift={shift}
          staffRows={staffRows}
          customers={customers}
          blocked={commandBlocked}
          localReady={localReady}
          canUseStoreCredit={canUseCustomers}
          canUseVoucher={canUseVouchers}
        />}

        {activePanel === 'returns' && <section className="mt-5 grid gap-5 lg:grid-cols-2">
          <div>
            <div className="flex items-center justify-between"><h2 className="font-semibold">Recent sales</h2><button type="button" disabled={commandBlocked} onClick={() => setPanelVersion((version) => version + 1)} className="rounded border border-slate-600 px-3 py-1 text-xs">Refresh</button></div>
            {sales.length === 0 ? <p className="mt-3 rounded border border-slate-700 p-4 text-sm text-slate-300">No recent sales are available for return.</p> : <ul className="mt-3 space-y-2">{sales.map((sale) => <li key={String(sale.sale_id)}><button type="button" disabled={commandBlocked} onClick={() => selectSale(sale.sale_id)} className={`w-full rounded border p-3 text-left ${selectedSaleId === String(sale.sale_id) ? 'border-amber-400 bg-amber-950/30' : 'border-slate-700 bg-slate-900'}`}><span className="flex justify-between gap-3"><span className="font-semibold">Receipt {String(sale.receipt_number)}</span><span>{displayMoney(sale.total)}</span></span><span className="mt-1 block text-xs text-slate-400">{String(sale.business_date)} · {String(sale.status)} {sale.original_sale_id ? '· return' : ''}</span></button></li>)}</ul>}
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h2 className="font-semibold">{selectedSaleClosed ? 'Correct a closed-day sale' : 'Return sale lines or void a sale'}</h2>
            {!selectedSale ? <p className="mt-3 text-sm text-slate-300">Select a sale to inspect its lines.</p> : <form onSubmit={selectedSaleClosed ? submitPostCloseReturn : submitReturn} className="mt-3">
              <p className="text-xs text-slate-400">Sale {String(selectedSale.receipt_number)} · {String(selectedSale.business_date)} · status {String(selectedSale.status)} · total {displayMoney(selectedSale.total)}</p>
              {selectedSaleClosed && <div className="mt-3 rounded border border-amber-700 bg-amber-950/40 p-3 text-xs text-amber-100">
                <p className="font-semibold">Original receipt {String(selectedSale.receipt_number)} · closed business date {String(selectedSale.business_date)}</p>
                <p className="mt-1">This receipt stays unchanged. A correction posts a current-date compensating record{shift?.business_date ? ` to business date ${String(shift.business_date)}` : ' to the current business date'}, keeps its audit trail, and cannot be edited afterwards.</p>
                <p className="mt-1">Unallocated tip still correctable: {displayMoney(selectedSale.post_close_tip_remaining)}.</p>
              </div>}
              {selectedSaleClosed && postCloseBlockedCopy && <p role="status" className="mt-3 rounded border border-rose-700 bg-rose-950/40 p-3 text-xs text-rose-100">{postCloseBlockedCopy}</p>}
              <button type="button" disabled={commandBlocked} onClick={() => { setLastReceipt(selectedSale); window.setTimeout(() => window.print(), 0) }} className="mt-3 rounded border border-emerald-600 px-3 py-2 text-sm">Print retrieved receipt</button>
              <p className="mt-2 text-xs text-slate-400">{selectedSaleClosed ? 'Enter quantities for the remaining lines to compensate. Leave other lines blank; the local authority rechecks remaining quantity, drawer, period lock and approval atomically.' : 'Enter quantities for any lines to include them in one atomic return. Leave other lines blank; the local authority checks the remaining returnable quantity.'}</p>
              <div className="mt-3 space-y-2">{(Array.isArray(selectedSale.lines) ? selectedSale.lines : []).filter((line) => Number(line.quantity) > 0).map((line) => <label key={String(line.sale_line_id)} className="grid grid-cols-[1fr_7rem] items-center gap-3 rounded border border-slate-800 p-2 text-xs"><span>{String(line.name)} · sold {displayQuantity(line.quantity)} · remaining {displayQuantity(line.remaining_quantity)}{selectedSaleClosed && Number(line.post_close_corrected_quantity) > 0 ? ` · corrected ${displayQuantity(line.post_close_corrected_quantity)}` : ''} · {displayMoney(line.line_total)}</span><input aria-label={`${selectedSaleClosed ? 'Correction' : 'Return'} quantity for ${String(line.name)}`} inputMode="decimal" value={returnDraft.lineQuantities[String(line.sale_line_id)] ?? ''} onChange={(event) => setReturnDraft((draft) => ({ ...draft, lineQuantities: { ...draft.lineQuantities, [String(line.sale_line_id)]: event.target.value } }))} disabled={Number(line.remaining_quantity) <= 0} className="w-full rounded bg-slate-800 p-2 text-sm disabled:opacity-40" /></label>)}</div>
              <label className="mt-3 block text-sm">Disposition<select value={returnDraft.disposition} onChange={(event) => setReturnDraft((draft) => ({ ...draft, disposition: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="restock">Restock</option><option value="waste">Waste</option></select></label>
              <label className="mt-3 block text-sm">Correction reason<textarea required maxLength={500} value={returnDraft.reason} onChange={(event) => setReturnDraft((draft) => ({ ...draft, reason: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
              <label className="mt-3 block text-sm">Approving manager PIN<input required inputMode="numeric" autoComplete="off" type="password" maxLength={12} value={returnApprovalPin} onChange={(event) => setReturnApprovalPin(event.target.value.replace(/\D/g, ''))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
              <p className="mt-3 rounded border border-amber-700 bg-amber-950/40 p-3 text-xs text-amber-100">{selectedSaleClosed ? 'A different active manager must enter their PIN. The local service verifies correction capability, the closed original shift, your open drawer and the accounting period, then binds a single-use approval to this exact correction. The original receipt and its closed business date are never rewritten.' : 'A different active manager must enter their PIN. The local service verifies correction capability and binds a single-use approval to this exact return or void and operation. Keep the original operation if its result is uncertain.'}</p>
              {selectedSaleClosed ? <>
                <button type="submit" disabled={busy || Boolean(pending) || returnApprovalBusy || !canPostCloseReturnBarSaleLines(selectedSale) || !Object.values(returnDraft.lineQuantities).some((value) => String(value).trim()) || !returnDraft.reason.trim() || !/^\d{4,12}$/.test(returnApprovalPin) || !localReady} className="mt-3 w-full rounded bg-emerald-700 p-2 text-sm font-semibold disabled:opacity-40">Approve and post current-date correction</button>
                <button type="button" disabled={busy || Boolean(pending) || returnApprovalBusy || !canPostCloseSelectedSale || !returnDraft.reason.trim() || !/^\d{4,12}$/.test(returnApprovalPin) || !localReady} onClick={() => void submitPostCloseVoid()} className="mt-2 w-full rounded border border-rose-700 p-2 text-sm font-semibold text-rose-200 disabled:opacity-40">Approve and cancel remaining closed-day sale / tip</button>
              </> : <>
                <button type="submit" disabled={busy || Boolean(pending) || returnApprovalBusy || !canReturnBarSaleLines(selectedSale) || !Object.values(returnDraft.lineQuantities).some((value) => String(value).trim()) || !returnDraft.reason.trim() || !/^\d{4,12}$/.test(returnApprovalPin) || !localReady} className="mt-3 w-full rounded bg-emerald-700 p-2 text-sm font-semibold disabled:opacity-40">Approve and submit line return</button>
                <button type="button" disabled={busy || Boolean(pending) || returnApprovalBusy || !canVoidRemainingBarSale(selectedSale) || !returnDraft.reason.trim() || !/^\d{4,12}$/.test(returnApprovalPin) || !localReady} onClick={() => void submitSaleVoid()} className="mt-2 w-full rounded border border-rose-700 p-2 text-sm font-semibold text-rose-200 disabled:opacity-40">Approve and cancel remaining sale / tip</button>
              </>}
              {selectedSaleClosed && selectedSaleCorrections.length > 0 && <div className="mt-4 border-t border-slate-700 pt-3">
                <h3 className="text-sm font-semibold">Corrections posted for this receipt</h3>
                <ol className="mt-2 max-h-56 space-y-2 overflow-y-auto">{selectedSaleCorrections.map((correction) => <li key={String(correction.correction_sale_id)} className="rounded border border-slate-800 bg-slate-950 p-2 text-xs"><div className="flex justify-between gap-3"><span className="font-semibold">{String(correction.kind) === 'void' ? 'Cancellation' : 'Return'} · receipt {String(correction.correction_receipt_number)}</span><span>{displayMoney(correction.total)}</span></div><p className="mt-1 text-slate-400">Posted {String(correction.business_date)} · requested by {String(correction.requested_by_name)} · approved by {String(correction.approved_by_name)}</p><p className="mt-1 text-slate-400">{String(correction.reason)}</p></li>)}</ol>
              </div>}
            </form>}
          </div>
        </section>}

        {activePanel === 'drawer' && <section className="mt-5 max-w-2xl rounded-xl border border-slate-700 bg-slate-900 p-4">
          <h2 className="font-semibold">Drawer movements and cash counts</h2>
          {shift && canCashup && <BarLocalDrawerHandover query={(name,filters)=>window.api.barLocal.query(name,filters)} shift={shift} blocked={commandBlocked||approvalBusy||!canCashup||!localReady} refreshKey={cashupSummary} onApproved={submitApprovedCommand}/>}
          {!shift ? <p className="mt-3 text-sm text-amber-100">Open a shift before recording drawer cash or a count. Closed shifts cannot be changed.</p> : <form onSubmit={recordDrawerMovement} className="mt-3">
            <label className="block text-sm">Action<select value={drawerDraft.type} onChange={(event) => setDrawerDraft((draft) => ({ ...draft, type: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="paid_in">Paid in</option><option value="paid_out">Paid out</option><option value="float">Add cash float</option><option value="count">Count till cash</option></select></label>
            <label className="mt-3 block text-sm">{drawerDraft.type === 'count' ? 'Physical cash counted' : 'Amount'}<input required inputMode="decimal" min="0" step="0.01" value={drawerDraft.amount} onChange={(event) => setDrawerDraft((draft) => ({ ...draft, amount: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            <label className="mt-3 block text-sm">{drawerDraft.type === 'count' ? 'Count note' : 'Reason'}<textarea required maxLength={500} value={drawerDraft.reason} onChange={(event) => setDrawerDraft((draft) => ({ ...draft, reason: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            <button disabled={commandBlocked || !canCashup || !localReady} className="mt-3 rounded bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-40">{drawerDraft.type === 'count' ? 'Record cash count' : 'Record movement'}</button>
            <p className="mt-2 text-xs text-slate-400">{drawerDraft.type === 'count' ? 'The service locks this shift, records the count, and returns expected cash and variance at that moment. A count does not change expected cash.' : 'The local authority records this against the open shift in its cash ledger.'} If the reply is uncertain, retry the same operation before recording another movement.</p>
          </form>}
          {shift && <div className="mt-4 border-t border-slate-700 pt-3"><h3 className="text-sm font-semibold">Current shift drawer record</h3>{cashupSummary?.shift_id === shift.shift_id ? <><p className="mt-1 text-xs text-slate-300">Authority-calculated expected cash: {displayMoney(cashupSummary.expected_cash)}</p><ol className="mt-2 max-h-64 space-y-2 overflow-y-auto">{(Array.isArray(cashupSummary.cash_movements) ? [...cashupSummary.cash_movements] : []).sort((a, b) => Date.parse(String(a.created_at || '')) - Date.parse(String(b.created_at || ''))).map((movement, index) => <li key={`${String(movement.created_at)}-${index}`} className="rounded border border-slate-800 bg-slate-950 p-2 text-xs"><div className="flex justify-between gap-3"><span className="font-semibold">{String(movement.type).replaceAll('_', ' ')}</span><span>{displayMoney(movement.amount)}</span></div><p className="mt-1 text-slate-400">{String(movement.reason)} · {String(movement.created_at)}</p></li>)}</ol>{Array.isArray(cashupSummary.cash_movements) && cashupSummary.cash_movements.length === 0 && <p className="mt-2 text-xs text-slate-400">No paid-in, paid-out or float movements are recorded for this shift.</p>}</> : <p role="status" className="mt-2 text-xs text-amber-200">Complete drawer details are not available yet. Refresh this panel before relying on the movement history.</p>}</div>}
        </section>}

        {activePanel === 'menu' && <section className="mt-5 rounded-xl border border-slate-700 bg-slate-900 p-4">
          <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Local menu availability</h2><p className="mt-1 text-xs text-slate-400">Changes apply to this outlet. Sold-out items cannot be committed in a sale while unavailable.</p></div><button type="button" disabled={commandBlocked} onClick={() => setPanelVersion((version) => version + 1)} className="rounded border border-slate-600 px-3 py-1 text-xs">Refresh</button></div>
          <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase tracking-wide text-slate-400"><tr><th className="p-2">Product</th><th className="p-2">SKU</th><th className="p-2">Price</th><th className="p-2">Availability</th><th className="p-2">Action</th></tr></thead><tbody>{menuRows.map((row) => <tr key={String(row.product_id)} className="border-t border-slate-800"><td className="p-2">{String(row.name)}{row.product_active !== true && <span className="ml-2 text-xs text-amber-300">Inactive</span>}</td><td className="p-2 text-slate-400">{String(row.sku)}</td><td className="p-2">{displayMoney(row.price)}</td><td className="p-2">{row.available === true ? 'Available' : 'Sold out'}</td><td className="p-2"><button type="button" disabled={commandBlocked || !canManageMenu || !localReady || !Number.isSafeInteger(menuProductVersions[String(row.product_id)])} onClick={() => editProduct(row)} className="mr-2 rounded border border-amber-600 px-3 py-1 text-xs disabled:opacity-40">Edit</button><button type="button" disabled={commandBlocked || !canManageMenu || !localReady || row.product_active !== true} onClick={() => void submitCommand('catalogue.availability.set', { product_id: row.product_id, available: row.available !== true, expected_version: row.availability_version })} className="rounded border border-slate-600 px-3 py-1 text-xs disabled:opacity-40">{row.available === true ? 'Mark sold out' : 'Make available'}</button></td></tr>)}</tbody></table>{menuRows.length === 0 && <p className="p-3 text-sm text-slate-300">No local menu items are available.</p>}</div>
          <p className="mt-3 text-xs text-slate-400">Each change uses the service’s current availability version and a durable operation ID. If another till changes the item first, refresh and review its current state.</p>
          {canManageMenu && <div className="mt-5 border-t border-slate-700 pt-4"><h3 className="font-semibold">Menu add-ons</h3>{modifierConfig ? <><p className="mt-1 text-xs text-slate-400">Manage business-wide modifiers, recipes and promotion definitions. Service prices and stock effects are revalidated when committing operations.</p><ul className="mt-3 grid gap-2 sm:grid-cols-2">{(Array.isArray(modifierConfig.groups) ? modifierConfig.groups : []).map((group) => <li key={String(group.modifier_group_id)} className="rounded border border-slate-800 p-3 text-sm"><span className="font-medium">{String(group.name)} · {String(group.code)}</span><span className="ml-2 text-xs text-slate-400">{group.active === true ? 'Active' : 'Inactive'} · choose {String(group.min_selections)}–{String(group.max_selections)}</span><ul className="mt-2 space-y-1 text-xs text-slate-300">{(Array.isArray(group.options) ? group.options : []).map((option) => <li key={String(option.modifier_option_id)}>{String(option.name)} · {displayMoney(option.price_delta)}{option.active !== true ? ' · inactive' : ''}</li>)}</ul></li>)}</ul><BarLocalModifierManager config={modifierConfig} busy={busy} blocked={commandBlocked || !localReady} onCommand={submitCommand} /></> : <p className="mt-2 text-xs text-slate-400">Loading authorized menu configuration…</p>}</div>}
        </section>}

        {activePanel === 'cashup' && <section className="mt-5 grid gap-5 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h2 className="font-semibold">Current shift</h2>
            {shift ? <form onSubmit={closeShift} className="mt-3">
              <p className="text-xs text-slate-400">Shift {String(shift.shift_id)} · business date {String(shift.business_date)} · opening float {displayMoney(shift.opening_float)}</p>
              <label className="mt-3 block text-sm">Counted cash<input required inputMode="decimal" value={closeDraft.counted_cash} onChange={(event) => setCloseDraft((draft) => ({ ...draft, counted_cash: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
              <label className="mt-3 block text-sm">Notes<textarea maxLength={1000} value={closeDraft.notes} onChange={(event) => setCloseDraft((draft) => ({ ...draft, notes: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
              <button disabled={commandBlocked} className="mt-3 rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">Close shift</button>
              <p className="mt-2 text-xs text-slate-400">Close the shift before submitting its cash-up. The local authority records the expected cash and variance.</p>
            </form> : <div className="mt-3 text-sm text-slate-300">{closedShift ? <><p>Shift {String(closedShift.shift_id)} closed. Expected {displayMoney(closedShift.expected_cash)}, counted {displayMoney(closedShift.counted_cash)}, variance {displayMoney(closedShift.variance)}.</p><p className="mt-2 text-xs text-slate-400">Business date {String(closedShift.business_date || '—')}.</p></> : <p>No open shift is assigned to this operator. Open a shift from the Counter panel.</p>}</div>}
            {cashupSummary && <div className="mt-4 border-t border-slate-700 pt-3 text-sm"><p>Business date {String(cashupSummary.business_date)} · shift status {String(cashupSummary.status)}</p><p className="mt-1">Expected cash {displayMoney(cashupSummary.expected_cash)} · cash sales {displayMoney(cashupSummary.cash_sales)} · card sales {displayMoney(cashupSummary.card_sales)}</p>{cashMovementLines.length > 0 && <p className="mt-1 text-xs text-slate-400">Drawer movements: {cashMovementLines.map((movement) => `${String(movement.type)} ${displayMoney(movement.amount)}`).join(' · ')}</p>}</div>}
            <div className="mt-4 border-t border-slate-700 pt-3"><h3 className="text-sm font-semibold">Submitted cash-ups awaiting review</h3>{!cashupReportComplete && <p className="mt-1 text-xs text-amber-200">The reporting period contains incomplete cash-up data. Each decision still re-reads one scoped cash-up from the local authority.</p>}<div className="mt-2 space-y-2">{cashupRows.filter((row) => row.cashup_status === 'submitted').map((row) => <button key={String(row.cashup_id)} type="button" disabled={commandBlocked} onClick={() => setSelectedCashupShiftId(String(row.shift_id))} className={`w-full rounded border p-2 text-left text-xs ${String(row.shift_id) === selectedCashupShiftId ? 'border-amber-400 bg-amber-950/30' : 'border-slate-700 bg-slate-950'}`}><span className="font-semibold">{String(row.business_date)} · Shift {String(row.shift_id).slice(0, 8)}</span><span className="mt-1 block text-slate-300">Counted {displayMoney(row.counted_cash)} · expected {displayMoney(row.expected_cash)} · variance {displayMoney(row.cash_variance)}</span></button>)}{cashupRows.filter((row) => row.cashup_status === 'submitted').length === 0 && <p className="text-xs text-slate-400">No submitted cash-ups are awaiting review.</p>}</div></div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h2 className="font-semibold">Submit cash-up</h2>
            {!closedShift ? <p className="mt-3 text-sm text-slate-300">Close the shift first. The local authority only accepts a cash-up for a closed shift.</p> : <form onSubmit={submitCashup} className="mt-3">
              <p className="text-xs text-slate-400">Shift {String(closedShift.shift_id)} · expected cash {displayMoney(closedShift.expected_cash)}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="text-xs">Counted cash<input required inputMode="decimal" value={cashupDraft.counted_cash} onChange={(event) => setCashupDraft((draft) => ({ ...draft, counted_cash: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Counted card<input inputMode="decimal" value={cashupDraft.counted_card} onChange={(event) => setCashupDraft((draft) => ({ ...draft, counted_card: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label></div>
              <label className="mt-3 block text-sm">Notes<textarea maxLength={2000} value={cashupDraft.notes} onChange={(event) => setCashupDraft((draft) => ({ ...draft, notes: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
              <button disabled={commandBlocked} className="mt-3 rounded bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-50">Submit cash-up for review</button>
              <p className="mt-2 text-xs text-slate-400">Variance is computed and recorded by the local authority. A different manager must review the submission.</p>
            </form>}
            {(review || cashupResult) && <div className="mt-4 rounded border border-slate-600 bg-slate-950/60 p-3 text-sm"><p className="font-semibold">Review state</p><p className="mt-1">Status: {String(review?.status || cashupResult?.status || 'submitted')}</p>{(review || cashupResult) && <p>Counted cash {displayMoney(review?.counted_cash ?? cashupResult?.counted_cash)} · expected {displayMoney(review?.expected_cash ?? cashupResult?.expected_cash)} · variance {displayMoney(review?.variance ?? cashupResult?.variance)}</p>}{review && <p>Counted card {displayMoney(review.counted_card)}</p>}{review?.notes && <p>Notes: {String(review.notes)}</p>}</div>}
            {review?.status === 'submitted' && <form onSubmit={submitCashupReview} className="mt-4 border-t border-slate-700 pt-3"><h3 className="font-semibold">Review submitted cash-up</h3><label className="mt-2 block text-sm">Decision<select value={cashupReviewDraft.decision} onChange={(event) => setCashupReviewDraft((draft) => ({ ...draft, decision: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2"><option value="approved">Approve</option><option value="rejected">Reject for correction</option></select></label><label className="mt-2 block text-sm">Reason<textarea required maxLength={1000} value={cashupReviewDraft.reason} onChange={(event) => setCashupReviewDraft((draft) => ({ ...draft, reason: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label><label className="mt-2 block text-sm">Different manager PIN<input required type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={cashupReviewDraft.pin} onChange={(event) => setCashupReviewDraft((draft) => ({ ...draft, pin: event.target.value.replace(/\D/g, '') }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label><p className="mt-2 text-xs text-amber-100">The local authority rejects self-review and binds a one-time manager approval to this decision. Rejection requires a reason; refresh after the decision before submitting a new cash-up revision.</p><button type="submit" disabled={commandBlocked || cashupApprovalBusy || !canCashup || !localReady || !cashupReviewDraft.reason.trim() || !/^\d{4,12}$/.test(cashupReviewDraft.pin)} className="mt-3 w-full rounded bg-sky-600 p-2 font-semibold disabled:opacity-40">Approve or reject cash-up</button></form>}
            {['approved', 'rejected'].includes(String(review?.status)) && <form onSubmit={submitCashupReopen} className="mt-4 border-t border-slate-700 pt-3"><h3 className="font-semibold">Reopen reviewed cash-up</h3><p className="mt-1 text-xs text-amber-100">This creates a new submitted revision and preserves the reviewed snapshot. Use the current physical recount and supporting reference.</p><div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="text-xs">Recounted cash<input required inputMode="decimal" value={cashupReopenDraft.counted_cash} onChange={(event) => setCashupReopenDraft((draft) => ({ ...draft, counted_cash: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Recounted card<input required inputMode="decimal" value={cashupReopenDraft.counted_card} onChange={(event) => setCashupReopenDraft((draft) => ({ ...draft, counted_card: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label></div><label className="mt-2 block text-sm">Recount notes<textarea maxLength={2000} value={cashupReopenDraft.notes} onChange={(event) => setCashupReopenDraft((draft) => ({ ...draft, notes: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label><label className="mt-2 block text-sm">Supporting reference<input maxLength={200} value={cashupReopenDraft.proof_ref} onChange={(event) => setCashupReopenDraft((draft) => ({ ...draft, proof_ref: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label><label className="mt-2 block text-sm">Reason for reopening<textarea required maxLength={1000} value={cashupReopenDraft.reason} onChange={(event) => setCashupReopenDraft((draft) => ({ ...draft, reason: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label><label className="mt-2 block text-sm">Different manager PIN<input required type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={cashupReopenDraft.pin} onChange={(event) => setCashupReopenDraft((draft) => ({ ...draft, pin: event.target.value.replace(/\D/g, '') }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label><button type="submit" disabled={commandBlocked || cashupApprovalBusy || !canCashup || !localReady || !MONEY_TWO.test(cashupReopenDraft.counted_cash) || !MONEY_TWO.test(cashupReopenDraft.counted_card) || !cashupReopenDraft.reason.trim() || !/^\d{4,12}$/.test(cashupReopenDraft.pin)} className="mt-3 w-full rounded bg-amber-600 p-2 font-semibold text-slate-950 disabled:opacity-40">Approve and submit new revision</button></form>}
          </div>
        </section>}

        {activePanel === 'stock' && <section className="mt-5 grid gap-5 lg:grid-cols-[1fr_24rem]">
          <div>
            <div className="flex items-center justify-between"><h2 className="font-semibold">Stock balances</h2><button type="button" disabled={commandBlocked} onClick={() => setPanelVersion((version) => version + 1)} className="rounded border border-slate-600 px-3 py-1 text-xs">Refresh</button></div>
            <div className="mt-3 overflow-x-auto rounded-xl border border-slate-700"><table className="w-full text-left text-sm"><thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-400"><tr><th className="p-3">Product</th><th className="p-3">SKU</th><th className="p-3">On hand</th><th className="p-3">Tracked</th></tr></thead><tbody>{stock.map((product) => <tr key={String(product.product_id)} className="border-t border-slate-800"><td className="p-3">{String(product.name)}</td><td className="p-3 text-slate-400">{String(product.sku)}</td><td className="p-3">{displayQuantity(product.quantity)}</td><td className="p-3">{product.track_stock ? 'Yes' : 'No'}</td></tr>)}</tbody></table>{stock.length === 0 && <p className="p-4 text-sm text-slate-300">No local stock products are published.</p>}</div>
          </div>
          <aside className="h-fit rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h2 className="font-semibold">Receive stock</h2>
            <form onSubmit={receiveStock} className="mt-3">
              <label className="block text-sm">Product<select required value={stockDraft.product_id} onChange={(event) => setStockDraft((draft) => ({ ...draft, product_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select a product</option>{stock.map((product) => <option key={String(product.product_id)} value={String(product.product_id)}>{String(product.name)} ({String(product.sku)}) · {displayQuantity(product.quantity)}</option>)}</select></label>
              <div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="text-xs">Quantity<input required inputMode="decimal" value={stockDraft.quantity} onChange={(event) => setStockDraft((draft) => ({ ...draft, quantity: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Unit cost<input inputMode="decimal" value={stockDraft.unit_cost} onChange={(event) => setStockDraft((draft) => ({ ...draft, unit_cost: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label></div>
              <label className="mt-3 block text-xs">Supplier reference<input maxLength={160} value={stockDraft.supplier_ref} onChange={(event) => setStockDraft((draft) => ({ ...draft, supplier_ref: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
              <div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="text-xs">Lot code<input maxLength={120} value={stockDraft.lot_code} onChange={(event) => setStockDraft((draft) => ({ ...draft, lot_code: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Expires on<input type="date" value={stockDraft.expires_on} onChange={(event) => setStockDraft((draft) => ({ ...draft, expires_on: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label></div>
              <button disabled={commandBlocked || !canInventoryManage || stock.length === 0} className="mt-3 w-full rounded bg-emerald-600 p-2 text-sm font-semibold disabled:opacity-40">Receive stock</button>
              {!canInventoryManage && <p className="mt-2 text-xs text-amber-200">You can view stock but your role cannot receive it.</p>}
              <p className="mt-2 text-xs text-slate-400">Receipts are committed to the local stock movement ledger with a stable operation ID.</p>
            </form>
          </aside>
          <div className="lg:col-span-2 rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h2 className="font-semibold">Current lot balances and FEFO status</h2>
            <p className="mt-1 text-xs text-slate-300">Sales consume in-date lots by earliest expiry. Pre-existing stock without a recorded lot remains labelled as unknown provenance. Returned stock is held until its lot and expiry are checked.</p>
            <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase tracking-wide text-slate-400"><tr><th className="p-2">Product</th><th className="p-2">Lot</th><th className="p-2">Received</th><th className="p-2">Allocated</th><th className="p-2">Remaining</th><th className="p-2">Expiry/status</th><th className="p-2">Provenance</th></tr></thead><tbody>{stockLotBalanceRows.map((row) => <tr key={String(row.lot_id)} className="border-t border-slate-800"><td className="p-2">{String(row.name)} · {String(row.sku)}</td><td className="p-2">{String(row.lot_code || 'Unknown lot')}</td><td className="p-2">{displayQuantity(row.received_quantity)}</td><td className="p-2">{displayQuantity(row.allocated_quantity)}</td><td className="p-2">{displayQuantity(row.remaining_quantity)}</td><td className={`p-2 ${row.expiry_status === 'expired' || row.expiry_status === 'quarantined' ? 'text-rose-300' : row.expiry_status === 'expiring_soon' ? 'text-amber-200' : 'text-emerald-300'}`}>{String(row.expires_on || 'No expiry recorded')} · {String(row.expiry_status || 'unknown')}</td><td className="p-2" title={String(row.provenance || '')}>{String(row.source_kind || 'unknown')}</td></tr>)}</tbody></table>{stockLotBalanceRows.length === 0 && <p className="p-3 text-sm text-slate-300">No current stock lots are recorded for this outlet.</p>}</div>
          </div>
          <div className="lg:col-span-2 rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h2 className="font-semibold">Lot and expiry receipts</h2>
            <p className="mt-1 text-xs text-slate-300">Immutable receipt history remains available separately from current lot balances.</p>
            <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase tracking-wide text-slate-400"><tr><th className="p-2">Product</th><th className="p-2">Lot</th><th className="p-2">Received</th><th className="p-2">Expiry</th><th className="p-2">Status</th><th className="p-2">Reference</th></tr></thead><tbody>{stockLotRows.map((row) => <tr key={String(row.movement_id)} className="border-t border-slate-800"><td className="p-2">{String(row.name)} · {String(row.sku)}</td><td className="p-2">{String(row.lot_code || '—')}</td><td className="p-2">{displayQuantity(row.received_quantity)}</td><td className="p-2">{String(row.expires_on || '—')}</td><td className={`p-2 ${row.expiry_status === 'expired' ? 'text-rose-300' : row.expiry_status === 'expiring_soon' ? 'text-amber-200' : 'text-emerald-300'}`}>{String(row.expiry_status || 'no expiry')}</td><td className="p-2">{String(row.supplier_reference || '—')}</td></tr>)}</tbody></table>{stockLotRows.length === 0 && <p className="p-3 text-sm text-slate-300">No lot-coded or expiry-dated receipts were found for this outlet.</p>}</div>
          </div>
        </section>}

        {activePanel === 'operations' && canViewOperations && <BarLocalOperationsPanel
          session={session}
          capabilities={capabilities}
          shift={shift}
          staffRows={staffRows}
          customers={customers}
          version={panelVersion}
          blocked={commandBlocked}
          localReady={localReady}
          onCommand={submitCommand}
          onApprovedCommand={submitApprovedCommand}
        />}

        {activePanel === 'settings' && <section className="mt-5 grid gap-5 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Local staff</h2><button type="button" disabled={commandBlocked} onClick={() => setPanelVersion((version) => version + 1)} className="rounded border border-slate-600 px-3 py-1 text-xs">Refresh</button></div>
            <p className="mt-1 text-xs text-slate-400">Staff identities and PIN verifiers are stored by the local authority. A cashier can sell only with the capabilities assigned by the service.</p>
            <ul className="mt-3 space-y-2">{staffRows.map((row) => <li key={String(row.staff_id || row.id)} className="rounded border border-slate-700 p-3"><p className="font-medium">{String(row.display_name || 'Staff member')} · {String(row.role || 'role unavailable')}</p><p className="mt-1 break-all font-mono text-[11px] text-slate-400">{String(row.staff_id || row.id)}</p><p className="mt-1 text-xs text-slate-300">{String(row.status || 'active')}</p></li>)}</ul>
            {staffRows.length === 0 && <p className="mt-3 text-sm text-slate-300">No staff records were returned.</p>}
            <BarLocalStaffStatus staffRows={staffRows} actor={session.staff??{}} blocked={commandBlocked||approvalBusy} onApproved={submitApprovedCommand}/>
            <form onSubmit={createCashier} className="mt-4 border-t border-slate-700 pt-4">
              <h3 className="font-medium">Create a local staff account</h3>
              <div className="mt-2 grid gap-2 sm:grid-cols-3"><label className="text-xs">Staff name<input required maxLength={120} value={staffDraft.display_name} onChange={(event) => setStaffDraft((draft) => ({ ...draft, display_name: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Role<select value={staffDraft.role} onChange={(event) => setStaffDraft((draft) => ({ ...draft, role: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="cashier">Cashier</option>{session?.staff?.role === 'owner' && <><option value="manager">Manager</option><option value="stock">Stock</option><option value="finance">Finance</option></>}</select></label><label className="text-xs">Temporary PIN<input required type="password" inputMode="numeric" pattern="[0-9]{4,12}" autoComplete="new-password" value={staffDraft.pin} onChange={(event) => setStaffDraft((draft) => ({ ...draft, pin: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label></div>
              <button disabled={commandBlocked} className="mt-3 rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">Create staff account</button>
              <p className="mt-2 text-xs text-slate-400">The local service enforces role delegation and capability ceilings. Owner accounts cannot be created here.</p>
            </form>
          </div>
          <div className="h-fit rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h2 className="font-semibold">Pair another till</h2>
            <p className="mt-1 text-sm text-slate-300">Use this to connect another till. Enter the address, security details and one-use code on that till.</p>
            <button type="button" disabled={commandBlocked || pairingBusy} onClick={() => void generatePairingCode()} className="mt-4 rounded bg-sky-600 px-4 py-2 text-sm font-semibold disabled:opacity-50">{pairingBusy ? 'Generating…' : 'Show till connection details'}</button>
            {pairingCode && <div className="mt-4 rounded border border-emerald-700 bg-emerald-950/40 p-4"><p className="text-xs text-emerald-200">One-use code · expires in {Math.max(0, Math.ceil((pairingCode.expiresAt - Date.now()) / 1000))} seconds</p><p className="mt-2 select-all font-mono text-3xl tracking-[0.25em]">{pairingCode.code}</p><details className="mt-3"><summary className="cursor-pointer text-xs text-emerald-200">Connection security details</summary><p className="mt-2 break-all font-mono text-xs">{pairingCode.fingerprint}</p></details></div>}
            <p className="mt-3 text-xs text-slate-400">Do not send this code outside the Bar team. The service accepts it once and binds the new device to this authority and outlet.</p>
          </div>
        </section>}{canManageSettings && <BarLocalDiscountPolicy policy={discountPolicy} busy={busy} blocked={commandBlocked} onCommand={submitCommand} />}

        {activePanel === 'reports' && <section className="mt-5 rounded-xl border border-slate-700 bg-slate-900 p-4">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Sales summary</h2><button type="button" disabled={commandBlocked} onClick={() => setPanelVersion((version) => version + 1)} className="rounded border border-slate-600 px-3 py-1 text-xs">Refresh</button></div>
          {!report ? <p className="mt-3 text-sm text-slate-300">Loading the local sales summary.</p> : <div className="mt-3">
            <p className="text-xs text-slate-400">Business date {String(report.from || '—')} to {String(report.to || '—')} · data from the local authority · {String(report.cloud_export || 'integration_disabled')}</p>
            <h3 className="mt-5 font-semibold">By business date</h3>
            {reportDays.length === 0 ? <p className="mt-2 text-sm text-slate-300">No sales recorded for the selected business date.</p> : <div className="mt-2 overflow-x-auto rounded border border-slate-700"><table className="w-full text-left text-sm"><thead className="bg-slate-950 text-xs uppercase tracking-wide text-slate-400"><tr><th className="p-3">Date</th><th className="p-3">Sales</th><th className="p-3">Corrections</th><th className="p-3">Subtotal</th><th className="p-3">Discount</th><th className="p-3">Tax</th><th className="p-3">Tip</th><th className="p-3">Total</th></tr></thead><tbody>{reportDays.map((day) => <tr key={String(day.business_date)} className="border-t border-slate-800"><td className="p-3">{String(day.business_date)}</td><td className="p-3">{String(day.sale_count ?? '—')}</td><td className="p-3">{String(day.correction_count ?? '—')}</td><td className="p-3">{displayMoney(day.subtotal)}</td><td className="p-3">{displayMoney(day.discount)}</td><td className="p-3">{displayMoney(day.tax)}</td><td className="p-3">{displayMoney(day.tip)}</td><td className="p-3 font-semibold">{displayMoney(day.total)}</td></tr>)}</tbody></table></div>}
            <h3 className="mt-5 font-semibold">Tenders</h3>
            {reportTenders.length === 0 ? <p className="mt-2 text-sm text-slate-300">No tenders recorded for the selected business date.</p> : <ul className="mt-2 space-y-1 text-sm">{reportTenders.map((tender) => <li key={String(tender.method)} className="flex justify-between gap-3"><span>{String(tender.method)}</span><span>{displayMoney(tender.amount)} · {String(tender.entries ?? '—')} entries</span></li>)}</ul>}
          </div>}
        </section>}

        {activePanel === 'reports' && <section className="mt-4 grid gap-4 lg:grid-cols-2">
          <article className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h2 className="font-semibold">Stock report</h2>{!stockReport ? <p className="mt-2 text-sm text-slate-300">Loading the outlet-scoped stock report.</p> : <><p className="mt-1 text-xs text-slate-400">{String(stockReport.period?.from || '—')} to {String(stockReport.period?.to || '—')} · low-stock threshold {String(stockReport.low_stock_threshold ?? '—')}</p>{stockReport.complete !== true && <p role="status" className="mt-2 rounded border border-amber-700 p-2 text-xs text-amber-100">Valuation is incomplete: {Array.isArray(stockReport.unavailable) ? stockReport.unavailable.join(', ') : 'missing cost data'}. Do not rely on the valuation total.</p>}<p className="mt-2 text-sm">Valued stock {displayMoney(stockReport.valuation_totals?.valued_amount)} · low-stock products {Array.isArray(stockReport.low_stock) ? stockReport.low_stock.length : 0} · movements {Array.isArray(stockReport.movements) ? stockReport.movements.length : 0}</p><details className="mt-2"><summary className="cursor-pointer text-xs text-amber-200">Review all low-stock products</summary><ul className="mt-2 max-h-56 space-y-1 overflow-auto text-xs">{(Array.isArray(stockReport.low_stock) ? stockReport.low_stock : []).map((item) => <li key={String(item.product_id)} className="flex justify-between gap-3"><span>{String(item.name)} · {String(item.sku)}</span><span>{displayQuantity(item.quantity)}</span></li>)}</ul>{Array.isArray(stockReport.low_stock) && stockReport.low_stock.length === 0 && <p className="mt-2 text-xs text-slate-400">No tracked products are at or below the threshold.</p>}</details></>}</article>
          <article className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h2 className="font-semibold">Cash-up report</h2><p className="mt-1 text-xs text-slate-400">Period {String(cashupReport?.period?.from || '—')} to {String(cashupReport?.period?.to || '—')} · card settlement is externally unverified</p>{!cashupReport ? <p className="mt-2 text-sm text-slate-300">Loading the cash-up report.</p> : <><p className="mt-1 text-xs text-slate-400">{String(cashupReport.shifts?.length ?? 0)} shift(s) · expected cash {displayMoney(cashupReport.totals?.expected_cash)} · counted {displayMoney(cashupReport.totals?.counted_cash)} · variance {displayMoney(cashupReport.totals?.cash_variance)} · card settlement {String(cashupReport.card_settlement_status || 'unverified_external')}</p>{cashupReport.complete !== true && <p role="status" className="mt-2 rounded border border-amber-700 p-2 text-xs text-amber-100">Cash-up data is incomplete or provider settlement is unverified. Card totals are not represented as externally settled.</p>}<ul className="mt-2 max-h-56 space-y-1 overflow-auto text-xs">{(Array.isArray(cashupReport.shifts) ? cashupReport.shifts : []).map((item) => <li key={String(item.shift_id)} className="flex justify-between gap-3"><span>{String(item.business_date)} · {String(item.cashup_status)} · {String(item.shift_status)}</span><span>cash {displayMoney(item.expected_cash)} / {displayMoney(item.counted_cash)}</span></li>)}</ul></>}</article>
        </section>}

        {activePanel === 'admin' && canManageSettings && <BarLocalAdminPanel blocked={commandBlocked} canExport={capabilities.includes('export.manage')} refreshKey={panelVersion} onCommand={submitCommand} onError={setError} onNotice={setNotice} />}

        {activePanel === 'audit' && canManageSettings && <section className="mt-5 rounded-xl border border-slate-700 bg-slate-900 p-4">
          <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Local audit search</h2><p className="mt-1 text-xs text-slate-400">Business and outlet scope are enforced by the local service. Default results cover the latest 30 days.</p></div><button type="button" disabled={auditLoading || commandBlocked} onClick={() => void searchAudit(false)} className="rounded border border-slate-600 px-3 py-1 text-xs disabled:opacity-50">Refresh</button></div>
          <form onSubmit={(event) => { event.preventDefault(); setAuditCursor(''); void searchAudit(false) }} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><label className="text-xs">Search audit values<input maxLength={160} value={auditSearch} onChange={(event) => setAuditSearch(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" placeholder="Operation ID, SKU or value" /></label><label className="text-xs">Exact action<input maxLength={120} value={auditAction} onChange={(event) => setAuditAction(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" placeholder="catalogue.upsert" /></label><button disabled={auditLoading || commandBlocked} className="self-end rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">Search</button></form>
          <ul className="mt-4 space-y-2">{auditRows.map((row, index) => <li key={`${String(row.id || row.operation_id)}-${index}`} className="rounded border border-slate-800 p-3"><div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-semibold">{String(row.action || 'Audit event')}</span><time className="text-xs text-slate-400">{String(row.created_at || '')}</time></div><p className="mt-1 text-xs text-slate-400">Operation {String(row.operation_id || '—')} · staff {String(row.actor_staff_id || '—')}</p><details className="mt-2"><summary className="cursor-pointer text-xs text-amber-200">Before / after detail</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-950 p-2 text-xs">{JSON.stringify({ before: row.before ?? null, after: row.after ?? null }, null, 2)}</pre></details></li>)}</ul>
          {auditRows.length === 0 && !auditLoading && <p className="mt-3 text-sm text-slate-300">No local audit events matched this search.</p>}
          {auditHasMore && <button type="button" disabled={auditLoading || !auditCursor || commandBlocked} onClick={() => void searchAudit(true)} className="mt-3 rounded border border-slate-600 px-4 py-2 text-sm disabled:opacity-50">{auditLoading ? 'Loading…' : 'Load older events'}</button>}
        </section>}

        {activePanel === 'support' && canManageSettings && <section className="mt-5 max-w-3xl rounded-xl border border-slate-700 bg-slate-900 p-4">
          <h2 className="font-semibold">Record a local support report</h2><p className="mt-1 text-xs text-slate-400">The report is redacted and stored by this Bar authority. Support delivery is disabled; give your local administrator the subject and time if they need to find it.</p>
          <form onSubmit={createSupportReport} className="mt-3 space-y-3"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs">Category<select value={supportDraft.category} onChange={(event) => setSupportDraft((draft) => ({ ...draft, category: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="operations">Operations</option><option value="access">Access</option><option value="hardware">Hardware</option><option value="data">Data</option><option value="other">Other</option></select></label><label className="text-xs">Severity<select value={supportDraft.severity} onChange={(event) => setSupportDraft((draft) => ({ ...draft, severity: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label></div><label className="block text-xs">Subject<input required maxLength={200} value={supportDraft.subject} onChange={(event) => setSupportDraft((draft) => ({ ...draft, subject: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="block text-xs">What happened?<textarea required maxLength={4000} value={supportDraft.message} onChange={(event) => setSupportDraft((draft) => ({ ...draft, message: event.target.value }))} className="mt-1 min-h-28 w-full rounded bg-slate-800 p-2 text-sm" /></label><button disabled={commandBlocked} className="rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">Record on this Bar</button></form>
          <div className="mt-5 border-t border-slate-800 pt-4"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Local report history</h3><button type="button" disabled={supportReportsLoading || commandBlocked} onClick={() => void loadSupportReports()} className="rounded border border-slate-600 px-3 py-1 text-xs disabled:opacity-50">{supportReportsLoading ? 'Loading reports…' : 'Refresh reports'}</button></div>{supportReportsError && <p role="alert" className="mt-2 text-xs text-rose-200">{supportReportsError} Refresh the list or ask a settings manager to check local service access.</p>}<ul className="mt-3 space-y-2">{supportReports.map((row) => <li key={String(row.id)} className="rounded border border-slate-800 p-3"><div className="flex flex-wrap justify-between gap-2 text-xs"><span className="font-semibold">{String(row.subject)} · {String(row.severity)}</span><time className="text-slate-400">{String(row.created_at)}</time></div><p className="mt-1 text-xs text-slate-400">{String(row.category)} · {String(row.status)} · delivery {String(row.delivery_status)} · by {String(row.submitted_by_name)}</p><details className="mt-2"><summary className="cursor-pointer text-xs text-amber-200">Report details</summary><p className="mt-2 whitespace-pre-wrap text-xs text-slate-300">{String(row.message)}</p><p className="mt-2 break-all text-[10px] text-slate-500">Checksum {String(row.checksum)}</p></details></li>)}</ul>{supportReports.length === 0 && !supportReportsLoading && !supportReportsError && <p className="mt-2 text-xs text-slate-400">No local support reports have been recorded for this outlet.</p>}</div>
          <p className="mt-3 text-xs text-slate-400">Do not include PINs, passwords, payment details or guest identity documents. The service applies redaction and records a checksum and audit event.</p>
        </section>}

      </section>
      {pending && <section role="alert" className="mx-auto mt-4 max-w-6xl rounded border border-amber-700 bg-amber-950/40 p-4">
        <p className="text-sm">Saved operation <span className="font-mono">{pending.id}</span> ({pending.command}{pending.state ? ` · ${pending.state}` : ''}) has an unresolved outcome. It may already have reached the local service. New operations, panel changes, cart edits and sign-out stay paused until it is resolved.</p>
        {pending.count && pending.count > 1 && <p className="mt-1 text-xs text-amber-100">{pending.count} saved operations are unresolved. Resolve them in the order shown by the local service; do not start a new sale.</p>}
        {pending.createdAt && <p className="mt-1 text-xs text-amber-100">Saved at {pending.createdAt}. The original basket and operation ID are preserved in the durable journal; editing or rebuilding the cart cannot change them.</p>}
        <p className="mt-2 text-xs text-amber-100">Retry the exact same operation ID below, or check its authoritative status. Do not start a new sale and do not create a new operation. If neither action can reach the local service, ask a manager to recover operation {pending.id} through the local Bar service before signing out.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void submitCommand(pending.command, pending.payload, pending.id)} className="rounded border border-amber-500 px-3 py-2 text-sm">Retry same operation</button>
          <button type="button" disabled={busy} onClick={() => void resolvePendingOperation()} className="rounded border border-sky-400 px-3 py-2 text-sm">Check saved operation status</button>
        </div>
        <p className="mt-2 text-xs text-amber-100">A saved operation is dismissed only when the local authority confirms it was committed or terminally refused. An executing or unknown result must be retried with the same operation ID.</p>
      </section>}
      {!pending && intentCheckError && <section role="alert" className="mx-auto mt-4 max-w-6xl rounded border border-red-800 bg-red-950/40 p-4"><p className="text-sm">Saved local operations could not be checked: {intentCheckError}</p><p className="mt-2 text-xs text-red-100">Sign-out stays paused so an uncertain operation is not hidden. Reconnect to the configured Bar server and recheck, or ask a manager to recover the saved operation journal before leaving this till.</p><button type="button" disabled={busy} onClick={() => void recheckOpenIntents()} className="mt-2 rounded border border-red-500 px-3 py-2 text-sm">Recheck saved operations</button></section>}
      {error && <div className="mx-auto mt-4 max-w-6xl"><HposNotice tone="error">{error}</HposNotice></div>}{notice && <p role="status" className="mx-auto mt-4 max-w-6xl rounded bg-emerald-950 p-3 text-sm text-emerald-200">{notice}</p>}
      {lastReceipt && <section className="bar-local-receipt mx-auto mt-4 max-w-6xl rounded-xl border border-emerald-700 bg-emerald-950/30 p-4" aria-label="Last committed receipt">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wide text-emerald-200">Committed local receipt</p><h2 className="mt-1 font-semibold">Receipt {String(lastReceipt.receipt_number || '—')} · {displayMoney(lastReceipt.total)}</h2><p className="mt-1 text-xs text-slate-300">This receipt was returned by the local authority. Printing does not submit another sale.</p></div><button type="button" onClick={() => window.print()} className="rounded border border-emerald-500 px-4 py-2 text-sm font-semibold">Print receipt</button></div>
        <ul className="mt-3 space-y-1 text-sm">{(Array.isArray(lastReceipt.lines) ? lastReceipt.lines : []).map((line) => <li key={String(line.sale_line_id)} className="flex justify-between gap-3"><span>{String(line.name)} × {displayQuantity(line.quantity)}{displayModifierNames(line.modifiers) && <small className="block text-xs text-slate-300">{displayModifierNames(line.modifiers)}</small>}</span><span>{displayMoney(line.line_total)}</span></li>)}</ul>
        <style>{`@media print { body * { visibility: hidden !important; } .bar-local-receipt, .bar-local-receipt * { visibility: visible !important; } .bar-local-receipt { position: fixed !important; inset: 0 !important; width: 80mm !important; max-width: 80mm !important; margin: 0 !important; border: 0 !important; background: white !important; color: black !important; } .bar-local-receipt button { display: none !important; } }`}</style>
      </section>}
    </main>
  )
}
