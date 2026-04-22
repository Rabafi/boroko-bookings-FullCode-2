import { useState } from 'react'
import {
  CalendarCheck,
  CalendarX,
  ShoppingCart,
  BookOpen,
  AlertCircle,
  Printer,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  FileDown,
  Table
} from 'lucide-react'
import { useSettings } from '../app-context'

const todayStr = () => new Date().toISOString().split('T')[0]

function fmt(amount, currency) {
  return `${currency} ${Number(amount || 0).toFixed(2)}`
}

function groupEventBookings(list) {
  const isEvent = (b) => b.is_exclusive_event || b.notes?.includes('[GROUP:')
  const regular   = list.filter(b => !isEvent(b))
  const eventRows = list.filter(b => isEvent(b))
  const groupMap  = {}
  eventRows.forEach(b => {
    const match   = b.notes?.match(/\[GROUP:([^\]]+)\]/)
    const groupId = match?.[1] || b.check_in
    if (!groupMap[groupId]) {
      groupMap[groupId] = { ...b, room_count: 0, total_amount: 0, amount_paid: 0, _event_group: true }
    }
    groupMap[groupId].room_count++
    groupMap[groupId].total_amount += Number(b.total_amount || 0)
    groupMap[groupId].amount_paid  += Number(b.amount_paid  || 0)
  })
  return [...regular, ...Object.values(groupMap)]
}

