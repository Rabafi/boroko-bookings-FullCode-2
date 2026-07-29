import { useState, useEffect } from 'react'
import { useSettings } from '../../app-context'
import { isBarOnlyMode } from '../../../../shared/propertyTypes'

export default function RestaurantShifts() {
  const { settings } = useSettings()
  const barOnly = isBarOnlyMode(settings)
  const [shifts, setShifts] = useState([])
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [staffUserId, setStaffUserId] = useState('')
  const [role, setRole] = useState(barOnly ? 'bar' : 'waiter')
  const [attendancePin, setAttendancePin] = useState('')
  const [expectedHours, setExpectedHours] = useState('8')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState(null)

  useEffect(() => { loadShifts() }, [])

  async function loadShifts() {
    try {
      setLoading(true)
      setError('')
      const [data, users] = await Promise.all([window.api.pos.getActiveShifts(), window.api.pos.getStaff()])
      setShifts(Array.isArray(data) ? data : [])
      setStaff((Array.isArray(users) ? users : []).filter((user) => user?.id && String(user.status || 'active').toLowerCase() === 'active'))
    } catch (err) {
      console.error('Failed to load shifts:', err)
      setError(err.message || 'Could not load active shifts.')
    } finally {
      setLoading(false)
    }
  }

  async function clockIn() {
    if (!staffUserId) { setError('Choose a staff member from the active team list.'); return }
    const selectedStaff = staff.find((user) => user.id === staffUserId)
    if (!selectedStaff?.has_pin) { setError('This staff member needs an approval PIN before using shared-terminal attendance. Set one in Staff Management, then try again.'); return }
    if (!attendancePin.trim()) { setError('The staff member must enter their private attendance PIN.'); return }
    try {
      setBusyId('clock-in')
      setError('')
      setNotice('')
      const result = await window.api.pos.clockInStaffWithAttendancePin({
        staff_user_id: staffUserId,
        pin: attendancePin,
        role,
        expected_hours: Number(expectedHours || 0) || null,
        idempotency_key: crypto.randomUUID()
      })
      if (result?.success === false) throw new Error(result.error || 'Could not clock in staff member.')
      const selected = staff.find((user) => user.id === staffUserId)
      setStaffUserId('')
      setAttendancePin('')
      setNotice(result?.duplicate ? 'That clock-in was already recorded; no duplicate shift was created.' : `${selected?.name || 'Staff member'} clocked in.`)
      await loadShifts()
    } catch (err) {
      console.error('Failed to clock in:', err)
      setError(err.message || 'Could not clock in staff member.')
    } finally {
      setBusyId(null)
    }
  }

  async function clockOut(shiftId) {
    if (!window.confirm('Clock this staff member out now?')) return
    try {
      setBusyId(shiftId)
      setError('')
      setNotice('')
      const result = await window.api.pos.clockOutStaff({ shiftId })
      if (result?.success === false) throw new Error(result.error || 'Could not clock out staff member.')
      setNotice('Staff member clocked out.')
      await loadShifts()
    } catch (err) {
      console.error('Failed to clock out:', err)
      setError(err.message || 'Could not clock out staff member.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="restaurant-native-page">
      <div className="restaurant-native-hero">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shifts</h1>
          <p className="text-sm text-gray-500 mt-1">{barOnly ? 'Shared-terminal attendance for cashiers and bartenders: the manager keeps the board open while each operator enters their private PIN.' : 'Shared-terminal attendance: a floor manager runs the board while each team member enters their own private PIN.'}</p>
        </div>
        <button onClick={loadShifts} className="bb-btn-outline text-sm">Refresh</button>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {notice && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}

      <div className="bb-card p-5 mb-6">
        <h2 className="font-semibold mb-1">Clock in a service team member</h2>
        <p className="mb-3 text-sm text-gray-500">Choose the person, then hand them the device to enter their attendance PIN. The PIN is never displayed or stored here.</p>
        <div className="flex flex-wrap gap-3">
          <label className="min-w-[240px] flex-1 text-sm font-semibold text-gray-700">Staff member
            <select value={staffUserId} onChange={e => setStaffUserId(e.target.value)} className="bb-input mt-1 w-full">
              <option value="">Choose active staff member</option>
              {staff.map((user) => <option key={user.id} value={user.id}>{user.name || user.email} · {user.role || 'staff'}{user.has_pin ? '' : ' · PIN setup required'}</option>)}
            </select>
          </label>
          <select value={role} onChange={e => setRole(e.target.value)} className="bb-input">
            {!barOnly && <option value="waiter">Waiter</option>}
            <option value="cashier">Cashier</option>
            {!barOnly && <option value="kitchen">Kitchen</option>}
            <option value="bar">Bartender</option>
            <option value="manager">Manager</option>
          </select>
          <label className="min-w-[160px] text-sm font-semibold text-gray-700">Expected hours
            <input type="number" min="1" max="24" step="0.5" value={expectedHours} onChange={e => setExpectedHours(e.target.value)} className="bb-input mt-1 w-full" />
          </label>
          <label className="min-w-[220px] flex-1 text-sm font-semibold text-gray-700">Staff attendance PIN
            <input type="password" inputMode="numeric" autoComplete="one-time-code" value={attendancePin} onChange={e => setAttendancePin(e.target.value)} placeholder="Entered by staff member" className="bb-input mt-1 w-full" />
          </label>
          <button onClick={clockIn} className="bb-btn-primary self-end px-5" disabled={!staffUserId || !attendancePin || busyId === 'clock-in'}>
            {busyId === 'clock-in' ? 'Clocking in…' : 'Clock In'}
          </button>
        </div>
        {!loading && staff.length === 0 && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">No active staff accounts are available. Add or reactivate staff in Staff Management before clocking them in.</p>}
      </div>

      <div className="bb-card">
        <div className="p-4 border-b">
          <h2 className="font-semibold">Active Shifts ({shifts.length})</h2>
        </div>
        {loading ? (
          <div className="restaurant-native-loading min-h-[140px]">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
          </div>
        ) : shifts.length === 0 ? (
          <div className="restaurant-native-empty">No active shifts</div>
        ) : (
          <div className="divide-y">
            {shifts.map(s => {
              const duration = s.clock_in ? Math.round((Date.now() - new Date(s.clock_in).getTime()) / 60000) : 0
              return (
                <div key={s.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <span className="font-medium text-sm">{s.staff_name}</span>
                    <span className="ml-2 text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{s.role}</span>
                    <div className="text-xs text-gray-500 mt-0.5">
                      In: {s.clock_in ? new Date(s.clock_in).toLocaleTimeString() : '-'}
                      {duration > 0 && <span className="ml-2">{Math.floor(duration / 60)}h {duration % 60}m</span>}
                    </div>
                  </div>
                  <button onClick={() => clockOut(s.id)} disabled={busyId === s.id} className="bb-btn-outline text-xs px-3">{busyId === s.id ? 'Clocking out…' : 'Clock Out'}</button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
