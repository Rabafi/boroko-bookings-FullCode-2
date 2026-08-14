import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { listExpenses, listMaintenanceTickets } from '../lib/api'
import { businessDate, money, shortDate } from '../lib/format'
import { isBarHospitalityMode, isRestaurantProductFamily } from '../lib/productShell'

export default function Expenses() {
  const { user } = useAuth()
  const barOnly = isRestaurantProductFamily(user?.product_family) && isBarHospitalityMode(user?.hospitality_mode)
  const [expenses, setExpenses] = useState([])
  const [maintenance, setMaintenance] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [expenseSourceComplete, setExpenseSourceComplete] = useState(true)
  const [search, setSearch] = useState('')
  const today = businessDate()
  const monthStart = `${today.slice(0, 7)}-01`

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    const [expenseData, maintenanceData] = await Promise.all([
      listExpenses(user.lodge_id, monthStart, today).catch((error) => ({ error })),
      barOnly ? Promise.resolve([]) : listMaintenanceTickets(user.lodge_id).catch(() => [])
    ])
    if (expenseData?.error) {
      setExpenses([])
      setExpenseSourceComplete(false)
      setLoadError(expenseData.error?.message || 'Expenses could not be loaded from the server.')
    } else {
      setExpenses(expenseData)
      setExpenseSourceComplete(expenseData?._complete === true)
    }
    setMaintenance(maintenanceData)
    setLoading(false)
  }, [barOnly, monthStart, today, user.lodge_id])

  useEffect(() => { load() }, [load])

  const filtered = expenses.filter((expense) => {
    const query = search.toLowerCase()
    return !query || expense.description?.toLowerCase().includes(query) || expense.category?.toLowerCase().includes(query)
  })
  const monthMaintenance = maintenance.filter((entry) => {
    const day = String(entry.reported_date || entry.created_at || entry.date || '').slice(0, 10)
    return day >= monthStart && day <= today
  })
  const filteredMaintenance = monthMaintenance.filter((entry) => {
    const query = search.toLowerCase()
    const text = [
      entry.title,
      entry.issue,
      entry.description,
      entry.room_number,
      entry.room_type,
      entry.status
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return !query || text.includes(query)
  })

  const manualTotal = filtered.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)
  const maintenanceTotal = filteredMaintenance.reduce((sum, entry) => sum + Number(entry.total_cost || 0), 0)
  const total = manualTotal + maintenanceTotal

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-12 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">Expenses</h1>
            <p className="text-xs text-gray-400">This month • {expenseSourceComplete ? money(total) : 'Unavailable'}</p>
          </div>
          <button onClick={load} className="p-2 text-gray-400"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
        </div>
        <input className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white mt-3" placeholder="Search expenses…" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>

      <div className="px-4 py-4 space-y-3">
        <div className="rounded-2xl border border-blue-900 bg-blue-950/30 px-4 py-3 text-sm text-blue-100">
          {barOnly ? 'Bar operating expenses are view-only in the manager mobile app. Use the desktop Bar app to add or edit entries.' : 'Expenses and maintenance are view-only in the manager mobile app. Use the front desk or desktop to add or edit entries.'}
        </div>
        {!expenseSourceComplete && <div className="rounded-2xl border border-amber-800 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">Expense totals are unavailable until the server source reconnects. No cached estimate is included.</div>}
        {loadError && <div className="rounded-2xl border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">{loadError}</div>}
        {filtered.map((expense) => (
          <div key={expense.id} className="bg-gray-800 rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">{expense.description}</p>
                <p className="text-xs text-gray-400 mt-1">{expense.category} • {shortDate(expense.date)} • {expense.status || 'draft'}</p>
                {expense.notes && <p className="text-xs text-gray-500 mt-2">{expense.notes}</p>}
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-white">{expenseSourceComplete ? money(expense.amount) : 'Unavailable'}</p>
              </div>
            </div>
          </div>
        ))}
        {!loading && filtered.length === 0 && <p className="text-sm text-gray-500">No manual expenses found.</p>}

        {!barOnly && <div className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">Maintenance repairs</p>
              <p className="text-xs text-gray-500 mt-1">Read-only repair costs that are included in reporting.</p>
            </div>
            <p className="text-sm font-bold text-white">{expenseSourceComplete ? money(maintenanceTotal) : 'Unavailable'}</p>
          </div>
          <div className="mt-4 space-y-3">
            {filteredMaintenance.map((entry) => (
              <div key={entry.id} className="rounded-2xl bg-gray-800 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{entry.title || entry.issue || 'Maintenance repair'}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {[entry.room_number ? `Room ${entry.room_number}` : null, entry.status ? entry.status.replace(/_/g, ' ') : null, shortDate(entry.reported_date || entry.created_at || entry.date || today)]
                        .filter(Boolean)
                        .join(' • ')}
                    </p>
                    {entry.description && <p className="text-xs text-gray-500 mt-2">{entry.description}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-white">{expenseSourceComplete ? money(entry.total_cost) : 'Unavailable'}</p>
                  </div>
                </div>
              </div>
            ))}
            {!loading && filteredMaintenance.length === 0 && <p className="text-sm text-gray-500">No maintenance repairs found.</p>}
          </div>
        </div>}
      </div>
    </div>
  )
}
