import { useMemo, useEffect, useState } from 'react'
import { AlertTriangle, Package, RefreshCw, ShoppingCart, Truck } from 'lucide-react'
import { useSettings } from '../../app-context'

export default function RestaurantPurchaseSuggestions() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const [suggestions, setSuggestions] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState([])
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState('info')
  const [saving, setSaving] = useState(false)

  const loadSuggestions = async ({ preserveMessage = false } = {}) => {
    setLoading(true); if (!preserveMessage) setMessage('')
    try {
      const [suggestionData, supplierData] = await Promise.all([
        window.api.pos.getLowStockPurchaseSuggestions(),
        window.api.pos.getSuppliers()
      ])
      setSuggestions(Array.isArray(suggestionData) ? suggestionData : [])
      setSuppliers(Array.isArray(supplierData) ? supplierData : [])
    }
    catch (err) { setMessageTone('error'); setMessage(err?.message || 'Could not load purchase suggestions.') } finally { setLoading(false) }
  }
  useEffect(() => { loadSuggestions() }, [])
  const grouped = useMemo(() => suggestions.reduce((acc, suggestion, index) => { const key = suggestion.supplier_name || 'No preferred supplier'; (acc[key] ||= []).push({ ...suggestion, _idx: index }); return acc }, {}), [suggestions])
  const selectedRows = selected.map((index) => suggestions[index]).filter(Boolean)
  const selectedSupplierId = selectedRows[0]?.supplier_id || null
  const total = selectedRows.reduce((sum, row) => sum + Number(row.suggested_quantity || 0) * Number(row.last_unit_cost || 0), 0)

  const toggle = (index) => {
    if (selected.includes(index)) { setSelected(selected.filter((item) => item !== index)); return }
    const next = suggestions[index]
    if (selectedSupplierId && next.supplier_id !== selectedSupplierId) { setSelected([index]); setMessageTone('info'); setMessage('Selection changed to one supplier. Each purchase order must have one supplier.'); return }
    setSelected([...selected, index])
  }
  const chooseSupplierGroup = (rows) => setSelected(rows.filter((row) => row.supplier_id).map((row) => row._idx))
  const assignSupplier = async (row, supplierId) => {
    if (!supplierId) return
    setSaving(true); setMessage('')
    try {
      const result = await window.api.pos.setPreferredSupplierForInventoryItem(row.inventory_item_id, supplierId, row.last_unit_cost || null)
      if (result?.success === false) throw new Error(result.error || 'Could not set the preferred supplier.')
      setMessageTone('success'); setMessage(`Preferred supplier saved for ${row.inventory_item_name || 'this stock item'}. You can now create its purchase order.`)
      await loadSuggestions({ preserveMessage: true })
    } catch (err) {
      setMessageTone('error'); setMessage(err?.message || 'Could not set the preferred supplier.')
    } finally { setSaving(false) }
  }
  const convertToPo = async () => {
    if (!selectedRows.length || !selectedSupplierId) { setMessageTone('error'); setMessage('Select suggestions with one preferred supplier before creating a purchase order.'); return }
    setSaving(true); setMessage('')
    try { const result = await window.api.pos.convertPurchaseSuggestionsToPo(selectedSupplierId, selectedRows, 'Auto-created from low-stock suggestions'); if (result?.success === false) throw new Error(result.error || 'Could not create the purchase order.'); setSelected([]); setMessageTone('success'); setMessage('Draft purchase order created. Review it in Purchasing before approval.'); await loadSuggestions({ preserveMessage: true }) }
    catch (err) { setMessageTone('error'); setMessage(err?.message || 'Could not create the purchase order.') }
    finally { setSaving(false) }
  }

  return <div className="mx-auto max-w-7xl py-2">
    <section className="rounded-[22px] border border-[#49303a] bg-[linear-gradient(135deg,#30212a,#56323b)] p-5 text-white shadow-[0_12px_28px_rgba(58,33,44,.18)]"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[11px] font-extrabold uppercase tracking-[.14em] text-white/60">Inventory control</p><h1 className="mt-1 text-2xl font-black">Purchase Suggestions</h1><p className="mt-1 text-sm text-white/70">Turn real reorder risk into supplier-specific draft purchase orders.</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={loading || saving} onClick={() => loadSuggestions()} className="inline-flex items-center gap-1.5 rounded-xl border border-white/25 bg-white/10 px-3 py-2.5 text-sm font-extrabold disabled:opacity-50"><RefreshCw className={loading ? 'animate-spin' : ''} size={14}/> {loading ? 'Refreshing…' : 'Refresh'}</button>{selected.length > 0 && <button type="button" disabled={saving} onClick={convertToPo} className="inline-flex items-center gap-1.5 rounded-xl bg-[#e8994e] px-3 py-2.5 text-sm font-extrabold text-[#2a1c23] disabled:opacity-50"><ShoppingCart size={15}/> {saving ? 'Creating draft…' : `Create PO · ${selected.length} item${selected.length === 1 ? '' : 's'}`}</button>}</div></div></section>
    {message && <div role={messageTone === 'error' ? 'alert' : 'status'} className={`mt-4 rounded-xl border px-4 py-3 text-sm font-semibold ${messageTone === 'error' ? 'border-[#efb7aa] bg-[#fff0ed] text-[#8b3027]' : messageTone === 'success' ? 'border-[#a7d8bf] bg-[#eaf8f0] text-[#17613f]' : 'border-[#efd09e] bg-[#fff3df] text-[#794017]'}`}>{message}</div>}
    {loading ? <div className="py-20 text-center text-sm font-semibold text-[#806d73]">Reviewing reorder signals…</div> : !suggestions.length ? <div className="mt-5 rounded-[22px] border border-[#decfd0] bg-[#fffaf7] p-12 text-center shadow-[0_12px_28px_rgba(65,38,48,.08)]"><Package className="mx-auto mb-3 text-[#c8784c]" size={38}/><p className="text-lg font-black text-[#35242c]">No purchase suggestions</p><p className="mt-2 text-sm text-[#806d73]">All tracked items are currently above their reorder points.</p></div> : <>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">{[['Items to consider', suggestions.length], ['Supplier groups', Object.keys(grouped).length], ['Selected estimate', `${currency}${total.toFixed(2)}`]].map(([label, value]) => <div key={label} className="rounded-2xl border border-[#decfd0] bg-[#fffaf7] p-4 shadow-[0_8px_18px_rgba(65,38,48,.06)]"><p className="text-[11px] font-extrabold uppercase tracking-[.1em] text-[#88727a]">{label}</p><strong className="mt-2 block text-2xl text-[#35242c]">{value}</strong></div>)}</div>
      <p className="mt-5 flex items-center gap-2 text-sm font-semibold text-[#765f67]"><AlertTriangle size={16} className="text-[#c8784c]"/> Select one supplier at a time; the app creates one auditable purchase order per supplier.</p>
      <div className="mt-4 space-y-4">{Object.entries(grouped).map(([supplier, rows]) => <section key={supplier} className="overflow-hidden rounded-[22px] border border-[#decfd0] bg-[#fffaf7] shadow-[0_10px_22px_rgba(65,38,48,.07)]"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eadedb] bg-[#f6eee9] px-5 py-4"><div><h2 className="font-black text-[#35242c]">{supplier}</h2><p className="text-xs text-[#806d73]">{rows.length} suggested item{rows.length === 1 ? '' : 's'}</p></div>{rows[0]?.supplier_id && <button type="button" onClick={() => chooseSupplierGroup(rows)} className="rounded-lg border border-[#d9b59e] bg-white px-3 py-2 text-xs font-extrabold text-[#713f35]">Select this supplier</button>}</div>{!rows[0]?.supplier_id && <div className="flex gap-2 border-b border-[#f0d6b6] bg-[#fff3df] px-5 py-3 text-sm text-[#794017]"><Truck size={17} className="mt-0.5 shrink-0"/><span><strong>Supplier setup needed.</strong> Choose the supplier for each item below. Receiving future purchase orders will remember that choice automatically.</span></div>}<div className="divide-y divide-[#ecdfdc]">{rows.map((row) => { const checked = selected.includes(row._idx); return <div key={row._idx} className={`grid items-center gap-3 px-5 py-4 text-left transition sm:grid-cols-[auto_1fr_auto] ${checked ? 'bg-[#fff0df]' : 'hover:bg-[#fff8f3]'}`}><button type="button" aria-label={`Select ${row.inventory_item_name || 'inventory item'}`} onClick={() => toggle(row._idx)} disabled={!row.supplier_id} className={`grid h-5 w-5 place-items-center rounded border disabled:cursor-not-allowed disabled:opacity-40 ${checked ? 'border-[#c8784c] bg-[#d87945]' : 'border-[#cdbfc0] bg-white'}`}>{checked && <span className="h-2 w-2 rounded-full bg-[#2a1c23]"/>}</button><button type="button" onClick={() => toggle(row._idx)} disabled={!row.supplier_id} className="min-w-0 text-left disabled:cursor-default"><strong className="block text-sm text-[#35242c]">{row.inventory_item_name || 'Inventory item'}</strong><small className="mt-1 block text-xs text-[#806d73]">On hand {Number(row.current_stock || 0).toFixed(1)} · reorder at {Number(row.reorder_level || 0).toFixed(1)}</small></button><div className="min-w-[180px] text-right"><strong className="block text-sm text-[#35242c]">Order {Number(row.suggested_quantity || 0).toFixed(1)}</strong>{row.supplier_id ? <small className="mt-1 block text-xs text-[#806d73]">{row.last_unit_cost ? `${currency}${(Number(row.suggested_quantity) * Number(row.last_unit_cost)).toFixed(2)}` : 'Cost not set'}</small> : suppliers.length ? <label className="mt-2 block text-left text-xs font-bold text-[#713f35]">Preferred supplier<select aria-label={`Preferred supplier for ${row.inventory_item_name || 'inventory item'}`} defaultValue="" disabled={saving} onChange={(event) => assignSupplier(row, event.target.value)} className="mt-1 block w-full rounded-lg border border-[#d9b59e] bg-white px-2 py-1.5 text-sm font-semibold text-[#35242c] disabled:opacity-50"><option value="" disabled>Choose supplier…</option>{suppliers.map((supplierOption) => <option key={supplierOption.id} value={supplierOption.id}>{supplierOption.name}</option>)}</select></label> : <small className="mt-1 block text-xs font-semibold text-[#8b3027]">Add a supplier in Purchasing first.</small>}</div></div>})}</div></section>)}</div>
    </>}
  </div>
}
