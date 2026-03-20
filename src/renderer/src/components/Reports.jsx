import { useEffect, useState } from 'react'
import { TrendingUp, BedDouble, DollarSign, Calendar, Download, Printer, FileDown, Table, PiggyBank, ShoppingCart, Package, Building2 } from 'lucide-react'
import { useSettings } from '../App'

function monthStart() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]
}
function monthEnd() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0]
}

function occColor(rate) {
  if (rate >= 70) return { bar: 'bg-green-500',  text: 'text-green-700',  bg: 'bg-green-50' }
  if (rate >= 30) return { bar: 'bg-yellow-400', text: 'text-yellow-700', bg: 'bg-yellow-50' }
  return           { bar: 'bg-red-400',   text: 'text-red-600',   bg: 'bg-red-50' }
}

const PAYMENT_LABELS = {
  cash:  '💵 Cash',
  card:  '💳 Card Swipe',
  folio: '📋 Room Folio'
}

export default function Reports() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'

  const [activeTab, setActiveTab] = useState('bookings')
  const [start, setStart] = useState(monthStart)
  const [end, setEnd]     = useState(monthEnd)

  // Bookings tab
  const [occupancy, setOccupancy] = useState([])
  const [revenue, setRevenue]     = useState(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [savingPDF, setSavingPDF]   = useState(false)
  const [savingXLSX, setSavingXLSX] = useState(false)
  const [pdfSuccess, setPdfSuccess] = useState('')

  // Expenses tab
  const [expenses, setExpenses]     = useState([])
  const [expLoading, setExpLoading] = useState(false)

  // POS Sales tab
  const [posSales, setPosSales]       = useState(null)
  const [posLoading, setPosLoading]   = useState(false)

  // Costs tab
  const [invSpend, setInvSpend]     = useState(null)
  const [supSpend, setSupSpend]     = useState(null)
  const [costsLoading, setCostsLoading] = useState(false)

  // P&L tab
  const [pl, setPl]           = useState(null)
  const [plLoading, setPlLoading] = useState(false)

  useEffect(() => { runReport(start, end) }, [start, end])

  useEffect(() => {
    if (activeTab === 'expenses') {
      setExpLoading(true)
      window.api.expenses.getAll(start, end)
        .then((d) => setExpenses(d || []))
        .catch(() => setExpenses([]))
        .finally(() => setExpLoading(false))
    }
    if (activeTab === 'pos') {
      setPosLoading(true)
      window.api.reports.posSales(start, end)
        .then((d) => setPosSales(d))
        .catch(() => setPosSales(null))
        .finally(() => setPosLoading(false))
    }
    if (activeTab === 'costs') {
      setCostsLoading(true)
      Promise.all([
        window.api.reports.inventorySpend(start, end).catch(() => ({ total: 0, by_category: {}, purchases: [] })),
        window.api.reports.supplySpend(start, end).catch(() => ({ total: 0, purchases: [] }))
      ]).then(([inv, sup]) => {
        setInvSpend(inv)
        setSupSpend(sup)
      }).finally(() => setCostsLoading(false))
    }
    if (activeTab === 'pl') {
      setPlLoading(true)
      window.api.reports.profitLoss(start, end)
        .then((d) => setPl(d))
        .catch(() => setPl(null))
        .finally(() => setPlLoading(false))
    }
  }, [activeTab, start, end])

  const runReport = async (s, e) => {
    if (!s || !e) return
    setLoading(true)
    setError('')
    try {
      const [occ, rev] = await Promise.all([
        window.api.reports.occupancy(s, e),
        window.api.reports.revenue(s, e)
      ])
      setOccupancy(Array.isArray(occ) ? occ : [])
      setRevenue(rev && typeof rev === 'object' ? rev : null)
    } catch (err) {
      setError(`Could not load report: ${err?.message || 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  const exportCSV = () => {
    const totalNights = Math.max(1, Math.ceil((new Date(end) - new Date(start)) / 86400000))
    const avgOcc = occupancy.length
      ? Math.round(occupancy.reduce((s, r) => s + r.occupancy_rate, 0) / occupancy.length) : 0
    const rows = [
      ['Boroko Bookings — Report'],
      [`Period: ${start} to ${end}`],
      [],
      ['REVENUE SUMMARY'],
      ['Total Revenue',      `${currency} ${Number(revenue?.total_revenue || 0).toFixed(2)}`],
      ['Total Bookings',     revenue?.total_bookings || 0],
      ['Avg Booking Value',  `${currency} ${Number(revenue?.avg_booking_value || 0).toFixed(2)}`],
      ['Avg Occupancy Rate', `${avgOcc}%`],
      [],
      ['ROOM OCCUPANCY'],
      ['Room', 'Type', `Rate/Night (${currency})`, 'Nights Occupied', `Period (${totalNights} nights)`, 'Occupancy %', `Revenue (${currency})`]
    ]
    for (const r of occupancy) {
      rows.push([
        `Room ${r.room_number}`, r.room_type,
        Number(r.rate_per_night).toFixed(2), r.occupied_nights, totalNights,
        `${r.occupancy_rate}%`, Number(r.actual_revenue || 0).toFixed(2)
      ])
    }
    const csv = rows.map((r) => r.map((v) => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `boroko-report-${start}-to-${end}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const handleSaveExcel = async () => {
    setSavingXLSX(true); setError('')
    try {
      const result = await window.api.reports.saveExcel({
        occupancy, revenue, expenses, posSales, invSpend, supSpend, profitLoss: pl, start, end, currency
      })
      if (result.success) { setPdfSuccess(`Excel saved: ${result.filePath}`); setTimeout(() => setPdfSuccess(''), 5000) }
      else if (result.error) setError(`Excel export failed: ${result.error}`)
    } catch (err) { setError(`Excel error: ${err?.message}`) }
    setSavingXLSX(false)
  }

  const handleSavePDF = async () => {
    setSavingPDF(true); setPdfSuccess(''); setError('')
    try {
      const result = await window.api.reports.savePDF()
      if (result.success) { setPdfSuccess(`PDF saved: ${result.filePath}`); setTimeout(() => setPdfSuccess(''), 5000) }
      else if (result.error) setError(`PDF failed: ${result.error}`)
    } catch (err) { setError(`PDF error: ${err?.message}`) }
    setSavingPDF(false)
  }

  const totalNights = Math.max(1, Math.ceil((new Date(end) - new Date(start)) / 86400000))
  const avgOccupancy = occupancy.length
    ? Math.round(occupancy.reduce((s, r) => s + r.occupancy_rate, 0) / occupancy.length) : 0
  const collectionRate = revenue?.total_revenue > 0
    ? Math.round((revenue.paid_revenue / revenue.total_revenue) * 100) : 0
  const totalBookingCount = (revenue?.confirmed_count || 0) + (revenue?.checked_in_count || 0) +
    (revenue?.checked_out_count || 0) + (revenue?.cancelled_count || 0)
  const bestRoom = occupancy.length
    ? occupancy.reduce((best, r) => r.occupancy_rate > (best?.occupancy_rate || -1) ? r : best, null) : null

  const PRESETS = [
    { label: 'This Month', fn: () => [monthStart(), monthEnd()] },
    { label: 'Last Month', fn: () => {
        const d = new Date()
        const s = new Date(d.getFullYear(), d.getMonth() - 1, 1)
        const e = new Date(d.getFullYear(), d.getMonth(), 0)
        return [s.toISOString().split('T')[0], e.toISOString().split('T')[0]]
    }},
    { label: 'This Year', fn: () => {
        const y = new Date().getFullYear()
        return [`${y}-01-01`, `${y}-12-31`]
    }}
  ]

  const TABS = [
    ['bookings', '🛏️ Bookings'],
    ['expenses', '💸 Expenses'],
    ['pos',      '🍺 POS Sales'],
    ['costs',    '📦 Stock Costs'],
    ['pl',       '📊 P&L']
  ]

  return (
    <div className="p-6 max-w-5xl" id="printable-report">

      {/* Header */}
      <div className="flex items-center justify-between mb-6 no-print">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">Occupancy, revenue and cost analysis</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCSV} disabled={!revenue || loading}
            className="flex items-center gap-2 border border-gray-200 text-gray-600 px-3 py-2 rounded-lg hover:bg-gray-50 text-sm font-medium disabled:opacity-40 transition-colors">
            <Download size={14} /> CSV
          </button>
          <button onClick={handleSaveExcel} disabled={!revenue || loading || savingXLSX}
            className="flex items-center gap-2 border border-green-300 text-green-700 px-3 py-2 rounded-lg hover:bg-green-50 text-sm font-medium disabled:opacity-40 transition-colors">
            <Table size={14} /> {savingXLSX ? 'Saving…' : 'Excel'}
          </button>
          <button onClick={() => window.print()} disabled={!revenue || loading}
            className="flex items-center gap-2 border border-gray-200 text-gray-600 px-3 py-2 rounded-lg hover:bg-gray-50 text-sm font-medium disabled:opacity-40 transition-colors">
            <Printer size={14} /> Print
          </button>
          <button onClick={handleSavePDF} disabled={!revenue || loading || savingPDF}
            className="flex items-center gap-2 bg-green-600 text-white px-3 py-2 rounded-lg hover:bg-green-700 text-sm font-medium disabled:opacity-40 transition-colors">
            <FileDown size={14} /> {savingPDF ? 'Saving…' : 'Save PDF'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 no-print flex-wrap">
        {TABS.map(([v, l]) => (
          <button key={v} onClick={() => setActiveTab(v)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === v ? 'bg-green-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50 shadow-sm'
            }`}>
            {l}
          </button>
        ))}
      </div>

      {/* Date Range */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-6 flex flex-wrap gap-4 items-end no-print">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
          <input type="date" className="input text-sm" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
          <input type="date" className="input text-sm" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </div>
        {(loading || posLoading || costsLoading || expLoading || plLoading) && (
          <span className="text-sm text-gray-400 italic self-end pb-2">Loading…</span>
        )}
        <div className="flex gap-2 ml-auto">
          {PRESETS.map(({ label, fn }) => (
            <button key={label} onClick={() => { const [s, e] = fn(); setStart(s); setEnd(e) }}
              className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-5 no-print flex items-start gap-2">
          <span>⚠</span><span>{error}</span>
        </div>
      )}
      {pdfSuccess && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-lg mb-5 no-print">
          ✓ {pdfSuccess}
        </div>
      )}

      {/* ── POS SALES TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'pos' && (
        <div>
          {posLoading ? (
            <p className="text-center text-gray-400 py-16 text-sm">Loading POS data…</p>
          ) : !posSales ? (
            <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm">
              <ShoppingCart size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No completed POS orders in this period.</p>
            </div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <SummaryCard icon={DollarSign} label="Total POS Revenue"
                  value={`${currency} ${Number(posSales.total_revenue).toFixed(2)}`}
                  color="bg-green-50 text-green-600" />
                <SummaryCard icon={ShoppingCart} label="Total Orders"
                  value={posSales.total_orders}
                  color="bg-blue-50 text-blue-600" />
                <SummaryCard icon={TrendingUp} label="Avg Order Value"
                  value={`${currency} ${Number(posSales.avg_order).toFixed(2)}`}
                  color="bg-purple-50 text-purple-600" />
              </div>

              {/* Payment method breakdown */}
              {Object.keys(posSales.by_payment).length > 0 && (
                <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
                  <h2 className="font-semibold text-gray-700 mb-4">By Payment Method</h2>
                  <div className="space-y-3">
                    {Object.entries(posSales.by_payment).sort((a, b) => b[1] - a[1]).map(([method, amt]) => {
                      const pct = posSales.total_revenue > 0 ? (amt / posSales.total_revenue) * 100 : 0
                      return (
                        <div key={method} className="flex items-center gap-3">
                          <span className="text-sm text-gray-600 w-36 shrink-0">
                            {PAYMENT_LABELS[method] || method}
                          </span>
                          <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                            <div className="bg-green-500 h-2.5 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-sm font-semibold text-gray-800 w-28 text-right">
                            {currency} {Number(amt).toFixed(2)}
                          </span>
                          <span className="text-xs text-gray-400 w-10">{Math.round(pct)}%</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Top selling items */}
              {posSales.top_items.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
                  <div className="px-5 py-4 border-b border-gray-100">
                    <h2 className="font-semibold text-gray-700">Top Selling Items</h2>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                      <tr>
                        <th className="px-5 py-3 text-left">#</th>
                        <th className="px-5 py-3 text-left">Item</th>
                        <th className="px-5 py-3 text-right">Qty Sold</th>
                        <th className="px-5 py-3 text-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {posSales.top_items.map((item, i) => (
                        <tr key={item.name} className="hover:bg-gray-50">
                          <td className="px-5 py-3 text-gray-400 text-xs font-mono">{i + 1}</td>
                          <td className="px-5 py-3 font-medium text-gray-800">{item.name}</td>
                          <td className="px-5 py-3 text-right text-gray-600">{item.qty}</td>
                          <td className="px-5 py-3 text-right font-semibold text-gray-800">
                            {currency} {Number(item.revenue).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Daily totals */}
              {posSales.daily.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm p-5">
                  <h2 className="font-semibold text-gray-700 mb-4">Daily Sales</h2>
                  <div className="space-y-2">
                    {posSales.daily.map((d) => {
                      const maxDay = Math.max(...posSales.daily.map((x) => x.total))
                      const pct = maxDay > 0 ? (d.total / maxDay) * 100 : 0
                      return (
                        <div key={d.date} className="flex items-center gap-3">
                          <span className="text-xs text-gray-500 w-24 shrink-0">{d.date}</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-2">
                            <div className="bg-green-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs font-semibold text-gray-700 w-24 text-right">
                            {currency} {Number(d.total).toFixed(2)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between text-sm font-bold text-gray-800">
                    <span>Total</span>
                    <span>{currency} {Number(posSales.total_revenue).toFixed(2)}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── COSTS TAB ─────────────────────────────────────────────────────────── */}
      {activeTab === 'costs' && (
        <div>
          {costsLoading ? (
            <p className="text-center text-gray-400 py-16 text-sm">Loading cost data…</p>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <SummaryCard icon={Package} label="Inventory Spend"
                  value={`${currency} ${Number(invSpend?.total || 0).toFixed(2)}`}
                  color="bg-orange-50 text-orange-600" />
                <SummaryCard icon={Package} label="Room Supplies Spend"
                  value={`${currency} ${Number(supSpend?.total || 0).toFixed(2)}`}
                  color="bg-teal-50 text-teal-600" />
                <SummaryCard icon={DollarSign} label="Total Stock Costs"
                  value={`${currency} ${(Number(invSpend?.total || 0) + Number(supSpend?.total || 0)).toFixed(2)}`}
                  color="bg-red-50 text-red-600" />
              </div>

              {/* Inventory by category */}
              {invSpend && Object.keys(invSpend.by_category).length > 0 && (
                <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
                  <h2 className="font-semibold text-gray-700 mb-4">Inventory by Category</h2>
                  <div className="space-y-3">
                    {Object.entries(invSpend.by_category).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => {
                      const pct = invSpend.total > 0 ? (amt / invSpend.total) * 100 : 0
                      return (
                        <div key={cat} className="flex items-center gap-3">
                          <span className="text-xs text-gray-500 w-32 shrink-0 truncate">{cat}</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                            <div className="bg-orange-400 h-2.5 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs font-semibold text-gray-700 w-24 text-right">
                            {currency} {Number(amt).toFixed(2)}
                          </span>
                          <span className="text-xs text-gray-400 w-10">{Math.round(pct)}%</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Inventory purchases table */}
              {invSpend?.purchases?.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
                  <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                    <h2 className="font-semibold text-gray-700">Inventory Purchases</h2>
                    <span className="text-sm font-bold text-gray-800">
                      Total: {currency} {Number(invSpend.total).toFixed(2)}
                    </span>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                      <tr>
                        <th className="px-5 py-3 text-left">Date</th>
                        <th className="px-5 py-3 text-left">Item</th>
                        <th className="px-5 py-3 text-left">Category</th>
                        <th className="px-5 py-3 text-right">Qty</th>
                        <th className="px-5 py-3 text-right">Unit Cost</th>
                        <th className="px-5 py-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {invSpend.purchases.map((p) => (
                        <tr key={p.id} className="hover:bg-gray-50">
                          <td className="px-5 py-2.5 text-gray-500 whitespace-nowrap">
                            {(p.purchased_at || '').split('T')[0]}
                          </td>
                          <td className="px-5 py-2.5 font-medium text-gray-800">
                            {p.inventory_items?.name || '—'}
                          </td>
                          <td className="px-5 py-2.5">
                            <span className="text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-700">
                              {p.inventory_items?.category || '—'}
                            </span>
                          </td>
                          <td className="px-5 py-2.5 text-right text-gray-600">{p.quantity_purchased}</td>
                          <td className="px-5 py-2.5 text-right text-gray-600">
                            {currency} {Number(p.unit_cost || 0).toFixed(2)}
                          </td>
                          <td className="px-5 py-2.5 text-right font-semibold text-gray-800">
                            {currency} {Number(p.total_cost || 0).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Room Supplies purchases table */}
              {supSpend?.purchases?.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                    <h2 className="font-semibold text-gray-700">Room Supplies Purchases</h2>
                    <span className="text-sm font-bold text-gray-800">
                      Total: {currency} {Number(supSpend.total).toFixed(2)}
                    </span>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                      <tr>
                        <th className="px-5 py-3 text-left">Date</th>
                        <th className="px-5 py-3 text-left">Item</th>
                        <th className="px-5 py-3 text-right">Qty</th>
                        <th className="px-5 py-3 text-right">Unit Cost</th>
                        <th className="px-5 py-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {supSpend.purchases.map((p) => (
                        <tr key={p.id} className="hover:bg-gray-50">
                          <td className="px-5 py-2.5 text-gray-500 whitespace-nowrap">
                            {(p.purchased_at || '').split('T')[0]}
                          </td>
                          <td className="px-5 py-2.5 font-medium text-gray-800">
                            {p.supply_items?.name || '—'}
                          </td>
                          <td className="px-5 py-2.5 text-right text-gray-600">{p.quantity_purchased}</td>
                          <td className="px-5 py-2.5 text-right text-gray-600">
                            {currency} {Number(p.unit_cost || 0).toFixed(2)}
                          </td>
                          <td className="px-5 py-2.5 text-right font-semibold text-gray-800">
                            {currency} {Number(p.total_cost || 0).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {(!invSpend?.purchases?.length && !supSpend?.purchases?.length) && (
                <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm">
                  <Package size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No stock purchases recorded in this period.</p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── EXPENSES TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'expenses' && (() => {
        const byCategory = expenses.reduce((acc, e) => {
          acc[e.category] = (acc[e.category] || 0) + Number(e.amount || 0)
          return acc
        }, {})
        const total = expenses.reduce((s, e) => s + Number(e.amount || 0), 0)
        return (
          <div>
            {expLoading ? (
              <p className="text-center text-gray-400 py-16 text-sm">Loading...</p>
            ) : (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  {Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([cat, amt]) => (
                    <div key={cat} className="bg-white rounded-xl p-4 shadow-sm">
                      <p className="text-xl font-bold text-gray-800">{currency} {Number(amt).toFixed(2)}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{cat}</p>
                    </div>
                  ))}
                  {Object.keys(byCategory).length === 0 && (
                    <div className="col-span-4 bg-white rounded-xl p-4 shadow-sm">
                      <p className="text-xl font-bold text-gray-800">{currency} 0.00</p>
                      <p className="text-xs text-gray-500 mt-0.5">No expenses recorded</p>
                    </div>
                  )}
                </div>
                <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
                  <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                    <h2 className="font-semibold text-gray-700">Expense Breakdown</h2>
                    <span className="text-sm font-bold text-gray-800">Total: {currency} {total.toFixed(2)}</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                      <tr>
                        <th className="px-5 py-3 text-left">Date</th>
                        <th className="px-5 py-3 text-left">Description</th>
                        <th className="px-5 py-3 text-left">Category</th>
                        <th className="px-5 py-3 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {expenses.map((e) => (
                        <tr key={e.id} className="hover:bg-gray-50">
                          <td className="px-5 py-2.5 text-gray-500 whitespace-nowrap">{e.date}</td>
                          <td className="px-5 py-2.5 text-gray-800">{e.description}</td>
                          <td className="px-5 py-2.5">
                            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{e.category}</span>
                          </td>
                          <td className="px-5 py-2.5 text-right font-semibold text-gray-800">
                            {currency} {Number(e.amount).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                      {expenses.length === 0 && (
                        <tr><td colSpan={4} className="px-5 py-10 text-center text-gray-400">No expenses for this period.</td></tr>
                      )}
                    </tbody>
                    {expenses.length > 0 && (
                      <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                        <tr>
                          <td colSpan={3} className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Total</td>
                          <td className="px-5 py-3 text-right text-sm font-bold text-gray-800">
                            {currency} {total.toFixed(2)}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
                {Object.keys(byCategory).length > 0 && (
                  <div className="bg-white rounded-xl shadow-sm p-5">
                    <h2 className="font-semibold text-gray-700 mb-4">By Category</h2>
                    <div className="space-y-3">
                      {Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => {
                        const pct = total > 0 ? (amt / total) * 100 : 0
                        return (
                          <div key={cat} className="flex items-center gap-3">
                            <span className="text-xs text-gray-500 w-36 shrink-0 truncate">{cat}</span>
                            <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                              <div className="bg-blue-500 h-2.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs font-semibold text-gray-700 w-24 text-right">
                              {currency} {Number(amt).toFixed(2)}
                            </span>
                            <span className="text-xs text-gray-400 w-10">{Math.round(pct)}%</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )
      })()}

      {/* ── BOOKINGS TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'bookings' && <>

      <div className="print-only mb-6 pb-4 border-b-2 border-green-700 text-center">
        <h2 className="text-xl font-bold text-gray-800">
          {settings?.lodge_name || 'Lodge'} — Occupancy &amp; Revenue Report
        </h2>
        <p className="text-sm text-gray-500 mt-1">Period: {start} to {end}</p>
      </div>

      {revenue && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <SummaryCard icon={DollarSign}  label="Total Revenue"
            value={`${currency} ${Number(revenue.total_revenue || 0).toFixed(2)}`}
            color="bg-green-50 text-green-600" />
          <SummaryCard icon={Calendar}    label="Total Bookings"
            value={revenue.total_bookings || 0}
            color="bg-blue-50 text-blue-600" />
          <SummaryCard icon={TrendingUp}  label="Avg Booking Value"
            value={`${currency} ${Number(revenue.avg_booking_value || 0).toFixed(2)}`}
            color="bg-purple-50 text-purple-600" />
          <SummaryCard icon={BedDouble}   label="Avg Occupancy"
            value={`${avgOccupancy}%`}
            color="bg-orange-50 text-orange-600" />
          <SummaryCard icon={PiggyBank}   label="Collection Rate"
            value={`${collectionRate}%`}
            sub={`${currency} ${Number(revenue.paid_revenue || 0).toFixed(2)} collected`}
            color={collectionRate >= 80 ? 'bg-green-50 text-green-600' : collectionRate >= 50 ? 'bg-yellow-50 text-yellow-600' : 'bg-red-50 text-red-500'} />
        </div>
      )}

      {revenue?.vat_enabled && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 mb-6 flex flex-wrap gap-6 text-sm">
          <span className="text-amber-700 font-medium">VAT ({revenue.vat_rate}% inclusive)</span>
          <span className="text-gray-600">Gross: <span className="font-semibold text-gray-800">{currency} {Number(revenue.total_revenue || 0).toFixed(2)}</span></span>
          <span className="text-gray-600">VAT portion: <span className="font-semibold text-amber-700">{currency} {Number(revenue.vat_amount || 0).toFixed(2)}</span></span>
          <span className="text-gray-600">Net (excl. VAT): <span className="font-semibold text-gray-800">{currency} {Number(revenue.net_revenue || 0).toFixed(2)}</span></span>
        </div>
      )}

      {revenue && (
        <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
          <h2 className="font-semibold text-gray-700 mb-4">Booking Status Breakdown</h2>
          <div className="space-y-3">
            {[
              { label: 'Confirmed',   count: revenue.confirmed_count   || 0, color: 'bg-blue-500' },
              { label: 'Checked In',  count: revenue.checked_in_count  || 0, color: 'bg-green-500' },
              { label: 'Checked Out', count: revenue.checked_out_count || 0, color: 'bg-gray-400' },
              { label: 'Cancelled',   count: revenue.cancelled_count   || 0, color: 'bg-red-400' }
            ].map(({ label, count, color }) => {
              const pct = totalBookingCount > 0 ? Math.round((count / totalBookingCount) * 100) : 0
              return (
                <div key={label} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-24 shrink-0">{label}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                    <div className={`${color} h-2.5 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-gray-700 w-8 text-right">{count}</span>
                  <span className="text-xs text-gray-400 w-8">{pct}%</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {revenue && revenue.paid_revenue !== undefined && (
        <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
          <h2 className="font-semibold text-gray-700 mb-4">💰 Payment Summary</h2>
          <div className="mb-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Collected: <span className="font-semibold text-green-700">{currency} {Number(revenue.paid_revenue || 0).toFixed(2)}</span></span>
              <span>Outstanding: <span className="font-semibold text-red-600">{currency} {Number(revenue.outstanding_amount || 0).toFixed(2)}</span></span>
            </div>
            <div className="bg-gray-100 rounded-full h-3">
              <div className="bg-green-500 h-3 rounded-full transition-all" style={{ width: `${collectionRate}%` }} />
            </div>
            <p className="text-xs text-gray-400 mt-1 text-right">{collectionRate}% of revenue collected</p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <StatusStat label="Paid"    value={revenue.paid_count    || 0} color="bg-green-500" />
            <StatusStat label="Partial" value={revenue.partial_count || 0} color="bg-yellow-400" />
            <StatusStat label="Unpaid"  value={revenue.unpaid_count  || 0} color="bg-red-400" />
          </div>
        </div>
      )}

      {revenue?.event_count > 0 && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-5 mb-6">
          <h2 className="text-sm font-semibold text-indigo-800 mb-3 flex items-center gap-2">
            <Building2 size={15} /> Exclusive Events ({revenue.event_count})
          </h2>
          <div className="space-y-2">
            {revenue.event_bookings.map(evt => (
              <div key={evt.group_id} className="flex items-center justify-between text-sm">
                <span className="text-gray-600">
                  {evt.check_in} → {evt.check_out}
                  <span className="ml-2 text-xs text-indigo-500">
                    {evt.nights} night{evt.nights !== 1 ? 's' : ''} · {evt.room_count} room{evt.room_count !== 1 ? 's' : ''}
                  </span>
                </span>
                <span className="font-semibold text-indigo-700">
                  {currency} {Number(evt.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  <span className="text-xs text-indigo-400 ml-1.5">
                    ({currency} {Number(evt.daily_rate).toLocaleString()}/night)
                  </span>
                </span>
              </div>
            ))}
            <div className="border-t border-indigo-200 pt-2 flex justify-between text-sm font-semibold text-indigo-800">
              <span>Event Revenue Total</span>
              <span>{currency} {Number(revenue.event_revenue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-700">Room Occupancy — {totalNights}-day period</h2>
          {bestRoom && bestRoom.occupancy_rate > 0 && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">
              🏆 Best: Room {bestRoom.room_number} ({bestRoom.occupancy_rate}%)
            </span>
          )}
        </div>
        <div className="px-5 py-2 bg-gray-50 border-b border-gray-100 flex gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" /> 70%+ High</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-yellow-400 inline-block" /> 30–69% Medium</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block" /> &lt;30% Low</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-5 py-3 text-left">Room</th>
                <th className="px-5 py-3 text-left">Type</th>
                <th className="px-5 py-3 text-left">Rate / Night</th>
                <th className="px-5 py-3 text-left">Nights Booked</th>
                <th className="px-5 py-3 text-left w-48">Occupancy</th>
                <th className="px-5 py-3 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading && <tr><td colSpan={6} className="px-5 py-10 text-center text-gray-400">Loading…</td></tr>}
              {!loading && occupancy.map((room) => {
                const col = occColor(room.occupancy_rate)
                const isBest = bestRoom?.id === room.id && room.occupancy_rate > 0
                return (
                  <tr key={room.id} className={`hover:bg-gray-50 ${isBest ? 'bg-green-50/30' : ''}`}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-800">Room {room.room_number}</span>
                        {isBest && <span className="text-[10px] text-green-600">🏆</span>}
                        {room.has_event && <span className="text-[9px] font-bold bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded">EVENT</span>}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-gray-600">{room.room_type}</td>
                    <td className="px-5 py-3 text-gray-600">{currency} {Number(room.rate_per_night).toFixed(2)}</td>
                    <td className="px-5 py-3 text-gray-600">{room.occupied_nights} / {totalNights}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                          <div className={`${col.bar} h-2.5 rounded-full transition-all`} style={{ width: `${room.occupancy_rate}%` }} />
                        </div>
                        <span className={`text-xs font-semibold w-10 text-right ${col.text}`}>{room.occupancy_rate}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-gray-800">
                      {currency} {Number(room.actual_revenue || 0).toFixed(2)}
                    </td>
                  </tr>
                )
              })}
              {!loading && occupancy.length === 0 && !error && (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-gray-400">No data for selected period.</td></tr>
              )}
            </tbody>
            {!loading && occupancy.length > 0 && (
              <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                <tr>
                  <td colSpan={3} className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Totals / Averages</td>
                  <td className="px-5 py-3 text-sm font-semibold text-gray-700">
                    {occupancy.reduce((s, r) => s + r.occupied_nights, 0)} nights total
                  </td>
                  <td className="px-5 py-3 text-sm font-semibold text-gray-700">{avgOccupancy}% avg</td>
                  <td className="px-5 py-3 text-right text-sm font-bold text-green-700">
                    {currency} {occupancy.reduce((s, r) => s + (r.actual_revenue || 0), 0).toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      </>}

      {/* ── P&L TAB ──────────────────────────────────────────────────────────── */}
      {activeTab === 'pl' && (
        <div>
          {plLoading ? (
            <p className="text-center text-gray-400 py-16 text-sm">Loading P&amp;L…</p>
          ) : !pl ? (
            <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm">
              <p className="text-sm">No data available for this period.</p>
            </div>
          ) : (
            <>
              {/* Revenue */}
              <div className="bg-white rounded-xl shadow-sm p-5 mb-4">
                <h2 className="font-semibold text-gray-700 mb-4 text-sm uppercase tracking-wide">Revenue</h2>
                <div className="space-y-2">
                  <PLRow label="Booking Revenue" value={`${currency} ${Number(pl.bookingRevenue).toFixed(2)}`} />
                  <PLRow label="POS Revenue"     value={`${currency} ${Number(pl.posRevenue).toFixed(2)}`} />
                  <PLRow label="Total Revenue" value={`${currency} ${Number(pl.totalRevenue).toFixed(2)}`} bold />
                  {pl.vatEnabled && <>
                    <PLRow label={`VAT (${pl.vatRate}% inclusive)`} value={`- ${currency} ${Number(pl.vatAmount).toFixed(2)}`} muted />
                    <PLRow label="Net Revenue (excl. VAT)" value={`${currency} ${Number(pl.netRevenue).toFixed(2)}`} muted />
                  </>}
                </div>
              </div>

              {/* Expenses */}
              <div className="bg-white rounded-xl shadow-sm p-5 mb-4">
                <h2 className="font-semibold text-gray-700 mb-4 text-sm uppercase tracking-wide">Operating Expenses</h2>
                <div className="space-y-2">
                  {Object.entries(pl.expByCategory || {}).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
                    <PLRow key={cat} label={cat} value={`${currency} ${Number(amt).toFixed(2)}`} />
                  ))}
                  {Object.keys(pl.expByCategory || {}).length === 0 && (
                    <p className="text-sm text-gray-400">No expenses recorded.</p>
                  )}
                  <PLRow label="Total Expenses" value={`${currency} ${Number(pl.totalExpenses).toFixed(2)}`} bold />
                </div>
              </div>

              {/* Stock Costs */}
              <div className="bg-white rounded-xl shadow-sm p-5 mb-4">
                <h2 className="font-semibold text-gray-700 mb-4 text-sm uppercase tracking-wide">Stock Costs</h2>
                <div className="space-y-2">
                  <PLRow label="Inventory Purchases" value={`${currency} ${Number(pl.invCosts).toFixed(2)}`} />
                  <PLRow label="Room Supplies"       value={`${currency} ${Number(pl.supCosts).toFixed(2)}`} />
                  <PLRow label="Total Stock Costs"   value={`${currency} ${Number(pl.totalCosts).toFixed(2)}`} bold />
                </div>
              </div>

              {/* Gross Profit */}
              <div className={`rounded-xl p-5 ${pl.grossProfit >= 0 ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-base font-bold ${pl.grossProfit >= 0 ? 'text-green-800' : 'text-red-800'}`}>
                    Gross Profit
                  </span>
                  <span className={`text-xl font-bold ${pl.grossProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {pl.grossProfit < 0 ? '- ' : ''}{currency} {Math.abs(pl.grossProfit).toFixed(2)}
                  </span>
                </div>
                <p className="text-xs mt-1 text-gray-500">Revenue − Expenses − Stock Costs</p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function PLRow({ label, value, bold, muted }) {
  return (
    <div className={`flex justify-between text-sm py-1 border-b border-gray-50 ${bold ? 'font-semibold border-t border-gray-200 pt-2' : ''} ${muted ? 'text-gray-400' : 'text-gray-700'}`}>
      <span>{label}</span>
      <span className={bold ? 'text-gray-900' : ''}>{value}</span>
    </div>
  )
}

function SummaryCard({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm">
      <div className={`w-9 h-9 rounded-lg ${color} flex items-center justify-center mb-2`}>
        <Icon size={17} />
      </div>
      <p className="text-xl font-bold text-gray-800">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function StatusStat({ label, value, color }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-2.5 h-2.5 rounded-full ${color} flex-shrink-0`} />
      <div>
        <p className="text-lg font-bold text-gray-800">{value}</p>
        <p className="text-xs text-gray-500">{label}</p>
      </div>
    </div>
  )
}
