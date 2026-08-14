import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Pencil, Trash2, ShoppingCart, X, ChevronDown, ChevronUp, Scan, Eye, EyeOff, Keyboard, Printer, BadgePercent, ReceiptText, Calculator, RefreshCw, Monitor, Utensils, FileSpreadsheet, FileDown, Star } from 'lucide-react'
import { Modal } from './shared/Modal'
import { POSReceipt } from './shared/POSReceipt'
import HorizontalScrollArea from './shared/HorizontalScrollArea'
import POSFavouritesBar from './pos/POSFavouritesBar'
import POSTerminalCartLine from './pos/POSTerminalCartLine'
import POSTerminalProductCard from './pos/POSTerminalProductCard'
import POSKeyboardHelp from './pos/POSKeyboardHelp'
import { DESKTOP_PAYMENT_METHODS, formatPaymentMethod } from '../constants/paymentMethods'
import { useSettings, useAccess, useAuth } from '../app-context'
import { canAccessCapability } from '../../../shared/accessControl'
import { isRestaurantOnly } from '../../../shared/propertyTypes'
import { hasRecordedPosTenderEnvelope } from '../../../shared/posFinancialTruth'
import { formatLocalDate } from '../utils/localDate'

const MENU_CATEGORIES = ['Food', 'Drinks', 'Other']
const BAR_PACK_TEMPLATES = [
  { size: 6, label: '6 Pack' },
  { size: 12, label: '12 Pack' },
  { size: 24, label: 'Case (24)' }
]
const CASHUP_CORE_METHODS = ['cash', 'card', 'bank_transfer', 'orange_money', 'myzaka', 'smega', 'other']
const POS_LIVE_REFRESH_MS = 30000
const POS_TOUCH_MODE_STORAGE_KEY = 'bb_pos_touch_mode'
const POS_MENU_PAGE_SIZE = 72
const POS_FAVOURITES_STORAGE_KEY = 'bb_pos_favourites'
const POS_FAVOURITES_MAX = 30
const POS_COMPACT_CART_THRESHOLD = 20

const toLocalDateInput = (value = new Date()) => formatLocalDate(value)
const formatIsoTimestamp = (value = new Date()) => {
  const date = value instanceof Date ? new Date(value) : new Date(value)
  return date.toISOString()
}

const currency = 'P'
const fmt = (v) => Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const recordedLineAmount = (item = {}) => {
  const value = item.net_subtotal ?? item.line_subtotal ?? item.subtotal ?? item.line_total ?? item.total
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}
const ACTIVE_TABLE_STATUSES = new Set(['open', 'running', 'ready', 'delivered'])

function normalizeTableStatus(status) {
  const value = String(status || '').toLowerCase()
  if (value === 'open') return 'running'
  return ['available', 'running', 'ready', 'delivered'].includes(value) ? value : 'available'
}

function getTableStatusClasses(status) {
  const normalized = normalizeTableStatus(status)
  if (normalized === 'available') return 'border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50'
  if (normalized === 'ready') return 'border-blue-300 bg-blue-50 text-blue-800'
  if (normalized === 'delivered') return 'border-violet-300 bg-violet-50 text-violet-800'
  return 'border-amber-300 bg-amber-50 text-amber-800'
}

/**
 * Sanitize raw sync error strings for POS operators.
 * Priorities:
 * 1. Targeted business logic rejections (e.g. out of stock)
 * 2. Sanitize transport-level noise (e.g. fetch failed)
 * 3. Fallback to a generic retry prompt if msg is empty
 */
function sanitizePosError(raw) {
  if (!raw) return 'Operation failed to sync. Please retry from System Health.'
  const msg = String(raw)

  // ── Network / Transport Fallbacks ──────────────────────────────────────────
  if (/fetch failed|network error|not reachable|failed to fetch/i.test(msg)) {
    return 'Could not reach the server. Please check your connection and retry from System Health.'
  }

  // ── System / Auth Fallbacks ────────────────────────────────────────────────
  if (/session.*expired|authentication.*required|authenticated.*required/i.test(msg)) {
    return 'Your session has expired. Please sign out and sign in again before retrying.'
  }

  // ── Duplicate / Conflict Check ───────────────────────────────────────────
  if (/unique.*violation|duplicate key/i.test(msg)) {
    return 'This order may have already synced. Refresh the POS and check history.'
  }

  // ── Business Rejections (Stock) ──────────────────────────────────────────
  // If the backend returned a specific stock error, it usually contains the item name.
  // We clean up UUIDs but leave the descriptive text.
  const cleaned = msg
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '…')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned.length > 160 ? `${cleaned.slice(0, 157)}…` : cleaned
}

function normalizeOrderSyncState(order) {
  if (order?._sync_state === 'failed') return 'failed'
  if (order?._sync_state === 'pending') return 'pending'
  if (order?._sync_state === 'manual_review_required') return 'needs_attention'
  if (order?._pending_sync === true) return 'pending'
  return 'synced'
}

function paymentBreakdownHasCash(payments = []) {
  return Array.isArray(payments) && payments.some((payment) => (
    String(payment.method || '').toLowerCase() === 'cash' && Number(payment.amount || 0) > 0
  ))
}

function historyTenderLabel(order = {}) {
  if (!hasRecordedPosTenderEnvelope(order)) return 'Tender unavailable'
  const rows = Array.isArray(order.payment_breakdown) ? order.payment_breakdown : (() => {
    try { const parsed = JSON.parse(order.payment_breakdown || '[]'); return Array.isArray(parsed) ? parsed : [] } catch { return [] }
  })()
  const methods = [...new Set(rows.map((row) => String(row?.method || row?.type || '').trim()).filter(Boolean))]
  if (methods.length !== 1) return 'Split tender'
  return formatPaymentMethod(methods[0], { plain: true })
}

function recordedSingleTenderMethod(order = {}) {
  if (!hasRecordedPosTenderEnvelope(order)) return ''
  const rows = Array.isArray(order.payment_breakdown) ? order.payment_breakdown : (() => {
    try { const parsed = JSON.parse(order.payment_breakdown || '[]'); return Array.isArray(parsed) ? parsed : [] } catch { return [] }
  })()
  const methods = [...new Set(rows.map((row) => String(row?.method || row?.type || '').trim()).filter(Boolean))]
  return methods.length === 1 ? methods[0] : ''
}

function isSyncOffline(status) {
  if (!status) return false
  if (status.isOnline === false) return true
  if (status.isPaused === true) return true
  if (status.backendAvailable === false) return true
  if (status.backendUnavailable === true) return true
  return false
}

function normalizeStockValue(value) {
  const numeric = Number(value || 0)
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0
}

function normalizePositiveQty(value, fallback = 1) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

