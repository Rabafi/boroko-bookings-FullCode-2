import { useState, useEffect } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardList, Download, Mail, Pencil, Plus, RefreshCw, Trash2, Truck, X } from 'lucide-react'
import { useSettings } from '../../app-context'

const FIELD = 'mt-1 w-full rounded-xl border border-[#d7c9c8] bg-[#fffdfb] px-3 py-2.5 text-sm text-[#35242c] outline-none transition focus:border-[#d87945] focus:ring-2 focus:ring-[#f4d2bb]'

export default function RestaurantPurchasing() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const [suppliers, setSuppliers] = useState([])
  const [inventoryItems, setInventoryItems] = useState([])
  const [stockLocations, setStockLocations] = useState([])
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('orders')
  const [showSupplierForm, setShowSupplierForm] = useState(false)
  const [showPOForm, setShowPOForm] = useState(false)
  const [detailOrder, setDetailOrder] = useState(null)
  const [editingOrder, setEditingOrder] = useState(null)
  const [editingSupplier, setEditingSupplier] = useState(null)
  const [receivingOrder, setReceivingOrder] = useState(null)
  const [receiptLocationId, setReceiptLocationId] = useState('')
  const [supplierForm, setSupplierForm] = useState({ name: '', contact_person: '', phone: '', email: '', address: '', payment_terms: '' })
  const [poForm, setPoForm] = useState({ supplier_id: '', stock_location_id: '', expected_delivery: '', notes: '', items: [{ inventory_item_id: '', description: '', quantity: '', unit_cost: '' }] })
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [actionOrderId, setActionOrderId] = useState('')

  useEffect(() => { loadData() }, [])
  useEffect(() => {
    if ((!showSupplierForm && !showPOForm && !detailOrder) || saving) return undefined
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return
      setShowSupplierForm(false)
      setShowPOForm(false)
      setDetailOrder(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [saving, showPOForm, showSupplierForm])

  async function loadData() {
    try {
      setLoading(true)
      setError('')
      const [snapshot, locations] = await Promise.all([window.api.pos.getPurchasingSnapshot
        ? await window.api.pos.getPurchasingSnapshot()
        : await Promise.all([
          window.api.pos.getSuppliers(),
          window.api.pos.getPurchaseOrders ? window.api.pos.getPurchaseOrders() : Promise.resolve([]),
          window.api.inventory.getItems()
        ]).then(([suppliers, orders, inventoryItems]) => ({ suppliers, orders, inventoryItems })), window.api.pos.getRestaurantStockLocations()])
      if (snapshot?.error) throw new Error(snapshot.error)
      setSuppliers(Array.isArray(snapshot?.suppliers) ? snapshot.suppliers : [])
      setOrders(Array.isArray(snapshot?.orders) ? snapshot.orders : [])
      setInventoryItems(Array.isArray(snapshot?.inventoryItems) ? snapshot.inventoryItems : [])
      setStockLocations(Array.isArray(locations) ? locations.filter((location) => location.is_active !== false) : [])
    } catch (err) {
      setError(err?.message || 'Purchasing data could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  async function saveSupplier() {
    if (!supplierForm.name.trim()) { setError('Enter the supplier name.'); return }
    try {
      setSaving(true); setError(''); setNotice('')
      const supplierData = {
        name: supplierForm.name.trim(),
        contact_person: supplierForm.contact_person.trim() || null,
        phone: supplierForm.phone.trim() || null,
        email: supplierForm.email.trim() || null,
        address: supplierForm.address.trim() || null,
        payment_terms: supplierForm.payment_terms.trim() || null
      }
      const result = editingSupplier
        ? await window.api.pos.updateSupplier(editingSupplier.id, supplierData)
        : await window.api.pos.createSupplier(supplierData)
      if (result?.success === false) throw new Error(result.error || `Supplier could not be ${editingSupplier ? 'updated' : 'created'}.`)
      setShowSupplierForm(false)
      setEditingSupplier(null)
      setSupplierForm({ name: '', contact_person: '', phone: '', email: '', address: '', payment_terms: '' })
      setNotice(`${supplierData.name} was ${editingSupplier ? 'updated' : 'added to Purchasing'}.`)
      await loadData()
    } catch (err) {
      setError(err?.message || 'Supplier could not be saved.')
    } finally { setSaving(false) }
  }

  async function savePO() {
    if (!poForm.supplier_id) { setError('Choose a supplier for this purchase order.'); return }
    if (!poForm.stock_location_id) { setError('Choose where the goods will physically be received.'); return }
    if (!poForm.items.some(i => i.inventory_item_id)) { setError('Add at least one inventory item to the purchase order.'); return }
    if (poForm.items.some(i => !i.inventory_item_id || Number(i.quantity) <= 0)) { setError('Choose a stock item and enter a positive quantity on every line.'); return }
    try {
      setSaving(true); setError(''); setNotice('')
      const payload = {
        supplier_id: poForm.supplier_id,
        stock_location_id: poForm.stock_location_id,
        expected_delivery: poForm.expected_delivery || null,
        notes: poForm.notes.trim() || null,
        items: poForm.items.filter(i => i.inventory_item_id).map(i => ({
          inventory_item_id: i.inventory_item_id,
          description: i.description.trim(),
          quantity: Number(i.quantity) || 1,
          unit_cost: Number(i.unit_cost) || 0
        }))
      }
      const result = editingOrder
        ? await window.api.pos.updatePurchaseOrderDraft(editingOrder.id, payload)
        : await window.api.pos.createPurchaseOrder(payload)
      if (result?.success === false) throw new Error(result.error || `Purchase order could not be ${editingOrder ? 'updated' : 'created'}.`)
      setShowPOForm(false)
      setEditingOrder(null)
      setPoForm({ supplier_id: '', stock_location_id: '', expected_delivery: '', notes: '', items: [{ inventory_item_id: '', description: '', quantity: '', unit_cost: '' }] })
      setNotice(editingOrder ? 'Draft purchase order updated. Review it before approval.' : 'Draft purchase order created. Review it before approval.')
      await loadData()
    } catch (err) {
      setError(err?.message || 'Purchase order could not be created.')
    } finally { setSaving(false) }
  }

  async function approveOrder(orderId) {
    try {
      setActionOrderId(orderId); setError(''); setNotice('')
      const result = await window.api.pos.approvePurchaseOrder(orderId)
      if (result?.success === false) throw new Error(result.error || 'Purchase order could not be approved.')
      setNotice('Purchase order approved. Receive it only after the goods arrive.')
      await loadData()
    } catch (err) {
      setError(err?.message || 'Purchase order could not be approved.')
    } finally { setActionOrderId('') }
  }

  async function receiveOrder(orderId, stockLocationId) {
    try {
      setActionOrderId(orderId); setError(''); setNotice('')
      const result = await window.api.pos.receivePurchaseOrder(orderId, stockLocationId)
      if (result?.success === false) throw new Error(result.error || 'Goods could not be received.')
      setNotice(result?.reconciled
        ? 'Receipt reconciled: missing stock and movement entries were restored.'
        : result?.duplicate
          ? 'This receipt is already fully recorded; stock was not changed again.'
          : 'Goods received and the authoritative stock movement was recorded.')
      setReceivingOrder(null); await loadData()
    } catch (err) {
      setError(err?.message || 'Goods could not be received.')
    } finally { setActionOrderId('') }
  }

  async function savePurchaseOrderPdf(orderId) {
    try {
      setActionOrderId(`pdf:${orderId}`); setError(''); setNotice('')
      const result = await window.api.pos.savePurchaseOrderPdf(orderId)
      if (result?.success === false && !result?.canceled) throw new Error(result.error || 'Purchase order PDF could not be saved.')
      if (result?.success) setNotice('Purchase order PDF saved. It is ready to send to the supplier.')
    } catch (err) { setError(err?.message || 'Purchase order PDF could not be saved.') }
    finally { setActionOrderId('') }
  }

  async function emailPurchaseOrder(orderId) {
    try {
      setActionOrderId(`email:${orderId}`); setError(''); setNotice('')
      const result = await window.api.pos.sendPurchaseOrderEmail(orderId)
      if (result?.success === false) throw new Error(result.error || 'Purchase order email could not be sent.')
      setNotice('Purchase order emailed to the supplier with the PDF attached.')
    } catch (err) { setError(err?.message || 'Purchase order email could not be sent.') }
    finally { setActionOrderId('') }
  }

  const statusBadge = (s) => {
    const colors = {
      draft: 'bg-gray-100 text-gray-600',
      pending: 'bg-amber-100 text-amber-700',
      approved: 'bg-blue-100 text-blue-700',
      received: 'bg-emerald-100 text-emerald-700',
      cancelled: 'bg-red-100 text-red-700'
    }
    return colors[s] || 'bg-gray-100 text-gray-600'
  }

  const startSupplierForm = (supplier = null) => {
    setError('')
    setEditingSupplier(supplier)
    setSupplierForm(supplier ? {
      name: supplier.name || '', contact_person: supplier.contact_person || '', phone: supplier.phone || '',
      email: supplier.email || '', address: supplier.address || '', payment_terms: supplier.payment_terms || ''
    } : { name: '', contact_person: '', phone: '', email: '', address: '', payment_terms: '' })
    setShowSupplierForm(true)
  }

  const startPurchaseOrderForm = (order = null) => {
    setError(''); setEditingOrder(order)
    setPoForm(order ? {
      supplier_id: order.supplier_id || '', stock_location_id: order.stock_location_id || '', expected_delivery: order.expected_delivery ? String(order.expected_delivery).slice(0, 10) : '', notes: order.notes || '',
      items: order.items?.length ? order.items.map((item) => ({ inventory_item_id: item.inventory_item_id || '', description: item.description || '', quantity: item.quantity ?? '', unit_cost: item.unit_cost ?? '' })) : [{ inventory_item_id: '', description: '', quantity: '', unit_cost: '' }]
    } : { supplier_id: '', stock_location_id: stockLocations.find((location) => location.is_default)?.id || '', expected_delivery: '', notes: '', items: [{ inventory_item_id: '', description: '', quantity: '', unit_cost: '' }] })
    setShowPOForm(true)
  }

  const startReceipt = (order) => {
    setError(''); setReceivingOrder(order)
    setReceiptLocationId(order.stock_location_id || stockLocations.find((location) => location.is_default)?.id || '')
  }

  return (
    <div className="mx-auto max-w-7xl py-2">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4 rounded-[22px] border border-[#49303a] bg-[linear-gradient(135deg,#30212a,#56323b)] p-5 text-white shadow-[0_12px_28px_rgba(58,33,44,.18)]">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[.14em] text-white/60">Inventory control</p><h1 className="mt-1 text-2xl font-black">Purchasing desk</h1>
          <p className="mt-1 text-sm text-white/70">Suppliers, purchase orders and receiving—kept separate from live service stock.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tab === 'suppliers' ? (
            <button type="button" onClick={() => startSupplierForm()} className="flex items-center gap-1.5 rounded-xl bg-[#e8994e] px-3 py-2.5 text-sm font-extrabold text-[#2a1c23] shadow-md">
              <Plus size={14} /> Add supplier
            </button>
          ) : (
            <button type="button" disabled={!inventoryItems.length} title={!inventoryItems.length ? 'Add an inventory item in Stock Control first' : undefined} onClick={() => startPurchaseOrderForm()} className="flex items-center gap-1.5 rounded-xl bg-[#e8994e] px-3 py-2.5 text-sm font-extrabold text-[#2a1c23] shadow-md disabled:cursor-not-allowed disabled:opacity-50">
              <Plus size={14} /> New purchase order
            </button>
          )}
          <button type="button" onClick={() => { void loadData() }} disabled={loading} className="inline-flex items-center gap-1.5 rounded-xl border border-white/25 bg-white/10 px-3 py-2.5 text-sm font-extrabold text-white disabled:opacity-50"><RefreshCw className={loading ? 'animate-spin' : ''} size={14}/> {loading ? 'Refreshing…' : 'Reload purchasing data'}</button>
        </div>
      </div>

      {(notice || error) && <div role={error ? 'alert' : 'status'} className={`mb-5 flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold ${error ? 'border-[#efb7aa] bg-[#fff0ed] text-[#8b3027]' : 'border-[#a7d8bf] bg-[#eaf8f0] text-[#17613f]'}`}>{error ? <AlertTriangle className="mt-0.5 shrink-0" size={17}/> : <CheckCircle2 className="mt-0.5 shrink-0" size={17}/>}<span>{error || notice}</span></div>}
      {!loading && !inventoryItems.length && <div className="mb-5 flex items-start gap-2 rounded-2xl border border-[#efd09e] bg-[#fff3df] px-4 py-3 text-sm font-semibold text-[#794017]"><AlertTriangle className="mt-0.5 shrink-0" size={17}/><span>Add the ingredients and supplies you buy in Stock Control before creating a purchase order. This keeps receiving linked to the stock ledger.</span></div>}

      {/* Tab bar */}
      <div className="mb-5 flex w-fit gap-1 rounded-2xl border border-[#decfd0] bg-[#f5ece8] p-1.5">
        {['orders', 'suppliers'].map(t => (
          <button type="button" key={t} onClick={() => setTab(t)} className={`rounded-xl px-4 py-2.5 text-sm font-extrabold transition ${tab === t ? 'bg-[#35242c] text-white shadow-md' : 'text-[#7a626b] hover:bg-white'}`}>
            {t === 'orders' ? `Purchase Orders (${orders.length})` : `Suppliers (${suppliers.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      ) : tab === 'orders' ? (
        orders.length === 0 ? (
          <div className="rounded-[22px] border border-[#decfd0] bg-[#fffaf7] p-12 text-center shadow-[0_12px_28px_rgba(65,38,48,.08)]">
            <Truck size={40} className="mx-auto mb-3 text-[#c8784c]" /><p className="mb-2 text-lg font-black text-[#35242c]">No purchase orders</p><p className="text-sm text-[#806d73]">Create a draft, approve it, then receive only when goods physically arrive.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map(o => (
              <div key={o.id} className="rounded-2xl border border-[#decfd0] bg-[#fffaf7] p-5 shadow-[0_8px_18px_rgba(65,38,48,.06)]">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">Purchase order</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${statusBadge(o.status)}`}>{o.status}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {o.supplier?.name || o.supplier_name || 'No supplier'} {o.created_at ? `· ${new Date(o.created_at).toLocaleDateString()}` : ''}
                      {o.total ? ` · ${currency}${Number(o.total).toFixed(2)}` : ''}
                    </div>
                    <p className="mt-1 text-xs font-semibold text-[#6d565e]">Receive into: {o.stock_location_name || 'Shared business stock'}</p>
                    {o.items?.length > 0 && <p className="mt-2 text-xs font-semibold text-[#6d565e]">{o.items.slice(0, 2).map((item) => `${item.description} × ${item.quantity}`).join(' · ')}{o.items.length > 2 ? ` · +${o.items.length - 2} more` : ''}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setDetailOrder(o)} className="inline-flex items-center gap-1 rounded-lg border border-[#d9b59e] bg-white px-3 py-2 text-xs font-extrabold text-[#713f35]"><ClipboardList size={13} /> View details</button>
                    {o.status === 'draft' && (
                      <><button type="button" disabled={actionOrderId === o.id} onClick={() => startPurchaseOrderForm(o)} className="inline-flex items-center gap-1 rounded-lg border border-[#d9b59e] bg-white px-3 py-2 text-xs font-extrabold text-[#713f35] disabled:opacity-55"><Pencil size={13} /> Edit draft</button><button type="button" disabled={actionOrderId === o.id} onClick={() => approveOrder(o.id)} className="rounded-lg bg-[#e8994e] px-3 py-2 text-xs font-extrabold text-[#2a1c23] disabled:opacity-55">{actionOrderId === o.id ? 'Approving…' : 'Approve'}</button></>
                    )}
                    {o.status === 'approved' && (
                      <button type="button" disabled={actionOrderId === o.id} onClick={() => startReceipt(o)} className="rounded-lg bg-[#285f4b] px-3 py-2 text-xs font-extrabold text-white disabled:opacity-55">{actionOrderId === o.id ? 'Receiving…' : 'Receive goods'}</button>
                    )}
                    {o.status === 'received' && (
                      <button type="button" disabled={actionOrderId === o.id} onClick={() => startReceipt(o)} className="rounded-lg border border-[#9ccbb3] bg-[#eef8f2] px-3 py-2 text-xs font-extrabold text-[#17613f] disabled:opacity-55">{actionOrderId === o.id ? 'Checking…' : 'Verify receipt'}</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        suppliers.length === 0 ? (
          <div className="rounded-[22px] border border-[#decfd0] bg-[#fffaf7] p-12 text-center shadow-[0_12px_28px_rgba(65,38,48,.08)]"><p className="mb-2 text-lg font-black text-[#35242c]">No suppliers configured</p><p className="text-sm text-[#806d73]">Add suppliers before creating purchasing relationships or suggestions.</p>
          </div>
        ) : (
          <div className="divide-y overflow-hidden rounded-[22px] border border-[#decfd0] bg-[#fffaf7] shadow-[0_12px_28px_rgba(65,38,48,.08)]">
            {suppliers.map(s => (
              <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <div className="font-medium text-sm">{s.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {[s.contact_person, s.phone, s.email, s.payment_terms].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <button type="button" onClick={() => startSupplierForm(s)} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#d9b59e] bg-white px-2.5 py-1.5 text-xs font-extrabold text-[#713f35]"><Pencil size={13} /> Edit</button>
              </div>
            ))}
          </div>
        )
      )}

      {/* Supplier form modal */}
      {detailOrder && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-[#241920]/65 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailOrder(null) }}>
          <div role="dialog" aria-modal="true" aria-labelledby="purchase-order-details-title" className="w-full max-w-xl rounded-[24px] border border-white/20 bg-[#fffaf7] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-[#a06f5c]">Purchase order details</p><h2 id="purchase-order-details-title" className="mt-1 text-xl font-black text-[#35242c]">{detailOrder.supplier?.name || 'Supplier not recorded'}</h2><p className="mt-1 text-sm text-[#806d73]">{detailOrder.created_at ? new Date(detailOrder.created_at).toLocaleDateString() : 'Date unavailable'} · {detailOrder.status}</p><p className="mt-1 text-sm font-bold text-[#604a52]">Receiving location: {detailOrder.stock_location_name || 'Shared business stock'}</p></div>
              <button type="button" aria-label="Close purchase order details" onClick={() => setDetailOrder(null)} className="grid h-10 w-10 place-items-center rounded-xl border border-[#decfd0] bg-white text-[#6d565e] hover:border-[#d87945]"><X size={18} /></button>
            </div>
            <div className="mt-5 overflow-hidden rounded-xl border border-[#eadedb] bg-white">
              {detailOrder.items?.length ? detailOrder.items.map((item) => <div key={item.id} className="flex items-center justify-between gap-4 border-b border-[#f0e6e2] px-4 py-3 last:border-0"><div><p className="text-sm font-bold text-[#35242c]">{item.description}</p><p className="mt-0.5 text-xs text-[#806d73]">{item.quantity} {item.unit || 'units'} × {currency}{Number(item.unit_cost || 0).toFixed(2)}</p></div><span className="text-sm font-extrabold text-[#35242c]">{currency}{Number(item.total || item.quantity * item.unit_cost || 0).toFixed(2)}</span></div>) : <p className="px-4 py-5 text-sm text-[#806d73]">No stock lines were saved on this purchase order.</p>}
            </div>
            {detailOrder.notes && <p className="mt-4 rounded-xl bg-[#f5ece8] px-3 py-2 text-sm text-[#604a52]"><span className="font-extrabold">Notes: </span>{detailOrder.notes}</p>}
            <div className="mt-5 flex justify-between border-t border-[#eadedb] pt-4 text-base font-black text-[#35242c]"><span>Order total</span><span>{currency}{Number(detailOrder.total || 0).toFixed(2)}</span></div>
            <div className="mt-5 flex flex-wrap gap-2 border-t border-[#eadedb] pt-4">
              <button type="button" disabled={actionOrderId === `pdf:${detailOrder.id}`} onClick={() => savePurchaseOrderPdf(detailOrder.id)} className="inline-flex items-center gap-1.5 rounded-xl border border-[#d9b59e] bg-white px-3 py-2.5 text-sm font-extrabold text-[#713f35] disabled:opacity-50"><Download size={15}/>{actionOrderId === `pdf:${detailOrder.id}` ? 'Saving PDF…' : 'Download PDF'}</button>
              <button type="button" disabled={detailOrder.status !== 'approved' || !detailOrder.supplier?.email || actionOrderId === `email:${detailOrder.id}`} onClick={() => emailPurchaseOrder(detailOrder.id)} title={detailOrder.status !== 'approved' ? 'Approve the PO before sending it.' : !detailOrder.supplier?.email ? 'Add the supplier email in Purchasing first.' : undefined} className="inline-flex items-center gap-1.5 rounded-xl bg-[#e8994e] px-3 py-2.5 text-sm font-extrabold text-[#2a1c23] disabled:cursor-not-allowed disabled:opacity-50"><Mail size={15}/>{actionOrderId === `email:${detailOrder.id}` ? 'Sending…' : 'Email supplier'}</button>
              {(detailOrder.status !== 'approved' || !detailOrder.supplier?.email) && <p className="basis-full text-xs font-semibold text-[#806d73]">{detailOrder.status !== 'approved' ? 'Approve the PO before it can be emailed.' : 'Add the supplier email in Purchasing to send directly.'}</p>}
            </div>
          </div>
        </div>
      )}

      {receivingOrder && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-[#241920]/65 p-4" onMouseDown={(event) => { if (!saving && event.target === event.currentTarget) setReceivingOrder(null) }}>
          <div role="dialog" aria-modal="true" aria-labelledby="receipt-location-title" className="w-full max-w-md rounded-[24px] border border-white/20 bg-[#fffaf7] p-6 shadow-2xl">
            <p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-[#a06f5c]">Confirm physical receipt</p><h2 id="receipt-location-title" className="mt-1 text-xl font-black text-[#35242c]">Where did these goods arrive?</h2>
            <p className="mt-2 text-sm text-[#806d73]">This records the actual physical stock location for this approved purchase order. It is separate from the Till that will sell the goods.</p>
            <label className="mt-5 block text-sm font-bold text-[#5d464e]">Receiving stock location<select value={receiptLocationId} onChange={(event) => setReceiptLocationId(event.target.value)} className={FIELD}><option value="">Choose receiving location</option>{stockLocations.filter((location) => location.is_active !== false).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
            <div className="mt-6 flex gap-3"><button type="button" disabled={saving} onClick={() => setReceivingOrder(null)} className="flex-1 rounded-xl border border-[#d8c8c7] bg-white px-4 py-2.5 text-sm font-extrabold text-[#604a52]">Cancel</button><button type="button" disabled={saving || !receiptLocationId} onClick={() => receiveOrder(receivingOrder.id, receiptLocationId)} className="flex-1 rounded-xl bg-[#285f4b] px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-50">{saving ? 'Receiving…' : 'Confirm receipt'}</button></div>
          </div>
        </div>
      )}

      {showSupplierForm && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-[#241920]/65 p-4" onMouseDown={(event) => { if (!saving && event.target === event.currentTarget) setShowSupplierForm(false) }}>
          <div role="dialog" aria-modal="true" aria-labelledby="supplier-dialog-title" className="w-full max-w-md rounded-[24px] border border-white/20 bg-[#fffaf7] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div><p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-[#a06f5c]">Purchasing partner</p><h2 id="supplier-dialog-title" className="mt-1 text-xl font-black text-[#35242c]">{editingSupplier ? 'Edit supplier' : 'Add supplier'}</h2></div>
              <button type="button" disabled={saving} aria-label="Close supplier dialog" onClick={() => { setShowSupplierForm(false); setEditingSupplier(null) }} className="grid h-10 w-10 place-items-center rounded-xl border border-[#decfd0] bg-white text-[#6d565e] hover:border-[#d87945] disabled:opacity-50"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-bold text-[#5d464e]">Supplier name *</label>
                <input autoFocus value={supplierForm.name} onChange={e => setSupplierForm({ ...supplierForm, name: e.target.value })} className={FIELD} placeholder="Supplier name" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-bold text-[#5d464e]">Contact person</label>
                  <input value={supplierForm.contact_person} onChange={e => setSupplierForm({ ...supplierForm, contact_person: e.target.value })} className={FIELD} />
                </div>
                <div>
                  <label className="text-sm font-bold text-[#5d464e]">Phone</label>
                  <input type="tel" value={supplierForm.phone} onChange={e => setSupplierForm({ ...supplierForm, phone: e.target.value })} className={FIELD} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-bold text-[#5d464e]">Email</label>
                  <input type="email" value={supplierForm.email} onChange={e => setSupplierForm({ ...supplierForm, email: e.target.value })} className={FIELD} />
                </div>
                <div>
                  <label className="text-sm font-bold text-[#5d464e]">Payment terms</label>
                  <input value={supplierForm.payment_terms} onChange={e => setSupplierForm({ ...supplierForm, payment_terms: e.target.value })} className={FIELD} placeholder="Cash on delivery, 30 days…" />
                </div>
              </div>
              <div><label className="text-sm font-bold text-[#5d464e]">Address</label><input value={supplierForm.address} onChange={e => setSupplierForm({ ...supplierForm, address: e.target.value })} className={FIELD} placeholder="Delivery or trading address" /></div>
            </div>
            <div className="flex gap-3 mt-6">
              <button type="button" disabled={saving} onClick={() => { setShowSupplierForm(false); setEditingSupplier(null) }} className="flex-1 rounded-xl border border-[#d8c8c7] bg-white px-4 py-2.5 text-sm font-extrabold text-[#604a52] disabled:opacity-50">Cancel</button>
              <button type="button" onClick={saveSupplier} disabled={saving || !supplierForm.name.trim()} className="flex-1 rounded-xl bg-[#e8994e] px-4 py-2.5 text-sm font-extrabold text-[#291b21] disabled:opacity-50">{saving ? 'Saving…' : editingSupplier ? 'Save changes' : 'Save supplier'}</button>
            </div>
          </div>
        </div>
      )}

      {/* PO form modal */}
      {showPOForm && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-[#241920]/65 p-4" onMouseDown={(event) => { if (!saving && event.target === event.currentTarget) { setShowPOForm(false); setEditingOrder(null) } }}>
          <div role="dialog" aria-modal="true" aria-labelledby="purchase-order-dialog-title" className="max-h-[86vh] w-full max-w-2xl overflow-y-auto rounded-[24px] border border-white/20 bg-[#fffaf7] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div><p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-[#a06f5c]">Controlled purchasing</p><h2 id="purchase-order-dialog-title" className="mt-1 text-xl font-black text-[#35242c]">{editingOrder ? 'Edit draft purchase order' : 'New purchase order'}</h2></div>
              <button type="button" disabled={saving} aria-label="Close purchase order dialog" onClick={() => { setShowPOForm(false); setEditingOrder(null) }} className="grid h-10 w-10 place-items-center rounded-xl border border-[#decfd0] bg-white text-[#6d565e] hover:border-[#d87945] disabled:opacity-50"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-bold text-[#5d464e]">Supplier *</label>
                <select autoFocus value={poForm.supplier_id} onChange={e => setPoForm({ ...poForm, supplier_id: e.target.value })} className={FIELD}>
                  <option value="">Choose supplier</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-bold text-[#5d464e]">Receive goods into *</label>
                <select value={poForm.stock_location_id} onChange={e => setPoForm({ ...poForm, stock_location_id: e.target.value })} className={FIELD}>
                  <option value="">Choose physical stock location</option>
                  {stockLocations.map(location => <option key={location.id} value={location.id}>{location.name}{location.is_default ? ' (default shared stock)' : ''}</option>)}
                </select>
                <p className="mt-1 text-xs font-semibold text-[#806d73]">This is where the goods physically arrive. It is not the Till that will sell them.</p>
              </div>
              <div>
                <label className="text-sm font-bold text-[#5d464e]">Notes</label>
                <input value={poForm.notes} onChange={e => setPoForm({ ...poForm, notes: e.target.value })} className={FIELD} placeholder="Delivery instructions or internal reference" />
              </div>
              <div><label className="text-sm font-bold text-[#5d464e]">Expected delivery</label><input type="date" value={poForm.expected_delivery} onChange={e => setPoForm({ ...poForm, expected_delivery: e.target.value })} className={FIELD} /></div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-bold text-[#5d464e]">Line items</label>
                  <button type="button" onClick={() => setPoForm({ ...poForm, items: [...poForm.items, { inventory_item_id: '', description: '', quantity: '', unit_cost: '' }] })} className="inline-flex items-center gap-1 rounded-lg border border-[#d9b59e] bg-white px-2.5 py-1.5 text-xs font-extrabold text-[#713f35]"><Plus size={12} /> Add line</button>
                </div>
                <div className="space-y-2">
                  {poForm.items.map((item, i) => (
                    <div key={i} className="grid grid-cols-[minmax(12rem,1fr)_5.5rem_7rem_auto] items-end gap-2 rounded-xl border border-[#eadedb] bg-white/60 p-2">
                      <label className="text-[11px] font-bold text-[#806d73]">Inventory item<select value={item.inventory_item_id} onChange={e => { const stockItem = inventoryItems.find((row) => row.id === e.target.value); const updated = [...poForm.items]; updated[i] = { ...updated[i], inventory_item_id: e.target.value, description: stockItem?.name || '', unit_cost: updated[i].unit_cost || stockItem?.latest_unit_cost || stockItem?.unit_cost || '' }; setPoForm({ ...poForm, items: updated }) }} className={FIELD}><option value="">Choose stock item</option>{inventoryItems.map((stockItem) => <option key={stockItem.id} value={stockItem.id}>{stockItem.name} · {stockItem.unit || 'each'}</option>)}</select></label>
                      <label className="text-[11px] font-bold text-[#806d73]">Quantity<input min="0.01" step="0.01" value={item.quantity} onChange={e => { const updated = [...poForm.items]; updated[i] = { ...updated[i], quantity: e.target.value }; setPoForm({ ...poForm, items: updated }) }} type="number" className={FIELD} placeholder="Qty" /></label>
                      <label className="text-[11px] font-bold text-[#806d73]">Unit cost<input min="0" value={item.unit_cost} onChange={e => { const updated = [...poForm.items]; updated[i] = { ...updated[i], unit_cost: e.target.value }; setPoForm({ ...poForm, items: updated }) }} type="number" step="0.01" className={FIELD} placeholder={`${currency}0.00`} /></label>
                      <button type="button" disabled={poForm.items.length === 1} aria-label={`Remove line ${i + 1}`} onClick={() => setPoForm({ ...poForm, items: poForm.items.filter((_, index) => index !== i) })} className="grid h-10 w-10 place-items-center rounded-xl border border-[#e2c8c1] bg-white text-[#a34d3c] disabled:opacity-25"><Trash2 size={15}/></button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button type="button" disabled={saving} onClick={() => { setShowPOForm(false); setEditingOrder(null) }} className="flex-1 rounded-xl border border-[#d8c8c7] bg-white px-4 py-2.5 text-sm font-extrabold text-[#604a52] disabled:opacity-50">Cancel</button>
              <button type="button" onClick={savePO} disabled={saving || !poForm.supplier_id || !poForm.items.some(i => i.inventory_item_id && Number(i.quantity) > 0)} className="flex-1 rounded-xl bg-[#e8994e] px-4 py-2.5 text-sm font-extrabold text-[#291b21] disabled:opacity-50">{saving ? (editingOrder ? 'Saving…' : 'Creating…') : (editingOrder ? 'Save draft changes' : 'Create draft PO')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
