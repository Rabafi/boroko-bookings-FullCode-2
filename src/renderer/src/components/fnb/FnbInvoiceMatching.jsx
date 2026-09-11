import { useEffect, useMemo, useState } from 'react'

function newOperationId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `op-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function poLinesOf(po) {
  const raw = po?.items || po?.lines || po?.purchase_order_items || po?.order_items || []
  return Array.isArray(raw) ? raw : []
}
function lineItemId(line) {
  return line?.inventory_item_id || line?.item_id || line?.inventoryItemId || null
}
function lineName(line) {
  return line?.description || line?.item_name || line?.name || 'Item'
}
function lineQty(line) {
  return Number(line?.quantity ?? line?.qty ?? line?.ordered_qty ?? 0)
}
function lineCost(line) {
  return Number(line?.unit_cost ?? line?.price ?? line?.unitCost ?? 0)
}

/**
 * Supplier invoice three-way matching.
 * - The operator picks a lodge supplier and one of its purchase orders. The
 *   ordered quantities and prices shown are the purchase order's own records.
 * - The operator confirms what was received and what the supplier invoiced.
 *   Any quantity or price mismatch moves to manager variance approval.
 * - Handoff posts exactly one canonical expense for the invoiced total, so
 *   spend reporting reconciles with the invoice.
 */
export default function FnbInvoiceMatching({ outletId }) {
  const [suppliers, setSuppliers] = useState([])
  const [purchaseOrders, setPurchaseOrders] = useState([])
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [supplierId, setSupplierId] = useState('')
  const [purchaseOrderId, setPurchaseOrderId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [receivedByLine, setReceivedByLine] = useState({})
  const [invoicedByLine, setInvoicedByLine] = useState({})
  const [invoicedCostByLine, setInvoicedCostByLine] = useState({})
  const [noteByInvoice, setNoteByInvoice] = useState({})
  const [busy, setBusy] = useState(null)
  const [message, setMessage] = useState({ text: '', tone: 'info' })
  const say = (text, tone = 'info') => setMessage({ text, tone })

  const loadAll = async () => {
    setLoading(true)
    try {
      const [s, p, inv] = await Promise.all([
        window.api?.pos?.getSuppliers?.().catch(() => []),
        window.api?.pos?.getPurchaseOrders?.().catch(() => []),
        window.api?.fnb?.getSupplierInvoices?.().catch(() => null)
      ])
      const supplierRows = Array.isArray(s) ? s : (Array.isArray(s?.rows) ? s.rows : [])
      const poRows = Array.isArray(p) ? p : (Array.isArray(p?.orders) ? p.orders : [])
      setSuppliers(supplierRows)
      setPurchaseOrders(poRows)
      setInvoices(Array.isArray(inv?.invoices) ? inv.invoices : [])
      if (inv && inv.success === false) say(inv.error || 'Invoices are unavailable.', 'error')
    } catch (err) {
      say(err?.message || 'Could not load matching data.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const supplierPOs = useMemo(
    () => purchaseOrders.filter((po) => !supplierId || String(po.supplier_id || po.supplierId || '') === String(supplierId)),
    [purchaseOrders, supplierId]
  )
  const selectedPO = useMemo(
    () => purchaseOrders.find((po) => String(po.id) === String(purchaseOrderId)) || null,
    [purchaseOrders, purchaseOrderId]
  )
  const selectedLines = useMemo(() => (selectedPO ? poLinesOf(selectedPO) : []), [selectedPO])

  const capture = async (e) => {
    e?.preventDefault?.()
    setBusy('capture')
    try {
      if (!supplierId) throw new Error('Choose a supplier.')
      if (!purchaseOrderId) throw new Error('Choose the purchase order this invoice claims against.')
      if (!invoiceNumber.trim()) throw new Error('The supplier invoice number is required.')
      const lines = selectedLines.map((line) => ({
        inventory_item_id: lineItemId(line),
        received_qty: Number(receivedByLine[lineItemId(line)] ?? lineQty(line)),
        invoiced_qty: Number(invoicedByLine[lineItemId(line)] ?? lineQty(line)),
        invoiced_unit_cost: Number(invoicedCostByLine[lineItemId(line)] ?? lineCost(line))
      }))
      if (lines.length === 0) throw new Error('The selected purchase order has no lines to match.')
      const result = await window.api?.fnb?.captureSupplierInvoice?.(
        {
          supplier_id: supplierId,
          purchase_order_id: purchaseOrderId,
          invoice_number: invoiceNumber.trim(),
          invoice_date: invoiceDate || null,
          outlet_id: outletId || null,
          lines
        },
        newOperationId()
      )
      if (!result || result.success === false) throw new Error(result?.error || 'Could not capture the invoice.')
      if (result.offline) say('Saved offline. It will replay with the same key.', 'warn')
      else if (result.match_outcome === 'pending_approval') say('Captured. Ordered vs received vs invoiced differ — a manager must approve the variance below.', 'warn')
      else say('Captured with all three quantities and prices matching.', 'ok')
      setInvoiceNumber('')
      await loadAll()
    } catch (err) {
      say(err?.message || 'Could not capture the invoice.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const decide = async (invoice, approve) => {
    setBusy(invoice.id)
    try {
      const result = await window.api?.fnb?.approveInvoiceMatch?.(invoice.id, approve, (noteByInvoice[invoice.id] || '').trim() || null, newOperationId())
      if (!result || result.success === false) throw new Error(result?.error || 'Could not decide the invoice.')
      say(approve ? 'Variance approved with audit evidence.' : 'Invoice voided.', 'ok')
      await loadAll()
    } catch (err) {
      say(err?.message || 'Could not decide the invoice.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const handoff = async (invoice) => {
    setBusy(invoice.id)
    try {
      const result = await window.api?.fnb?.handoffInvoiceToAccounting?.(invoice.id, newOperationId())
      if (!result || result.success === false) throw new Error(result?.error || 'Could not hand off the invoice.')
      say(`Posted canonical expense${result.expense_id ? ` (${String(result.expense_id).slice(0, 8)}…)` : ''} for the invoiced total.`, 'ok')
      await loadAll()
    } catch (err) {
      say(err?.message || 'Could not hand off the invoice.', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-4">
      <form onSubmit={capture} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-bold text-slate-900">Match a supplier invoice</h2>
        <p className="mt-1 text-xs text-slate-500">Ordered figures are the purchase order&apos;s own records. Confirm received and invoiced figures per line.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="fnb-field grid gap-1 text-xs font-semibold text-slate-600">Supplier
            <select className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setPurchaseOrderId('') }}>
              <option value="">{loading ? 'Loading…' : 'Choose a supplier…'}</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name || 'Supplier'}</option>)}
            </select>
          </label>
          <label className="fnb-field grid gap-1 text-xs font-semibold text-slate-600">Purchase order
            <select className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={purchaseOrderId} onChange={(e) => setPurchaseOrderId(e.target.value)}>
              <option value="">{supplierId ? 'Choose a purchase order…' : 'Choose a supplier first'}</option>
              {supplierPOs.map((po) => <option key={po.id} value={po.id}>{po.order_number || po.po_number || String(po.id).slice(0, 8)} · {po.status || ''}</option>)}
            </select>
          </label>
          <label className="fnb-field grid gap-1 text-xs font-semibold text-slate-600">Supplier invoice no.
            <input className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} required />
          </label>
          <label className="fnb-field grid gap-1 text-xs font-semibold text-slate-600">Invoice date
            <input type="date" className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </label>
        </div>

        {selectedPO && (
          <table className="mt-3 w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-2 py-2 font-bold">Item (ordered · price)</th>
                <th className="px-2 py-2 font-bold">Received</th>
                <th className="px-2 py-2 font-bold">Invoiced qty</th>
                <th className="px-2 py-2 font-bold">Invoiced price</th>
              </tr>
            </thead>
            <tbody className="[&>tr]:border-t [&>tr]:border-slate-100">
              {selectedLines.map((line, i) => {
                const id = lineItemId(line)
                return (
                  <tr key={id || i}>
                    <td className="px-2 py-2 text-slate-700">{lineName(line)} <span className="text-xs text-slate-500">({lineQty(line)} · {lineCost(line).toFixed(2)})</span></td>
                    <td className="px-2 py-2"><input inputMode="decimal" aria-label={`Received quantity for ${lineName(line)}`} className="min-h-[40px] w-24 rounded-lg border border-slate-300 px-2 text-sm" value={receivedByLine[id] ?? lineQty(line)} onChange={(e) => setReceivedByLine((prev) => ({ ...prev, [id]: e.target.value }))} /></td>
                    <td className="px-2 py-2"><input inputMode="decimal" aria-label={`Invoiced quantity for ${lineName(line)}`} className="min-h-[40px] w-24 rounded-lg border border-slate-300 px-2 text-sm" value={invoicedByLine[id] ?? lineQty(line)} onChange={(e) => setInvoicedByLine((prev) => ({ ...prev, [id]: e.target.value }))} /></td>
                    <td className="px-2 py-2"><input inputMode="decimal" aria-label={`Invoiced price for ${lineName(line)}`} className="min-h-[40px] w-24 rounded-lg border border-slate-300 px-2 text-sm" value={invoicedCostByLine[id] ?? lineCost(line)} onChange={(e) => setInvoicedCostByLine((prev) => ({ ...prev, [id]: e.target.value }))} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        <div className="mt-4 flex justify-end border-t border-slate-100 pt-3">
          <button type="submit" disabled={busy === 'capture'} className="inline-flex min-h-[44px] items-center rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60">Capture &amp; match</button>
        </div>
      </form>

      <section aria-label="Invoices awaiting decision" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-bold text-slate-900">Invoices ({invoices.length})</h2>
          <button type="button" onClick={loadAll} disabled={loading} className="inline-flex min-h-[40px] items-center rounded-xl border border-slate-300 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">Refresh</button>
        </div>
        {invoices.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">No supplier invoices captured yet.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 font-bold">Status</th>
                <th className="px-4 py-2 font-bold">Invoice</th>
                <th className="px-4 py-2 font-bold">Lines (ord / rec / inv)</th>
                <th className="px-4 py-2 font-bold">Decision</th>
              </tr>
            </thead>
            <tbody className="[&>tr]:border-t [&>tr]:border-slate-100">
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="px-4 py-2"><span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">{invoice.status}</span></td>
                  <td className="px-4 py-2 text-slate-700"><p className="font-semibold">{invoice.supplier_name} · {invoice.invoice_number}</p><p className="text-xs text-slate-500">{invoice.invoice_date || ''}</p></td>
                  <td className="px-4 py-2 text-xs text-slate-600">
                    {(invoice.lines || []).map((l) => `${l.item_name}: ${l.ordered_qty}/${l.received_qty}/${l.invoiced_qty}`).join(' · ') || '—'}
                  </td>
                  <td className="px-4 py-2">
                    {['draft', 'pending_approval'].includes(invoice.status) ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <input aria-label={`Approval note for ${invoice.invoice_number}`} className="min-h-[40px] w-32 rounded-lg border border-slate-300 px-2 text-xs" placeholder="Note (required if varying)" value={noteByInvoice[invoice.id] || ''} onChange={(e) => setNoteByInvoice((prev) => ({ ...prev, [invoice.id]: e.target.value }))} />
                        <button type="button" disabled={busy === invoice.id} onClick={() => decide(invoice, true)} className="inline-flex min-h-[40px] items-center rounded-xl bg-emerald-700 px-3 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-60">Approve</button>
                        <button type="button" disabled={busy === invoice.id} onClick={() => decide(invoice, false)} className="inline-flex min-h-[40px] items-center rounded-xl border border-slate-300 px-3 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-60">Void</button>
                      </div>
                    ) : invoice.status === 'approved' ? (
                      <button type="button" disabled={busy === invoice.id} onClick={() => handoff(invoice)} className="inline-flex min-h-[40px] items-center rounded-xl bg-slate-900 px-3 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-60">Hand to accounting</button>
                    ) : (
                      <span className="text-xs text-slate-500">{invoice.status === 'handed_off' ? `Posted${invoice.expense_id ? ' to expenses' : ''}` : invoice.status}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {message.text && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-3 py-2 text-xs font-semibold ${message.tone === 'error' ? 'border-red-300 bg-red-50 text-red-900' : message.tone === 'warn' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-300 bg-emerald-50 text-emerald-900'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}
