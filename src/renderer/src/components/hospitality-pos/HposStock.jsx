import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Boxes, ClipboardCheck, History, PackageCheck, Plus, Printer, RefreshCw, ScanLine, Search, X } from 'lucide-react'
import { useAccess, useSettings } from '../../app-context'
import { canAccessCapability } from '../../../../shared/accessControl'
import { isBarOnlyMode } from '../../../../shared/propertyTypes'
import { BAR_PRODUCT_CATEGORIES } from '../../../../shared/barModeProfile'
import { unpackTransport } from '../../transportUnpack'
import { buildOptionalUnitCostPatch } from '../../../../shared/inventoryStockForm'
import { createBarcodeScannerDecoder } from '../../../../shared/barcodeScanner'

const stockNumber = (item) => Number(item.current_stock || 0)
const reorderNumber = (item) => Number(item.reorder_level || 0)
const isLow = (item) => reorderNumber(item) > 0 && stockNumber(item) <= reorderNumber(item)
const isOutletId = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))

const BAR_CATEGORY_SUGGESTIONS = BAR_PRODUCT_CATEGORIES

const STOCK_ACTION_REASONS = {
  receive: [
    { value: 'delivery_received', label: 'Delivery received' },
    { value: 'opening_balance', label: 'Opening balance correction' },
    { value: 'return_to_stock', label: 'Returned to stock' },
    { value: 'other', label: 'Other' }
  ],
  count: [
    { value: 'routine_count', label: 'Routine physical count' },
    { value: 'after_service_count', label: 'After-service count' },
    { value: 'variance_follow_up', label: 'Variance follow-up' },
    { value: 'other', label: 'Other' }
  ]
}

const actionReasonLabel = (mode, code) => STOCK_ACTION_REASONS[mode]?.find((entry) => entry.value === code)?.label || code

const formatAgeDate = (value) => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString()
}

const ageDescription = (row) => {
  if (!row) return 'Aging unavailable'
  if (row.days_since_receipt == null) return 'No receipt history'
  return `${row.days_since_receipt} day${Number(row.days_since_receipt) === 1 ? '' : 's'} since receipt`
}

