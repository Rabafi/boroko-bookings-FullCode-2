import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarClock, CheckCircle2, PackageCheck, Pencil, RefreshCw, ShieldAlert, Trash2, X } from 'lucide-react'
import { useSettings } from '../../app-context'

const INPUT = 'mt-1 w-full rounded-xl border border-[#d7c9c8] bg-white px-3 py-2.5 text-sm text-[#35242c] outline-none focus:border-[#d87945] focus:ring-2 focus:ring-[#f4d2bb]'
const localDateKey = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }

export default function RestaurantInventoryLots() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const [items, setItems] = useState([])
  const [expiring, setExpiring] = useState([])
  const [lot, setLot] = useState({ inventory_item_id: '', lot_code: '', received_quantity: '', unit_cost: '', expires_on: '' })
  const [editingLot, setEditingLot] = useState(null)
  const [writingOffLot, setWritingOffLot] = useState(null)
  const [expiryForm, setExpiryForm] = useState({ expires_on: '', reason: '' })
  const [writeOffForm, setWriteOffForm] = useState({ quantity: '', reason: '', idempotency_key: '' })
  const [writeOffError, setWriteOffError] = useState('')
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState('info')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [horizon, setHorizon] = useState(14)

  const load = async ({ preserveMessage = false } = {}) => {
    setLoading(true); if (!preserveMessage) setMessage('')
    try {
      const [stock, expiry] = await Promise.all([window.api.inventory.getItems(), window.api.pos.getExpiryLots(horizon)])
      const stockItems = Array.isArray(stock) ? stock : []
      const itemNames = new Map(stockItems.map((item) => [item.id, item.name]))
      setItems(stockItems)
      setExpiring((Array.isArray(expiry) ? expiry : []).map((row) => ({
        ...row,
        inventory_item_name: row.inventory_item_name || row.item_name || itemNames.get(row.inventory_item_id) || 'Inventory item'
      })))
    } catch (error) { setMessageTone('error'); setMessage(error?.message || 'Lots and expiry could not be loaded.') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [horizon])

  const save = async (event) => {
    event.preventDefault(); setSaving(true); setMessage('')
    try {
      const result = await window.api.pos.recordInventoryLot(lot)
      if (!result?.success) throw new Error(result?.error || 'Could not register lot.')
      setLot({ inventory_item_id: '', lot_code: '', received_quantity: '', unit_cost: '', expires_on: '' })
      setMessageTone('success'); setMessage('Lot registered. Stock is unchanged; this records its batch and expiry traceability.')
      await load({ preserveMessage: true })
    } catch (error) { setMessageTone('error'); setMessage(error.message || 'Could not register lot.') }
    finally { setSaving(false) }
  }

  const openExpiryEdit = (row) => {
    setEditingLot(row); setExpiryForm({ expires_on: row.expires_on || '', reason: '' }); setMessage('')
  }
  const saveExpiryEdit = async (event) => {
    event.preventDefault(); setSaving(true); setMessage('')
    try {
      const result = await window.api.pos.updateInventoryLotExpiry(editingLot.id, expiryForm)
      if (!result?.success) throw new Error(result?.error || 'Could not correct the expiry date.')
      setEditingLot(null); setMessageTone('success'); setMessage(result?.unchanged ? 'Expiry date was already correct.' : 'Expiry date corrected and the reason was recorded for audit.')
      await load({ preserveMessage: true })
    } catch (error) { setMessageTone('error'); setMessage(error.message || 'Could not correct the expiry date.') }
    finally { setSaving(false) }
  }
  const openWriteOff = (row) => {
    setWritingOffLot(row); setWriteOffForm({ quantity: String(row.remaining_quantity ?? 0), reason: '', idempotency_key: crypto.randomUUID() }); setWriteOffError(''); setMessage('')
  }
  const saveWriteOff = async (event) => {
    event.preventDefault()
    const quantity = Number(writeOffForm.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) { setWriteOffError('Enter a physical expired quantity greater than zero.'); return }
    if (!writeOffForm.reason.trim()) { setWriteOffError('Enter the reason for this write-off before confirming it.'); return }
    setSaving(true); setWriteOffError(''); setMessage('')
    try {
      const result = await window.api.pos.writeOffExpiredInventoryLot(writingOffLot.id, writeOffForm)
      if (!result?.success) throw new Error(result?.error || 'Could not write off the expired lot.')
      setWritingOffLot(null); setMessageTone('success'); setMessage(result?.duplicate ? 'This expiry write-off was already recorded; stock was not changed again.' : `Expired lot written off. ${Number(result?.quantity_written_off || 0).toFixed(2)} was removed from stock and recorded in the movement ledger.`)
      await load({ preserveMessage: true })
    } catch (error) { const detail = error.message || 'Could not write off the expired lot.'; setWriteOffError(detail); setMessageTone('error'); setMessage(detail) }
    finally { setSaving(false) }
  }
  const today = localDateKey()
  const expiredCount = expiring.filter((row) => row.expires_on && row.expires_on < today).length
  const todayCount = expiring.filter((row) => row.expires_on === today).length

  return <div className="mx-auto max-w-7xl py-2">
    <section className="rounded-[22px] border border-[#49303a] bg-[linear-gradient(135deg,#30212a,#56323b)] p-5 text-white shadow-[0_12px_28px_rgba(58,33,44,.18)]"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[11px] font-extrabold uppercase tracking-[.14em] text-white/60">Inventory control</p><h1 className="mt-1 text-2xl font-black">Lots & expiry</h1><p className="mt-1 text-sm text-white/70">Track supplier batches and act on stock approaching expiry before it becomes waste.</p></div><button type="button" disabled={loading || saving} onClick={() => load()} className="inline-flex items-center gap-1.5 rounded-xl border border-white/25 bg-white/10 px-3 py-2.5 text-sm font-extrabold disabled:opacity-50"><RefreshCw className={loading ? 'animate-spin' : ''} size={14}/> {loading ? 'Refreshing…' : 'Refresh'}</button></div></section>
    {message && <div role={messageTone === 'error' ? 'alert' : 'status'} className={`mt-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm font-semibold ${messageTone === 'error' ? 'border-[#efb7aa] bg-[#fff0ed] text-[#8b3027]' : 'border-[#a7d8bf] bg-[#eaf8f0] text-[#17613f]'}`}>{messageTone === 'error' ? <AlertTriangle className="mt-0.5 shrink-0" size={17}/> : <CheckCircle2 className="mt-0.5 shrink-0" size={17}/>}<span>{message}</span></div>}
    {(expiredCount || todayCount) > 0 && <div className={`mt-4 flex items-start gap-3 rounded-2xl border p-4 ${expiredCount ? 'border-[#efb7aa] bg-[#fff0ed] text-[#8b3027]' : 'border-[#efd09e] bg-[#fff3df] text-[#794017]'}`}><ShieldAlert className="mt-0.5 shrink-0" size={20}/><div><strong>{expiredCount ? `${expiredCount} expired lot${expiredCount === 1 ? '' : 's'} need action.` : `${todayCount} lot${todayCount === 1 ? '' : 's'} expire today.`}</strong><p className="mt-1 text-sm">{expiredCount ? 'Confirm the physical spoiled quantity and write off each expired lot. This records the loss and reduces stock.' : 'Review and use or quarantine these batches today. They become eligible for an expired-lot write-off tomorrow.'}</p></div></div>}
    <div className="mt-5 grid gap-5 xl:grid-cols-[1.05fr_.95fr]">
      <section className="rounded-[22px] border border-[#decfd0] bg-[#fffaf7] p-5 shadow-[0_12px_28px_rgba(65,38,48,.08)]"><div className="flex items-center gap-3"><PackageCheck className="text-[#c8784c]"/><div><h2 className="font-black text-[#35242c]">Register a received lot</h2><p className="text-sm text-[#806d73]">Use the actual supplier batch code and expiry printed on the delivered product.</p></div></div><form onSubmit={save} className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold text-[#5d464e] sm:col-span-2">Inventory item<select required className={INPUT} value={lot.inventory_item_id} onChange={(event) => setLot({ ...lot, inventory_item_id: event.target.value })}><option value="">Choose stock item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.unit || 'each'}</option>)}</select></label><label className="text-sm font-bold text-[#5d464e]">Supplier lot / batch code<input required className={INPUT} value={lot.lot_code} onChange={(event) => setLot({ ...lot, lot_code: event.target.value })}/></label><label className="text-sm font-bold text-[#5d464e]">Received quantity<input required min="0.01" step="0.01" type="number" className={INPUT} value={lot.received_quantity} onChange={(event) => setLot({ ...lot, received_quantity: event.target.value })}/></label><label className="text-sm font-bold text-[#5d464e]">Unit cost ({currency})<input min="0" step="0.01" type="number" className={INPUT} value={lot.unit_cost} onChange={(event) => setLot({ ...lot, unit_cost: event.target.value })}/></label><label className="text-sm font-bold text-[#5d464e]">Expiry date<input type="date" className={INPUT} value={lot.expires_on} onChange={(event) => setLot({ ...lot, expires_on: event.target.value })}/></label><button disabled={saving || loading} className="sm:col-span-2 rounded-xl bg-[#e8994e] px-4 py-3 text-sm font-extrabold text-[#2a1c23] disabled:opacity-60">{saving ? 'Registering…' : 'Register lot'}</button></form></section>
      <section className="overflow-hidden rounded-[22px] border border-[#decfd0] bg-[#fffaf7] shadow-[0_12px_28px_rgba(65,38,48,.08)]"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eadedb] bg-[#f6eee9] p-5"><div className="flex items-center gap-3"><CalendarClock className="text-[#c8784c]"/><div><h2 className="font-black text-[#35242c]">Expiry watch</h2><p className="text-sm text-[#806d73]">Lots expiring in the next {horizon} days.</p></div></div><select aria-label="Expiry horizon" value={horizon} onChange={(event) => setHorizon(Number(event.target.value))} className="rounded-xl border border-[#d7c9c8] bg-white px-3 py-2 text-sm font-extrabold text-[#5d464e]">{[7, 14, 30, 60].map((days) => <option key={days} value={days}>{days} days</option>)}</select></div><div className="divide-y divide-[#ecdfdc]">{loading ? <div className="p-12 text-center text-sm font-semibold text-[#806d73]">Checking expiry dates…</div> : expiring.map((row) => { const expired = row.expires_on && row.expires_on < today; const expiresToday = row.expires_on === today; return <div key={row.id} className={`flex items-center justify-between gap-3 p-4 ${expired ? 'bg-[#fff4f1]' : expiresToday ? 'bg-[#fff9eb]' : ''}`}><div><div className="flex flex-wrap items-center gap-2"><strong className="block text-sm text-[#35242c]">{row.inventory_item_name || row.item_name || 'Inventory item'}</strong>{expired && <span className="rounded-full bg-[#f8ddd7] px-2 py-0.5 text-[10px] font-extrabold uppercase text-[#9b352a]">Expired</span>}{expiresToday && <span className="rounded-full bg-[#fff0c9] px-2 py-0.5 text-[10px] font-extrabold uppercase text-[#8d5a09]">Expires today</span>}</div><small className="mt-1 block text-xs text-[#806d73]">Lot {row.lot_code || '—'} · expires {row.expires_on ? new Date(`${row.expires_on}T00:00:00`).toLocaleDateString() : 'date not set'} · {row.remaining_quantity ?? row.received_quantity ?? 0} remaining</small></div><div className="flex shrink-0 flex-wrap justify-end gap-2"><button type="button" onClick={() => openExpiryEdit(row)} className="inline-flex items-center gap-1 rounded-lg border border-[#d9b59e] bg-white px-2.5 py-1.5 text-xs font-extrabold text-[#713f35]"><Pencil size={13}/> Correct expiry</button>{expired && <button type="button" onClick={() => openWriteOff(row)} className="inline-flex items-center gap-1 rounded-lg bg-[#b94d3d] px-2.5 py-1.5 text-xs font-extrabold text-white"><Trash2 size={13}/> Write off</button>}</div></div>})}{!loading && !expiring.length && <div className="p-12 text-center text-sm text-[#806d73]">No lots are due to expire in the next {horizon} days.</div>}</div></section>
    </div>
    {editingLot && <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-[#241920]/65 p-4" onMouseDown={(event) => { if (!saving && event.target === event.currentTarget) setEditingLot(null) }}><form onSubmit={saveExpiryEdit} role="dialog" aria-modal="true" aria-labelledby="expiry-correction-title" className="w-full max-w-md rounded-[24px] border border-white/20 bg-[#fffaf7] p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-[#a06f5c]">Audited correction</p><h2 id="expiry-correction-title" className="mt-1 text-xl font-black text-[#35242c]">Correct expiry date</h2><p className="mt-1 text-sm text-[#806d73]">{editingLot.inventory_item_name || editingLot.item_name || 'Inventory item'} · lot {editingLot.lot_code}</p></div><button type="button" disabled={saving} aria-label="Close expiry correction" onClick={() => setEditingLot(null)} className="grid h-10 w-10 place-items-center rounded-xl border border-[#decfd0] bg-white text-[#6d565e] disabled:opacity-50"><X size={18}/></button></div><label className="mt-5 block text-sm font-bold text-[#5d464e]">Correct expiry date<input required type="date" value={expiryForm.expires_on} onChange={(event) => setExpiryForm({ ...expiryForm, expires_on: event.target.value })} className={INPUT}/></label><label className="mt-4 block text-sm font-bold text-[#5d464e]">Reason for correction<textarea required value={expiryForm.reason} onChange={(event) => setExpiryForm({ ...expiryForm, reason: event.target.value })} className={`${INPUT} min-h-24 resize-y`} placeholder="For example: supplier label was read incorrectly on receipt"/></label><p className="mt-3 text-xs font-semibold text-[#806d73]">This changes only the expiry record. It never changes on-hand stock, and the old/new dates plus reason are kept in the audit trail.</p><div className="mt-6 flex gap-3"><button type="button" disabled={saving} onClick={() => setEditingLot(null)} className="flex-1 rounded-xl border border-[#d8c8c7] bg-white px-4 py-2.5 text-sm font-extrabold text-[#604a52] disabled:opacity-50">Cancel</button><button disabled={saving} className="flex-1 rounded-xl bg-[#e8994e] px-4 py-2.5 text-sm font-extrabold text-[#291b21] disabled:opacity-50">{saving ? 'Saving…' : 'Save correction'}</button></div></form></div>}
    {writingOffLot && <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-[#241920]/65 p-4" onMouseDown={(event) => { if (!saving && event.target === event.currentTarget) setWritingOffLot(null) }}><form onSubmit={saveWriteOff} role="dialog" aria-modal="true" aria-labelledby="expired-writeoff-title" className="w-full max-w-md rounded-[24px] border border-white/20 bg-[#fffaf7] p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-[#a34d3c]">Irreversible stock action</p><h2 id="expired-writeoff-title" className="mt-1 text-xl font-black text-[#35242c]">Write off expired lot</h2><p className="mt-1 text-sm text-[#806d73]">{writingOffLot.inventory_item_name || writingOffLot.item_name || 'Inventory item'} · lot {writingOffLot.lot_code}</p></div><button type="button" disabled={saving} aria-label="Close expired lot write-off" onClick={() => setWritingOffLot(null)} className="grid h-10 w-10 place-items-center rounded-xl border border-[#decfd0] bg-white text-[#6d565e] disabled:opacity-50"><X size={18}/></button></div><div className="mt-4 rounded-xl border border-[#efb7aa] bg-[#fff0ed] p-3 text-sm text-[#8b3027]"><strong>Recorded lot remaining: {writingOffLot.remaining_quantity ?? 0}</strong><p className="mt-1">Confirm the physical expired quantity. This reduces on-hand stock and creates a movement ledger entry.</p></div>{writeOffError && <div role="alert" className="mt-4 rounded-xl border border-[#efb7aa] bg-[#fff0ed] px-3 py-2.5 text-sm font-semibold text-[#8b3027]">{writeOffError}</div>}<label className="mt-4 block text-sm font-bold text-[#5d464e]">Physical expired quantity<input min="0.01" max={writingOffLot.remaining_quantity ?? undefined} step="0.01" type="number" value={writeOffForm.quantity} onChange={(event) => { setWriteOffForm({ ...writeOffForm, quantity: event.target.value }); setWriteOffError('') }} className={INPUT}/></label><label className="mt-4 block text-sm font-bold text-[#5d464e]">Write-off reason<textarea value={writeOffForm.reason} onChange={(event) => { setWriteOffForm({ ...writeOffForm, reason: event.target.value }); setWriteOffError('') }} className={`${INPUT} min-h-24 resize-y`} placeholder="For example: expired during morning stock check"/></label><div className="mt-6 flex gap-3"><button type="button" disabled={saving} onClick={() => setWritingOffLot(null)} className="flex-1 rounded-xl border border-[#d8c8c7] bg-white px-4 py-2.5 text-sm font-extrabold text-[#604a52] disabled:opacity-50">Cancel</button><button disabled={saving} className="flex-1 rounded-xl bg-[#b94d3d] px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-50">{saving ? 'Writing off…' : 'Confirm write-off'}</button></div></form></div>}
  </div>
}
