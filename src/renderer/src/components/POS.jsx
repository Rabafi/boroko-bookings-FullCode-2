import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Pencil, Trash2, ShoppingCart, X, ChevronDown, ChevronUp, Scan, Eye, EyeOff } from 'lucide-react'
import { Modal } from './shared/Modal'
import HorizontalScrollArea from './shared/HorizontalScrollArea'
import { DESKTOP_PAYMENT_METHODS, formatPaymentMethod } from '../constants/paymentMethods'
import { useSettings, useAccess, useAuth } from '../App'
import { canAccessCapability } from '../../../shared/accessControl'

const MENU_CATEGORIES = ['Food', 'Drinks', 'Other']
const BAR_PACK_TEMPLATES = [
  { size: 6, label: '6 Pack' },
  { size: 12, label: '12 Pack' },
  { size: 24, label: 'Case (24)' }
]
const POS_LIVE_REFRESH_MS = 5000

const formatLocalDate = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const today = () => formatLocalDate()

function fmt(v) {
  return Number(v || 0).toFixed(2)
}

function normalizeOrderSyncState(order) {
  if (order?._sync_state === 'failed') return 'failed'
  if (order?._sync_state === 'pending') return 'pending'
  if (order?._pending_sync === true) return 'pending'
  return 'synced'
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

function getInventoryAvailableUnits(inventoryMap, inventoryItemId, depletionQty = 1) {
  if (!inventoryItemId) return Number.POSITIVE_INFINITY
  const inventoryRow = inventoryMap.get(inventoryItemId)
  if (!inventoryRow) return 0
  const stock = normalizeStockValue(inventoryRow.current_stock)
  const depletion = Math.max(1, Number(depletionQty || 1))
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
    const delta = Math.max(0, Number(item.quantity || 0)) * Math.max(1, Number(item.depletion_qty || 1))
    usage.set(item.inventory_item_id, (usage.get(item.inventory_item_id) || 0) + delta)
  }
  return usage
}

