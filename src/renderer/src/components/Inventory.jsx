import { useEffect, useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, AlertTriangle, TrendingUp, Package, ClipboardCheck, RefreshCw } from 'lucide-react'
import { Modal } from './shared/Modal'
import HorizontalScrollArea from './shared/HorizontalScrollArea'
import { useSettings } from '../App'

const CATEGORIES = ['Bar', 'Kitchen', 'Other']
const UNITS = ['bottle', 'can', 'piece', 'roll', 'packet', 'pack', 'box', 'crate', 'tray', 'carton', 'case', 'kg', 'g', 'L', 'ml']

const today = () => new Date().toISOString().split('T')[0]

function fmt(v, dp = 2) {
  return Number(v || 0).toFixed(dp)
}

function sortItems(list) {
  return [...list].sort((a, b) => (
    String(a.category || '').localeCompare(String(b.category || '')) ||
    String(a.name || '').localeCompare(String(b.name || ''))
  ))
}

export default function Inventory() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'

  const [tab, setTab] = useState('stock') // stock | purchases | stocktake

  const [items, setItems] = useState([])
  const [outlets, setOutlets] = useState([])
  const [catFilter, setCatFilter] = useState('all')
  const [sortBy, setSortBy] = useState('name_asc')
  const [loading, setLoading] = useState(false)
  const [pageError, setPageError] = useState('')

  // Item form modal
  const [itemModal, setItemModal] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [itemForm, setItemForm] = useState({
    name: '',
    category: 'Bar',
    unit: 'bottle',
    reorder_level: '',
    current_stock: '',
    selling_price: '',
    outlet_id: ''
  })
  const [itemSaving, setItemSaving] = useState(false)
  const [itemError, setItemError] = useState('')

  // Purchase modal
  const [purchaseModal, setPurchaseModal] = useState(false)
  const [purchaseItem, setPurchaseItem] = useState(null)
  const [purchaseForm, setPurchaseForm] = useState({
    date: today(),
    quantity_purchased: '',
    total_cost: '',
    notes: '',
    package_count: '',
    units_per_package: ''
  })
  const [purchaseSaving, setPurchaseSaving] = useState(false)
  const [purchaseError, setPurchaseError] = useState('')
  const [purchaseHistory, setPurchaseHistory] = useState([])
  const [historyItemId, setHistoryItemId] = useState(null)

  // Adjust stock modal
  const [adjustModal, setAdjustModal] = useState(false)
  const [adjustItem, setAdjustItem] = useState(null)
  const [adjustDelta, setAdjustDelta] = useState('')
  const [adjustNotes, setAdjustNotes] = useState('')
  const [adjustSaving, setAdjustSaving] = useState(false)
  const [adjustError, setAdjustError] = useState('')

  const [stocktakes, setStocktakes] = useState([])
  const [activeStocktakeId, setActiveStocktakeId] = useState('')
  const [activeStocktake, setActiveStocktake] = useState(null)
  const [stocktakeLoading, setStocktakeLoading] = useState(false)
  const [stocktakeError, setStocktakeError] = useState('')
  const [stocktakeTitle, setStocktakeTitle] = useState('')
  const [stocktakeNotes, setStocktakeNotes] = useState('')
  const [stocktakeOutletId, setStocktakeOutletId] = useState('')
  const [stocktakeSaving, setStocktakeSaving] = useState(false)
  const [stocktakePosting, setStocktakePosting] = useState(false)

  useEffect(() => { loadItems() }, [])
  useEffect(() => {
    window.api.outlets.getAll().then((data) => setOutlets(data || [])).catch(() => {})
  }, [])

  useEffect(() => {
    if (tab === 'purchases' && historyItemId) loadPurchases(historyItemId)
  }, [tab])
  useEffect(() => {
    if (tab === 'stocktake') loadStocktakes()
  }, [tab])
  useEffect(() => {
    if (tab === 'stocktake' && activeStocktakeId) loadStocktakeSession(activeStocktakeId)
  }, [tab, activeStocktakeId])

  const outletMap = useMemo(
    () => Object.fromEntries(outlets.map((outlet) => [outlet.id, outlet])),
    [outlets]
  )

  const selectedOutlet = itemForm.outlet_id ? outletMap[itemForm.outlet_id] : null
  const posEnabledOutlet = selectedOutlet?.type === 'food' || selectedOutlet?.type === 'beverage'
  const stocktakeProgress = useMemo(() => {
    const lines = activeStocktake?.lines || []
    const counted = lines.filter((line) => line.counted_qty !== null && line.counted_qty !== '' && !Number.isNaN(Number(line.counted_qty))).length
    const variances = lines.filter((line) => Number(line.variance_qty || 0) !== 0).length
    return { total: lines.length, counted, variances }
  }, [activeStocktake])
  const stocktakeMissingCosts = useMemo(
    () => (activeStocktake?.lines || []).filter((line) => Number(line.unit_cost || 0) <= 0).length,
    [activeStocktake]
  )

  const loadItems = async () => {
    setLoading(true)
    setPageError('')
    try {
      const data = await window.api.inventory.getItems()
      setItems(data || [])
    } catch (err) {
      setPageError(err?.message || 'Could not load inventory items right now.')
    } finally {
      setLoading(false)
    }
  }

  const loadPurchases = async (itemId) => {
    setPageError('')
    try {
      const data = await window.api.inventory.getPurchases(itemId)
      setPurchaseHistory(data || [])
    } catch (err) {
      setPurchaseHistory([])
      setPageError(err?.message || 'Could not load purchase history right now.')
    }
  }

  const loadStocktakes = async () => {
    setStocktakeError('')
    try {
      const rows = await window.api.inventory.getStocktakes(16)
      setStocktakes(Array.isArray(rows) ? rows : [])
      if (!activeStocktakeId && rows?.[0]?.id) setActiveStocktakeId(rows[0].id)
    } catch (err) {
      setStocktakeError(err?.message || 'Could not load stock takes right now.')
    }
  }

  const loadStocktakeSession = async (stocktakeId) => {
    if (!stocktakeId) return
    setStocktakeLoading(true)
    setStocktakeError('')
    try {
      const session = await window.api.inventory.getStocktake(stocktakeId)
      setActiveStocktake(session || null)
    } catch (err) {
      setStocktakeError(err?.message || 'Could not load this stock take.')
    } finally {
      setStocktakeLoading(false)
    }
  }

  const startStocktake = async () => {
    setStocktakeSaving(true)
    setStocktakeError('')
    try {
      const result = await window.api.inventory.createStocktake({
        outlet_id: stocktakeOutletId || null,
        title: stocktakeTitle || null,
        notes: stocktakeNotes || null
      })
      if (!result?.success) {
        setStocktakeError(result?.error || 'Could not start stock take.')
        return
      }
      setStocktakeTitle('')
      setStocktakeNotes('')
      setStocktakeOutletId('')
      await loadStocktakes()
      setActiveStocktakeId(result.id)
      await loadStocktakeSession(result.id)
    } catch (err) {
      setStocktakeError(err?.message || 'Could not start stock take.')
    } finally {
      setStocktakeSaving(false)
    }
  }

  const updateStocktakeLine = (itemId, field, value) => {
    setActiveStocktake((current) => {
      if (!current) return current
      const lines = (current.lines || []).map((line) => {
        if (line.item_id !== itemId) return line
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
    })
  }

  const saveStocktakeDraft = async () => {
    if (!activeStocktake?.id) return
    setStocktakeSaving(true)
    setStocktakeError('')
    try {
      const payload = (activeStocktake.lines || []).map((line) => ({
        item_id: line.item_id,
        counted_qty: line.counted_qty === '' ? null : line.counted_qty,
        notes: line.notes || null
      }))
      const result = await window.api.inventory.saveStocktakeCounts(activeStocktake.id, payload)
      if (!result?.success) {
        setStocktakeError(result?.error || 'Could not save stock take.')
        return
      }
      await loadStocktakeSession(activeStocktake.id)
      await loadStocktakes()
    } catch (err) {
      setStocktakeError(err?.message || 'Could not save stock take.')
    } finally {
      setStocktakeSaving(false)
    }
  }

  const postStocktake = async () => {
    if (!activeStocktake?.id) return
    if (!confirm('Post this stock take and update the live stock balances to the counted quantities?')) return
    setStocktakePosting(true)
    setStocktakeError('')
    try {
      const saveResult = await window.api.inventory.saveStocktakeCounts(
        activeStocktake.id,
        (activeStocktake.lines || []).map((line) => ({
          item_id: line.item_id,
          counted_qty: line.counted_qty === '' ? null : line.counted_qty,
          notes: line.notes || null
        }))
      )
      if (!saveResult?.success) throw new Error(saveResult?.error || 'Could not save stock take')
      const result = await window.api.inventory.postStocktake(activeStocktake.id, activeStocktake.notes || null)
      if (!result?.success) throw new Error(result?.error || 'Could not post stock take')
      await loadItems()
      await loadStocktakes()
      await loadStocktakeSession(activeStocktake.id)
    } catch (err) {
      setStocktakeError(err?.message || 'Could not post stock take.')
    } finally {
      setStocktakePosting(false)
    }
  }

  // ── Item CRUD ────────────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditingItem(null)
    setItemForm({
      name: '',
      category: 'Bar',
      unit: 'bottle',
      reorder_level: '',
      current_stock: '',
      selling_price: '',
      outlet_id: ''
    })
    setItemError('')
    setItemModal(true)
  }

  const openEdit = (item) => {
    setEditingItem(item)
    setItemForm({
      name: item.name,
      category: item.category,
      unit: item.unit,
      reorder_level: String(item.reorder_level),
      current_stock: '',
      selling_price: item.selling_price != null ? String(item.selling_price) : '',
      outlet_id: item.outlet_id || ''
    })
    setItemError('')
    setItemModal(true)
  }

  const handleItemSubmit = async (e) => {
    e.preventDefault()
    setItemSaving(true)
    setItemError('')
    try {
      if (posEnabledOutlet && !(parseFloat(itemForm.selling_price) > 0)) {
        setItemError('Set a POS selling price greater than zero for Bar or Kitchen items.')
        return
      }

      const payload = {
        name: itemForm.name,
        category: itemForm.category,
        unit: itemForm.unit,
        reorder_level: parseFloat(itemForm.reorder_level) || 0,
        selling_price: parseFloat(itemForm.selling_price) || 0,
        outlet_id: itemForm.outlet_id,
        ...(editingItem ? {} : { current_stock: parseFloat(itemForm.current_stock) || 0 })
      }
      const result = editingItem
        ? await window.api.inventory.updateItem(editingItem.id, payload)
        : await window.api.inventory.createItem(payload)

      if (!result?.success) {
        setItemError(result?.error || 'Failed to save item. Please try again.')
        return
      }

      const selectedOutletRow = itemForm.outlet_id
        ? outlets.find((outlet) => outlet.id === itemForm.outlet_id)
        : null
      const savedItem = editingItem
        ? {
            ...editingItem,
            ...payload,
            outlet_id: itemForm.outlet_id || null,
            outlets: itemForm.outlet_id
              ? { name: selectedOutletRow?.name || null }
              : null
          }
        : {
            id: result?.id,
            ...payload,
            current_stock: Number(payload.current_stock || 0),
            latest_unit_cost: 0,
            outlet_id: itemForm.outlet_id || null,
            outlets: itemForm.outlet_id
              ? { name: selectedOutletRow?.name || null }
              : null
          }
      setItems((prev) => sortItems([savedItem, ...prev.filter((row) => row.id !== savedItem.id)]))

      setItemModal(false)
    } catch (err) {
      setItemError(err.message || 'Failed to save item. Please try again.')
    } finally {
      setItemSaving(false)
    }
  }

  const deleteItem = async (item) => {
    if (!confirm(`Delete "${item.name}"?\n\nThis will also remove its recorded purchase history. Continue only if this stock item should no longer exist in the system.`)) return
    try {
      const result = await window.api.inventory.deleteItem(item.id)
      if (!result?.success) {
        alert(result?.error || 'Failed to delete item.')
        return
      }
      setItems((prev) => prev.filter((row) => row.id !== item.id))
      setPurchaseHistory((prev) => prev.filter((row) => row.item_id !== item.id))
      if (historyItemId === item.id) setHistoryItemId(null)
    } catch (err) {
      alert(err.message || 'Failed to delete item.')
    }
  }

  // ── Purchase ─────────────────────────────────────────────────────────────────

  const openPurchase = (item) => {
    setPurchaseItem(item)
    setPurchaseForm({
      date: today(),
      quantity_purchased: '',
      total_cost: '',
      notes: '',
      package_count: '',
      units_per_package: ''
    })
    setPurchaseError('')
    setPurchaseModal(true)
  }

  const getEffectivePurchaseQuantity = (form) => {
    const packages = parseFloat(form.package_count)
    const unitsPerPackage = parseFloat(form.units_per_package)
    if (packages > 0 && unitsPerPackage > 0) return packages * unitsPerPackage
    return parseFloat(form.quantity_purchased)
  }

  const buildPurchaseNotes = (form, unit) => {
    const baseNotes = String(form.notes || '').trim()
    const packages = parseFloat(form.package_count)
    const unitsPerPackage = parseFloat(form.units_per_package)
    if (!(packages > 0 && unitsPerPackage > 0)) return baseNotes
    const packageNote = `Pack detail: ${packages} pack(s) × ${unitsPerPackage} ${unit} = ${packages * unitsPerPackage} ${unit}`
    return baseNotes ? `${baseNotes} | ${packageNote}` : packageNote
  }

  const handlePurchaseSubmit = async (e) => {
    e.preventDefault()
    setPurchaseSaving(true)
    setPurchaseError('')
    try {
      const quantityPurchased = getEffectivePurchaseQuantity(purchaseForm)
      const totalCost = parseFloat(purchaseForm.total_cost)
      if (!(quantityPurchased > 0)) {
        setPurchaseError(`Enter the quantity received in ${purchaseItem.unit}s, or fill in packs × units per pack.`)
        return
      }
      if (!(totalCost > 0)) {
        setPurchaseError('Enter the full supplier cost for this purchase.')
        return
      }
      const result = await window.api.inventory.addPurchase({
        item_id: purchaseItem.id,
        ...purchaseForm,
        quantity_purchased: quantityPurchased,
        total_cost: totalCost,
        notes: buildPurchaseNotes(purchaseForm, purchaseItem.unit)
      })

      if (!result?.success) {
        setPurchaseError(result?.error || 'Failed to record purchase. Please try again.')
        return
      }

      const unitCost = quantityPurchased > 0 ? totalCost / quantityPurchased : 0
      setItems((prev) => prev.map((row) => row.id === purchaseItem.id
        ? {
            ...row,
            current_stock: Number(row.current_stock || 0) + quantityPurchased,
            latest_unit_cost: unitCost
          }
        : row
      ))
      if (!historyItemId || historyItemId === purchaseItem.id) {
        setPurchaseHistory((prev) => [{
          id: `local-${Date.now()}`,
          item_id: purchaseItem.id,
          item_name: purchaseItem.name,
          item_unit: purchaseItem.unit,
          date: purchaseForm.date,
          quantity_purchased: quantityPurchased,
          total_cost: totalCost,
          unit_cost: unitCost,
          notes: buildPurchaseNotes(purchaseForm, purchaseItem.unit)
        }, ...prev])
      }

      setPurchaseModal(false)
    } catch (err) {
      setPurchaseError(err.message || 'Failed to record purchase. Please try again.')
    } finally {
      setPurchaseSaving(false)
    }
  }

  const unitCostPreview = () => {
    const qty = getEffectivePurchaseQuantity(purchaseForm)
    const cost = parseFloat(purchaseForm.total_cost)
    if (qty > 0 && cost > 0) return (cost / qty).toFixed(4)
    return null
  }

  // ── Adjust stock ─────────────────────────────────────────────────────────────

  const openAdjust = (item) => {
    setAdjustItem(item)
    setAdjustDelta('')
    setAdjustNotes('')
    setAdjustError('')
    setAdjustModal(true)
  }

  const handleAdjustSubmit = async (e) => {
    e.preventDefault()
    setAdjustSaving(true)
    setAdjustError('')
    try {
      const result = await window.api.inventory.adjustStock(adjustItem.id, parseFloat(adjustDelta), adjustNotes)
      if (!result?.success) {
        setAdjustError(result?.error || 'Failed to adjust stock. Please try again.')
        return
      }
      setItems((prev) => prev.map((row) => row.id === adjustItem.id
        ? { ...row, current_stock: result?.new_stock ?? row.current_stock }
        : row
      ))
      setAdjustModal(false)
    } catch (err) {
      setAdjustError(err.message || 'Failed to adjust stock. Please try again.')
    } finally {
      setAdjustSaving(false)
    }
  }

  const filtered = useMemo(() => {
    return [...items.filter((i) => catFilter === 'all' || i.category === catFilter)].sort((a, b) => {
      switch (sortBy) {
        case 'stock_asc':
          return Number(a.current_stock || 0) - Number(b.current_stock || 0)
        case 'stock_desc':
          return Number(b.current_stock || 0) - Number(a.current_stock || 0)
        case 'low_stock_first': {
          const aLow = Number(a.current_stock || 0) <= Number(a.reorder_level || 0)
          const bLow = Number(b.current_stock || 0) <= Number(b.reorder_level || 0)
          if (aLow !== bLow) return aLow ? -1 : 1
          return String(a.name || '').localeCompare(String(b.name || ''))
        }
        case 'outlet_asc':
          return String(outletMap[a.outlet_id]?.name || '').localeCompare(String(outletMap[b.outlet_id]?.name || '')) ||
            String(a.name || '').localeCompare(String(b.name || ''))
        case 'name_asc':
        default:
          return String(a.name || '').localeCompare(String(b.name || ''))
      }
    })
  }, [catFilter, items, outletMap, sortBy])
  const lowStockCount = items.filter((i) => i.current_stock <= i.reorder_level).length

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="bb-page-header">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700/70">Stock Control</p>
          <h1 className="bb-page-header-title mt-2">Inventory</h1>
          <p className="bb-page-header-subtitle">
            {items.length} items
            {lowStockCount > 0 && (
              <span className="ml-2 font-medium text-red-500">· {lowStockCount} low stock</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex overflow-hidden rounded-2xl border border-slate-200 bg-white text-sm shadow-sm">
            {[['stock', 'Stock'], ['purchases', 'Purchases'], ['stocktake', 'Stock Take']].map(([v, l]) => (
              <button
                key={v}
                onClick={() => setTab(v)}
                className={`px-4 py-2 transition-colors ${tab === v ? 'bg-green-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                {l}
              </button>
            ))}
          </div>
          <button onClick={openCreate} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> Add Item
          </button>
        </div>
      </div>

      {pageError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {pageError}
        </div>
      )}

      {tab === 'stocktake' && (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[0.42fr_0.58fr]">
            <div className="bb-card p-5">
              <div className="flex items-center gap-2">
                <ClipboardCheck size={16} className="text-emerald-600" />
                <h2 className="text-base font-semibold text-slate-900">Start Inventory Stock Take</h2>
              </div>
              <p className="mt-2 text-sm text-slate-500">
                Freeze expected quantities, count what is physically on hand, then post the variances into live stock.
              </p>
              <div className="mt-4 space-y-3">
                <input
                  className="input"
                  placeholder="Session title, e.g. Month-End Count"
                  value={stocktakeTitle}
                  onChange={(e) => setStocktakeTitle(e.target.value)}
                />
                <select
                  className="input"
                  value={stocktakeOutletId}
                  onChange={(e) => setStocktakeOutletId(e.target.value)}
                >
                  <option value="">All outlets together</option>
                  {outlets.map((outlet) => (
                    <option key={outlet.id} value={outlet.id}>
                      {outlet.name}
                    </option>
                  ))}
                </select>
                <textarea
                  className="input h-24 resize-none"
                  placeholder="Optional notes for this stock take"
                  value={stocktakeNotes}
                  onChange={(e) => setStocktakeNotes(e.target.value)}
                />
                <button onClick={startStocktake} disabled={stocktakeSaving} className="btn-primary w-full justify-center">
                  {stocktakeSaving ? 'Starting…' : 'Start Stock Take'}
                </button>
              </div>
            </div>

            <div className="bb-card p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Recent Sessions</h2>
                  <p className="mt-1 text-xs text-slate-500">Open and posted inventory counts.</p>
                </div>
                <button onClick={loadStocktakes} className="btn-secondary text-sm"><RefreshCw size={14} /> Refresh</button>
              </div>
              <div className="space-y-3">
                {stocktakes.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => setActiveStocktakeId(session.id)}
                    className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                      activeStocktakeId === session.id ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-800">{session.title || 'Untitled stock take'}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Started {new Date(session.started_at).toLocaleString()}
                        </p>
                        {session.outlet_name && (
                          <p className="mt-1 text-xs font-medium text-emerald-700">{session.outlet_name}</p>
                        )}
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                        session.status === 'posted' ? 'bg-slate-900 text-white' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {session.status}
                      </span>
                    </div>
                  </button>
                ))}
                {stocktakes.length === 0 && (
                  <div className="bb-empty-state min-h-[180px]">
                    <p className="text-base font-semibold text-slate-800">No stock takes yet</p>
                    <p className="text-sm text-slate-500">Start your first inventory count from here.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bb-card p-5">
            {stocktakeError && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {stocktakeError}
              </div>
            )}
            {!activeStocktakeId ? (
              <div className="bb-empty-state min-h-[320px]">
                <p className="text-base font-semibold text-slate-800">Choose a stock take session</p>
                <p className="text-sm text-slate-500">Select a recent session or start a new one.</p>
              </div>
            ) : stocktakeLoading ? (
              <div className="bb-empty-state min-h-[320px]">
                <p className="text-sm font-medium text-slate-500">Loading stock take…</p>
              </div>
            ) : !activeStocktake ? (
              <div className="bb-empty-state min-h-[320px]">
                <p className="text-base font-semibold text-slate-800">This stock take could not be loaded</p>
              </div>
            ) : (
              <>
                <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{activeStocktake.title || 'Untitled stock take'}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Count physical stock against the expected balance captured when this session started.
                    </p>
                    {activeStocktake.outlet_name && (
                      <p className="mt-1 text-xs font-semibold text-emerald-700">Outlet scope: {activeStocktake.outlet_name}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                      {stocktakeProgress.counted}/{stocktakeProgress.total} counted
                    </span>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      stocktakeProgress.variances > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {stocktakeProgress.variances} variances
                    </span>
                  </div>
                </div>
                <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded-xl bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Status</p>
                    <p className="mt-2 text-sm font-semibold text-slate-800 capitalize">{activeStocktake.status}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Started</p>
                    <p className="mt-2 text-sm font-semibold text-slate-800">{new Date(activeStocktake.started_at).toLocaleString()}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Posted</p>
                    <p className="mt-2 text-sm font-semibold text-slate-800">
                      {activeStocktake.posted_at ? new Date(activeStocktake.posted_at).toLocaleString() : 'Not yet'}
                    </p>
                  </div>
                </div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                  <span>Scroll sideways if needed to see every stock-take column and action.</span>
                  {stocktakeMissingCosts > 0 && (
                    <span className="font-semibold text-amber-700">
                      {stocktakeMissingCosts} item{stocktakeMissingCosts === 1 ? '' : 's'} have no unit cost yet, so variance cost cannot be calculated for them.
                    </span>
                  )}
                </div>
                <div className="bb-table-shell">
                  <HorizontalScrollArea>
                    <table className="min-w-[1080px] w-full text-sm">
                      <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                        <tr>
                          <th className="px-4 py-3 text-left">Item</th>
                          <th className="px-4 py-3 text-left">Outlet</th>
                          <th className="px-4 py-3 text-right">Expected</th>
                          <th className="px-4 py-3 text-right">Counted</th>
                          <th className="px-4 py-3 text-right">Variance</th>
                          <th className="px-4 py-3 text-right">Unit Cost</th>
                          <th className="px-4 py-3 text-right">Variance Cost</th>
                          <th className="px-4 py-3 text-left">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(activeStocktake.lines || []).map((line) => (
                          <tr key={line.item_id} className={`${Number(line.variance_qty || 0) !== 0 ? 'bg-amber-50/40' : 'hover:bg-slate-50'}`}>
                            <td className="px-4 py-3">
                              <p className="font-medium text-slate-800">{line.item_name}</p>
                              <p className="text-xs text-slate-400">{line.item_category} · {line.item_unit}</p>
                            </td>
                            <td className="px-4 py-3 text-slate-600">
                              {outletMap[line.outlet_id]?.name || 'Unassigned'}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-700">{fmt(line.expected_qty, 1)} {line.item_unit}</td>
                            <td className="px-4 py-3 text-right">
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                disabled={activeStocktake.status !== 'open'}
                                className="input ml-auto w-28 text-right"
                                value={line.counted_qty ?? ''}
                                onChange={(e) => updateStocktakeLine(line.item_id, 'counted_qty', e.target.value)}
                              />
                            </td>
                            <td className={`px-4 py-3 text-right font-semibold ${Number(line.variance_qty || 0) === 0 ? 'text-slate-500' : Number(line.variance_qty || 0) > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                              {line.variance_qty === null || line.variance_qty === '' ? '—' : fmt(line.variance_qty, 1)}
                            </td>
                            <td className="px-4 py-3 text-right font-medium text-slate-700">
                              {Number(line.unit_cost || 0) > 0 ? `${currency} ${fmt(line.unit_cost)}` : '—'}
                            </td>
                            <td className="px-4 py-3 text-right font-medium text-slate-700">
                              {Number(line.unit_cost || 0) <= 0
                                ? '—'
                                : line.variance_cost === null || line.variance_cost === ''
                                  ? '—'
                                  : `${currency} ${fmt(line.variance_cost)}`}
                            </td>
                            <td className="px-4 py-3">
                              <input
                                type="text"
                                disabled={activeStocktake.status !== 'open'}
                                className="input"
                                value={line.notes || ''}
                                onChange={(e) => updateStocktakeLine(line.item_id, 'notes', e.target.value)}
                                placeholder="Optional note"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </HorizontalScrollArea>
                </div>
                {activeStocktake.status === 'open' && (
                  <div className="sticky bottom-0 mt-4 flex flex-wrap justify-end gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
                    <button onClick={saveStocktakeDraft} disabled={stocktakeSaving || stocktakePosting} className="btn-secondary">
                      {stocktakeSaving ? 'Saving…' : 'Save Draft'}
                    </button>
                    <button onClick={postStocktake} disabled={stocktakeSaving || stocktakePosting} className="btn-primary">
                      {stocktakePosting ? 'Posting…' : 'Post Stock Take'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Stock Tab ── */}
      {tab === 'stock' && (
        <>
          {/* Category filter */}
          <div className="bb-filter-bar w-fit">
            <button
              onClick={() => setCatFilter('all')}
              className={`rounded-xl px-3 py-2 transition-colors ${catFilter === 'all' ? 'bg-green-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              All
            </button>
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCatFilter(c)}
                className={`rounded-xl px-3 py-2 transition-colors ${catFilter === c ? 'bg-green-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                {c}
              </button>
            ))}
            <select
              className="input ml-3 w-auto min-w-[180px]"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
            >
              <option value="name_asc">Name A-Z</option>
              <option value="stock_asc">Lowest stock first</option>
              <option value="stock_desc">Highest stock first</option>
              <option value="low_stock_first">Low stock first</option>
              <option value="outlet_asc">Outlet</option>
            </select>
            <span className="ml-2 self-center text-xs text-slate-500">Category filters help isolate low-stock items faster during stock checks.</span>
          </div>

          <div className="bb-table-shell">
            {loading ? (
              <div className="bb-empty-state min-h-[220px]">
                <p className="text-sm font-medium text-slate-500">Loading inventory levels and latest purchase costs…</p>
              </div>
            ) : (
              <HorizontalScrollArea>
                <table className="min-w-[1120px] w-full text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                  <tr>
                    <th className="px-5 py-3 text-left">Item</th>
                    <th className="px-5 py-3 text-left">Outlet</th>
                    <th className="px-5 py-3 text-left">Category</th>
                    <th className="px-5 py-3 text-left">Unit</th>
                    <th className="px-5 py-3 text-right">In Stock</th>
                    <th className="px-5 py-3 text-right">Reorder At</th>
                    <th className="px-5 py-3 text-right">Unit Cost</th>
                    <th className="px-5 py-3 text-right">POS Price</th>
                    <th className="px-5 py-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((item) => {
                    const isLow = item.current_stock <= item.reorder_level
                    return (
                      <tr key={item.id} className={`hover:bg-slate-50 ${isLow ? 'bg-red-50/40' : ''}`}>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            {isLow && <AlertTriangle size={14} className="text-red-500 shrink-0" />}
                            <p className="font-medium text-slate-800">{item.name}</p>
                          </div>
                          {isLow && (
                            <p className="text-xs text-red-500 mt-0.5 ml-5">Low stock — reorder needed</p>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                            {outletMap[item.outlet_id]?.name || 'Unassigned'}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                            {item.category}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-600">{item.unit}</td>
                        <td className={`px-5 py-3 text-right font-semibold ${isLow ? 'text-red-600' : 'text-slate-800'}`}>
                          {fmt(item.current_stock, 1)} {item.unit}
                        </td>
                        <td className="px-5 py-3 text-right text-slate-500">
                          {fmt(item.reorder_level, 1)} {item.unit}
                        </td>
                        <td className="px-5 py-3 text-right text-slate-600">
                          {item.latest_unit_cost > 0
                            ? `${currency} ${fmt(item.latest_unit_cost, 4)}`
                            : '—'}
                        </td>
                        <td className="px-5 py-3 text-right text-slate-600">
                          {Number(item.selling_price || 0) > 0
                            ? `${currency} ${fmt(item.selling_price)}`
                            : '—'}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => openPurchase(item)}
                            className="rounded-lg px-2 py-1 text-xs text-green-600 transition-colors hover:bg-green-50"
                              title="Record Purchase"
                            >
                              + Stock
                            </button>
                            <button
                              onClick={() => openAdjust(item)}
                            className="rounded-lg px-2 py-1 text-xs text-blue-600 transition-colors hover:bg-blue-50"
                              title="Adjust Stock"
                            >
                              Adjust
                            </button>
                            <button
                              onClick={() => openEdit(item)}
                              className="rounded transition-colors p-1.5 text-slate-400 hover:bg-slate-100"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => deleteItem(item)}
                            className="rounded-lg p-1.5 text-red-400 transition-colors hover:bg-red-50"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-5 py-12">
                        <div className="bb-empty-state py-10">
                          <Package size={32} className="mx-auto mb-2 opacity-30" />
                          <p className="text-base font-semibold text-slate-800">No inventory items yet</p>
                          <p className="text-sm text-slate-500">Add stock items to begin tracking quantities, costs, and reorder points.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
                </table>
              </HorizontalScrollArea>
            )}
          </div>
        </>
      )}

      {/* ── Purchases Tab ── */}
      {tab === 'purchases' && (
        <div>
          <div className="bb-filter-bar mb-5">
            <select
              className="input w-auto"
              value={historyItemId || ''}
              onChange={async (e) => {
                setHistoryItemId(e.target.value)
                if (e.target.value) await loadPurchases(e.target.value)
                else setPurchaseHistory([])
              }}
            >
              <option value="">All items</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
            {!historyItemId && (
              <button
                onClick={async () => {
                  // Load all purchases by loading each item's purchases
                  const all = []
                  for (const item of items) {
                    const p = await window.api.inventory.getPurchases(item.id).catch(() => [])
                    all.push(...p.map((x) => ({ ...x, item_name: item.name, item_unit: item.unit })))
                  }
                  all.sort((a, b) => new Date(b.date) - new Date(a.date))
                  setPurchaseHistory(all)
                }}
                className="btn-secondary text-sm"
              >
                Load All
              </button>
            )}
            <span className="self-center text-xs text-slate-500">Purchase history shows how unit cost was derived from each stock purchase.</span>
          </div>

          <div className="bb-table-shell">
            <HorizontalScrollArea>
              <table className="min-w-[880px] w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-5 py-3 text-left">Date</th>
                  {!historyItemId && <th className="px-5 py-3 text-left">Item</th>}
                  <th className="px-5 py-3 text-right">Qty Purchased</th>
                  <th className="px-5 py-3 text-right">Total Cost</th>
                  <th className="px-5 py-3 text-right">Unit Cost (auto)</th>
                  <th className="px-5 py-3 text-left">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {purchaseHistory.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 text-slate-600">{p.date}</td>
                    {!historyItemId && (
                      <td className="px-5 py-3 font-medium text-slate-800">{p.item_name}</td>
                    )}
                    <td className="px-5 py-3 text-right text-slate-800">
                      {fmt(p.quantity_purchased, 1)} {p.item_unit || ''}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-gray-800">
                      {currency} {fmt(p.total_cost)}
                    </td>
                    <td className="px-5 py-3 text-right text-green-700 font-medium">
                      {currency} {fmt(p.unit_cost, 4)}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">{p.notes || '—'}</td>
                  </tr>
                ))}
                {purchaseHistory.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-12">
                      <div className="bb-empty-state py-10">
                        <p className="text-base font-semibold text-slate-800">No purchase history to show</p>
                        <p className="text-sm text-slate-500">{historyItemId ? 'No purchases recorded for this item.' : 'Select an item or click Load All to review purchase history.'}</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
              </table>
            </HorizontalScrollArea>
          </div>
        </div>
      )}

      {/* Item Modal */}
      {itemModal && (
        <Modal
          title={editingItem ? 'Edit Item' : 'Add Inventory Item'}
          onClose={() => setItemModal(false)}
          size="sm"
        >
          <form onSubmit={handleItemSubmit} className="space-y-4">
            {itemError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {itemError}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Item Name *</label>
              <input
                type="text"
                className="input"
                value={itemForm.name}
                onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                required
                placeholder="e.g. Castle Lager, Cooking Oil"
              />
              <p className="mt-1 text-xs text-slate-500">Use the stock item name your team sees during purchasing and stock counts.</p>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-xs text-slate-600">
              Choose the smallest unit you want to track in stock. Example: beer should usually be tracked as <strong>bottle</strong> or <strong>can</strong>, even if you buy it in crates. Toilet paper should usually be tracked as <strong>roll</strong>.
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
                <select
                  className="input"
                  value={itemForm.category}
                  onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })}
                >
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit *</label>
                <select
                  className="input"
                  value={itemForm.unit}
                  onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}
                >
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Outlet</label>
              <select
                className="input"
                value={itemForm.outlet_id}
                onChange={(e) => setItemForm({ ...itemForm, outlet_id: e.target.value })}
              >
                <option value="">— Unassigned —</option>
                {outlets.map((outlet) => (
                  <option key={outlet.id} value={outlet.id}>{outlet.name}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Leave this unassigned if the item is not owned by a specific outlet. Bar and Kitchen items sync into POS automatically. Front Desk items stay inventory-only.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                POS Selling Price ({currency}) {posEnabledOutlet ? '*' : <span className="font-normal text-slate-400">(optional)</span>}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input"
                value={itemForm.selling_price}
                onChange={(e) => setItemForm({ ...itemForm, selling_price: e.target.value })}
                placeholder="0.00"
              />
              <p className="mt-1 text-xs text-slate-500">
                {posEnabledOutlet
                  ? 'Required because Bar and Kitchen products are published to POS automatically.'
                  : 'Front Desk products do not appear in POS.'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reorder Level ({itemForm.unit})
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                className="input"
                value={itemForm.reorder_level}
                onChange={(e) => setItemForm({ ...itemForm, reorder_level: e.target.value })}
                placeholder="Alert when stock falls below this"
              />
              <p className="mt-1 text-xs text-slate-500">Set the point where the system should start treating this item as low stock.</p>
            </div>
            {!editingItem && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Opening Stock ({itemForm.unit})
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  className="input"
                  value={itemForm.current_stock}
                  onChange={(e) => setItemForm({ ...itemForm, current_stock: e.target.value })}
                  placeholder="Optional starting quantity"
                />
                <p className="mt-1 text-xs text-slate-500">Use this if you already have stock on hand when creating the item for the first time.</p>
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setItemModal(false)} className="btn-secondary flex-1">
                Cancel
              </button>
              <button type="submit" disabled={itemSaving} className="btn-primary flex-1">
                {itemSaving ? 'Saving...' : editingItem ? 'Update' : 'Add Item'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Purchase Modal */}
      {purchaseModal && purchaseItem && (
        <Modal
          title={`Record Purchase — ${purchaseItem.name}`}
          onClose={() => setPurchaseModal(false)}
          size="sm"
        >
          <form onSubmit={handlePurchaseSubmit} className="space-y-4">
            {purchaseError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {purchaseError}
              </div>
            )}
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-4 py-3">
              <p className="text-xs text-slate-600">
                The unit cost is calculated automatically from the base units received and the total supplier cost for this delivery.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
              <input
                type="date"
                className="input"
                value={purchaseForm.date}
                onChange={(e) => setPurchaseForm({ ...purchaseForm, date: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Quantity ({purchaseItem.unit}) *
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  className="input"
                  value={purchaseForm.quantity_purchased}
                  onChange={(e) => setPurchaseForm({ ...purchaseForm, quantity_purchased: e.target.value })}
                  required
                placeholder="0"
              />
              <p className="mt-1 text-xs text-slate-500">Enter the base units received, or leave this blank and use the pack fields below.</p>
            </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Total Cost ({currency}) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input"
                  value={purchaseForm.total_cost}
                  onChange={(e) => setPurchaseForm({ ...purchaseForm, total_cost: e.target.value })}
                  required
                placeholder="0.00"
              />
              <p className="mt-1 text-xs text-slate-500">Use the full supplier invoice amount for this purchase.</p>
            </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-sm font-semibold text-slate-800">Bought in packs, cartons, or crates?</p>
              <p className="mt-1 text-xs text-slate-500">
                Enter the pack count and how many {purchaseItem.unit}s are inside each pack. Example: 2 crates × 24 bottles = 48 bottles.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Number of Packs</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    className="input"
                    value={purchaseForm.package_count}
                    onChange={(e) => setPurchaseForm({ ...purchaseForm, package_count: e.target.value })}
                    placeholder="e.g. 2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Units per Pack</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    className="input"
                    value={purchaseForm.units_per_package}
                    onChange={(e) => setPurchaseForm({ ...purchaseForm, units_per_package: e.target.value })}
                    placeholder={`e.g. 24 ${purchaseItem.unit}`}
                  />
                </div>
              </div>
              {getEffectivePurchaseQuantity(purchaseForm) > 0 && (
                <p className="mt-3 text-xs font-medium text-slate-700">
                  Effective received quantity: {fmt(getEffectivePurchaseQuantity(purchaseForm), 1)} {purchaseItem.unit}
                </p>
              )}
            </div>
            {unitCostPreview() && (
              <div className="bg-green-50 rounded-lg p-3 text-sm">
                <p className="text-green-800">
                  Auto unit cost: <strong>{currency} {unitCostPreview()}</strong> per {purchaseItem.unit}
                </p>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <input
                type="text"
                className="input"
                value={purchaseForm.notes}
                onChange={(e) => setPurchaseForm({ ...purchaseForm, notes: e.target.value })}
                placeholder="Supplier, invoice number, pack details, etc."
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setPurchaseModal(false)} className="btn-secondary flex-1">
                Cancel
              </button>
              <button type="submit" disabled={purchaseSaving} className="btn-primary flex-1">
                {purchaseSaving ? 'Saving...' : 'Record Purchase'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Adjust Stock Modal */}
      {adjustModal && adjustItem && (
        <Modal
          title={`Adjust Stock — ${adjustItem.name}`}
          onClose={() => setAdjustModal(false)}
          size="sm"
        >
          <form onSubmit={handleAdjustSubmit} className="space-y-4">
            {adjustError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {adjustError}
              </div>
            )}
            <p className="text-sm text-gray-600">
              Current stock: <strong>{fmt(adjustItem.current_stock, 1)} {adjustItem.unit}</strong>
            </p>
            <div className="rounded-xl border border-amber-100 bg-amber-50/70 px-4 py-3 text-xs text-slate-600">
              Use a negative adjustment to reduce stock and a positive adjustment to add stock after a count correction.
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Adjustment ({adjustItem.unit}) *
              </label>
              <input
                type="number"
                step="0.1"
                className="input"
                value={adjustDelta}
                onChange={(e) => setAdjustDelta(e.target.value)}
                required
                placeholder="Use negative to reduce, e.g. -5"
              />
              {adjustDelta && (
                <p className="text-xs text-gray-500 mt-1">
                  New stock: {fmt(Math.max(0, Number(adjustItem.current_stock) + Number(adjustDelta)), 1)} {adjustItem.unit}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
              <input
                type="text"
                className="input"
                value={adjustNotes}
                onChange={(e) => setAdjustNotes(e.target.value)}
                placeholder="e.g. Waste, spillage, stocktake correction"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setAdjustModal(false)} className="btn-secondary flex-1">
                Cancel
              </button>
              <button type="submit" disabled={adjustSaving} className="btn-primary flex-1">
                {adjustSaving ? 'Saving...' : 'Apply Adjustment'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
