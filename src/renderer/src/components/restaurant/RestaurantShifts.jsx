import { useState, useEffect } from 'react'

export default function RestaurantShifts() {
  const [shifts, setShifts] = useState([])
  const [loading, setLoading] = useState(true)
  const [staffName, setStaffName] = useState('')
  const [role, setRole] = useState('waiter')

  useEffect(() => { loadShifts() }, [])

  async function loadShifts() {
    try {
      setLoading(true)
      const data = await window.api.pos.getActiveShifts()
      setShifts(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Failed to load shifts:', err)
    } finally {
      setLoading(false)
    }
  }

  async function clockIn() {
    if (!staffName.trim()) return
    try {
      await window.api.pos.clockInStaff({ staff_name: staffName.trim(), role })
      setStaffName('')
      await loadShifts()
    } catch (err) {
      console.error('Failed to clock in:', err)
    }
  }

  async function clockOut(shiftId) {
    try {
      await window.api.pos.clockOutStaff({ shiftId })
      await loadShifts()
    } catch (err) {
      console.error('Failed to clock out:', err)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shifts</h1>
          <p className="text-sm text-gray-500 mt-1">Staff clock-in/out and active shifts</p>
        </div>
        <button onClick={loadShifts} className="bb-btn-outline text-sm">Refresh</button>
      </div>

      <div className="bb-card p-5 mb-6">
        <h2 className="font-semibold mb-3">Clock In</h2>
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Staff name"
            value={staffName}
            onChange={e => setStaffName(e.target.value)}
            className="bb-input flex-1"
          />
          <select value={role} onChange={e => setRole(e.target.value)} className="bb-input">
            <option value="waiter">Waiter</option>
            <option value="cashier">Cashier</option>
            <option value="kitchen">Kitchen</option>
            <option value="bar">Bar</option>
            <option value="manager">Manager</option>
          </select>
          <button onClick={clockIn} className="bb-btn-primary" disabled={!staffName.trim()}>
            Clock In
          </button>
        </div>
      </div>

      <div className="bb-card">
        <div className="p-4 border-b">
          <h2 className="font-semibold">Active Shifts ({shifts.length})</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
          </div>
        ) : shifts.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No active shifts</div>
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
                  <button onClick={() => clockOut(s.id)} className="bb-btn-outline text-xs">Clock Out</button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
