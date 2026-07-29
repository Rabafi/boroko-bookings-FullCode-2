import { useCallback, useEffect, useMemo, useState } from 'react'
import { Store, Plus, Pencil, Trash2, RefreshCw, TrendingUp, ArrowLeftRight, AlertTriangle, Boxes, CalendarDays, CheckCircle2 } from 'lucide-react'
import { Modal } from './shared/Modal'
import { ConfirmDialog } from './shared/ConfirmDialog'
import { useAccess, useSettings } from '../app-context'
import { isBarOnlyMode, isRestaurantOnly } from '../../../shared/propertyTypes'
import { canAccessCapability } from '../../../shared/accessControl'
import { HposButton, HposEmptyState, HposNotice, HposPageHero, HposStatusBadge } from './hospitality-pos/HposUi'

const emptyOutlet = { name: '', code: '', pos_type: 'restaurant', active: true }

const OUTLET_TYPES = [
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'bar', label: 'Bar / Lounge' },
  { value: 'pool', label: 'Pool / Beach' },
  { value: 'spa', label: 'Spa / Wellness' },
  { value: 'mini_mart', label: 'Mini Mart' },
  { value: 'gift_shop', label: 'Gift Shop' },
  { value: 'room_service', label: 'Room Service' },
  { value: 'other', label: 'Other' }
]

export default function MultiOutletPos() {
  const { settings } = useSettings()
  const restaurantMode = isRestaurantOnly(settings?.property_type || settings?.business_type || 'lodge')
  if (restaurantMode) return <RestaurantMultiOutlet barOnly={isBarOnlyMode(settings)} />
  return <LegacyMultiOutletPos />
}