// The database protects outlet names per lodge, but a stale cache or a legacy
// import can still hand the renderer repeated rows. Never make an operator
// choose between visually identical Kitchen/Bar buttons.
function dedupeOutlets(rows = []) {
  const seen = new Set()
  return (rows || []).filter((row) => {
    if (!row) return false
    const key = row.id
      ? `id:${row.id}`
      : `name:${String(row.type || '').toLowerCase()}:${String(row.name || '').trim().toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function getInventoryAvailableUnits(inventoryMap, inventoryItemId, depletionQty = 1) {
  if (!inventoryItemId) return Number.POSITIVE_INFINITY
  const inventoryRow = inventoryMap.get(inventoryItemId)
  if (!inventoryRow) return 0
  const stock = normalizeStockValue(inventoryRow.current_stock)
  const depletion = normalizePositiveQty(depletionQty, 1)
  return Math.floor(stock / depletion)
}

function isOrderableMenuItem(item, inventoryMap) {
  if (item?.is_available === false) return false
  return getInventoryAvailableUnits(inventoryMap, item?.inventory_item_id, item?.depletion_qty) > 0
}

function buildOrderStockUsage(items = []) {
  const usage = new Map()
  for (const item of items || []) {
    if (!item?.inventory_item_id) continue
    const delta = Math.max(0, Number(item.quantity || 0)) * normalizePositiveQty(item.depletion_qty, 1)
    usage.set(item.inventory_item_id, (usage.get(item.inventory_item_id) || 0) + delta)
  }
  return usage
}

function normalizePosSubmitSignatureItem(item = {}) {
  return {
    menu_item_id: item.menu_item_id || null,
    inventory_item_id: item.inventory_item_id || null,
    depletion_qty: normalizePositiveQty(item.depletion_qty, 1),
    item_name: String(item.item_name || '').trim(),
    quantity: Number(item.quantity || 0),
    unit_price: Number(item.unit_price || 0),
    modifier_option_ids: (item.modifiers || [])
      .map((modifier) => modifier?.id || modifier)
      .filter(Boolean)
      .sort()
  }
}

function formatElapsed(startedAt, now = Date.now()) {
  const started = new Date(startedAt || now).getTime()
  if (!Number.isFinite(started)) return '0m'
  const minutes = Math.max(0, Math.floor((now - started) / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function buildPosSubmitSignature({
  customerType,
  selectedRoom,
  selectedEventId,
  walkInName,
  orderNotes,
  paymentMethod,
  paymentBreakdown,
  taxTotal,
  tipTotal,
  tableName,
  activeTabId,
  selectedOutletId,
  orderItems,
  appliedPromotionId,
  discountMode,
  discountValue,
  discountReason
}) {
  return JSON.stringify({
    customerType: customerType || 'walkin',
    room_id: customerType === 'room' ? (selectedRoom || null) : null,
    event_booking_id: customerType === 'event' ? (selectedEventId || null) : null,
    walk_in_name: customerType === 'walkin' ? String(walkInName || '').trim() : null,
    notes: String(orderNotes || '').trim(),
    payment_method: (customerType === 'room' || customerType === 'event') ? 'folio' : (paymentMethod || 'cash'),
    payment_breakdown: paymentBreakdown || [],
    tax_total: Number(taxTotal || 0),
    tip_total: Number(tipTotal || 0),
    table_name: tableName || null,
    tab_id: activeTabId || null,
    outlet_id: selectedOutletId || null,
    promotion_id: appliedPromotionId || null,
    manual_discount: appliedPromotionId ? null : {
      type: discountMode || 'amount',
      value: Number(discountValue || 0),
      reason: String(discountReason || '').trim()
    },
    items: (orderItems || [])
      .map(normalizePosSubmitSignatureItem)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  })
}

export default function POS() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const propertyType = settings?.property_type || settings?.business_type || 'lodge'
  const restaurantMode = isRestaurantOnly(propertyType)
  const access = useAccess()
  const { user: currentUser } = useAuth()
  const [touchMode, setTouchMode] = useState(() => {
    try {
      return window.localStorage.getItem(POS_TOUCH_MODE_STORAGE_KEY) === 'touch'
    } catch {
      return false
    }
  })
  const [showStaffLogin, setShowStaffLogin] = useState(false)
  const [showPaymentDetails, setShowPaymentDetails] = useState(false)
  const [showManagerControls, setShowManagerControls] = useState(false)
  const [setupSection, setSetupSection] = useState(() => restaurantMode ? 'displays' : 'tables')

  // Permission flags
  const canVoid       = canAccessCapability(access, 'pos.void')
  const canDiscount   = canAccessCapability(access, 'pos.discount')
  const canManagePos  = canAccessCapability(access, 'pos.manage')
  const canManageMenu = canAccessCapability(access, 'pos.menu_manage')
  const canCloseCashup = canAccessCapability(access, 'pos.cashup')

  const [tab, setTab] = useState('terminal') // terminal | menu | history | cashup | tickets | setup

  // Outlets
  const [outlets, setOutlets] = useState([])
  const [outletsLoading, setOutletsLoading] = useState(true)
  const [outletsError, setOutletsError] = useState(false)
  const [selectedOutlet, setSelectedOutlet] = useState(null)

  // Menu items
  const [menuItems, setMenuItems] = useState([])
  const [menuLoading, setMenuLoading] = useState(false)
  const [menuRefreshing, setMenuRefreshing] = useState(false)
  const [menuSearch, setMenuSearch] = useState('')
  const [activeTerminalCategory, setActiveTerminalCategory] = useState('All')
  const [menuDisplayLimit, setMenuDisplayLimit] = useState(POS_MENU_PAGE_SIZE)

  // Current order (terminal)
  const [orderItems, setOrderItems] = useState([])
  const [customerType, setCustomerType] = useState('walkin') // walkin | room | event
  const [rooms, setRooms] = useState([])
  const [selectedRoom, setSelectedRoom] = useState('')
  const [activeEvents, setActiveEvents] = useState([])
  const [selectedEventId, setSelectedEventId] = useState('')
  const [walkInName, setWalkInName] = useState('')
  const [orderNotes, setOrderNotes] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paymentReference, setPaymentReference] = useState('')
  const [splitPaymentsEnabled, setSplitPaymentsEnabled] = useState(false)
  const [paymentSplits, setPaymentSplits] = useState([{ method: 'cash', amount: '', reference: '' }])
  const [discountMode, setDiscountMode] = useState('amount')
  const [discountValue, setDiscountValue] = useState('')
  const [discountReason, setDiscountReason] = useState('')
  const [taxEnabled, setTaxEnabled] = useState(false)
  const [taxRate, setTaxRate] = useState('')
  const [tipAmount, setTipAmount] = useState('')
  const [serviceMode, setServiceMode] = useState('takeaway')
  const [tableName, setTableName] = useState('')
  const [waiterName, setWaiterName] = useState('')
  const [posTables, setPosTables] = useState([])
  const [tableForm, setTableForm] = useState({ name: '', area: '', seats: '' })
  const [savingTable, setSavingTable] = useState(false)
  const [activeTabId, setActiveTabId] = useState('')
  const [openTabs, setOpenTabs] = useState([])
  const [tickets, setTickets] = useState([])
  const [currentShift, setCurrentShift] = useState(null)
  const [shiftFloat, setShiftFloat] = useState('')
  const [shiftCloseCash, setShiftCloseCash] = useState('')
  const [shiftCloseMessage, setShiftCloseMessage] = useState('')
  const [hardwareSettings, setHardwareSettings] = useState(null)
  const [hardwareMsg, setHardwareMsg] = useState('')
  const [receiptPrinters, setReceiptPrinters] = useState([])
  const [systemDisplays, setSystemDisplays] = useState([])
  const [displayTargets, setDisplayTargets] = useState({ customer: '', kitchen: '', bar: '' })
  const [posStaff, setPosStaff] = useState([])
  const [selectedPosStaff, setSelectedPosStaff] = useState(null)
  const [pendingPosStaffId, setPendingPosStaffId] = useState('')
  const [staffPin, setStaffPin] = useState('')
  const [tableServiceMode, setTableServiceMode] = useState('operator')
  const [selectedWaiterStaff, setSelectedWaiterStaff] = useState(null)
  const [pendingWaiterStaffId, setPendingWaiterStaffId] = useState('')
  const [waiterPin, setWaiterPin] = useState('')
  const [showWaiterPicker, setShowWaiterPicker] = useState(false)
  const [modifierGroups, setModifierGroups] = useState([])
  const [promotions, setPromotions] = useState([])
  const [floorLayout, setFloorLayout] = useState({ areas: [] })
  const [auditLog, setAuditLog] = useState([])
  const [modifierTargetIdx, setModifierTargetIdx] = useState(null)
  const [modifierDraftNotes, setModifierDraftNotes] = useState('')
  const [modifierForm, setModifierForm] = useState({ name: '', options: '', min_selections: '', max_selections: '', applies_to_categories: '' })
  const [promotionForm, setPromotionForm] = useState({ name: '', discount_type: 'amount', discount_value: '', applies_to_category: 'All' })
  const [appliedPromotionId, setAppliedPromotionId] = useState(null)
  const [floorAreaName, setFloorAreaName] = useState('')
  const [ticketClock, setTicketClock] = useState(Date.now())
  const [submitting, setSubmitting] = useState(false)
  const [orderSuccess, setOrderSuccess] = useState(false)
  const [syncStatus, setSyncStatus] = useState(null)

  // Phase 4: Customer & loyalty
  const [posCustomers, setPosCustomers] = useState([])
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [loyaltyPointsEarned, setLoyaltyPointsEarned] = useState(0)
  const [voucherCode, setVoucherCode] = useState('')
  const [voucherAmount, setVoucherAmount] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [deliveryNotes, setDeliveryNotes] = useState('')
  const [customerAccountCharge, setCustomerAccountCharge] = useState(false)

  // Phase 5: Operations
  const [activeShifts, setActiveShifts] = useState([])
  const [openDrawerSession, setOpenDrawerSession] = useState(null)
  const [drawerFloat, setDrawerFloat] = useState('')
  const [drawerClosingTotal, setDrawerClosingTotal] = useState('')
  const [drawerDeclaredTotal, setDrawerDeclaredTotal] = useState('')
  const [suppliers, setSuppliers] = useState([])
  const [supplierForm, setSupplierForm] = useState({ name: '', contact_person: '', phone: '', email: '', address: '', payment_terms: '' })
  const [poForm, setPoForm] = useState({ supplier_id: '', notes: '', items: [{ description: '', quantity: '', unit_cost: '' }] })
  const [activeAlerts, setActiveAlerts] = useState([])
  const [alertForm, setAlertForm] = useState({ alert_type: 'stock_low', severity: 'warning', message: '' })
  const [checklists, setChecklists] = useState([])
  const [checklistType, setChecklistType] = useState('daily_opening')
  const [ownerDigest, setOwnerDigest] = useState(null)

  // Barcode scanner
  const barcodeBufferRef = useRef('')
  const barcodeTimerRef = useRef(null)
  const menuSearchInputRef = useRef(null)
  const selectedOutletRef = useRef(null)
  const outletsRef = useRef([])
  const menuItemsRef = useRef([])
  const inventoryItemsRef = useRef([])
  const liveRefreshBusyRef = useRef(false)
  const submitIntentRef = useRef({ signature: null, intentId: null })
  const splitOperationIdRef = useRef(null)
  const [barcodeFlash, setBarcodeFlash] = useState(null) // null | { name, found, wrongOutlet? }

  // Favourites
  const [favourites, setFavourites] = useState(() => {
    try {
      const raw = window.localStorage.getItem(POS_FAVOURITES_STORAGE_KEY)
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  })

  // Keyboard shortcuts
  const [selectedLineIdx, setSelectedLineIdx] = useState(-1)
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false)

  const currentOperator = selectedPosStaff || {
    id: currentUser?.id || null,
    name: currentUser?.name || currentUser?.email || 'Logged-in user',
    email: currentUser?.email || null,
    role: currentUser?.role || null
  }
  const tableWaiterName = serviceMode === 'table'
    ? tableServiceMode === 'waiter'
      ? (selectedWaiterStaff?.name || waiterName || '')
      : (currentOperator.name || '')
    : ''
  const tableWaiterId = tableServiceMode === 'waiter'
    ? (selectedWaiterStaff?.id || null)
    : (currentOperator.id || null)

  // Order history
  const [orders, setOrders] = useState([])
  const [voidHistory, setVoidHistory] = useState([])
  const [ordersError, setOrdersError] = useState(null)
  const [orderReadCompleteness, setOrderReadCompleteness] = useState({ source: 'unknown', complete: false, tenderComplete: false })
  const [histStart, setHistStart] = useState(() => toLocalDateInput(new Date(Date.now() - 48 * 60 * 60 * 1000)))
  const [histEnd, setHistEnd] = useState(() => toLocalDateInput(new Date()))
  const [historyExporting, setHistoryExporting] = useState('')
  const [historyExportMsg, setHistoryExportMsg] = useState('')
  const [expandedOrder, setExpandedOrder] = useState(null)
  const [voidModal, setVoidModal] = useState(false)
  const [voidTarget, setVoidTarget] = useState(null)
  const [voidPin, setVoidPin] = useState('')
  const [voidReason, setVoidReason] = useState('')
  const [voidError, setVoidError] = useState('')
  const [voidLoading, setVoidLoading] = useState(false)
  const [showVoidPin, setShowVoidPin] = useState(false)
  const [showReceiptOrder, setShowReceiptOrder] = useState(null)

  const [returnModal, setReturnModal] = useState(false)
  const [returnTarget, setReturnTarget] = useState(null)
  const [returnLines, setReturnLines] = useState({})
  const [returnPin, setReturnPin] = useState('')
  const [returnReason, setReturnReason] = useState('')
  const [returnPaymentMethod, setReturnPaymentMethod] = useState('')
  const [returnError, setReturnError] = useState('')
  const [returnLoading, setReturnLoading] = useState(false)
  const [showReturnPin, setShowReturnPin] = useState(false)

  const [splitModal, setSplitModal] = useState(false)
  const [splitItemIndices, setSplitItemIndices] = useState([])
  const [splitTargetTable, setSplitTargetTable] = useState('')
  const [splitLoading, setSplitLoading] = useState(false)
  const [splitMode, setSplitMode] = useState('items')
  const [splitEvenCount, setSplitEvenCount] = useState(2)
  const [splitEvenNames, setSplitEvenNames] = useState([])
  const [splitError, setSplitError] = useState('')

  const [discountApprovalModal, setDiscountApprovalModal] = useState(false)
  const [discountApprovalPin, setDiscountApprovalPin] = useState('')
  const [discountApprovalError, setDiscountApprovalError] = useState('')
  const [discountApprovalLoading, setDiscountApprovalLoading] = useState(false)
  const [showDiscountApprovalPin, setShowDiscountApprovalPin] = useState(false)

  const [cashupDate, setCashupDate] = useState(() => toLocalDateInput(new Date()))
  const [cashupOutletId, setCashupOutletId] = useState('')
  const [cashupOpeningFloat, setCashupOpeningFloat] = useState('')
  const [cashupCounted, setCashupCounted] = useState({})
  const [cashupNotes, setCashupNotes] = useState('')
  const [cashupSummary, setCashupSummary] = useState(null)
  const [cashupHistory, setCashupHistory] = useState([])
  const [cashupLoading, setCashupLoading] = useState(false)
  const [cashupSaving, setCashupSaving] = useState(false)
  const [cashupError, setCashupError] = useState('')

  // Inventory items (for depletion linking)
  const [inventoryItems, setInventoryItems] = useState([])

  // Recipes
  const [recipes, setRecipes] = useState([])
  const [recipeModal, setRecipeModal] = useState(false)
  const [editingRecipe, setEditingRecipe] = useState(null)
  const [recipeForm, setRecipeForm] = useState({ name: '', menu_item_id: '', serving_size: '1', ingredients: [] })
  const [recipeSaving, setRecipeSaving] = useState(false)

  // Menu item form modal
  const [menuModal, setMenuModal] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [menuForm, setMenuForm] = useState({
    name: '', category: 'Food', price: '', barcode: '',
    inventory_item_id: '', depletion_qty: '1', outlet_id: '',
    dietary_flags: [], prep_time_minutes: 0, is_popular: false, kitchen_station_id: ''
  })
  const [menuSaving, setMenuSaving] = useState(false)
  const [menuError, setMenuError] = useState('')
  const [barTemplateSavingKey, setBarTemplateSavingKey] = useState('')
  const [kitchenStations, setKitchenStations] = useState([])

  useEffect(() => {
    try {
      window.localStorage.setItem(POS_TOUCH_MODE_STORAGE_KEY, touchMode ? 'touch' : 'desktop')
    } catch {
      // Best-effort only.
    }
  }, [touchMode])

  useEffect(() => {
    try {
      window.localStorage.setItem(POS_FAVOURITES_STORAGE_KEY, JSON.stringify(favourites))
    } catch { /* Best-effort */ }
  }, [favourites])

  const toggleFavourite = useCallback((itemId) => {
    setFavourites((prev) => {
      if (prev.includes(itemId)) return prev.filter((id) => id !== itemId)
      if (prev.length >= POS_FAVOURITES_MAX) return [...prev.slice(1), itemId]
      return [...prev, itemId]
    })
  }, [])

  const isFavourite = useCallback((itemId) => favourites.includes(itemId), [favourites])

  // Outlets filtered to what this user is allowed to access
  // access.allowedOutletIds === null means full access (manager/admin)
  const posOutlets = useMemo(
    () => dedupeOutlets(outlets.filter((outlet) => outlet.type === 'food' || outlet.type === 'beverage')),
    [outlets]
  )

  const visibleOutlets = useMemo(() => {
    if (!access?.allowedOutletIds) return posOutlets // full access
    return posOutlets.filter((o) => access.allowedOutletIds.includes(o.id))
  }, [posOutlets, access?.allowedOutletIds])

  const isBarOutlet = selectedOutlet?.type === 'beverage'
  const isKitchenOutlet = selectedOutlet?.type === 'food'
  const matchesSelectedOutlet = (item) => {
    if (!selectedOutlet) return true
    if (!item?.outlet_id) return true
    if (selectedOutlet.id) return item.outlet_id === selectedOutlet.id
    if (selectedOutlet.type === 'food') return item.category === 'Food'
    if (selectedOutlet.type === 'beverage') return item.category === 'Drinks'
    return true
  }
  const manualMenuItems = useMemo(
    () => menuItems.filter((item) => !item.template_kind || item.template_kind === 'standard'),
    [menuItems]
  )
  const selectedManualMenuItems = useMemo(
    () => manualMenuItems.filter((item) => matchesSelectedOutlet(item)),
    [manualMenuItems, selectedOutlet]
  )
  const selectedBarInventoryItems = useMemo(
    () => inventoryItems.filter((item) => {
      if (!selectedOutlet) return true
      if (selectedOutlet.id) return item.outlet_id === selectedOutlet.id
      if (selectedOutlet.type === 'beverage') return item.category === 'Bar'
      if (selectedOutlet.type === 'food') return item.category === 'Kitchen'
      return true
    }),
    [inventoryItems, selectedOutlet]
  )
  const fallbackBarMenuItems = useMemo(
    () => selectedBarInventoryItems
      .filter((inventoryItem) => Number(inventoryItem.selling_price || 0) > 0)
      .filter((inventoryItem) => !menuItems.some(
        (item) => item.inventory_item_id === inventoryItem.id && item.template_kind === 'bar_single'
      ))
      .map((inventoryItem) => ({
        id: `virtual-bar-${inventoryItem.id}`,
        inventory_item_id: inventoryItem.id,
        item_name: inventoryItem.name,
        name: inventoryItem.name,
        category: 'Drinks',
        price: Number(inventoryItem.selling_price || 0),
        is_available: true,
        outlet_id: inventoryItem.outlet_id || selectedOutlet?.id || null,
        depletion_qty: 1,
        template_kind: 'bar_single_virtual',
        _virtual_inventory_item: true
      })),
    [selectedBarInventoryItems, menuItems, selectedOutlet]
  )
  // This must come after fallbackBarMenuItems. Hooks execute while POS renders,
  // so referencing that const above its initializer sends the terminal straight
  // to the recovery screen.
  const favouriteItems = useMemo(() => {
    if (favourites.length === 0) return []
    const allItems = [...menuItems, ...fallbackBarMenuItems]
    return favourites
      .map((id) => allItems.find((item) => item.id === id))
      .filter(Boolean)
      .filter((item) => matchesSelectedOutlet(item))
  }, [favourites, menuItems, fallbackBarMenuItems, selectedOutlet])
  const inventoryById = useMemo(
    () => new Map((inventoryItems || []).map((item) => [item.id, item])),
    [inventoryItems]
  )

  useEffect(() => {
    const enabled = settings?.vat_enabled === true
    setTaxEnabled(enabled)
    setTaxRate(enabled ? String(settings?.vat_rate || '') : '')
  }, [settings?.vat_enabled, settings?.vat_rate])

  useEffect(() => {
    selectedOutletRef.current = selectedOutlet
    if (selectedOutlet?.id && !cashupOutletId) setCashupOutletId(selectedOutlet.id)
  }, [selectedOutlet])

  useEffect(() => {
    outletsRef.current = outlets
  }, [outlets])

  useEffect(() => {
    menuItemsRef.current = menuItems
  }, [menuItems])

  useEffect(() => {
    inventoryItemsRef.current = inventoryItems
  }, [inventoryItems])

  const loadMenu = useCallback(async () => {
    const hasExistingMenu = (menuItemsRef.current || []).length > 0
    if (hasExistingMenu) setMenuRefreshing(true)
    else setMenuLoading(true)
    try {
      const data = await window.api.pos.getMenuItems().catch(() => [])
      setMenuItems(data || [])
    } finally {
      setMenuLoading(false)
      setMenuRefreshing(false)
    }
  }, [])

  const loadInventoryItems = useCallback(async () => {
    const data = await window.api.inventory.getItems().catch(() => [])
    setInventoryItems(data || [])
  }, [])

  const loadRooms = useCallback(async () => {
    const data = await window.api.rooms.getAll().catch(() => [])
    setRooms((data || []).filter((r) => r.status !== 'maintenance'))
  }, [])

  const loadEvents = useCallback(async () => {
    const data = await window.api.pos.getActiveEvents().catch(() => [])
    setActiveEvents(data || [])
  }, [])

  const loadOrders = useCallback(async () => {
    setOrdersError(null)
    try {
      const [data, voids] = await Promise.all([
        window.api.pos.getOrders(histStart, histEnd),
        window.api.pos.getVoidHistory(histStart, histEnd).catch(() => [])
      ])
      setOrders(data || [])
      setOrderReadCompleteness({
        source: data?._source || 'unknown',
        complete: data?._source === 'server' && data?._complete === true,
        tenderComplete: data?._tender_complete === true
      })
      setVoidHistory(voids || [])
    } catch (err) {
      setOrders([])
      setOrderReadCompleteness({ source: 'error', complete: false, tenderComplete: false })
      setVoidHistory([])
      setOrdersError(err?.message || 'Failed to load orders')
    }
  }, [histEnd, histStart])

  const exportPosHistory = useCallback(async (format) => {
    setHistoryExporting(format)
    setHistoryExportMsg('')
    try {
      const exporter = format === 'pdf'
        ? window.api.pos.exportHistoryPdf
        : window.api.pos.exportHistoryExcel
      if (!exporter) {
        setHistoryExportMsg('POS history export is not available in this app build. Please restart after updating.')
        return
      }
      if (!(orderReadCompleteness.complete && orderReadCompleteness.tenderComplete)) {
        setHistoryExportMsg('POS history export is unavailable until the server confirms a complete, reconciled source.')
        return
      }
      const result = await exporter?.({ start: histStart, end: histEnd })
      if (result?.success) {
        setHistoryExportMsg(`${format === 'pdf' ? 'PDF' : 'Excel'} exported${result.filePath ? `: ${result.filePath}` : '.'}`)
      } else if (result?.error) {
        setHistoryExportMsg(result.error)
      }
    } catch (err) {
      setHistoryExportMsg(err?.message || `Could not export POS history as ${format}.`)
    } finally {
      setHistoryExporting('')
      window.setTimeout(() => setHistoryExportMsg(''), 7000)
    }
  }, [histEnd, histStart, orderReadCompleteness.complete, orderReadCompleteness.tenderComplete])

  const loadCashup = useCallback(async () => {
    setCashupLoading(true)
    setCashupError('')
    try {
      const [summary, history] = await Promise.all([
        window.api.pos.getCashupSummary({
          shift_id: currentShift?.id || null,
          date: cashupDate,
          outlet_id: cashupOutletId || null,
          opening_float: Number(cashupOpeningFloat || 0),
          cashier_id: currentOperator.id || null,
          cashier_name: currentOperator.name || null
        }),
        window.api.pos.getCashups(12, { cashier_id: currentOperator.id || null })
      ])
      if (summary?.success === false) {
        setCashupError(summary.error || 'Could not load cash-up summary.')
      } else {
        setCashupSummary(summary || null)
      }
      if (history?._available === false) {
        setCashupHistory([])
        setCashupError(history._error || 'Cash-up history is unavailable. Do not treat the history as empty.')
      } else {
        setCashupHistory(Array.isArray(history) ? history : [])
      }
    } catch (err) {
      setCashupError(err?.message || 'Could not load cash-up summary.')
    } finally {
      setCashupLoading(false)
    }
  }, [cashupDate, cashupOpeningFloat, cashupOutletId, currentOperator.id, currentOperator.name, currentShift?.id])

  const loadPosOperations = useCallback(async () => {
    const rushTab = tab === 'terminal' || tab === 'tickets'
    const [tabs, ticketRows, shift, hardware, staffRows, modifierRows, promotionRows, floorRows, auditRows, recipeRows, customerRows, stationRows] = await Promise.all([
      window.api.pos.getTabs?.().catch(() => []),
      window.api.pos.getTickets?.({ station: 'all' }).catch(() => []),
      window.api.pos.getCurrentShift?.(selectedOutlet?.id || null, selectedPosStaff?.id || currentUser?.id || null).catch(() => null),
      window.api.pos.getHardwareSettings?.().catch(() => null),
      window.api.pos.getStaff?.().catch(() => []),
      window.api.pos.getModifierGroups?.().catch(() => []),
      window.api.pos.getPromotions?.().catch(() => []),
      window.api.pos.getFloorLayout?.().catch(() => ({ areas: [] })),
      rushTab ? Promise.resolve([]) : window.api.pos.getAuditLog?.(25).catch(() => []),
      rushTab ? Promise.resolve([]) : window.api.pos.getRecipes?.().catch(() => []),
      restaurantMode ? window.api.pos.getCustomers?.().catch(() => []) : Promise.resolve([]),
      window.api.pos.getStations?.().catch(() => [])
    ])
    const [tables, printers, displays] = await Promise.all([
      (window.api.pos.getTablesWithStatus?.(selectedOutlet?.id || null) || window.api.pos.getTables?.()).catch(() => []),
      window.api.receipts.listPrinters?.().catch(() => []),
      window.api.pos.listDisplays?.().catch(() => [])
    ])
    setOpenTabs((tabs || []).filter((row) => ACTIVE_TABLE_STATUSES.has(String(row.status || 'open').toLowerCase())))
    setTickets(ticketRows || [])
    setCurrentShift(shift || null)
    setHardwareSettings(hardware || null)
    setPosStaff(staffRows || [])
    setModifierGroups(modifierRows || [])
    setPromotions(promotionRows || [])
    setFloorLayout(floorRows || { areas: [] })
    setAuditLog(auditRows || [])
    setPosTables(tables || [])
    setReceiptPrinters(printers || [])
    setSystemDisplays(displays || [])
    setRecipes(recipeRows || [])
    setPosCustomers(customerRows || [])
    setKitchenStations(stationRows || [])

    // Phase 5: Load operations data in restaurant mode
    if (restaurantMode && !rushTab) {
      const [shifts, drawer, supplierList, alertList] = await Promise.all([
        window.api.pos.getActiveShifts?.().catch(() => []),
        window.api.pos.getOpenCashDrawer?.().catch(() => null),
        window.api.pos.getSuppliers?.().catch(() => []),
        window.api.pos.getActiveAlerts?.().catch(() => [])
      ])
      setActiveShifts(shifts || [])
      setOpenDrawerSession(drawer || null)
      setSuppliers(supplierList || [])
      setActiveAlerts(alertList || [])
    }
  }, [currentUser?.id, selectedOutlet?.id, selectedPosStaff?.id, restaurantMode, tab])

  useEffect(() => {
    if (tab !== 'history') return
    setHistEnd(toLocalDateInput(new Date()))
    setHistStart(toLocalDateInput(new Date(Date.now() - 48 * 60 * 60 * 1000)))
  }, [tab])

  useEffect(() => {
    loadMenu()
    loadRooms()
    loadEvents()
    loadInventoryItems()
    // Load outlets for order tagging and menu filtering
    setOutletsLoading(true)
    window.api.outlets.getAll()
      .then((d) => {
        const list = dedupeOutlets(d || [])
        setOutlets(list)
        const posList = list.filter((o) => o.type === 'food' || o.type === 'beverage')
        // Auto-select: use allowedOutletIds to pick first allowed outlet
        const allowed = access?.allowedOutletIds
        const allowedList = allowed ? posList.filter((o) => allowed.includes(o.id)) : posList
        if (allowedList.length > 0) setSelectedOutlet(allowedList[0])
        else if (posList.length === 0) setOutletsError(true)
      })
      .catch(() => setOutletsError(true))
      .finally(() => setOutletsLoading(false))
  }, [access?.allowedOutletIds, loadInventoryItems, loadMenu, loadRooms])

  useEffect(() => {
    if (tab === 'history') loadOrders()
  }, [tab, loadOrders])

  useEffect(() => {
    if (tab === 'cashup') loadCashup()
  }, [tab, loadCashup])

  useEffect(() => {
    if (['terminal', 'tickets', 'setup', 'cashup'].includes(tab)) loadPosOperations()
  }, [tab, loadPosOperations])

  useEffect(() => {
    if (tab !== 'tickets') return undefined
    const timer = window.setInterval(() => setTicketClock(Date.now()), 60000)
    return () => window.clearInterval(timer)
  }, [tab])

  useEffect(() => {
    if (!window.api?.sync?.getStatus || !window.api?.sync?.onStatusChanged) return

    let mounted = true
    const loadSyncStatus = async () => {
      try {
        const status = await window.api.sync.getStatus()
        if (mounted) setSyncStatus(status || null)
      } catch {
        if (mounted) setSyncStatus(null)
      }
    }

    loadSyncStatus()
    const unsubscribe = window.api.sync.onStatusChanged((status) => {
      if (mounted) {
        setSyncStatus(status || null)
        if (tab === 'history') loadOrders()
        if (tab === 'cashup') loadCashup()
        if (tab === 'terminal') {
          loadMenu()
          loadInventoryItems()
          loadPosOperations()
        }
      }
    })

    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [])

  const offlineMode = isSyncOffline(syncStatus)
  const walkInPaymentNeedsVerification = offlineMode && customerType === 'walkin' && paymentMethod !== 'cash'
  const refreshLivePosState = useCallback(async ({ includeOrders = false } = {}) => {
    if (liveRefreshBusyRef.current) return
    liveRefreshBusyRef.current = true
    try {
      const tasks = [loadMenu(), loadInventoryItems()]
      if (includeOrders) tasks.push(loadOrders())
      if (['terminal', 'tickets'].includes(tab)) tasks.push(loadPosOperations())
      await Promise.all(tasks)
    } finally {
      liveRefreshBusyRef.current = false
    }
  }, [loadInventoryItems, loadMenu, loadOrders, loadPosOperations, offlineMode, tab])

  useEffect(() => {
    if (offlineMode) return undefined

    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      refreshLivePosState({ includeOrders: tab === 'history' })
    }

    const handleFocus = () => tick()
    const handleVisibility = () => tick()

    const interval = setInterval(tick, POS_LIVE_REFRESH_MS)
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [offlineMode, refreshLivePosState, tab])

  // ── Barcode scanner listener (only active on terminal tab) ──────────────────
  useEffect(() => {
    if (tab !== 'terminal') return

    const handleKeyDown = (e) => {
      // Don't hijack input fields — let user type normally in text inputs
      const activeTag = document.activeElement?.tagName
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return

      if (e.key === 'Enter') {
        const code = barcodeBufferRef.current.trim()
        barcodeBufferRef.current = ''
        if (barcodeTimerRef.current) {
          clearTimeout(barcodeTimerRef.current)
          barcodeTimerRef.current = null
        }
        if (code.length >= 4) {
          const currentInventoryMap = new Map((inventoryItemsRef.current || []).map((item) => [item.id, item]))
          const currentSelectedOutlet = selectedOutletRef.current
          const currentOutlets = outletsRef.current || []
          const found = (menuItemsRef.current || []).find((m) => m.barcode === code && m.is_available)
          if (found) {
            // Block if item belongs to a different outlet than the selected one
            if (found.outlet_id && currentSelectedOutlet && found.outlet_id !== currentSelectedOutlet.id) {
              const itemOutlet = currentOutlets.find((o) => o.id === found.outlet_id)
              setBarcodeFlash({ name: found.name, found: false, wrongOutlet: itemOutlet?.name || 'another outlet' })
            } else if (!isOrderableMenuItem(found, currentInventoryMap)) {
              setBarcodeFlash({ name: `${found.name} is sold out`, found: false })
            } else {
              addToOrder(found)
              setBarcodeFlash({ name: found.name, found: true })
            }
          } else {
            setBarcodeFlash({ name: code, found: false })
          }
          setTimeout(() => setBarcodeFlash(null), 3000)
        }
      } else if (e.key.length === 1) {
        barcodeBufferRef.current += e.key
        // Reset buffer if no follow-up within 80ms (scanners fire much faster than humans type)
        if (barcodeTimerRef.current) clearTimeout(barcodeTimerRef.current)
        barcodeTimerRef.current = setTimeout(() => {
          barcodeBufferRef.current = ''
        }, 80)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (barcodeTimerRef.current) clearTimeout(barcodeTimerRef.current)
      barcodeBufferRef.current = ''
    }
  }, [tab])

  // ── Keyboard shortcuts (active on terminal tab) ────────────────────────────
  useEffect(() => {
    if (tab !== 'terminal') return

    const handleShortcut = (e) => {
      const activeTag = document.activeElement?.tagName
      const isInputFocused = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT'

      // Ctrl+F or / — Focus search (skip if already in an input)
      if ((e.ctrlKey && e.key === 'f') || (!isInputFocused && e.key === '/' && !e.ctrlKey && !e.altKey && !e.metaKey)) {
        e.preventDefault()
        menuSearchInputRef.current?.focus()
        return
      }

      // ? — Toggle keyboard help
      if (!isInputFocused && e.key === '?' && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        setShowKeyboardHelp((v) => !v)
        return
      }

      // Don't handle remaining shortcuts when input is focused
      if (isInputFocused) return

      // F2 — Cash payment
      if (e.key === 'F2') {
        e.preventDefault()
        setPaymentMethod('cash')
        setCustomerType('walkin')
        setServiceMode('takeaway')
        return
      }

      // F3 — Card payment
      if (e.key === 'F3') {
        e.preventDefault()
        setPaymentMethod('card')
        setCustomerType('walkin')
        setServiceMode('takeaway')
        return
      }

      // F9 or Ctrl+Enter — Complete order
      if (e.key === 'F9' || (e.ctrlKey && e.key === 'Enter')) {
        e.preventDefault()
        if (orderItems.length > 0 && !submitting) completeOrder()
        return
      }

      // Escape — Clear order or close help
      if (e.key === 'Escape') {
        e.preventDefault()
        if (showKeyboardHelp) { setShowKeyboardHelp(false); return }
        if (orderItems.length > 0 && !submitting && window.confirm('Clear the current order?')) {
          setOrderItems([])
          setSelectedLineIdx(-1)
        }
        return
      }

      // + or = — Increment selected line quantity
      if ((e.key === '+' || e.key === '=') && selectedLineIdx >= 0 && selectedLineIdx < orderItems.length) {
        e.preventDefault()
        updateQty(selectedLineIdx, 1)
        return
      }

      // - — Decrement selected line quantity
      if (e.key === '-' && selectedLineIdx >= 0 && selectedLineIdx < orderItems.length) {
        e.preventDefault()
        updateQty(selectedLineIdx, -1)
        return
      }

      // Delete or Backspace — Remove selected line
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedLineIdx >= 0 && selectedLineIdx < orderItems.length) {
        e.preventDefault()
        setOrderItems((prev) => prev.filter((_, i) => i !== selectedLineIdx))
        setSelectedLineIdx((prev) => Math.min(prev, orderItems.length - 2))
        return
      }

      // Arrow Up/Down — Navigate cart lines
      if (e.key === 'ArrowUp' && orderItems.length > 0) {
        e.preventDefault()
        setSelectedLineIdx((prev) => Math.max(0, prev - 1))
        return
      }
      if (e.key === 'ArrowDown' && orderItems.length > 0) {
        e.preventDefault()
        setSelectedLineIdx((prev) => Math.min(orderItems.length - 1, prev + 1))
        return
      }
    }

    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [tab, orderItems, selectedLineIdx, submitting, showKeyboardHelp])

  // ── Terminal ────────────────────────────────────────────────────────────────

  const addToOrder = (item) => {
    const orderKey = item._virtual_inventory_item
      ? `inventory:${item.inventory_item_id}`
      : `menu:${item.id}`
    setOrderItems((prev) => {
      const nextLine = {
        order_key: orderKey,
        menu_item_id: item._virtual_inventory_item ? null : item.id,
        item_name: item.name,
        category: item.category || null,
        unit_price: item.price,
        base_unit_price: item.price,
        modifiers: [],
        item_notes: null,
        quantity: 1,
        inventory_item_id: item.inventory_item_id || null,
        depletion_qty: Number(item.depletion_qty || 1),
        kitchen_station_id: item.kitchen_station_id || null
      }
      const candidate = prev.find((i) => i.order_key === orderKey)
        ? prev.map((i) => i.order_key === orderKey ? { ...i, quantity: i.quantity + 1 } : i)
        : [...prev, nextLine]

      if (item.inventory_item_id) {
        const usage = buildOrderStockUsage(candidate)
        const requiredStock = usage.get(item.inventory_item_id) || 0
        const availableStock = normalizeStockValue(inventoryById.get(item.inventory_item_id)?.current_stock)
        if (requiredStock > availableStock) {
          const availableUnits = getInventoryAvailableUnits(inventoryById, item.inventory_item_id, item.depletion_qty)
          alert(
            availableStock <= 0
              ? `${item.name} is sold out on the latest synced stock.`
              : `Only ${availableUnits} sale unit(s) of ${item.name} are left on the latest synced stock.`
          )
          return prev
        }
      }

      return candidate
    })
    setSelectedLineIdx((prev) => {
      const idx = orderItems.findIndex((i) => i.order_key === (item._virtual_inventory_item ? `inventory:${item.inventory_item_id}` : `menu:${item.id}`))
      return idx >= 0 ? idx : orderItems.length
    })
  }

  const updateQty = useCallback((idx, delta) => {
    setOrderItems((prev) => {
      const updated = [...prev]
      updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + delta }
      if (updated[idx].quantity <= 0) updated.splice(idx, 1)
      return updated
    })
  }, [])

  const incrementQty = useCallback((idx) => updateQty(idx, 1), [updateQty])
  const decrementQty = useCallback((idx) => updateQty(idx, -1), [updateQty])

  const setQty = useCallback((idx, rawValue) => {
    const parsed = Number.parseInt(String(rawValue || '').replace(/[^\d]/g, ''), 10)
    const quantity = Number.isFinite(parsed) && parsed > 0 ? parsed : 1
    setOrderItems((prev) => {
      if (!prev[idx]) return prev
      const updated = [...prev]
      updated[idx] = { ...updated[idx], quantity }
      return updated
    })
  }, [])

  const orderSubtotal = orderItems.reduce((s, i) => s + i.quantity * i.unit_price, 0)
  const parsedDiscountValue = Number(discountValue || 0)
  const appliedPromotion = promotions.find((promotion) => promotion.id === appliedPromotionId) || null
  const discountBase = appliedPromotion && String(appliedPromotion.applies_to_category || 'All').toLowerCase() !== 'all'
    ? orderItems
      .filter((item) => String(item.category || '').toLowerCase() === String(appliedPromotion.applies_to_category).toLowerCase())
      .reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0)
    : orderSubtotal
  const orderDiscountAmount = canDiscount && discountBase > 0 && parsedDiscountValue > 0
    ? Math.min(
        discountBase,
        discountMode === 'percent'
          ? discountBase * Math.min(parsedDiscountValue, 100) / 100
          : parsedDiscountValue
      )
    : 0
  const orderItemsForSubmit = orderItems
  const taxableSubtotal = Math.max(0, orderSubtotal - orderDiscountAmount)
  const orderTaxTotal = taxEnabled ? Math.round((taxableSubtotal * Number(taxRate || 0) / 100) * 100) / 100 : 0
  const orderTipTotal = Math.max(0, Number(tipAmount || 0))
  const orderTotal = Math.max(0, taxableSubtotal + orderTaxTotal + orderTipTotal)
  const voucherTenderAmount = Math.round(Number(voucherAmount || 0) * 100) / 100
  const voucherTenderCode = String(voucherCode || '').trim().toUpperCase()
  const accountTenderSelected = Boolean(customerAccountCharge && selectedCustomerId)
  const effectivePaymentMethod = (customerType === 'room' || customerType === 'event')
    ? 'folio'
    : accountTenderSelected
      ? 'account'
      : paymentMethod
  const normalizedPaymentBreakdown = splitPaymentsEnabled
    ? paymentSplits.map((row) => ({
        method: row.method || 'cash',
        amount: Number(row.amount || 0),
        reference: row.reference || null
      })).filter((row) => row.amount > 0)
    : [
        ...(voucherTenderAmount > 0 ? [{
          method: 'voucher',
          amount: voucherTenderAmount,
          code: voucherTenderCode,
          reference: null
        }] : []),
        ...(orderTotal - voucherTenderAmount > 0 ? [{
          method: effectivePaymentMethod,
          amount: Math.round((orderTotal - voucherTenderAmount) * 100) / 100,
          reference: paymentReference || null,
          ...(accountTenderSelected ? { customer_id: selectedCustomerId } : {})
        }] : [])
      ]
  const splitPaidTotal = normalizedPaymentBreakdown.reduce((sum, row) => sum + Number(row.amount || 0), 0)
  const splitBalance = Math.round((orderTotal - splitPaidTotal) * 100) / 100
  const menuMutationsDisabled = offlineMode || menuSaving || !!barTemplateSavingKey
  const orderStockIssues = useMemo(() => {
    const usage = buildOrderStockUsage(orderItems)
    return [...usage.entries()].map(([inventoryItemId, requiredStock]) => {
      const inventoryRow = inventoryById.get(inventoryItemId)
      const availableStock = normalizeStockValue(inventoryRow?.current_stock)
      if (requiredStock <= availableStock) return null
      return {
        inventoryItemId,
        itemName: inventoryRow?.name || 'Inventory item',
        requiredStock,
        availableStock
      }
    }).filter(Boolean)
  }, [inventoryById, orderItems])
  const currentOpenTab = useMemo(() => openTabs.find((row) => row.id === activeTabId) || null, [activeTabId, openTabs])
  const currentOpenTabTotal = currentOpenTab && currentOpenTab.total !== null && currentOpenTab.total !== undefined && currentOpenTab.total !== ''
    ? (Number.isFinite(Number(currentOpenTab.total)) ? Number(currentOpenTab.total) : null)
    : null
  const visibleTables = useMemo(() => {
    return posTables.filter((table) => table.active !== false && (!selectedOutlet?.id || !table.outlet_id || table.outlet_id === selectedOutlet.id))
  }, [posTables, selectedOutlet?.id])

  useEffect(() => {
    window.api.pos.updateCustomerDisplay?.({
      outlet_id: selectedOutlet?.id || null,
      table_name: serviceMode === 'table' ? tableName || null : null,
      staff_name: currentOperator.name || tableWaiterName || null,
      items: orderItems.map((item) => ({
        item_name: item.item_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        modifiers: item.modifiers || [],
        item_notes: item.item_notes || null
      })),
      subtotal: orderSubtotal,
      discount_total: orderDiscountAmount,
      tax_total: orderTaxTotal,
      tip_total: orderTipTotal,
      total: orderTotal
    }).catch(() => {})
  }, [currentOperator.name, orderDiscountAmount, orderItems, orderSubtotal, orderTaxTotal, orderTipTotal, orderTotal, selectedOutlet?.id, serviceMode, tableName, tableWaiterName])

  const completeOrder = async () => {
    if (orderItems.length === 0) return
    if (outletsError || !selectedOutlet) { alert('No outlet is selected. Select Kitchen or Bar before completing the order.'); return }
    if (customerType === 'room' && !selectedRoom) { alert('Select a room first.'); return }
    if (customerType === 'event' && !selectedEventId) { alert('Select an event first.'); return }
    if (voucherTenderCode && voucherTenderAmount <= 0) { alert('Enter a voucher amount before completing the sale.'); return }
    if (voucherTenderAmount > 0 && !voucherTenderCode) { alert('Enter a voucher code before completing the sale.'); return }
    if (voucherTenderAmount > orderTotal) { alert('Voucher amount cannot exceed the order total.'); return }
    if (voucherTenderAmount > 0 && (splitPaymentsEnabled || accountTenderSelected || customerType === 'room' || customerType === 'event')) {
      alert('Voucher tenders must be recorded as a non-split payment and cannot be combined with an account or folio charge.')
      return
    }
    if (accountTenderSelected && splitPaymentsEnabled) {
      alert('Customer-account tenders cannot be combined with split payment rows.')
      return
    }
    if (serviceMode === 'table') {
      if (!tableName.trim()) { alert('Select a table first.'); return }
      if (tableServiceMode === 'waiter' && !selectedWaiterStaff?.id && !waiterName.trim()) { alert('Select the waiter for this table.'); return }
    }
    if (orderStockIssues.length > 0) {
      alert(`${orderStockIssues[0].itemName} no longer has enough stock for this order. Refresh the quantities and try again.`)
      return
    }
    if (splitPaymentsEnabled && Math.abs(splitBalance) > 0.005) {
      alert(`Split payments must match the order total. Remaining balance: ${currency} ${fmt(splitBalance)}`)
      return
    }
    const missingTenderReferences = normalizedPaymentBreakdown.filter((row) =>
      ['card', 'mobile_money'].includes(String(row.method || '').toLowerCase()) &&
      !String(row.reference || '').trim()
    )
    if (missingTenderReferences.length > 0) {
      alert('Enter the card or mobile-money transaction/approval reference before completing this sale.')
      setShowPaymentDetails(true)
      return
    }
    if (!appliedPromotionId && orderDiscountAmount > 0 && !discountReason.trim()) {
      alert('Enter a reason for the manual discount.')
      return
    }
    if (!appliedPromotionId && orderDiscountAmount > 0 && !pendingDiscountApprovalRef.current) {
      setDiscountApprovalModal(true)
      return
    }

    setSubmitting(true)
    try {
      const submitSignature = buildPosSubmitSignature({
        customerType,
        selectedRoom,
        selectedEventId,
        walkInName,
        orderNotes,
        paymentMethod: effectivePaymentMethod,
        paymentBreakdown: normalizedPaymentBreakdown,
        taxTotal: orderTaxTotal,
        tipTotal: orderTipTotal,
        tableName,
        activeTabId,
        selectedOutletId: selectedOutlet?.id || null,
        orderItems: orderItemsForSubmit,
        appliedPromotionId,
        discountMode,
        discountValue,
        discountReason
      })
      if (submitIntentRef.current.signature !== submitSignature || !submitIntentRef.current.intentId) {
        submitIntentRef.current = {
          signature: submitSignature,
          intentId: crypto.randomUUID()
        }
      }
      const submitIntentId = submitIntentRef.current.intentId

      let selectedBookingId = null
      if (customerType === 'room') {
        const booking = await window.api.pos.getActiveBookingForRoom(selectedRoom)
        if (!booking?.id) {
          alert('No active booking found for this room. The guest may not be checked in yet.')
          setSubmitting(false)
          return
        }
        selectedBookingId = booking.id
      }

      let tabIdForOrder = activeTabId || null
      let tabNameForOrder = activeTabId ? openTabs.find((row) => row.id === activeTabId)?.tab_name || null : null
      if (serviceMode === 'table' && !tabIdForOrder) {
        const tableSession = await window.api.pos.openTableSession?.({
          outlet_id: selectedOutlet.id,
          table_name: tableName.trim(),
          tab_name: tableName.trim(),
          waiter_name: tableWaiterName || currentOperator.name || null,
          waiter_id: tableWaiterId,
          items: orderItems
        })
        if (!tableSession?.success) {
          alert(tableSession?.error || 'Could not open table before completing the order.')
          setSubmitting(false)
          return
        }
        tabIdForOrder = tableSession.tab?.id || null
        tabNameForOrder = tableSession.tab?.tab_name || tableName.trim()
      }

      const result = await window.api.pos.createOrder({
        id: submitIntentId,
        submit_intent_id: submitIntentId,
        room_id: customerType === 'room' ? selectedRoom : null,
        booking_id: customerType === 'room' ? selectedBookingId : null,
        event_booking_id: customerType === 'event' ? selectedEventId : null,
        walk_in_name: customerType === 'walkin' ? (walkInName.trim() || 'Walk-in') : null,
        customer_id: customerType === 'walkin' && selectedCustomerId ? selectedCustomerId : null,
        items: orderItemsForSubmit,
        notes: orderNotes.trim() || null,
        payment_method: (customerType === 'room' || customerType === 'event') ? 'folio' : splitPaymentsEnabled ? 'split' : effectivePaymentMethod,
        payment_breakdown: normalizedPaymentBreakdown,
        gross_total: orderSubtotal,
        discount_total: orderDiscountAmount,
        tax_rate: taxEnabled ? Number(taxRate || 0) : 0,
        tax_total: orderTaxTotal,
        tip_total: orderTipTotal,
        total: orderTotal,
        service_mode: serviceMode,
        table_name: serviceMode === 'table' ? tableName.trim() || null : null,
        delivery_address: serviceMode === 'delivery' ? deliveryAddress.trim() || null : null,
        delivery_notes: serviceMode === 'delivery' ? deliveryNotes.trim() || null : null,
        // Compatibility metadata for old queue records; the server trusts the
        // account identity on payment_breakdown, not this side-channel field.
        customer_account_charge: accountTenderSelected ? {
          customer_id: selectedCustomerId,
          amount: orderTotal
        } : null,
        tab_name: tabNameForOrder,
        waiter_name: serviceMode === 'table' ? tableWaiterName || null : null,
        waiter_id: serviceMode === 'table' ? tableWaiterId || null : null,
        cashier_id: currentOperator.id || null,
        cashier_name: currentOperator.name || currentOperator.email || null,
        tab_id: tabIdForOrder,
        shift_id: currentShift?.id || null,
        outlet_id: selectedOutlet.id,
        outlet_name: selectedOutlet.name,
        promotion_id: appliedPromotionId,
        manual_discount: !appliedPromotionId && orderDiscountAmount > 0
          ? {
              type: discountMode,
              value: parsedDiscountValue,
              reason: discountReason.trim()
            }
          : null
      })
      if (result?.success) {
        const authoritativeItems = result.offline === true
          ? orderItemsForSubmit
          : (Array.isArray(result.items) ? result.items : orderItemsForSubmit)
        const receiptOrder = {
          id: result.id || submitIntentId,
          receipt_number: result.receipt_number || null,
          room_id: customerType === 'room' ? selectedRoom : null,
          booking_id: customerType === 'room' ? selectedBookingId : null,
          walk_in_name: customerType === 'walkin' ? (walkInName.trim() || 'Walk-in') : null,
          pos_order_items: authoritativeItems.map((item, idx) => ({
            id: item.id || `${submitIntentId}-${idx}`,
            ...item,
            item_name: item.item_name,
            quantity: Number(item.quantity || 0),
            unit_price: Number(item.unit_price || 0),
            subtotal: item.subtotal ?? item.net_subtotal ?? item.gross_subtotal ?? item.line_total ?? null,
            line_total: item.line_total ?? item.total ?? null,
            modifiers: item.modifiers || [],
            item_notes: item.item_notes || null
          })),
          payment_method: result.offline === true
            ? (result.payment_method || (customerType === 'room' ? 'folio' : splitPaymentsEnabled ? 'split' : effectivePaymentMethod))
            : (result.payment_method ?? null),
          payment_breakdown: result.offline === true ? (result.payment_breakdown || normalizedPaymentBreakdown) : (result.payment_breakdown ?? null),
          gross_total: result.offline === true ? orderSubtotal : (Number.isFinite(Number(result.gross_total)) ? Number(result.gross_total) : null),
          discount_total: result.offline === true ? orderDiscountAmount : (Number.isFinite(Number(result.discount_total)) ? Number(result.discount_total) : null),
          tax_total: result.offline === true ? orderTaxTotal : (Number.isFinite(Number(result.tax_total)) ? Number(result.tax_total) : null),
          tip_total: result.offline === true ? orderTipTotal : (Number.isFinite(Number(result.tip_total)) ? Number(result.tip_total) : null),
          total: result.offline === true ? orderTotal : (Number.isFinite(Number(result.total)) ? Number(result.total) : null),
          table_name: serviceMode === 'table' ? tableName.trim() || null : null,
          waiter_name: serviceMode === 'table' ? tableWaiterName || null : null,
          cashier_name: currentOperator.name || currentOperator.email || null,
          outlet_name: selectedOutlet.name,
          created_at: new Date().toISOString(),
          _pending_sync: result.offline === true,
          _auto_print: hardwareSettings?.auto_print_receipts === true
        }
        submitIntentRef.current = { signature: null, intentId: null }
        pendingDiscountApprovalRef.current = null
        setOrderItems([])
        setWalkInName('')
        setOrderNotes('')
        setPaymentMethod('cash')
        setPaymentReference('')
        setDiscountValue('')
        setDiscountReason('')
        setDiscountMode('amount')
        setAppliedPromotionId(null)
        setTaxEnabled(settings?.vat_enabled === true)
        setTaxRate(settings?.vat_enabled === true ? String(settings?.vat_rate || '') : '')
        setTipAmount('')
        setSplitPaymentsEnabled(false)
        setPaymentSplits([{ method: 'cash', amount: '', reference: '' }])
        setServiceMode('takeaway')
        setTableName('')
        setWaiterName('')
        setSelectedWaiterStaff(null)
        setPendingWaiterStaffId('')
        setTableServiceMode('operator')
        setActiveTabId('')
        await loadPosOperations()
        await refreshLivePosState({ includeOrders: true })

        // Phase 4: Award loyalty points for registered customers
        if (selectedCustomerId && !result.offline) {
          const points = Number.isFinite(Number(result.total)) ? Math.floor(Number(result.total) / 10) : 0
          if (points > 0) {
            window.api.pos.awardLoyalty({
              customerId: selectedCustomerId,
              orderId: result.id,
              points,
              description: `Order #${(result.receipt_number || result.id || '').slice(0, 8)}`
            }).then((r) => { if (r?.success && !r?.duplicate) setLoyaltyPointsEarned(points) }).catch(() => {})
          }
        }

        setSelectedCustomerId('')
        setSelectedCustomer(null)
        setVoucherCode('')
        setVoucherAmount('')
        setDeliveryAddress('')
        setDeliveryNotes('')
        setCustomerAccountCharge(false)

        const shouldOpenDrawer = hardwareSettings?.cash_drawer_enabled === true
          && hardwareSettings?.cash_drawer_open_on_cash === true
          && paymentBreakdownHasCash(receiptOrder.payment_breakdown)
        const shouldKickDrawerWithReceipt = shouldOpenDrawer
          && receiptOrder._auto_print === true
          && hardwareSettings?.receipt_print_mode === 'escpos'
        if (shouldOpenDrawer && !shouldKickDrawerWithReceipt) {
          const drawerResult = await window.api.pos.openCashDrawer?.({
            reason: 'cash_payment',
            order_id: receiptOrder.id,
            amount: orderTotal
          }).catch((error) => ({ success: false, error: error?.message }))
          if (!drawerResult?.success) {
            setHardwareMsg(drawerResult?.error || 'Cash drawer did not open. Check ESC/POS hardware settings.')
          }
        }
        if (receiptOrder._auto_print) setShowReceiptOrder({ ...receiptOrder, _open_drawer_on_print: shouldKickDrawerWithReceipt })
        setOrderSuccess(true)
        window.setTimeout(() => menuSearchInputRef.current?.focus(), 0)
        setTimeout(() => setOrderSuccess(false), 3000)
      } else {
        alert(result?.error || 'Failed to complete order. Please try again.')
      }
    } catch (err) {
      alert(err.message || 'Failed to complete order. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Menu management ─────────────────────────────────────────────────────────

  const ensurePosMutationSuccess = (result, fallback) => {
    if (!result?.success) {
      throw new Error(result?.error || fallback)
    }
    return result
  }

  const renderOutletSelector = () => {
    if (outletsLoading) {
      return (
        <div className="flex gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-9 flex-1 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      )
    }
    if (outletsError || outlets.length === 0) {
      return (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          Outlets could not be loaded. POS needs an active Kitchen or Bar outlet before it can continue.
        </div>
      )
    }
    if (visibleOutlets.length === 0) {
      return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Your account has not been assigned to any POS outlet. Ask a manager to assign Bar or Kitchen access.
        </div>
      )
    }
    return (
      <div className="flex gap-2">
        {visibleOutlets.map((o) => {
          const palette = {
            food: { active: 'bg-orange-500 text-white ring-2 ring-orange-300 shadow-md', idle: 'bg-orange-50 text-orange-700 hover:bg-orange-100 border border-orange-200' },
            beverage: { active: 'bg-blue-600 text-white ring-2 ring-blue-300 shadow-md', idle: 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200' }
          }
          const c = palette[o.type] || palette.food
          const isActive = selectedOutlet?.id === o.id
          const icon = o.type === 'food' ? '🍳' : '🍺'
          return (
            <button
              key={o.id || `${o.type}:${o.name}`}
              onClick={() => setSelectedOutlet(o)}
              className={`flex-1 rounded-xl font-semibold transition-all ${touchMode ? 'min-h-[2.5rem] px-2.5 py-2 text-sm' : 'py-2 text-xs'} ${isActive ? c.active : c.idle}`}
            >
              {icon} {o.name}
            </button>
          )
        })}
      </div>
    )
  }

  const openCreateMenu = () => {
    if (offlineMode) return
    setEditingItem(null)
    setMenuForm({
      name: '', category: isKitchenOutlet ? 'Food' : 'Drinks', price: '', barcode: '',
      inventory_item_id: '', depletion_qty: '1',
      outlet_id: selectedOutlet?.id || '',
      dietary_flags: [], prep_time_minutes: 0, is_popular: false, kitchen_station_id: ''
    })
    setMenuError('')
    setMenuModal(true)
  }

  const openEditMenu = (item) => {
    if (offlineMode) return
    setEditingItem(item)
    setMenuForm({
      name: item.name,
      category: item.category,
      price: String(item.price),
      barcode: item.barcode || '',
      inventory_item_id: item.inventory_item_id || '',
      depletion_qty: item.depletion_qty != null ? String(item.depletion_qty) : '1',
      outlet_id: item.outlet_id || '',
      dietary_flags: Array.isArray(item.dietary_flags) ? item.dietary_flags : [],
      prep_time_minutes: item.prep_time_minutes || 0,
      is_popular: item.is_popular || false,
      kitchen_station_id: item.kitchen_station_id || ''
    })
    setMenuError('')
    setMenuModal(true)
  }

  const handleMenuSubmit = async (e) => {
    e.preventDefault()
    if (offlineMode) return
    setMenuError('')
    setMenuSaving(true)
    try {
      const payload = editingItem?.template_kind === 'bar_single'
        ? { barcode: menuForm.barcode }
        : {
            ...menuForm,
            price: parseFloat(menuForm.price),
            outlet_id: menuForm.outlet_id || null
          }
      if (editingItem) {
        ensurePosMutationSuccess(
          await window.api.pos.updateMenuItem(
            editingItem.id,
            editingItem.template_kind === 'bar_single'
              ? payload
              : { ...payload, is_available: editingItem.is_available }
          ),
          'Save failed. Please try again.'
        )
      } else {
        ensurePosMutationSuccess(
          await window.api.pos.createMenuItem(payload),
          'Save failed. Please try again.'
        )
      }
      setMenuModal(false)
      loadMenu()
    } catch (err) {
      setMenuError(err.message || 'Save failed. Please try again.')
    } finally {
      setMenuSaving(false)
    }
  }

  const toggleAvailable = async (item) => {
    if (offlineMode) return
    try {
      ensurePosMutationSuccess(
        await window.api.pos.updateMenuItem(item.id, { ...item, is_available: !item.is_available }),
        'Failed to update item.'
      )
      loadMenu()
    } catch (err) {
      alert(err.message || 'Failed to update item.')
    }
  }

  const deleteMenuItem = async (item) => {
    if (offlineMode) return
    if (!confirm(`Delete "${item.name}"?`)) return
    try {
      ensurePosMutationSuccess(
        await window.api.pos.deleteMenuItem(item.id),
        'Failed to delete item.'
      )
      loadMenu()
    } catch (err) {
      alert(err.message || 'Failed to delete item.')
    }
  }

  const toggleBarPackTemplate = async (inventoryItemId, packSize, enabled) => {
    if (offlineMode) return
    const key = `${inventoryItemId}:${packSize}`
    setBarTemplateSavingKey(key)
    try {
      ensurePosMutationSuccess(
        await window.api.pos.setBarPackTemplate({
          inventory_item_id: inventoryItemId,
          pack_size: packSize,
          enabled
        }),
        'Failed to update Bar pack template.'
      )
      loadMenu()
    } catch (err) {
      alert(err.message || 'Failed to update Bar pack template.')
    } finally {
      setBarTemplateSavingKey('')
    }
  }

  // Items visible in the terminal for the selected outlet.
  // Unassigned items (outlet_id = null) are always shown for backward compatibility.
  // Items assigned to a different outlet are hidden from the menu grid.
  const visibleMenuItems = useMemo(
    () => [...menuItems, ...fallbackBarMenuItems].filter((m) => matchesSelectedOutlet(m)),
    [menuItems, fallbackBarMenuItems, selectedOutlet]
  )

  const normalizedMenuSearch = menuSearch.trim().toLowerCase()
  const filteredVisibleMenuItems = useMemo(() => visibleMenuItems.filter((item) => {
    if (!normalizedMenuSearch) return true
    return (
      String(item.name || '').toLowerCase().includes(normalizedMenuSearch) ||
      String(item.barcode || '').toLowerCase().includes(normalizedMenuSearch)
    )
  }), [normalizedMenuSearch, visibleMenuItems])

  const menuByCategory = useMemo(() => MENU_CATEGORIES.reduce((acc, cat) => {
    acc[cat] = filteredVisibleMenuItems.filter((m) => m.category === cat && m.is_available !== false)
    return acc
  }, {}), [filteredVisibleMenuItems])
  const terminalCategoryTabs = useMemo(
    () => ['All', ...MENU_CATEGORIES.filter((cat) => (menuByCategory[cat] || []).length > 0)],
    [menuByCategory]
  )
  const visibleTerminalCategories = [activeTerminalCategory]
  const hasTerminalMenuData = filteredVisibleMenuItems.length > 0 || fallbackBarMenuItems.length > 0 || menuItems.length > 0
  const showInitialMenuLoading = menuLoading && !hasTerminalMenuData

  useEffect(() => {
    if (activeTerminalCategory === 'All') return
    if (!terminalCategoryTabs.includes(activeTerminalCategory)) {
      setActiveTerminalCategory('All')
    }
  }, [activeTerminalCategory, terminalCategoryTabs])

  useEffect(() => {
    setMenuDisplayLimit(POS_MENU_PAGE_SIZE)
  }, [activeTerminalCategory, normalizedMenuSearch, selectedOutlet?.id])

  // Returns the name of the outlet an item belongs to if it's different from selectedOutlet.
  // Used for cross-outlet blocking on tap and barcode scan.
  const getCrossOutletName = (item) => {
    if (!item.outlet_id || !selectedOutlet) return null
    if (selectedOutlet.id && item.outlet_id === selectedOutlet.id) return null
    if (!selectedOutlet.id && matchesSelectedOutlet(item)) return null
    return outlets.find((o) => o.id === item.outlet_id)?.name || 'another outlet'
  }

  function openVoidModal(order) {
    setVoidTarget(order)
    setVoidPin('')
    setVoidReason('')
    setVoidError('')
    setShowVoidPin(false)
    setVoidModal(true)
  }

  function closeVoidModal(force = false) {
    if (voidLoading && !force) return
    setVoidModal(false)
    setVoidTarget(null)
    setVoidPin('')
    setVoidReason('')
    setVoidError('')
    setShowVoidPin(false)
  }

  async function submitVoidApproval(e) {
    e.preventDefault()
    if (!voidTarget?.id) {
      setVoidError('Order not found')
      return
    }
    if (!voidPin.trim()) {
      setVoidError('PIN is required')
      return
    }
    if (!voidReason.trim()) {
      setVoidError('Reason is required')
      return
    }

    setVoidLoading(true)
    setVoidError('')
    try {
      const res = await window.api.pos.approveVoidWithPin({
        order_id: voidTarget.id,
        pin: voidPin.trim(),
        reason: voidReason.trim(),
        cashier_user_id: currentOperator.id || currentUser?.id || null,
        outlet_id: voidTarget.outlet_id || selectedOutlet?.id || null
      })

      if (res?.success) {
        const voidedAt = formatIsoTimestamp(new Date())
        setVoidHistory((prev) => [
          {
            id: res?.override_log_id || `local-void-${voidTarget.id}-${voidedAt}`,
            order_id: voidTarget.id,
            action: 'void',
            requested_by: currentUser?.id || null,
            approved_by: res?.approved_by || null,
            approver_name: res?.approver_name || null,
            reason: res?.reason || voidReason.trim(),
            outlet_id: voidTarget.outlet_id || selectedOutlet?.id || null,
            created_at: voidedAt,
            _pending_sync: res?.offline === true,
            _sync_state: res?.offline === true ? 'pending' : 'synced'
          },
          ...prev.filter((entry) => entry.order_id !== voidTarget.id)
        ])
        setOrders((prev) => prev.map((order) => (
          order.id === voidTarget.id
            ? res?.offline === true
              ? { ...order, _pending_void: true, _pending_sync: true, _sync_state: 'pending' }
              : { ...order, status: 'voided' }
            : order
        )))
        closeVoidModal(true)
        await refreshLivePosState({ includeOrders: true })
      } else {
        setVoidError(res?.error || 'Approval failed. Check PIN and try again.')
      }
    } catch {
      setVoidError('An error occurred. Please try again.')
    } finally {
      setVoidLoading(false)
    }
  }

  function openReturnModal(order) {
    const lines = Object.fromEntries((order.pos_order_items || [])
      .filter((line) => Number(line.quantity || 0) > 0 && Number(line.unit_price || 0) >= 0)
      .map((line) => [line.id, '']))
    setReturnTarget(order)
    setReturnLines(lines)
    setReturnPin('')
    setReturnReason('')
    setReturnPaymentMethod(order.payment_method === 'folio' ? 'folio' : recordedSingleTenderMethod(order))
    setReturnError('')
    setShowReturnPin(false)
    setReturnModal(true)
  }

  function closeReturnModal(force = false) {
    if (returnLoading && !force) return
    setReturnModal(false)
    setReturnTarget(null)
    setReturnLines({})
    setReturnPin('')
    setReturnReason('')
    setReturnError('')
    setShowReturnPin(false)
  }

  async function submitPartialReturn(e) {
    e.preventDefault()
    if (!returnTarget?.id) {
      setReturnError('Order not found')
      return
    }
    if (!returnPin.trim()) {
      setReturnError('PIN is required')
      return
    }
    if (!returnReason.trim()) {
      setReturnError('Reason is required')
      return
    }
    if (returnTarget.payment_method !== 'folio' && !returnPaymentMethod) {
      setReturnError('Choose the refund tender. The original order does not contain a single confirmed tender.')
      return
    }
    const selectedLines = Object.entries(returnLines)
      .map(([line_id, quantity]) => ({ line_id, quantity: Number(quantity || 0) }))
      .filter((line) => line.quantity > 0)
    if (selectedLines.length === 0) {
      setReturnError('Enter at least one quantity to return.')
      return
    }

    setReturnLoading(true)
    setReturnError('')
    try {
      const res = await window.api.pos.createPartialReturnWithPin({
        order_id: returnTarget.id,
        lines: selectedLines,
        pin: returnPin.trim(),
        reason: returnReason.trim(),
        payment_method: returnPaymentMethod,
        shift_id: currentShift?.id || null,
        cashier_user_id: currentOperator.id || currentUser?.id || null,
        outlet_id: returnTarget.outlet_id || selectedOutlet?.id || null
      })
      if (!res?.success) {
        setReturnError(res?.error || 'Could not record this return.')
        return
      }
      closeReturnModal(true)
      await refreshLivePosState({ includeOrders: true })
      if (tab === 'history') await loadOrders()
    } catch (err) {
      setReturnError(err?.message || 'Could not record this return.')
    } finally {
      setReturnLoading(false)
    }
  }

  const cashupMethodRows = useMemo(() => {
    const expected = cashupSummary?.by_method || {}
    const keys = new Set(CASHUP_CORE_METHODS)
    for (const [method, amount] of Object.entries(expected)) {
      if (Number(amount || 0) !== 0) keys.add(method)
    }
    return DESKTOP_PAYMENT_METHODS.filter((method) => keys.has(method.value))
  }, [cashupSummary])

  const setCashupCountedMethod = (method, value) => {
    setCashupCounted((current) => ({ ...current, [method]: value }))
  }

  const submitCashup = async (e) => {
    e.preventDefault()
    setCashupSaving(true)
    setCashupError('')
    try {
      const counted = Object.fromEntries(
        cashupMethodRows.map((method) => [method.value, Number(cashupCounted[method.value] || 0)])
      )
      const res = await window.api.pos.createCashup({
        shift_id: currentShift?.id || null,
        date: cashupDate,
        outlet_id: cashupOutletId || null,
        opening_float: Number(cashupOpeningFloat || 0),
        counted,
        notes: cashupNotes || null,
        cashier_id: currentOperator.id || null,
        cashier_name: currentOperator.name || null
      })
      if (!res?.success) {
        setCashupError(res?.error || 'Could not save cash-up.')
        return
      }
      setCashupNotes('')
      setCashupCounted({})
      await loadCashup()
    } catch (err) {
      setCashupError(err?.message || 'Could not save cash-up.')
    } finally {
      setCashupSaving(false)
    }
  }

  const setSplitPayment = (idx, patch) => {
    setPaymentSplits((rows) => rows.map((row, i) => i === idx ? { ...row, ...patch } : row))
  }

  const addSplitPayment = () => {
    setPaymentSplits((rows) => [...rows, { method: 'cash', amount: '', reference: '' }])
  }

  const removeSplitPayment = (idx) => {
    setPaymentSplits((rows) => rows.filter((_, i) => i !== idx))
  }

  const selectStaffForPos = async (staff) => {
    if (!staff?.id) return
    if (!staff.has_pin) {
      alert('This staff member needs an approval PIN set in Staff before POS selection.')
      return
    }
    const res = await window.api.pos.selectStaffWithPin?.({ staff_id: staff.id, pin: staffPin })
    if (!res?.success) {
      alert(res?.error || 'Could not select staff.')
      return
    }
    setSelectedPosStaff(res.staff)
    setPendingPosStaffId(res.staff?.id || '')
    setStaffPin('')
    setShowStaffLogin(false)
  }

  const selectWaiterForTable = async (staff) => {
    if (!staff?.id) return
    if (!staff.has_pin) {
      alert('This waiter needs a POS PIN set in Staff first.')
      return
    }
    const res = await window.api.pos.selectStaffWithPin?.({ staff_id: staff.id, pin: waiterPin })
    if (!res?.success) {
      alert(res?.error || 'Could not select waiter.')
      return
    }
    setSelectedWaiterStaff(res.staff)
    setPendingWaiterStaffId(res.staff?.id || '')
    setWaiterName(res.staff?.name || '')
    setWaiterPin('')
    setShowWaiterPicker(false)
  }

  const applyPromotion = (promotion) => {
    if (!promotion) return
    setAppliedPromotionId(promotion.id || null)
    setDiscountMode(promotion.discount_type === 'percent' ? 'percent' : 'amount')
    setDiscountValue(String(promotion.discount_value || ''))
    setDiscountReason(promotion.name || 'Promotion')
  }

  const openModifierEditor = useCallback((idx) => {
    const line = orderItems[idx]
    if (!line) return
    setModifierTargetIdx(idx)
    setModifierDraftNotes(line.item_notes || '')
  }, [orderItems])

  const toggleLineModifier = (option, group = null) => {
    if (modifierTargetIdx == null || !option?.name) return
    setOrderItems((rows) => rows.map((line, idx) => {
      if (idx !== modifierTargetIdx) return line
      const current = Array.isArray(line.modifiers) ? line.modifiers : []
      const exists = current.some((entry) => entry.name === option.name)
      const nextModifiers = exists ? current.filter((entry) => entry.name !== option.name) : [...current, option]
      if (group && Number(group.max_selections || 0) > 0) {
        const groupSelections = nextModifiers.filter((mod) =>
          (group.options || []).some((opt) => opt.name === mod.name)
        ).length
        if (groupSelections > Number(group.max_selections)) return line
      }
      const basePrice = Number(line.base_unit_price ?? line.unit_price ?? 0)
      const delta = nextModifiers.reduce((sum, entry) => sum + Number(entry.price_delta || 0), 0)
      return {
        ...line,
        base_unit_price: basePrice,
        modifiers: nextModifiers,
        unit_price: Math.round((basePrice + delta) * 100) / 100
      }
    }))
  }

  const saveLineInstructions = () => {
    if (modifierTargetIdx == null) return
    setOrderItems((rows) => rows.map((line, idx) => idx === modifierTargetIdx ? { ...line, item_notes: modifierDraftNotes.trim() || null } : line))
    setModifierTargetIdx(null)
    setModifierDraftNotes('')
  }

  const saveModifierGroup = async () => {
    const options = modifierForm.options.split('\n').map((line) => {
      const [name, price] = line.split('|')
      return { name: String(name || '').trim(), price_delta: Number(price || 0) }
    }).filter((option) => option.name)
    const appliesToCategories = modifierForm.applies_to_categories.split(',').map((c) => c.trim()).filter(Boolean)
    const res = await window.api.pos.saveModifierGroup?.({
      name: modifierForm.name,
      options,
      min_selections: modifierForm.min_selections ? Number(modifierForm.min_selections) : 0,
      max_selections: modifierForm.max_selections ? Number(modifierForm.max_selections) : 0,
      applies_to_categories: appliesToCategories
    })
    if (!res?.success) {
      alert(res?.error || 'Could not save modifier group.')
      return
    }
    setModifierForm({ name: '', options: '', min_selections: '', max_selections: '', applies_to_categories: '' })
    await loadPosOperations()
  }

  const savePromotion = async () => {
    const res = await window.api.pos.savePromotion?.(promotionForm)
    if (!res?.success) {
      alert(res?.error || 'Could not save promotion.')
      return
    }
    setPromotionForm({ name: '', discount_type: 'amount', discount_value: '', applies_to_category: 'All' })
    await loadPosOperations()
  }

  const addFloorArea = async () => {
    const name = floorAreaName.trim()
    if (!name) return
    const next = { areas: [...(floorLayout?.areas || []), { id: crypto.randomUUID(), name }] }
    const res = await window.api.pos.saveFloorLayout?.(next)
    if (!res?.success) {
      alert(res?.error || 'Could not save floor area.')
      return
    }
    setFloorAreaName('')
    setFloorLayout(res.layout || next)
  }

  const saveCurrentTab = async () => {
    if (orderItems.length === 0) return
    if (serviceMode === 'table') {
      if (!tableName.trim()) { alert('Select a table first.'); return }
      if (tableServiceMode === 'waiter' && !selectedWaiterStaff?.id && !waiterName.trim()) { alert('Select the waiter for this table.'); return }
    }
    const name = tableName.trim() || walkInName.trim() || `Tab ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    const res = await window.api.pos.saveTab?.({
      id: activeTabId || undefined,
      outlet_id: selectedOutlet?.id || null,
      table_name: serviceMode === 'table' ? tableName.trim() || null : null,
      service_mode: serviceMode,
      delivery_address: serviceMode === 'delivery' ? deliveryAddress.trim() || null : null,
      delivery_notes: serviceMode === 'delivery' ? deliveryNotes.trim() || null : null,
      tab_name: name,
      customer_name: walkInName.trim() || null,
      customer_id: selectedCustomerId || null,
      waiter_name: serviceMode === 'table' ? tableWaiterName || null : null,
      waiter_id: serviceMode === 'table' ? tableWaiterId || null : null,
      room_id: customerType === 'room' ? selectedRoom || null : null,
      items: orderItems,
      notes: orderNotes || null,
      status: serviceMode === 'table' ? 'running' : 'open'
    })
    if (res?.already_open && res?.tab) {
      alert(res.error || 'That table is already running. Loading it now.')
      loadSavedTab(res.tab)
      return
    }
    if (!res?.success) {
      alert(res?.error || 'Could not save tab.')
      return
    }
    setOrderItems([])
    setOrderNotes('')
    setWalkInName('')
    setActiveTabId('')
    await loadPosOperations()
  }

  const loadSavedTab = (savedTab) => {
    setActiveTabId(savedTab.id)
    setOrderItems(Array.isArray(savedTab.items) ? savedTab.items : [])
    setOrderNotes(savedTab.notes || '')
    setWalkInName(savedTab.customer_name || savedTab.tab_name || '')
    setWaiterName(savedTab.waiter_name || '')
    setSelectedWaiterStaff(null)
    setPendingWaiterStaffId('')
    setTableServiceMode(savedTab.waiter_name && savedTab.waiter_name !== currentOperator.name ? 'waiter' : 'operator')
    setTableName(savedTab.table_name || '')
    setServiceMode(savedTab.table_name ? 'table' : 'takeaway')
  }

  const selectTable = async (table) => {
    if (!table?.name) return
    const runningTab = table.tab || openTabs.find((row) =>
      String(row.table_name || '').trim().toLowerCase() === String(table.name || '').trim().toLowerCase() &&
      String(row.outlet_id || '') === String((table.outlet_id || selectedOutlet?.id || ''))
    )
    if (runningTab) {
      if (orderItems.length > 0 && activeTabId !== runningTab.id && !window.confirm('Load this running table and replace the current unsaved order on screen?')) return
      loadSavedTab(runningTab)
      return
    }
    if (orderItems.length > 0 && !window.confirm('Start this table and clear the current unsaved order on screen?')) return
    if (tableServiceMode === 'waiter' && !selectedWaiterStaff?.id && !waiterName.trim()) {
      setServiceMode('table')
      setTableName(table.name)
      alert('Select the waiter for this table.')
      return
    }
    setServiceMode('table')
    setCustomerType('walkin')
    setActiveTabId('')
    setTableName(table.name)
    setWalkInName(table.name)
    setOrderItems([])
    setOrderNotes('')
    const res = await window.api.pos.openTableSession?.({
      outlet_id: selectedOutlet?.id || table.outlet_id || null,
      table_name: table.name,
      tab_name: table.name,
      waiter_name: tableWaiterName || currentOperator.name || null,
      waiter_id: tableWaiterId,
      items: []
    })
    if (!res?.success) {
      alert(res?.error || 'Could not open table.')
      return
    }
    if (res.tab) loadSavedTab(res.tab)
    await loadPosOperations()
  }

  const runTableOverride = async (action) => {
    if (!currentOpenTab?.id) return
    let payload = { action, source_tab_id: currentOpenTab.id }
    if (action === 'transfer' || action === 'merge') {
      const target = window.prompt(action === 'transfer' ? 'Move this order to which table?' : 'Merge this order into which running table?')
      if (!target?.trim()) return
      payload.target_table_name = target.trim()
    }
    if (action === 'close') {
      const reason = window.prompt('Reason for closing this table?') || 'Manager override'
      payload.reason = reason
      if (!window.confirm('Close this table without completing an order?')) return
    }
    const res = await window.api.pos.overrideTableTab?.(payload)
    if (!res?.success) {
      alert(res?.error || 'Could not update this table.')
      return
    }
    if (res.tab) loadSavedTab(res.tab)
    if (action === 'close') {
      setOrderItems([])
      setOrderNotes('')
      setWalkInName('')
      setActiveTabId('')
      setTableName('')
      setServiceMode('takeaway')
    }
    await loadPosOperations()
  }

  const openSplitModal = () => {
    if (!currentOpenTab || currentOpenTabTotal === null) {
      alert('The server has not returned a confirmed tab total. Refresh the open check before splitting it.')
      return
    }
    setSplitItemIndices([])
    setSplitTargetTable('')
    setSplitMode('items')
    setSplitEvenCount(2)
    setSplitEvenNames([])
    setSplitError('')
    splitOperationIdRef.current = crypto.randomUUID()
    setSplitModal(true)
  }

  const toggleSplitItem = (idx) => {
    setSplitItemIndices((prev) => prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx])
  }

  const executeSplitBill = async () => {
    if (!currentOpenTab?.id || currentOpenTabTotal === null) {
      setSplitError('The server has not returned a confirmed tab total. Refresh the open check before splitting it.')
      return
    }
    if (splitMode === 'items' && splitItemIndices.length === 0) return
    if (splitMode === 'even' && (splitEvenCount < 2 || splitEvenCount > 10)) return
    setSplitLoading(true)
    setSplitError('')
    try {
      let res
      if (splitMode === 'even') {
        res = await window.api.pos.splitBillEvenly?.({
          source_tab_id: currentOpenTab.id,
          split_count: splitEvenCount,
          target_table_names: splitEvenNames.slice(0, splitEvenCount),
          idempotency_key: splitOperationIdRef.current
        })
      } else {
        res = await window.api.pos.splitBillByItems?.({
          source_tab_id: currentOpenTab.id,
          item_indices: splitItemIndices,
          target_table_name: splitTargetTable.trim() || null
        })
      }
      if (!res?.success) {
        setSplitError(res?.error || 'Could not split bill.')
        return
      }
      setSplitModal(false)
      splitOperationIdRef.current = null
      if (res.source_tab) loadSavedTab(res.source_tab)
      await loadPosOperations()
    } catch (err) {
      setSplitError(err.message || 'Could not split bill.')
    } finally {
      setSplitLoading(false)
    }
  }

  const submitDiscountApproval = async (e) => {
    e.preventDefault()
    if (!discountApprovalPin.trim()) return
    setDiscountApprovalLoading(true)
    setDiscountApprovalError('')
    try {
      const res = await window.api.pos.approveDiscountWithPin?.({
        pin: discountApprovalPin.trim(),
        discount_type: discountMode,
        discount_value: parsedDiscountValue,
        reason: discountReason.trim(),
        cashier_user_id: currentOperator.id || null,
        outlet_id: selectedOutlet?.id || null,
        order_total: orderSubtotal
      })
      if (!res?.success) {
        setDiscountApprovalError(res?.error || 'PIN verification failed.')
        return
      }
      setDiscountApprovalModal(false)
      setDiscountApprovalPin('')
      pendingDiscountApprovalRef.current = res
      completeOrder()
    } catch (err) {
      setDiscountApprovalError(err.message || 'Could not verify PIN.')
    } finally {
      setDiscountApprovalLoading(false)
    }
  }

  const pendingDiscountApprovalRef = useRef(null)

  const openShift = async () => {
    const res = await window.api.pos.openShift?.({
      outlet_id: selectedOutlet?.id || null,
      cashier_id: currentOperator.id || null,
      cashier_name: currentOperator.name || currentOperator.email || null,
      opening_float: Number(shiftFloat || 0)
    })
    if (!res?.success) {
      alert(res?.error || 'Could not open shift.')
      return
    }
    setShiftFloat('')
    await loadPosOperations()
  }

  const closeShift = async () => {
    setShiftCloseMessage('Close is pending server confirmation. Keep this shift open until the result is resolved.')
    const res = await window.api.pos.closeShift?.({
      shift_id: currentShift?.id || null,
      outlet_id: selectedOutlet?.id || null,
      cashier_id: currentOperator.id || null,
      cashier_name: currentOperator.name || currentOperator.email || null,
      closing_cash: Number(shiftCloseCash || 0)
    })
    if (!res?.success) {
      setShiftCloseMessage(res?.error || 'Could not close shift. The local shift remains open; retry the same close or ask a manager to reconcile it.')
      return
    }
    setShiftCloseMessage(res.already_closed ? 'The server had already finalized this shift. The local cache was reconciled from matching cash-up evidence.' : 'Shift closed and cash-up confirmed by the server.')
    setShiftCloseCash('')
    await loadPosOperations()
  }

  const setTicketStatus = async (ticket, status) => {
    const res = await window.api.pos.updateTicketStatus?.(ticket.id, status)
    if (!res?.success) alert(res?.error || 'Could not update ticket.')
    await loadPosOperations()
  }

  const saveHardware = async (patch = {}) => {
    const res = await window.api.pos.saveHardwareSettings?.({ ...(hardwareSettings || {}), ...patch })
    if (res?.success) {
      setHardwareSettings(res.settings || null)
      setHardwareMsg('POS hardware settings saved.')
    } else {
      setHardwareMsg(res?.error || 'Could not save hardware settings.')
    }
  }

  const testHardware = async (kind) => {
    const res = await window.api.pos.testHardware?.(kind)
    setHardwareMsg(res?.message || res?.error || 'Hardware test finished.')
  }

  const openDisplay = async (kind, options = {}) => {
    const targetDisplayId = displayTargets[kind] || ''
    const requestOptions = targetDisplayId ? { ...options, displayId: targetDisplayId } : options
    const res = await window.api.pos.openDisplay?.(kind, requestOptions)
    if (!res?.success) {
      setHardwareMsg(res?.error || 'Could not open POS display.')
      return
    }
    const target = systemDisplays.find((display) => display.id === targetDisplayId)
    const placement = target
      ? ` on ${target.label}${target.isPrimary ? ' (primary)' : ''}`
      : res.restored
        ? ' on the saved screen'
        : ''
    setHardwareMsg(`${kind === 'customer' ? 'Customer display' : kind === 'bar' ? 'Bar tickets' : 'Kitchen tickets'} opened${res.fullScreen ? ' in full screen' : ' in a separate window'}${placement}.`)
  }

  const renderDisplayTargetSelect = (kind) => (
    <select
      className="input mt-3"
      value={displayTargets[kind] || ''}
      onChange={(e) => setDisplayTargets((prev) => ({ ...prev, [kind]: e.target.value }))}
      aria-label={`Monitor for ${kind} POS display`}
    >
      <option value="">Remembered screen / system default</option>
      {systemDisplays.map((display) => (
        <option key={`${kind}-${display.id}`} value={display.id}>
          {display.label}{display.isPrimary ? ' (Primary)' : ''}
        </option>
      ))}
    </select>
  )

  const escposTargetConfigured = Boolean(
    hardwareSettings?.escpos_connection_type === 'network'
      ? hardwareSettings?.escpos_network_host || hardwareSettings?.escpos_printer_path
      : hardwareSettings?.escpos_printer_path
  )
  const hardwareReadiness = [
    {
      label: 'Receipts',
      value: hardwareSettings?.receipt_print_mode === 'escpos'
        ? escposTargetConfigured ? 'ESC/POS ready' : 'Needs ESC/POS target'
        : hardwareSettings?.receipt_printer_name ? 'Windows printer ready' : 'System default printer'
    },
    {
      label: 'Cash Drawer',
      value: hardwareSettings?.cash_drawer_enabled
        ? escposTargetConfigured ? 'Drawer pulse ready' : 'Needs ESC/POS target'
        : 'Disabled'
    },
    {
      label: 'Card Terminal',
      value: hardwareSettings?.payment_terminal_mode === 'manual'
        ? 'Manual mode'
        : hardwareSettings?.payment_terminal_provider && hardwareSettings?.payment_terminal_bridge_url
          ? 'Bridge ready'
          : 'Needs provider + bridge URL'
    },
    {
      label: 'Displays',
      value: systemDisplays.length ? `${systemDisplays.length} monitor${systemDisplays.length === 1 ? '' : 's'} detected` : 'System default'
    }
  ]

  const terminalShellClass = touchMode
    ? 'grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(29rem,0.58fr)] 2xl:grid-cols-[minmax(0,1fr)_minmax(31rem,0.53fr)]'
    : 'grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(25rem,0.47fr)] 2xl:grid-cols-[minmax(0,1fr)_minmax(28rem,0.44fr)]'
  const terminalLayoutClass = touchMode
    ? 'flex min-h-0 flex-1 flex-col gap-2 overflow-hidden'
    : 'flex min-h-0 flex-1 flex-col gap-2 overflow-hidden'
  const menuPanelClass = touchMode ? 'flex min-h-0 flex-col gap-2 overflow-hidden' : 'flex min-h-0 flex-col gap-2 overflow-hidden'
  const orderPanelClass = touchMode
    ? 'bb-card flex min-h-0 flex-col overflow-hidden p-2.5'
    : 'bb-card flex min-h-0 flex-col overflow-hidden p-2'
  const touchButtonClass = touchMode ? 'min-h-[2.4rem] rounded-xl text-sm' : 'rounded-xl text-xs'
  const touchInputClass = touchMode ? 'min-h-[2.35rem] text-sm' : 'min-h-[2.25rem] text-sm'
  const touchItemGridClass = touchMode ? 'grid grid-cols-3 gap-2 xl:grid-cols-4 2xl:grid-cols-5' : 'grid grid-cols-3 gap-1.5 xl:grid-cols-4 2xl:grid-cols-6'
  const touchItemCardClass = touchMode
    ? 'bb-card min-h-[5rem] p-2 text-left transition-all active:scale-[0.99]'
    : 'bb-card min-h-[4.25rem] p-2 text-left transition-all'
  const qtyButtonClass = touchMode
    ? 'flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-sm font-bold text-slate-700 active:scale-[0.98]'
    : 'flex h-6 w-6 items-center justify-center rounded bg-slate-100 text-sm font-bold text-slate-600 hover:bg-red-50 hover:text-red-600'
  const qtyButtonPlusClass = touchMode
    ? 'flex h-7 w-7 items-center justify-center rounded-lg bg-green-50 text-sm font-bold text-green-700 active:scale-[0.98]'
    : 'flex h-6 w-6 items-center justify-center rounded bg-slate-100 text-sm font-bold text-slate-600 hover:bg-green-50 hover:text-green-600'
  const showCategoryRail = showInitialMenuLoading || outletsLoading || terminalCategoryTabs.length > 1
  const orderItemCount = orderItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
  const openNativeKeyboard = useCallback(async () => {
    try {
      await window.api?.app?.showTouchKeyboard?.()
    } catch {
      // Best-effort only.
    }
  }, [])

  return (
    <div className={tab === 'terminal'
      ? 'mx-auto flex h-[calc(100vh-2rem)] max-w-none flex-col gap-2 overflow-hidden'
      : 'mx-auto flex max-w-none flex-col gap-2'
    }>
      <div className="bb-card flex shrink-0 flex-col gap-2 p-2">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700/70">POS Terminal</p>
              <h1 className="text-base font-semibold text-slate-900">Point of Sale</h1>
            </div>
            <div className={`rounded-xl border px-2 py-1 text-xs shadow-sm ${
              offlineMode
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}>
              <p className="font-semibold">{offlineMode ? 'Offline POS mode' : 'POS synced and live'}</p>
              <p className="hidden text-[11px] opacity-80 md:block">
                {offlineMode ? 'Stock and remote payment confirmation may be delayed.' : 'Stock and sales are updating from the latest synced state.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="bb-card flex gap-1 p-0.5">
              {[
                ['desktop', 'Desktop'],
                ['touch', 'Touch']
              ].map(([mode, label]) => {
                const active = (mode === 'touch') === touchMode
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setTouchMode(mode === 'touch')}
                    className={`rounded-lg px-3 py-1 text-xs font-semibold transition-all ${
                      active
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            <div className="bb-card flex gap-1 p-0.5">
              {[
                ['terminal', 'Terminal'],
                ...(canManageMenu ? [['menu', 'Menu Items']] : []),
                ...(canManageMenu ? [['history', 'History']] : []),
                ...(canCloseCashup ? [['cashup', 'Cash-Up']] : []),
                ['tickets', 'Tickets'],
                ...(canManageMenu ? [['setup', 'Setup']] : [])
              ].map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => setTab(v)}
                  className={`rounded-xl transition-all ${
                    touchMode ? 'min-h-[2.4rem] px-3 py-1.5 text-sm' : 'px-3 py-1 text-xs'
                  } ${
                    tab === v
                      ? 'bg-gradient-to-b from-green-500 to-green-700 text-white shadow-[0_10px_24px_rgba(22,101,52,0.2)]'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Terminal ── */}
      {tab === 'terminal' && !canManagePos && (
        <div className="bb-card flex min-h-[420px] items-center justify-center p-6 text-center">
          <div className="max-w-md">
            <ShoppingCart size={36} className="mx-auto mb-3 text-slate-300" />
            <h2 className="text-lg font-semibold text-slate-900">POS operator access required</h2>
            <p className="mt-2 text-sm text-slate-500">
              This account can view POS information, but it cannot create orders or manage tabs. Ask a manager to assign the POS Operator role.
            </p>
          </div>
        </div>
      )}

      {tab === 'terminal' && canManagePos && (
        <div className={terminalShellClass}>
          {/* Menu items panel */}
          <div className={menuPanelClass}>

            {/* ── Outlet selector ── */}
            {renderOutletSelector()}

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-600">
              <span className="font-semibold text-slate-700">{currentOperator.name || 'Operator'}</span>
              <span>{currentShift ? 'Shift open' : 'No shift open'}</span>
              <span>{orderItems.length > 0 ? `${orderItemCount} item${orderItemCount === 1 ? '' : 's'} · ${currency} ${fmt(orderTotal)}` : 'Ready for next order'}</span>
            </div>

            {offlineMode && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Offline mode: POS is using the last synced menu. Stock may be estimated, and new orders will sync automatically when internet returns.
              </div>
            )}

            {walkInPaymentNeedsVerification && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 shadow-sm">
                Offline caution: {formatPaymentMethod(paymentMethod)} payments for walk-ins are not remotely verified right now. Confirm proof or switch to cash before completing the order.
              </div>
            )}

            {/* Barcode scanner feedback banner */}
            {barcodeFlash && (
              <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium ${
                barcodeFlash.found
                  ? 'bg-green-100 text-green-800'
                  : 'bg-red-100 text-red-700'
              }`}>
                <Scan size={16} />
                {barcodeFlash.found
                  ? `✓ Scanned: ${barcodeFlash.name} added to order`
                  : barcodeFlash.wrongOutlet
                  ? `✗ "${barcodeFlash.name}" belongs to ${barcodeFlash.wrongOutlet}. Switch outlets to add it.`
                  : offlineMode
                  ? `✗ Barcode "${barcodeFlash.name}" not found in the last synced menu`
                  : `✗ Barcode "${barcodeFlash.name}" not found in menu`}
              </div>
            )}

            <div className="bb-card relative shrink-0 overflow-visible p-2">
              {menuRefreshing && hasTerminalMenuData && (
                <div className="pointer-events-none absolute right-4 top-4 z-10">
                  <div className="rounded-full border border-emerald-200 bg-white/95 px-3 py-1.5 text-xs font-medium text-emerald-700 shadow-sm backdrop-blur">
                    Refreshing menu and stock...
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-800">Products</p>
                  <p className="hidden text-[11px] text-slate-500 sm:block">Search by name or barcode.</p>
                </div>
                <div className="flex w-full gap-2 sm:max-w-md">
                  <input
                    ref={menuSearchInputRef}
                    type="text"
                    className="input w-full"
                    placeholder="Search products or barcode..."
                    value={menuSearch}
                    onChange={(e) => setMenuSearch(e.target.value)}
                  />
                  {touchMode && (
                    <button
                      type="button"
                      onClick={openNativeKeyboard}
                      className="inline-flex min-h-[2.35rem] shrink-0 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                      title="Open touch keyboard"
                    >
                      <Keyboard size={16} />
                      <span className="hidden sm:inline">Keyboard</span>
                    </button>
                  )}
                </div>
              </div>
              {showCategoryRail && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {(showInitialMenuLoading || outletsLoading ? ['All', 'Food', 'Drinks', 'Other'] : terminalCategoryTabs).map((category) => {
                    const active = activeTerminalCategory === category
                    return (
                      <button
                        key={category}
                        type="button"
                        onClick={() => {
                          if (showInitialMenuLoading || outletsLoading) return
                          setActiveTerminalCategory(category)
                        }}
                        disabled={showInitialMenuLoading || outletsLoading}
                        className={`min-h-[2.3rem] rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                          active
                            ? 'bg-slate-900 text-white shadow-sm'
                            : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        } ${showInitialMenuLoading || outletsLoading ? 'opacity-60' : ''}`}
                      >
                        {category}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className={terminalLayoutClass}>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {showInitialMenuLoading ? (
                  <div className={`bb-empty-state ${touchMode ? 'min-h-[220px]' : 'min-h-[160px]'}`}>
                    <p className="text-sm font-medium text-slate-500">Loading menu…</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* ── Favourites Quick Tiles ── */}
                    <POSFavouritesBar
                      favouriteItems={favouriteItems}
                      currency={currency}
                      fmt={fmt}
                      touchMode={touchMode}
                      touchItemCardClass={touchItemCardClass}
                      getCrossOutletName={getCrossOutletName}
                      getInventoryAvailableUnits={getInventoryAvailableUnits}
                      inventoryById={inventoryById}
                      isOrderableMenuItem={isOrderableMenuItem}
                      onAdd={addToOrder}
                      onToggleFavourite={toggleFavourite}
                    />
                    {visibleTerminalCategories.map((cat) => {
                      const allItems = cat === 'All'
                        ? MENU_CATEGORIES.flatMap((category) => menuByCategory[category] || [])
                        : menuByCategory[cat]
                      const items = allItems.slice(0, menuDisplayLimit)
                      if (items.length === 0) return null
                      return (
                      <div key={cat} className="bb-card p-2">
                          <div className="mb-1.5 flex items-center justify-between">
                            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{cat === 'All' ? 'All Products' : cat}</h3>
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                              {allItems.length > items.length ? `Showing ${items.length} of ${allItems.length}` : `${items.length} item${items.length === 1 ? '' : 's'}`}
                            </span>
                          </div>
                          <div className={touchItemGridClass}>
                            {items.map((item) => (
                              <POSTerminalProductCard
                                key={item.id}
                                item={item}
                                currency={currency}
                                fmt={fmt}
                                touchMode={touchMode}
                                touchItemCardClass={touchItemCardClass}
                                soldOut={!isOrderableMenuItem(item, inventoryById)}
                                crossOutlet={getCrossOutletName(item)}
                                availableUnits={getInventoryAvailableUnits(inventoryById, item.inventory_item_id, item.depletion_qty)}
                                isFav={isFavourite(item.id)}
                                isPopular={item.is_popular === true}
                                dietaryFlags={Array.isArray(item.dietary_flags) ? item.dietary_flags : []}
                                prepTime={Number(item.prep_time_minutes || 0)}
                                onAdd={addToOrder}
                                onToggleFavourite={toggleFavourite}
                              />
                            ))}
                          </div>
                          {allItems.length > items.length && (
                            <button
                              type="button"
                              onClick={() => setMenuDisplayLimit((current) => current + POS_MENU_PAGE_SIZE)}
                              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              Show {Math.min(POS_MENU_PAGE_SIZE, allItems.length - items.length)} more products
                            </button>
                          )}
                        </div>
                      )
                    })}
                    {filteredVisibleMenuItems.filter((m) => m.is_available !== false).length === 0 && !menuLoading && !outletsLoading && (
                      <div className="bb-empty-state min-h-[160px]">
                        <ShoppingCart size={28} className="mx-auto mb-2 opacity-30" />
                        <p className="text-sm font-semibold text-slate-800">
                          {normalizedMenuSearch ? 'No matching products' : 'No menu items yet'}
                        </p>
                        <p className="text-xs text-slate-500">
                          {normalizedMenuSearch
                            ? 'Try a different name, barcode, or switch outlets.'
                            : 'Go to Menu Items to add products before taking orders.'}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Barcode scanner hint */}
              {menuItems.some((m) => m.barcode && m.is_available) && (
                  <p className="flex items-center gap-1 text-xs text-slate-400">
                  <Scan size={12} /> Barcode scanner ready — click outside inputs and scan
                </p>
              )}
              {!touchMode && (
                <p className="flex items-center gap-1 text-xs text-slate-400">
                  Press <kbd className="rounded border border-slate-200 bg-white px-1 text-[10px] font-mono">?</kbd> for keyboard shortcuts
                </p>
              )}
            </div>
          </div>

          {/* Order panel */}
            <div className={orderPanelClass}>
            <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2">
              <h2 className={`flex items-center gap-2 font-semibold text-slate-700 ${touchMode ? 'text-base' : 'text-sm'}`}>
                <ShoppingCart size={touchMode ? 18 : 16} /> Current Order
              </h2>
              <div className="flex items-center gap-1.5">
                {orderItems.length >= POS_COMPACT_CART_THRESHOLD && (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                    Compact
                  </span>
                )}
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-800">
                  {orderItemCount} item{orderItemCount === 1 ? '' : 's'}
                </span>
              </div>
            </div>
            <div className="mb-1.5 shrink-0">
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                onClick={() => setShowStaffLogin((current) => !current)}
              >
                <span>{currentOperator?.name ? `Operator: ${currentOperator.name}` : 'Operator: logged-in user'}</span>
                <span className="text-slate-400">{showStaffLogin ? 'Hide' : 'Change'}</span>
              </button>
              {showStaffLogin && (
                <div className="mt-1.5 grid grid-cols-[1fr_4.5rem_auto] gap-1.5">
                  <select
                    className={`input ${touchInputClass}`}
                    value={pendingPosStaffId || selectedPosStaff?.id || ''}
                    onChange={(e) => {
                      setPendingPosStaffId(e.target.value)
                      if (!e.target.value) setSelectedPosStaff(null)
                    }}
                  >
                    <option value="">{selectedPosStaff?.name || 'Select operator...'}</option>
                    {posStaff.map((staff) => (
                      <option key={staff.id} value={staff.id}>{staff.name}{staff.has_pin ? '' : ' (no PIN)'}</option>
                    ))}
                  </select>
                  <input
                    className={`input ${touchInputClass}`}
                    value={staffPin}
                    onChange={(e) => setStaffPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="PIN"
                    type="password"
                    inputMode="numeric"
                  />
                  <button
                    type="button"
                    className="rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white"
                    onClick={() => selectStaffForPos(posStaff.find((row) => row.id === (pendingPosStaffId || selectedPosStaff?.id)))}
                  >
                    Verify
                  </button>
                </div>
              )}
            </div>
            {touchMode && (
              <div className="mb-1.5 shrink-0 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700/75">Live Summary</p>
                    <p className="mt-0.5 text-lg font-bold text-emerald-950">{currency} {fmt(orderTotal)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700/75">Items</p>
                    <p className="mt-0.5 text-lg font-bold text-emerald-950">{orderItemCount}</p>
                  </div>
                </div>
                <p className="mt-1 text-[11px] text-emerald-800">
                  {customerType === 'room'
                    ? 'Charges will be staged against the selected room folio.'
                    : customerType === 'event'
                      ? 'Charges will be staged against the selected event folio.'
                    : `${formatPaymentMethod(paymentMethod)} will be used for this walk-in sale.`}
                </p>
              </div>
            )}

            {/* Customer type */}
            <div className={`mb-1.5 flex shrink-0 overflow-hidden rounded-xl border border-slate-200 ${touchMode ? 'text-sm' : 'text-xs'}`}>
              <button
                onClick={() => setCustomerType('walkin')}
                className={`flex-1 transition-colors ${touchMode ? 'py-2' : 'py-1.5'} ${customerType === 'walkin' ? 'bg-green-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                Walk-in
              </button>
              {!restaurantMode && (
                <>
                  <button
                    onClick={() => setCustomerType('room')}
                    className={`flex-1 transition-colors ${touchMode ? 'py-2' : 'py-1.5'} ${customerType === 'room' ? 'bg-green-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                  >
                    Charge to Room
                  </button>
                  <button
                    onClick={() => setCustomerType('event')}
                    className={`flex-1 transition-colors ${touchMode ? 'py-2' : 'py-1.5'} ${customerType === 'event' ? 'bg-green-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                  >
                    Event Folio
                  </button>
                </>
              )}
            </div>

            {!restaurantMode && customerType === 'room' ? (
                <select
                className={`input mb-1.5 shrink-0 ${touchInputClass}`}
                value={selectedRoom}
                onChange={(e) => setSelectedRoom(e.target.value)}
              >
                <option value="">Select room...</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    Room {r.room_number} — {r.room_type}
                  </option>
                ))}
              </select>
            ) : !restaurantMode && customerType === 'event' ? (
                <select
                className={`input mb-1.5 shrink-0 ${touchInputClass}`}
                value={selectedEventId}
                onChange={(e) => setSelectedEventId(e.target.value)}
              >
                <option value="">Select event...</option>
                {activeEvents.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.event_name || 'Event'} — {ev.booking_date} ({ev.event_type || 'event'})
                  </option>
                ))}
              </select>
            ) : (
              <>
                {restaurantMode && posCustomers.length > 0 && (
                  <div className="mb-1.5 shrink-0">
                    <select
                      className={`input ${touchInputClass}`}
                      value={selectedCustomerId}
                      onChange={(e) => {
                        const cid = e.target.value
                        setSelectedCustomerId(cid)
                        const found = posCustomers.find((c) => c.id === cid)
                        setSelectedCustomer(found || null)
                        if (found) setWalkInName(found.name)
                      }}
                    >
                      <option value="">Walk-in customer (no account)</option>
                      {posCustomers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} {c.loyalty_points > 0 ? `(${c.loyalty_points} pts)` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="mb-1.5 shrink-0">
                  <div className={`grid grid-cols-1 gap-2 ${touchMode ? 'sm:grid-cols-[minmax(0,1fr)_11rem_auto]' : 'sm:grid-cols-[minmax(0,1fr)_11rem]'}`}>
                  <input
                    type="text"
                    className={`input ${touchInputClass}`}
                    placeholder={restaurantMode ? "Customer name (optional)..." : "Guest name (optional)..."}
                    value={walkInName}
                    onChange={(e) => setWalkInName(e.target.value)}
                  />
                  <select
                    className={`input ${touchInputClass}`}
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                  >
                    {DESKTOP_PAYMENT_METHODS.map((method) => (
                      <option key={method.value} value={method.value}>{method.label}</option>
                    ))}
                  </select>
                  {touchMode && (
                    <button
                      type="button"
                      onClick={openNativeKeyboard}
                      className="inline-flex min-h-[2.35rem] items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                      title="Open touch keyboard"
                    >
                      <Keyboard size={16} />
                      <span className="hidden lg:inline">Keyboard</span>
                    </button>
                  )}
                  </div>
                  {paymentMethod === 'bank_transfer' && (
                    <p className="mt-1 text-xs text-slate-500">
                      Bank transfer payments must include proof of payment before completion.
                    </p>
                  )}
                  {paymentMethod !== 'cash' && !splitPaymentsEnabled && showPaymentDetails && (
                    <>
                      <input
                        className="input mt-1.5 text-xs"
                        value={paymentReference}
                        onChange={(e) => setPaymentReference(e.target.value)}
                        placeholder="Payment reference, slip no. or approval code"
                      />
                      {paymentMethod === 'card' && (
                        <button
                          type="button"
                          className="mt-1.5 w-full rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700"
                          onClick={async () => {
                            const res = await window.api.pos.sendPaymentTerminalTotal?.({ amount: orderTotal, reference: activeTabId || tableName || null })
                            if (res?.success) {
                              const nextReference = res.approval_code || res.reference || ''
                              if (nextReference) setPaymentReference(nextReference)
                            }
                            alert(res?.message || res?.error || 'Payment terminal request finished.')
                          }}
                        >
                          Send Total to Card Machine
                        </button>
                      )}
                    </>
                  )}
                  {restaurantMode && selectedCustomer && (
                    <div className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2">
                      <p className="text-xs font-semibold text-amber-800">
                        {selectedCustomer.name} — {selectedCustomer.loyalty_points || 0} loyalty pts
                      </p>
                      <p className="text-xs text-amber-700">
                        {orderTotal > 0 ? `Earn ~${Math.floor(orderTotal / 10)} pts with this order` : ''}
                      </p>
                    </div>
                  )}
                  {restaurantMode && !selectedCustomer && (
                    <div className="mt-1.5">
                      <div className="flex gap-2">
                        <input
                          className="input flex-1 text-xs"
                          placeholder="Voucher code"
                          value={voucherCode}
                          onChange={(e) => setVoucherCode(e.target.value.toUpperCase())}
                        />
                        <input
                          className="input w-24 text-xs"
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="Amount"
                          value={voucherAmount}
                          onChange={(e) => setVoucherAmount(e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className={`mb-1.5 grid shrink-0 ${restaurantMode ? 'grid-cols-4' : 'grid-cols-3'} gap-1.5`}>
              {(restaurantMode ? ['takeaway', 'table', 'delivery'] : ['takeaway', 'table', 'room']).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setServiceMode(mode)
                    if (mode === 'room') setCustomerType('room')
                    if (mode !== 'room') setCustomerType('walkin')
                  }}
                  className={`rounded-lg px-2 py-1.5 text-xs font-semibold ${serviceMode === mode ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
                >
                  {mode === 'takeaway' ? 'Quick' : mode === 'table' ? 'Table' : mode === 'delivery' ? 'Delivery' : 'Room'}
                </button>
              ))}
            </div>

            {serviceMode === 'delivery' && restaurantMode && (
              <div className="mb-1.5 shrink-0 space-y-1.5 rounded-xl border border-blue-200 bg-blue-50 p-2">
                <input
                  type="text"
                  className={`input text-xs`}
                  placeholder="Delivery address..."
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                />
                <input
                  type="text"
                  className={`input text-xs`}
                  placeholder="Delivery notes (optional)..."
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                />
              </div>
            )}

            {restaurantMode && selectedCustomer && selectedCustomer.account_balance > 0 && (
              <div className="mb-1.5 shrink-0">
                <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={customerAccountCharge}
                    onChange={(e) => setCustomerAccountCharge(e.target.checked)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="font-semibold text-slate-700">Charge to account</span>
                  <span className="ml-auto text-slate-500">
                    Balance: {currency} {fmt(selectedCustomer.account_balance)}
                  </span>
                </label>
              </div>
            )}

            {serviceMode === 'table' && (
              <div className="mb-1.5 shrink-0 space-y-2">
                <div className="rounded-xl border border-slate-200 bg-white p-2">
                  <div className="grid grid-cols-2 gap-1.5 text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => {
                        setTableServiceMode('operator')
                        setSelectedWaiterStaff(null)
                        setPendingWaiterStaffId('')
                        setWaiterName(currentOperator.name || '')
                      }}
                      className={`rounded-lg px-2 py-1.5 ${tableServiceMode === 'operator' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
                    >
                      Operator serves
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTableServiceMode('waiter')
                        setShowWaiterPicker((current) => !current)
                      }}
                      className={`rounded-lg px-2 py-1.5 ${tableServiceMode === 'waiter' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
                    >
                      Separate waiter
                    </button>
                  </div>
                  <button
                    type="button"
                    className="mt-1.5 flex w-full items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700"
                    onClick={() => tableServiceMode === 'waiter' && setShowWaiterPicker((current) => !current)}
                  >
                    <span>Served by: {tableWaiterName || (tableServiceMode === 'waiter' ? 'Select waiter' : currentOperator.name)}</span>
                    {tableServiceMode === 'waiter' && <span className="text-slate-400">{showWaiterPicker ? 'Hide' : 'Change'}</span>}
                  </button>
                  {tableServiceMode === 'waiter' && showWaiterPicker && (
                    <div className="mt-1.5 grid grid-cols-[1fr_4.5rem_auto] gap-1.5">
                      <select
                        className={`input ${touchInputClass}`}
                        value={pendingWaiterStaffId || selectedWaiterStaff?.id || ''}
                        onChange={(e) => {
                          setPendingWaiterStaffId(e.target.value)
                          if (!e.target.value) {
                            setSelectedWaiterStaff(null)
                            setWaiterName('')
                          }
                        }}
                      >
                        <option value="">{selectedWaiterStaff?.name || 'Select waiter...'}</option>
                        {posStaff.map((staff) => (
                          <option key={staff.id} value={staff.id}>{staff.name}{staff.has_pin ? '' : ' (no PIN)'}</option>
                        ))}
                      </select>
                      <input
                        className={`input ${touchInputClass}`}
                        value={waiterPin}
                        onChange={(e) => setWaiterPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="PIN"
                        type="password"
                        inputMode="numeric"
                      />
                      <button
                        type="button"
                        className="rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white"
                        onClick={() => selectWaiterForTable(posStaff.find((row) => row.id === (pendingWaiterStaffId || selectedWaiterStaff?.id)))}
                      >
                        Verify
                      </button>
                    </div>
                  )}
                </div>
                <div className="mb-1.5 flex items-center justify-between text-[0.68rem] text-slate-500">
                  <span>{visibleTables.length} table(s) · {visibleTables.filter((t) => t.status === 'available' || !t.tab).length} available</span>
                  <span>{visibleTables.filter((t) => t.tab && t.status !== 'available').length} active</span>
                </div>
                <div className="grid max-h-40 grid-cols-2 gap-1.5 overflow-y-auto pr-1">
                  {visibleTables.map((table) => {
                    const status = normalizeTableStatus(table.status || table.tab?.status)
                    const selected = tableName === table.name
                    const tab = table.tab
                    const elapsed = tab?.created_at ? formatElapsed(tab.created_at) : null
                    const itemCount = Array.isArray(tab?.items) ? tab.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0) : 0
                    return (
                      <button
                        key={table.id}
                        type="button"
                        onClick={() => selectTable(table)}
                        className={`min-h-[3.5rem] rounded-lg border px-2 py-1.5 text-left text-xs font-semibold transition ${getTableStatusClasses(status)} ${selected ? 'ring-2 ring-slate-900/20' : ''}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="block truncate">{table.name}</span>
                          {table.seats > 0 && <span className="text-[0.6rem] opacity-60">{table.seats}p</span>}
                        </div>
                        <span className="mt-0.5 block text-[0.68rem] uppercase tracking-wide opacity-75">
                          {status === 'available' ? 'Available' : status === 'ready' ? 'Ready' : status === 'delivered' ? 'Delivered' : 'Running'}
                        </span>
                        {tab && (
                          <div className="mt-0.5 flex items-center gap-1 text-[0.6rem] opacity-60">
                            {elapsed && <span>{elapsed}</span>}
                            {itemCount > 0 && <span>· {itemCount} item(s)</span>}
                          </div>
                        )}
                      </button>
                    )
                  })}
                  {visibleTables.length === 0 && (
                    <div className="col-span-2 rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
                      No tables set up for this outlet.
                    </div>
                  )}
                </div>
              </div>
            )}

            {openTabs.length > 0 && (
              <div className="mb-1.5 flex shrink-0 gap-1.5 overflow-x-auto pb-1">
                {openTabs.slice(0, 8).map((savedTab) => (
                  <button
                    key={savedTab.id}
                    type="button"
                    onClick={() => loadSavedTab(savedTab)}
                    className={`shrink-0 rounded-lg border px-2 py-1 text-xs font-semibold ${activeTabId === savedTab.id ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-600'}`}
                  >
                    {savedTab.table_name || savedTab.tab_name || 'Open tab'}
                    {savedTab.table_name && (
                      <span className="ml-1 font-normal opacity-70">· {normalizeTableStatus(savedTab.status) === 'available' ? 'Running' : normalizeTableStatus(savedTab.status)}</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {currentOpenTab?.table_name && (
              <div className="mb-1.5 rounded-xl border border-slate-200 bg-white p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-800">{currentOpenTab.table_name} · {normalizeTableStatus(currentOpenTab.status) === 'available' ? 'Running' : normalizeTableStatus(currentOpenTab.status)}</p>
                    <p className="text-slate-500">Served by: {currentOpenTab.waiter_name || tableWaiterName || currentOperator.name || 'Not set'}</p>
                  </div>
                  <button type="button" className="rounded-lg bg-slate-100 px-2 py-1 font-semibold text-slate-700" onClick={() => setShowManagerControls((current) => !current)}>
                    Manager
                  </button>
                </div>
                {showManagerControls && (
                  <div className="mt-2 grid grid-cols-5 gap-1.5">
                    <button type="button" className="rounded-lg bg-violet-100 px-2 py-1 font-semibold text-violet-700" onClick={() => runTableOverride('deliver')}>Delivered</button>
                    <button type="button" className="rounded-lg bg-slate-100 px-2 py-1 font-semibold text-slate-700" onClick={() => runTableOverride('transfer')}>Transfer</button>
                    <button type="button" className="rounded-lg bg-slate-100 px-2 py-1 font-semibold text-slate-700" onClick={() => runTableOverride('merge')}>Merge</button>
                    <button type="button" className="rounded-lg bg-amber-50 px-2 py-1 font-semibold text-amber-700" onClick={openSplitModal}>Split</button>
                    <button type="button" className="rounded-lg bg-red-50 px-2 py-1 font-semibold text-red-700" onClick={() => runTableOverride('close')}>Close</button>
                  </div>
                )}
              </div>
            )}

            {/* Order items */}
            <div className="mb-1.5 min-h-[4rem] flex-1 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/45 p-1.5">
              {orderItems.length === 0 ? (
                <div className="bb-card-muted py-3 text-center">
                <p className="text-xs text-slate-500">
                  {touchMode ? 'Tap products on the left to build the order' : 'Tap items or scan barcodes to add them'}
                </p>
                </div>
              ) : (
                <div className="space-y-2">
                {orderItems.map((item, idx) => (
                  <POSTerminalCartLine
                    key={item.order_key}
                    item={item}
                    idx={idx}
                    currency={currency}
                    fmt={fmt}
                    touchMode={touchMode}
                    qtyButtonClass={qtyButtonClass}
                    qtyButtonPlusClass={qtyButtonPlusClass}
                    isSelected={idx === selectedLineIdx}
                    totalLines={orderItems.length}
                    onIncrement={incrementQty}
                    onDecrement={decrementQty}
                    onSetQty={setQty}
                    onOpenModifiers={openModifierEditor}
                    onSelect={setSelectedLineIdx}
                  />
                ))}
                </div>
              )}
            </div>

            {orderStockIssues.length > 0 && (
              <div className="mb-1.5 shrink-0 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
                <p className="font-semibold">Stock changed on another terminal</p>
                <p className="mt-1">
                  {orderStockIssues[0].itemName} now has only {fmt(orderStockIssues[0].availableStock)} stock unit(s) available,
                  but this order needs {fmt(orderStockIssues[0].requiredStock)}.
                </p>
              </div>
            )}

            {orderItems.length > 0 && (
              <div className="shrink-0 sticky bottom-0 bg-white/95 backdrop-blur-sm border-t border-slate-100 pt-1.5 -mx-2 px-2 pb-1">
                <textarea
                  className={`input mb-1.5 shrink-0 resize-none ${touchMode ? 'text-sm' : 'text-xs'}`}
                  rows={touchMode ? 2 : 1}
                  placeholder="Notes (optional)..."
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                />
                <button
                  type="button"
                  className="mb-1.5 flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                  onClick={() => setShowPaymentDetails((current) => !current)}
                >
                  <span>Payment details</span>
                  <span className="text-slate-400">
                    {showPaymentDetails ? 'Hide' : [
                      orderDiscountAmount > 0 ? `Discount ${currency}${fmt(orderDiscountAmount)}` : null,
                      orderTipTotal > 0 ? `Tip ${currency}${fmt(orderTipTotal)}` : null,
                      splitPaymentsEnabled ? 'Split' : null,
                      paymentReference ? 'Reference set' : null
                    ].filter(Boolean).join(' · ') || 'Add tip, discount, split, reference'}
                  </span>
                </button>
                {showPaymentDetails && canDiscount && (
                  <div className="mb-1.5 rounded-xl border border-emerald-100 bg-emerald-50/60 p-2">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1 text-xs font-semibold text-emerald-800">
                        <BadgePercent size={13} /> Discount
                      </p>
                      {orderDiscountAmount > 0 && (
                        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          -{currency} {fmt(orderDiscountAmount)}
                        </span>
                      )}
                    </div>
                    {promotions.filter((promo) => promo.active !== false).length > 0 && (
                      <div className="mb-1.5 flex gap-1 overflow-x-auto pb-1">
                        {promotions.filter((promo) => promo.active !== false).slice(0, 6).map((promo) => (
                          <button
                            key={promo.id}
                            type="button"
                            onClick={() => applyPromotion(promo)}
                            className="shrink-0 rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-emerald-700"
                          >
                            {promo.name}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
                      <select
                        className="input text-xs"
                        value={discountMode}
                        onChange={(e) => {
                          setAppliedPromotionId(null)
                          setDiscountMode(e.target.value)
                        }}
                      >
                        <option value="amount">{currency}</option>
                        <option value="percent">%</option>
                      </select>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="input text-xs"
                        value={discountValue}
                        onChange={(e) => {
                          setAppliedPromotionId(null)
                          setDiscountValue(e.target.value)
                        }}
                        placeholder={discountMode === 'percent' ? 'Percent' : 'Amount'}
                      />
                    </div>
                    {Number(discountValue || 0) > 0 && (
                      <input
                        type="text"
                        className="input mt-2 text-xs"
                        value={discountReason}
                        onChange={(e) => {
                          setAppliedPromotionId(null)
                          setDiscountReason(e.target.value)
                        }}
                        placeholder="Reason, e.g. manager special"
                      />
                    )}
                  </div>
                )}
                {showPaymentDetails && (
                <div className="mb-1.5 rounded-xl border border-slate-100 bg-white p-2">
                  <div className="grid grid-cols-2 gap-2">
                    {settings?.vat_enabled === true && (
                      <>
                        <p className="text-xs font-semibold text-slate-700">Tax/VAT</p>
                        <p className="rounded-lg bg-slate-50 px-3 py-2 text-right text-xs font-semibold text-slate-700">{Number(taxRate || 0)}%</p>
                      </>
                    )}
                    <label className="text-xs font-semibold text-slate-700">Tip</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="input text-xs"
                      value={tipAmount}
                      onChange={(e) => setTipAmount(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  {customerType !== 'room' && (
                    <div className="mt-2">
                      <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                        <input type="checkbox" checked={splitPaymentsEnabled} onChange={(e) => setSplitPaymentsEnabled(e.target.checked)} />
                        Split payment
                      </label>
                      {splitPaymentsEnabled && (
                        <div className="mt-2 space-y-2">
                          {paymentSplits.map((row, idx) => (
                            <div key={idx} className="grid grid-cols-[1fr_5.5rem_auto] gap-1.5">
                              <select className="input text-xs" value={row.method} onChange={(e) => setSplitPayment(idx, { method: e.target.value })}>
                                {DESKTOP_PAYMENT_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
                              </select>
                              <input className="input text-right text-xs" type="number" step="0.01" min="0" value={row.amount} onChange={(e) => setSplitPayment(idx, { amount: e.target.value })} placeholder="0.00" />
                              <button type="button" className="rounded-lg bg-slate-100 px-2 text-xs font-semibold text-slate-600" onClick={() => removeSplitPayment(idx)} disabled={paymentSplits.length === 1}>×</button>
                              {row.method !== 'cash' && (
                                <input className="input col-span-3 text-xs" value={row.reference || ''} onChange={(e) => setSplitPayment(idx, { reference: e.target.value })} placeholder="Reference, slip no. or approval code" />
                              )}
                            </div>
                          ))}
                          <div className="flex items-center justify-between text-xs">
                            <button type="button" className="font-semibold text-emerald-700" onClick={addSplitPayment}>Add method</button>
                            <span className={Math.abs(splitBalance) < 0.005 ? 'font-semibold text-emerald-700' : 'font-semibold text-red-700'}>
                              Balance {currency} {fmt(splitBalance)}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                )}
                <div className="mb-1.5 shrink-0 border-t border-slate-100 pt-1.5 text-sm">
                  <div className="mb-1 flex justify-between text-xs text-slate-500">
                    <span>Gross</span>
                    <span>{currency} {fmt(orderSubtotal)}</span>
                  </div>
                  {orderDiscountAmount > 0 && (
                      <div className="mb-1 flex justify-between text-xs font-semibold text-emerald-700">
                        <span>Discount</span>
                        <span>-{currency} {fmt(orderDiscountAmount)}</span>
                      </div>
                  )}
                  {orderTaxTotal > 0 && (
                    <div className="mb-1 flex justify-between text-xs text-slate-500">
                      <span>Tax</span>
                      <span>{currency} {fmt(orderTaxTotal)}</span>
                    </div>
                  )}
                  {orderTipTotal > 0 && (
                    <div className="mb-1 flex justify-between text-xs text-slate-500">
                      <span>Tip</span>
                      <span>{currency} {fmt(orderTipTotal)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-slate-800">
                    <span>Total</span>
                    <span>{currency} {fmt(orderTotal)}</span>
                  </div>
                  {customerType === 'room' && selectedRoom ? (
                    offlineMode ? (
                        <div className="mt-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
                        <p className="font-semibold">Offline folio charge</p>
                        <p className="mt-1">
                          This room charge is only being staged on this machine for now. It will reach the guest folio after sync succeeds when internet returns.
                        </p>
                        <p className="mt-1 text-amber-800/80">
                          Do not promise the guest that the folio is updated on other terminals until sync clears.
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-green-600 mt-1">
                        Will be added to room booking folio
                      </p>
                    )
                  ) : customerType === 'event' && selectedEventId ? (
                    offlineMode ? (
                      <div className="mt-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
                        <p className="font-semibold">Offline event folio charge</p>
                        <p className="mt-1">
                          This event charge is only being staged on this machine for now. It will reach the event folio after sync succeeds when internet returns.
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-green-600 mt-1">
                        Will be added to event folio
                      </p>
                    )
                  ) : customerType === 'walkin' && (
                    <p className="text-xs text-blue-600 mt-1">
                      {formatPaymentMethod(paymentMethod)} selected
                    </p>
                  )}
                  {offlineMode && (
                    <p className="mt-1 text-xs text-amber-700">
                      This order will be saved now and synced automatically when internet returns.
                    </p>
                  )}
                  {walkInPaymentNeedsVerification && (
                    <p className="mt-1 text-xs font-semibold text-red-700">
                      Treat this as unverified payment until internet is back or proof is confirmed manually.
                    </p>
                  )}
                </div>
                <div className={touchMode ? 'grid shrink-0 grid-cols-2 gap-2' : 'flex shrink-0 gap-2'}>
                  <button
                    onClick={() => setOrderItems([])}
                    disabled={submitting}
                    className={`btn-secondary flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed ${touchMode ? 'min-h-[2.5rem] text-sm' : ''}`}
                  >
                    <X size={14} /> Clear
                  </button>
                  <button
                    onClick={saveCurrentTab}
                    disabled={submitting || orderItems.length === 0}
                    className={`btn-secondary flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed ${touchMode ? 'min-h-[2.5rem] text-sm' : ''}`}
                  >
                    Save Tab
                  </button>
                  <button
                    onClick={completeOrder}
                    disabled={submitting || orderStockIssues.length > 0}
                    className={`btn-primary ${touchMode ? 'min-h-[2.5rem] text-sm' : ''}`}
                  >
                    {submitting ? 'Processing...' : 'Complete & New Order'}
                  </button>
                </div>
              </div>
            )}

            {orderSuccess && (
              <div className="mt-2 rounded-xl bg-green-50 p-2 text-center text-xs text-green-700">
                ✅ Order completed successfully
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Menu Management ── */}
      {tab === 'menu' && (
        <div className="flex flex-col gap-4">
          {renderOutletSelector()}

          {isKitchenOutlet && (
            <>
              <div className="flex items-center justify-between rounded-2xl border border-orange-100 bg-orange-50/70 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-orange-900">Kitchen menu stays manual</p>
                  <p className="text-xs text-orange-700">Add cooked items like burgers, fries, and steaks directly here. Inventory links stay optional.</p>
                </div>
                <button
                  onClick={openCreateMenu}
                  disabled={menuMutationsDisabled}
                  title={offlineMode ? 'Requires internet connection' : undefined}
                  className="btn-primary flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Plus size={16} /> Add Menu Item
                </button>
              </div>
              <div className="bb-table-shell">
                <HorizontalScrollArea>
                  <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                    <tr>
                      <th className="px-5 py-3 text-left">Item</th>
                      <th className="px-5 py-3 text-left">Category</th>
                      <th className="px-5 py-3 text-left">Barcode</th>
                      <th className="px-5 py-3 text-left">Stock Link</th>
                      <th className="px-5 py-3 text-right">Price</th>
                      <th className="px-5 py-3 text-center">Available</th>
                      <th className="px-5 py-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedManualMenuItems.map((item) => {
                      const linkedInv = item.inventory_item_id
                        ? inventoryItems.find((i) => i.id === item.inventory_item_id)
                        : null
                      return (
                        <tr key={item.id} className={`hover:bg-slate-50 ${!item.is_available ? 'opacity-50' : ''}`}>
                          <td className="px-5 py-3 font-medium text-slate-800">{item.name}</td>
                          <td className="px-5 py-3">
                            <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                              {item.category}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-xs font-mono text-slate-500">
                            {item.barcode || <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-5 py-3">
                            {linkedInv ? (
                              <span className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700">
                                📦 {linkedInv.name} ×{item.depletion_qty || 1}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-right font-semibold text-slate-800">
                            {currency} {fmt(item.price)}
                          </td>
                          <td className="px-5 py-3 text-center">
                            <button
                              onClick={() => toggleAvailable(item)}
                              disabled={menuMutationsDisabled}
                              title={offlineMode ? 'Requires internet connection' : undefined}
                              className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${item.is_available ? 'bg-green-500' : 'bg-slate-300'}`}
                            >
                              <span className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${item.is_available ? 'translate-x-4' : 'translate-x-0.5'}`} />
                            </button>
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => openEditMenu(item)}
                                disabled={menuMutationsDisabled}
                                title={offlineMode ? 'Requires internet connection' : undefined}
                                className="rounded-lg p-1.5 text-blue-500 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                onClick={() => deleteMenuItem(item)}
                                disabled={menuMutationsDisabled}
                                title={offlineMode ? 'Requires internet connection' : undefined}
                                className="rounded-lg p-1.5 text-red-400 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {selectedManualMenuItems.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-5 py-12">
                          <div className="bb-empty-state py-10">
                            <p className="text-base font-semibold text-slate-800">No Kitchen menu items yet</p>
                            <p className="text-sm text-slate-500">Add your first Kitchen item to start taking food orders.</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                  </table>
                </HorizontalScrollArea>
              </div>
            </>
          )}

          {isBarOutlet && (
            <div className="flex flex-col gap-4">
              <div className="rounded-2xl border border-blue-100 bg-blue-50/80 px-4 py-4">
                <p className="text-sm font-semibold text-blue-950">Bar POS is inventory-backed</p>
                <p className="mt-1 text-sm text-blue-800">
                  Bottle items come from Bar inventory automatically. Enable 6-pack, 12-pack, and case templates here for faster operator sales.
                </p>
              </div>

              {selectedBarInventoryItems.length === 0 ? (
                <div className="bb-empty-state min-h-[220px]">
                  <p className="text-base font-semibold text-slate-800">No Bar inventory products yet</p>
                  <p className="text-sm text-slate-500">Create inventory items for the Bar and give them a selling price to make the bottle item appear in POS.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {selectedBarInventoryItems.map((inventoryItem) => {
                    const singleItem = [...menuItems, ...fallbackBarMenuItems].find(
                      (item) =>
                        item.inventory_item_id === inventoryItem.id &&
                        (item.template_kind === 'bar_single' || item.template_kind === 'bar_single_virtual')
                    )
                    const packRows = Object.fromEntries(
                      BAR_PACK_TEMPLATES.map(({ size }) => [
                        size,
                        menuItems.find(
                          (item) =>
                            item.inventory_item_id === inventoryItem.id &&
                            item.template_kind === 'bar_pack' &&
                            Number(item.template_pack_size) === size
                        ) || null
                      ])
                    )
                    return (
                      <div key={inventoryItem.id} className="bb-card p-4">
                        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                          <div>
                            <p className="text-base font-semibold text-slate-900">{inventoryItem.name}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                              <p className="text-sm text-slate-500">
                                Bottle: <span className="font-semibold text-slate-800">{currency} {fmt(inventoryItem.selling_price)}</span>
                              </p>
                              <p className="text-xs text-slate-500">
                                Stock: {inventoryItem.current_stock} {inventoryItem.unit}
                              </p>
                            </div>
                          </div>
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${singleItem ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-amber-200 bg-amber-50 text-amber-700'}`}>
                            {singleItem ? 'Bottle live' : 'Bottle syncing'}
                          </span>
                        </div>

                        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="text-sm font-semibold text-slate-800">Bottle barcode</p>
                              <p className="text-xs text-slate-500">Scan bottles only. Packs stay barcode-free.</p>
                            </div>
                            {singleItem && !singleItem._virtual_inventory_item ? (
                              <button
                                onClick={() => openEditMenu(singleItem)}
                                disabled={menuMutationsDisabled}
                                title={offlineMode ? 'Requires internet connection' : undefined}
                                className="btn-secondary min-h-[2.75rem] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Edit Barcode
                              </button>
                            ) : singleItem?._virtual_inventory_item ? (
                              <span className="text-xs text-emerald-600">Ready from inventory pricing</span>
                            ) : (
                              <span className="text-xs text-slate-400">Available after bottle sync</span>
                            )}
                          </div>
                          <p className="mt-2 text-xs font-mono text-slate-500">{singleItem?.barcode || 'No barcode set'}</p>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-3">
                          {BAR_PACK_TEMPLATES.map(({ size, label }) => {
                            const packItem = packRows[size]
                            const saving = barTemplateSavingKey === `${inventoryItem.id}:${size}`
                            return (
                              <div key={size} className="rounded-2xl border border-slate-200 bg-white p-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-semibold text-slate-800">{label}</p>
                                    <p className="mt-0.5 text-sm text-slate-500">{currency} {fmt(Number(inventoryItem.selling_price || 0) * size)}</p>
                                  </div>
                                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${packItem ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                                    {packItem ? 'On' : 'Off'}
                                  </span>
                                </div>
                                <p className="mt-1 text-[11px] text-slate-400">Uses {size} bottles</p>
                                <button
                                  onClick={() => toggleBarPackTemplate(inventoryItem.id, size, !packItem)}
                                  disabled={saving || !singleItem || menuMutationsDisabled}
                                  title={offlineMode ? 'Requires internet connection' : undefined}
                                  className={`mt-2 min-h-[2.75rem] w-full rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${packItem ? 'bg-blue-600 text-white hover:bg-blue-700' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'} disabled:cursor-not-allowed disabled:opacity-60`}
                                >
                                  {saving ? 'Saving...' : packItem ? 'Disable' : 'Enable'}
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── History ── */}
      {tab === 'history' && (
        <div className="flex flex-col gap-5">
      <div className="bb-filter-bar mb-5 flex-wrap justify-between">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="text-slate-500">From</label>
              <input type="date" className="input text-sm" value={histStart} onChange={(e) => setHistStart(e.target.value)} />
              <label className="text-slate-500">To</label>
              <input type="date" className="input text-sm" value={histEnd} onChange={(e) => setHistEnd(e.target.value)} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => exportPosHistory('excel')}
                        disabled={historyExporting !== '' || !orderReadCompleteness.complete || !orderReadCompleteness.tenderComplete}
                className="btn-secondary text-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FileSpreadsheet size={14} /> {historyExporting === 'excel' ? 'Exporting...' : 'Excel'}
              </button>
              <button
                type="button"
                onClick={() => exportPosHistory('pdf')}
                disabled={historyExporting !== '' || !orderReadCompleteness.complete || !orderReadCompleteness.tenderComplete}
                className="btn-secondary text-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FileDown size={14} /> {historyExporting === 'pdf' ? 'Saving...' : 'PDF'}
              </button>
            </div>
          </div>
          {historyExportMsg && (
            <div className={`rounded-xl px-4 py-3 text-sm ${/could not|failed|error/i.test(historyExportMsg) ? 'border border-red-200 bg-red-50 text-red-700' : 'border border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
              {historyExportMsg}
            </div>
          )}
          {voidHistory.length > 0 && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{voidHistory.length} voided order{voidHistory.length === 1 ? '' : 's'} in this period</p>
                  <p className="mt-1 text-red-800/85">Open any voided row below to see the approval trail and reason.</p>
                </div>
                <div className="rounded-xl border border-red-300 bg-white/80 px-3 py-2 text-xs font-semibold text-red-800">
                  Review voids daily
                </div>
              </div>
            </div>
          )}
          <div className="bb-table-shell">
            {ordersError ? (
              <div className="bb-empty-state min-h-[220px]">
                <p className="text-base font-semibold text-red-700">Could not load orders</p>
                <p className="text-sm text-slate-500">{ordersError}</p>
              </div>
            ) : orders.length === 0 ? (
              <div className="bb-empty-state min-h-[220px]">
                <p className="text-base font-semibold text-slate-800">No orders in this period</p>
                <p className="text-sm text-slate-500">Complete a POS order to populate history.</p>
              </div>
            ) : (
              <HorizontalScrollArea>
                <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                  <tr>
                    <th className="px-5 py-3 text-left">Time</th>
                    <th className="px-5 py-3 text-left">Customer</th>
                    <th className="px-5 py-3 text-left">Outlet</th>
                    <th className="px-5 py-3 text-left">Payment</th>
                    <th className="px-5 py-3 text-left">Status</th>
                    <th className="px-5 py-3 text-right">Total</th>
                    <th className="px-5 py-3 text-center">Items</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orders.map((o) => {
                    const syncState = normalizeOrderSyncState(o)
                    const syncError = typeof o._sync_error === 'string' ? o._sync_error.trim() : ''
                    const voidEntry = voidHistory.find((entry) => entry.order_id === o.id)
                    return (
                    <Fragment key={o.id}>
                      <tr
                        className={`cursor-pointer hover:bg-slate-50 ${o.status === 'voided' ? 'opacity-50' : ''}`}
                        onClick={() => setExpandedOrder(expandedOrder === o.id ? null : o.id)}
                      >
                        <td className="whitespace-nowrap px-5 py-3 text-slate-600">
                          {new Date(o.created_at).toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-slate-800">
                          {o.walk_in_name
                            ? o.walk_in_name
                            : o.room_id
                            ? (restaurantMode ? 'Customer' : 'Room Guest')
                            : '—'}
                        </td>
                        <td className="px-5 py-3">
                          {o.outlets?.name ? (
                            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                              {o.outlets.name === 'Kitchen' ? '🍳' : o.outlets.name === 'Bar' ? '🍺' : '🏨'} {o.outlets.name}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <span className="text-xs text-slate-600">{historyTenderLabel(o)}</span>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                              o.status === 'completed' ? 'bg-green-100 text-green-700' :
                              o.status === 'voided' ? 'bg-red-100 text-red-600' :
                              'bg-yellow-100 text-yellow-700'
                            }`}>{o.status}</span>
                            {syncState === 'failed' && (
                              <span
                                className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 cursor-help"
                                title={o._sync_error || 'Sync failed'}
                              >
                                Failed Sync
                              </span>
                            )}
                            {syncState === 'needs_attention' && (
                              <span
                                className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 cursor-help"
                                title={o._sync_error || 'Manual review required'}
                              >
                                Needs Attention
                              </span>
                            )}
                            {syncState === 'pending' && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                                Pending Sync
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right font-semibold text-slate-800">
                          {orderReadCompleteness.complete && Number.isFinite(Number(o.total)) ? `${currency} ${fmt(o.total)}` : 'Unavailable'}
                        </td>
                        <td className="px-5 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                              {(o.pos_order_items || o.items || []).length}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setShowReceiptOrder(o)
                              }}
                              className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                              title="Print Receipt"
                            >
                              <Printer size={15} />
                            </button>
                            {expandedOrder === o.id ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                          </div>
                        </td>
                      </tr>
                      {expandedOrder === o.id && (
                        <tr>
                        <td colSpan={7} className="border-b border-slate-100 bg-slate-50 px-5 py-3">
                          <div className="bb-card-muted overflow-hidden">
                          <table className="w-full text-xs">
                              <thead>
                                <tr className="text-slate-400">
                                  <th className="text-left py-1 pr-4">Item</th>
                                  <th className="text-center py-1 pr-4">Qty</th>
                                  <th className="text-right py-1 pr-4">Unit Price</th>
                                  <th className="text-right py-1">Subtotal</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(o.pos_order_items || []).map((li) => (
                                  <tr key={li.id} className="border-t border-slate-100">
                                    <td className="py-1 pr-4 text-slate-700">{li.item_name}</td>
                                    <td className="py-1 pr-4 text-center text-slate-600">{li.quantity}</td>
                                    <td className="py-1 pr-4 text-right text-slate-600">{currency} {fmt(li.unit_price)}</td>
                                    <td className="py-1 text-right font-medium text-slate-800">{currency} {fmt(li.subtotal)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            </div>
                            {o.notes && (
                              <p className="mt-2 border-t border-slate-100 pt-2 text-xs italic text-slate-500">
                                📝 {o.notes}
                              </p>
                            )}
                            {syncState === 'failed' && syncError && (
                              <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                                <p className="font-semibold">Failed Sync</p>
                                <p className="mt-1">{sanitizePosError(syncError)}</p>
                                <p className="mt-1 text-red-600 font-medium">Retry from System Health</p>
                              </div>
                            )}
                            {syncState === 'needs_attention' && syncError && (
                              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                <p className="font-semibold">Needs Attention</p>
                                <p className="mt-1">{sanitizePosError(syncError)}</p>
                                <p className="mt-1 text-amber-700 font-medium tracking-tight">Open System Health to resolve this issue</p>
                              </div>
                            )}
                            {o.status === 'voided' && (
                              <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                                <p className="font-semibold">Void record</p>
                                <p className="mt-1">
                                  Approved by: {voidEntry?.approver_name || o._void_approver_name || (voidEntry?.approved_by || o._void_approved_by ? 'PIN-approved approver' : 'Awaiting sync record')}
                                  {voidEntry?.created_at ? ` · ${new Date(voidEntry.created_at).toLocaleString()}` : ''}
                                </p>
                                <p className="mt-1">
                                  Reason: {voidEntry?.reason || o._void_reason || 'Awaiting sync record'}
                                </p>
                              </div>
                            )}
                            {o.status !== 'voided' && (
                              (syncState === 'needs_attention' || syncState === 'failed') ? (
                                <p className="mt-2 text-xs text-amber-700">
                                  Resolve this POS sync issue in System Health before voiding.
                                </p>
                              ) : (
                                <div className="mt-2 flex flex-wrap gap-3">
                                  {Number(o.total || 0) > 0 && (
                                    <button
                                      onClick={() => openReturnModal(o)}
                                      className="text-xs text-blue-600 hover:text-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                      Partial Return
                                    </button>
                                  )}
                                  {canVoid ? (
                                    <button
                                      onClick={() => openVoidModal(o)}
                                      className="text-xs text-red-500 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                      Void Order
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => openVoidModal(o)}
                                      className="text-xs text-amber-600 hover:text-amber-800 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                      Request Void Approval
                                    </button>
                                  )}
                                </div>
                              )
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                    )
                  })}
                </tbody>
                </table>
              </HorizontalScrollArea>
            )}
          </div>
        </div>
      )}

      {/* ── Cash-Up ── */}
      {tab === 'cashup' && (
        <div className="grid gap-5 xl:grid-cols-[0.58fr_0.42fr]">
          <div className="bb-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                  <Calculator size={17} /> Close Cash-Up
                </h2>
                <p className="mt-1 text-sm text-slate-500">Compare {currentOperator.name}'s expected totals with what was counted at the till.</p>
              </div>
              <button onClick={loadCashup} disabled={cashupLoading} className="btn-secondary text-sm">
                <RefreshCw size={14} /> Refresh
              </button>
            </div>

            {cashupError && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {cashupError}
              </div>
            )}

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">Date</label>
                <input type="date" className="input" value={cashupDate} onChange={(e) => setCashupDate(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">Outlet</label>
                <select className="input" value={cashupOutletId} onChange={(e) => setCashupOutletId(e.target.value)}>
                  <option value="">All outlets</option>
                  {visibleOutlets.map((outlet) => (
                    <option key={outlet.id} value={outlet.id}>{outlet.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">Opening Float</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input"
                  value={cashupOpeningFloat}
                  onChange={(e) => setCashupOpeningFloat(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <span className="font-semibold text-slate-900">Operator:</span> {currentOperator.name}
              <span className="ml-2 text-slate-400">Only this operator's POS payments are included.</span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              {[
                ['Orders', cashupSummary?.complete === false ? 'Unavailable' : (cashupSummary?.orders_count || 0)],
                ['Voids', cashupSummary?.complete === false ? 'Unavailable' : (cashupSummary?.void_count || 0)],
                ['Returns', cashupSummary?.complete === false ? 'Unavailable' : `${currency} ${fmt(cashupSummary?.returns_total || 0)}`],
                ['Net Sales', cashupSummary?.complete === false ? 'Unavailable' : `${currency} ${fmt(cashupSummary?.net_sales || 0)}`]
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-50 px-3 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</p>
                  <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
                </div>
              ))}
            </div>

            {cashupSummary?.complete === false && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Financial expectations are unavailable until the server confirms every sale and recorded tender in this cash-up. You may still enter the physical count; finalization remains server-controlled.
              </div>
            )}

            {cashupSummary?.pending_count > 0 && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                {cashupSummary.pending_count} order{cashupSummary.pending_count === 1 ? '' : 's'} in this cash-up period are still waiting to sync.
              </div>
            )}

            <form onSubmit={submitCashup} className="mt-5 space-y-4">
              <div className="bb-table-shell">
                <HorizontalScrollArea>
                  <table className="min-w-[760px] w-full text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                      <tr>
                        <th className="px-4 py-3 text-left">Method</th>
                        <th className="px-4 py-3 text-right">Expected</th>
                        <th className="px-4 py-3 text-right">Counted</th>
                        <th className="px-4 py-3 text-right">Variance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {cashupMethodRows.map((method) => {
                        const expected = cashupSummary?.complete === false
                          ? null
                          : method.value === 'cash'
                            ? Number(cashupSummary?.expected_cash_drawer || 0)
                            : Number(cashupSummary?.by_method?.[method.value] || 0)
                        const counted = Number(cashupCounted[method.value] || 0)
                        const variance = expected === null ? null : counted - expected
                        return (
                          <tr key={method.value} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-medium text-slate-800">
                              {formatPaymentMethod(method.value, { plain: true })}
                              {method.value === 'cash' && (
                                <p className="mt-0.5 text-xs text-slate-400">Includes opening float</p>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-700">{expected === null ? 'Unavailable' : `${currency} ${fmt(expected)}`}</td>
                            <td className="px-4 py-3 text-right">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                className="input ml-auto w-32 text-right"
                                value={cashupCounted[method.value] || ''}
                                onChange={(e) => setCashupCountedMethod(method.value, e.target.value)}
                                placeholder="0.00"
                              />
                            </td>
                            <td className={`px-4 py-3 text-right font-semibold ${variance === null ? 'text-slate-500' : Math.abs(variance) < 0.005 ? 'text-slate-500' : variance > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                              {variance === null ? 'Unavailable' : `${currency} ${fmt(variance)}`}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </HorizontalScrollArea>
              </div>

              <textarea
                className="input h-20 resize-none"
                value={cashupNotes}
                onChange={(e) => setCashupNotes(e.target.value)}
                placeholder="Notes, e.g. cash short reason or card slip batch number"
              />
              <div className="flex flex-wrap justify-end gap-3">
                <button type="button" onClick={() => setCashupCounted({})} className="btn-secondary">
                  Clear Counts
                </button>
                <button type="submit" disabled={cashupSaving || cashupLoading} className="btn-primary">
                  {cashupSaving ? 'Saving...' : offlineMode ? 'Save Offline Cash-Up' : 'Close Cash-Up'}
                </button>
              </div>
            </form>
          </div>

          <div className="bb-card p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                  <ReceiptText size={17} /> Recent Cash-Ups
                </h2>
                <p className="mt-1 text-sm text-slate-500">Saved closes from this device and server.</p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {cashupHistory.map((row) => (
                <div key={row.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">{row.date}</p>
                      <p className="mt-1 text-xs text-slate-500">{row.outlet_name || outlets.find((outlet) => outlet.id === row.outlet_id)?.name || 'All outlets'}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-600">{row.cashier_name || row.created_by_name || 'Operator not recorded'}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      Math.abs(Number(row.cash_over_short || 0)) < 0.005 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {currency} {fmt(row.cash_over_short || 0)}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-white px-3 py-2">
                      <p className="text-slate-400">Net sales</p>
                      <p className="font-semibold text-slate-800">{currency} {fmt(row.net_sales || 0)}</p>
                    </div>
                    <div className="rounded-lg bg-white px-3 py-2">
                      <p className="text-slate-400">Orders</p>
                      <p className="font-semibold text-slate-800">{row.orders_count || 0}</p>
                    </div>
                  </div>
                  {row._pending_sync && (
                    <p className="mt-2 text-xs font-semibold text-amber-700">Pending sync</p>
                  )}
                </div>
              ))}
              {cashupHistory.length === 0 && (
                <div className="bb-empty-state min-h-[220px]">
                  <ReceiptText size={28} className="mx-auto mb-2 opacity-30" />
                  <p className="text-base font-semibold text-slate-800">No cash-ups saved yet</p>
                  <p className="text-sm text-slate-500">Close today’s till to start a daily trail.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'tickets' && (
        <div className="grid gap-4 lg:grid-cols-2">
          {(kitchenStations.length > 0 ? kitchenStations.filter((s) => s.enabled !== false).map((s) => s.station_key || s.id) : ['kitchen', 'bar']).map((station) => (
            <div key={station} className="bb-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold capitalize text-slate-900">{station} Tickets</h2>
                  <p className="mt-1 text-sm text-slate-500">Orders waiting for preparation.</p>
                </div>
                <button className="btn-secondary text-sm" onClick={loadPosOperations}><RefreshCw size={14} /> Refresh</button>
              </div>
              <div className="space-y-3">
                {tickets.filter((ticket) => ticket.station === station && ticket.status !== 'served' && ticket.status !== 'cancelled').map((ticket) => (
                  <div key={ticket.id} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{ticket.table_name || ticket.tab_name || (ticket.room_id ? (restaurantMode ? 'POS order' : 'Room order') : 'POS order')}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {new Date(ticket.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Running {formatElapsed(ticket.created_at, ticketClock)}
                        </p>
                        {ticket.waiter_name && <p className="mt-1 text-xs font-semibold text-slate-600">Served by: {ticket.waiter_name}</p>}
                      </div>
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">{ticket.status}</span>
                    </div>
                    <div className="mt-3 space-y-1 text-sm">
                      {(ticket.items || []).map((item, idx) => (
                        <div key={idx} className="rounded-lg bg-slate-50 px-3 py-2">
                          <div className="flex justify-between gap-3">
                          <span className="font-medium text-slate-800">{item.item_name}</span>
                          <span className="text-slate-500">x{item.quantity}</span>
                          </div>
                          {(item.modifiers?.length > 0 || item.item_notes) && (
                            <p className="mt-1 text-xs font-semibold text-amber-700">
                              {[...(item.modifiers || []).map((mod) => mod.name), item.item_notes].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                    {ticket.notes && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{ticket.notes}</p>}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {['preparing', 'ready', 'served', 'cancelled'].map((status) => (
                        <button key={status} type="button" className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold capitalize text-slate-700" onClick={() => setTicketStatus(ticket, status)}>
                          {status === 'served' ? 'Delivered / Close' : status}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {tickets.filter((ticket) => ticket.station === station && ticket.status !== 'served' && ticket.status !== 'cancelled').length === 0 && (
                  <div className="bb-empty-state min-h-[180px]"><p className="text-sm text-slate-500">No open {station} tickets.</p></div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'setup' && (
        <>
        {restaurantMode && (
          <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            <p className="font-semibold">POS setup is for device configuration.</p>
            <p className="mt-1">Use the restaurant workspaces in the sidebar for menu, stock, team, cash, control, and service operations.</p>
          </div>
        )}
        <div className="mb-4 flex flex-wrap gap-2">
          {(restaurantMode ? [
            ['displays', 'Displays'],
            ['hardware', 'Hardware']
          ] : [
            ['shift', 'Shift'],
            ['tables', 'Tables'],
            ['displays', 'Displays'],
            ['hardware', 'Hardware'],
            ['modifiers', 'Modifiers'],
            ['recipes', 'Recipes'],
            ['promos', 'Promos'],
            ['floor', 'Floor'],
            ['audit', 'Audit']
          ]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSetupSection(key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${setupSection === key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className={`${setupSection === 'shift' ? '' : 'hidden'} bb-card p-5`}>
            <h2 className="text-base font-semibold text-slate-900">Operator Shift</h2>
            <p className="mt-1 text-sm text-slate-500">Each operator who handles cash or card payments can open and close their own shift.</p>
            {currentShift ? (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="font-semibold text-emerald-900">Open shift</p>
                <p className="mt-1 text-sm text-emerald-800">Operator: {currentShift.cashier_name || currentOperator.name}</p>
                <p className="mt-1 text-sm text-emerald-800">Opened {new Date(currentShift.opened_at).toLocaleString()}</p>
                <p className="mt-1 text-sm text-emerald-800">Opening float: {currency} {fmt(currentShift.opening_float || 0)}</p>
                <div className="mt-3 flex gap-2">
                  <input className="input" type="number" step="0.01" min="0" value={shiftCloseCash} onChange={(e) => setShiftCloseCash(e.target.value)} placeholder="Closing cash" />
                  <button className="btn-primary" onClick={closeShift}>Close</button>
                </div>
                <p className="mt-2 text-xs text-emerald-800">
                  Closing reconciles and settles this shift on the server and requires supervisor or manager access. The cash count you enter becomes the shift's recorded cash-up.
                </p>
                {shiftCloseMessage && <p className="mt-2 text-xs font-semibold text-amber-800" role="status">{shiftCloseMessage}</p>}
              </div>
            ) : (
              <div className="mt-4 flex gap-2">
                <input className="input" type="number" step="0.01" min="0" value={shiftFloat} onChange={(e) => setShiftFloat(e.target.value)} placeholder="Opening float" />
                <button className="btn-primary" onClick={openShift}>Open Shift</button>
              </div>
            )}
          </div>

          <div className={`${setupSection === 'tables' ? '' : 'hidden'} bb-card p-5`}>
            <h2 className="text-base font-semibold text-slate-900">Tables</h2>
            <p className="mt-1 text-sm text-slate-500">Create table names once, then select them in the terminal.</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_6rem_auto]">
              <input className="input" value={tableForm.name} onChange={(e) => setTableForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Table name" />
              <input className="input" value={tableForm.area} onChange={(e) => setTableForm((prev) => ({ ...prev, area: e.target.value }))} placeholder="Area" />
              <input className="input" type="number" min="0" value={tableForm.seats} onChange={(e) => setTableForm((prev) => ({ ...prev, seats: e.target.value }))} placeholder="Seats" />
              <button
                className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
                disabled={savingTable}
                onClick={async () => {
                  if (savingTable) return
                  const name = tableForm.name.trim()
                  if (!name) {
                    alert('Table name is required.')
                    return
                  }
                  if (!window.api?.pos?.saveTable) {
                    alert('Table setup is not available in this app build. Please restart after updating.')
                    return
                  }
                  try {
                    setSavingTable(true)
                    const res = await window.api.pos.saveTable({ ...tableForm, name, outlet_id: selectedOutlet?.id || null })
                    if (!res?.success) {
                      alert(res?.error || 'Could not save table.')
                      return
                    }
                    setTableForm({ name: '', area: '', seats: '' })
                    await loadPosOperations()
                  } catch (error) {
                    alert(error?.message || 'Could not save table.')
                  } finally {
                    setSavingTable(false)
                  }
                }}
              >
                {savingTable ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Add'
                )}
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {posTables.map((table) => (
                <div key={table.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="font-medium text-slate-800">{table.name}{table.area ? ` · ${table.area}` : ''}{table.seats ? ` · ${table.seats} seats` : ''}</span>
                  <button className="text-xs font-semibold text-red-600" onClick={async () => { await window.api.pos.deleteTable?.(table.id); await loadPosOperations() }}>Remove</button>
                </div>
              ))}
              {posTables.length === 0 && <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">No tables set up yet.</p>}
            </div>
          </div>

          <div className={`${setupSection === 'hardware' ? '' : 'hidden'} bb-card p-5`}>
            <h2 className="text-base font-semibold text-slate-900">POS Hardware Setup</h2>
            <p className="mt-1 text-sm text-slate-500">Configure this device once, then test each connected printer, drawer, display, or terminal.</p>
            <div className="mt-4 grid gap-2 md:grid-cols-4">
              {hardwareReadiness.map((item) => (
                <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{item.label}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-800">{item.value}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-4">
              <div className="grid gap-3 lg:grid-cols-3">
                <div>
                  <p className="mb-1 text-xs font-bold uppercase tracking-widest text-slate-400">Windows printer</p>
                  <select
                    className="input"
                    value={hardwareSettings?.receipt_printer_name || ''}
                    onChange={(e) => setHardwareSettings((prev) => ({ ...(prev || {}), receipt_printer_name: e.target.value }))}
                  >
                    <option value="">System default printer</option>
                    {receiptPrinters.map((printer) => (
                      <option key={printer.name} value={printer.name}>{printer.displayName || printer.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="mb-1 text-xs font-bold uppercase tracking-widest text-slate-400">Receipt mode</p>
                  <select
                    className="input"
                    value={hardwareSettings?.receipt_print_mode || 'windows'}
                    onChange={(e) => {
                      const mode = e.target.value
                      setHardwareSettings((prev) => ({ ...(prev || {}), receipt_print_mode: mode, escpos_enabled: mode === 'escpos' || prev?.escpos_enabled === true }))
                    }}
                  >
                    <option value="windows">Windows print driver</option>
                    <option value="escpos">Direct ESC/POS</option>
                  </select>
                </div>
                <div>
                  <p className="mb-1 text-xs font-bold uppercase tracking-widest text-slate-400">Paper width</p>
                  <select
                    className="input"
                    value={hardwareSettings?.receipt_paper_width || '80mm'}
                    onChange={(e) => setHardwareSettings((prev) => ({ ...(prev || {}), receipt_paper_width: e.target.value }))}
                  >
                    <option value="58mm">58mm thermal</option>
                    <option value="80mm">80mm thermal</option>
                    <option value="A4">A4 fallback</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input type="checkbox" checked={hardwareSettings?.auto_print_receipts === true} onChange={(e) => setHardwareSettings((prev) => ({ ...(prev || {}), auto_print_receipts: e.target.checked }))} />
                  Auto print receipts
                </label>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input type="checkbox" checked={hardwareSettings?.receipt_cut_enabled !== false} onChange={(e) => setHardwareSettings((prev) => ({ ...(prev || {}), receipt_cut_enabled: e.target.checked }))} />
                  Cut receipt paper
                </label>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input type="checkbox" checked={hardwareSettings?.escpos_enabled === true} onChange={(e) => setHardwareSettings((prev) => ({ ...(prev || {}), escpos_enabled: e.target.checked, receipt_print_mode: e.target.checked ? 'escpos' : prev?.receipt_print_mode || 'windows' }))} />
                  ESC/POS commands enabled
                </label>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Direct ESC/POS target</p>
                <div className="mt-2 grid gap-2 lg:grid-cols-[11rem_1fr_8rem]">
                  <select
                    className="input"
                    value={hardwareSettings?.escpos_connection_type || 'network'}
                    onChange={(e) => setHardwareSettings((prev) => ({ ...(prev || {}), escpos_connection_type: e.target.value }))}
                  >
                    <option value="network">Network/IP</option>
                    <option value="share">Windows share</option>
                    <option value="serial">COM/LPT device</option>
                    <option value="path">Raw device path</option>
                  </select>
                  <input
                    className="input"
                    value={hardwareSettings?.escpos_network_host || ''}
                    onChange={(e) => setHardwareSettings((prev) => ({ ...(prev || {}), escpos_network_host: e.target.value }))}
                    placeholder="Printer IP, e.g. 192.168.1.50"
                  />
                  <input
                    className="input"
                    type="number"
                    min="1"
                    max="65535"
                    value={hardwareSettings?.escpos_network_port || 9100}
                    onChange={(e) => setHardwareSettings((prev) => ({ ...(prev || {}), escpos_network_port: e.target.value }))}
                    placeholder="9100"
                  />
                </div>
                <div className="mt-2 grid gap-2 lg:grid-cols-[1fr_9rem_9rem]">
                  <input
                    className="input"
                    value={hardwareSettings?.escpos_printer_path || ''}
                    onChange={(e) => setHardwareSettings((prev) => ({ ...(prev || {}), escpos_printer_path: e.target.value }))}
                    placeholder="Optional: tcp://192.168.1.50:9100, COM3, LPT1, or \\\\DESK\\ReceiptPrinter"
                  />
                  <select
                    className="input"
                    value={hardwareSettings?.escpos_codepage || 'cp437'}
                    onChange={(e) => setHardwareSettings((prev) => ({ ...(prev || {}), escpos_codepage: e.target.value }))}
                  >
                    <option value="cp437">CP437</option>
                    <option value="cp850">CP850</option>
                    <option value="cp858">CP858</option>
                  </select>
                  <input
                    className="input"
                    type="number"
                    min="1500"
                    value={hardwareSettings?.escpos_timeout_ms || 8000}
                    onChange={(e) => setHardwareSettings((prev) => ({ ...(prev || {}), escpos_timeout_ms: e.target.value }))}
                    placeholder="Timeout ms"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Cash drawer</p>
                <div className="mt-2 grid gap-3 md:grid-cols-3">
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <input type="checkbox" checked={hardwareSettings?.cash_drawer_enabled === true} onChange={(e) => setHardwareSettings((prev) => ({ ...(prev || {}), cash_drawer_enabled: e.target.checked }))} />
                    Drawer connected
                  </label>
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <input type="checkbox" checked={hardwareSettings?.cash_drawer_open_on_cash === true} onChange={(e) => setHardwareSettings((prev) => ({ ...(prev || {}), cash_drawer_open_on_cash: e.target.checked }))} />
                    Open on cash sale
                  </label>
                  <select
                    className="input"
                    value={hardwareSettings?.cash_drawer_open_timing || 'after_payment'}
                    onChange={(e) => setHardwareSettings((prev) => ({ ...(prev || {}), cash_drawer_open_timing: e.target.value }))}
                  >
                    <option value="after_payment">After payment</option>
                    <option value="before_receipt">Before receipt</option>
                  </select>
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  <select
                    className="input"
                    value={hardwareSettings?.cash_drawer_pin || '0'}
                    onChange={(e) => setHardwareSettings((prev) => ({ ...(prev || {}), cash_drawer_pin: e.target.value }))}
                  >
                    <option value="0">Drawer pin 0</option>
                    <option value="1">Drawer pin 1</option>
                  </select>
                  <input
                    className="input"
                    type="number"
                    min="10"
                    value={hardwareSettings?.cash_drawer_pulse_on_ms || 50}
                    onChange={(e) => setHardwareSettings((prev) => ({ ...(prev || {}), cash_drawer_pulse_on_ms: e.target.value }))}
                    placeholder="Pulse on ms"
                  />
                  <input
                    className="input"
                    type="number"
                    min="10"
                    value={hardwareSettings?.cash_drawer_pulse_off_ms || 250}
                    onChange={(e) => setHardwareSettings((prev) => ({ ...(prev || {}), cash_drawer_pulse_off_ms: e.target.value }))}
                    placeholder="Pulse off ms"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Card terminal</p>
                <div className="mt-2 grid gap-2 lg:grid-cols-3">
                  <input
                    className="input"
                    value={hardwareSettings?.payment_terminal_provider || ''}
                    onChange={(e) => setHardwareSettings((prev) => ({ ...(prev || {}), payment_terminal_provider: e.target.value }))}
                    placeholder="Provider, e.g. Yoco, Stripe, local bank"
                  />
                  <input
                    className="input"
                    value={hardwareSettings?.payment_terminal_name || ''}
                    onChange={(e) => setHardwareSettings((prev) => ({ ...(prev || {}), payment_terminal_name: e.target.value }))}
                    placeholder="Terminal model/name"
                  />
                  <select
                    className="input"
                    value={hardwareSettings?.payment_terminal_mode || 'manual'}
                    onChange={(e) => setHardwareSettings((prev) => ({ ...(prev || {}), payment_terminal_mode: e.target.value }))}
                  >
                    <option value="manual">Manual card terminal</option>
                    <option value="local_bridge">Local device bridge</option>
                    <option value="provider_api">Provider API URL</option>
                  </select>
                </div>
                <div className="mt-2 grid gap-2 lg:grid-cols-[1fr_9rem]">
                  <input
                    className="input"
                    value={hardwareSettings?.payment_terminal_bridge_url || ''}
                    onChange={(e) => setHardwareSettings((prev) => ({ ...(prev || {}), payment_terminal_bridge_url: e.target.value }))}
                    placeholder="Bridge/API URL, e.g. http://127.0.0.1:8787/charge"
                  />
                  <input
                    className="input"
                    type="number"
                    min="1500"
                    value={hardwareSettings?.payment_terminal_timeout_ms || 8000}
                    onChange={(e) => setHardwareSettings((prev) => ({ ...(prev || {}), payment_terminal_timeout_ms: e.target.value }))}
                    placeholder="Timeout ms"
                  />
                </div>
              </div>
              {hardwareMsg && <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{hardwareMsg}</p>}
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" onClick={() => saveHardware()}>Save Settings</button>
                <button className="btn-secondary" onClick={() => testHardware('receipt')}><Printer size={14} /> Test Receipt</button>
                <button className="btn-secondary" onClick={async () => {
                  const res = await window.api.pos.openCashDrawer?.({ reason: 'manual_test' })
                  setHardwareMsg(res?.message || res?.error || 'Cash drawer test finished.')
                }}>Open Drawer</button>
                <button className="btn-secondary" onClick={() => testHardware('escpos')}>Test ESC/POS</button>
                <button className="btn-secondary" onClick={() => testHardware('payment-terminal')}>Test Card Terminal</button>
              </div>
            </div>
          </div>

          <div className={`${setupSection === 'displays' ? '' : 'hidden'} bb-card p-5`}>
            <h2 className="text-base font-semibold text-slate-900">Customer, Kitchen & Bar Displays</h2>
            <p className="mt-1 text-sm text-slate-500">Open dedicated displays on selected monitors. Moved or full-screen windows reopen on the same screen next time.</p>
            <div className="mt-4 grid gap-3">
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                <div className="flex items-start gap-3">
                  <Monitor size={22} className="mt-0.5 text-emerald-700" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-emerald-950">Customer-facing display</p>
                    <p className="mt-1 text-sm text-emerald-800">Shows the guest their current basket and total as the cashier adds items.</p>
                    <p className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-sm font-semibold text-emerald-900">Updates automatically from the active POS cart.</p>
                    {renderDisplayTargetSelect('customer')}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className="btn-primary" onClick={() => openDisplay('customer')}>
                    <Monitor size={15} /> Open Customer Display
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => openDisplay('customer', { fullScreen: true })}>
                    Full Screen
                  </button>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-orange-100 bg-orange-50 p-4">
                  <div className="flex items-start gap-3">
                    <Utensils size={22} className="mt-0.5 text-orange-700" />
                    <div>
                      <p className="font-semibold text-orange-950">Kitchen ticket screen</p>
                      <p className="mt-1 text-sm text-orange-800">Food tickets with New, Preparing, and Ready lanes.</p>
                      {renderDisplayTargetSelect('kitchen')}
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary" onClick={() => openDisplay('kitchen')}>
                      <Monitor size={15} /> Open Kitchen Screen
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => openDisplay('kitchen', { fullScreen: true })}>
                      Full Screen
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                  <div className="flex items-start gap-3">
                    <Monitor size={22} className="mt-0.5 text-blue-700" />
                    <div>
                      <p className="font-semibold text-blue-950">Bar ticket screen</p>
                      <p className="mt-1 text-sm text-blue-800">Drink tickets with the same simple prep workflow.</p>
                      {renderDisplayTargetSelect('bar')}
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary" onClick={() => openDisplay('bar')}>
                      <Monitor size={15} /> Open Bar Screen
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => openDisplay('bar', { fullScreen: true })}>
                      Full Screen
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Keep the main POS on the cashier terminal. Put the customer display on the guest-facing monitor, and put the kitchen or bar display on a tablet, TV, or second workstation. This device remembers each display placement after restart.
              </div>
            </div>
          </div>

          <div className={`${setupSection === 'modifiers' ? '' : 'hidden'} bb-card p-5`}>
            <h2 className="text-base font-semibold text-slate-900">Modifiers & Instructions</h2>
            <div className="mt-4 grid gap-2">
              <input className="input" value={modifierForm.name} onChange={(e) => setModifierForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Group name, e.g. Burger options" />
              <textarea className="input h-24 resize-none" value={modifierForm.options} onChange={(e) => setModifierForm((prev) => ({ ...prev, options: e.target.value }))} placeholder={'One per line: No onion|0\nExtra cheese|5'} />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Min selections (0 = optional)</label>
                  <input type="number" min="0" className="input" value={modifierForm.min_selections} onChange={(e) => setModifierForm((prev) => ({ ...prev, min_selections: e.target.value }))} placeholder="0" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Max selections (0 = unlimited)</label>
                  <input type="number" min="0" className="input" value={modifierForm.max_selections} onChange={(e) => setModifierForm((prev) => ({ ...prev, max_selections: e.target.value }))} placeholder="0" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Applies to categories (comma-separated, or All)</label>
                <input className="input" value={modifierForm.applies_to_categories} onChange={(e) => setModifierForm((prev) => ({ ...prev, applies_to_categories: e.target.value }))} placeholder="All" />
              </div>
              <button className="btn-primary" onClick={saveModifierGroup}>Save Modifier Group</button>
              <div className="space-y-2">
                {modifierGroups.map((group) => (
                  <div key={group.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <p className="font-semibold text-slate-800">{group.name}</p>
                    <p className="text-xs text-slate-500">{(group.options || []).map((option) => `${option.name}${Number(option.price_delta || 0) ? ` +${currency}${fmt(option.price_delta)}` : ''}`).join(' · ')}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className={`${setupSection === 'recipes' ? '' : 'hidden'} bb-card p-5`}>
            <h2 className="text-base font-semibold text-slate-900">Recipes & Ingredients</h2>
            <p className="mt-1 text-xs text-slate-500">Link menu items to multi-ingredient recipes. When a recipe-linked menu item is sold, stock is depleted for all ingredients.</p>
            {restaurantMode && <p className="mt-1 text-xs text-blue-600">Also available at <strong>Recipes & Costing</strong> in the sidebar.</p>}
            <div className="mt-4 grid gap-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Recipe Name *</label>
                  <input className="input" value={recipeForm.name} onChange={(e) => setRecipeForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g. Classic Burger" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Menu Item</label>
                  <select className="input" value={recipeForm.menu_item_id} onChange={(e) => setRecipeForm((prev) => ({ ...prev, menu_item_id: e.target.value }))}>
                    <option value="">None (standalone recipe)</option>
                    {menuItems.filter((item) => item.template_kind !== 'bar_single').map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Serving Size</label>
                  <input type="number" min="1" step="1" className="input" value={recipeForm.serving_size} onChange={(e) => setRecipeForm((prev) => ({ ...prev, serving_size: e.target.value }))} placeholder="1" />
                </div>
                <div></div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Ingredients</label>
                {recipeForm.ingredients.length > 0 && (
                  <div className="mb-2 space-y-1">
                    {recipeForm.ingredients.map((ing, idx) => {
                      const item = inventoryItems.find((i) => i.id === ing.inventory_item_id)
                      return (
                        <div key={idx} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1 text-xs">
                          <span className="flex-1 font-medium text-slate-800">{item?.name || 'Unknown'}</span>
                          <input type="number" min="0.01" step="0.01" className="w-20 rounded border border-slate-200 px-1 py-0.5 text-xs" value={ing.quantity} onChange={(e) => {
                            const newIngs = [...recipeForm.ingredients]
                            newIngs[idx] = { ...newIngs[idx], quantity: e.target.value }
                            setRecipeForm((prev) => ({ ...prev, ingredients: newIngs }))
                          }} />
                          <select className="rounded border border-slate-200 px-1 py-0.5 text-xs" value={ing.unit} onChange={(e) => {
                            const newIngs = [...recipeForm.ingredients]
                            newIngs[idx] = { ...newIngs[idx], unit: e.target.value }
                            setRecipeForm((prev) => ({ ...prev, ingredients: newIngs }))
                          }}>
                            <option value="each">each</option>
                            <option value="g">g</option>
                            <option value="kg">kg</option>
                            <option value="ml">ml</option>
                            <option value="l">L</option>
                          </select>
                          <input type="number" min="0" max="100" className="w-14 rounded border border-slate-200 px-1 py-0.5 text-xs" value={ing.waste_percent} onChange={(e) => {
                            const newIngs = [...recipeForm.ingredients]
                            newIngs[idx] = { ...newIngs[idx], waste_percent: e.target.value }
                            setRecipeForm((prev) => ({ ...prev, ingredients: newIngs }))
                          }} title="Waste %" />
                          <span className="text-slate-400">%</span>
                          <button type="button" className="text-red-500 hover:text-red-700" onClick={() => {
                            setRecipeForm((prev) => ({ ...prev, ingredients: prev.ingredients.filter((_, i) => i !== idx) }))
                          }}>×</button>
                        </div>
                      )
                    })}
                  </div>
                )}
                <div className="flex gap-2">
                  <select id="add-recipe-ingredient-select" className="input flex-1">
                    {inventoryItems.filter((item) => !recipeForm.ingredients.some((ing) => ing.inventory_item_id === item.id)).map((item) => (
                      <option key={item.id} value={item.id}>{item.name} ({item.unit || 'each'})</option>
                    ))}
                  </select>
                  <button type="button" className="btn-secondary text-sm" onClick={() => {
                    const sel = document.getElementById('add-recipe-ingredient-select')
                    const itemId = sel?.value
                    if (!itemId) return
                    setRecipeForm((prev) => ({ ...prev, ingredients: [...prev.ingredients, { inventory_item_id: itemId, quantity: '1', unit: 'each', waste_percent: '0' }] }))
                  }}>+ Add</button>
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn-primary text-sm" onClick={async () => {
                  if (!recipeForm.name.trim()) { alert('Recipe name is required.'); return }
                  setRecipeSaving(true)
                  try {
                    const res = await window.api.pos.saveRecipe?.({
                      id: editingRecipe?.id || undefined,
                      name: recipeForm.name.trim(),
                      menu_item_id: recipeForm.menu_item_id || null,
                      serving_size: Number(recipeForm.serving_size || 1),
                      ingredients: recipeForm.ingredients.map((ing, idx) => ({
                        inventory_item_id: ing.inventory_item_id,
                        quantity: Number(ing.quantity || 0),
                        unit: ing.unit || 'each',
                        waste_percent: Number(ing.waste_percent || 0),
                        sort_order: idx
                      }))
                    })
                    if (!res?.success) { alert(res?.error || 'Could not save recipe.'); return }
                    setRecipeForm({ name: '', menu_item_id: '', serving_size: '1', ingredients: [] })
                    setEditingRecipe(null)
                    await loadPosOperations()
                  } finally {
                    setRecipeSaving(false)
                  }
                }} disabled={recipeSaving}>{recipeSaving ? 'Saving...' : editingRecipe ? 'Update Recipe' : 'Save Recipe'}</button>
                {editingRecipe && (
                  <button className="btn-secondary text-sm" onClick={() => { setEditingRecipe(null); setRecipeForm({ name: '', menu_item_id: '', serving_size: '1', ingredients: [] }) }}>Cancel</button>
                )}
              </div>
              <div className="space-y-2">
                {recipes.map((recipe) => {
                  const totalCost = (recipe.ingredients || []).reduce((sum, ing) => sum + (Number(ing.quantity || 0) * Number(ing.latest_unit_cost || 0) * (1 + Number(ing.waste_percent || 0) / 100)), 0)
                  return (
                    <div key={recipe.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-slate-800">{recipe.name}</p>
                        <div className="flex gap-1">
                          <button type="button" className="text-xs text-blue-600 hover:text-blue-800" onClick={() => {
                            setEditingRecipe(recipe)
                            setRecipeForm({
                              name: recipe.name || '',
                              menu_item_id: recipe.menu_item_id || '',
                              serving_size: String(recipe.serving_size || 1),
                              ingredients: (recipe.ingredients || []).map((ing) => ({
                                inventory_item_id: ing.inventory_item_id,
                                quantity: String(ing.quantity || 0),
                                unit: ing.unit || 'each',
                                waste_percent: String(ing.waste_percent || 0)
                              }))
                            })
                          }}>Edit</button>
                          <button type="button" className="text-xs text-red-600 hover:text-red-800" onClick={async () => {
                            if (!window.confirm(`Delete recipe "${recipe.name}"?`)) return
                            await window.api.pos.deleteRecipe?.(recipe.id)
                            await loadPosOperations()
                          }}>Delete</button>
                        </div>
                      </div>
                      <p className="text-xs text-slate-500">
                        {(recipe.ingredients || []).length} ingredient(s) · Est. cost: {currency} {fmt(totalCost)}
                        {recipe.menu_item_id && ' · Linked to menu item'}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div className={`${setupSection === 'promos' ? '' : 'hidden'} bb-card p-5`}>
            <h2 className="text-base font-semibold text-slate-900">Promotions</h2>
            <div className="mt-4 grid gap-2">
              <input className="input" value={promotionForm.name} onChange={(e) => setPromotionForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Promotion name" />
              <div className="grid grid-cols-[1fr_1fr] gap-2">
                <select className="input" value={promotionForm.discount_type} onChange={(e) => setPromotionForm((prev) => ({ ...prev, discount_type: e.target.value }))}>
                  <option value="amount">Amount</option>
                  <option value="percent">Percent</option>
                </select>
                <input className="input" type="number" step="0.01" min="0" value={promotionForm.discount_value} onChange={(e) => setPromotionForm((prev) => ({ ...prev, discount_value: e.target.value }))} placeholder="Discount" />
              </div>
              <button className="btn-primary" onClick={savePromotion}>Save Promotion</button>
              <div className="space-y-2">
                {promotions.map((promo) => (
                  <div key={promo.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <p className="font-semibold text-slate-800">{promo.name}</p>
                    <p className="text-xs text-slate-500">{promo.discount_type === 'percent' ? `${promo.discount_value}%` : `${currency} ${fmt(promo.discount_value)}`} discount</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className={`${setupSection === 'floor' ? '' : 'hidden'} bb-card p-5`}>
            <h2 className="text-base font-semibold text-slate-900">Floor Layout</h2>
            <div className="mt-4 flex gap-2">
              <input className="input" value={floorAreaName} onChange={(e) => setFloorAreaName(e.target.value)} placeholder="Area name, e.g. Patio" />
              <button className="btn-primary" onClick={addFloorArea}>Add</button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {(floorLayout?.areas || []).map((area) => (
                <span key={area.id} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{area.name}</span>
              ))}
            </div>
          </div>

          <div className={`${setupSection === 'audit' ? '' : 'hidden'} bb-card p-5`}>
            <h2 className="text-base font-semibold text-slate-900">POS Audit Trail</h2>
            <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
              {auditLog.map((row) => (
                <div key={row.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
                  <p className="font-semibold text-slate-800">{row.action}</p>
                  <p className="text-slate-500">{row.staff_name || 'System'} · {new Date(row.created_at).toLocaleString()}</p>
                </div>
              ))}
              {auditLog.length === 0 && <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">No POS audit events yet.</p>}
            </div>
          </div>

          {restaurantMode && (
            <>
              <div className={`${setupSection === 'staff' ? '' : 'hidden'} bb-card p-5`}>
                <h2 className="text-base font-semibold text-slate-900">Staff Shifts</h2>
                <p className="mt-1 text-sm text-slate-500">Clock in and out staff members for each shift.</p>
                {restaurantMode && <p className="mt-1 text-xs text-blue-600">Also available at <strong>Staff</strong> and <strong>Shifts</strong> in the sidebar.</p>}
                <div className="mt-4 space-y-3">
                  {activeShifts.map((s) => (
                    <div key={s.id} className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2">
                      <div>
                        <p className="text-sm font-semibold text-emerald-900">{s.staff_name} ({s.role})</p>
                        <p className="text-xs text-emerald-700">Clocked in {new Date(s.clock_in).toLocaleTimeString()}</p>
                      </div>
                      <button className="btn-secondary text-xs" onClick={async () => {
                        if (!confirm(`Clock out ${s.staff_name}?`)) return
                        await window.api.pos.clockOutStaff({ shiftId: s.id })
                        const shifts = await window.api.pos.getActiveShifts().catch(() => [])
                        setActiveShifts(shifts)
                      }}>Clock Out</button>
                    </div>
                  ))}
                  {activeShifts.length === 0 && <p className="text-sm text-slate-500">No active shifts.</p>}
                  <div className="flex gap-2">
                    <input className="input flex-1" placeholder="Staff name" id="staffNameInput" />
                    <button className="btn-primary" onClick={async () => {
                      const name = document.getElementById('staffNameInput')?.value?.trim()
                      if (!name) return alert('Enter a staff name')
                      await window.api.pos.clockInStaff({ staffName: name, role: 'cashier' })
                      document.getElementById('staffNameInput').value = ''
                      const shifts = await window.api.pos.getActiveShifts().catch(() => [])
                      setActiveShifts(shifts)
                    }}>Clock In</button>
                  </div>
                </div>
              </div>

              <div className={`${setupSection === 'cashdrawer' ? '' : 'hidden'} bb-card p-5`}>
                <h2 className="text-base font-semibold text-slate-900">Cash Drawer</h2>
                <p className="mt-1 text-sm text-slate-500">Open and close cash drawer sessions with variance tracking.</p>
                {restaurantMode && <p className="mt-1 text-xs text-blue-600">Also available at <strong>Cash Drawer</strong> in the sidebar.</p>}
                <div className="mt-4">
                  {openDrawerSession ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                      <p className="font-semibold text-emerald-900">Open Drawer Session</p>
                      <p className="mt-1 text-sm text-emerald-800">Opened {new Date(openDrawerSession.opened_at).toLocaleString()}</p>
                      <p className="text-sm text-emerald-800">Opening float: {currency} {fmt(openDrawerSession.opening_float)}</p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <input className="input text-sm" type="number" step="0.01" placeholder="Closing total" value={drawerClosingTotal} onChange={(e) => setDrawerClosingTotal(e.target.value)} />
                        <input className="input text-sm" type="number" step="0.01" placeholder="Declared total" value={drawerDeclaredTotal} onChange={(e) => setDrawerDeclaredTotal(e.target.value)} />
                      </div>
                      <button className="btn-primary mt-3 w-full" onClick={async () => {
                        const r = await window.api.pos.closeCashDrawerSession({
                          sessionId: openDrawerSession.id,
                          closingTotal: Number(drawerClosingTotal || 0),
                          declaredTotal: drawerDeclaredTotal ? Number(drawerDeclaredTotal) : null
                        }).catch((e) => ({ success: false, error: e.message }))
                        if (r?.success) {
                          alert(`Drawer closed. Variance: ${r.variance != null ? `${currency} ${fmt(r.variance)}` : 'N/A'}`)
                          setOpenDrawerSession(null)
                          setDrawerClosingTotal('')
                          setDrawerDeclaredTotal('')
                        } else alert(r?.error || 'Failed to close drawer')
                      }}>Close Drawer</button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <input className="input flex-1" type="number" step="0.01" placeholder="Opening float" value={drawerFloat} onChange={(e) => setDrawerFloat(e.target.value)} />
                      <button className="btn-primary" onClick={async () => {
                        const r = await window.api.pos.openCashDrawerSession({ openingFloat: Number(drawerFloat || 0) }).catch((e) => ({ success: false, error: e.message }))
                        if (r?.success) {
                          setOpenDrawerSession({ id: r.session_id, opening_float: Number(drawerFloat || 0), opened_at: new Date().toISOString() })
                          setDrawerFloat('')
                        } else alert(r?.error || 'Failed to open drawer')
                      }}>Open Drawer</button>
                    </div>
                  )}
                </div>
              </div>

              <div className={`${setupSection === 'suppliers' ? '' : 'hidden'} bb-card p-5`}>
                <h2 className="text-base font-semibold text-slate-900">Suppliers</h2>
                <p className="mt-1 text-sm text-slate-500">Manage supplier directory and create purchase orders.</p>
                {restaurantMode && <p className="mt-1 text-xs text-blue-600">Also available at <strong>Purchasing</strong> in the sidebar.</p>}
                <div className="mt-4 space-y-3">
                  {suppliers.map((s) => (
                    <div key={s.id} className="rounded-lg bg-slate-50 px-3 py-2">
                      <p className="text-sm font-semibold text-slate-800">{s.name}</p>
                      <p className="text-xs text-slate-500">{s.contact_person || ''} {s.phone || ''}</p>
                    </div>
                  ))}
                  {suppliers.length === 0 && <p className="text-sm text-slate-500">No suppliers added yet.</p>}
                  <div className="grid grid-cols-2 gap-2">
                    <input className="input text-sm" placeholder="Name" value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} />
                    <input className="input text-sm" placeholder="Contact person" value={supplierForm.contact_person} onChange={(e) => setSupplierForm({ ...supplierForm, contact_person: e.target.value })} />
                    <input className="input text-sm" placeholder="Phone" value={supplierForm.phone} onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })} />
                    <input className="input text-sm" placeholder="Email" value={supplierForm.email} onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })} />
                  </div>
                  <button className="btn-primary w-full" onClick={async () => {
                    if (!supplierForm.name.trim()) return alert('Enter supplier name')
                    const r = await window.api.pos.createSupplier(supplierForm).catch((e) => ({ success: false, error: e.message }))
                    if (r?.success) {
                      setSupplierForm({ name: '', contact_person: '', phone: '', email: '', address: '', payment_terms: '' })
                      const list = await window.api.pos.getSuppliers().catch(() => [])
                      setSuppliers(list)
                    } else alert(r?.error || 'Failed to add supplier')
                  }}>Add Supplier</button>
                </div>
              </div>

              <div className={`${setupSection === 'checklist' ? '' : 'hidden'} bb-card p-5`}>
                <h2 className="text-base font-semibold text-slate-900">Daily Checklists</h2>
                <p className="mt-1 text-sm text-slate-500">Opening, closing, and cleaning checklists.</p>
                {restaurantMode && <p className="mt-1 text-xs text-blue-600">Also available at <strong>Checklists</strong> in the sidebar.</p>}
                <div className="mt-4">
                  <div className="flex gap-2">
                    <select className="input flex-1" value={checklistType} onChange={(e) => setChecklistType(e.target.value)}>
                      <option value="daily_opening">Daily Opening</option>
                      <option value="daily_closing">Daily Closing</option>
                      <option value="cleaning">Cleaning</option>
                      <option value="equipment_check">Equipment Check</option>
                    </select>
                    <button className="btn-primary" onClick={async () => {
                      const items = checklistType === 'daily_opening'
                        ? [{ label: 'Check fridges/freezers temperature' }, { label: 'Verify stock levels' }, { label: 'Clean surfaces' }, { label: 'Test POS printer' }]
                        : checklistType === 'daily_closing'
                        ? [{ label: 'Run cash-up' }, { label: 'Clean all surfaces' }, { label: 'Turn off equipment' }, { label: 'Lock doors' }]
                        : checklistType === 'cleaning'
                        ? [{ label: 'Mop floors' }, { label: 'Clean bathroom' }, { label: 'Empty bins' }]
                        : [{ label: 'Check fire extinguishers' }, { label: 'Test first aid kit' }, { label: 'Check equipment condition' }]
                      const r = await window.api.pos.createChecklist({ checklistType, items }).catch((e) => ({ success: false, error: e.message }))
                      if (r?.success) {
                        const cl = { id: r.checklist_id, checklist_type: checklistType, status: 'pending', items: items.map((it, i) => ({ id: `${r.checklist_id}-${i}`, ...it, is_completed: false })) }
                        setChecklists([cl, ...checklists])
                      } else alert(r?.error || 'Failed to create checklist')
                    }}>Create Checklist</button>
                  </div>
                  <div className="mt-4 space-y-3">
                    {checklists.slice(0, 5).map((cl) => (
                      <div key={cl.id} className={`rounded-lg border px-3 py-2 ${cl.status === 'completed' ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
                        <p className="text-sm font-semibold text-slate-800">{cl.checklist_type?.replace(/_/g, ' ')}</p>
                        {(cl.items || []).map((item) => (
                          <label key={item.id} className="flex items-center gap-2 py-1 text-xs text-slate-600">
                            <input type="checkbox" checked={item.is_completed} onChange={async () => {
                              await window.api.pos.completeChecklistItem({ itemId: item.id })
                              item.is_completed = !item.is_completed
                              setChecklists([...checklists])
                            }} />
                            {item.label}
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className={`${setupSection === 'alerts' ? '' : 'hidden'} bb-card p-5`}>
                <h2 className="text-base font-semibold text-slate-900">Exception Alerts</h2>
                <p className="mt-1 text-sm text-slate-500">Active alerts for cash variance, stock low, and operational issues.</p>
                {restaurantMode && <p className="mt-1 text-xs text-blue-600">Also available at <strong>Alerts</strong> in the sidebar.</p>}
                <div className="mt-4 space-y-2">
                  {activeAlerts.map((a) => (
                    <div key={a.id} className={`rounded-lg px-3 py-2 ${a.severity === 'critical' ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{a.alert_type?.replace(/_/g, ' ')}</p>
                          <p className="text-xs text-slate-600">{a.message}</p>
                        </div>
                        <button className="text-xs text-emerald-700 underline" onClick={async () => {
                          await window.api.pos.resolveAlert(a.id)
                          setActiveAlerts(activeAlerts.filter((x) => x.id !== a.id))
                        }}>Resolve</button>
                      </div>
                    </div>
                  ))}
                  {activeAlerts.length === 0 && <p className="text-sm text-slate-500">No active alerts.</p>}
                  <div className="grid grid-cols-3 gap-2">
                    <select className="input text-sm" value={alertForm.alert_type} onChange={(e) => setAlertForm({ ...alertForm, alert_type: e.target.value })}>
                      <option value="stock_low">Stock Low</option>
                      <option value="cash_variance">Cash Variance</option>
                      <option value="void_spike">Void Spike</option>
                      <option value="discount_abuse">Discount Abuse</option>
                      <option value="refund_spike">Refund Spike</option>
                    </select>
                    <select className="input text-sm" value={alertForm.severity} onChange={(e) => setAlertForm({ ...alertForm, severity: e.target.value })}>
                      <option value="info">Info</option>
                      <option value="warning">Warning</option>
                      <option value="critical">Critical</option>
                    </select>
                    <button className="btn-primary text-sm" onClick={async () => {
                      if (!alertForm.message.trim()) return alert('Enter alert message')
                      const r = await window.api.pos.recordAlert(alertForm).catch((e) => ({ success: false, error: e.message }))
                      if (r?.success) {
                        setAlertForm({ alert_type: 'stock_low', severity: 'warning', message: '' })
                        const alerts = await window.api.pos.getActiveAlerts().catch(() => [])
                        setActiveAlerts(alerts)
                      }
                    }}>Add Alert</button>
                  </div>
                  <input className="input text-sm" placeholder="Alert message" value={alertForm.message} onChange={(e) => setAlertForm({ ...alertForm, message: e.target.value })} />
                </div>
              </div>

              <div className={`${setupSection === 'digest' ? '' : 'hidden'} bb-card p-5`}>
                <h2 className="text-base font-semibold text-slate-900">Owner Digest</h2>
                <p className="mt-1 text-sm text-slate-500">Daily summary of revenue, orders, stock, and alerts.</p>
                {restaurantMode && <p className="mt-1 text-xs text-blue-600">Also available at <strong>Owner Digest</strong> in the sidebar.</p>}
                <div className="mt-4">
                  <button className="btn-primary" onClick={async () => {
                    const r = await window.api.pos.generateOwnerDigest().catch((e) => ({ success: false, error: e.message }))
                    if (r?.success) setOwnerDigest(r.digest)
                    else alert(r?.error || 'Failed to generate digest')
                  }}>Generate Digest</button>
                  {ownerDigest && (
                    <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
                      <p className="text-xs text-blue-600">{ownerDigest.date}</p>
                      <div className="mt-2 grid grid-cols-2 gap-3">
                        <div><p className="text-lg font-bold text-blue-900">{currency} {fmt(ownerDigest.total_revenue)}</p><p className="text-xs text-blue-700">Revenue</p></div>
                        <div><p className="text-lg font-bold text-blue-900">{ownerDigest.total_orders || 0}</p><p className="text-xs text-blue-700">Orders</p></div>
                        <div><p className="text-lg font-bold text-blue-900">{ownerDigest.active_alerts || 0}</p><p className="text-xs text-blue-700">Active Alerts</p></div>
                        <div><p className="text-lg font-bold text-blue-900">{ownerDigest.low_stock_items || 0}</p><p className="text-xs text-blue-700">Low Stock Items</p></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        </>
      )}

      {modifierTargetIdx != null && orderItems[modifierTargetIdx] && (
        <Modal title={`Modifiers: ${orderItems[modifierTargetIdx].item_name}`} onClose={() => setModifierTargetIdx(null)} size="sm">
          <div className="space-y-4">
            {modifierGroups.filter((group) => {
              if (group.active === false) return false
              const appliesTo = Array.isArray(group.applies_to_categories) ? group.applies_to_categories : []
              if (appliesTo.length === 0 || appliesTo.some((c) => String(c).toLowerCase() === 'all')) return true
              const itemCategory = String(orderItems[modifierTargetIdx].category || '').toLowerCase()
              return appliesTo.some((c) => String(c).toLowerCase() === itemCategory)
            }).map((group) => {
              const currentMods = orderItems[modifierTargetIdx].modifiers || []
              const groupSelections = currentMods.filter((mod) =>
                (group.options || []).some((opt) => opt.name === mod.name)
              ).length
              const minRequired = Number(group.min_selections || 0)
              const maxAllowed = Number(group.max_selections || 0)
              const showMinWarning = minRequired > 0 && groupSelections < minRequired
              const showMaxWarning = maxAllowed > 0 && groupSelections >= maxAllowed
              return (
              <div key={group.id}>
                <div className="mb-2 flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-800">{group.name}</p>
                  {minRequired > 0 && <span className="text-xs text-slate-500">(min {minRequired})</span>}
                  {maxAllowed > 0 && <span className="text-xs text-slate-500">(max {maxAllowed})</span>}
                </div>
                {showMinWarning && (
                  <p className="mb-1 text-xs text-amber-600">Select at least {minRequired} option(s)</p>
                )}
                {showMaxWarning && (
                  <p className="mb-1 text-xs text-amber-600">Maximum {maxAllowed} option(s) reached</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {(group.options || []).map((option) => {
                    const selected = currentMods.some((mod) => mod.name === option.name)
                    return (
                      <button
                        key={option.id || option.name}
                        type="button"
                        onClick={() => toggleLineModifier(option, group)}
                        className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${selected ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-700'}`}
                      >
                        {option.name}{Number(option.price_delta || 0) ? ` +${currency} ${fmt(option.price_delta)}` : ''}
                      </button>
                    )
                  })}
                </div>
              </div>
              )
            })}
            {modifierGroups.length === 0 && (
              <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">No modifier groups set up yet.</p>
            )}
            <textarea
              className="input h-24 resize-none"
              value={modifierDraftNotes}
              onChange={(e) => setModifierDraftNotes(e.target.value)}
              placeholder="Kitchen/bar instruction, e.g. no onion, extra ice..."
            />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setModifierTargetIdx(null)}>Cancel</button>
              <button className="btn-primary" onClick={saveLineInstructions}>Save</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Menu Item Modal */}
      {menuModal && (
        <Modal
          title={editingItem?.template_kind === 'bar_single' ? 'Edit Bottle Barcode' : editingItem ? 'Edit Menu Item' : 'Add Menu Item'}
          onClose={() => { if (!menuSaving) setMenuModal(false) }}
          size="sm"
        >
          <form onSubmit={handleMenuSubmit} className="space-y-4">
            {menuError && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {menuError}
              </div>
            )}
            {editingItem?.template_kind === 'bar_single' ? (
              <>
                <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                  {editingItem.name} is inventory-managed. Barcode stays editable here, while price, outlet, and stock linkage continue to follow the Bar inventory record.
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Barcode <span className="font-normal text-slate-400">(optional — scan or type)</span>
                  </label>
                  <div className="relative">
                    <Scan size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      className="input pl-9 font-mono"
                      value={menuForm.barcode}
                      onChange={(e) => setMenuForm({ ...menuForm, barcode: e.target.value })}
                      placeholder="Scan barcode or enter manually"
                      autoFocus
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Item Name *</label>
                  <input
                    type="text"
                    className="input"
                    value={menuForm.name}
                    onChange={(e) => setMenuForm({ ...menuForm, name: e.target.value })}
                    required
                    placeholder="e.g. Beef Stew, Castle Lager"
                    autoFocus
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Category *</label>
                    <select
                      className="input"
                      value={menuForm.category}
                      onChange={(e) => setMenuForm({ ...menuForm, category: e.target.value })}
                    >
                      {MENU_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Price ({currency}) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="input"
                      value={menuForm.price}
                      onChange={(e) => setMenuForm({ ...menuForm, price: e.target.value })}
                      required
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Outlet <span className="font-normal text-slate-400">(recommended for accurate reporting)</span>
                  </label>
                  <select
                    className="input"
                    value={menuForm.outlet_id}
                    onChange={(e) => setMenuForm({ ...menuForm, outlet_id: e.target.value })}
                  >
                    <option value="">— Others —</option>
                    {posOutlets.map((o) => (
                      <option key={o.id || o.name} value={o.id || ''}>{o.name}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    Assigning an outlet ensures this item is counted correctly in Kitchen or Bar reports.
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Kitchen Station <span className="font-normal text-slate-400">(optional — routes tickets to correct display)</span>
                  </label>
                  <select
                    className="input"
                    value={menuForm.kitchen_station_id}
                    onChange={(e) => setMenuForm({ ...menuForm, kitchen_station_id: e.target.value })}
                  >
                    <option value="">— Auto (by category/outlet) —</option>
                    {kitchenStations.filter((s) => s.enabled !== false).map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    When set, orders of this item will be routed to this station's kitchen display.
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Barcode <span className="font-normal text-slate-400">(optional — scan or type)</span>
                  </label>
                  <div className="relative">
                    <Scan size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      className="input pl-9 font-mono"
                      value={menuForm.barcode}
                      onChange={(e) => setMenuForm({ ...menuForm, barcode: e.target.value })}
                      placeholder="Scan barcode or enter manually"
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Click this field and scan with your barcode scanner to auto-fill.
                  </p>
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Visual Cues <span className="font-normal text-slate-400">(optional — for kitchen display)</span>
                  </label>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-1.5 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-orange-500 focus:ring-orange-400"
                        checked={menuForm.is_popular}
                        onChange={(e) => setMenuForm({ ...menuForm, is_popular: e.target.checked })}
                      />
                      Popular
                    </label>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-slate-500">Prep:</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        className="input w-20 py-1 text-xs"
                        value={menuForm.prep_time_minutes}
                        onChange={(e) => setMenuForm({ ...menuForm, prep_time_minutes: parseInt(e.target.value) || 0 })}
                        placeholder="min"
                      />
                      <span className="text-xs text-slate-400">min</span>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {['vegetarian', 'vegan', 'gluten-free'].map((flag) => (
                      <label key={flag} className="flex items-center gap-1.5 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 rounded border-slate-300 text-green-500 focus:ring-green-400"
                          checked={menuForm.dietary_flags.includes(flag)}
                          onChange={(e) => {
                            const flags = e.target.checked
                              ? [...menuForm.dietary_flags, flag]
                              : menuForm.dietary_flags.filter((f) => f !== flag)
                            setMenuForm({ ...menuForm, dietary_flags: flags })
                          }}
                        />
                        {flag === 'gluten-free' ? 'GF' : flag === 'vegan' ? 'VG' : 'V'}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Inventory Stock Link <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <select
                    className="input"
                    value={menuForm.inventory_item_id}
                    onChange={(e) => setMenuForm({ ...menuForm, inventory_item_id: e.target.value })}
                  >
                    <option value="">— No inventory link —</option>
                    {inventoryItems.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.name} ({inv.unit}) — {inv.current_stock} in stock
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    When this item is sold, it will automatically deduct stock.
                  </p>
                  {menuForm.inventory_item_id && (
                    <div className="mt-2">
                      <label className="mb-1 block text-sm font-medium text-slate-700">Units depleted per sale</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className="input"
                        value={menuForm.depletion_qty}
                        onChange={(e) => setMenuForm({ ...menuForm, depletion_qty: e.target.value })}
                        placeholder="1"
                      />
                      <p className="mt-1 text-xs text-slate-500">
                        e.g. 1 for a full bottle, 0.5 for a half-measure
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setMenuModal(false)}
                disabled={menuSaving}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button type="submit" disabled={menuSaving} className="btn-primary flex-1">
                {menuSaving ? 'Saving...' : editingItem ? 'Update' : 'Add Item'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {voidModal && voidTarget && (
        <Modal title="Supervisor Void Approval" onClose={() => closeVoidModal()} size="sm">
          <form onSubmit={submitVoidApproval} className="space-y-4">
            <p className="text-sm text-slate-600">
              A supervisor, manager, or admin must approve this void. Enter their PIN to continue.
            </p>

            {voidError && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {voidError}
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Supervisor PIN *</label>
              <div className="relative">
                <input
                  type={showVoidPin ? 'text' : 'password'}
                  inputMode="numeric"
                  className="input pr-10"
                  placeholder="Enter PIN"
                  value={voidPin}
                  onChange={(e) => setVoidPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  autoFocus
                  maxLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowVoidPin((current) => !current)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showVoidPin ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Reason *</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Wrong item entered"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                maxLength={200}
              />
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => closeVoidModal()}
                disabled={voidLoading}
                className="flex-1 rounded-xl border border-slate-200 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={voidLoading}
                className="flex-1 rounded-xl bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {voidLoading ? 'Verifying...' : offlineMode ? 'Approve Offline Void' : 'Approve Void'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {returnModal && returnTarget && (
        <Modal title="Partial Return Approval" onClose={() => closeReturnModal()} size="md">
          <form onSubmit={submitPartialReturn} className="space-y-4">
            <p className="text-sm text-slate-600">
              Return selected items from this order. Stock-linked items will be restored and the return will appear as a negative POS order.
            </p>

            {returnError && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {returnError}
              </div>
            )}

            <div className="bb-table-shell">
              <HorizontalScrollArea>
                <table className="min-w-[640px] w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3 text-left">Item</th>
                      <th className="px-4 py-3 text-right">Sold</th>
                      <th className="px-4 py-3 text-right">Unit Price</th>
                      <th className="px-4 py-3 text-right">Return Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(returnTarget.pos_order_items || [])
                      .filter((line) => Number(line.quantity || 0) > 0 && Number(line.unit_price || 0) >= 0)
                      .map((line) => (
                        <tr key={line.id}>
                          <td className="px-4 py-3 font-medium text-slate-800">{line.item_name}</td>
                          <td className="px-4 py-3 text-right text-slate-600">{line.quantity}</td>
                          <td className="px-4 py-3 text-right text-slate-600">{currency} {fmt(line.unit_price)}</td>
                          <td className="px-4 py-3 text-right">
                            <input
                              type="number"
                              step="1"
                              min="0"
                              max={line.quantity}
                              className="input ml-auto w-24 text-right"
                              value={returnLines[line.id] || ''}
                              onChange={(e) => {
                                const maxQty = Number(line.quantity || 0)
                                const nextQty = Math.max(0, Math.min(maxQty, Number(e.target.value || 0)))
                                setReturnLines((current) => ({ ...current, [line.id]: e.target.value === '' ? '' : String(nextQty) }))
                              }}
                              placeholder="0"
                            />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </HorizontalScrollArea>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Refund Method</label>
                {returnTarget.payment_method === 'folio' ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
                    Room folio credit
                  </div>
                ) : (
                  <select className="input" value={returnPaymentMethod} onChange={(e) => setReturnPaymentMethod(e.target.value)}>
                    <option value="">Choose confirmed refund tender</option>
                    {DESKTOP_PAYMENT_METHODS.filter((method) => method.value !== 'bank_transfer' || returnTarget.payment_method === 'bank_transfer').map((method) => (
                      <option key={method.value} value={method.value}>{method.label}</option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Supervisor PIN *</label>
                <div className="relative">
                  <input
                    type={showReturnPin ? 'text' : 'password'}
                    inputMode="numeric"
                    className="input pr-10"
                    placeholder="Enter PIN"
                    value={returnPin}
                    onChange={(e) => setReturnPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    maxLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowReturnPin((current) => !current)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showReturnPin ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Reason *</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Guest returned one drink"
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                maxLength={200}
              />
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => closeReturnModal()}
                disabled={returnLoading}
                className="flex-1 rounded-xl border border-slate-200 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={returnLoading}
                className="flex-1 rounded-xl bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {returnLoading ? 'Verifying...' : offlineMode ? 'Approve Offline Return' : 'Approve Return'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {splitModal && currentOpenTab && (
        <Modal title="Split Bill" onClose={() => { setSplitModal(false); setSplitError('') }} size="md">
          <div className="space-y-4">
            <div className="flex gap-2 rounded-xl bg-slate-100 p-1">
              <button type="button" onClick={() => setSplitMode('items')} className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${splitMode === 'items' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Split by Items</button>
              <button type="button" onClick={() => setSplitMode('even')} className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${splitMode === 'even' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Split Evenly</button>
            </div>

            {splitError && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {splitError}
              </div>
            )}

            {splitMode === 'items' && (
              <>
                <p className="text-sm text-slate-600">
                  Select items to split to a new or existing table tab. Unselected items remain on this tab.
                </p>
                <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/45 p-2">
                  {(Array.isArray(currentOpenTab.items) ? currentOpenTab.items : []).map((item, idx) => {
                    const selected = splitItemIndices.includes(idx)
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => toggleSplitItem(idx)}
                        className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${selected ? 'bg-amber-50 ring-1 ring-amber-300' : 'bg-white hover:bg-slate-50'}`}
                      >
                        <span className={`flex h-5 w-5 items-center justify-center rounded border ${selected ? 'border-amber-500 bg-amber-500 text-white' : 'border-slate-300'}`}>
                          {selected && '✓'}
                        </span>
                        <span className="flex-1 truncate font-medium text-slate-800">{item.item_name}</span>
                        <span className="text-slate-500">×{item.quantity}</span>
                        <span className="font-semibold text-slate-700">
                          {recordedLineAmount(item) === null ? 'Amount unavailable' : `${currency} ${fmt(recordedLineAmount(item))}`}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Target Table (leave blank for new tab)</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. Table 2 or leave empty"
                    value={splitTargetTable}
                    onChange={(e) => setSplitTargetTable(e.target.value)}
                  />
                </div>
              </>
            )}

            {splitMode === 'even' && (
              <>
                <p className="text-sm text-slate-600">
                  Split the total bill evenly into equal parts. Each part becomes its own tab.
                </p>
                <div className="rounded-xl bg-blue-50 px-4 py-3 text-xs text-blue-700">
                  Tip: Split the bill before taking any payments. Payments already taken must be voided first.
                </div>
                <div className="rounded-xl bg-amber-50 p-3 text-center">
                  <p className="text-xs text-amber-600">Total</p>
                  <p className="text-lg font-bold text-amber-800">{currentOpenTabTotal === null ? 'Amount unavailable' : `${currency} ${fmt(currentOpenTabTotal)}`}</p>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Number of splits (2–10)</label>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setSplitEvenCount((c) => Math.max(2, c - 1))} className="h-10 w-10 rounded-xl border border-slate-200 bg-white text-lg font-bold text-slate-600 hover:bg-slate-50">−</button>
                    <span className="min-w-[3rem] text-center text-xl font-bold text-slate-900">{splitEvenCount}</span>
                    <button type="button" onClick={() => setSplitEvenCount((c) => Math.min(10, c + 1))} className="h-10 w-10 rounded-xl border border-slate-200 bg-white text-lg font-bold text-slate-600 hover:bg-slate-50">+</button>
                    <span className="ml-2 text-sm text-slate-500">{currentOpenTabTotal === null ? 'Each amount unavailable' : `= ${currency} ${fmt(currentOpenTabTotal / splitEvenCount)} each`}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">Tab names (optional)</label>
                  {Array.from({ length: splitEvenCount }).map((_, i) => (
                    <input
                      key={i}
                      type="text"
                      className="input text-sm"
                      placeholder={`Split ${i + 1} (auto-named if empty)`}
                      value={splitEvenNames[i] || ''}
                      onChange={(e) => {
                        const next = [...splitEvenNames]
                        next[i] = e.target.value
                        setSplitEvenNames(next)
                      }}
                    />
                  ))}
                </div>
              </>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setSplitModal(false)}
                disabled={splitLoading}
                className="flex-1 rounded-xl border border-slate-200 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeSplitBill}
                disabled={splitLoading || currentOpenTabTotal === null || (splitMode === 'items' && splitItemIndices.length === 0) || (splitMode === 'even' && (splitEvenCount < 2 || splitEvenCount > 10))}
                className="flex-1 rounded-xl bg-amber-600 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {splitLoading ? 'Splitting...' : splitMode === 'even' ? `Split into ${splitEvenCount} Equal Parts` : `Split ${splitItemIndices.length} Item(s)`}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {discountApprovalModal && (
        <Modal title="Discount Approval Required" onClose={() => { setDiscountApprovalModal(false); setDiscountApprovalPin(''); setDiscountApprovalError('') }} size="sm">
          <form onSubmit={submitDiscountApproval} className="space-y-4">
            <p className="text-sm text-slate-600">
              A manual discount of {currency} {fmt(orderDiscountAmount)} requires manager approval. Enter a supervisor PIN to continue.
            </p>

            {discountApprovalError && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {discountApprovalError}
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Manager PIN *</label>
              <div className="relative">
                <input
                  type={showDiscountApprovalPin ? 'text' : 'password'}
                  inputMode="numeric"
                  className="input pr-10"
                  placeholder="Enter PIN"
                  value={discountApprovalPin}
                  onChange={(e) => setDiscountApprovalPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  autoFocus
                  maxLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowDiscountApprovalPin((current) => !current)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showDiscountApprovalPin ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => { setDiscountApprovalModal(false); setDiscountApprovalPin(''); setDiscountApprovalError('') }}
                disabled={discountApprovalLoading}
                className="flex-1 rounded-xl border border-slate-200 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={discountApprovalLoading || !discountApprovalPin.trim()}
                className="flex-1 rounded-xl bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {discountApprovalLoading ? 'Verifying...' : 'Approve & Submit Order'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showReceiptOrder && (
        <POSReceipt
          order={showReceiptOrder}
          autoPrint={showReceiptOrder?._auto_print === true}
          onClose={() => setShowReceiptOrder(null)}
        />
      )}

      {/* Keyboard shortcuts help overlay */}
      {showKeyboardHelp && (
        <POSKeyboardHelp onClose={() => setShowKeyboardHelp(false)} />
      )}
    </div>
  )
}
