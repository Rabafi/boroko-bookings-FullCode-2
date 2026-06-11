import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getNightAudit } from '../lib/api'
import { money, paymentStatusClass, shortDate, titleCase } from '../lib/format'

export default function Audit() {
  const { user } = useAuth()
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  const runAudit = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await getNightAudit(user.lodge_id, date)
      setData(result)
    } catch (nextError) {
      setError(nextError.message || 'Could not run the night audit.')
    }
    setLoading(false)
  }

  const sections = [
    ['Check-ins', data?.check_ins || []],
    ['Check-outs', data?.check_outs || []],
    ['New Bookings', data?.new_bookings || []],
    ['Outstanding', data?.outstanding || []]
  ]

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-12 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">Night Audit</h1>
            <p className="text-xs text-gray-400">End-of-day operations and money summary</p>
          </div>
          <button onClick={runAudit} className="p-2 text-gray-400"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
        </div>
        <div className="flex gap-2 mt-3">
          <input className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <button onClick={runAudit} className="bg-green-700 text-white rounded-xl px-4 py-2.5 text-sm font-semibold">Run</button>
        </div>
      </div>

      <div className="px-4 py-4 space-y-3">
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {data && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-800 rounded-2xl p-4">
              <p className="text-xs text-gray-400">Gross Collected</p>
              <p className="text-xl font-bold text-white mt-1">{money(data.gross_collected)}</p>
            </div>
            <div className="bg-gray-800 rounded-2xl p-4">
              <p className="text-xs text-gray-400">Refunds</p>
              <p className="text-xl font-bold text-rose-300 mt-1">{money(data.refunds_issued)}</p>
            </div>
            <div className="bg-gray-800 rounded-2xl p-4">
              <p className="text-xs text-gray-400">Net Cash</p>
              <p className="text-xl font-bold text-green-300 mt-1">{money(data.net_collected)}</p>
            </div>
            <div className="bg-gray-800 rounded-2xl p-4">
              <p className="text-xs text-gray-400">Expenses</p>
              <p className="text-xl font-bold text-red-300 mt-1">{money(data.expenses_total)}</p>
            </div>
            <div className="bg-gray-800 rounded-2xl p-4">
              <p className="text-xs text-gray-400">POS Revenue</p>
              <p className="text-xl font-bold text-white mt-1">{money(data.pos_revenue)}</p>
            </div>
            <div className="bg-gray-800 rounded-2xl p-4">
              <p className="text-xs text-gray-400">Outstanding</p>
              <p className="text-xl font-bold text-yellow-300 mt-1">{money(data.outstanding_total)}</p>
            </div>
          </div>
        )}

        {sections.map(([title, rows]) => (
          <div key={title} className="bg-gray-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-white">{title}</p>
              <span className="text-xs text-gray-500">{rows.length}</span>
            </div>
            <div className="space-y-2">
              {rows.slice(0, 8).map((row) => (
                <div key={row.id} className="bg-gray-900 rounded-xl px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{row.customer_name || row.guest_name || 'Guest'}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {row.room_number ? `Room ${row.room_number}` : 'Room pending'} • {shortDate(row.check_in)} → {shortDate(row.check_out)}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${paymentStatusClass(row.payment_status)}`}>
                      {titleCase(row.payment_status || row.status)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-2 text-xs">
                    <span className="text-gray-400">Total</span>
                    <span className="text-white">{money(Number(row.total_amount || 0) + Number(row.charges_total || 0))}</span>
                  </div>
                </div>
              ))}
              {rows.length === 0 && <p className="text-sm text-gray-500">Nothing to show for this section.</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