function RestaurantMultiOutlet({ barOnly = false }) {
  const access = useAccess()
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const canTransfer = canAccessCapability(access, 'pos.manage')
  const canReport = canAccessCapability(access, 'reports.view') && canAccessCapability(access, 'pos.combined_reports')
  const canConfigureOutlets = ['manager', 'admin', 'super_admin'].includes(String(access?.role || '').toLowerCase())
  const now = new Date()
  const [activeTab, setActiveTab] = useState('outlets')
  const [outlets, setOutlets] = useState([])
  const [stockLocations, setStockLocations] = useState([])
  const [stockLocationBalances, setStockLocationBalances] = useState([])
  const [items, setItems] = useState([])
  const [profit, setProfit] = useState(null)
  const [start, setStart] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10))
  const [end, setEnd] = useState(now.toISOString().slice(0, 10))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [transfer, setTransfer] = useState({ from_stock_location_id: '', to_stock_location_id: '', inventory_item_id: '', quantity: '1', notes: '' })
  const [newStockLocationName, setNewStockLocationName] = useState('')
  const [editingStockLocation, setEditingStockLocation] = useState(null)
  const [stockLocationName, setStockLocationName] = useState('')
  const [editingOutlet, setEditingOutlet] = useState(null)
  const [outletForm, setOutletForm] = useState({ name: '', type: barOnly ? 'beverage' : 'food', is_active: true, sort_order: '0' })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const [outletResult, itemResult, profitResult, locationResult, balanceResult] = await Promise.allSettled([
      window.api?.pos?.getRestaurantOutletControls?.(),
      window.api?.inventory?.getItems?.(),
      canReport ? window.api?.reports?.outletProfitLoss?.(start, end) : Promise.resolve(null),
      window.api?.pos?.getRestaurantStockLocations?.(),
      window.api?.pos?.getRestaurantStockLocationBalances?.()
    ])
    setOutlets(outletResult.status === 'fulfilled' && Array.isArray(outletResult.value) ? outletResult.value : [])
    setItems(itemResult.status === 'fulfilled' && Array.isArray(itemResult.value) ? itemResult.value : [])
    setProfit(profitResult.status === 'fulfilled' ? profitResult.value : null)
    setStockLocations(locationResult.status === 'fulfilled' && Array.isArray(locationResult.value) ? locationResult.value : [])
    setStockLocationBalances(balanceResult.status === 'fulfilled' && Array.isArray(balanceResult.value) ? balanceResult.value : [])
    if (outletResult.status === 'rejected') setError(outletResult.reason?.message || 'Outlet configuration could not be loaded.')
    else if (canReport && profitResult.status === 'rejected') setError(profitResult.reason?.message || 'Outlet profit report could not be loaded.')
    setLoading(false)
  }, [canReport, end, start])

  useEffect(() => { load() }, [load])

  const availableItems = items
  const pnlRows = useMemo(
    () => (profit?.outlets || []).filter((row) => row.key !== 'front_desk').map((row) => ({ ...row, name: row.key === 'kitchen' ? (barOnly ? 'Bar' : 'Restaurant') : row.name })),
    [barOnly, profit]
  )
  const activeOutlets = useMemo(() => outlets.filter((outlet) => outlet?.active !== false), [outlets])
  const activeStockLocations = useMemo(() => stockLocations.filter((location) => location?.is_active !== false), [stockLocations])
  const stockBalanceItems = useMemo(() => {
    const rows = new Map()
    for (const balance of stockLocationBalances) {
      const item = rows.get(balance.inventory_item_id) || { id: balance.inventory_item_id, name: balance.item_name || 'Inventory item', unit: balance.unit || 'each', businessStock: Number(balance.business_stock || 0), allocatedStock: Number(balance.allocated_stock || 0), unallocatedStock: Number(balance.unallocated_stock || 0), byLocation: {} }
      item.byLocation[balance.stock_location_id] = Number(balance.quantity || 0)
      rows.set(balance.inventory_item_id, item)
    }
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [stockLocationBalances])
  const stockLocationForOutlet = useCallback((outletId) => stockLocations.find((location) => Array.isArray(location.outlet_ids) && location.outlet_ids.includes(outletId))?.id || '', [stockLocations])
  const money = (value) => `${currency} ${Number(value || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const submitTransfer = async (event) => {
    event.preventDefault()
    if (!transfer.from_stock_location_id || !transfer.to_stock_location_id || !transfer.inventory_item_id || Number(transfer.quantity) <= 0) {
      setError('Choose a source location, destination location, inventory item, and quantity above zero.')
      return
    }
    if (transfer.from_stock_location_id === transfer.to_stock_location_id) {
      setError('Source and destination stock locations must be different.')
      return
    }
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await window.api?.pos?.createStockTransfer?.({ ...transfer, id: crypto.randomUUID(), quantity: Number(transfer.quantity) })
      if (!result?.success) throw new Error(result?.error || 'Stock transfer could not be recorded.')
      setNotice(`Stock location transfer recorded. Source balance: ${Number(result.source_balance || 0)}; destination balance: ${Number(result.destination_balance || 0)}. Total business stock is unchanged.`)
      setTransfer({ from_stock_location_id: '', to_stock_location_id: '', inventory_item_id: '', quantity: '1', notes: '' })
      await load()
    } catch (transferError) {
      setError(transferError?.message || 'Stock transfer could not be recorded.')
    } finally {
      setSaving(false)
    }
  }

  const saveStockLocation = async (event) => {
    event.preventDefault()
    if (!newStockLocationName.trim()) { setError('Enter a stock location name.'); return }
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await window.api?.pos?.createRestaurantStockLocation?.({ name: newStockLocationName.trim() })
      if (!result?.success) throw new Error(result?.error || 'Could not create stock location.')
      setNewStockLocationName(''); setNotice('Stock location created. Assign an outlet to it only when that outlet should draw stock separately.'); await load()
    } catch (saveError) { setError(saveError?.message || 'Could not create stock location.') } finally { setSaving(false) }
  }

  const assignOutletStockLocation = async (outletId, stockLocationId) => {
    if (!stockLocationId) return
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await window.api?.pos?.setRestaurantOutletStockLocation?.(outletId, stockLocationId)
      if (!result?.success) throw new Error(result?.error || 'Could not update outlet stock source.')
      setNotice('Outlet stock source saved. Sales from this Till now draw from that stock location.'); await load()
    } catch (saveError) { setError(saveError?.message || 'Could not update outlet stock source.') } finally { setSaving(false) }
  }

  const renameStockLocation = (location) => {
    setEditingStockLocation(location)
    setStockLocationName(location.name || '')
    setError('')
  }

  const saveStockLocationName = async (event) => {
    event.preventDefault()
    if (!stockLocationName.trim()) { setError('Enter a stock location name.'); return }
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await window.api?.pos?.updateRestaurantStockLocation?.(editingStockLocation.id, { name: stockLocationName.trim() })
      if (!result?.success) throw new Error(result?.error || 'Could not update stock location.')
      setEditingStockLocation(null); setNotice('Stock location renamed.'); await load()
    } catch (saveError) { setError(saveError?.message || 'Could not update stock location.') } finally { setSaving(false) }
  }

  const removeStockLocation = async (location) => {
    if (!window.confirm(`Delete ${location.name}? This is allowed only when it has no stock and no outlet assignment.`)) return
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await window.api?.pos?.deleteRestaurantStockLocation?.(location.id)
      if (!result?.success) throw new Error(result?.error || 'Could not delete stock location.')
      setNotice('Stock location deleted.'); await load()
    } catch (saveError) { setError(saveError?.message || 'Could not delete stock location.') } finally { setSaving(false) }
  }

  const openOutletEditor = (outlet = null) => {
    setEditingOutlet(outlet || {})
    setOutletForm({
      name: outlet?.name || '',
      type: outlet?.type || (barOnly ? 'beverage' : 'food'),
      is_active: outlet?.is_active !== false,
      sort_order: String(outlet?.sort_order ?? outlets.length),
    })
    setError('')
  }

  const saveOutlet = async (event) => {
    event.preventDefault()
    if (!outletForm.name.trim()) { setError('Outlet name is required.'); return }
    setSaving(true); setError(''); setNotice('')
    try {
      const payload = { ...outletForm, name: outletForm.name.trim(), sort_order: Number(outletForm.sort_order || 0) }
      const result = editingOutlet?.id
        ? await window.api?.pos?.updateRestaurantOutlet?.(editingOutlet.id, payload)
        : await window.api?.pos?.createRestaurantOutlet?.(payload)
      if (!result?.success) throw new Error(result?.error || 'Could not save outlet.')
      setEditingOutlet(null)
      setNotice(editingOutlet?.id ? 'Outlet updated. Its future sales, stock custody, and reporting scope remain traceable.' : 'Outlet created. Assign appropriate staff access before using it for service.')
      await load()
    } catch (saveError) {
      setError(saveError?.message || 'Could not save outlet.')
    } finally { setSaving(false) }
  }

  return (
    <div className="hpos-page-frame hpos-outlet-page">
      <HposPageHero
        eyebrow="Portfolio operations"
        title="Outlet control"
        description={barOnly ? 'For bars with two or more outlets: separate each till and stock location, transfer physical custody, and compare outlet contribution from authoritative sales and cost data.' : 'For businesses with two or more active outlets: review each outlet, record stock custody transfers, and compare outlet contribution from authoritative sales and cost data.'}
        actions={<div className="flex gap-2">{canConfigureOutlets && <HposButton tone="primary" icon={Plus} onClick={() => openOutletEditor()}>Add outlet</HposButton>}<HposButton icon={RefreshCw} onClick={load} disabled={loading}>Refresh</HposButton></div>}
      />
      {error && <HposNotice tone="error">{error}</HposNotice>}
      {notice && <HposNotice>{notice}</HposNotice>}

      {!loading && activeOutlets.length < 2 ? <div className="space-y-4"><HposEmptyState icon={Store} title="Outlet control needs two active outlets" description="This business currently has one active outlet, so there is nothing to compare or transfer. Add an outlet here only when cash, stock, reporting, or accountability must be separate." />{canConfigureOutlets && <div className="flex justify-center"><HposButton tone="primary" icon={Plus} onClick={() => openOutletEditor()}>Create another outlet</HposButton></div>}</div> : <>

      <div className="hpos-control-tabs" role="tablist" aria-label="Multi-outlet sections">
        <button type="button" role="tab" aria-selected={activeTab === 'outlets'} className={activeTab === 'outlets' ? 'is-active' : ''} onClick={() => setActiveTab('outlets')}><Store size={15}/>Outlets <span>{outlets.length}</span></button>
        <button type="button" role="tab" aria-selected={activeTab === 'balances'} className={activeTab === 'balances' ? 'is-active' : ''} onClick={() => setActiveTab('balances')}><Boxes size={15}/>Stock balances</button>
        {canTransfer && <button type="button" role="tab" aria-selected={activeTab === 'transfers'} className={activeTab === 'transfers' ? 'is-active' : ''} onClick={() => setActiveTab('transfers')}><ArrowLeftRight size={15}/>Transfer stock</button>}
        {canReport && <button type="button" role="tab" aria-selected={activeTab === 'profit'} className={activeTab === 'profit' ? 'is-active' : ''} onClick={() => setActiveTab('profit')}><TrendingUp size={15}/>Outlet contribution</button>}
      </div>

      {activeTab === 'outlets' && (
        loading ? <div className="hpos-list-loading">Loading configured outlets…</div> : outlets.length === 0 ? <HposEmptyState icon={Store} title="No outlets configured" description={barOnly ? 'No authorised bar outlets are available for this company.' : 'No authorised Restaurant & Bar outlets are available for this company.'} /> : (
          <><section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-black text-slate-800">Stock locations</h2><p className="mt-1 text-sm text-slate-600">Sales outlets can share stock. New businesses start with <strong>Shared business stock</strong>.</p></div><form className="flex gap-2" onSubmit={saveStockLocation}><input value={newStockLocationName} onChange={(event) => setNewStockLocationName(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="For example, Bar store" /><HposButton type="submit" icon={Plus} disabled={saving}>Add location</HposButton></form></div><div className="mt-3 flex flex-wrap gap-2">{activeStockLocations.map((location) => <span key={location.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700">{location.name}{location.is_default ? ' · default' : ''} · {location.outlet_count || 0} outlet{Number(location.outlet_count || 0) === 1 ? '' : 's'}<button type="button" onClick={() => renameStockLocation(location)} className="ml-1 rounded p-0.5 hover:bg-white" aria-label={`Rename ${location.name}`}><Pencil size={12}/></button>{!location.is_default && <button type="button" onClick={() => removeStockLocation(location)} className="rounded p-0.5 text-red-700 hover:bg-white" aria-label={`Delete ${location.name}`}><Trash2 size={12}/></button>}</span>)}</div></section>
          <section className="hpos-outlet-grid">
            {outlets.map((outlet) => (
              <article key={outlet.id} className={outlet.active === false ? 'is-inactive' : ''}>
                <span className="hpos-outlet-icon"><Store size={21}/></span>
                <div><strong>{outlet.name || 'Unnamed outlet'}</strong><p>{outlet.code || 'No code'} · {String(outlet.type || outlet.pos_type || 'restaurant').replaceAll('_', ' ')}</p>{canConfigureOutlets && <label className="mt-2 block text-xs font-bold text-slate-600">Stock source<select disabled={saving || outlet.active === false} value={stockLocationForOutlet(outlet.id)} onChange={(event) => assignOutletStockLocation(outlet.id, event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-semibold text-slate-700"><option value="">Choose stock location</option>{activeStockLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>}</div>
                <div className="flex items-center gap-2"><HposStatusBadge tone={outlet.active === false ? 'neutral' : 'success'}>{outlet.active === false ? 'Inactive' : 'Active'}</HposStatusBadge>{canConfigureOutlets && <button type="button" onClick={() => openOutletEditor(outlet)} className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:border-emerald-300 hover:text-emerald-700" aria-label={`Edit ${outlet.name}`}><Pencil size={15}/></button>}</div>
              </article>
            ))}
          </section></>
        )
      )}

      {activeTab === 'transfers' && canTransfer && (
        <div className="hpos-outlet-transfer-layout">
          <form className="hpos-outlet-transfer-form" onSubmit={submitTransfer}>
            <div className="hpos-section-heading"><span><ArrowLeftRight size={18}/></span><div><h2>Record stock transfer</h2><p>Move physical custody between stock locations. Sales outlets may share the same location; total business stock does not change.</p></div></div>
            <div className="hpos-form-grid">
              <label>From stock location<select value={transfer.from_stock_location_id} onChange={(event) => setTransfer({ ...transfer, from_stock_location_id: event.target.value, inventory_item_id: '' })}><option value="">Choose source</option>{activeStockLocations.filter((row) => row.id !== transfer.to_stock_location_id).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
              <label>To stock location<select value={transfer.to_stock_location_id} onChange={(event) => setTransfer({ ...transfer, to_stock_location_id: event.target.value })}><option value="">Choose destination</option>{activeStockLocations.filter((row) => row.id !== transfer.from_stock_location_id).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
              <label className="is-wide">Inventory item<select value={transfer.inventory_item_id} onChange={(event) => setTransfer({ ...transfer, inventory_item_id: event.target.value })}><option value="">Choose an item</option>{availableItems.map((item) => <option key={item.id} value={item.id}>{item.name} · {Number(item.current_stock || 0)} {item.unit || 'units'}</option>)}</select></label>
              <label>Quantity<input type="number" min="0.001" step="0.001" value={transfer.quantity} onChange={(event) => setTransfer({ ...transfer, quantity: event.target.value })}/></label>
              <label>Transfer note<input value={transfer.notes} onChange={(event) => setTransfer({ ...transfer, notes: event.target.value })} placeholder="Reason or handover reference"/></label>
            </div>
            <HposButton type="submit" tone="primary" icon={ArrowLeftRight} disabled={saving}>{saving ? 'Recording…' : 'Record transfer'}</HposButton>
          </form>
          <aside className="hpos-outlet-transfer-note"><Boxes size={25}/><h2>What this action records</h2><p>This is an accountable intra-business custody movement. It creates a transfer reference and stock-movement record; it does not inflate or reduce total stock for the company.</p></aside>
        </div>
      )}

      {activeTab === 'balances' && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-5"><div><h2 className="text-lg font-black text-slate-800">Stock by physical location</h2><p className="mt-1 text-sm text-slate-600">Each column is a physical stock location. Business total includes every location; unallocated stock is shown explicitly for reconciliation.</p></div><HposButton icon={RefreshCw} onClick={load} disabled={loading}>Refresh balances</HposButton></div><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Item</th>{activeStockLocations.map((location) => <th key={location.id} className="px-4 py-3 text-right">{location.name}</th>)}<th className="px-4 py-3 text-right">Allocated</th><th className="px-4 py-3 text-right">Unallocated</th><th className="px-4 py-3 text-right">Business total</th></tr></thead><tbody>{stockBalanceItems.map((item) => <tr key={item.id} className="border-t border-slate-100"><td className="px-4 py-3 font-bold text-slate-800">{item.name}<small className="ml-1 font-medium text-slate-500">{item.unit}</small></td>{activeStockLocations.map((location) => <td key={location.id} className="px-4 py-3 text-right font-semibold text-slate-700">{Number(item.byLocation[location.id] || 0)}</td>)}<td className="px-4 py-3 text-right font-semibold text-slate-700">{item.allocatedStock}</td><td className={`px-4 py-3 text-right font-semibold ${item.unallocatedStock ? 'text-amber-700' : 'text-slate-500'}`}>{item.unallocatedStock || '—'}</td><td className="px-4 py-3 text-right font-black text-slate-900">{item.businessStock}</td></tr>)}{!loading && !stockBalanceItems.length && <tr><td colSpan={activeStockLocations.length + 4} className="px-5 py-12 text-center text-slate-500">No inventory balances are available yet.</td></tr>}</tbody></table></div></section>
      )}

      {activeTab === 'profit' && canReport && (
        <section className="hpos-outlet-profit">
          <div className="hpos-outlet-profit-toolbar"><div className="hpos-section-heading"><span><TrendingUp size={18}/></span><div><h2>Outlet contribution</h2><p>Revenue less recorded stock cost and operating expenses.</p></div></div><label><CalendarDays size={15}/><input type="date" value={start} onChange={(event) => setStart(event.target.value)}/><span>to</span><input type="date" value={end} onChange={(event) => setEnd(event.target.value)}/></label></div>
          {profit?.combined && <div className="hpos-outlet-profit-kpis">{[['Combined revenue', profit.combined.revenue], ['Stock cost', profit.combined.inventoryCost], ['Operating expenses', profit.combined.expenses], ['Contribution', profit.combined.profit]].map(([label, value], index) => <article key={label} className={index === 3 && Number(value) < 0 ? 'is-negative' : ''}><small>{label}</small><strong>{money(value)}</strong></article>)}</div>}
          <div className="hpos-outlet-profit-table"><header><span>Outlet</span><span>Sales</span><span>Stock cost</span><span>Expenses</span><span>Contribution</span></header>{pnlRows.map((row) => <article key={row.key || row.name}><strong>{row.name}</strong><span>{money(row.revenue)}</span><span>{money(row.inventoryCost)}</span><span>{money(row.expenses)}</span><strong className={Number(row.profit) < 0 ? 'is-negative' : ''}>{money(row.profit)}</strong></article>)}</div>
          {!loading && !pnlRows.length && <HposEmptyState icon={TrendingUp} title="No outlet contribution data" description="Choose a period with completed sales and recorded costs." />}
          {profit?.source && <p className="hpos-report-source"><CheckCircle2 size={14}/>Source: {profit.source === 'server' ? 'server-authoritative' : 'local reporting fallback'} · {start} to {end}</p>}
        </section>
      )}
      </>}
      {editingOutlet && <Modal title={editingOutlet.id ? 'Edit outlet' : 'Create outlet'} onClose={() => setEditingOutlet(null)} size="sm">
        <form className="hpos-outlet-editor" onSubmit={saveOutlet}>
          <p className="hpos-outlet-editor__intro">Create a separate outlet only when it needs its own cash accountability, stock custody, or reporting. Another till at the same {barOnly ? 'bar' : 'venue'} does not need another outlet.</p>
          <label className="hpos-outlet-editor__field">Outlet name<span>Use the name staff and managers will recognise.</span><input autoFocus required value={outletForm.name} onChange={(event) => setOutletForm({ ...outletForm, name: event.target.value })} placeholder="For example, Rooftop Bar" /></label>
          <label className="hpos-outlet-editor__field">Service type<select value={outletForm.type} onChange={(event) => setOutletForm({ ...outletForm, type: event.target.value })}>{!barOnly && <option value="food">Restaurant / food service</option>}<option value="beverage">Bar / beverage service</option><option value="accommodation">Other service outlet</option></select></label>
          <label className="hpos-outlet-editor__field hpos-outlet-editor__field--order">Display priority<span>Lower numbers appear first.</span><input type="number" min="0" max="9999" inputMode="numeric" value={outletForm.sort_order} onChange={(event) => setOutletForm({ ...outletForm, sort_order: event.target.value })} /></label>
          {editingOutlet.id && <label className="hpos-outlet-editor__toggle"><input type="checkbox" checked={outletForm.is_active} onChange={(event) => setOutletForm({ ...outletForm, is_active: event.target.checked })} /><span><strong>Active outlet</strong><small>Available for new service and reporting.</small></span></label>}
          <div className="hpos-outlet-editor__actions"><button type="button" className="bb-btn-outline" onClick={() => setEditingOutlet(null)}>Cancel</button><button disabled={saving} className="bb-btn-primary">{saving ? 'Saving…' : editingOutlet.id ? 'Save changes' : 'Create outlet'}</button></div>
        </form>
      </Modal>}
      {editingStockLocation && <Modal title="Rename stock location" onClose={saving ? () => {} : () => setEditingStockLocation(null)} size="sm">
        <form className="hpos-outlet-editor" onSubmit={saveStockLocationName}>
          <p className="hpos-outlet-editor__intro">Use a physical place staff recognise, such as Main storeroom or Bar store. Changing this name does not move stock.</p>
          <label className="hpos-outlet-editor__field">Location name<input autoFocus required value={stockLocationName} onChange={(event) => setStockLocationName(event.target.value)} placeholder="For example, Bar store" /></label>
          <div className="hpos-outlet-editor__actions"><button type="button" className="bb-btn-outline" disabled={saving} onClick={() => setEditingStockLocation(null)}>Cancel</button><button disabled={saving} className="bb-btn-primary">{saving ? 'Saving…' : 'Save name'}</button></div>
        </form>
      </Modal>}
    </div>
  )
}

function LegacyMultiOutletPos() {
  const restaurantMode = false
  const outletTypes = OUTLET_TYPES
  const [outlets, setOutlets] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('outlets')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyOutlet)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [transferForm, setTransferForm] = useState({ from_outlet: '', to_outlet: '', item: '', qty: 1 })
  const [showTransfer, setShowTransfer] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await window.api.multiOutletPos?.getOutlets().catch(() => []) || []
      setOutlets(Array.isArray(data) ? data : [])
    } catch {
      setOutlets([])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      setError('Name and code are required'); return
    }
    setSaving(true); setError(''); setSuccess('')
    try {
      const result = editing
        ? await window.api.multiOutletPos?.updateOutlet(editing.id, form)
        : await window.api.multiOutletPos?.createOutlet(form)
      if (result?.success) {
        setSuccess(editing ? 'Outlet updated' : 'Outlet created')
        setShowModal(false); setEditing(null); setForm(emptyOutlet)
        await load()
      } else { setError(result?.error || 'Save failed') }
    } catch (err) { setError(err.message) }
    setSaving(false)
  }

  const handleDelete = async (id) => {
    setConfirmDialog(null); setError(''); setSuccess('')
    try {
      const result = await window.api.multiOutletPos?.deleteOutlet(id)
      if (result?.success) { setSuccess('Outlet deleted'); await load() }
      else { setError(result?.error || 'Delete failed') }
    } catch (err) { setError(err.message) }
  }

  const handleTransfer = async () => {
    if (!transferForm.from_outlet || !transferForm.to_outlet || !transferForm.item || !transferForm.qty) {
      setError('All transfer fields required'); return
    }
    setSaving(true); setError(''); setSuccess('')
    try {
      const result = await window.api.multiOutletPos?.transferStock(transferForm)
      if (result?.success) { setSuccess('Stock transferred'); setShowTransfer(false); setTransferForm({ from_outlet: '', to_outlet: '', item: '', qty: 1 }) }
      else { setError(result?.error || 'Transfer failed') }
    } catch (err) { setError(err.message) }
    setSaving(false)
  }

  const openEdit = (outlet) => {
    setEditing(outlet)
    setForm({ name: outlet.name || '', code: outlet.code || '', pos_type: outlet.pos_type || 'restaurant', active: outlet.active !== false })
    setShowModal(true)
  }

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center p-6">
        <div className="bb-card flex min-w-[220px] flex-col items-center gap-4 px-8 py-7 text-center">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
          <p className="text-sm font-semibold text-[#163229]">Loading outlets...</p>
        </div>
      </div>
    )
  }

  return (
    <div className={restaurantMode ? 'hpos-outlets-workspace' : 'space-y-5 p-6'}>
      <div className={restaurantMode ? 'hpos-outlets-hero' : 'flex items-center justify-between'}>
        <div>
          {restaurantMode && <p className="hpos-eyebrow">Portfolio operations</p>}<h1 className="text-xl font-bold text-gray-900">Multi-Outlet POS</h1>
          <p className="mt-1 text-sm text-gray-500">Manage POS outlets, transfers, and cross-outlet reporting</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setEditing(null); setForm(emptyOutlet); setShowModal(true) }} className={restaurantMode ? 'hpos-primary-action' : 'btn-primary'}><Plus size={15} /> New Outlet</button>
          <button onClick={() => setShowTransfer(true)} className="btn-secondary"><ArrowLeftRight size={15} /> Transfer Stock</button>
          <button onClick={load} className="btn-secondary"><RefreshCw size={15} /></button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"><AlertTriangle size={14} className="mr-1 inline" />{error}</div>}
      {success && <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">✓ {success}</div>}

      <div className="flex gap-1 border-b border-gray-200">
        {['outlets', 'transfers', 'profit'].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 text-sm font-medium capitalize ${activeTab === tab ? 'border-b-2 border-[#174c3a] text-[#174c3a]' : 'text-gray-500 hover:text-gray-700'}`}>
            {tab === 'profit' ? <><TrendingUp size={14} className="mr-1 inline" />Profit</> : tab}
          </button>
        ))}
      </div>

      {activeTab === 'outlets' && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {outlets.length === 0 && <p className="col-span-full text-center text-sm text-gray-400 py-10">No POS outlets yet. Create your first outlet to get started.</p>}
          {outlets.map(outlet => (
            <div key={outlet.id} className={`bb-card p-4 ${outlet.active === false ? 'opacity-50' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-[#e8f5e9] p-2"><Store size={18} className="text-[#174c3a]" /></div>
                  <div>
                    <p className="font-semibold text-gray-900">{outlet.name}</p>
                    <p className="text-xs text-gray-500">{outlet.code} · {outletTypes.find(t => t.value === outlet.pos_type)?.label || outlet.pos_type}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(outlet)} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><Pencil size={14} /></button>
                  <button onClick={() => setConfirmDialog({ message: `Delete outlet "${outlet.name}"?`, onConfirm: () => handleDelete(outlet.id) })} className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'transfers' && (
        <div className="bb-card p-6 text-center text-sm text-gray-500">
          <ArrowLeftRight size={32} className="mx-auto mb-3 text-gray-300" />
          <p>Cross-outlet stock transfer history will appear here.</p>
          <p className="mt-1 text-xs text-gray-400">Use "Transfer Stock" to move inventory between outlets.</p>
        </div>
      )}

      {activeTab === 'profit' && (
        <div className="bb-card p-6 text-center text-sm text-gray-500">
          <TrendingUp size={32} className="mx-auto mb-3 text-gray-300" />
          <p>Outlet-level profit tracking will appear here once outlets process orders.</p>
        </div>
      )}

      {showModal && (
        <Modal title={editing ? 'Edit Outlet' : 'New POS Outlet'} onClose={() => { setShowModal(false); setEditing(null); setForm(emptyOutlet) }}>
          <div className="space-y-4">
            <div>
              <label className="bb-label">Outlet Name</label>
              <input className="bb-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Main Restaurant" />
            </div>
            <div>
              <label className="bb-label">Code</label>
              <input className="bb-input" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="REST-01" />
            </div>
            <div>
              <label className="bb-label">Type</label>
              <select className="bb-input" value={form.pos_type} onChange={e => setForm({ ...form, pos_type: e.target.value })}>
                {outletTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />
              Active
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => { setShowModal(false); setEditing(null); setForm(emptyOutlet) }} className="btn-secondary">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary">{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</button>
            </div>
          </div>
        </Modal>
      )}

      {showTransfer && (
        <Modal title="Transfer Stock Between Outlets" onClose={() => setShowTransfer(false)}>
          <div className="space-y-4">
            <div>
              <label className="bb-label">From Outlet</label>
              <select className="bb-input" value={transferForm.from_outlet} onChange={e => setTransferForm({ ...transferForm, from_outlet: e.target.value })}>
                <option value="">Select...</option>
                {outlets.filter(o => o.id !== transferForm.to_outlet).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="bb-label">To Outlet</label>
              <select className="bb-input" value={transferForm.to_outlet} onChange={e => setTransferForm({ ...transferForm, to_outlet: e.target.value })}>
                <option value="">Select...</option>
                {outlets.filter(o => o.id !== transferForm.from_outlet).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="bb-label">Item / Stock Code</label>
              <input className="bb-input" value={transferForm.item} onChange={e => setTransferForm({ ...transferForm, item: e.target.value })} placeholder="COFFEE-BEANS" />
            </div>
            <div>
              <label className="bb-label">Quantity</label>
              <input type="number" className="bb-input" value={transferForm.qty} onChange={e => setTransferForm({ ...transferForm, qty: Math.max(1, Number(e.target.value)) })} min="1" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowTransfer(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleTransfer} disabled={saving} className="btn-primary">{saving ? 'Transferring...' : 'Transfer'}</button>
            </div>
          </div>
        </Modal>
      )}

      {confirmDialog && <ConfirmDialog {...confirmDialog} onCancel={() => setConfirmDialog(null)} />}
    </div>
  )
}
