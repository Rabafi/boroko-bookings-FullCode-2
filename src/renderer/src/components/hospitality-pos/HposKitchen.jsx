import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChefHat, Clock3, RefreshCw, Settings2, UtensilsCrossed } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { HposButton, HposEmptyState, HposNotice, HposPageHero } from './HposUi'

const TICKET_STATES = {
  new: { label: 'New', action: 'Start preparing', next: 'preparing' },
  pending: { label: 'New', action: 'Start preparing', next: 'preparing' },
  preparing: { label: 'Preparing', action: 'Mark ready', next: 'ready' },
  ready: { label: 'Ready', action: 'Mark served', next: 'served' },
  served: { label: 'Served', action: null, next: null }
}

function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function localDayBounds(dateKey) {
  const safeDateKey = dateKey || localDateKey()
  const start = new Date(`${safeDateKey}T00:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { createdFrom: start.toISOString(), createdTo: end.toISOString() }
}

function getTicketReference(ticket) {
  const friendly = String(ticket.order_number || ticket.receipt_number || '').trim()
  if (friendly) return `#${friendly.replace(/^#/, '')}`
  const reference = String(ticket.order_id || ticket.id || '').replace(/[^a-z0-9]/gi, '')
  return reference ? `Ticket ${reference.slice(-6).toUpperCase()}` : 'New ticket'
}

function itemModifiers(item) {
  const values = Array.isArray(item.modifiers) ? item.modifiers : []
  return values.map((modifier) => typeof modifier === 'string' ? modifier : modifier?.name).filter(Boolean)
}

function TicketCard({ ticket, onStatusChange, busy }) {
  const state = TICKET_STATES[ticket.status] || TICKET_STATES.new
  const elapsed = ticket.created_at ? Math.max(0, Math.floor((Date.now() - new Date(ticket.created_at).getTime()) / 60000)) : 0
  const pressure = elapsed >= 15 ? 'critical' : elapsed >= 10 ? 'high' : elapsed >= 5 ? 'medium' : 'normal'
  return <article className={`hpos-service-ticket is-${ticket.status || 'new'} pressure-${pressure}`}>
    <header><div><strong title={`Full reference: ${ticket.order_number || ticket.receipt_number || ticket.order_id || ticket.id || 'Unavailable'}`}>{getTicketReference(ticket)}</strong><span>{ticket.table_name || ticket.table || ticket.tab_name || 'Takeaway'}</span></div><span className="hpos-service-ticket__timer"><Clock3 size={14}/>{elapsed} min</span></header>
    <div className="hpos-service-ticket__items">{(ticket.items || []).map((item, index) => { const modifiers = itemModifiers(item); return <div key={item.id || `${ticket.id}-item-${index}`}><p><strong>{Number(item.quantity || 1)}×</strong><span>{item.item_name || item.name || 'Unnamed item'}</span></p>{modifiers.length > 0 && <small>{modifiers.join(' · ')}</small>}{item.item_notes && <em>{item.item_notes}</em>}</div> })}{!(ticket.items || []).length && <p className="hpos-service-ticket__missing"><AlertTriangle size={14}/>No item detail received</p>}</div>
    <footer><span>{ticket.station || 'Unassigned station'}</span>{state.next && <button type="button" onClick={() => onStatusChange(ticket.id, state.next)} disabled={busy}>{busy ? 'Updating…' : state.action}</button>}</footer>
  </article>
}

export default function HposKitchen() {
  const navigate = useNavigate()
  const [tickets, setTickets] = useState([])
  const [stationFilter, setStationFilter] = useState('all')
  const [serviceDate, setServiceDate] = useState(() => localDateKey())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyTicketId, setBusyTicketId] = useState(null)

  const loadTickets = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true)
    setError('')
    try {
      const data = await window.api?.pos?.getTickets?.(localDayBounds(serviceDate)) ?? []
      setTickets(Array.isArray(data) ? data : [])
    } catch (loadError) {
      setError(loadError?.message || 'Kitchen tickets could not be refreshed.')
    } finally { if (!quiet) setLoading(false) }
  }, [serviceDate])

  useEffect(() => {
    let active = true
    loadTickets()
    const interval = setInterval(() => {
      if (active && document.visibilityState === 'visible') loadTickets({ quiet: true })
    }, 5000)
    const handleVisible = () => {
      if (document.visibilityState === 'visible') loadTickets({ quiet: true })
    }
    document.addEventListener('visibilitychange', handleVisible)
    return () => {
      active = false
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisible)
    }
  }, [loadTickets])

  const handleStatusChange = async (ticketId, newStatus) => {
    setBusyTicketId(ticketId); setError('')
    try {
      const result = await window.api?.pos?.updateTicketStatus?.(ticketId, newStatus)
      if (!result?.success) throw new Error(result?.error || 'Could not update this ticket.')
      setTickets((current) => current.map((ticket) => ticket.id === ticketId ? { ...ticket, status: newStatus } : ticket))
    } catch (updateError) { setError(updateError?.message || 'Could not update this ticket.') }
    finally { setBusyTicketId(null) }
  }

  const stations = useMemo(() => ['all', ...new Set(tickets.map((ticket) => ticket.station).filter(Boolean))], [tickets])
  const ticketsForDate = tickets.filter((ticket) => localDateKey(ticket.created_at) === serviceDate)
  const filtered = stationFilter === 'all' ? ticketsForDate : ticketsForDate.filter((ticket) => ticket.station === stationFilter)
  const grouped = {
    new: filtered.filter((ticket) => ['new', 'pending'].includes(ticket.status)),
    preparing: filtered.filter((ticket) => ticket.status === 'preparing'),
    ready: filtered.filter((ticket) => ticket.status === 'ready'),
    served: filtered.filter((ticket) => ticket.status === 'served')
  }
  const urgentCount = filtered.filter((ticket) => ticket.status !== 'ready' && ticket.created_at && Date.now() - new Date(ticket.created_at).getTime() >= 10 * 60000).length

  return <div className="hpos-page-frame hpos-kitchen hpos-service-kitchen">
    <HposPageHero eyebrow="Live production" title="Kitchen display" description="Move every ticket from new to served, with the full order visible to the team." actions={<div className="hpos-service-hero-actions"><HposButton icon={Settings2} onClick={() => navigate('/restaurant/stations')}>Manage stations</HposButton><HposButton icon={RefreshCw} onClick={() => loadTickets()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</HposButton></div>}/>
    <section className="hpos-service-kitchen-tools">
      <div className="hpos-service-kitchen-summary"><div><span>On this board</span><strong>{filtered.length}</strong></div><div className={urgentCount ? 'is-danger' : ''}><span>Over 10 min</span><strong>{urgentCount}</strong></div><div><span>Ready to serve</span><strong>{grouped.ready.length}</strong></div></div>
      <label>Service date<input type="date" value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} aria-label="Kitchen service date"/></label>
      <div className="hpos-service-filter-pills" aria-label="Kitchen station">{stations.map((station) => <button type="button" key={station} className={stationFilter === station ? 'is-active' : ''} onClick={() => setStationFilter(station)}>{station === 'all' ? 'All stations' : station}</button>)}</div>
    </section>
    {error && <HposNotice tone="error">{error}</HposNotice>}
    {loading ? <div className="hpos-service-loading"><RefreshCw className="is-spinning" size={22}/><span>Loading kitchen tickets…</span></div> : !filtered.length ? <HposEmptyState icon={ChefHat} title="No tickets for this view" description={serviceDate === localDateKey() ? 'New kitchen and bar tickets will appear here automatically.' : 'Choose another service date or station to review tickets.'}/> : <section className="hpos-service-kitchen-board">{Object.entries(grouped).map(([status, rows]) => <div key={status} className={`hpos-service-kitchen-lane is-${status}`}><header><span>{TICKET_STATES[status].label}</span><strong>{rows.length}</strong></header><div>{rows.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} onStatusChange={handleStatusChange} busy={busyTicketId === ticket.id}/>) }{!rows.length && <div className="hpos-service-lane-empty"><CheckCircle2 size={18}/><span>Clear</span></div>}</div></div>)}</section>}
  </div>
}
