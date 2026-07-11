import { useState, useEffect } from 'react'
import { Clock, LogIn, LogOut, Users as UsersIcon } from 'lucide-react'

export default function Staff({ user }) {
  const [shifts, setShifts] = useState([])
  const [activeShifts, setActiveShifts] = useState([])
  const [staffUsers, setStaffUsers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [s, a, u] = await Promise.all([
        window.barAPI.getShifts().catch(() => []),
        window.barAPI.getActiveShifts().catch(() => []),
        window.barAPI.getUsers().catch(() => [])
      ])
      setShifts(s)
      setActiveShifts(a)
      setStaffUsers(u)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  async function handleClockIn() {
    try {
      await window.barAPI.clockIn(user.id, 'main')
      loadData()
    } catch (err) { alert('Clock in failed: ' + (err?.message || '')) }
  }

  async function handleClockOut(shiftId) {
    try {
      await window.barAPI.clockOut(shiftId)
      loadData()
    } catch (err) { alert('Clock out failed: ' + (err?.message || '')) }
  }

  const myActiveShift = activeShifts.find(s => s.user_id === user?.id)

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 p-3 border-b border-stone-800">
        <h1 className="text-base font-semibold">Staff</h1>
        <button onClick={loadData} className="btn-ghost text-xs px-2 py-1">
          <Clock className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* My shift */}
        <div className="card">
          <h2 className="text-sm font-medium text-stone-300 mb-3">My Shift</h2>
          {myActiveShift ? (
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-stone-500">Clocked in at</div>
                <div className="text-sm font-mono text-stone-200">{new Date(myActiveShift.clock_in).toLocaleString()}</div>
              </div>
              <button onClick={() => handleClockOut(myActiveShift.id)} className="btn-danger text-xs">
                <LogOut className="w-3.5 h-3.5" /> Clock Out
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-sm text-stone-500">Not clocked in</span>
              <button onClick={handleClockIn} className="btn-primary text-xs">
                <LogIn className="w-3.5 h-3.5" /> Clock In
              </button>
            </div>
          )}
        </div>

        {/* Active shifts */}
        <div>
          <h2 className="text-sm font-medium text-stone-300 mb-3">Active Shifts ({activeShifts.length})</h2>
          {activeShifts.length === 0 ? (
            <p className="text-sm text-stone-600">No active shifts</p>
          ) : (
            <div className="space-y-1.5">
              {activeShifts.map(shift => {
                const staff = staffUsers.find(u => u.id === shift.user_id)
                return (
                  <div key={shift.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-stone-800/20">
                    <div>
                      <div className="text-sm text-stone-200">{staff?.name || 'Unknown'}</div>
                      <div className="text-[10px] text-stone-600">{staff?.role} — since {new Date(shift.clock_in).toLocaleTimeString()}</div>
                    </div>
                    <button onClick={() => handleClockOut(shift.id)} className="btn-ghost text-xs px-2 py-1">
                      Clock out
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Shift history */}
        <div>
          <h2 className="text-sm font-medium text-stone-300 mb-3">Recent Shifts</h2>
          {loading ? (
            <div className="flex items-center justify-center py-8"><div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : shifts.length === 0 ? (
            <p className="text-sm text-stone-600">No shifts recorded</p>
          ) : (
            <div className="space-y-1">
              {shifts.slice(0, 20).map(shift => {
                const staff = staffUsers.find(u => u.id === shift.user_id)
                const duration = shift.clock_out
                  ? Math.round((new Date(shift.clock_out) - new Date(shift.clock_in)) / 3600000 * 10) / 10
                  : null
                return (
                  <div key={shift.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-stone-800/10 text-xs text-stone-500">
                    <span>{staff?.name || 'Unknown'}</span>
                    <span className="font-mono">{new Date(shift.clock_in).toLocaleDateString()} {new Date(shift.clock_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {duration && <span className="font-mono">{duration}h</span>}
                    {!shift.clock_out && <span className="badge-green text-[10px]">Active</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
