import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Clock, Monitor, RefreshCw, Utensils } from 'lucide-react'
import { useSettings } from '../app-context'

const DISPLAY_REFRESH_MS = 2500
const currencyFallback = 'P'

const fmt = (value) => Number(value || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function formatElapsed(value, now = Date.now()) {
  const started = new Date(value || now).getTime()
  if (!Number.isFinite(started)) return '0m'
  const minutes = Math.max(0, Math.floor((now - started) / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function statusTone(status) {
  if (status === 'ready') return 'border-emerald-400 bg-emerald-500 text-white'
  if (status === 'preparing') return 'border-blue-400 bg-blue-500 text-white'
  return 'border-amber-400 bg-amber-400 text-slate-950'
}

function filterActiveTickets(tickets = []) {
  return tickets.filter((ticket) => !['served', 'cancelled'].includes(String(ticket.status || '').toLowerCase()))
}

function DisplayShell({ title, subtitle, children, right }) {
  const { settings } = useSettings()
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="flex min-h-screen flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-slate-900 px-8 py-5">
          <div className="min-w-0">
            <p className="text-sm font-bold uppercase tracking-[0.22em] text-emerald-300">{settings?.lodge_name || settings?.company_name || 'Boroko Bookings'}</p>
            <h1 className="mt-1 truncate text-4xl font-bold">{title}</h1>
            {subtitle ? <p className="mt-1 text-base text-slate-300">{subtitle}</p> : null}
          </div>
          <div className="shrink-0">{right}</div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  )
}

export function CustomerDisplay() {
  const { settings } = useSettings()
  const currency = settings?.currency || currencyFallback
  const [display, setDisplay] = useState(null)
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())

  const load = useCallback(async () => {
    try {
      const row = await window.api?.pos?.getCustomerDisplay?.()
      setDisplay(row || null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = window.setInterval(load, DISPLAY_REFRESH_MS)
    const clock = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      window.clearInterval(interval)
      window.clearInterval(clock)
    }
  }, [load])

  const items = Array.isArray(display?.items) ? display.items : []
  const hasOrder = items.length > 0

  return (
    <DisplayShell
      title="Customer Display"
      subtitle={hasOrder ? (display?.table_name ? `Table ${display.table_name}` : 'Current order') : 'Ready for the next guest'}
      right={<div className="text-right text-sm text-slate-300">{new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>}
    >
      {loading ? (
        <div className="flex min-h-[70vh] items-center justify-center text-slate-300">
          <RefreshCw className="mr-3 animate-spin" /> Loading display
        </div>
      ) : hasOrder ? (
        <div className="grid min-h-[70vh] gap-6 lg:grid-cols-[1fr_26rem]">
          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-2xl font-bold">Your Order</h2>
              {display?.staff_name ? <span className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200">Served by {display.staff_name}</span> : null}
            </div>
            <div className="space-y-3">
              {items.map((item, index) => (
                <div key={`${item.item_name}-${index}`} className="rounded-2xl border border-white/10 bg-slate-900/80 p-5">
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      <p className="truncate text-2xl font-bold">{item.item_name}</p>
                      {(item.modifiers?.length > 0 || item.item_notes) ? (
                        <p className="mt-2 text-base font-semibold text-amber-200">
                          {[...(item.modifiers || []).map((mod) => mod.name), item.item_notes].filter(Boolean).join(' - ')}
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xl font-bold">x{Number(item.quantity || 0)}</p>
                      <p className="mt-1 text-lg text-slate-300">{currency} {fmt(Number(item.quantity || 0) * Number(item.unit_price || 0))}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <aside className="flex flex-col justify-end rounded-3xl border border-emerald-400/30 bg-emerald-500/10 p-6">
            <div className="space-y-4 text-xl">
              <div className="flex justify-between text-slate-200"><span>Subtotal</span><strong>{currency} {fmt(display?.subtotal)}</strong></div>
              {Number(display?.discount_total || 0) > 0 ? <div className="flex justify-between text-amber-200"><span>Discount</span><strong>-{currency} {fmt(display.discount_total)}</strong></div> : null}
              {Number(display?.tax_total || 0) > 0 ? <div className="flex justify-between text-slate-200"><span>Tax</span><strong>{currency} {fmt(display.tax_total)}</strong></div> : null}
              {Number(display?.tip_total || 0) > 0 ? <div className="flex justify-between text-slate-200"><span>Tip</span><strong>{currency} {fmt(display.tip_total)}</strong></div> : null}
            </div>
            <div className="mt-8 border-t border-white/10 pt-6">
              <p className="text-lg font-bold uppercase tracking-[0.18em] text-emerald-200">Total Due</p>
              <p className="mt-2 text-6xl font-black">{currency} {fmt(display?.total)}</p>
            </div>
          </aside>
        </div>
      ) : (
        <div className="flex min-h-[70vh] flex-col items-center justify-center rounded-3xl border border-white/10 bg-white/[0.03] text-center">
          <Monitor size={58} className="text-emerald-300" />
          <h2 className="mt-5 text-4xl font-bold">Welcome</h2>
          <p className="mt-3 max-w-xl text-xl text-slate-300">Your order will appear here as items are added at the POS.</p>
        </div>
      )}
    </DisplayShell>
  )
}

function TicketCard({ ticket, now, onStatus }) {
  const status = String(ticket.status || 'new').toLowerCase()
  return (
    <article className={`flex min-h-[22rem] flex-col rounded-3xl border-2 p-5 shadow-2xl ${statusTone(status)}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-3xl font-black">{ticket.table_name || ticket.tab_name || (ticket.room_id ? 'Room order' : 'POS order')}</p>
          <p className="mt-2 flex items-center gap-2 text-base font-bold opacity-80">
            <Clock size={18} /> {formatElapsed(ticket.created_at, now)}
          </p>
        </div>
        <span className="rounded-full bg-black/20 px-4 py-2 text-sm font-black uppercase tracking-[0.16em]">{status}</span>
      </div>
      {ticket.waiter_name ? <p className="mt-3 text-base font-bold opacity-80">Served by {ticket.waiter_name}</p> : null}
      <div className="mt-5 flex-1 space-y-3">
        {(ticket.items || []).map((item, index) => (
          <div key={`${item.item_name}-${index}`} className="rounded-2xl bg-black/18 px-4 py-3">
            <div className="flex justify-between gap-4">
              <span className="text-2xl font-black">{item.item_name}</span>
              <span className="text-2xl font-black">x{item.quantity}</span>
            </div>
            {(item.modifiers?.length > 0 || item.item_notes) ? (
              <p className="mt-2 text-lg font-black text-white">
                {[...(item.modifiers || []).map((mod) => mod.name), item.item_notes].filter(Boolean).join(' - ')}
              </p>
            ) : null}
          </div>
        ))}
      </div>
      {ticket.notes ? <p className="mt-4 rounded-2xl bg-black/18 px-4 py-3 text-lg font-bold">{ticket.notes}</p> : null}
      <div className="mt-5 grid grid-cols-2 gap-3">
        {status !== 'preparing' ? (
          <button type="button" onClick={() => onStatus(ticket, 'preparing')} className="rounded-2xl bg-white px-5 py-4 text-lg font-black text-slate-950 shadow-lg active:scale-[0.99]">
            Preparing
          </button>
        ) : null}
        {status !== 'ready' ? (
          <button type="button" onClick={() => onStatus(ticket, 'ready')} className="rounded-2xl bg-white px-5 py-4 text-lg font-black text-emerald-700 shadow-lg active:scale-[0.99]">
            Ready
          </button>
        ) : null}
        <button type="button" onClick={() => onStatus(ticket, 'served')} className="rounded-2xl bg-slate-950 px-5 py-4 text-lg font-black text-white shadow-lg active:scale-[0.99]">
          <Check className="mr-2 inline" size={20} /> Close
        </button>
      </div>
    </article>
  )
}

export function PrepDisplay({ station = 'kitchen' }) {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())
  const [busyId, setBusyId] = useState('')
  const title = station === 'bar' ? 'Bar Tickets' : 'Kitchen Tickets'

  const load = useCallback(async () => {
    try {
      const rows = await window.api?.pos?.getTickets?.({ station })
      setTickets(filterActiveTickets(rows || []))
    } finally {
      setLoading(false)
    }
  }, [station])

  useEffect(() => {
    load()
    const interval = window.setInterval(load, DISPLAY_REFRESH_MS)
    const clock = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      window.clearInterval(interval)
      window.clearInterval(clock)
    }
  }, [load])

  const grouped = useMemo(() => {
    const buckets = { new: [], preparing: [], ready: [] }
    tickets.forEach((ticket) => {
      const status = String(ticket.status || 'new').toLowerCase()
      if (status === 'ready') buckets.ready.push(ticket)
      else if (status === 'preparing') buckets.preparing.push(ticket)
      else buckets.new.push(ticket)
    })
    return buckets
  }, [tickets])

  const updateStatus = async (ticket, status) => {
    if (busyId) return
    setBusyId(ticket.id)
    try {
      const result = await window.api?.pos?.updateTicketStatus?.(ticket.id, status)
      if (result?.success !== false) await load()
    } finally {
      setBusyId('')
    }
  }

  return (
    <DisplayShell
      title={title}
      subtitle="Live prep board"
      right={<button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950"><RefreshCw size={16} /> Refresh</button>}
    >
      {loading ? (
        <div className="flex min-h-[70vh] items-center justify-center text-slate-300">
          <RefreshCw className="mr-3 animate-spin" /> Loading tickets
        </div>
      ) : tickets.length === 0 ? (
        <div className="flex min-h-[70vh] flex-col items-center justify-center rounded-3xl border border-white/10 bg-white/[0.03] text-center">
          <Utensils size={58} className="text-emerald-300" />
          <h2 className="mt-5 text-4xl font-bold">No open tickets</h2>
          <p className="mt-3 max-w-xl text-xl text-slate-300">New POS orders for this station will appear here automatically.</p>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-3">
          {[
            ['new', 'New'],
            ['preparing', 'Preparing'],
            ['ready', 'Ready']
          ].map(([key, label]) => (
            <section key={key} className="min-h-[70vh] rounded-3xl border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-2xl font-black">{label}</h2>
                <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-bold text-slate-200">{grouped[key].length}</span>
              </div>
              <div className="space-y-4">
                {grouped[key].map((ticket) => (
                  <div key={ticket.id} className={busyId === ticket.id ? 'pointer-events-none opacity-60' : ''}>
                    <TicketCard ticket={ticket} now={now} onStatus={updateStatus} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </DisplayShell>
  )
}
