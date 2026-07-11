import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, AlertTriangle, RefreshCw, Search } from 'lucide-react'
import { Modal } from './shared/Modal'
import { useSettings } from '../app-context'

export default function RoomMoves() {
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

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await window.api.hotel.getInHouse()
      setInHouse(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err?.message || 'Failed to load in-house bookings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!moveSuccess) return
    const timer = setTimeout(() => setMoveSuccess(''), 4000)
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

  const openMoveModal = async (booking) => {
    setSelectedBooking(booking)
    setTargetRoomId('')
    setReason('')
    setMoveError('')
    setShowMoveModal(true)
    setLoadingRooms(true)
    try {
      const rooms = await window.api.roomMoves.getAvailable(booking.room_id, booking.check_in, booking.check_out)
      setAvailableRooms(Array.isArray(rooms) ? rooms : [])
    } catch (err) {
      setMoveError(err?.message || 'Failed to load available rooms')
      setAvailableRooms([])
    } finally {
      setLoadingRooms(false)
    }
  }

  const executeMove = async () => {
    if (!targetRoomId) { setMoveError('Select a target room'); return }
    setMoving(true)
    setMoveError('')
    try {
      const result = await window.api.roomMoves.execute(selectedBooking.id, targetRoomId, reason, settings?.lodge_name || 'Manager')
      if (result?.success === false) {
        setMoveError(result.error || 'Room move failed')
      } else {
        setShowMoveModal(false)
        setMoveSuccess(`Room moved from ${result?.from || '?'} to ${result?.to || '?'}`)
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
          <p className="bb-page-header-subtitle">Move in-house guests to a different room</p>
        </div>
        <button onClick={load} className="btn-secondary"><RefreshCw size={14} /> Refresh</button>
      </div>

      {moveSuccess && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{moveSuccess}</div>}
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
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="py-14 text-center text-sm text-slate-500">No in-house guests</td></tr>
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
                <p className="text-sm text-amber-600">No available rooms for the stay dates</p>
              ) : (
                <select className="input" value={targetRoomId} onChange={(e) => setTargetRoomId(e.target.value)}>
                  <option value="">Select a room</option>
                  {availableRooms.map((r) => (
                    <option key={r.id} value={r.id}>Room {r.room_number} — {r.room_type || 'Standard'} ({`${currency}${Number(r.rate_per_night || 0).toFixed(2)}`}/night)</option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Reason (optional)</label>
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Guest requested upgrade, maintenance needed" />
            </div>

            {moveError && <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-sm text-red-700"><AlertTriangle size={14} className="shrink-0" />{moveError}</div>}

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowMoveModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button type="button" onClick={executeMove} disabled={moving || !targetRoomId} className="btn-primary flex-1">{moving ? 'Moving...' : 'Move Guest'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
