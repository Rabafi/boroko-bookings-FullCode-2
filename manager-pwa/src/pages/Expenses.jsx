import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { listExpenses } from '../lib/api'
import { money, shortDate } from '../lib/format'

export default function Expenses() {
  const { user } = useAuth()
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const today = new Date().toISOString().slice(0, 10)
  const monthStart = `${today.slice(0, 7)}-01`

  const load = async () => {
    setLoading(true)
    const data = await listExpenses(user.lodge_id, monthStart, today).catch(() => [])
    setExpenses(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [user.lodge_id])

  const filtered = expenses.filter((expense) => {
    const query = search.toLowerCase()
    return !query || expense.description?.toLowerCase().includes(query) || expense.category?.toLowerCase().includes(query)
  })

  const total = filtered.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-12 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">Expenses</h1>
            <p className="text-xs text-gray-400">This month • {money(total)}</p>
          </div>
          <button onClick={load} className="p-2 text-gray-400"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
        </div>
        <input className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white mt-3" placeholder="Search expenses…" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>

      <div className="px-4 py-4 space-y-3">
        <div className="rounded-2xl border border-blue-900 bg-blue-950/30 px-4 py-3 text-sm text-blue-100">
          Expenses are view-only in the Manager PWA. Use Front Desk or desktop to add or edit entries.
        </div>
        {filtered.map((expense) => (
          <div key={expense.id} className="bg-gray-800 rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">{expense.description}</p>
                <p className="text-xs text-gray-400 mt-1">{expense.category} • {shortDate(expense.date)}</p>
                {expense.notes && <p className="text-xs text-gray-500 mt-2">{expense.notes}</p>}
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-white">{money(expense.amount)}</p>
              </div>
            </div>
          </div>
        ))}
        {!loading && filtered.length === 0 && <p className="text-sm text-gray-500">No expenses found.</p>}
      </div>
    </div>
  )
}
