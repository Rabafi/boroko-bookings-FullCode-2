import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  AlertTriangle,
  RefreshCw,
  LogIn,
  LogOut,
  CreditCard,
  Sparkles,
  BedDouble,
  Wrench,
  Users,
  Star
} from 'lucide-react'
import { useSettings } from '../../app-context'

function money(amount, currency = 'P') {
  const symbol = currency || 'P'
  return `${symbol}${Number(amount || 0).toLocaleString('en', { maximumFractionDigits: 0 })}`
}

function timeLabel(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10)
  if (String(value).includes('T') || String(value).length > 10) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return String(value)
}

function statusTone(kind) {
  if (kind === 'arrival') return 'ok'
  if (kind === 'departure') return 'warn'
  return 'info'
}

function isCheckedIn(b) {
  const s = String(b?.status || '').toLowerCase()
  return s === 'checked_in' || s === 'in_house' || s === 'staying'
}

function isCheckedOut(b) {
  return String(b?.status || '').toLowerCase() === 'checked_out'
}

/**
 * Front-desk board for HotelOS.
 * Loads through hotel domain APIs only — no hard-coded KPIs.
 * Partial load failures surface as warnings; they never silently become empty success.
 */
export default function HotelHome() {
  const navigate = useNavigate()
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const property = settings?.lodge_name || settings?.company_name || 'Hotel'

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState([])
  const [stats, setStats] = useState(null)
  const [rooms, setRooms] = useState([])
  const [arrivals, setArrivals] = useState([])
  const [departures, setDepartures] = useState([])
  const [inHouse, setInHouse] = useState([])
  const [noShows, setNoShows] = useState([])
  const [dirtyBlockers, setDirtyBlockers] = useState([])
  const [maintenanceBlockers, setMaintenanceBlockers] = useState([])
  const [unassignedArrivals, setUnassignedArrivals] = useState([])
  const [outstandingBalances, setOutstandingBalances] = useState([])
  const [vipArrivals, setVipArrivals] = useState([])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setWarnings([])

    const warn = []
    const settle = async (label, promise) => {
      try {
        return await promise
      } catch (e) {
        warn.push(`${label}: ${e?.message || 'failed'}`)
        return null
      }
    }

    try {
      const [board, allRooms, arriving, departing, staying, missed] = await Promise.all([
        settle('Dashboard stats', window.api?.hotel?.getDashboardStats?.()),
        settle('Rooms', window.api?.rooms?.getAll?.()),
        settle('Arrivals', window.api?.hotel?.getArrivals?.()),
        settle('Departures', window.api?.hotel?.getDepartures?.()),
        settle('In-house', window.api?.hotel?.getInHouse?.()),
        settle('No-shows', window.api?.hotel?.getNoShows?.())
      ])

      if (warn.length && !board && !allRooms && !arriving && !departing && !staying) {
        setError(warn.join(' · ') || 'Could not load the front-desk board.')
        setStats(null)
        setRooms([])
        setArrivals([])
        setDepartures([])
        setInHouse([])
        setNoShows([])
        setDirtyBlockers([])
        setMaintenanceBlockers([])
        setUnassignedArrivals([])
        setOutstandingBalances([])
        setVipArrivals([])
        return
      }

      setWarnings(warn)
      setStats(board && typeof board === 'object' ? board : null)
      setRooms(Array.isArray(allRooms) ? allRooms : [])

      const listArrivals = Array.isArray(board?.lists?.arrivals)
        ? board.lists.arrivals
        : (Array.isArray(arriving) ? arriving : [])
      const listDepartures = Array.isArray(board?.lists?.departures)
        ? board.lists.departures
        : (Array.isArray(departing) ? departing : [])
      const listInHouse = Array.isArray(board?.lists?.inHouse)
        ? board.lists.inHouse
        : (Array.isArray(staying) ? staying : [])
      const listNoShows = Array.isArray(board?.lists?.noShows)
        ? board.lists.noShows
        : (Array.isArray(missed) ? missed : [])

      setArrivals(listArrivals)
      setDepartures(listDepartures)
      setInHouse(listInHouse)
      setNoShows(listNoShows)
      setDirtyBlockers(Array.isArray(board?.lists?.dirtyBlockers) ? board.lists.dirtyBlockers : [])
      setMaintenanceBlockers(Array.isArray(board?.lists?.maintenanceBlockers) ? board.lists.maintenanceBlockers : [])
      setUnassignedArrivals(Array.isArray(board?.lists?.unassignedArrivals) ? board.lists.unassignedArrivals : [])
      setOutstandingBalances(Array.isArray(board?.lists?.outstandingBalances) ? board.lists.outstandingBalances : [])
      setVipArrivals(Array.isArray(board?.lists?.vipArrivals) ? board.lists.vipArrivals : [])
    } catch (e) {
      setError(e?.message || 'Could not load the front-desk board.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const roomCounts = useMemo(() => {
    if (stats?.rooms) {
      return {
        available: Number(stats.rooms.available || 0),
        occupied: Number(stats.rooms.occupied || 0),
        dirty: Number(stats.rooms.dirty || 0),
        maintenance: Number(stats.rooms.maintenance || 0),
        reserved: Number(stats.rooms.reserved || 0),
        total: Number(stats.rooms.total || 0)
      }
    }
    const counts = { available: 0, occupied: 0, dirty: 0, maintenance: 0, reserved: 0, total: 0 }
    for (const room of rooms) {
      const status = String(room.status || 'available').toLowerCase()
      if (counts[status] !== undefined) counts[status] += 1
      else counts.available += 1
      counts.total += 1
    }
    return counts
  }, [stats, rooms])

  const occupancy = stats?.occupancyPercent != null
    ? Number(stats.occupancyPercent)
    : (roomCounts.total
      ? Math.round(((roomCounts.occupied + roomCounts.reserved) / roomCounts.total) * 100)
      : 0)

  const outstanding = stats?.outstandingTotal != null
    ? Number(stats.outstandingTotal)
    : inHouse.reduce((sum, b) => {
      const bal = Math.max(0, Number(b.total_amount || 0) + Number(b.charges_total || 0) - Number(b.amount_paid || 0))
      return sum + bal
    }, 0)

  const movementRows = useMemo(() => {
    const rows = [
      ...arrivals.map((b) => ({ ...b, _kind: 'arrival' })),
      ...departures.map((b) => ({ ...b, _kind: 'departure' }))
    ]
    return rows.slice(0, 16)
  }, [arrivals, departures])

  const dirtyRooms = useMemo(
    () => rooms.filter((r) => String(r.status || '').toLowerCase() === 'dirty').slice(0, 8),
    [rooms]
  )

  const openBooking = (booking) => {
    navigate('/bookings', { state: { highlightBookingId: booking?.id } })
  }

  const openCheckin = (booking) => {
    navigate('/checkin-workflow', { state: { bookingId: booking?.id } })
  }

  if (loading && !stats && !rooms.length && !arrivals.length) {
    return (
      <div className="ht-home">
        <div className="ht-empty">Loading front-desk board…</div>
      </div>
    )
  }

  if (error && !stats && !rooms.length && !arrivals.length) {
    return (
      <div className="ht-home">
        <div className="ht-alert">
          <div>
            <strong>Board unavailable</strong>
            <div style={{ marginTop: 4, fontSize: 12 }}>{error}</div>
          </div>
          <button type="button" className="ht-text-btn primary" onClick={load}>Retry</button>
        </div>
      </div>
    )
  }

  const exceptionCards = [
    noShows.length > 0 && {
      key: 'no-shows',
      title: `No-shows · ${noShows.length}`,
      detail: noShows.slice(0, 3).map((b) => b.customer_name || 'Guest').join(' · ') + (noShows.length > 3 ? '…' : ''),
      action: () => navigate('/bookings', { state: { filter: 'no_show' } }),
      actionLabel: 'Open no-shows'
    },
    unassignedArrivals.length > 0 && {
      key: 'unassigned',
      title: `Unassigned rooms · ${unassignedArrivals.length}`,
      detail: 'Arrivals today without a physical room',
      action: () => navigate('/bookings', { state: { filter: 'unassigned' } }),
      actionLabel: 'Assign rooms'
    },
    dirtyBlockers.length > 0 && {
      key: 'dirty',
      title: `Dirty-room blockers · ${dirtyBlockers.length}`,
      detail: 'Arrivals blocked until housekeeping completes',
      action: () => navigate('/housekeeping'),
      actionLabel: 'Housekeeping'
    },
    maintenanceBlockers.length > 0 && {
      key: 'maint',
      title: `Maintenance blockers · ${maintenanceBlockers.length}`,
      detail: 'Arrivals on rooms in maintenance / OOO',
      action: () => navigate('/maintenance'),
      actionLabel: 'Maintenance'
    },
    outstandingBalances.length > 0 && {
      key: 'balances',
      title: `Outstanding balances · ${outstandingBalances.length}`,
      detail: money(outstanding, currency) + ' open on in-house stays',
      action: () => navigate('/folios'),
      actionLabel: 'Open folios'
    },
    vipArrivals.length > 0 && {
      key: 'vip',
      title: `VIP arrivals · ${vipArrivals.length}`,
      detail: vipArrivals.slice(0, 3).map((b) => b.customer_name || 'Guest').join(' · '),
      action: () => navigate('/checkin-workflow'),
      actionLabel: 'Check-in'
    }
  ].filter(Boolean)

  return (
    <div className="ht-home">
      <div className="ht-home-toolbar">
        <div>
          <h1>{property}</h1>
          <p>
            {occupancy}% occupancy · {arrivals.length} arrivals · {departures.length} departures · {inHouse.length} in house
            {stats?.date ? ` · business date ${stats.date}` : ''}
          </p>
          <p style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>
            Occupancy from room status ({stats?.occupancySource || 'room_status_estimate'}).
            Balances from booking ledger fields ({stats?.balanceSource || 'booking_ledger_estimate'}) — not night-audit final totals.
          </p>
        </div>
        <div className="ht-home-actions">
          <button type="button" className="ht-text-btn primary" onClick={() => navigate('/bookings')}>
            <BedDouble size={14} /> New reservation
          </button>
          <button type="button" className="ht-text-btn" onClick={() => navigate('/checkin-workflow')}>
            <LogIn size={14} /> Check-in
          </button>
          <button type="button" className="ht-text-btn" onClick={() => navigate('/housekeeping')}>
            <Sparkles size={14} /> Housekeeping
          </button>
          <button type="button" className="ht-text-btn" onClick={() => navigate('/folios')}>
            <CreditCard size={14} /> Folios
          </button>
          <button type="button" className="ht-text-btn" onClick={load} title="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="ht-alert" role="status">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={16} color="#8a6418" />
            <div>
              <strong>Partial board load</strong>
              <div style={{ fontSize: 12, color: '#6b5d45', marginTop: 2 }}>{warnings.join(' · ')}</div>
            </div>
          </div>
          <button type="button" className="ht-text-btn" onClick={load}>Retry</button>
        </div>
      )}

      {exceptionCards.map((card) => (
        <div className="ht-alert" key={card.key}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={16} color="#8a6418" />
            <div>
              <strong>{card.title}</strong>
              <div style={{ fontSize: 12, color: '#6b5d45', marginTop: 2 }}>{card.detail}</div>
            </div>
          </div>
          <button type="button" className="ht-text-btn" onClick={card.action}>
            {card.actionLabel}
          </button>
        </div>
      ))}

      <div className="ht-kpi-row">
        <button type="button" className="ht-kpi" onClick={() => navigate('/roomgrid')} style={{ textAlign: 'left', cursor: 'pointer' }}>
          <div className="ht-kpi-label"><span className="ht-dot ok" /> Occupancy</div>
          <div className="ht-kpi-value">{occupancy}%</div>
          <div className="ht-kpi-hint">{roomCounts.occupied + roomCounts.reserved}/{roomCounts.total || 0} rooms · open grid</div>
        </button>
        <button type="button" className="ht-kpi" onClick={() => navigate('/checkin-workflow')} style={{ textAlign: 'left', cursor: 'pointer' }}>
          <div className="ht-kpi-label"><span className="ht-dot ok" /> Arrivals</div>
          <div className="ht-kpi-value">{arrivals.length}</div>
          <div className="ht-kpi-hint">
            {stats?.pendingArrivals != null ? `${stats.pendingArrivals} pending check-in` : 'Due today'}
          </div>
        </button>
        <button type="button" className="ht-kpi" onClick={() => navigate('/checkin-workflow')} style={{ textAlign: 'left', cursor: 'pointer' }}>
          <div className="ht-kpi-label"><span className="ht-dot warn" /> Departures</div>
          <div className="ht-kpi-value">{departures.length}</div>
          <div className="ht-kpi-hint">
            {stats?.pendingDepartures != null ? `${stats.pendingDepartures} pending checkout` : 'Due today'}
          </div>
        </button>
        <button type="button" className="ht-kpi" onClick={() => navigate('/guests')} style={{ textAlign: 'left', cursor: 'pointer' }}>
          <div className="ht-kpi-label"><span className="ht-dot info" /> In house</div>
          <div className="ht-kpi-value">{inHouse.length}</div>
          <div className="ht-kpi-hint">Current stays</div>
        </button>
        <button type="button" className="ht-kpi" onClick={() => navigate('/housekeeping')} style={{ textAlign: 'left', cursor: 'pointer' }}>
          <div className="ht-kpi-label"><span className="ht-dot danger" /> Dirty rooms</div>
          <div className="ht-kpi-value">{roomCounts.dirty}</div>
          <div className="ht-kpi-hint">Need turnaround</div>
        </button>
        <button type="button" className="ht-kpi" onClick={() => navigate('/folios')} style={{ textAlign: 'left', cursor: 'pointer' }}>
          <div className="ht-kpi-label"><span className="ht-dot warn" /> Open balances</div>
          <div className="ht-kpi-value" style={{ fontSize: 20 }}>{money(outstanding, currency)}</div>
          <div className="ht-kpi-hint">In-house outstanding · open folios</div>
        </button>
      </div>

      <div className="ht-home-grid">
        <section className="ht-card">
          <div className="ht-card-head">
            <h2 className="ht-card-title">Arrivals &amp; departures</h2>
            <button type="button" className="ht-text-btn" onClick={() => navigate('/bookings')}>
              All stays
            </button>
          </div>

          {movementRows.length === 0 ? (
            <div className="ht-empty">No arrivals or departures scheduled for today.</div>
          ) : (
            <table className="ht-table">
              <thead>
                <tr>
                  <th>Guest</th>
                  <th>Type</th>
                  <th>Time</th>
                  <th>Note</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {movementRows.map((booking) => {
                  const balance = Math.max(
                    0,
                    Number(booking.total_amount || 0) + Number(booking.charges_total || 0) - Number(booking.amount_paid || 0)
                  )
                  const notes = []
                  if (booking._kind === 'arrival' && isCheckedIn(booking)) notes.push('Checked in')
                  if (booking._kind === 'departure' && isCheckedOut(booking)) notes.push('Checked out')
                  if (balance > 0.009) notes.push(`Balance ${money(balance, currency)}`)
                  if (isCheckedIn(booking) === false && booking._kind === 'arrival' && !booking.room_number && !booking.room_id) {
                    notes.push('Unassigned')
                  }
                  if (String(booking.room_status || '').toLowerCase() === 'dirty') notes.push('Room dirty')
                  if (String(booking.special_requests || '').trim()) notes.push('Special request')
                  if (String(booking.notes || '').toLowerCase().includes('vip') || booking.is_vip || booking.vip) {
                    notes.push('VIP')
                  }

                  return (
                    <tr key={`${booking._kind}-${booking.id}`}>
                      <td onClick={() => openBooking(booking)} style={{ cursor: 'pointer' }}>
                        <div className="guest">
                          {(booking.is_vip || booking.vip) && <Star size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />}
                          {booking.customer_name || 'Guest'}
                        </div>
                        <div className="muted">
                          Rm {booking.room_number || '—'}
                          {booking.room_type ? ` · ${booking.room_type}` : ''}
                        </div>
                      </td>
                      <td>
                        <span className="ht-status-pill">
                          <span className={`ht-dot ${statusTone(booking._kind)}`} />
                          {booking._kind === 'arrival' ? (
                            <><LogIn size={12} /> Arrival</>
                          ) : (
                            <><LogOut size={12} /> Departure</>
                          )}
                        </span>
                      </td>
                      <td className="muted">
                        {timeLabel(booking._kind === 'arrival' ? booking.check_in : booking.check_out)}
                      </td>
                      <td className="muted">{notes.length ? notes.join(' · ') : '—'}</td>
                      <td>
                        {booking._kind === 'arrival' && !isCheckedIn(booking) ? (
                          <button type="button" className="ht-text-btn" onClick={() => openCheckin(booking)}>
                            Check in
                          </button>
                        ) : booking._kind === 'departure' && !isCheckedOut(booking) ? (
                          <button type="button" className="ht-text-btn" onClick={() => openCheckin(booking)}>
                            Check out
                          </button>
                        ) : (
                          <button type="button" className="ht-text-btn" onClick={() => openBooking(booking)}>
                            Open
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>

        <div className="ht-stack">
          <section className="ht-card">
            <div className="ht-card-head">
              <h2 className="ht-card-title">Room status</h2>
              <button type="button" className="ht-text-btn" onClick={() => navigate('/roomgrid')}>
                Grid
              </button>
            </div>
            <div className="ht-room-grid">
              <button type="button" className="ht-room-stat" onClick={() => navigate('/rooms')}>
                <strong>{roomCounts.available}</strong>
                <span>Available</span>
              </button>
              <button type="button" className="ht-room-stat" onClick={() => navigate('/roomgrid')}>
                <strong>{roomCounts.occupied}</strong>
                <span>Occupied</span>
              </button>
              <button type="button" className="ht-room-stat" onClick={() => navigate('/housekeeping')}>
                <strong>{roomCounts.dirty}</strong>
                <span>Dirty</span>
              </button>
              <button type="button" className="ht-room-stat" onClick={() => navigate('/maintenance')}>
                <strong>{roomCounts.maintenance}</strong>
                <span>Maintenance</span>
              </button>
              <button type="button" className="ht-room-stat" onClick={() => navigate('/bookings')}>
                <strong>{roomCounts.reserved}</strong>
                <span>Reserved</span>
              </button>
              <div className="ht-room-stat">
                <strong>{roomCounts.total}</strong>
                <span>Total rooms</span>
              </div>
            </div>
          </section>

          <section className="ht-card">
            <div className="ht-card-head">
              <h2 className="ht-card-title">Housekeeping queue</h2>
              <button type="button" className="ht-text-btn" onClick={() => navigate('/housekeeping')}>
                Open
              </button>
            </div>
            {dirtyRooms.length === 0 ? (
              <div className="ht-empty" style={{ padding: '14px 4px' }}>No dirty rooms on the board.</div>
            ) : (
              <ul className="ht-list">
                {dirtyRooms.map((room) => (
                  <li key={room.id || room.room_number}>
                    <span className="ht-dot danger" />
                    <span>Room {room.room_number || '—'} · needs clean</span>
                    <button type="button" onClick={() => navigate('/housekeeping')}>Assign</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="ht-card">
            <div className="ht-card-head">
              <h2 className="ht-card-title">Exception shortcuts</h2>
            </div>
            <ul className="ht-list">
              <li>
                <Users size={14} />
                <span>In-house guests</span>
                <button type="button" onClick={() => navigate('/guests')}>{inHouse.length}</button>
              </li>
              <li>
                <Wrench size={14} />
                <span>Maintenance rooms</span>
                <button type="button" onClick={() => navigate('/maintenance')}>{roomCounts.maintenance}</button>
              </li>
              <li>
                <CreditCard size={14} />
                <span>Open balances</span>
                <button type="button" onClick={() => navigate('/folios')}>{money(outstanding, currency)}</button>
              </li>
              <li>
                <LogIn size={14} />
                <span>Night audit</span>
                <button type="button" onClick={() => navigate('/night-audit-enterprise')}>Close day</button>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
