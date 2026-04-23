import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ClipboardCheck,
  FileDown,
  FileSpreadsheet,
  Package2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  ShoppingBag,
  Trash2,
  TrendingDown
} from 'lucide-react'
import { Modal } from './shared/Modal'
import HorizontalScrollArea from './shared/HorizontalScrollArea'
import { useSettings } from '../app-context'

const SUPPLY_CATEGORIES = ['Bathroom', 'Linen', 'Kitchen', 'Other']
const SUPPLY_UNITS = ['roll', 'piece', 'bar', 'sachet', 'packet', 'pack', 'box', 'sheet', 'pair', 'ml', 'L', 'kg']
const today = () => new Date().toISOString().split('T')[0]

function fmt(v, dp = 2) { return Number(v || 0).toFixed(dp) }
function fmtQty(v) {
  const value = Number(v || 0)
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)
}
function monthStart() {
  const d = new Date()
  d.setDate(1)
  return d.toISOString().split('T')[0]
}
function shortDateTime(value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch {
    return String(value)
  }
}
function sortItems(list) {
  return [...(list || [])].sort((a, b) => String(a.category || '').localeCompare(String(b.category || '')) || String(a.name || '').localeCompare(String(b.name || '')))
}
function sortRooms(list) {
  return [...(list || [])].sort((a, b) => String(a.room_number || '').localeCompare(String(b.room_number || ''), undefined, { numeric: true, sensitivity: 'base' }))
}
function getStoreStatus(item) {
  const stock = Number(item?.current_stock || 0)
  const reorder = Number(item?.reorder_level || 0)
  if (stock <= 0) return { label: 'Out', tone: 'border-red-200 bg-red-50 text-red-700', warning: true }
  if (reorder > 0 && stock <= reorder) return { label: 'Low', tone: 'border-amber-200 bg-amber-50 text-amber-700', warning: true }
  return { label: 'Healthy', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700', warning: false }
}
function getRoomStatus(row) {
  const qty = Number(row?.quantity_on_hand || 0)
  const reorder = Number(row?.reorder_level || 0)
  if (qty <= 0) return { label: 'Empty', tone: 'border-red-200 bg-red-50 text-red-700', warning: true }
  if (reorder > 0 && qty <= reorder) return { label: 'Low', tone: 'border-amber-200 bg-amber-50 text-amber-700', warning: true }
  return { label: 'Loaded', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700', warning: false }
}
function movementLabel(type) {
  switch (type) {
    case 'purchase': return 'Purchase'
    case 'load': return 'Loaded'
    case 'use': return 'Used'
    case 'return': return 'Returned'
    case 'adjustment': return 'Adjusted'
    default: return type || 'Movement'
  }
}

export default function RoomSupplies() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'

  const [tab, setTab] = useState('stock')
  const [pageError, setPageError] = useState('')
  const [supplyItems, setSupplyItems] = useState([])
  const [rooms, setRooms] = useState([])
  const [roomStockRows, setRoomStockRows] = useState([])
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(false)

  const [itemModal, setItemModal] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [itemSaving, setItemSaving] = useState(false)
  const [itemError, setItemError] = useState('')
  const [itemForm, setItemForm] = useState({ name: '', category: 'Bathroom', unit: 'roll', reorder_level: '', current_stock: '' })

  const [purchaseModal, setPurchaseModal] = useState(false)
  const [purchaseItem, setPurchaseItem] = useState(null)
  const [purchaseSaving, setPurchaseSaving] = useState(false)
  const [purchaseError, setPurchaseError] = useState('')
  const [purchaseForm, setPurchaseForm] = useState({ date: today(), quantity_purchased: '', total_cost: '', notes: '', package_count: '', units_per_package: '' })

  const [adjustModal, setAdjustModal] = useState(false)
  const [adjustItem, setAdjustItem] = useState(null)
  const [adjustSaving, setAdjustSaving] = useState(false)
  const [adjustError, setAdjustError] = useState('')
  const [adjustDelta, setAdjustDelta] = useState('')
  const [adjustNotes, setAdjustNotes] = useState('')
  const [adjustPin, setAdjustPin] = useState('')

  const [movementModal, setMovementModal] = useState(false)
  const [movementType, setMovementType] = useState('load')
  const [movementTarget, setMovementTarget] = useState(null)
  const [movementSaving, setMovementSaving] = useState(false)
  const [movementError, setMovementError] = useState('')
  const [movementForm, setMovementForm] = useState({ item_id: '', room_id: '', quantity: '', reorder_level: '1', notes: '' })

  const [reportStart, setReportStart] = useState(monthStart())
  const [reportEnd, setReportEnd] = useState(today())
  const [reportData, setReportData] = useState([])
  const [reportLoading, setReportLoading] = useState(false)
  const [reportExporting, setReportExporting] = useState(false)
  const [reportPdfExporting, setReportPdfExporting] = useState(false)
  const [reportMessage, setReportMessage] = useState(null)

  const [stocktakes, setStocktakes] = useState([])
  const [activeStocktakeId, setActiveStocktakeId] = useState('')
  const [activeStocktake, setActiveStocktake] = useState(null)
  const [roomStocktakes, setRoomStocktakes] = useState([])
  const [activeRoomStocktakeId, setActiveRoomStocktakeId] = useState('')
  const [activeRoomStocktake, setActiveRoomStocktake] = useState(null)
  const [stocktakeScope, setStocktakeScope] = useState('store')
  const [stocktakeTitle, setStocktakeTitle] = useState('')
  const [stocktakeNotes, setStocktakeNotes] = useState('')
  const [stocktakeSaving, setStocktakeSaving] = useState(false)
  const [stocktakePosting, setStocktakePosting] = useState(false)
  const [stocktakeLoading, setStocktakeLoading] = useState(false)
  const [stocktakeError, setStocktakeError] = useState('')
  const [missingRoomLine, setMissingRoomLine] = useState({ room_id: '', item_id: '', counted_qty: '', notes: '' })

  useEffect(() => { refreshBaseData() }, [])
  useEffect(() => { if (tab === 'report') loadReport() }, [tab, reportStart, reportEnd])
  useEffect(() => { if (tab === 'stocktake') loadStocktakes(stocktakeScope) }, [tab, stocktakeScope])
  useEffect(() => {
    if (tab !== 'stocktake') return
    const currentId = stocktakeScope === 'store' ? activeStocktakeId : activeRoomStocktakeId
    if (currentId) loadStocktakeSession(currentId, stocktakeScope)
  }, [tab, activeStocktakeId, activeRoomStocktakeId, stocktakeScope])

  const roomStockByItem = useMemo(() => {
    const map = {}
    for (const row of roomStockRows) map[row.supply_item_id] = (map[row.supply_item_id] || 0) + Number(row.quantity_on_hand || 0)
    return map
  }, [roomStockRows])
  const storeLowItems = useMemo(() => supplyItems.filter((item) => getStoreStatus(item).warning), [supplyItems])
  const roomLowRows = useMemo(() => roomStockRows.filter((row) => getRoomStatus(row).warning), [roomStockRows])
  const roomOutRows = useMemo(() => roomStockRows.filter((row) => Number(row.quantity_on_hand || 0) <= 0), [roomStockRows])
  const totalLoadedUnits = useMemo(() => roomStockRows.reduce((sum, row) => sum + Number(row.quantity_on_hand || 0), 0), [roomStockRows])

  const reportByRoom = reportData.reduce((acc, row) => {
    const key = row.room_number || row.room_id
    if (!acc[key]) acc[key] = { room_number: row.room_number, total: 0 }
    acc[key].total += Number(row.total_cost || 0)
    return acc
  }, {})
  const reportByItem = reportData.reduce((acc, row) => {
    const key = row.supply_name
    if (!acc[key]) acc[key] = { name: key, unit: row.supply_unit, total_units: 0, total_cost: 0 }
    acc[key].total_units += Number(row.units_used || 0)
    acc[key].total_cost += Number(row.total_cost || 0)
    return acc
  }, {})
  const grandTotal = reportData.reduce((sum, row) => sum + Number(row.total_cost || 0), 0)
  const currentStocktake = stocktakeScope === 'store' ? activeStocktake : activeRoomStocktake
  const currentStocktakeId = stocktakeScope === 'store' ? activeStocktakeId : activeRoomStocktakeId
  const currentStocktakes = stocktakeScope === 'store' ? stocktakes : roomStocktakes
  const stocktakeProgress = useMemo(() => {
    const lines = currentStocktake?.lines || []
    const counted = lines.filter((line) => line.counted_qty !== null && line.counted_qty !== '' && !Number.isNaN(Number(line.counted_qty))).length
    const variances = lines.filter((line) => Number(line.variance_qty || 0) !== 0).length
    return { total: lines.length, counted, variances }
  }, [currentStocktake])
  const stocktakeMissingCosts = useMemo(
    () => (currentStocktake?.lines || []).filter((line) => Number(line.unit_cost || 0) <= 0).length,
    [currentStocktake]
  )

  async function refreshBaseData() {
    setLoading(true)
    setPageError('')
    try {
      const [itemData, roomData, stockData, movementData] = await Promise.all([
        window.api.supplies.getItems().catch(() => []),
        window.api.rooms.getAll().catch(() => []),
        window.api.supplies.getRoomStock?.().catch(() => []),
        window.api.supplies.getMovements?.(24).catch(() => [])
      ])
      setSupplyItems(sortItems(itemData || []))
      setRooms(sortRooms(roomData || []))
      setRoomStockRows(stockData || [])
      setMovements(movementData || [])
    } catch (err) {
      setPageError(err?.message || 'Could not load room supplies.')
    } finally {
      setLoading(false)
    }
  }

  async function loadReport() {
    setReportLoading(true)
    setReportMessage(null)
    const data = await window.api.supplies.getAllocations(reportStart, reportEnd).catch(() => [])
    setReportData(data || [])
    setReportLoading(false)
  }

  function buildReportExportPayload() {
    return {
      start: reportStart,
      end: reportEnd,
      currency,
      allocations: reportData,
      byRoom: Object.values(reportByRoom),
      byItem: Object.values(reportByItem),
      grandTotal,
      reportTitle: 'Room Supplies Cost Report',
      lodgeName: settings?.lodge_name || '',
      companyName: settings?.company_name || '',
      generatedAt: new Date().toLocaleString()
    }
  }

  async function loadStocktakes(scope = stocktakeScope) {
    setStocktakeError('')
    try {
      const rows = scope === 'store'
        ? await window.api.supplies.getStocktakes(16)
        : await window.api.supplies.getRoomStocktakes(16)
      const safeRows = Array.isArray(rows) ? rows : []
      if (scope === 'store') {
        setStocktakes(safeRows)
        if (!activeStocktakeId && safeRows?.[0]?.id) setActiveStocktakeId(safeRows[0].id)
      } else {
        setRoomStocktakes(safeRows)
        if (!activeRoomStocktakeId && safeRows?.[0]?.id) setActiveRoomStocktakeId(safeRows[0].id)
      }
    } catch (err) {
      setStocktakeError(err?.message || `Could not load ${scope === 'store' ? 'supply' : 'room'} stock takes.`)
    }
  }

  async function loadStocktakeSession(stocktakeId, scope = stocktakeScope) {
    if (!stocktakeId) return
    setStocktakeLoading(true)
    setStocktakeError('')
    try {
      const session = scope === 'store'
        ? await window.api.supplies.getStocktake(stocktakeId)
        : await window.api.supplies.getRoomStocktake(stocktakeId)
      if (scope === 'store') setActiveStocktake(session || null)
      else setActiveRoomStocktake(session || null)
    } catch (err) {
      setStocktakeError(err?.message || `Could not load this ${scope === 'store' ? 'supply' : 'room'} stock take.`)
    } finally {
      setStocktakeLoading(false)
    }
  }

  async function startStocktake() {
    setStocktakeSaving(true)
    setStocktakeError('')
    try {
      const result = stocktakeScope === 'store'
        ? await window.api.supplies.createStocktake({
          title: stocktakeTitle || null,
          notes: stocktakeNotes || null
        })
        : await window.api.supplies.createRoomStocktake({
        title: stocktakeTitle || null,
        notes: stocktakeNotes || null
      })
      if (!result?.success) {
        setStocktakeError(result?.error || 'Could not start stock take.')
        return
      }
      setStocktakeTitle('')
      setStocktakeNotes('')
      await loadStocktakes(stocktakeScope)
      if (stocktakeScope === 'store') setActiveStocktakeId(result.id)
      else setActiveRoomStocktakeId(result.id)
      await loadStocktakeSession(result.id, stocktakeScope)
    } catch (err) {
      setStocktakeError(err?.message || 'Could not start stock take.')
    } finally {
      setStocktakeSaving(false)
    }
  }

  function updateStocktakeLine(lineKey, field, value) {
    const applyUpdate = (current) => {
      if (!current) return current
      const lines = (current.lines || []).map((line) => {
        const key = line.line_key || line.item_id || line.room_stock_id
        if (key !== lineKey) return line
        const next = { ...line, [field]: value }
        const counted = field === 'counted_qty' ? value : next.counted_qty
        const expected = Number(next.expected_qty || 0)
        const countedNumber = counted === '' || counted === null ? null : Number(counted)
        next.counted_qty = counted
        next.variance_qty = countedNumber === null || Number.isNaN(countedNumber) ? null : countedNumber - expected
        next.variance_cost = countedNumber === null || Number.isNaN(countedNumber)
          ? null
          : (countedNumber - expected) * Number(next.unit_cost || 0)
        return next
      })
      return { ...current, lines }
    }
    if (stocktakeScope === 'store') setActiveStocktake(applyUpdate)
    else setActiveRoomStocktake(applyUpdate)
  }

  async function saveStocktakeDraft() {
    if (!currentStocktake?.id) return
    setStocktakeSaving(true)
    setStocktakeError('')
    try {
      const payload = (currentStocktake.lines || []).map((line) => (
        stocktakeScope === 'store'
          ? {
              item_id: line.item_id,
              counted_qty: line.counted_qty === '' ? null : line.counted_qty,
              notes: line.notes || null
            }
          : {
              room_stock_id: line.room_stock_id,
              counted_qty: line.counted_qty === '' ? null : line.counted_qty,
              notes: line.notes || null
            }
      ))
      const result = stocktakeScope === 'store'
        ? await window.api.supplies.saveStocktakeCounts(currentStocktake.id, payload)
        : await window.api.supplies.saveRoomStocktakeCounts(currentStocktake.id, payload)
      if (!result?.success) {
        setStocktakeError(result?.error || 'Could not save stock take.')
        return
      }
      await loadStocktakeSession(currentStocktake.id, stocktakeScope)
      await loadStocktakes(stocktakeScope)
    } catch (err) {
      setStocktakeError(err?.message || 'Could not save stock take.')
    } finally {
      setStocktakeSaving(false)
    }
  }

  async function postStocktake() {
    if (!currentStocktake?.id) return
    const prompt = stocktakeScope === 'store'
      ? 'Post this supply stock take and update the live store balances to the counted quantities?'
      : 'Post this room stock take and update the live room balances to the counted quantities?'
    if (!confirm(prompt)) return
    setStocktakePosting(true)
    setStocktakeError('')
    try {
      const payload = (currentStocktake.lines || []).map((line) => (
        stocktakeScope === 'store'
          ? {
              item_id: line.item_id,
              counted_qty: line.counted_qty === '' ? null : line.counted_qty,
              notes: line.notes || null
            }
          : {
              room_stock_id: line.room_stock_id,
              counted_qty: line.counted_qty === '' ? null : line.counted_qty,
              notes: line.notes || null
            }
      ))
      const saveResult = stocktakeScope === 'store'
        ? await window.api.supplies.saveStocktakeCounts(currentStocktake.id, payload)
        : await window.api.supplies.saveRoomStocktakeCounts(currentStocktake.id, payload)
      if (!saveResult?.success) throw new Error(saveResult?.error || 'Could not save stock take')
      const result = stocktakeScope === 'store'
        ? await window.api.supplies.postStocktake(currentStocktake.id, currentStocktake.notes || null)
        : await window.api.supplies.postRoomStocktake(currentStocktake.id, currentStocktake.notes || null)
      if (!result?.success) throw new Error(result?.error || 'Could not post stock take')
      await refreshBaseData()
      await loadStocktakes(stocktakeScope)
      await loadStocktakeSession(currentStocktake.id, stocktakeScope)
    } catch (err) {
      setStocktakeError(err?.message || 'Could not post stock take.')
    } finally {
      setStocktakePosting(false)
    }
  }

  async function addMissingRoomLine() {
    if (!currentStocktake?.id || stocktakeScope !== 'rooms') return
    setStocktakeSaving(true)
    setStocktakeError('')
    try {
      if (!missingRoomLine.room_id || !missingRoomLine.item_id) {
        setStocktakeError('Choose both the room and supply item first.')
        return
      }
      const countedQty = parseFloat(missingRoomLine.counted_qty)
      if (!(countedQty >= 0)) {
        setStocktakeError('Enter the quantity you physically found in the room.')
        return
      }
      const result = await window.api.supplies.addRoomStocktakeLine(currentStocktake.id, {
        room_id: missingRoomLine.room_id,
        item_id: missingRoomLine.item_id,
        counted_qty: countedQty,
        notes: missingRoomLine.notes
      })
      if (!result?.success) {
        setStocktakeError(result?.error || 'Could not add that room stock line.')
        return
      }
      setMissingRoomLine({ room_id: '', item_id: '', counted_qty: '', notes: '' })
      await loadStocktakeSession(currentStocktake.id, 'rooms')
      await loadStocktakes('rooms')
      await refreshBaseData()
    } catch (err) {
      setStocktakeError(err?.message || 'Could not add that room stock line.')
    } finally {
      setStocktakeSaving(false)
    }
  }

  function getEffectivePurchaseQuantity() {
    const packages = parseFloat(purchaseForm.package_count)
    const unitsPerPackage = parseFloat(purchaseForm.units_per_package)
    if (packages > 0 && unitsPerPackage > 0) return packages * unitsPerPackage
    return parseFloat(purchaseForm.quantity_purchased)
  }

  function unitCostPreview() {
    const qty = getEffectivePurchaseQuantity()
    const cost = parseFloat(purchaseForm.total_cost)
    return qty > 0 && cost > 0 ? (cost / qty).toFixed(4) : null
  }

  function buildPurchaseNotes() {
    const base = String(purchaseForm.notes || '').trim()
    const packages = parseFloat(purchaseForm.package_count)
    const unitsPerPackage = parseFloat(purchaseForm.units_per_package)
    if (!(packages > 0 && unitsPerPackage > 0)) return base
    const extra = `Pack detail: ${packages} pack(s) × ${unitsPerPackage} ${purchaseItem?.unit || 'units'}`
    return base ? `${base} | ${extra}` : extra
  }

  function openCreate() {
    setEditingItem(null)
    setItemError('')
    setItemForm({ name: '', category: 'Bathroom', unit: 'roll', reorder_level: '', current_stock: '' })
    setItemModal(true)
  }

  function openEdit(item) {
    setEditingItem(item)
    setItemError('')
    setItemForm({
      name: item.name,
      category: item.category,
      unit: item.unit,
      reorder_level: item.reorder_level != null ? String(item.reorder_level) : '',
      current_stock: ''
    })
    setItemModal(true)
  }

  async function handleItemSubmit(event) {
    event.preventDefault()
    setItemSaving(true)
    setItemError('')
    try {
      const payload = {
        name: itemForm.name,
        category: itemForm.category,
        unit: itemForm.unit,
        reorder_level: parseFloat(itemForm.reorder_level) || 0,
        ...(editingItem ? {} : { current_stock: parseFloat(itemForm.current_stock) || 0 })
      }
      const result = editingItem
        ? await window.api.supplies.updateItem(editingItem.id, payload)
        : await window.api.supplies.createItem(payload)
      if (!result?.success) {
        setItemError(result?.error || 'Failed to save item.')
        return
      }
      setItemModal(false)
      await refreshBaseData()
    } catch (err) {
      setItemError(err.message || 'Failed to save item.')
    } finally {
      setItemSaving(false)
    }
  }

  async function deleteItem(item) {
    if (!confirm(`Delete "${item.name}"?\n\nThis removes its history and room balances.`)) return
    try {
      await window.api.supplies.deleteItem(item.id)
      await refreshBaseData()
    } catch (err) {
      alert(err.message || 'Failed to delete item.')
    }
  }

  function openPurchase(item) {
    setPurchaseItem(item)
    setPurchaseError('')
    setPurchaseForm({ date: today(), quantity_purchased: '', total_cost: '', notes: '', package_count: '', units_per_package: '' })
    setPurchaseModal(true)
  }

  async function handlePurchaseSubmit(event) {
    event.preventDefault()
    setPurchaseSaving(true)
    setPurchaseError('')
    try {
      const qty = getEffectivePurchaseQuantity()
      const total = parseFloat(purchaseForm.total_cost)
      if (!(qty > 0)) {
        setPurchaseError(`Enter the quantity purchased in ${purchaseItem?.unit || 'units'}s, or use packs × units per pack.`)
        return
      }
      if (!(total > 0)) {
        setPurchaseError('Enter the full purchase cost.')
        return
      }
      const result = await window.api.supplies.addPurchase({
        item_id: purchaseItem.id,
        ...purchaseForm,
        quantity_purchased: qty,
        total_cost: total,
        notes: buildPurchaseNotes()
      })
      if (!result?.success) {
        setPurchaseError(result?.error || 'Failed to record purchase.')
        return
      }
      setPurchaseModal(false)
      await refreshBaseData()
    } catch (err) {
      setPurchaseError(err.message || 'Failed to record purchase.')
    } finally {
      setPurchaseSaving(false)
    }
  }

  function openAdjust(item) {
    setAdjustItem(item)
    setAdjustDelta('')
    setAdjustNotes('')
    setAdjustPin('')
    setAdjustError('')
    setAdjustModal(true)
  }

  async function handleAdjustSubmit(event) {
    event.preventDefault()
    setAdjustSaving(true)
    setAdjustError('')
    try {
      const result = await window.api.supplies.adjustStock(adjustItem.id, parseFloat(adjustDelta), adjustNotes, adjustPin)
      if (!result?.success) {
        setAdjustError(result?.error || 'Failed to adjust stock.')
        return
      }
      setAdjustModal(false)
      await refreshBaseData()
    } catch (err) {
      setAdjustError(err.message || 'Failed to adjust stock.')
    } finally {
      setAdjustSaving(false)
    }
  }

  function openLoadModal({ item = null, row = null } = {}) {
    setMovementType('load')
    setMovementTarget({ item, row })
    setMovementError('')
    setMovementForm({
      item_id: item?.id || row?.supply_item_id || '',
      room_id: row?.room_id || '',
      quantity: '',
      reorder_level: row ? String(row.reorder_level || '') : '1',
      notes: ''
    })
    setMovementModal(true)
  }

  function openUseModal(row) {
    setMovementType('use')
    setMovementTarget({ row })
    setMovementError('')
    setMovementForm({ item_id: row.supply_item_id, room_id: row.room_id, quantity: '', reorder_level: String(row.reorder_level || ''), notes: '' })
    setMovementModal(true)
  }

  function openReturnModal(row) {
    setMovementType('return')
    setMovementTarget({ row })
    setMovementError('')
    setMovementForm({ item_id: row.supply_item_id, room_id: row.room_id, quantity: '', reorder_level: String(row.reorder_level || ''), notes: '' })
    setMovementModal(true)
  }

  async function handleMovementSubmit(event) {
    event.preventDefault()
    setMovementSaving(true)
    setMovementError('')
    try {
      const suppliesApi = window.api?.supplies || {}
      const qty = parseFloat(movementForm.quantity)
      if (!(qty > 0)) {
        setMovementError('Enter a quantity greater than zero.')
        return
      }
      let result
      if (movementType === 'load') {
        if (typeof suppliesApi.loadToRoom !== 'function') {
          setMovementError('Room loading controls are not available in this app build yet. Restart after updating and try again.')
          return
        }
        if (!movementForm.item_id || !movementForm.room_id) {
          setMovementError('Choose both the supply item and room.')
          return
        }
        result = await suppliesApi.loadToRoom({
          item_id: movementForm.item_id,
          room_id: movementForm.room_id,
          quantity: qty,
          reorder_level: parseFloat(movementForm.reorder_level) || 0,
          notes: movementForm.notes
        })
      } else if (movementType === 'use') {
        if (typeof suppliesApi.useInRoom !== 'function') {
          setMovementError('Room usage controls are not available in this app build yet. Restart after updating and try again.')
          return
        }
        result = await suppliesApi.useInRoom({
          item_id: movementForm.item_id,
          room_id: movementForm.room_id,
          quantity: qty,
          notes: movementForm.notes
        })
      } else {
        if (typeof suppliesApi.returnFromRoom !== 'function') {
          setMovementError('Room return controls are not available in this app build yet. Restart after updating and try again.')
          return
        }
        result = await suppliesApi.returnFromRoom({
          item_id: movementForm.item_id,
          room_id: movementForm.room_id,
          quantity: qty,
          notes: movementForm.notes
        })
      }
      if (!result?.success) {
        setMovementError(result?.error || 'Could not save this movement.')
        return
      }
      setMovementModal(false)
      await refreshBaseData()
    } catch (err) {
      setMovementError(err.message || 'Could not save this movement.')
    } finally {
      setMovementSaving(false)
    }
  }

  async function exportReport() {
    setReportExporting(true)
    setReportMessage(null)
    try {
      const result = await window.api.supplies.exportReport(buildReportExportPayload())
      if (!result?.success) throw new Error(result?.error || 'Could not export room supply report.')
      setReportMessage({ tone: 'success', text: result?.filePath ? `Report exported to ${result.filePath}.` : 'Report exported.' })
    } catch (err) {
      setReportMessage({ tone: 'error', text: err.message || 'Could not export room supply report.' })
    } finally {
      setReportExporting(false)
    }
  }

  async function exportReportPdf() {
    setReportPdfExporting(true)
    setReportMessage(null)
    try {
      const result = await window.api.supplies.exportReportPdf(buildReportExportPayload())
      if (!result?.success) throw new Error(result?.error || 'Could not export room supply report as PDF.')
      setReportMessage({ tone: 'success', text: result?.filePath ? `PDF exported to ${result.filePath}.` : 'PDF exported.' })
    } catch (err) {
      setReportMessage({ tone: 'error', text: err.message || 'Could not export room supply report as PDF.' })
    } finally {
      setReportPdfExporting(false)
    }
  }

  const movementItem = supplyItems.find((item) => item.id === movementForm.item_id)
  const movementRow = movementTarget?.row

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="bb-page-header">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700/70">Housekeeping Stock Control</p>
          <h1 className="bb-page-header-title mt-2">Room Supplies</h1>
          <p className="bb-page-header-subtitle">
            {supplyItems.length} items
            {storeLowItems.length > 0 && <span className="ml-2 font-medium text-red-500">· {storeLowItems.length} low in store</span>}
            {roomLowRows.length > 0 && <span className="ml-2 font-medium text-amber-600">· {roomLowRows.length} room balances need refill</span>}
          </p>
        </div>
        <div className="bb-card flex gap-1 p-2">
          {[
            ['stock', 'Live Stock'],
            ['stocktake', 'Stock Take'],
            ['items', 'Supply Items'],
            ['report', 'Cost Report']
          ].map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`rounded-xl px-4 py-2 transition-all ${tab === value ? 'bg-gradient-to-b from-green-500 to-green-700 text-white shadow-[0_10px_24px_rgba(22,101,52,0.2)]' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {pageError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{pageError}</div>}

      {tab === 'stock' && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="bb-card flex items-center gap-3 p-4"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100 text-red-700"><AlertTriangle size={20} /></div><div><p className="text-2xl font-bold text-slate-800">{storeLowItems.length}</p><p className="text-xs text-slate-500">Store items low or empty</p></div></div>
            <div className="bb-card flex items-center gap-3 p-4"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700"><TrendingDown size={20} /></div><div><p className="text-2xl font-bold text-slate-800">{roomLowRows.length}</p><p className="text-xs text-slate-500">Room balances needing refill</p></div></div>
            <div className="bb-card flex items-center gap-3 p-4"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 text-purple-700"><Package2 size={20} /></div><div><p className="text-2xl font-bold text-slate-800">{fmtQty(totalLoadedUnits)}</p><p className="text-xs text-slate-500">Units loaded in rooms</p></div></div>
            <div className="bb-card flex items-center gap-3 p-4"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700"><RotateCcw size={20} /></div><div><p className="text-2xl font-bold text-slate-800">{roomOutRows.length}</p><p className="text-xs text-slate-500">Room lines already empty</p></div></div>
          </div>

          <div className="bb-filter-bar flex-wrap">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs text-slate-600">
              Buy stock into the store room, load it into rooms, then record usage or returns. That gives you a running balance in store and per room.
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={refreshBaseData} className="btn-secondary"><RefreshCw size={14} /> Refresh</button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="bb-card p-5">
              <div className="mb-4"><p className="text-sm font-semibold text-slate-900">Store Room Stock</p><p className="mt-1 text-xs text-slate-500">What is available to load into rooms.</p></div>
              <div className="bb-table-shell overflow-x-auto shadow-none">
                {loading ? (
                  <div className="bb-empty-state min-h-[220px]"><p className="text-sm font-medium text-slate-500">Loading stock balances…</p></div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                      <tr><th className="px-4 py-3 text-left">Item</th><th className="px-4 py-3 text-right">In Store</th><th className="px-4 py-3 text-right">Loaded</th><th className="px-4 py-3 text-right">Reorder At</th><th className="px-4 py-3 text-center">Status</th><th className="px-4 py-3 text-center">Actions</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {supplyItems.map((item) => {
                        const status = getStoreStatus(item)
                        return (
                          <tr key={item.id} className={`hover:bg-slate-50 ${status.warning ? 'bg-red-50/30' : ''}`}>
                            <td className="px-4 py-3"><p className="font-medium text-slate-800">{item.name}</p><p className="text-xs text-slate-400">{item.category} · {item.unit}</p></td>
                            <td className={`px-4 py-3 text-right font-semibold ${status.warning ? 'text-red-600' : 'text-slate-800'}`}>{fmtQty(item.current_stock)} {item.unit}</td>
                            <td className="px-4 py-3 text-right text-slate-600">{roomStockByItem[item.id] ? `${fmtQty(roomStockByItem[item.id])} ${item.unit}` : '—'}</td>
                            <td className="px-4 py-3 text-right text-slate-500">{Number(item.reorder_level || 0) > 0 ? `${fmtQty(item.reorder_level)} ${item.unit}` : '—'}</td>
                            <td className="px-4 py-3 text-center"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${status.tone}`}>{status.label}</span></td>
                            <td className="px-4 py-3"><div className="flex items-center justify-center gap-1"><button onClick={() => openPurchase(item)} className="rounded-lg px-2 py-1 text-xs text-emerald-600 transition-colors hover:bg-emerald-50">+ Stock</button><button onClick={() => openLoadModal({ item })} className="rounded-lg px-2 py-1 text-xs text-blue-600 transition-colors hover:bg-blue-50">Load</button><button onClick={() => openAdjust(item)} className="rounded-lg px-2 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-100">Adjust</button></div></td>
                          </tr>
                        )
                      })}
                      {supplyItems.length === 0 && <tr><td colSpan={6} className="px-4 py-12"><div className="bb-empty-state py-10"><ShoppingBag size={32} className="mx-auto mb-2 opacity-30" /><p className="text-base font-semibold text-slate-800">No room supplies yet</p><p className="text-sm text-slate-500">Add supply items first, then start buying and loading them into rooms.</p></div></td></tr>}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="bb-card p-5">
              <div className="mb-4"><p className="text-sm font-semibold text-slate-900">Recent Stock Activity</p><p className="mt-1 text-xs text-slate-500">Loads, usage, returns, and adjustments.</p></div>
              <div className="space-y-3">
                {movements.length > 0 ? movements.map((move) => (
                  <div key={move.id} className="bb-card-muted p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div><div className="flex items-center gap-2"><span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">{movementLabel(move.movement_type)}</span><span className="text-xs text-slate-400">{shortDateTime(move.created_at)}</span></div><p className="mt-2 text-sm font-semibold text-slate-900">{move.supply_name || 'Supply item'}</p><p className="mt-1 text-xs text-slate-500">{move.room_number ? `Room ${move.room_number}` : 'Store room'}{move.notes ? ` · ${move.notes}` : ''}</p></div>
                      <div className="text-right"><p className="text-sm font-semibold text-slate-900">{fmtQty(move.quantity)} {move.supply_unit || ''}</p><p className="text-xs text-slate-500">{Number(move.total_cost || 0) > 0 ? `${currency} ${fmt(move.total_cost)}` : '—'}</p></div>
                    </div>
                  </div>
                )) : <div className="bb-empty-state min-h-[220px]"><p className="text-base font-semibold text-slate-800">No stock movements yet</p><p className="text-sm text-slate-500">Once you buy, load, use, or return supplies, the history will appear here.</p></div>}
              </div>
            </div>
          </div>

          <div className="bb-card p-5">
            <div className="mb-4"><p className="text-sm font-semibold text-slate-900">Room Supply Balances</p><p className="mt-1 text-xs text-slate-500">What is currently sitting in each room right now.</p></div>
            <div className="bb-table-shell overflow-x-auto shadow-none">
              {loading ? (
                <div className="bb-empty-state min-h-[220px]"><p className="text-sm font-medium text-slate-500">Loading room balances…</p></div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                    <tr><th className="px-4 py-3 text-left">Room</th><th className="px-4 py-3 text-left">Supply</th><th className="px-4 py-3 text-right">On Hand</th><th className="px-4 py-3 text-right">Alert At</th><th className="px-4 py-3 text-left">Last Movement</th><th className="px-4 py-3 text-center">Status</th><th className="px-4 py-3 text-center">Actions</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {roomStockRows.map((row) => {
                      const status = getRoomStatus(row)
                      return (
                        <tr key={row.id} className={`hover:bg-slate-50 ${status.warning ? 'bg-amber-50/30' : ''}`}>
                          <td className="px-4 py-3"><p className="font-medium text-slate-800">Room {row.room_number}</p><p className="text-xs text-slate-400">{row.room_type || 'Room'}</p></td>
                          <td className="px-4 py-3"><p className="font-medium text-slate-800">{row.supply_name}</p><p className="text-xs text-slate-400">{row.supply_category} · {row.supply_unit}</p></td>
                          <td className={`px-4 py-3 text-right font-semibold ${status.warning ? 'text-amber-700' : 'text-slate-800'}`}>{fmtQty(row.quantity_on_hand)} {row.supply_unit}</td>
                          <td className="px-4 py-3 text-right text-slate-500">{Number(row.reorder_level || 0) > 0 ? `${fmtQty(row.reorder_level)} ${row.supply_unit}` : '—'}</td>
                          <td className="px-4 py-3 text-xs text-slate-500">{shortDateTime(row.last_moved_at)}</td>
                          <td className="px-4 py-3 text-center"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${status.tone}`}>{status.label}</span></td>
                          <td className="px-4 py-3"><div className="flex items-center justify-center gap-1"><button onClick={() => openUseModal(row)} className="rounded-lg px-2 py-1 text-xs text-amber-700 transition-colors hover:bg-amber-50">Use</button><button onClick={() => openReturnModal(row)} className="rounded-lg px-2 py-1 text-xs text-purple-700 transition-colors hover:bg-purple-50">Return</button><button onClick={() => openLoadModal({ row })} className="rounded-lg px-2 py-1 text-xs text-blue-700 transition-colors hover:bg-blue-50">Reload</button></div></td>
                        </tr>
                      )
                    })}
                    {roomStockRows.length === 0 && <tr><td colSpan={7} className="px-4 py-12"><div className="bb-empty-state py-10"><Package2 size={32} className="mx-auto mb-2 opacity-30" /><p className="text-base font-semibold text-slate-800">No room balances yet</p><p className="text-sm text-slate-500">Use “Load” from the store stock table to place supplies into rooms.</p></div></td></tr>}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'stocktake' && (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[0.42fr_0.58fr]">
            <div className="bb-card p-5">
              <div className="flex items-center gap-2">
                <ClipboardCheck size={16} className="text-emerald-600" />
                <h2 className="text-base font-semibold text-slate-900">Start Room Supplies Stock Take</h2>
              </div>
              <div className="mt-4 inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setStocktakeScope('store')}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${stocktakeScope === 'store' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                >
                  Count Store Stock
                </button>
                <button
                  type="button"
                  onClick={() => setStocktakeScope('rooms')}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${stocktakeScope === 'rooms' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                >
                  Count Room Stock
                </button>
              </div>
              <p className="mt-3 text-sm text-slate-500">
                {stocktakeScope === 'store'
                  ? 'Count what is physically in the store room, then save and post those figures into your live room supplies stock.'
                  : 'Count what is physically inside each room, then save and post those figures into your live room balances.'}
              </p>
              <div className="mt-4 space-y-3">
                <input
                  className="input"
                  placeholder={stocktakeScope === 'store' ? 'Session title, e.g. Housekeeping Month-End Count' : 'Session title, e.g. April Room Refill Count'}
                  value={stocktakeTitle}
                  onChange={(e) => setStocktakeTitle(e.target.value)}
                />
                <textarea
                  className="input h-24 resize-none"
                  placeholder="Optional notes for this stock take"
                  value={stocktakeNotes}
                  onChange={(e) => setStocktakeNotes(e.target.value)}
                />
                <button onClick={startStocktake} disabled={stocktakeSaving} className="btn-primary w-full justify-center">
                  {stocktakeSaving ? 'Starting…' : `Start ${stocktakeScope === 'store' ? 'Store' : 'Room'} Stock Take`}
                </button>
              </div>
            </div>

            <div className="bb-card p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Recent Sessions</h2>
                  <p className="mt-1 text-xs text-slate-500">Open and posted {stocktakeScope === 'store' ? 'store' : 'room'} counts.</p>
                </div>
                <button onClick={() => loadStocktakes(stocktakeScope)} className="btn-secondary text-sm"><RefreshCw size={14} /> Refresh</button>
              </div>
              <div className="space-y-3">
                {currentStocktakes.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => {
                      if (stocktakeScope === 'store') setActiveStocktakeId(session.id)
                      else setActiveRoomStocktakeId(session.id)
                    }}
                    className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                      currentStocktakeId === session.id ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-800">{session.title || 'Untitled stock take'}</p>
                        <p className="mt-1 text-xs text-slate-500">Started {new Date(session.started_at).toLocaleString()}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                        session.status === 'posted' ? 'bg-slate-900 text-white' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {session.status}
                      </span>
                    </div>
                  </button>
                ))}
                {currentStocktakes.length === 0 && (
                  <div className="bb-empty-state min-h-[180px]">
                    <p className="text-base font-semibold text-slate-800">No stock takes yet</p>
                    <p className="text-sm text-slate-500">Start your first {stocktakeScope === 'store' ? 'store room' : 'room-by-room'} room supplies count from here.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bb-card p-5">
            {stocktakeError && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{stocktakeError}</div>}
            {!currentStocktakeId ? (
              <div className="bb-empty-state min-h-[320px]">
                <p className="text-base font-semibold text-slate-800">Choose a room supplies stock-take session</p>
                <p className="text-sm text-slate-500">Select a recent session above, or start a new one first.</p>
              </div>
            ) : stocktakeLoading ? (
              <div className="bb-empty-state min-h-[320px]"><p className="text-sm font-medium text-slate-500">Loading stock take…</p></div>
            ) : !currentStocktake ? (
              <div className="bb-empty-state min-h-[320px]"><p className="text-base font-semibold text-slate-800">This stock take could not be loaded</p></div>
            ) : (
              <>
                <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{currentStocktake.title || 'Untitled stock take'}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {stocktakeScope === 'store'
                        ? 'This session compares what is physically in the store room against the expected room supplies balance.'
                        : 'This session compares what is physically inside rooms against the expected room supplies balance.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{stocktakeProgress.counted}/{stocktakeProgress.total} counted</span>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${stocktakeProgress.variances > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{stocktakeProgress.variances} variances</span>
                  </div>
                </div>
                <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded-xl bg-slate-50 px-4 py-3"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Status</p><p className="mt-2 text-sm font-semibold text-slate-800 capitalize">{currentStocktake.status}</p></div>
                  <div className="rounded-xl bg-slate-50 px-4 py-3"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Started</p><p className="mt-2 text-sm font-semibold text-slate-800">{new Date(currentStocktake.started_at).toLocaleString()}</p></div>
                  <div className="rounded-xl bg-slate-50 px-4 py-3"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Posted</p><p className="mt-2 text-sm font-semibold text-slate-800">{currentStocktake.posted_at ? new Date(currentStocktake.posted_at).toLocaleString() : 'Not yet'}</p></div>
                </div>
                {stocktakeScope === 'rooms' && currentStocktake.status === 'open' && (
                  <div className="mb-4 rounded-2xl border border-blue-100 bg-blue-50 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900">Found supply in a room that was never loaded?</p>
                        <p className="mt-1 text-xs text-slate-500">Add it here so the room count can still be posted correctly.</p>
                      </div>
                      <div className="grid flex-[2] grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <select className="input" value={missingRoomLine.room_id} onChange={(e) => setMissingRoomLine((current) => ({ ...current, room_id: e.target.value }))}>
                          <option value="">Choose room</option>
                          {rooms.map((room) => <option key={room.id} value={room.id}>Room {room.room_number}</option>)}
                        </select>
                        <select className="input" value={missingRoomLine.item_id} onChange={(e) => setMissingRoomLine((current) => ({ ...current, item_id: e.target.value }))}>
                          <option value="">Choose supply</option>
                          {supplyItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                        <input type="number" min="0" step="0.1" className="input" placeholder="Qty found" value={missingRoomLine.counted_qty} onChange={(e) => setMissingRoomLine((current) => ({ ...current, counted_qty: e.target.value }))} />
                        <input type="text" className="input" placeholder="Optional note" value={missingRoomLine.notes} onChange={(e) => setMissingRoomLine((current) => ({ ...current, notes: e.target.value }))} />
                      </div>
                      <button onClick={addMissingRoomLine} disabled={stocktakeSaving || stocktakePosting} className="btn-secondary whitespace-nowrap">Add Missing Room Line</button>
                    </div>
                  </div>
                )}
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                  <span>Scroll sideways if needed to see every stock-take column and action.</span>
                  {stocktakeMissingCosts > 0 && (
                    <span className="font-semibold text-amber-700">
                      {stocktakeMissingCosts} line{stocktakeMissingCosts === 1 ? '' : 's'} have no unit cost yet, so variance cost cannot be calculated for them.
                    </span>
                  )}
                </div>
                <div className="bb-table-shell">
                  <HorizontalScrollArea>
                    <table className={`w-full text-sm ${stocktakeScope === 'store' ? 'min-w-[1120px]' : 'min-w-[1280px]'}`}>
                      <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                        <tr>
                          {stocktakeScope === 'rooms' && <th className="px-4 py-3 text-left">Room</th>}
                          <th className="px-4 py-3 text-left">Item</th>
                          <th className="px-4 py-3 text-right">Expected</th>
                          <th className="px-4 py-3 text-right">Counted</th>
                          <th className="px-4 py-3 text-right">Variance</th>
                          <th className="px-4 py-3 text-right">Unit Cost</th>
                          <th className="px-4 py-3 text-right">Variance Cost</th>
                          <th className="px-4 py-3 text-left">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(currentStocktake.lines || []).map((line) => (
                          <tr key={line.line_key || line.item_id || line.room_stock_id} className={`${Number(line.variance_qty || 0) !== 0 ? 'bg-amber-50/40' : 'hover:bg-slate-50'}`}>
                            {stocktakeScope === 'rooms' && (
                              <td className="px-4 py-3">
                                <p className="font-medium text-slate-800">Room {line.room_number}</p>
                                <p className="text-xs text-slate-400">{line.room_type || 'Room'}</p>
                              </td>
                            )}
                            <td className="px-4 py-3"><p className="font-medium text-slate-800">{line.item_name}</p><p className="text-xs text-slate-400">{line.item_category} · {line.item_unit}</p></td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-700">{fmtQty(line.expected_qty)} {line.item_unit}</td>
                            <td className="px-4 py-3 text-right"><input type="number" step="0.1" min="0" disabled={currentStocktake.status !== 'open'} className="input ml-auto w-28 text-right" value={line.counted_qty ?? ''} onChange={(e) => updateStocktakeLine(line.line_key || line.item_id || line.room_stock_id, 'counted_qty', e.target.value)} /></td>
                            <td className={`px-4 py-3 text-right font-semibold ${Number(line.variance_qty || 0) === 0 ? 'text-slate-500' : Number(line.variance_qty || 0) > 0 ? 'text-emerald-700' : 'text-red-600'}`}>{line.variance_qty === null || line.variance_qty === '' ? '—' : fmtQty(line.variance_qty)}</td>
                            <td className="px-4 py-3 text-right font-medium text-slate-700">{Number(line.unit_cost || 0) > 0 ? `${currency} ${fmt(line.unit_cost)}` : '—'}</td>
                            <td className="px-4 py-3 text-right font-medium text-slate-700">
                              {Number(line.unit_cost || 0) <= 0
                                ? '—'
                                : line.variance_cost === null || line.variance_cost === ''
                                  ? '—'
                                  : `${currency} ${fmt(line.variance_cost)}`}
                            </td>
                            <td className="px-4 py-3"><input type="text" disabled={currentStocktake.status !== 'open'} className="input" value={line.notes || ''} onChange={(e) => updateStocktakeLine(line.line_key || line.item_id || line.room_stock_id, 'notes', e.target.value)} placeholder="Optional note" /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </HorizontalScrollArea>
                </div>
                {currentStocktake.status === 'open' && (
                  <div className="sticky bottom-0 mt-4 flex flex-wrap justify-end gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
                    <button onClick={saveStocktakeDraft} disabled={stocktakeSaving || stocktakePosting} className="btn-secondary">{stocktakeSaving ? 'Saving…' : 'Save Draft'}</button>
                    <button onClick={postStocktake} disabled={stocktakeSaving || stocktakePosting} className="btn-primary">{stocktakePosting ? 'Posting…' : `Post ${stocktakeScope === 'store' ? 'Store' : 'Room'} Stock Take`}</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'items' && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-end gap-2"><button onClick={() => openPurchase(null)} className="btn-secondary flex items-center gap-2"><Plus size={16} /> Record Purchase</button><button onClick={openCreate} className="btn-primary flex items-center gap-2"><Plus size={16} /> Add Supply Item</button></div>
          <div className="bb-table-shell">
            {loading ? (
              <div className="bb-empty-state min-h-[220px]"><p className="text-sm font-medium text-slate-500">Loading supply items…</p></div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                  <tr><th className="px-5 py-3 text-left">Item</th><th className="px-5 py-3 text-left">Category</th><th className="px-5 py-3 text-left">Unit</th><th className="px-5 py-3 text-right">Store Stock</th><th className="px-5 py-3 text-right">Reorder At</th><th className="px-5 py-3 text-right">Unit Cost</th><th className="px-5 py-3 text-center">Actions</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {supplyItems.map((item) => {
                    const status = getStoreStatus(item)
                    return (
                      <tr key={item.id} className={`hover:bg-slate-50 ${status.warning ? 'bg-red-50/30' : ''}`}>
                        <td className="px-5 py-3 font-medium text-slate-800">{item.name}</td>
                        <td className="px-5 py-3"><span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{item.category}</span></td>
                        <td className="px-5 py-3 text-slate-600">{item.unit}</td>
                        <td className={`px-5 py-3 text-right font-semibold ${status.warning ? 'text-red-600' : 'text-slate-800'}`}>{fmtQty(item.current_stock)} {item.unit}</td>
                        <td className="px-5 py-3 text-right text-slate-500">{Number(item.reorder_level || 0) > 0 ? `${fmtQty(item.reorder_level)} ${item.unit}` : '—'}</td>
                        <td className="px-5 py-3 text-right">{item.latest_unit_cost > 0 ? <span className="font-semibold text-green-700">{currency} {fmt(item.latest_unit_cost, 4)}/{item.unit}</span> : <span className="text-xs text-slate-400">No purchase recorded</span>}</td>
                        <td className="px-5 py-3"><div className="flex items-center justify-center gap-1"><button onClick={() => openPurchase(item)} className="rounded-lg px-2 py-1 text-xs text-green-600 transition-colors hover:bg-green-50">+ Purchase</button><button onClick={() => openAdjust(item)} className="rounded-lg px-2 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-100">Adjust</button><button onClick={() => openLoadModal({ item })} className="rounded-lg px-2 py-1 text-xs text-blue-600 transition-colors hover:bg-blue-50">Load</button><button onClick={() => openEdit(item)} className="rounded-lg p-1.5 text-blue-500 transition-colors hover:bg-blue-50"><Pencil size={13} /></button><button onClick={() => deleteItem(item)} className="rounded-lg p-1.5 text-red-400 transition-colors hover:bg-red-50"><Trash2 size={13} /></button></div></td>
                      </tr>
                    )
                  })}
                  {supplyItems.length === 0 && <tr><td colSpan={7} className="px-5 py-12"><div className="bb-empty-state py-10"><ShoppingBag size={32} className="mx-auto mb-2 opacity-30" /><p className="text-base font-semibold text-slate-800">No supply items yet</p><p className="text-sm text-slate-500">Add your first item to begin live room-supply tracking.</p></div></td></tr>}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'report' && (
        <div className="flex flex-col gap-5">
          <div className="bb-filter-bar mb-5 flex-wrap">
            <div className="flex items-center gap-2 text-sm"><label className="text-slate-500">From</label><input type="date" className="input text-sm" value={reportStart} onChange={(e) => setReportStart(e.target.value)} /><label className="text-slate-500">To</label><input type="date" className="input text-sm" value={reportEnd} onChange={(e) => setReportEnd(e.target.value)} /></div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={loadReport} disabled={reportLoading} className="btn-secondary"><RefreshCw size={14} /> {reportLoading ? 'Refreshing…' : 'Refresh'}</button>
              <button type="button" onClick={exportReport} disabled={reportLoading || reportExporting} className="btn-primary"><FileSpreadsheet size={15} /> {reportExporting ? 'Exporting…' : 'Export Excel'}</button>
              <button type="button" onClick={exportReportPdf} disabled={reportLoading || reportPdfExporting} className="btn-secondary"><FileDown size={15} /> {reportPdfExporting ? 'Saving…' : 'Export PDF'}</button>
            </div>
            {grandTotal > 0 && <div className="ml-auto rounded-xl bg-green-50 px-4 py-2 text-sm font-semibold text-green-800">Total Supply Cost: {currency} {fmt(grandTotal)}</div>}
            {reportMessage && <div className={`w-full rounded-xl border px-3 py-2 text-sm ${reportMessage.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{reportMessage.text}</div>}
          </div>
          {reportLoading ? (
            <div className="bb-empty-state min-h-[220px]"><p className="text-sm font-medium text-slate-500">Loading room supply report…</p></div>
          ) : reportData.length === 0 ? (
            <div className="bb-empty-state min-h-[220px]"><p className="text-base font-semibold text-slate-800">No room supply cost data for this period</p><p className="text-sm text-slate-500">Record live room usage from the Live Stock tab to see room supply costs here.</p></div>
          ) : (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <div className="bb-card p-5"><h3 className="mb-4 font-semibold text-slate-700">Cost per Room</h3><div className="bb-table-shell overflow-hidden shadow-none"><table className="w-full text-sm"><thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500"><tr><th className="px-3 py-2 text-left">Room</th><th className="px-3 py-2 text-right">Supply Cost</th></tr></thead><tbody className="divide-y divide-slate-100">{Object.entries(reportByRoom).sort((a, b) => b[1].total - a[1].total).map(([key, row]) => <tr key={key} className="hover:bg-slate-50"><td className="px-3 py-2 font-medium text-slate-800">Room {row.room_number}</td><td className="px-3 py-2 text-right font-semibold text-slate-800">{currency} {fmt(row.total)}</td></tr>)}</tbody></table></div></div>
              <div className="bb-card p-5"><h3 className="mb-4 font-semibold text-slate-700">Cost by Supply Item</h3><div className="bb-table-shell overflow-hidden shadow-none"><table className="w-full text-sm"><thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500"><tr><th className="px-3 py-2 text-left">Supply Item</th><th className="px-3 py-2 text-right">Units Used</th><th className="px-3 py-2 text-right">Total Cost</th></tr></thead><tbody className="divide-y divide-slate-100">{Object.values(reportByItem).sort((a, b) => b.total_cost - a.total_cost).map((row) => <tr key={row.name} className="hover:bg-slate-50"><td className="px-3 py-2 font-medium text-slate-800">{row.name}</td><td className="px-3 py-2 text-right text-slate-600">{fmt(row.total_units, 0)} {row.unit}</td><td className="px-3 py-2 text-right font-semibold text-slate-800">{currency} {fmt(row.total_cost)}</td></tr>)}</tbody></table></div></div>
            </div>
          )}
        </div>
      )}

      {itemModal && (
        <Modal title={editingItem ? 'Edit Supply Item' : 'Add Supply Item'} onClose={() => setItemModal(false)} size="sm">
          <form onSubmit={handleItemSubmit} className="space-y-4">
            {itemError && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{itemError}</div>}
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Item Name *</label><input type="text" className="input" value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} required /></div>
            <div className="grid grid-cols-2 gap-4"><div><label className="mb-1 block text-sm font-medium text-slate-700">Category *</label><select className="input" value={itemForm.category} onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })}>{SUPPLY_CATEGORIES.map((value) => <option key={value} value={value}>{value}</option>)}</select></div><div><label className="mb-1 block text-sm font-medium text-slate-700">Unit *</label><select className="input" value={itemForm.unit} onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}>{SUPPLY_UNITS.map((value) => <option key={value} value={value}>{value}</option>)}</select></div></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Store Reorder Level ({itemForm.unit})</label><input type="number" step="0.1" min="0" className="input" value={itemForm.reorder_level} onChange={(e) => setItemForm({ ...itemForm, reorder_level: e.target.value })} /></div>
            {!editingItem && <div><label className="mb-1 block text-sm font-medium text-slate-700">Opening Store Stock ({itemForm.unit})</label><input type="number" step="0.1" min="0" className="input" value={itemForm.current_stock} onChange={(e) => setItemForm({ ...itemForm, current_stock: e.target.value })} /></div>}
            <div className="flex gap-3 pt-2"><button type="button" onClick={() => setItemModal(false)} className="btn-secondary flex-1">Cancel</button><button type="submit" disabled={itemSaving} className="btn-primary flex-1">{itemSaving ? 'Saving...' : editingItem ? 'Update' : 'Add Item'}</button></div>
          </form>
        </Modal>
      )}

      {purchaseModal && (
        <Modal title={purchaseItem ? `Record Purchase — ${purchaseItem.name}` : 'Record Purchase'} onClose={() => setPurchaseModal(false)} size="sm">
          <form onSubmit={handlePurchaseSubmit} className="space-y-4">
            {purchaseError && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{purchaseError}</div>}
            
            {!purchaseItem && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Select Supply Item *</label>
                <select
                  className="input"
                  onChange={(e) => {
                    const found = supplyItems.find(i => i.id === e.target.value);
                    if (found) {
                      setPurchaseItem(found);
                      setPurchaseError('');
                    }
                  }}
                  defaultValue=""
                  required
                >
                  <option value="" disabled>Select an item...</option>
                  {supplyItems.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                </select>
                <p className="mt-1 text-xs text-slate-500">Pick the existing stock item you are purchasing.</p>
              </div>
            )}

            {purchaseItem && (
              <>
                <div><label className="mb-1 block text-sm font-medium text-slate-700">Date *</label><input type="date" className="input" value={purchaseForm.date} onChange={(e) => setPurchaseForm({ ...purchaseForm, date: e.target.value })} required /></div>
                <div className="grid grid-cols-2 gap-4"><div><label className="mb-1 block text-sm font-medium text-slate-700">Qty ({purchaseItem?.unit || 'units'}s) *</label><input type="number" step="1" min="0" className="input" value={purchaseForm.quantity_purchased} onChange={(e) => setPurchaseForm({ ...purchaseForm, quantity_purchased: e.target.value })} /></div><div><label className="mb-1 block text-sm font-medium text-slate-700">Total Cost ({currency}) *</label><input type="number" step="0.01" min="0.01" className="input" value={purchaseForm.total_cost} onChange={(e) => setPurchaseForm({ ...purchaseForm, total_cost: e.target.value })} required /></div></div>
                <div className="grid grid-cols-2 gap-4"><div><label className="mb-1 block text-sm font-medium text-slate-700">Number of Packs</label><input type="number" step="1" min="0" className="input" value={purchaseForm.package_count} onChange={(e) => setPurchaseForm({ ...purchaseForm, package_count: e.target.value })} /></div><div><label className="mb-1 block text-sm font-medium text-slate-700">Units per Pack</label><input type="number" step="0.1" min="0" className="input" value={purchaseForm.units_per_package} onChange={(e) => setPurchaseForm({ ...purchaseForm, units_per_package: e.target.value })} /></div></div>
                {unitCostPreview() && <div className="rounded-xl bg-green-50 p-3 text-sm text-green-800">Auto unit cost: <strong>{currency} {unitCostPreview()}</strong> per {purchaseItem?.unit || 'units'}</div>}
                <div><label className="mb-1 block text-sm font-medium text-slate-700">Notes</label><input type="text" className="input" value={purchaseForm.notes} onChange={(e) => setPurchaseForm({ ...purchaseForm, notes: e.target.value })} /></div>
              </>
            )}
            
            <div className="flex gap-3 pt-2"><button type="button" onClick={() => setPurchaseModal(false)} className="btn-secondary flex-1">Cancel</button><button type="submit" disabled={purchaseSaving || !purchaseItem} className="btn-primary flex-1">{purchaseSaving ? 'Saving...' : 'Record Purchase'}</button></div>
          </form>
        </Modal>
      )}

      {adjustModal && adjustItem && (
        <Modal title={`Adjust Store Stock — ${adjustItem.name}`} onClose={() => setAdjustModal(false)} size="sm">
          <form onSubmit={handleAdjustSubmit} className="space-y-4">
            {adjustError && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{adjustError}</div>}
            <p className="text-sm text-gray-600">Current store stock: <strong>{fmtQty(adjustItem.current_stock)} {adjustItem.unit}</strong></p>
            <div><label className="mb-1 block text-sm font-medium text-gray-700">Adjustment ({adjustItem.unit}) *</label><input type="number" step="0.1" className="input" value={adjustDelta} onChange={(e) => setAdjustDelta(e.target.value)} required /></div>
            <div><label className="mb-1 block text-sm font-medium text-gray-700">Reason</label><input type="text" className="input" value={adjustNotes} onChange={(e) => setAdjustNotes(e.target.value)} /></div>
            <div><label className="mb-1 block text-sm font-medium text-gray-700">Manager PIN *</label><input type="password" className="input" value={adjustPin} onChange={(e) => setAdjustPin(e.target.value)} required placeholder="Manager PIN" /></div>
            <div className="flex gap-3 pt-2"><button type="button" onClick={() => setAdjustModal(false)} className="btn-secondary flex-1">Cancel</button><button type="submit" disabled={adjustSaving} className="btn-primary flex-1">{adjustSaving ? 'Saving...' : 'Apply Adjustment'}</button></div>
          </form>
        </Modal>
      )}

      {movementModal && (
        <Modal title={movementType === 'load' ? 'Load Supply Into Room' : movementType === 'use' ? 'Record Supply Usage' : 'Return Unused Supply'} onClose={() => setMovementModal(false)} size="sm">
          <form onSubmit={handleMovementSubmit} className="space-y-4">
            {movementError && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{movementError}</div>}
            {movementType === 'load' ? (
              <>
                <div><label className="mb-1 block text-sm font-medium text-slate-700">Supply Item *</label><select className="input" value={movementForm.item_id} onChange={(e) => setMovementForm({ ...movementForm, item_id: e.target.value })} required><option value="">Select supply item</option>{supplyItems.map((item) => <option key={item.id} value={item.id}>{item.name} ({fmtQty(item.current_stock)} {item.unit} in store)</option>)}</select></div>
                <div><label className="mb-1 block text-sm font-medium text-slate-700">Room *</label><select className="input" value={movementForm.room_id} onChange={(e) => setMovementForm({ ...movementForm, room_id: e.target.value })} required><option value="">Select room</option>{rooms.map((room) => <option key={room.id} value={room.id}>Room {room.room_number} {room.room_type ? `(${room.room_type})` : ''}</option>)}</select></div>
              </>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600"><p><strong>{movementRow?.supply_name || movementItem?.name}</strong> in <strong>Room {movementRow?.room_number}</strong></p><p className="mt-1 text-xs text-slate-500">Current room balance: {fmtQty(movementRow?.quantity_on_hand)} {movementRow?.supply_unit || movementItem?.unit}</p></div>
            )}
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Quantity *</label><input type="number" step="0.1" min="0.1" className="input" value={movementForm.quantity} onChange={(e) => setMovementForm({ ...movementForm, quantity: e.target.value })} required /></div>
            {movementType === 'load' && <div><label className="mb-1 block text-sm font-medium text-slate-700">Room Low-Stock Alert Level</label><input type="number" step="0.1" min="0" className="input" value={movementForm.reorder_level} onChange={(e) => setMovementForm({ ...movementForm, reorder_level: e.target.value })} /></div>}
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Notes</label><input type="text" className="input" value={movementForm.notes} onChange={(e) => setMovementForm({ ...movementForm, notes: e.target.value })} /></div>
            <div className="flex gap-3 pt-2"><button type="button" onClick={() => setMovementModal(false)} className="btn-secondary flex-1">Cancel</button><button type="submit" disabled={movementSaving} className="btn-primary flex-1">{movementSaving ? 'Saving...' : movementType === 'load' ? 'Load Into Room' : movementType === 'use' ? 'Record Usage' : 'Return To Store'}</button></div>
          </form>
        </Modal>
      )}
    </div>
  )
}