function SummaryCard({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm">
      <div className={`w-10 h-10 rounded-lg ${color} flex items-center justify-center mb-3`}>
        <Icon size={20} />
      </div>
      <p className="text-2xl font-bold text-gray-800">{value}</p>
      <p className="text-sm text-gray-500 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

function Section({ title, count, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-4">
      <button
        className="w-full flex items-center justify-between px-5 py-4 border-b border-gray-100 hover:bg-gray-50 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-semibold text-gray-700">
          {title}
          {count != null && (
            <span className="ml-2 text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
              {count}
            </span>
          )}
        </span>
        {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>
      {open && <div>{children}</div>}
    </div>
  )
}

export default function NightAudit() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'

  const [date, setDate] = useState(todayStr())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [ran, setRan] = useState(false)
  const [savingPDF, setSavingPDF] = useState(false)
  const [savingExcel, setSavingExcel] = useState(false)
  const [success, setSuccess] = useState('')

  const runAudit = async () => {
    setLoading(true)
    setError(null)
    setSuccess('')
    try {
      const result = await window.api.reports.nightAudit(date)
      if (!result) throw new Error('No data returned — check your connection.')
      setData(result)
      setRan(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handlePrint = () => {
    setSuccess('Print dialog opened.')
    setTimeout(() => setSuccess(''), 3000)
    window.print()
  }

  const handleSavePDF = async () => {
    setSavingPDF(true); setError(null); setSuccess('')
    try {
      const res = await window.api.reports.savePDF()
      if (res.success) setSuccess(`PDF saved: ${res.filePath}`)
      else if (res.error) setError(res.error)
    } catch (e) { setError(e.message) }
    finally { setSavingPDF(false); setTimeout(() => setSuccess(''), 5000) }
  }

  const handleSaveExcel = async () => {
    setSavingExcel(true); setError(null); setSuccess('')
    try {
      const res = await window.api.reports.saveNightAuditExcel({
        data: {
          ...data,
          check_ins: groupedCheckIns,
          check_outs: groupedCheckOuts,
          new_bookings: groupedNewBooks,
          outstanding: groupedOutstanding
        },
        date,
        currency
      })
      if (res.success) setSuccess(`Excel saved: ${res.filePath}`)
      else if (res.error) setError(res.error)
    } catch (e) { setError(e.message) }
    finally { setSavingExcel(false); setTimeout(() => setSuccess(''), 5000) }
  }

  const groupedCheckIns  = groupEventBookings(data?.check_ins  || [])
  const groupedCheckOuts = groupEventBookings(data?.check_outs || [])
  const groupedNewBooks  = groupEventBookings(data?.new_bookings || [])
  const groupedOutstanding = groupEventBookings(data?.outstanding || [])

  const totalCheckinRevenue = groupedCheckIns.reduce((s, b) => s + Number(b.total_amount || 0), 0)
  const totalCheckinPaid    = groupedCheckIns.reduce((s, b) => s + Number(b.amount_paid  || 0), 0)

  return (
    <div className="p-6 max-w-5xl print:p-0 print:max-w-full" id="printable-report">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Night Audit</h1>
          <p className="text-gray-500 text-sm mt-0.5">End-of-day summary for a selected date</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={date}
            onChange={(e) => { setDate(e.target.value); setRan(false) }}
            max={todayStr()}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
          />
          <button
            onClick={runAudit}
            disabled={loading}
            className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 text-sm font-medium disabled:opacity-60 transition-colors"
          >
            {loading ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            {loading ? 'Running…' : 'Run Audit'}
          </button>
          
          {ran && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveExcel}
                disabled={savingExcel}
                className="flex items-center gap-2 border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 rounded-lg hover:bg-emerald-100 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                <Table size={14} />
                {savingExcel ? 'Saving...' : 'Excel'}
              </button>
              <button
                onClick={handleSavePDF}
                disabled={savingPDF}
                className="flex items-center gap-2 border border-gray-200 text-gray-600 px-3 py-2 rounded-lg hover:bg-gray-50 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                <FileDown size={14} />
                {savingPDF ? 'Saving...' : 'PDF'}
              </button>
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 border border-gray-200 text-gray-600 px-3 py-2 rounded-lg hover:bg-gray-50 text-xs font-semibold transition-colors"
              >
                <Printer size={14} />
                Print
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Print header */}
      <div className="hidden print:block mb-4 pb-3 border-b border-gray-200">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-xl font-bold">{settings?.lodge_name || 'Boroko Lodge'} — Night Audit</h1>
            <p className="text-sm text-gray-500">Date: {date}</p>
          </div>
          <p className="text-xs text-gray-400">Printed: {new Date().toLocaleString()}</p>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-center gap-3 text-red-700 no-print">
          <AlertCircle size={18} className="shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {success && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 mb-6 text-sm text-emerald-700 no-print">
          ✓ {success}
        </div>
      )}

      {/* Empty state */}
      {!ran && !loading && !error && (
        <div className="bg-white rounded-xl shadow-sm p-16 text-center text-gray-400 no-print">
          <p className="text-4xl mb-3">📋</p>
          <p className="font-medium text-gray-500">Select a date and click Run Audit</p>
          <p className="text-sm mt-1">Get a full end-of-day summary of activity</p>
        </div>
      )}

      {/* Results */}
      {ran && data && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            <SummaryCard
              icon={CalendarCheck}
              label="Check-ins"
              value={groupedCheckIns.length}
              color="bg-teal-50 text-teal-600"
            />
            <SummaryCard
              icon={CalendarX}
              label="Check-outs"
              value={groupedCheckOuts.length}
              color="bg-orange-50 text-orange-600"
            />
            <SummaryCard
              icon={BookOpen}
              label="New Bookings"
              value={groupedNewBooks.length}
              color="bg-blue-50 text-blue-600"
            />
            <SummaryCard
              icon={ShoppingCart}
              label="POS Revenue"
              value={fmt(data.pos_revenue, currency)}
              sub={`${data.pos_orders.length} order${data.pos_orders.length !== 1 ? 's' : ''}`}
              color="bg-purple-50 text-purple-600"
            />
            <SummaryCard
              icon={AlertCircle}
              label="Outstanding"
              value={fmt(data.outstanding_total, currency)}
              sub={`${groupedOutstanding.length} booking${groupedOutstanding.length !== 1 ? 's' : ''}`}
              color="bg-rose-50 text-rose-600"
            />
          </div>

          {/* Check-ins */}
          <Section title="Check-ins Today" count={groupedCheckIns.length}>
            {data.check_ins.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-gray-400">No check-ins for this date.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="px-5 py-3 text-left">#</th>
                      <th className="px-5 py-3 text-left">Guest</th>
                      <th className="px-5 py-3 text-left">Room</th>
                      <th className="px-5 py-3 text-left">Type</th>
                      <th className="px-5 py-3 text-left">Guests</th>
                      <th className="px-5 py-3 text-right">Total</th>
                      <th className="px-5 py-3 text-right">Paid</th>
                      <th className="px-5 py-3 text-left">Payment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {groupedCheckIns.map((b) => {
                      const balance = Math.max(0, Number(b.total_amount || 0) + Number(b.charges_total || 0) - Number(b.amount_paid || 0))
                      return (
                        <tr key={b.id} className="hover:bg-gray-50">
                          <td className="px-5 py-3 font-mono text-xs text-gray-400">{b._event_group ? '—' : (b.booking_number || '—')}</td>
                          <td className="px-5 py-3 font-medium text-gray-800">
                            <div className="flex items-center gap-1.5">
                              {b.customer_name}
                              {b._event_group && <span className="text-[9px] font-bold bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded">EVENT</span>}
                            </div>
                          </td>
                          <td className="px-5 py-3 text-gray-600">{b._event_group ? `${b.room_count} rooms` : `Room ${b.room_number}`}</td>
                          <td className="px-5 py-3 text-gray-500 text-xs">{b.room_type}</td>
                          <td className="px-5 py-3 text-gray-500 text-xs">
                            {b.adults}A{b.children > 0 ? ` ${b.children}C` : ''}
                          </td>
                          <td className="px-5 py-3 text-right font-medium text-gray-800">
                            {fmt(b.total_amount, currency)}
                          </td>
                          <td className="px-5 py-3 text-right text-gray-600">
                            {fmt(b.amount_paid, currency)}
                          </td>
                          <td className="px-5 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              b.payment_status === 'paid'
                                ? 'bg-green-100 text-green-700'
                                : b.payment_status === 'partial'
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-red-100 text-red-700'
                            }`}>
                              {b.payment_status || 'unpaid'}
                              {balance > 0 && ` · Owes ${fmt(balance, currency)}`}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot className="bg-gray-50 text-sm font-semibold text-gray-700">
                    <tr>
                      <td colSpan={5} className="px-5 py-3 text-right">Totals</td>
                      <td className="px-5 py-3 text-right">{fmt(totalCheckinRevenue, currency)}</td>
                      <td className="px-5 py-3 text-right">{fmt(totalCheckinPaid, currency)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Section>

          {/* Check-outs */}
          <Section title="Check-outs Today" count={groupedCheckOuts.length}>
            {data.check_outs.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-gray-400">No check-outs for this date.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="px-5 py-3 text-left">#</th>
                      <th className="px-5 py-3 text-left">Guest</th>
                      <th className="px-5 py-3 text-left">Room</th>
                      <th className="px-5 py-3 text-left">Type</th>
                      <th className="px-5 py-3 text-left">Guests</th>
                      <th className="px-5 py-3 text-right">Total</th>
                      <th className="px-5 py-3 text-right">Paid</th>
                      <th className="px-5 py-3 text-left">Payment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {groupedCheckOuts.map((b) => {
                      const balance = Math.max(0, Number(b.total_amount || 0) + Number(b.charges_total || 0) - Number(b.amount_paid || 0))
                      return (
                        <tr key={b.id} className="hover:bg-gray-50">
                          <td className="px-5 py-3 font-mono text-xs text-gray-400">{b._event_group ? '—' : (b.booking_number || '—')}</td>
                          <td className="px-5 py-3 font-medium text-gray-800">
                            <div className="flex items-center gap-1.5">
                              {b.customer_name}
                              {b._event_group && <span className="text-[9px] font-bold bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded">EVENT</span>}
                            </div>
                          </td>
                          <td className="px-5 py-3 text-gray-600">{b._event_group ? `${b.room_count} rooms` : `Room ${b.room_number}`}</td>
                          <td className="px-5 py-3 text-gray-500 text-xs">{b.room_type}</td>
                          <td className="px-5 py-3 text-gray-500 text-xs">
                            {b.adults}A{b.children > 0 ? ` ${b.children}C` : ''}
                          </td>
                          <td className="px-5 py-3 text-right font-medium text-gray-800">
                            {fmt(b.total_amount, currency)}
                          </td>
                          <td className="px-5 py-3 text-right text-gray-600">
                            {fmt(b.amount_paid, currency)}
                          </td>
                          <td className="px-5 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              b.payment_status === 'paid'
                                ? 'bg-green-100 text-green-700'
                                : b.payment_status === 'partial'
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-red-100 text-red-700'
                            }`}>
                              {b.payment_status || 'unpaid'}
                              {balance > 0 && ` · Owes ${fmt(balance, currency)}`}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* New Bookings */}
          <Section title="New Bookings Created" count={groupedNewBooks.length} defaultOpen={false}>
            {data.new_bookings.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-gray-400">No new bookings created on this date.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="px-5 py-3 text-left">#</th>
                      <th className="px-5 py-3 text-left">Guest</th>
                      <th className="px-5 py-3 text-left">Room</th>
                      <th className="px-5 py-3 text-left">Check-in</th>
                      <th className="px-5 py-3 text-left">Check-out</th>
                      <th className="px-5 py-3 text-right">Total</th>
                      <th className="px-5 py-3 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {groupedNewBooks.map((b) => (
                      <tr key={b.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3 font-mono text-xs text-gray-400">{b._event_group ? '—' : (b.booking_number || '—')}</td>
                        <td className="px-5 py-3 font-medium text-gray-800">
                          <div className="flex items-center gap-1.5">
                            {b.customer_name}
                            {b._event_group && <span className="text-[9px] font-bold bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded">EVENT</span>}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-gray-600">{b._event_group ? `${b.room_count} rooms` : `Room ${b.room_number}`}</td>
                        <td className="px-5 py-3 text-gray-600">{b.check_in}</td>
                        <td className="px-5 py-3 text-gray-600">{b.check_out}</td>
                        <td className="px-5 py-3 text-right font-medium text-gray-800">
                          {fmt(b.total_amount, currency)}
                        </td>
                        <td className="px-5 py-3">
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize">
                            {b.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* POS Orders */}
          <Section title="POS Orders" count={data.pos_orders.length} defaultOpen={false}>
            {data.pos_orders.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-gray-400">No POS orders completed on this date.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="px-5 py-3 text-left">Time</th>
                      <th className="px-5 py-3 text-left">Guest / Walk-in</th>
                      <th className="px-5 py-3 text-left">Items</th>
                      <th className="px-5 py-3 text-left">Payment</th>
                      <th className="px-5 py-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.pos_orders.map((o) => (
                      <tr key={o.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3 text-gray-500 text-xs">
                          {new Date(o.created_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-5 py-3 text-gray-800 font-medium">
                          {o.walk_in_name || (o.room_number ? `Room ${o.room_number}` : '—')}
                        </td>
                        <td className="px-5 py-3 text-gray-500 text-xs">
                          {(o.pos_order_items || []).map((i) => (
                            <span key={i.id} className="inline-block mr-2">
                              {i.quantity}× {i.item_name}
                            </span>
                          ))}
                        </td>
                        <td className="px-5 py-3">
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize">
                            {o.payment_method || '—'}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right font-medium text-gray-800">
                          {fmt(o.total, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 text-sm font-semibold text-gray-700">
                    <tr>
                      <td colSpan={4} className="px-5 py-3 text-right">POS Total</td>
                      <td className="px-5 py-3 text-right">{fmt(data.pos_revenue, currency)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Section>

          {/* Outstanding Balances */}
          <Section title="Outstanding Balances" count={groupedOutstanding.length} defaultOpen={false}>
            {data.outstanding.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-gray-400">No outstanding balances. 🎉</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="px-5 py-3 text-left">#</th>
                      <th className="px-5 py-3 text-left">Guest</th>
                      <th className="px-5 py-3 text-left">Room</th>
                      <th className="px-5 py-3 text-left">Check-in</th>
                      <th className="px-5 py-3 text-left">Check-out</th>
                      <th className="px-5 py-3 text-right">Total</th>
                      <th className="px-5 py-3 text-right">Paid</th>
                      <th className="px-5 py-3 text-right">Balance Due</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {groupedOutstanding.map((b) => {
                      const balance = Math.max(0, Number(b.total_amount || 0) + Number(b.charges_total || 0) - Number(b.amount_paid || 0))
                      return (
                        <tr key={b.id} className="hover:bg-gray-50">
                          <td className="px-5 py-3 font-mono text-xs text-gray-400">{b._event_group ? '—' : (b.booking_number || '—')}</td>
                          <td className="px-5 py-3 font-medium text-gray-800">
                            <div className="flex items-center gap-1.5">
                              {b.customer_name}
                              {b._event_group && <span className="text-[9px] font-bold bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded">EVENT</span>}
                            </div>
                          </td>
                          <td className="px-5 py-3 text-gray-600">{b._event_group ? `${b.room_count} rooms` : `Room ${b.room_number}`}</td>
                          <td className="px-5 py-3 text-gray-500">{b.check_in}</td>
                          <td className="px-5 py-3 text-gray-500">{b.check_out}</td>
                          <td className="px-5 py-3 text-right text-gray-800">{fmt(b.total_amount, currency)}</td>
                          <td className="px-5 py-3 text-right text-gray-600">{fmt(b.amount_paid, currency)}</td>
                          <td className="px-5 py-3 text-right font-semibold text-rose-600">
                            {fmt(balance, currency)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot className="bg-gray-50 text-sm font-semibold text-gray-700">
                    <tr>
                      <td colSpan={7} className="px-5 py-3 text-right">Total Outstanding</td>
                      <td className="px-5 py-3 text-right text-rose-600">{fmt(data.outstanding_total, currency)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  )
}