export default function POS() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const access = useAccess()
  const { user: currentUser } = useAuth()

  // Permission flags
  const canVoid       = canAccessCapability(access, 'pos.void')
  const canManageMenu = canAccessCapability(access, 'pos.menu_manage')

  const [tab, setTab] = useState('terminal') // terminal | menu | history

  // Outlets
  const [outlets, setOutlets] = useState([])
  const [outletsLoading, setOutletsLoading] = useState(true)
  const [outletsError, setOutletsError] = useState(false)
  const [selectedOutlet, setSelectedOutlet] = useState(null)

  // Menu items
  const [menuItems, setMenuItems] = useState([])
  const [menuLoading, setMenuLoading] = useState(false)
  const [menuSearch, setMenuSearch] = useState('')

  // Current order (terminal)
  const [orderItems, setOrderItems] = useState([])
  const [customerType, setCustomerType] = useState('room') // room | walkin
  const [rooms, setRooms] = useState([])
  const [selectedRoom, setSelectedRoom] = useState('')
  const [walkInName, setWalkInName] = useState('')
  const [orderNotes, setOrderNotes] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [submitting, setSubmitting] = useState(false)
  const [orderSuccess, setOrderSuccess] = useState(false)
  const [syncStatus, setSyncStatus] = useState(null)

  // Barcode scanner
  const barcodeBufferRef = useRef('')
  const barcodeTimerRef = useRef(null)
  const selectedOutletRef = useRef(null)
  const outletsRef = useRef([])
  const menuItemsRef = useRef([])
  const inventoryItemsRef = useRef([])
  const liveRefreshBusyRef = useRef(false)
  const [barcodeFlash, setBarcodeFlash] = useState(null) // null | { name, found, wrongOutlet? }

  // Order history
  const [orders, setOrders] = useState([])
  const [voidHistory, setVoidHistory] = useState([])
  const [ordersError, setOrdersError] = useState(null)
  const [histStart, setHistStart] = useState(today())
  const [histEnd, setHistEnd] = useState(today())
  const [expandedOrder, setExpandedOrder] = useState(null)
  const [voidModal, setVoidModal] = useState(false)
  const [voidTarget, setVoidTarget] = useState(null)
  const [voidPin, setVoidPin] = useState('')
  const [voidReason, setVoidReason] = useState('')
  const [voidError, setVoidError] = useState('')
  const [voidLoading, setVoidLoading] = useState(false)
  const [showVoidPin, setShowVoidPin] = useState(false)

  // Inventory items (for depletion linking)
  const [inventoryItems, setInventoryItems] = useState([])

  // Menu item form modal
  const [menuModal, setMenuModal] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [menuForm, setMenuForm] = useState({
    name: '', category: 'Food', price: '', barcode: '',
    inventory_item_id: '', depletion_qty: '1', outlet_id: ''
  })
  const [menuSaving, setMenuSaving] = useState(false)
  const [menuError, setMenuError] = useState('')
  const [barTemplateSavingKey, setBarTemplateSavingKey] = useState('')

  // Outlets filtered to what this user is allowed to access
  // access.allowedOutletIds === null means full access (manager/admin)
  const posOutlets = useMemo(
    () => outlets.filter((outlet) => outlet.type === 'food' || outlet.type === 'beverage'),
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
  const inventoryById = useMemo(
    () => new Map((inventoryItems || []).map((item) => [item.id, item])),
    [inventoryItems]
  )

  useEffect(() => {
    selectedOutletRef.current = selectedOutlet
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
    setMenuLoading(true)
    try {
      const data = await window.api.pos.getMenuItems().catch(() => [])
      setMenuItems(data || [])
    } finally {
      setMenuLoading(false)
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

  const loadOrders = useCallback(async () => {
    setOrdersError(null)
    try {
      const [data, voids] = await Promise.all([
        window.api.pos.getOrders(histStart, histEnd),
        window.api.pos.getVoidHistory(histStart, histEnd).catch(() => [])
      ])
      setOrders(data || [])
      setVoidHistory(voids || [])
    } catch (err) {
      setOrders([])
      setVoidHistory([])
      setOrdersError(err?.message || 'Failed to load orders')
    }
  }, [histEnd, histStart])

  useEffect(() => {
    loadMenu()
    loadRooms()
    loadInventoryItems()
    // Load outlets for order tagging and menu filtering
    setOutletsLoading(true)
    window.api.outlets.getAll()
      .then((d) => {
        const list = d || []
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
      if (mounted) setSyncStatus(status || null)
    })

    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [])

  const offlineMode = isSyncOffline(syncStatus)
  const walkInPaymentNeedsVerification = offlineMode && customerType === 'walkin' && paymentMethod !== 'cash'
  const refreshLivePosState = useCallback(async ({ includeOrders = true } = {}) => {
    if (offlineMode || liveRefreshBusyRef.current) return
    liveRefreshBusyRef.current = true
    try {
      const tasks = [loadMenu(), loadInventoryItems()]
      if (includeOrders) tasks.push(loadOrders())
      await Promise.all(tasks)
    } finally {
      liveRefreshBusyRef.current = false
    }
  }, [loadInventoryItems, loadMenu, loadOrders, offlineMode])

  useEffect(() => {
    if (offlineMode) return undefined

    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      refreshLivePosState({ includeOrders: true })
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
  }, [offlineMode, refreshLivePosState])

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
          const currentMenuItems = menuItemsRef.current || []
          const currentInventoryMap = new Map((inventoryItemsRef.current || []).map((item) => [item.id, item]))
          const currentSelectedOutlet = selectedOutletRef.current
          const currentOutlets = outletsRef.current || []
          const found = currentMenuItems.find((m) => m.barcode === code && m.is_available)
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
        unit_price: item.price,
        quantity: 1,
        inventory_item_id: item.inventory_item_id || null,
        depletion_qty: Number(item.depletion_qty || 1)
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
  }

  const updateQty = (idx, delta) => {
    setOrderItems((prev) => {
      const updated = [...prev]
      updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + delta }
      if (updated[idx].quantity <= 0) updated.splice(idx, 1)
      return updated
    })
  }

  const orderTotal = orderItems.reduce((s, i) => s + i.quantity * i.unit_price, 0)
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

  const completeOrder = async () => {
    if (orderItems.length === 0) return
    if (outletsError || !selectedOutlet) { alert('No outlet is selected. Select Kitchen or Bar before completing the order.'); return }
    if (customerType === 'room' && !selectedRoom) { alert('Select a room first.'); return }
    if (customerType === 'walkin' && !walkInName.trim()) { alert('Enter the guest name.'); return }
    if (orderStockIssues.length > 0) {
      alert(`${orderStockIssues[0].itemName} no longer has enough stock for this order. Refresh the quantities and try again.`)
      return
    }

    setSubmitting(true)
    try {
      if (customerType === 'room') {
        const booking = await window.api.pos.getActiveBookingForRoom(selectedRoom)
        if (!booking?.id) {
          alert('No active booking found for this room. The guest may not be checked in yet.')
          setSubmitting(false)
          return
        }
      }

      const result = await window.api.pos.createOrder({
        room_id: customerType === 'room' ? selectedRoom : null,
        walk_in_name: customerType === 'walkin' ? walkInName.trim() : null,
        items: orderItems,
        notes: orderNotes.trim() || null,
        payment_method: customerType === 'room' ? 'folio' : paymentMethod,
        outlet_id: selectedOutlet.id
      })
      if (result?.success) {
        setOrderItems([])
        setWalkInName('')
        setOrderNotes('')
        setPaymentMethod('cash')
        await refreshLivePosState({ includeOrders: true })
        setOrderSuccess(true)
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
            <div key={i} className="h-12 flex-1 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      )
    }
    if (outletsError || outlets.length === 0) {
      return (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Outlets could not be loaded. POS needs an active Kitchen or Bar outlet before it can continue.
        </div>
      )
    }
    if (visibleOutlets.length === 0) {
      return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
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
              key={o.id}
              onClick={() => setSelectedOutlet(o)}
              className={`flex-1 rounded-xl py-3 text-sm font-semibold transition-all ${isActive ? c.active : c.idle}`}
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
      outlet_id: selectedOutlet?.id || '' // default to active outlet for accurate reporting
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
      outlet_id: item.outlet_id || '' // keep existing assignment if set
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
  const filteredVisibleMenuItems = visibleMenuItems.filter((item) => {
    if (!normalizedMenuSearch) return true
    return (
      String(item.name || '').toLowerCase().includes(normalizedMenuSearch) ||
      String(item.barcode || '').toLowerCase().includes(normalizedMenuSearch)
    )
  })

  const menuByCategory = MENU_CATEGORIES.reduce((acc, cat) => {
    acc[cat] = filteredVisibleMenuItems.filter((m) => m.category === cat && m.is_available !== false)
    return acc
  }, {})

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
    if (offlineMode) {
      setVoidError('Requires internet connection')
      return
    }
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
        cashier_user_id: currentUser?.id || null,
        outlet_id: voidTarget.outlet_id || selectedOutlet?.id || null
      })

      if (res?.success) {
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

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="bb-page-header">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700/70">Bar & Kitchen</p>
          <h1 className="bb-page-header-title mt-2">Point of Sale</h1>
          <p className="bb-page-header-subtitle">Take guest and walk-in orders, manage menu items, and review recent POS history.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className={`rounded-2xl border px-3.5 py-3 text-sm shadow-sm ${
            offlineMode
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}>
            <p className="font-semibold">{offlineMode ? 'Offline POS mode' : 'POS synced and live'}</p>
            <p className="mt-1 text-xs opacity-80">
              {offlineMode ? 'Stock and remote payment confirmation may be delayed.' : 'Stock and sales are updating from the latest synced state.'}
            </p>
          </div>
          <div className="bb-card flex gap-1 p-2">
          {[['terminal', 'Terminal'], ...(canManageMenu ? [['menu', 'Menu Items']] : []), ['history', 'History']].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setTab(v)}
              className={`rounded-xl px-4 py-2 transition-all ${
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

      {/* ── Terminal ── */}
      {tab === 'terminal' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          {/* Menu items panel */}
          <div className="xl:col-span-2 space-y-5">

            {/* ── Outlet selector ── */}
            {renderOutletSelector()}

            {offlineMode && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Offline mode: POS is using the last synced menu. Stock may be estimated, and new orders will sync automatically when internet returns.
              </div>
            )}

            {walkInPaymentNeedsVerification && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-sm">
                Offline caution: {formatPaymentMethod(paymentMethod)} payments for walk-ins are not remotely verified right now. Confirm proof or switch to cash before completing the order.
              </div>
            )}

            {/* Barcode scanner feedback banner */}
            {barcodeFlash && (
              <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium ${
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

            <div className="bb-card p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Find products quickly</p>
                  <p className="text-xs text-slate-500">Search by product name or barcode inside the active outlet.</p>
                </div>
                <input
                  type="text"
                  className="input w-full sm:max-w-sm"
                  placeholder="Search products or barcode..."
                  value={menuSearch}
                  onChange={(e) => setMenuSearch(e.target.value)}
                />
              </div>
            </div>

            {menuLoading ? (
              <div className="bb-empty-state min-h-[180px]">
                <p className="text-sm font-medium text-slate-500">Loading menu…</p>
              </div>
            ) : (
              MENU_CATEGORIES.map((cat) => {
                const items = menuByCategory[cat]
                if (items.length === 0) return null
                return (
                <div key={cat} className="bb-card p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{cat}</h3>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-500">
                        {items.length} item{items.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {items.map((item) => {
                        const crossOutlet = getCrossOutletName(item)
                        const availableUnits = getInventoryAvailableUnits(inventoryById, item.inventory_item_id, item.depletion_qty)
                        const soldOut = !isOrderableMenuItem(item, inventoryById)
                        return (
                        <button
                          key={item.id}
                          disabled={soldOut || !!crossOutlet}
                          onClick={() => {
                            if (crossOutlet) {
                              alert(`"${item.name}" belongs to ${crossOutlet}. Switch outlets to add it.`)
                              return
                            }
                            if (soldOut) {
                              alert(`"${item.name}" is sold out on the latest synced stock.`)
                              return
                            }
                            addToOrder(item)
                          }}
                          className={`bb-card p-3 text-left transition-all ${soldOut ? 'cursor-not-allowed opacity-60' : 'hover:-translate-y-[1px] hover:ring-2 hover:ring-green-400'}`}
                        >
                          <p className="truncate text-sm font-medium text-slate-800">{item.name}</p>
                          <p className="text-green-700 font-semibold text-sm mt-0.5">
                            {currency} {fmt(item.price)}
                          </p>
                          {Number.isFinite(availableUnits) && (
                            <p className={`mt-0.5 text-xs ${soldOut ? 'text-red-600' : availableUnits <= 3 ? 'text-amber-600' : 'text-slate-400'}`}>
                              {soldOut ? 'Sold out' : `${availableUnits} left`}
                            </p>
                          )}
                          {item.barcode && (
                            <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
                              <Scan size={10} /> {item.barcode}
                            </p>
                          )}
                        </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })
            )}
            {filteredVisibleMenuItems.filter((m) => m.is_available !== false).length === 0 && !menuLoading && !outletsLoading && (
              <div className="bb-empty-state min-h-[220px]">
                <ShoppingCart size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-base font-semibold text-slate-800">
                  {normalizedMenuSearch ? 'No matching products' : 'No menu items yet'}
                </p>
                <p className="text-sm text-slate-500">
                  {normalizedMenuSearch
                    ? 'Try a different name, barcode, or switch outlets.'
                    : 'Go to Menu Items to add products before taking orders.'}
                </p>
              </div>
            )}

            {/* Barcode scanner hint */}
            {menuItems.some((m) => m.barcode && m.is_available) && (
              <p className="flex items-center gap-1 text-xs text-slate-400">
                <Scan size={12} /> Barcode scanner ready — click outside inputs and scan
              </p>
            )}
          </div>

          {/* Order panel */}
            <div className="bb-card sticky top-6 flex h-fit flex-col p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-700">
              <ShoppingCart size={16} /> Current Order
            </h2>

            {/* Customer type */}
            <div className="mb-3 flex overflow-hidden rounded-xl border border-slate-200 text-xs">
              <button
                onClick={() => setCustomerType('room')}
                className={`flex-1 py-1.5 transition-colors ${customerType === 'room' ? 'bg-green-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                Room Guest
              </button>
              <button
                onClick={() => setCustomerType('walkin')}
                className={`flex-1 py-1.5 transition-colors ${customerType === 'walkin' ? 'bg-green-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                Walk-in
              </button>
            </div>

            {customerType === 'room' ? (
                <select
                className="input mb-3 text-sm"
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
            ) : (
              <>
                <input
                  type="text"
                  className="input mb-2 text-sm"
                  placeholder="Guest name..."
                  value={walkInName}
                  onChange={(e) => setWalkInName(e.target.value)}
                />
                <div className="mb-3">
                  <select
                    className="input text-sm"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                  >
                    {DESKTOP_PAYMENT_METHODS.map((method) => (
                      <option key={method.value} value={method.value}>{method.label}</option>
                    ))}
                  </select>
                  {paymentMethod === 'bank_transfer' && (
                    <p className="mt-1 text-xs text-slate-500">
                      Bank transfer payments must include proof of payment before completion.
                    </p>
                  )}
                </div>
              </>
            )}

            {/* Order items */}
            <div className="flex-1 space-y-2 min-h-[80px] mb-3">
              {orderItems.length === 0 ? (
                <div className="bb-card-muted py-6 text-center">
                <p className="text-xs text-slate-500">
                  Tap items or scan barcodes to add them
                </p>
                </div>
              ) : (
                orderItems.map((item, idx) => (
                  <div key={item.order_key} className="rounded-xl border border-slate-100 bg-slate-50/70 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm text-slate-800">{item.item_name}</p>
                      <p className="text-xs text-slate-400">{currency} {fmt(item.unit_price)} ea</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => updateQty(idx, -1)}
                        className="flex h-6 w-6 items-center justify-center rounded bg-slate-100 text-sm font-bold text-slate-600 hover:bg-red-50 hover:text-red-600"
                      >−</button>
                      <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                      <button
                        onClick={() => updateQty(idx, 1)}
                        className="flex h-6 w-6 items-center justify-center rounded bg-slate-100 text-sm font-bold text-slate-600 hover:bg-green-50 hover:text-green-600"
                      >+</button>
                    </div>
                    <span className="w-16 shrink-0 text-right text-sm font-semibold text-slate-800">
                      {currency} {fmt(item.quantity * item.unit_price)}
                    </span>
                  </div>
                  </div>
                ))
              )}
            </div>

            {orderStockIssues.length > 0 && (
              <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-xs text-red-700">
                <p className="font-semibold">Stock changed on another terminal</p>
                <p className="mt-1">
                  {orderStockIssues[0].itemName} now has only {fmt(orderStockIssues[0].availableStock)} stock unit(s) available,
                  but this order needs {fmt(orderStockIssues[0].requiredStock)}.
                </p>
              </div>
            )}

            {orderItems.length > 0 && (
              <>
                <textarea
                  className="input text-sm mb-3 resize-none"
                  rows={2}
                  placeholder="Notes (optional)..."
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                />
                <div className="mb-3 border-t border-slate-100 pt-3">
                  <div className="flex justify-between font-bold text-slate-800">
                    <span>Total</span>
                    <span>{currency} {fmt(orderTotal)}</span>
                  </div>
                  {customerType === 'room' && selectedRoom ? (
                    offlineMode ? (
                      <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900">
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
                <div className="flex gap-2">
                  <button
                    onClick={() => setOrderItems([])}
                    disabled={submitting}
                    className="btn-secondary flex-1 flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <X size={14} /> Clear
                  </button>
                  <button
                    onClick={completeOrder}
                    disabled={submitting || orderStockIssues.length > 0}
                    className="btn-primary flex-1"
                  >
                    {submitting ? 'Processing...' : 'Complete Order'}
                  </button>
                </div>
              </>
            )}

            {orderSuccess && (
              <div className="mt-3 rounded-xl bg-green-50 p-3 text-center text-xs text-green-700">
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
                  Bottle items come from Bar inventory automatically. Enable 6-pack, 12-pack, and case templates here for faster cashier sales.
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
                      <div key={inventoryItem.id} className="bb-card p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-lg font-semibold text-slate-900">{inventoryItem.name}</p>
                            <p className="mt-1 text-sm text-slate-500">
                              Bottle price: <span className="font-semibold text-slate-800">{currency} {fmt(inventoryItem.selling_price)}</span>
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              Stock: {inventoryItem.current_stock} {inventoryItem.unit}
                            </p>
                          </div>
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${singleItem ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-amber-200 bg-amber-50 text-amber-700'}`}>
                            {singleItem ? 'Single bottle live in POS' : 'Waiting for POS bottle sync'}
                          </span>
                        </div>

                        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-800">Bottle barcode</p>
                              <p className="text-xs text-slate-500">Keep scanning on the bottle item only. Packs stay barcode-free by default.</p>
                            </div>
                            {singleItem && !singleItem._virtual_inventory_item ? (
                              <button
                                onClick={() => openEditMenu(singleItem)}
                                disabled={menuMutationsDisabled}
                                title={offlineMode ? 'Requires internet connection' : undefined}
                                className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Edit Barcode
                              </button>
                            ) : singleItem?._virtual_inventory_item ? (
                              <span className="text-xs text-emerald-600">Ready to sell from inventory pricing</span>
                            ) : (
                              <span className="text-xs text-slate-400">Available after bottle sync</span>
                            )}
                          </div>
                          <p className="mt-2 text-xs font-mono text-slate-500">{singleItem?.barcode || 'No barcode set'}</p>
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                          {BAR_PACK_TEMPLATES.map(({ size, label }) => {
                            const packItem = packRows[size]
                            const saving = barTemplateSavingKey === `${inventoryItem.id}:${size}`
                            return (
                              <div key={size} className="rounded-2xl border border-slate-200 p-4">
                                <p className="text-sm font-semibold text-slate-800">{label}</p>
                                <p className="mt-1 text-sm text-slate-500">{currency} {fmt(Number(inventoryItem.selling_price || 0) * size)}</p>
                                <p className="mt-1 text-xs text-slate-400">Deducts {size} bottles from stock</p>
                                <button
                                  onClick={() => toggleBarPackTemplate(inventoryItem.id, size, !packItem)}
                                  disabled={saving || !singleItem || menuMutationsDisabled}
                                  title={offlineMode ? 'Requires internet connection' : undefined}
                                  className={`mt-3 w-full rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${packItem ? 'bg-blue-600 text-white hover:bg-blue-700' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'} disabled:cursor-not-allowed disabled:opacity-60`}
                                >
                                  {saving ? 'Saving...' : packItem ? 'Disable Template' : 'Enable Template'}
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
          <div className="bb-filter-bar mb-5 flex-wrap">
            <div className="flex items-center gap-2 text-sm">
              <label className="text-slate-500">From</label>
              <input type="date" className="input text-sm"
                value={histStart} onChange={(e) => setHistStart(e.target.value)} />
              <label className="text-slate-500">To</label>
              <input type="date" className="input text-sm"
                value={histEnd} onChange={(e) => setHistEnd(e.target.value)} />
            </div>
          </div>
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
                <p className="text-sm text-slate-500">Change the date range or complete a POS order to populate history.</p>
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
                            ? 'Room Guest'
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
                          {o.payment_method && o.payment_method !== 'folio' && <span className="text-xs text-slate-600">{formatPaymentMethod(o.payment_method, { plain: true })}</span>}
                          {o.payment_method === 'folio' && <span className="text-xs text-green-600">📋 Folio</span>}
                          {!o.payment_method && <span className="text-xs text-slate-400">—</span>}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                              o.status === 'completed' ? 'bg-green-100 text-green-700' :
                              o.status === 'voided' ? 'bg-red-100 text-red-600' :
                              'bg-yellow-100 text-yellow-700'
                            }`}>{o.status}</span>
                            {syncState === 'failed' && (
                              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                                Failed Sync
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
                          {currency} {fmt(o.total)}
                        </td>
                        <td className="px-5 py-3 text-center text-slate-400">
                          {expandedOrder === o.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
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
                                <p className="mt-1">{syncError}</p>
                                <p className="mt-1 text-red-600">Retry from System Health</p>
                              </div>
                            )}
                            {o.status === 'voided' && (
                              <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                                <p className="font-semibold">Void record</p>
                                <p className="mt-1">
                                  Approved by: {voidEntry?.approver_name || 'Recorded in system'}
                                  {voidEntry?.created_at ? ` · ${new Date(voidEntry.created_at).toLocaleString()}` : ''}
                                </p>
                                <p className="mt-1">
                                  Reason: {voidEntry?.reason || 'No reason recorded'}
                                </p>
                              </div>
                            )}
                            {o.status !== 'voided' && (
                              canVoid ? (
                                <button
                                  onClick={async () => {
                                    if (offlineMode) return
                                    if (!confirm('Void this order?')) return
                                    try {
                                      const res = await window.api.pos.voidOrder(o.id)
                                      if (!res?.success) alert(res?.error || 'Failed to void order.')
                                    } catch (err) {
                                      alert(err?.message || 'Failed to void order.')
                                    }
                                    await refreshLivePosState({ includeOrders: true })
                                  }}
                                  disabled={offlineMode}
                                  title={offlineMode ? 'Requires internet connection' : undefined}
                                  className="mt-2 text-xs text-red-500 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  Void Order
                                </button>
                              ) : (
                                <button
                                  onClick={() => openVoidModal(o)}
                                  disabled={offlineMode}
                                  title={offlineMode ? 'Requires internet connection' : undefined}
                                  className="mt-2 text-xs text-amber-600 hover:text-amber-800 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  Request Void Approval
                                </button>
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
                    <option value="">— Unassigned —</option>
                    {posOutlets.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    Assigning an outlet ensures this item is counted correctly in Kitchen or Bar reports.
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
                disabled={voidLoading || offlineMode}
                className="flex-1 rounded-xl bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {voidLoading ? 'Verifying…' : 'Approve Void'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
