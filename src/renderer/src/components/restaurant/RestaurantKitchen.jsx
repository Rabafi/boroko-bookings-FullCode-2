import { useState, useEffect, useCallback } from 'react'
import { Clock, AlertTriangle, RefreshCw, CalendarDays } from 'lucide-react'

const STATUSES = ['all', 'pending', 'preparing', 'ready', 'served']

function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function elapsedMinutes(createdAt) {
  if (!createdAt) return 0
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)
}

function pressureColor(minutes) {
  if (minutes >= 15) return 'text-red-600 bg-red-50 border-red-200'
  if (minutes >= 10) return 'text-orange-600 bg-orange-50 border-orange-200'
  if (minutes >= 5) return 'text-amber-600 bg-amber-50 border-amber-200'
  return 'text-emerald-600 bg-emerald-50 border-emerald-200'
}

export default function RestaurantKitchen() {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [station, setStation] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [serviceDate, setServiceDate] = useState(localDateKey())
  const [stations, setStations] = useState([{ id: 'all', name: 'All stations' }, { id: 'kitchen', name: 'Kitchen' }, { id: 'bar', name: 'Bar' }])
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')
  const [updatingId, setUpdatingId] = useState(null)

  const loadTickets = useCallback(async () => {
    try {
      setError('')
      const selectedDate = serviceDate || localDateKey(new Date())
      const start = new Date(`${selectedDate}T00:00:00`)
      const end = new Date(start)
      end.setDate(end.getDate() + 1)
      const filters = {
        ...(station !== 'all' ? { station } : {}),
        createdFrom: start.toISOString(),
        createdTo: end.toISOString()
      }
      const data = await window.api.pos.getTickets(filters)
      setTickets(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Failed to load tickets:', err)
      setError(err.message || 'Could not refresh kitchen tickets.')
    } finally {
      setLoading(false)
    }
  }, [serviceDate, station])

  useEffect(() => {
    loadTickets()
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') loadTickets()
    }, 10000)
    const handleVisible = () => {
      if (document.visibilityState === 'visible') loadTickets()
    }
    document.addEventListener('visibilitychange', handleVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisible)
    }
  }, [loadTickets])

  useEffect(() => {
    window.api.pos.getStations?.()
      .then((rows) => {
        const enabled = (Array.isArray(rows) ? rows : []).filter((row) => row.enabled !== false)
        const builtIns = [{ id: 'all', name: 'All stations' }, { id: 'kitchen', name: 'Kitchen' }, { id: 'bar', name: 'Bar' }]
        const merged = new Map(builtIns.map(row => [row.id, row]))
        enabled.forEach(row => merged.set(row.id, { id: row.id, name: row.name || row.id }))
        setStations([...merged.values()])
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(tick)
  }, [])

  async function updateStatus(ticketId, newStatus) {
    try {
      setUpdatingId(ticketId)
      setError('')
      const result = await window.api.pos.updateTicketStatus(ticketId, newStatus)
      if (result?.success === false) throw new Error(result.error || 'Could not update ticket.')
      await loadTickets()
    } catch (err) {
      console.error('Failed to update ticket:', err)
      setError(err.message || 'Could not update ticket.')
    } finally {
      setUpdatingId(null)
    }
  }

  const filtered = tickets.filter(t => {
    if (serviceDate && t.created_at && localDateKey(new Date(t.created_at)) !== serviceDate) return false
    if (statusFilter !== 'all' && t.status !== statusFilter && !(statusFilter === 'pending' && t.status === 'new')) return false
    return true
  })

  const pending = filtered.filter(t => t.status === 'new' || t.status === 'pending')
  const preparing = filtered.filter(t => t.status === 'preparing')
  const ready = filtered.filter(t => t.status === 'ready')
  const served = filtered.filter(t => t.status === 'served')

  const statusLabel = (s) => {
    switch (s) {
      case 'new': case 'pending': return 'New'
      case 'preparing': return 'Preparing'
      case 'ready': return 'Ready'
      case 'served': return 'Served'
      default: return s
    }
  }

  const statusColor = (s) => {
    switch (s) {
      case 'new': case 'pending': return 'bg-red-500 text-white'
      case 'preparing': return 'bg-amber-500 text-white'
      case 'ready': return 'bg-emerald-500 text-white'
      case 'served': return 'bg-gray-400 text-white'
      default: return 'bg-gray-300 text-gray-700'
    }
  }

  function TicketCard({ ticket }) {
    const mins = elapsedMinutes(ticket.created_at)
    const pressure = mins >= 15 ? 'CRITICAL' : mins >= 10 ? 'HIGH' : mins >= 5 ? 'MODERATE' : ''
    return (
      <div className={`bb-card p-4 border-l-4 ${mins >= 15 ? 'border-red-500' : mins >= 10 ? 'border-orange-500' : mins >= 5 ? 'border-amber-400' : 'border-emerald-400'}`}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-bold text-lg">
            {ticket.table_number || ticket.table_name || 'Takeaway'}
          </span>
          <div className="flex items-center gap-2">
            {pressure && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${mins >= 15 ? 'bg-red-100 text-red-700' : mins >= 10 ? 'bg-orange-100 text-orange-700' : 'bg-amber-100 text-amber-700'}`}>
                {pressure}
              </span>
            )}
            <span className={`text-xs font-medium px-2 py-1 rounded-full ${statusColor(ticket.status)}`}>
              {statusLabel(ticket.status)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
          <span className="flex items-center gap-1">
            <Clock size={11} />
            {mins}m ago
          </span>
          {ticket.station && <span className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">{ticket.station}</span>}
          {ticket.waiter_name && <span>{ticket.waiter_name}</span>}
        </div>
        <div className="space-y-1 mb-3">
          {(ticket.items || []).map((item, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span>{item.quantity}x {item.item_name || item.name}</span>
              {item.modifiers && <span className="text-gray-400 text-xs">{item.modifiers}</span>}
            </div>
          ))}
        </div>
        {ticket.notes && (
          <div className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-1 mb-3">
            {ticket.notes}
          </div>
        )}
        <div className="flex gap-2">
          {(ticket.status === 'new' || ticket.status === 'pending') && (
            <button onClick={() => updateStatus(ticket.id, 'preparing')} disabled={updatingId === ticket.id} className="bb-btn-primary text-xs flex-1">
              {updatingId === ticket.id ? 'Saving…' : 'Start Preparing'}
            </button>
          )}
          {ticket.status === 'preparing' && (
            <button onClick={() => updateStatus(ticket.id, 'ready')} disabled={updatingId === ticket.id} className="bb-btn-primary text-xs flex-1 bg-emerald-600 hover:bg-emerald-700">
              {updatingId === ticket.id ? 'Saving…' : 'Mark Ready'}
            </button>
          )}
          {ticket.status === 'ready' && (
            <button onClick={() => updateStatus(ticket.id, 'served')} disabled={updatingId === ticket.id} className="bb-btn-primary text-xs flex-1 bg-gray-500 hover:bg-gray-600">
              {updatingId === ticket.id ? 'Saving…' : 'Mark Served'}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="restaurant-native-page">
      <div className="restaurant-native-hero">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Kitchen Display</h1>
          <p className="text-sm text-gray-500 mt-1">Live order tickets with station routing and timing</p>
        </div>
        <button onClick={loadTickets} className="bb-btn-outline flex items-center gap-2 px-4 text-sm"><RefreshCw size={14} /> Refresh</button>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
          <CalendarDays size={14} /> Service date
          <input type="date" value={serviceDate} onChange={event => setServiceDate(event.target.value)} className="min-h-0 border-0 bg-transparent p-0" />
        </label>
        <span className="text-xs text-gray-500">Tickets refresh automatically every 10 seconds.</span>
      </div>

      {/* Station tabs */}
      <div className="restaurant-native-segmented mb-4 w-fit">
        {stations.map(s => (
          <button
            key={s.id}
            onClick={() => setStation(s.id)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
              station === s.id ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>

      {/* Status filter */}
      <div className="restaurant-native-segmented mb-6">
        {STATUSES.map(f => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              statusFilter === f ? 'bg-[#174c3a] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f === 'all' ? 'All' : statusLabel(f)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="restaurant-native-loading">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="restaurant-native-empty">
          <p className="text-gray-500 text-lg mb-2">No tickets</p>
          <p className="text-gray-400 text-sm">Orders will appear here as they come in</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary counts */}
          <div className="restaurant-native-kpis">
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-center">
              <div className="text-xl font-bold text-red-700">{pending.length}</div>
              <div className="text-[10px] text-red-600">Pending</div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-center">
              <div className="text-xl font-bold text-amber-700">{preparing.length}</div>
              <div className="text-[10px] text-amber-600">Preparing</div>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-center">
              <div className="text-xl font-bold text-emerald-700">{ready.length}</div>
              <div className="text-[10px] text-emerald-600">Ready</div>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-center">
              <div className="text-xl font-bold text-gray-700">{served.length}</div>
              <div className="text-[10px] text-gray-600">Served</div>
            </div>
          </div>

          {/* Ticket grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(ticket => (
              <TicketCard key={ticket.id} ticket={ticket} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
