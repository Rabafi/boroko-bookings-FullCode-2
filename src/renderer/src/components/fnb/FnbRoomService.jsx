import { useEffect, useMemo, useState } from 'react'

const NEXT = { new: 'preparing', preparing: 'ready', ready: 'dispatched', dispatched: 'delivered' }

function newOperationId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `op-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function bookingLabel(b) {
  const guest = b.customer_name || b.guest_name || b.customer || 'Guest'
  const room = b.room_number || b.room_label || (b.room_id ? `room ${String(b.room_id).slice(0, 8)}` : 'no room')
  return `${guest} · ${room} · ${b.status || ''}`.trim()
}

/**
 * Room-service fulfilment over the canonical POS contract.
 * - New orders pick an active booking (or room), outlet items from the POS
 *   menu, and quantities. Prices come from the server; the client never sends
 *   a price. Creation writes the canonical POS order + kitchen ticket, so the
 *   kitchen, Legacy POS, and reporting see the same order.
 * - The delivery queue lists open orders with per-row advance, runner
 *   assignment, and cancel-with-reason. Delivery posts the folio charge
 *   server-side from the POS total; orders without a booking collect payment
 *   through the POS order itself.
 */
export default function FnbRoomService({ outletId }) {
  const [bookings, setBookings] = useState([])
  const [rooms, setRooms] = useState([])
  const [menu, setMenu] = useState([])
  const [queue, setQueue] = useState([])
  const [loading, setLoading] = useState(true)
  const [bookingId, setBookingId] = useState('')
  const [roomId, setRoomId] = useState('')
  const [roomLabel, setRoomLabel] = useState('')
  const [lines, setLines] = useState([{ menu_item_id: '', quantity: 1 }])
  const [notes, setNotes] = useState('')
  const [runnerByOrder, setRunnerByOrder] = useState({})
  const [cancelReasonByOrder, setCancelReasonByOrder] = useState({})
  const [busy, setBusy] = useState(null)
  const [message, setMessage] = useState({ text: '', tone: 'info' })
  const say = (text, tone = 'info') => setMessage({ text, tone })

  const loadAll = async () => {
    setLoading(true)
    try {
      const [b, r, m, q] = await Promise.all([
        window.api?.bookings?.getAll?.().catch(() => []),
        window.api?.rooms?.getAll?.().catch(() => []),
        window.api?.pos?.getMenuItems?.().catch(() => []),
        window.api?.fnb?.getRoomServiceQueue?.(outletId || null, false).catch(() => null)
      ])
      setBookings(Array.isArray(b) ? b : [])
      setRooms(Array.isArray(r) ? r : [])
      setMenu(Array.isArray(m) ? m : [])
      setQueue(Array.isArray(q?.orders) ? q.orders : [])
      if (q && q.success === false) say(q.error || 'Queue is unavailable.', 'error')
    } catch (e) {
      say(e?.message || 'Could not load room service data.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outletId])

  const activeBookings = useMemo(
    () => bookings.filter((b) => ['confirmed', 'checked_in'].includes(String(b.status || '').toLowerCase())),
    [bookings]
  )
  const outletMenu = useMemo(() => {
    const rows = Array.isArray(menu) ? menu : []
    return rows.filter((item) => {
      if (item.is_available === false) return false
      if (outletId && item.outlet_id && String(item.outlet_id) !== String(outletId)) return false
      return true
    })
  }, [menu, outletId])
  const menuById = useMemo(() => new Map(outletMenu.map((m) => [String(m.id), m])), [outletMenu])
  const orderTotal = lines.reduce((sum, line) => {
    const item = menuById.get(String(line.menu_item_id))
    return sum + Number(item?.price || 0) * (Number(line.quantity) || 0)
  }, 0)

  const setLine = (index, patch) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))

  const create = async (e) => {
    e?.preventDefault?.()
    setBusy('create')
    try {
      const items = lines
        .filter((l) => l.menu_item_id)
        .map((l) => ({ menu_item_id: l.menu_item_id, quantity: Math.max(1, Math.min(20, Number(l.quantity) || 1)) }))
      if (items.length === 0) throw new Error('Choose at least one menu item.')
      const result = await window.api?.fnb?.createRoomServiceOrder?.(
        {
          booking_id: bookingId || null,
          room_id: roomId || null,
          room_label: roomLabel.trim() || null,
          customer_name: null,
          items,
          notes: notes.trim() || null,
          station: 'kitchen',
          outlet_id: outletId || null
        },
        newOperationId()
      )
      if (!result || result.success === false) throw new Error(result?.error || 'Could not create the order.')
      say(result.offline
        ? 'Saved offline. It will create the canonical POS order with the same key when you reconnect.'
        : `Order created: POS total ${Number(result.pos_order?.total ?? 0).toFixed(2)}. The kitchen queue has the ticket.`, result.offline ? 'warn' : 'ok')
      setBookingId('')
      setRoomId('')
      setRoomLabel('')
      setLines([{ menu_item_id: '', quantity: 1 }])
      setNotes('')
      await loadAll()
    } catch (err) {
      say(err?.message || 'Could not create the order.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const advance = async (order, to) => {
    setBusy(order.id)
    try {
      const payload = {}
      if (to === 'dispatched') {
        const runner = String(runnerByOrder[order.id] || '').trim()
        if (!runner && !order.runner_name) throw new Error('Enter the runner name before dispatch.')
        if (runner) payload.runner_name = runner
      }
      if (to === 'cancelled') {
        const reason = String(cancelReasonByOrder[order.id] || '').trim()
        if (!reason) throw new Error('A cancellation reason is required.')
        payload.cancel_reason = reason
      }
      const result = await window.api?.fnb?.updateRoomServiceStatus?.(order.id, to, payload, newOperationId())
      if (!result || result.success === false) throw new Error(result?.error || 'Could not move the order.')
      say(to === 'delivered' && result.folio_note ? result.folio_note : `Order is now ${result.order?.status || to}.`, 'ok')
      await loadAll()
    } catch (err) {
      say(err?.message || 'Could not move the order.', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-4">
      <form onSubmit={create} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-bold text-slate-900">New room-service order</h2>
        <p className="mt-1 text-xs text-slate-500">
          Creates a canonical POS order (server prices) plus its kitchen ticket. Totals are computed from the menu, never typed.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="fnb-field grid gap-1 text-xs font-semibold text-slate-600">Booking (active stays)
            <select className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={bookingId} onChange={(e) => setBookingId(e.target.value)}>
              <option value="">No booking (walk-in / label only)</option>
              {activeBookings.map((b) => <option key={b.id} value={b.id}>{bookingLabel(b)}</option>)}
            </select>
            <span className="font-normal text-slate-500">Folio posting needs an active booking.</span>
          </label>
          <label className="fnb-field grid gap-1 text-xs font-semibold text-slate-600">Room
            <select className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">No room selected</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.room_number || r.name || String(r.id).slice(0, 8)}</option>)}
            </select>
          </label>
        </div>
        <label className="fnb-field mt-3 grid gap-1 text-xs font-semibold text-slate-600">Room label (if no room selected)
          <input className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={roomLabel} onChange={(e) => setRoomLabel(e.target.value)} placeholder="e.g. Villa 4 deck" />
        </label>
        <div className="mt-3 grid gap-2">
          {lines.map((line, i) => (
            <div key={i} className="grid grid-cols-[1fr_90px_40px] items-end gap-2">
              <label className="fnb-field grid gap-1 text-xs font-semibold text-slate-600">Item {i + 1}
                <select className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={line.menu_item_id} onChange={(e) => setLine(i, { menu_item_id: e.target.value })}>
                  <option value="">Choose from the menu…</option>
                  {outletMenu.map((m) => <option key={m.id} value={m.id}>{m.name} · {Number(m.price || 0).toFixed(2)}</option>)}
                </select>
              </label>
              <label className="fnb-field grid gap-1 text-xs font-semibold text-slate-600">Qty
                <input inputMode="numeric" className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={line.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
              </label>
              <button type="button" aria-label={`Remove item ${i + 1}`} onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))} disabled={lines.length <= 1} className="mb-0.5 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-300 text-slate-500 hover:bg-slate-50 disabled:opacity-40">×</button>
            </div>
          ))}
          <button type="button" onClick={() => setLines((prev) => [...prev, { menu_item_id: '', quantity: 1 }])} className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-dashed border-slate-300 text-xs font-bold text-slate-600 hover:bg-slate-50">+ Add item</button>
        </div>
        <label className="fnb-field mt-3 grid gap-1 text-xs font-semibold text-slate-600">Kitchen notes
          <input className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Allergies, timing…" />
        </label>
        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
          <p className="text-sm font-bold text-slate-900">Estimated total: <span className="tabular-nums">{orderTotal.toFixed(2)}</span> <span className="text-[11px] font-normal text-slate-500">(server confirms)</span></p>
          <button type="submit" disabled={busy === 'create' || loading} className="inline-flex min-h-[44px] items-center rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60">
            {busy === 'create' ? 'Sending…' : 'Send to kitchen'}
          </button>
        </div>
      </form>

      <section aria-label="Delivery queue" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-bold text-slate-900">Delivery queue ({queue.length})</h2>
          <button type="button" onClick={loadAll} disabled={loading} className="inline-flex min-h-[40px] items-center rounded-xl border border-slate-300 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">Refresh</button>
        </div>
        {loading && queue.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">Loading the queue…</p>
        ) : queue.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">No open room-service orders{outletId ? ' for this outlet' : ''}.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 font-bold">Status</th>
                <th className="px-4 py-2 font-bold">Destination</th>
                <th className="px-4 py-2 font-bold">Items</th>
                <th className="px-4 py-2 text-right font-bold">Total</th>
                <th className="px-4 py-2 font-bold">Next step</th>
              </tr>
            </thead>
            <tbody className="[&>tr]:border-t [&>tr]:border-slate-100">
              {queue.map((order) => {
                const next = NEXT[order.status]
                const items = Array.isArray(order.items) ? order.items : []
                return (
                  <tr key={order.id}>
                    <td className="px-4 py-2"><span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">{order.status}</span></td>
                    <td className="px-4 py-2 text-slate-700">{order.room_label || order.customer_name || '—'}</td>
                    <td className="px-4 py-2 text-xs text-slate-600">{items.map((it) => `${it.quantity || 1}× ${it.item_name || it.name || 'item'}`).join(', ') || '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-900">{Number(order.pos_total ?? 0).toFixed(2)}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {next && (
                          <>
                            {next === 'dispatched' && (
                              <input aria-label={`Runner for order to ${order.room_label || ''}`} className="min-h-[40px] w-28 rounded-lg border border-slate-300 px-2 text-xs" placeholder="Runner" value={runnerByOrder[order.id] || order.runner_name || ''} onChange={(e) => setRunnerByOrder((prev) => ({ ...prev, [order.id]: e.target.value }))} />
                            )}
                            <button type="button" disabled={busy === order.id} onClick={() => advance(order, next)} className="inline-flex min-h-[40px] items-center rounded-xl bg-slate-900 px-3 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-60">
                              {busy === order.id ? '…' : `→ ${next}`}
                            </button>
                          </>
                        )}
                        {!['delivered', 'cancelled'].includes(order.status) && (
                          <details className="text-xs">
                            <summary className="cursor-pointer font-semibold text-red-700">Cancel</summary>
                            <div className="mt-1 flex gap-1">
                              <input aria-label="Cancellation reason" className="min-h-[40px] w-32 rounded-lg border border-slate-300 px-2 text-xs" placeholder="Reason (required)" value={cancelReasonByOrder[order.id] || ''} onChange={(e) => setCancelReasonByOrder((prev) => ({ ...prev, [order.id]: e.target.value }))} />
                              <button type="button" disabled={busy === order.id} onClick={() => advance(order, 'cancelled')} className="inline-flex min-h-[40px] items-center rounded-xl bg-red-700 px-3 text-xs font-bold text-white hover:bg-red-800 disabled:opacity-60">Confirm</button>
                            </div>
                          </details>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      {message.text && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-3 py-2 text-xs font-semibold ${message.tone === 'error' ? 'border-red-300 bg-red-50 text-red-900' : message.tone === 'warn' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-300 bg-emerald-50 text-emerald-900'}`}>
          {message.text}
        </p>
      )}
      <p className="text-[11px] leading-4 text-slate-500">
        Offline creates replay with the same key and create the same POS order once. Status moves stay online-only.
        Cancelling needs void permission. Delivery posts the folio charge from the POS total — the total is never typed.
      </p>
    </div>
  )
}