export default function HposStock() {
  const access = useAccess()
  const { settings } = useSettings()
  const barOnly = isBarOnlyMode(settings)
  const currency = settings?.currency || 'P'
  const canManage = canAccessCapability(access, 'inventory.manage')
  // `null` is the canonical unrestricted value (manager/admin); an array is
  // an assigned-outlet scope (cashier/supervisor). Never turn an empty scoped
  // array into a lodge-wide request.
  const allowedOutletIds = Array.isArray(access?.allowedOutletIds)
    ? access.allowedOutletIds.map((id) => String(id))
    : null
  const outletScoped = Array.isArray(allowedOutletIds)
  const [items, setItems] = useState([])
  const [itemsRead, setItemsRead] = useState({ source: 'unknown', complete: false })
  const [aging, setAging] = useState([])
  const [outlets, setOutlets] = useState([])
  const [outletId, setOutletId] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [agingError, setAgingError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [stockAction, setStockAction] = useState(null)
  const [lowOnly, setLowOnly] = useState(false)
  const [historyItemId, setHistoryItemId] = useState(null)
  const [movementHistory, setMovementHistory] = useState({})
  const [allHistoryOpen, setAllHistoryOpen] = useState(false)
  const [allHistory, setAllHistory] = useState({ rows: [], source: 'unknown', complete: false, loading: false, error: '' })
  const [printSheet, setPrintSheet] = useState(false)
  const [countAllOpen, setCountAllOpen] = useState(false)
  const [countOperationId, setCountOperationId] = useState(null)
  const [countLines, setCountLines] = useState([])
  const [countNotes, setCountNotes] = useState('')
  const [deliveryOpen, setDeliveryOpen] = useState(false)
  const [deliveryOperationId, setDeliveryOperationId] = useState(null)
  const [deliveryLines, setDeliveryLines] = useState([])
  const [deliveryNotes, setDeliveryNotes] = useState('')
  const [deliveryBarcode, setDeliveryBarcode] = useState('')
  const [deliveryLookup, setDeliveryLookup] = useState('')
  const [newItem, setNewItem] = useState({ name: '', category: 'Beer', barcode: '', opening_stock: '', unit: 'bottle', reorder_level: '', unit_cost: '', outlet_id: '' })
  const [barcodeTouched, setBarcodeTouched] = useState(false)
  const [barcodeCaptureActive, setBarcodeCaptureActive] = useState(false)
  const [barcodeScanStatus, setBarcodeScanStatus] = useState('')
  const barcodeInputRef = useRef(null)
  const [actionForm, setActionForm] = useState({ quantity: '', reasonCode: '', reasonDetail: '', reason: '' })

  useEffect(() => {
    const onAfterPrint = () => setPrintSheet(false)
    window.addEventListener('afterprint', onAfterPrint)
    return () => window.removeEventListener('afterprint', onAfterPrint)
  }, [])

  // Opt-in keyboard-wedge capture for stock setup. This keeps manual typing
  // possible and prevents scanner characters from leaking into other fields.
  useEffect(() => {
    if (!showCreate || !barcodeCaptureActive) return undefined
    const decoder = createBarcodeScannerDecoder()
    let idleTimer = null
    const completeScan = (result = {}) => {
      setBarcodeCaptureActive(false)
      if (!result.success) {
        setBarcodeScanStatus(`Barcode scan failed: ${result.code || 'invalid_scan'}.`)
        return
      }
      setNewItem((current) => ({ ...current, barcode: result.barcode }))
      setBarcodeTouched(true)
      setBarcodeScanStatus(`Barcode captured: ${result.barcode}`)
    }
    const onKeyDown = (event) => {
      const key = String(event.key || '')
      if (!(key.length === 1 || key === 'Enter' || key === 'NumpadEnter' || key === 'Tab')) return
      const outcome = decoder.consumeKey(event)
      if (outcome.type === 'buffered' || outcome.type === 'completed') event.preventDefault()
      if (outcome.type === 'buffered') {
        clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          const flushed = decoder.flush()
          if (flushed.type === 'completed') completeScan(flushed.result)
        }, decoder.getOptions().idleCompleteMs)
        return
      }
      if (outcome.type === 'completed') completeScan(outcome.result)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { clearTimeout(idleTimer); window.removeEventListener('keydown', onKeyDown, true) }
  }, [showCreate, barcodeCaptureActive])

  const loadItems = async (requestedOutletId = outletId) => {
    setLoading(true)
    setError('')
    setAgingError('')
    // A failed refresh must never leave a prior server-certified envelope
    // authorizing a count against stale last-known rows.
    setItemsRead({ source: 'refreshing', complete: false })
    let outletRows = []
    try {
      outletRows = await window.api?.outlets?.getAll?.() ?? []
    } catch (outletError) {
      if (outletScoped) setError(outletError?.message || 'Assigned stock outlets could not be loaded.')
    }
    const activeOutlets = (Array.isArray(outletRows) ? outletRows : [])
      .filter((outlet) => outlet?.is_active !== false)
      .filter((outlet) => isOutletId(outlet?.id))
      .filter((outlet) => !outletScoped || allowedOutletIds.includes(String(outlet.id)))
    const requested = isOutletId(requestedOutletId) ? String(requestedOutletId) : ''
    const nextOutletId = outletScoped
      ? (activeOutlets.some((outlet) => String(outlet.id) === requested) ? requested : String(activeOutlets[0]?.id || ''))
      : requested
    setOutlets(activeOutlets)
    setOutletId(nextOutletId)
    const agingPromise = outletScoped && !nextOutletId
      ? Promise.reject(new Error('No assigned outlet is available for stock aging.'))
      : (window.api?.inventory?.getBarStockAging?.(nextOutletId || null) ?? [])
    const stockReadPromise = window.api?.inventory?.getItemsWithReadStatus
      ? window.api.inventory.getItemsWithReadStatus()
      : Promise.reject(new Error('This app version cannot verify the stock source. Restart the app and refresh.'))
    const [itemsResult, agingResult] = await Promise.allSettled([
      stockReadPromise,
      agingPromise
    ])
    if (itemsResult.status === 'fulfilled') {
      const inventoryRead = itemsResult.value || {}
      const rows = unpackTransport(inventoryRead.items)
      setItems(rows)
      setItemsRead({ source: inventoryRead.source || 'unknown', complete: inventoryRead.complete === true })
    }
    else {
      setItemsRead({ source: 'unavailable', complete: false })
      setError(itemsResult.reason?.message || 'Stock could not be refreshed.')
    }
    if (agingResult.status === 'fulfilled') setAging(Array.isArray(agingResult.value) ? agingResult.value : [])
    else setAgingError(agingResult.reason?.message || 'Stock aging could not be refreshed.')
    setLoading(false)
  }

  useEffect(() => { loadItems() }, [])

  const filtered = useMemo(() => items.filter((item) =>
    (!outletId ? !outletScoped || !item.outlet_id || allowedOutletIds.includes(String(item.outlet_id)) : String(item.outlet_id || '') === String(outletId)) &&
    (!lowOnly || isLow(item)) &&
    [String(item.name || ''), String(item.barcode || '')].some((value) => value.toLowerCase().includes(search.trim().toLowerCase()))), [items, search, outletId, outletScoped, lowOnly])
  const lowStock = filtered.filter(isLow)
  const healthyStock = filtered.filter((item) => !isLow(item))
  const scopedItems = useMemo(() => items.filter((item) => (
    !outletId
      ? (!outletScoped || !item.outlet_id || allowedOutletIds.includes(String(item.outlet_id)))
      : String(item.outlet_id || '') === String(outletId)
  )), [items, outletId, outletScoped, allowedOutletIds])
  const stockCountsReady = itemsRead.complete && scopedItems.length > 0 && scopedItems.every((item) => Boolean(item?.updated_at))
  const agingByItem = useMemo(() => new Map(aging.map((row) => [row.item_id, row])), [aging])

  const loadMovementHistory = async (item) => {
    if (!item?.id) return
    setHistoryItemId(item.id)
    setMovementHistory((current) => ({
      ...current,
      [item.id]: { ...(current[item.id] || {}), loading: true, error: '' }
    }))
    try {
      if (typeof window.api?.inventory?.getMovementsWithReadStatus !== 'function') {
        throw new Error('This app version cannot certify item movement history. Restart the app and refresh.')
      }
      const result = await window.api.inventory.getMovementsWithReadStatus({ item_id: item.id, limit: 50 })
      setMovementHistory((current) => ({
        ...current,
        [item.id]: {
          rows: Array.isArray(result?.rows) ? result.rows : [],
          source: result?.source || 'unknown',
          complete: result?.complete === true,
          loading: false,
          error: ''
        }
      }))
    } catch (historyError) {
      setMovementHistory((current) => ({
        ...current,
        [item.id]: { ...(current[item.id] || {}), loading: false, error: historyError?.message || 'Movement history could not be loaded.' }
      }))
    }
  }

  const printBlankCountSheet = () => {
    if (!filtered.length) {
      setError('Add or select stock items before printing a count sheet.')
      return
    }
    setPrintSheet(true)
    window.setTimeout(() => window.print(), 60)
  }

  const openCreate = () => {
    setError('')
    setBarcodeScanStatus('')
    setEditingItem(null)
    setBarcodeTouched(false)
    setBarcodeCaptureActive(false)
    const preferredBarOutletId = String(outlets.find((outlet) => outlet?.is_active !== false && outlet?.type === 'beverage')?.id || '')
    setNewItem({ name: '', category: 'Beer', barcode: '', opening_stock: '', unit: 'bottle', reorder_level: '', unit_cost: '', outlet_id: outletId || (barOnly ? preferredBarOutletId : '') })
    setShowCreate(true)
  }

  const openEdit = (item) => {
    setError('')
    setBarcodeScanStatus('')
    setEditingItem(item)
    setBarcodeTouched(false)
    setBarcodeCaptureActive(false)
    setNewItem({
      name: item.name || '',
      category: item.category || 'Other',
      barcode: item.barcode || '',
      opening_stock: '',
      unit: item.unit || 'each',
      reorder_level: String(item.reorder_level ?? ''),
      unit_cost: item.latest_unit_cost == null ? '' : String(item.latest_unit_cost),
      outlet_id: item.outlet_id || outletId || (barOnly ? String(outlets.find((outlet) => outlet?.is_active !== false && outlet?.type === 'beverage')?.id || '') : ''),
    })
    setShowCreate(true)
  }

  const saveItem = async () => {
    if (!newItem.name.trim()) { setError('Enter the stock item name.'); return }
    const costPatch = buildOptionalUnitCostPatch(newItem.unit_cost)
    if (!costPatch.ok) {
      setError('Enter a valid non-negative unit cost, or leave it blank to keep the current cost.')
      return
    }
    setSaving(true); setError(''); setNotice('')
    try {
      const durableOutletId = isOutletId(newItem.outlet_id) && outlets.some((outlet) => String(outlet.id) === String(newItem.outlet_id))
        ? String(newItem.outlet_id)
        : null
      const barcodePatch = editingItem
        ? (barcodeTouched ? { barcode: String(newItem.barcode || '').trim() || null } : {})
        : { barcode: String(newItem.barcode || '').trim() || null }
      const result = editingItem
        ? await window.api.inventory.updateItem(editingItem.id, {
            name: newItem.name.trim(),
            category: newItem.category.trim() || null,
            unit: newItem.unit.trim() || 'each',
            reorder_level: Number(newItem.reorder_level || 0),
            ...costPatch.patch,
            ...barcodePatch,
            outlet_id: durableOutletId,
          })
        : await window.api.inventory.createItem({
            name: newItem.name.trim(),
            category: newItem.category.trim() || null,
            current_stock: Number(newItem.opening_stock || 0),
            unit: newItem.unit.trim() || 'each',
            reorder_level: Number(newItem.reorder_level || 0),
            ...costPatch.patch,
            ...barcodePatch,
            outlet_id: durableOutletId,
          })
      if (!result?.success) throw new Error(result?.error || 'Could not create this stock item.')
      setNewItem({ name: '', category: 'Beer', barcode: '', opening_stock: '', unit: 'bottle', reorder_level: '', unit_cost: '', outlet_id: '' })
      setBarcodeTouched(false)
      setBarcodeCaptureActive(false)
      setBarcodeScanStatus('')
      setEditingItem(null)
      setShowCreate(false)
      setNotice(editingItem ? 'Stock item details updated.' : 'Stock item created. You can now link it to a sellable product.')
      await loadItems()
    } catch (saveError) { setError(saveError?.message || (editingItem ? 'Could not update this stock item.' : 'Could not create this stock item.')) }
    finally { setSaving(false) }
  }

  const recordStockAction = async () => {
    if (!stockAction?.item) return
    if (stockAction.mode === 'count' && !stockCountsReady) {
      setError('Reconnect and refresh the server stock list before recording a physical count. A cached quantity cannot be used to calculate an audited adjustment.')
      return
    }
    const entered = Number(actionForm.quantity)
    if (!Number.isFinite(entered) || entered < 0) { setError('Enter a valid quantity of zero or more.'); return }
    if (!actionForm.reasonCode) { setError('Select a structured reason for this stock action.'); return }
    const reasonDetail = String(actionForm.reasonDetail || actionForm.reason || '').trim()
    if (!reasonDetail) { setError('Add a short delivery reference or count note.'); return }
    if (reasonDetail.length > 300) { setError('Keep the stock note to 300 characters or fewer.'); return }
    const delta = stockAction.mode === 'count' ? entered - stockNumber(stockAction.item) : entered
    if (delta === 0) {
      setNotice(`Count confirmed for ${stockAction.item.name}; stock was already correct.`)
      setStockAction(null); setActionForm({ quantity: '', reasonCode: '', reasonDetail: '', reason: '' }); return
    }
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await window.api.inventory.adjustStock(
        stockAction.item.id,
        delta,
        `${stockAction.mode === 'count' ? 'Physical count' : 'Simple delivery'} · reason_code=${actionForm.reasonCode} · ${actionReasonLabel(stockAction.mode, actionForm.reasonCode)} · ${reasonDetail}`,
        null,
        stockAction.operationId,
      )
      if (!result?.success) throw new Error(result?.error || 'Could not record this stock change.')
      setNotice(stockAction.mode === 'count' ? `Physical count recorded for ${stockAction.item.name}.` : `Delivery received for ${stockAction.item.name}.`)
      setStockAction(null); setActionForm({ quantity: '', reasonCode: '', reasonDetail: '', reason: '' })
      await loadItems()
    } catch (saveError) { setError(saveError?.message || 'Could not record this stock change.') }
    finally { setSaving(false) }
  }

  const openCountAll = () => {
    if (!stockCountsReady) {
      setError('Reconnect and refresh the server stock list before opening Count All. Cached quantities cannot authorize a batch count.')
      return
    }
    if (!scopedItems.length) { setError('Select an outlet or add stock items before opening Count All.'); return }
    setCountOperationId(crypto.randomUUID())
    setCountLines(scopedItems.map((item) => ({
      item_id: item.id,
      item_name: item.name,
      unit: item.unit || 'each',
      expected_qty: stockNumber(item),
      expected_updated_at: item.updated_at || null,
      actual_qty: '',
      reason_code: 'routine_count',
      reason: ''
    })))
    setCountNotes('')
    setCountAllOpen(true)
    setError('')
  }

  const postCountAll = async () => {
    if (!stockCountsReady || !countLines.length) return
    const invalid = countLines.find((line) => String(line.actual_qty ?? '').trim() === '' || !Number.isFinite(Number(line.actual_qty)) || Number(line.actual_qty) < 0 || ((line.reason_code === 'other' || Number(line.actual_qty) !== Number(line.expected_qty)) && !String(line.reason || '').trim()))
    if (invalid) { setError('Enter a non-negative quantity for every line; add a detail for an exceptional reason or variance.'); return }
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await window.api.inventory.postBarPhysicalCount({
        outlet_id: outletId || null,
        operation_id: countOperationId,
        notes: countNotes,
        lines: countLines.map((line) => ({ ...line, actual_qty: Number(line.actual_qty) }))
      })
      if (!result?.success) throw new Error(result?.error || 'Could not post the physical count.')
      setCountAllOpen(false)
      setNotice(result.offline ? 'Count saved on this computer and queued. It remains pending until the server confirms it.' : `Count All posted for ${countLines.length} item${countLines.length === 1 ? '' : 's'}.`)
      if (!result.offline) { setCountLines([]); setCountOperationId(null) }
      await loadItems()
    } catch (postError) { setError(postError?.message || 'Could not post the physical count.') }
    finally { setSaving(false) }
  }

  const openDelivery = () => {
    setDeliveryOperationId(crypto.randomUUID())
    setDeliveryLines([])
    setDeliveryNotes('')
    setDeliveryBarcode('')
    setDeliveryLookup('')
    setDeliveryOpen(true)
    setError('')
  }

  const addDeliveryItem = (item) => {
    if (!item?.id) return
    if (deliveryLines.some((line) => line.item_id === item.id)) {
      setDeliveryLookup('This item is already in the delivery. Adjust its quantity below.')
      return
    }
    setDeliveryLines((current) => [...current, { item_id: item.id, item_name: item.name, unit: item.unit || 'each', quantity: '1', reason_code: 'delivery_received', reason: '' }])
    setDeliveryLookup(`Selected ${item.name}.`)
  }

  const lookupDeliveryBarcode = async () => {
    const barcode = String(deliveryBarcode || '').trim()
    if (!barcode) { setDeliveryLookup('Scan or enter a barcode first.'); return }
    setDeliveryLookup('Looking up barcode…')
    try {
      const result = await window.api.inventory.findByBarcode(barcode, outletId || null)
      if (result?.success === false) throw new Error(result.error)
      if (!result) throw new Error('No stock item matches that barcode in the selected outlet.')
      addDeliveryItem(result)
      setDeliveryBarcode('')
    } catch (lookupError) { setDeliveryLookup(lookupError?.message || 'Barcode lookup failed.') }
  }

  const postDelivery = async () => {
    const invalid = deliveryLines.find((line) => !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0 || ((line.reason_code === 'other') && !String(line.reason || '').trim()))
    if (!deliveryLines.length || invalid) { setError('Add at least one delivery line with a positive quantity; add detail when using Other.'); return }
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await window.api.inventory.postBarSimpleDelivery({
        outlet_id: outletId || null,
        operation_id: deliveryOperationId,
        notes: deliveryNotes,
        lines: deliveryLines.map((line) => ({ ...line, quantity: Number(line.quantity) }))
      })
      if (!result?.success) throw new Error(result?.error || 'Could not receive the delivery.')
      setDeliveryOpen(false)
      setNotice(result.offline ? 'Delivery saved on this computer and queued. It remains pending until the server confirms it.' : `Delivery received for ${deliveryLines.length} item${deliveryLines.length === 1 ? '' : 's'}.`)
      if (!result.offline) { setDeliveryLines([]); setDeliveryOperationId(null) }
      await loadItems()
    } catch (postError) { setError(postError?.message || 'Could not receive the delivery.') }
    finally { setSaving(false) }
  }

  const loadAllHistory = async () => {
    setAllHistoryOpen(true)
    setAllHistory((current) => ({ ...current, loading: true, error: '' }))
    try {
      const result = await window.api.inventory.getBarStockCountHistory(outletId || null, 200)
      setAllHistory({ rows: Array.isArray(result?.rows) ? result.rows : [], source: result?.source || 'unknown', complete: result?.complete === true, loading: false, error: '' })
    } catch (historyError) { setAllHistory((current) => ({ ...current, loading: false, error: historyError?.message || 'Could not load history.' })) }
  }

  const printBarcodeLabel = async (item) => {
    if (!item?.barcode) { setError('Add a barcode to this stock item before printing a label.'); return }
    setError(''); setNotice('')
    try {
      const result = await window.api.inventory.printBarcodeLabels([{ item_id: item.id }])
      if (!result?.success) throw new Error(result?.error || 'Could not print the barcode label.')
      setNotice(`Barcode label sent for ${item.name}.`)
    } catch (printError) { setError(printError?.message || 'Could not print the barcode label.') }
  }

  return (
    <div className={printSheet ? 'hpos-stock-printing' : ''} style={{ maxWidth: 1180, margin: '0 auto', padding: '4px 0 28px' }}>
      <section className="no-print" aria-label="Stock tools" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 10, marginBottom: 12, padding: '12px 14px', border: '1px solid rgba(72,45,56,.12)', borderRadius: 14, background: '#fffdf9' }}>
        <label style={{ minWidth: 260, color: '#695961', fontSize: 10, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase' }}>Read-only movement history
          <select value={historyItemId || ''} onChange={(event) => { const id = event.target.value; const item = filtered.find((row) => String(row.id) === String(id)); if (!item) { setHistoryItemId(null); return } loadMovementHistory(item) }} style={{ display: 'block', width: '100%', marginTop: 4, padding: '9px 10px', borderRadius: 10, border: '1px solid rgba(72,45,56,.18)', background: '#fff', color: '#33232b', fontSize: 12 }}>
            <option value="">Select an item…</option>
            {filtered.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 38, padding: '0 10px', border: '1px solid #d7c4ba', borderRadius: 10, color: '#54434f', background: '#fff', fontSize: 12, fontWeight: 800 }}>
          <input type="checkbox" checked={lowOnly} onChange={(event) => setLowOnly(event.target.checked)} /> Low stock only
        </label>
        <button type="button" onClick={printBlankCountSheet} disabled={loading || !filtered.length} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 11px', borderRadius: 10, border: '1px solid #d7c4ba', color: '#54434f', background: '#fff', fontSize: 12, fontWeight: 800 }}><Printer size={14} /> Print blank count sheet</button>
        <button type="button" onClick={loadAllHistory} disabled={loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 11px', borderRadius: 10, border: '1px solid #d7c4ba', color: '#54434f', background: '#fff', fontSize: 12, fontWeight: 800 }}><History size={14} /> View full history</button>
        {canManage && <><button type="button" onClick={openCountAll} disabled={loading || !stockCountsReady || !scopedItems.length} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 11px', borderRadius: 10, border: 0, color: '#fff', background: stockCountsReady ? '#3d2b34' : '#b6a8ac', fontSize: 12, fontWeight: 800 }}><ClipboardCheck size={14} /> Count All</button><button type="button" onClick={openDelivery} disabled={loading || !scopedItems.length} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 11px', borderRadius: 10, border: '1px solid #d7c4ba', color: '#54434f', background: '#fff', fontSize: 12, fontWeight: 800 }}><PackageCheck size={14} /> Receive delivery</button></>}
        <small style={{ flex: '1 1 100%', color: '#806f76', fontSize: 11 }}>History is read-only and source-labelled. Count All requires a complete server read and posts every line through one audited RPC; deliveries never ask for supplier, PO, lot, expiry or valuation data.</small>
      </section>
      {showCreate && barOnly && <div className="no-print" aria-label="Bar category suggestions" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 10, color: '#806f76', fontSize: 11 }}><span style={{ fontWeight: 800 }}>Suggested categories:</span>{BAR_CATEGORY_SUGGESTIONS.map((category) => <button key={category} type="button" onClick={() => setNewItem((current) => ({ ...current, category }))} style={{ border: '1px solid #d7c4ba', borderRadius: 999, padding: '5px 9px', background: '#fff', color: '#54434f', fontSize: 11, fontWeight: 750 }}>{category}</button>)}</div>}
      <section style={{
        position: 'relative', overflow: 'hidden', borderRadius: 20, padding: '24px', color: '#fff',
        background: 'linear-gradient(135deg, #28202a 0%, #45303a 52%, #753e32 100%)',
        boxShadow: '0 18px 38px rgba(43, 27, 35, .24)'
      }}>
        <div style={{ position: 'absolute', width: 220, height: 220, borderRadius: '50%', background: 'rgba(255,255,255,.07)', right: -68, top: -112 }} />
        <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'start', gap: 18 }}>
          <div>
            <p style={{ margin: 0, color: 'rgba(255,255,255,.66)', fontSize: 11, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase' }}>Service stock view</p>
            <h2 style={{ margin: '7px 0 5px', fontSize: 25, letterSpacing: '-.03em' }}>Know what is safe to sell</h2>
            <p style={{ margin: 0, maxWidth: 550, color: 'rgba(255,255,255,.78)', fontSize: 13, lineHeight: 1.5 }}>Create the bottles, kegs, mixers, snacks and prepared portions you count. Receive simple deliveries and record physical counts without opening a restaurant inventory workspace.</p>
          </div>
          <div style={{ display: 'flex', gap: 9 }}>
            <button type="button" onClick={loadItems} disabled={loading} aria-label="Refresh stock" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,.25)', color: '#fff', background: 'rgba(255,255,255,.1)', fontSize: 12, fontWeight: 800, cursor: loading ? 'wait' : 'pointer', opacity: loading ? .7 : 1 }}><RefreshCw className={loading ? 'is-spinning' : ''} size={14} /> {loading ? 'Refreshing…' : 'Refresh'}</button>
            {canManage && <button type="button" onClick={openCreate} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 13px', borderRadius: 10, border: 0, color: '#33232b', background: '#f8d7a5', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}><Plus size={14} /> Add stock item</button>}
          </div>
        </div>
        <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 10, marginTop: 22 }}>
          {[
            ['Tracked items', stockCountsReady ? filtered.length : '—', Boxes, outletScoped ? 'Assigned outlet stock' : outletId ? 'Selected outlet stock' : 'All inventory records'],
            ['Need attention', stockCountsReady ? lowStock.length : '—', AlertTriangle, stockCountsReady ? (lowStock.length ? 'Below reorder level' : 'Nothing below reorder level') : 'Server confirmation required'],
            ['Available', stockCountsReady ? healthyStock.length : '—', PackageCheck, stockCountsReady ? 'Not below reorder level' : 'Server confirmation required']
          ].map(([label, value, Icon, description]) => <div key={label} style={{ padding: '13px 14px', borderRadius: 13, border: '1px solid rgba(255,255,255,.13)', background: 'rgba(16,10,16,.22)' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'rgba(255,255,255,.75)', fontSize: 11, fontWeight: 800 }}><span>{label}</span><Icon size={15} /></div><strong style={{ display: 'block', marginTop: 5, fontSize: 24 }}>{value}</strong><small style={{ color: 'rgba(255,255,255,.64)', fontSize: 10 }}>{description}</small></div>)}
        </div>
      </section>

      <section style={{ marginTop: 18, borderRadius: 18, border: '1px solid rgba(72, 45, 56, .13)', background: 'linear-gradient(145deg, #fffdf9, #f8f2ed)', boxShadow: '0 10px 28px rgba(57, 38, 46, .08)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, padding: '18px 18px 14px', borderBottom: '1px solid rgba(72,45,56,.1)' }}>
          <div><h3 style={{ margin: 0, color: '#33232b', fontSize: 16 }}>Service stock list</h3><p style={{ margin: '4px 0 0', color: '#806f76', fontSize: 12 }}>Red rows need a manager decision before they affect service.</p></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', justifyContent: 'flex-end', gap: 8 }}>
            <label style={{ minWidth: 190, color: '#695961', fontSize: 10, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase' }}>
              Stock outlet
              <select aria-label="Stock outlet" value={outletScoped ? outletId : outletId || 'all'} onChange={(event) => { const next = event.target.value === 'all' ? '' : event.target.value; setOutletId(next); loadItems(next) }} disabled={loading || (outletScoped && !outlets.length)} style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '9px 10px', borderRadius: 10, border: '1px solid rgba(72,45,56,.18)', background: '#fff', color: '#33232b', outline: 'none', fontSize: 12 }}>
                {!outletScoped && <option value="all">All outlets</option>}
                {outletScoped && !outlets.length && <option value="">No assigned outlet</option>}
                {outlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}
              </select>
              <small style={{ display: 'block', marginTop: 3, color: '#917f87', fontSize: 10, fontWeight: 500, letterSpacing: 0, textTransform: 'none' }}>{outletScoped ? 'Assigned outlet only' : 'Lodge-wide or selected outlet'}</small>
            </label>
            <label style={{ position: 'relative', minWidth: 240 }}><Search size={15} style={{ position: 'absolute', left: 11, top: 10, color: '#8c7b82' }} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find stock…" style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px 9px 34px', borderRadius: 10, border: '1px solid rgba(72,45,56,.18)', background: '#fff', color: '#33232b', outline: 'none', fontSize: 12 }} /></label>
          </div>
        </div>
        {error && <div role="alert" style={{ margin: 16, padding: '10px 12px', borderRadius: 10, color: '#9a3027', background: '#fff1ef', fontSize: 12 }}>{error}</div>}
        {notice && <div role="status" style={{ margin: 16, padding: '10px 12px', borderRadius: 10, color: '#215e47', background: '#e9f6ef', fontSize: 12 }}>{notice}</div>}
        {(!stockCountsReady || agingError) && <div role="status" style={{ margin: 16, padding: '10px 12px', borderRadius: 10, color: '#79551e', background: '#fff6df', fontSize: 12 }}>Server stock confirmation is unavailable ({itemsRead.source || 'unknown'}). Current on-hand quantities remain visible as last-known only; refresh online before making count decisions.{agingError ? ` ${agingError}` : ''}</div>}
        {loading ? <div aria-live="polite" style={{ padding: 52, textAlign: 'center', color: '#806f76', fontSize: 13 }}>Loading stock…</div> : <div style={{ overflowX: 'auto' }}><table aria-label="Service stock list" style={{ width: '100%', minWidth: 980, borderCollapse: 'collapse', fontSize: 13 }}><thead><tr style={{ background: 'rgba(74,44,56,.045)' }}>{['Item', 'Barcode', 'Status', 'On hand', 'Reorder point', 'Unit cost', 'Stock age', 'Actions'].map((heading) => <th key={heading} style={{ padding: '11px 18px', textAlign: 'left', color: '#806f76', fontSize: 10, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' }}>{heading}</th>)}</tr></thead><tbody>{filtered.map((item) => {
          const attention = isLow(item)
          const age = agingByItem.get(item.id)
          const receiptDate = formatAgeDate(age?.last_received_at)
          const soldDate = formatAgeDate(age?.last_sold_at)
              return <tr key={item.id} style={{ background: attention ? 'rgba(194, 70, 55, .055)' : 'transparent', borderTop: '1px solid rgba(72,45,56,.08)' }}><td style={{ padding: '13px 18px', color: '#33232b', fontWeight: 800 }}>{item.name}<small style={{ display: 'block', marginTop: 2, color: '#917f87', fontWeight: 500 }}>{item.category || 'Uncategorised'}</small></td><td style={{ padding: '13px 18px', color: '#695961', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 11 }}>{item.barcode || '—'}</td><td style={{ padding: '13px 18px' }}><span style={{ display: 'inline-block', padding: '4px 8px', borderRadius: 999, fontSize: 10, fontWeight: 800, color: attention ? '#a53a30' : '#28624d', background: attention ? '#fde5e1' : '#e4f4ea' }}>{attention ? 'Needs attention' : 'Available'}</span></td><td style={{ padding: '13px 18px', color: attention ? '#a53a30' : '#2e6450', fontWeight: 800 }}>{stockNumber(item)} {item.unit || 'each'}</td><td style={{ padding: '13px 18px', color: '#695961' }}>{reorderNumber(item) || '—'}</td><td style={{ padding: '13px 18px', color: '#695961' }}>{item.latest_unit_cost != null ? `${currency}${Number(item.latest_unit_cost).toFixed(2)}` : '—'}</td><td style={{ padding: '13px 18px', color: '#695961' }}><strong style={{ display: 'block', color: age?.age_bucket?.startsWith('Critical') ? '#a53a30' : '#5b4851', fontSize: 11 }}>{age?.age_bucket || 'Unavailable'}</strong><small style={{ display: 'block', marginTop: 2 }}>{ageDescription(age)}{receiptDate ? ` · ${receiptDate}` : ''}</small><small style={{ display: 'block', marginTop: 2, color: '#917f87' }}>{soldDate ? `Last sold ${soldDate}` : 'No recorded sale'}</small></td><td style={{ padding: '13px 18px' }}>{canManage ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}><button type="button" onClick={() => openEdit(item)} style={{ border: '1px solid #d7c4ba', background: '#fff', borderRadius: 8, padding: '6px 8px', fontWeight: 800, fontSize: 11 }}>Edit</button><button type="button" onClick={() => { setActionForm({ quantity: '', reasonCode: 'delivery_received', reasonDetail: '', reason: '' }); setStockAction({ mode: 'receive', item, operationId: crypto.randomUUID() }) }} style={{ border: '1px solid #d7c4ba', background: '#fff', borderRadius: 8, padding: '6px 8px', fontWeight: 800, fontSize: 11 }}>Receive</button><button type="button" onClick={() => { setActionForm({ quantity: String(stockNumber(item)), reasonCode: 'routine_count', reasonDetail: '', reason: '' }); setStockAction({ mode: 'count', item, operationId: crypto.randomUUID() }) }} style={{ border: 0, background: '#3d2b34', color: '#fff', borderRadius: 8, padding: '6px 8px', fontWeight: 800, fontSize: 11 }}><ClipboardCheck size={12} style={{ display: 'inline', marginRight: 4 }}/>Count</button><button type="button" onClick={() => printBarcodeLabel(item)} disabled={!item.barcode} style={{ border: '1px solid #d7c4ba', background: '#fff', borderRadius: 8, padding: '6px 8px', fontWeight: 800, fontSize: 11, opacity: item.barcode ? 1 : .55 }}>Print label</button></div> : '—'}</td></tr>
        })}{!filtered.length && <tr><td colSpan="8" style={{ padding: 44, textAlign: 'center', color: '#806f76' }}>{items.length ? (outletScoped && !outletId ? 'No assigned outlet is available for this operator.' : 'No stock items match this outlet or search.') : 'No stock items yet. Add the first bottle, keg, snack or prepared portion.'}</td></tr>}</tbody></table></div>}
      </section>

      {showCreate && <div className="hpos-modal-backdrop" role="presentation"><section className="hpos-service-dialog" role="dialog" aria-modal="true" aria-labelledby="bar-stock-create-title"><button className="hpos-service-dialog__close" type="button" onClick={() => { setShowCreate(false); setEditingItem(null) }} disabled={saving} aria-label="Close"><X size={18}/></button><p className="hpos-eyebrow">Base bar stock</p><h2 id="bar-stock-create-title">{editingItem ? 'Edit stock item' : 'Add a counted stock item'}</h2><p>{editingItem ? 'Update the name, category, counted unit, reorder point or cost basis. Use Receive or Count to change on-hand stock.' : 'Use one record for the exact unit you count, such as a 330ml bottle, one keg, one snack packet, or one prepared food portion.'}</p><div className="hpos-service-form hpos-service-form--two"><label className="is-wide">Item name<input autoFocus value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} placeholder="Heineken 330ml"/></label><label>Category<input value={newItem.category} onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}/></label><label>Counted unit<select value={newItem.unit} onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}><option value="bottle">Bottle</option><option value="can">Can</option><option value="keg">Keg</option><option value="packet">Packet</option><option value="portion">Prepared portion</option><option value="each">Each</option></select></label><label>Stock location<select value={newItem.outlet_id || ''} onChange={(e) => setNewItem({ ...newItem, outlet_id: e.target.value })}><option value="">Unassigned</option>{outlets.filter((outlet) => outlet?.is_active !== false).map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}{outlet.type === 'beverage' ? ' (Bar)' : ''}</option>)}</select>{barOnly && <small>Use a Bar location when this item may be sold as a 6-pack, 12-pack or case.</small>}</label>{!editingItem && <label>Opening quantity<input type="number" min="0" step="0.01" value={newItem.opening_stock} onChange={(e) => setNewItem({ ...newItem, opening_stock: e.target.value })}/></label>}<label>Low-stock level<input type="number" min="0" step="0.01" value={newItem.reorder_level} onChange={(e) => setNewItem({ ...newItem, reorder_level: e.target.value })}/></label><label className="is-wide">Barcode<div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input ref={barcodeInputRef} value={newItem.barcode} onChange={(e) => { setBarcodeTouched(true); setBarcodeScanStatus(''); setNewItem({ ...newItem, barcode: e.target.value }) }} placeholder="Scan or enter barcode" inputMode="text" autoComplete="off" style={{ flex: 1 }} /><button type="button" onClick={() => { setBarcodeCaptureActive(true); setBarcodeScanStatus('Waiting for scanner…'); requestAnimationFrame(() => barcodeInputRef.current?.focus()) }} disabled={saving} aria-label="Scan barcode"><ScanLine size={14} /> {barcodeCaptureActive ? 'Scanning…' : 'Scan'}</button>{newItem.barcode && <button type="button" onClick={() => { setNewItem({ ...newItem, barcode: '' }); setBarcodeTouched(true); setBarcodeScanStatus('Barcode cleared') }} disabled={saving} aria-label="Clear barcode"><X size={14} /></button>}</div><small>Leading zeroes are preserved. Scan the product label or enter the code manually.</small>{barcodeScanStatus && <span role="status" style={{ display: 'block', marginTop: 4, color: barcodeCaptureActive ? '#79551e' : '#28624d', fontSize: 11 }}>{barcodeScanStatus}</span>}</label><label>Unit cost ({currency})<input type="number" min="0" step="0.01" value={newItem.unit_cost} onChange={(e) => setNewItem({ ...newItem, unit_cost: e.target.value })}/></label></div><footer><button type="button" onClick={() => { setShowCreate(false); setEditingItem(null) }} disabled={saving}>Cancel</button><button type="button" className="hpos-primary-action" onClick={saveItem} disabled={saving}>{saving ? 'Saving…' : editingItem ? 'Save changes' : 'Add stock item'}</button></footer></section></div>}

      {countAllOpen && (
        <div className="hpos-modal-backdrop" role="presentation">
          <section className="hpos-service-dialog" role="dialog" aria-modal="true" aria-labelledby="bar-stock-count-all-title" style={{ maxWidth: 900 }}>
            <button className="hpos-service-dialog__close" type="button" onClick={() => { setCountAllOpen(false); setCountOperationId(null) }} disabled={saving} aria-label="Close"><X size={18}/></button>
            <p className="hpos-eyebrow">One atomic stock operation</p>
            <h2 id="bar-stock-count-all-title">Review Count All</h2>
            <p>Scope: {countLines.length} item{countLines.length === 1 ? '' : 's'} in the selected outlet. These expected quantities came from the certified server read. If stock changes before posting, the server rejects the whole operation and no line is partially applied.</p>
            <div style={{ maxHeight: 430, overflowY: 'auto', border: '1px solid #eadfe0', borderRadius: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr><th style={{ textAlign: 'left', padding: 8 }}>Item</th><th style={{ textAlign: 'right', padding: 8 }}>Expected</th><th style={{ textAlign: 'right', padding: 8 }}>Physical</th><th style={{ textAlign: 'left', padding: 8 }}>Reason</th></tr></thead>
                <tbody>{countLines.map((line, index) => <tr key={line.item_id} style={{ borderTop: '1px solid #eee5e9' }}><td style={{ padding: 8 }}><strong>{line.item_name}</strong><small style={{ display: 'block', color: '#917f87' }}>{line.unit}</small></td><td style={{ padding: 8, textAlign: 'right' }}>{line.expected_qty}</td><td style={{ padding: 8, textAlign: 'right' }}><input aria-label={`${line.item_name} physical quantity`} type="number" min="0" step="0.01" value={line.actual_qty} onChange={(event) => setCountLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, actual_qty: event.target.value } : row))} style={{ width: 88, padding: 6 }} /></td><td style={{ padding: 8 }}><input aria-label={`${line.item_name} count reason`} value={line.reason} onChange={(event) => setCountLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, reason: event.target.value } : row))} placeholder="Routine count" style={{ width: '100%', padding: 6 }} /></td></tr>)}</tbody>
              </table>
            </div>
            <label style={{ display: 'block', marginTop: 10 }}>Batch note (optional)<input value={countNotes} onChange={(event) => setCountNotes(event.target.value)} maxLength={300} placeholder="Weekly bar count" /></label>
            <footer><button type="button" onClick={() => { setCountAllOpen(false); setCountOperationId(null) }} disabled={saving}>Cancel</button><button type="button" className="hpos-primary-action" onClick={postCountAll} disabled={saving || !stockCountsReady}>{saving ? 'Posting…' : 'Post Count All'}</button></footer>
          </section>
        </div>
      )}

      {deliveryOpen && (
        <div className="hpos-modal-backdrop" role="presentation">
          <section className="hpos-service-dialog" role="dialog" aria-modal="true" aria-labelledby="bar-stock-delivery-title" style={{ maxWidth: 820 }}>
            <button className="hpos-service-dialog__close" type="button" onClick={() => { setDeliveryOpen(false); setDeliveryOperationId(null) }} disabled={saving} aria-label="Close"><X size={18}/></button>
            <p className="hpos-eyebrow">Simple delivery · Base stock</p><h2 id="bar-stock-delivery-title">Receive a multi-line delivery</h2>
            <p>Scan or look up each existing stock item, enter quantities and a reason, then post all lines in one atomic operation. Supplier, PO, lot, expiry and valuation fields are intentionally outside Base.</p>
            <div style={{ display: 'flex', gap: 7, alignItems: 'end', marginBottom: 10 }}><label style={{ flex: 1 }}>Barcode lookup<input autoFocus value={deliveryBarcode} onChange={(event) => setDeliveryBarcode(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); lookupDeliveryBarcode() } }} placeholder="Scan barcode and press Enter" /></label><button type="button" onClick={lookupDeliveryBarcode} disabled={saving}><ScanLine size={14} /> Look up</button></div>
            {deliveryLookup && <p role="status" style={{ margin: '0 0 10px', color: '#806f76', fontSize: 11 }}>{deliveryLookup}</p>}
            <label style={{ display: 'block', marginBottom: 10 }}>Select item from current stock list<select value="" onChange={(event) => addDeliveryItem(filtered.find((item) => item.id === event.target.value))}><option value="">Choose an item…</option>{filtered.filter((item) => !deliveryLines.some((line) => line.item_id === item.id)).map((item) => <option key={item.id} value={item.id}>{item.name}{item.barcode ? ` · ${item.barcode}` : ''}</option>)}</select></label>
            <div style={{ maxHeight: 290, overflowY: 'auto', border: '1px solid #eadfe0', borderRadius: 10 }}>{deliveryLines.length ? deliveryLines.map((line, index) => <div key={line.item_id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 90px minmax(150px, 1fr) 30px', gap: 7, alignItems: 'end', padding: 9, borderBottom: '1px solid #eee5e9' }}><strong style={{ fontSize: 12 }}>{line.item_name}<small style={{ display: 'block', color: '#917f87', fontWeight: 500 }}>{line.unit}</small></strong><label>Qty<input type="number" min="0.01" step="0.01" value={line.quantity} onChange={(event) => setDeliveryLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: event.target.value } : row))} /></label><label>Reason<input value={line.reason} onChange={(event) => setDeliveryLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, reason: event.target.value } : row))} placeholder="Delivery received" /></label><button type="button" onClick={() => setDeliveryLines((current) => current.filter((_, rowIndex) => rowIndex !== index))} aria-label={`Remove ${line.item_name}`}><X size={14} /></button></div>) : <p style={{ padding: 18, color: '#806f76', fontSize: 12 }}>No lines selected yet.</p>}</div>
            <label style={{ display: 'block', marginTop: 10 }}>Batch note (optional)<input value={deliveryNotes} onChange={(event) => setDeliveryNotes(event.target.value)} maxLength={300} placeholder="Morning delivery" /></label>
            <footer><button type="button" onClick={() => { setDeliveryOpen(false); setDeliveryOperationId(null) }} disabled={saving}>Cancel</button><button type="button" className="hpos-primary-action" onClick={postDelivery} disabled={saving || !deliveryLines.length}>{saving ? 'Posting…' : 'Receive delivery'}</button></footer>
          </section>
        </div>
      )}

      {stockAction && <div className="hpos-modal-backdrop" role="presentation"><section className="hpos-service-dialog" role="dialog" aria-modal="true" aria-labelledby="bar-stock-action-title"><button className="hpos-service-dialog__close" type="button" onClick={() => setStockAction(null)} disabled={saving} aria-label="Close"><X size={18}/></button><p className="hpos-eyebrow">Audited stock movement</p><h2 id="bar-stock-action-title">{stockAction.mode === 'count' ? `Count ${stockAction.item.name}` : `Receive ${stockAction.item.name}`}</h2><p>{stockAction.mode === 'count' ? `Enter the physical quantity on hand. The system currently records ${stockNumber(stockAction.item)} ${stockAction.item.unit || 'each'}.` : 'Enter only the quantity physically received in this delivery.'}</p><div className="hpos-service-form"><label>{stockAction.mode === 'count' ? 'Physical quantity on hand' : 'Quantity received'}<input autoFocus type="number" min="0" step="0.01" value={actionForm.quantity} onChange={(e) => setActionForm({ ...actionForm, quantity: e.target.value })}/></label><label>Reason category<select value={actionForm.reasonCode} onChange={(e) => setActionForm({ ...actionForm, reasonCode: e.target.value })}>{(STOCK_ACTION_REASONS[stockAction.mode] || []).map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}</select></label><label>{stockAction.mode === 'count' ? 'Count note / reference' : 'Delivery note / reference'}<input value={actionForm.reasonDetail || actionForm.reason || ''} onChange={(e) => setActionForm({ ...actionForm, reasonDetail: e.target.value, reason: e.target.value })} placeholder={stockAction.mode === 'count' ? 'Weekly bottle count' : 'Delivery note or reference'}/></label></div><p style={{ fontSize: 12, color: '#806f76' }}>Reason code and custom detail are stored with one idempotent, auditable stock movement. It never edits the displayed balance directly.</p><footer><button type="button" onClick={() => setStockAction(null)} disabled={saving}>Cancel</button><button type="button" className="hpos-primary-action" onClick={recordStockAction} disabled={saving}>{saving ? 'Recording…' : stockAction.mode === 'count' ? 'Post count' : 'Receive stock'}</button></footer></section></div>}
      {allHistoryOpen && <div className="hpos-modal-backdrop no-print" role="presentation"><section className="hpos-service-dialog" role="dialog" aria-modal="true" aria-labelledby="bar-stock-all-history-title" style={{ maxWidth: 980 }}><button className="hpos-service-dialog__close" type="button" onClick={() => setAllHistoryOpen(false)} aria-label="Close"><X size={18} /></button><p className="hpos-eyebrow">Immutable stock evidence</p><h2 id="bar-stock-all-history-title">Count and delivery history</h2><p>Read-only history includes the server-recorded actor, expected quantity, physical quantity, delta and reason. It never substitutes a cache for a certified ledger.</p>{allHistory.loading && <p role="status">Loading stock operation history…</p>}{allHistory.error && <p role="alert" style={{ color: '#a53a30' }}>{allHistory.error}</p>}{!allHistory.loading && !allHistory.error && <><p style={{ fontSize: 11, color: allHistory.complete ? '#28624d' : '#9a621e' }}>{allHistory.complete ? 'Server-confirmed history.' : `Not certified (${allHistory.source || 'unknown'}). Reconnect before relying on this history.`}</p><div style={{ maxHeight: 420, overflowY: 'auto' }}>{allHistory.rows.length ? <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}><thead><tr><th style={{ textAlign: 'left', padding: 7 }}>Date</th><th style={{ textAlign: 'left', padding: 7 }}>Item</th><th style={{ textAlign: 'left', padding: 7 }}>Operation</th><th style={{ textAlign: 'right', padding: 7 }}>Expected</th><th style={{ textAlign: 'right', padding: 7 }}>Actual</th><th style={{ textAlign: 'right', padding: 7 }}>Delta</th><th style={{ textAlign: 'left', padding: 7 }}>Reason / actor</th></tr></thead><tbody>{allHistory.rows.map((row) => <tr key={row.id || `${row.operation_id}-${row.item_id}`} style={{ borderTop: '1px solid #eee5e9' }}><td style={{ padding: 7 }}>{formatAgeDate(row.created_at) || '—'}</td><td style={{ padding: 7 }}>{row.item_name || 'Item'}<small style={{ display: 'block', color: '#917f87' }}>{row.item_unit || 'each'}</small></td><td style={{ padding: 7 }}>{row.reference_type === 'bar_physical_count' ? 'Physical count' : 'Simple delivery'}</td><td style={{ padding: 7, textAlign: 'right' }}>{row.expected_qty == null ? '—' : Number(row.expected_qty)}</td><td style={{ padding: 7, textAlign: 'right' }}>{row.actual_qty == null ? '—' : Number(row.actual_qty)}</td><td style={{ padding: 7, textAlign: 'right' }}>{Number(row.delta || 0)}</td><td style={{ padding: 7 }}>{row.reason_code || '—'}{row.notes ? ` · ${row.notes}` : ''}<small style={{ display: 'block', color: '#917f87' }}>{row.actor_name || row.actor_id || 'Unknown actor'}</small></td></tr>)}</tbody></table> : <p>No Bar Base count or delivery operations recorded.</p>}</div></>}</section></div>}
      {historyItemId && <div className="hpos-modal-backdrop no-print" role="presentation"><section className="hpos-service-dialog" role="dialog" aria-modal="true" aria-labelledby="bar-stock-history-title"><button className="hpos-service-dialog__close" type="button" onClick={() => setHistoryItemId(null)} aria-label="Close"><X size={18} /></button><p className="hpos-eyebrow">Read-only ledger</p><h2 id="bar-stock-history-title">Movement history</h2><p>Server-scoped history for {filtered.find((item) => item.id === historyItemId)?.name || 'this item'}. It cannot change stock.</p>{movementHistory[historyItemId]?.loading && <p role="status">Loading movement history…</p>}{movementHistory[historyItemId]?.error && <p role="alert" style={{ color: '#a53a30' }}>{movementHistory[historyItemId].error}</p>}{movementHistory[historyItemId] && !movementHistory[historyItemId].loading && !movementHistory[historyItemId].error && <><p style={{ fontSize: 11, color: movementHistory[historyItemId].complete ? '#28624d' : '#9a621e' }}>{movementHistory[historyItemId].complete ? 'Server-confirmed ledger read.' : `Not certified (${movementHistory[historyItemId].source || 'unknown'}). Reconnect before relying on this history.`}</p><div style={{ maxHeight: 360, overflowY: 'auto' }}>{movementHistory[historyItemId].rows?.length ? <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}><thead><tr><th style={{ textAlign: 'left', padding: 7 }}>Date</th><th style={{ textAlign: 'left', padding: 7 }}>Movement</th><th style={{ textAlign: 'right', padding: 7 }}>Quantity</th><th style={{ textAlign: 'left', padding: 7 }}>Reason / reference</th></tr></thead><tbody>{movementHistory[historyItemId].rows.map((row) => <tr key={row.id || `${row.created_at}-${row.quantity}`} style={{ borderTop: '1px solid #eee5e9' }}><td style={{ padding: 7 }}>{formatAgeDate(row.created_at) || '—'}</td><td style={{ padding: 7 }}>{row.movement_type || 'Movement'}</td><td style={{ padding: 7, textAlign: 'right' }}>{Number(row.quantity || 0)}</td><td style={{ padding: 7 }}>{row.notes || row.reference_type || '—'}</td></tr>)}</tbody></table> : <p>No movements recorded for this item.</p>}</div></>}</section></div>}
      {printSheet && <section className="hpos-stock-print-sheet" aria-label="Printable blank stock count sheet"><h1>Blank physical stock count sheet</h1><p>{settings?.business_name || settings?.company_name || 'Bar'} · {outletId ? (outlets.find((outlet) => String(outlet.id) === String(outletId))?.name || 'Selected outlet') : 'All outlets'} · Printed {new Date().toLocaleString()}</p><p className={stockCountsReady ? 'is-certified' : 'is-provisional'}>{stockCountsReady ? 'Prepared from a server-confirmed item list. Quantity fields are intentionally blank for a physical count.' : 'PROVISIONAL ITEM LIST — server confirmation is unavailable. Do not use this sheet as certified stock-on-hand evidence; reconnect and refresh first.'}</p><table><thead><tr><th>Item</th><th>Category</th><th>Unit</th><th>Physical quantity</th><th>Notes / reason</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.category || 'Uncategorised'}</td><td>{item.unit || 'each'}</td><td>&nbsp;</td><td>&nbsp;</td></tr>)}</tbody></table><footer>Post completed counts through the audited Count action. This blank sheet does not alter stock and does not include cached on-hand quantities.</footer></section>}
    </div>
  )
}
