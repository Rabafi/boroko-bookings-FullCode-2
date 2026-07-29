import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRightLeft, AlertTriangle, RefreshCw, Search } from 'lucide-react'
import { Modal } from './shared/Modal'
import { useSettings } from '../app-context'

export default function RoomMoves() {
  const navigate = useNavigate()
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const [inHouse, setInHouse] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showMoveModal, setShowMoveModal] = useState(false)
  const [selectedBooking, setSelectedBooking] = useState(null)
  const [availableRooms, setAvailableRooms] = useState([])
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [targetRoomId, setTargetRoomId] = useState('')
  const [reason, setReason] = useState('')
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState('')
  const [moveSuccess, setMoveSuccess] = useState('')
  const [query, setQuery] = useState('')
  const [rateImpactNotice, setRateImpactNotice] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (!window.api?.hotel?.getInHouse) throw new Error('In-house API is not available')
      const data = await window.api.hotel.getInHouse()
      setInHouse(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err?.message || 'Failed to load in-house bookings')
      setInHouse([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!moveSuccess) return
    const timer = setTimeout(() => setMoveSuccess(''), 6000)
    return () => clearTimeout(timer)
  }, [moveSuccess])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return inHouse
    return inHouse.filter((b) =>
      [b.customer_name, b.room_number, b.room_type, b.check_in, b.check_out]
        .some((v) => String(v || '').toLowerCase().includes(needle))
    )
  }, [inHouse, query])

  const selectedTarget = useMemo(
    () => availableRooms.find((r) => String(r.id) === String(targetRoomId)) || null,
    [availableRooms, targetRoomId]
  )

  const projectedRateDelta = useMemo(() => {
    if (!selectedBooking || !selectedTarget) return null
    const fromRate = Number(selectedBooking.rate_per_night || 0)
    // Prefer room rate on target; booking may not carry room rate
    const toRate = Number(selectedTarget.rate_per_night || 0)
    if (!fromRate && !toRate) return null
    // When booking has no rate_per_night, compare source room via available list exclusion only
    return toRate - fromRate
  }, [selectedBooking, selectedTarget])

  const openMoveModal = async (booking) => {
    setSelectedBooking(booking)
    setTargetRoomId('')
    setReason('')
    setMoveError('')
    setRateImpactNotice(null)
    setShowMoveModal(true)
    setLoadingRooms(true)
    try {
      if (!window.api?.roomMoves?.getAvailable) throw new Error('Room moves API is not available')
      const rooms = await window.api.roomMoves.getAvailable(booking.room_id, booking.check_in, booking.check_out)
      setAvailableRooms(Array.isArray(rooms) ? rooms : [])
      if (Array.isArray(rooms) && rooms.length === 0) {
        setMoveError('No conflict-free available rooms for these stay dates (dirty/OOO/occupied excluded).')
      }
    } catch (err) {
      setMoveError(err?.message || 'Failed to load available rooms')
      setAvailableRooms([])
    } finally {
      setLoadingRooms(false)
    }
  }

  const executeMove = async () => {
    if (!targetRoomId) { setMoveError('Select a target room'); return }
    const auditReason = String(reason || '').trim()
    if (!auditReason) {
      setMoveError('Room move requires an audit reason')
      return
    }
    setMoving(true)
    setMoveError('')
    try {
      const result = await window.api.roomMoves.execute(
        selectedBooking.id,
        targetRoomId,
        auditReason,
        settings?.lodge_name || 'Manager'
      )
      if (result?.success === false) {
        setMoveError(result.error || 'Room move failed')
      } else {
        setShowMoveModal(false)
        const rateNote = result?.rate_impact
          ? ` Rate impact ${Number(result.rate_delta || 0) >= 0 ? '+' : ''}${currency}${Number(result.rate_delta || 0).toFixed(2)}/night — review guest folio.`
          : ''
        setMoveSuccess(`Room moved from ${result?.from || '?'} to ${result?.to || '?'}.${rateNote}`)
        if (result?.rate_impact || result?.navigate_folio) {
          setRateImpactNotice({
            bookingId: result.booking_id || selectedBooking.id,
            from: result.from,
            to: result.to,
            rateDelta: result.rate_delta
          })
        } else {
          setRateImpactNotice(null)
        }
        load()
      }
    } catch (err) {
      setMoveError(err?.message || 'Room move failed')
    } finally {
      setMoving(false)
    }
  }

  if (loading) return (
    <div className="bb-page">
      <div className="bb-page-header"><p className="bb-section-kicker">HOTEL OPERATIONS</p><h1 className="bb-page-header-title">Room Moves</h1></div>
      <div className="flex items-center justify-center py-20"><div className="h-9 w-9 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" /></div>
    </div>
  )

  return (
    <div className="bb-page">
      <div className="bb-page-header">
        <div>
          <p className="bb-section-kicker">HOTEL OPERATIONS</p>
          <h1 className="bb-page-header-title">Room Moves</h1>
          <p className="bb-page-header-subtitle">Move in-house guests to a different room (audit reason required)</p>
        </div>
        <button onClick={load} className="btn-secondary"><RefreshCw size={14} /> Refresh</button>
      </div>

      {moveSuccess && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{moveSuccess}</div>}
      {rateImpactNotice && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>
            Rate may have changed after move to Room {rateImpactNotice.to}. Confirm charges on the guest folio
            (moves do not auto-rewrite financial totals client-side).
          </span>
          <button
            type="button"
            className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
            onClick={() => navigate('/folios', { state: { focusBookingId: rateImpactNotice.bookingId } })}
          >
            Open folio
          </button>
        </div>
      )}
      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}

      <div className="bb-card p-4">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search guest, room, or dates" />
        </div>
      </div>

      <div className="bb-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3 text-left">Guest</th>
                <th className="px-4 py-3 text-left">Room</th>
                <th className="px-4 py-3 text-left">Check-In</th>
                <th className="px-4 py-3 text-left">Check-Out</th>
                <th className="px-4 py-3 text-right">Rate</th>
                <th className="px-4 py-3 text-center">Move</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-3 font-medium text-slate-700">{b.customer_name || 'Guest'}</td>
                  <td className="px-4 py-3 text-slate-600">{b.room_number || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{b.check_in || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{b.check_out || '—'}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-800">{`${currency}${Number(b.total_amount || 0).toFixed(2)}`}</td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => openMoveModal(b)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                      <ArrowRightLeft size={12} /> Move
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && !error && (
                <tr><td colSpan={6} className="py-14 text-center text-sm text-slate-500">No in-house guests</td></tr>
              )}
              {filtered.length === 0 && error && (
                <tr><td colSpan={6} className="py-14 text-center text-sm text-red-600">Could not load in-house guests — see error above.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showMoveModal && selectedBooking && (
        <Modal title="Move Room" onClose={() => setShowMoveModal(false)}>
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 p-4 text-sm">
              <p className="font-semibold text-slate-800">{selectedBooking.customer_name || 'Guest'}</p>
              <p className="text-slate-500">Currently in Room {selectedBooking.room_number || '—'} · {selectedBooking.check_in} to {selectedBooking.check_out}</p>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Target Room</label>
              {loadingRooms ? (
                <div className="flex items-center justify-center py-6"><div className="h-6 w-6 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" /></div>
              ) : availableRooms.length === 0 ? (
                <p className="text-sm text-amber-700">
                  No available rooms for the stay dates. Conflicts, maintenance, and non-available status rooms are excluded.
                </p>
              ) : (
                <select className="input" value={targetRoomId} onChange={(e) => setTargetRoomId(e.target.value)}>
                  <option value="">Select a room</option>
                  {availableRooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      Room {r.room_number} — {r.room_type || 'Standard'} ({`${currency}${Number(r.rate_per_night || 0).toFixed(2)}`}/night)
                      {r.housekeeping_status && r.housekeeping_status !== 'clean' ? ` · ${r.housekeeping_status}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {selectedTarget && projectedRateDelta != null && Math.abs(projectedRateDelta) > 0.009 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Possible rate impact: {projectedRateDelta >= 0 ? '+' : ''}{currency}{projectedRateDelta.toFixed(2)}/night vs booking base rate.
                After the move you will be prompted to open the folio — financial totals stay server-authoritative.
              </div>
            ) : null}

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Reason <span className="text-red-600">(required)</span>
              </label>
              <input
                className="input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Guest requested upgrade, maintenance needed"
                required
              />
              <p className="mt-1 text-[11px] text-slate-400">Stored on the room move audit log and idempotency payload.</p>
            </div>

            {moveError && (
              <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-sm text-red-700">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{moveError}</span>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowMoveModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button
                type="button"
                onClick={executeMove}
                disabled={moving || !targetRoomId || !String(reason || '').trim()}
                className="btn-primary flex-1"
              >
                {moving ? 'Moving...' : 'Move Guest'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
