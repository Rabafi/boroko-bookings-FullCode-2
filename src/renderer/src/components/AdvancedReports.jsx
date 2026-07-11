import { useCallback, useEffect, useState } from 'react'
import { BarChart3, Download, AlertTriangle, RefreshCw } from 'lucide-react'
import { useSettings } from '../app-context'

const REPORT_TYPES = [
  { key: 'occupancy', label: 'Occupancy Report' },
  { key: 'pace', label: 'Booking Pace' },
  { key: 'pickup', label: 'Pickup by Source' },
  { key: 'channelSource', label: 'Revenue by Channel' },
  { key: 'debtorAging', label: 'Debtor Aging Detail' },
  { key: 'ratePerformance', label: 'Rate Performance vs BAR' },
  { key: 'housekeepingProductivity', label: 'Housekeeping Productivity' },
  { key: 'roomDowntime', label: 'Room Downtime Report' },
  { key: 'groupPickup', label: 'Group Block Pickup' },
  { key: 'cancellationNoShow', label: 'Cancellation / No-Show' },
  { key: 'taxVat', label: 'Tax & VAT Report' },
  { key: 'depositLiability', label: 'Deposit Liability' },
  { key: 'folioExceptions', label: 'Folio Exceptions' }
]

function formatCurrency(amount, currency = 'P') {
  return `${currency}${Number(amount || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

function defaultStart() {
  const d = new Date()
  d.setMonth(d.getMonth() - 1)
  return d.toISOString().split('T')[0]
}

function getReportFunction(reportKey) {
  const api = window.api.advancedReports
  const map = {
    occupancy: api.getOccupancy,
    pace: api.getPace,
    pickup: api.getPickup,
    channelSource: api.getChannelSource,
    debtorAging: () => api.getDebtorAging(),
    ratePerformance: api.getRatePerformance,
    housekeepingProductivity: api.getHousekeepingProductivity,
    roomDowntime: api.getRoomDowntime,
    groupPickup: api.getGroupPickup,
    cancellationNoShow: api.getCancellationNoShow,
    taxVat: api.getTaxVat,
    depositLiability: () => api.getDepositLiability(),
    folioExceptions: () => api.getFolioExceptions()
  }
  return map[reportKey]
}

function ReportTable({ title, columns, rows, loading, currency }) {
  if (loading) return <div className="flex items-center justify-center py-10"><div className="h-7 w-7 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" /></div>
  if (!rows || rows.length === 0) return <p className="text-sm text-slate-500 py-6 text-center">No data available.</p>

  const handleExport = () => {
    const headers = columns.map((c) => c.label).join(',')
    const csv = rows.map((r) => columns.map((c) => {
      const val = c.accessor(r)
      return typeof val === 'string' && val.includes(',') ? `"${val}"` : val
    }).join(',')).join('\n')
    const blob = new Blob([`${headers}\n${csv}`], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${title.replace(/\s+/g, '_')}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="bb-card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
        <button onClick={handleExport} className="btn-secondary text-xs"><Download size={12} /> Export CSV</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200">
              {columns.map((col) => <th key={col.key} className="text-left px-2 py-1.5 font-semibold text-slate-500 uppercase tracking-wider">{col.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                {columns.map((col) => <td key={col.key} className="px-2 py-1.5 text-slate-700">{col.accessor(row)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function AdvancedReports({ embedded = false }) {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const [reportType, setReportType] = useState('occupancy')
  const [startDate, setStartDate] = useState(defaultStart)
  const [endDate, setEndDate] = useState(todayStr)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const runReport = useCallback(async () => {
    setLoading(true)
    setError('')
    setData(null)
    try {
      const fn = getReportFunction(reportType)
      if (!fn) { setError('Unknown report type'); return }
      const result = fn.length >= 2 ? await fn(startDate, endDate) : await fn()
      setData(result?.data || result)
    } catch (err) {
      setError(err?.message || 'Report failed')
    } finally {
      setLoading(false)
    }
  }, [reportType, startDate, endDate])

  useEffect(() => { if (reportType) runReport() }, [runReport])

  const renderReport = () => {
    if (!data || error) return null

    switch (reportType) {
      case 'occupancy': {
        const daily = data.daily || []
        const summary = data.summary || {}
        return (
          <>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bb-card text-center py-3"><p className="text-[10px] font-semibold uppercase text-slate-400">Total Room Nights</p><p className="text-lg font-bold text-slate-800">{summary.total_room_nights || 0}</p></div>
              <div className="bb-card text-center py-3"><p className="text-[10px] font-semibold uppercase text-slate-400">Occupied Nights</p><p className="text-lg font-bold text-slate-800">{summary.occupied_room_nights || 0}</p></div>
              <div className="bb-card text-center py-3"><p className="text-[10px] font-semibold uppercase text-slate-400">Avg Occupancy</p><p className="text-lg font-bold text-slate-800">{summary.avg_occupancy || 0}%</p></div>
            </div>
            <ReportTable title="Daily Occupancy" currency={currency} loading={false} rows={daily}
              columns={[
                { key: 'dt', label: 'Date', accessor: (r) => r.dt },
                { key: 'roomType', label: 'Room Type', accessor: (r) => r.room_type_name },
                { key: 'total', label: 'Total Rooms', accessor: (r) => r.total_rooms },
                { key: 'occupied', label: 'Occupied', accessor: (r) => r.occupied },
                { key: 'rate', label: 'Occupancy %', accessor: (r) => `${r.occupancy_rate || Math.round((r.occupied / r.total_rooms) * 100)}%` }
              ]} />
          </>
        )
      }
      case 'pace': {
        const daily = data.daily || []
        return (
          <ReportTable title="Booking Pace" currency={currency} loading={false} rows={daily}
            columns={[
              { key: 'date', label: 'Date', accessor: (r) => r.date },
              { key: 'tyBook', label: 'TY Bookings', accessor: (r) => r.this_year_bookings },
              { key: 'tyRev', label: 'TY Revenue', accessor: (r) => formatCurrency(r.this_year_revenue || 0, currency) },
              { key: 'lyBook', label: 'LY Bookings', accessor: (r) => r.last_year_bookings },
              { key: 'lyRev', label: 'LY Revenue', accessor: (r) => formatCurrency(r.last_year_revenue || 0, currency) },
              { key: 'pace', label: 'Change %', accessor: (r) => r.pace_change_pct != null ? `${r.pace_change_pct}%` : '-' }
            ]} />
        )
      }
      case 'pickup': {
        const sources = data.sources || []
        const totalRevenue = sources.reduce((s, r) => s + (r.revenue || 0), 0)
        return (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bb-card text-center py-3"><p className="text-[10px] font-semibold uppercase text-slate-400">Total Sources</p><p className="text-lg font-bold text-slate-800">{sources.length}</p></div>
              <div className="bb-card text-center py-3"><p className="text-[10px] font-semibold uppercase text-slate-400">Total Revenue</p><p className="text-lg font-bold text-slate-800">{formatCurrency(totalRevenue, currency)}</p></div>
            </div>
            <ReportTable title="Pickup by Source" currency={currency} loading={false} rows={sources}
              columns={[
                { key: 'source', label: 'Source', accessor: (r) => r.source },
                { key: 'count', label: 'Bookings', accessor: (r) => r.booking_count },
                { key: 'revenue', label: 'Revenue', accessor: (r) => formatCurrency(r.revenue || 0, currency) },
                { key: 'avgRate', label: 'Avg Rate', accessor: (r) => formatCurrency(r.avg_rate || 0, currency) }
              ]} />
          </>
        )
      }
      case 'channelSource': {
        const channels = data.channels || []
        return (
          <ReportTable title="Revenue by Channel" currency={currency} loading={false} rows={channels}
            columns={[
              { key: 'channel', label: 'Channel', accessor: (r) => r.channel },
              { key: 'count', label: 'Bookings', accessor: (r) => r.booking_count },
              { key: 'revenue', label: 'Revenue', accessor: (r) => formatCurrency(r.revenue || 0, currency) },
              { key: 'nights', label: 'Avg Nights', accessor: (r) => r.avg_nights },
              { key: 'rate', label: 'Avg Rate', accessor: (r) => formatCurrency(r.avg_rate || 0, currency) }
            ]} />
        )
      }
      case 'debtorAging': {
        const accounts = data.accounts || []
        return (
          <ReportTable title="Debtor Aging" currency={currency} loading={false} rows={accounts}
            columns={[
              { key: 'company', label: 'Company', accessor: (r) => r.company_name },
              { key: 'balance', label: 'Outstanding', accessor: (r) => formatCurrency(r.outstanding_balance || 0, currency) },
              { key: 'current', label: 'Current', accessor: (r) => formatCurrency(r.current || 0, currency) },
              { key: 'd1_30', label: '1-30 Days', accessor: (r) => formatCurrency(r.days_1_30 || 0, currency) },
              { key: 'd31_60', label: '31-60 Days', accessor: (r) => formatCurrency(r.days_31_60 || 0, currency) },
              { key: 'd61_90', label: '61-90 Days', accessor: (r) => formatCurrency(r.days_61_90 || 0, currency) },
              { key: 'd91', label: '91+ Days', accessor: (r) => formatCurrency(r.days_91_plus || 0, currency) }
            ]} />
        )
      }
      case 'cancellationNoShow': {
        const summary = data.summary || {}
        const daily = data.daily || []
        return (
          <>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bb-card text-center py-3"><p className="text-[10px] font-semibold uppercase text-slate-400">Total Bookings</p><p className="text-lg font-bold text-slate-800">{summary.total_bookings || 0}</p></div>
              <div className="bb-card text-center py-3"><p className="text-[10px] font-semibold uppercase text-slate-400">Cancellation Rate</p><p className="text-lg font-bold text-red-600">{summary.cancellation_rate || 0}%</p></div>
              <div className="bb-card text-center py-3"><p className="text-[10px] font-semibold uppercase text-slate-400">No-Show Rate</p><p className="text-lg font-bold text-amber-600">{summary.no_show_rate || 0}%</p></div>
            </div>
            <ReportTable title="Daily Cancellations" currency={currency} loading={false} rows={daily}
              columns={[
                { key: 'date', label: 'Date', accessor: (r) => r.date },
                { key: 'total', label: 'Total', accessor: (r) => r.total },
                { key: 'cancelled', label: 'Cancelled', accessor: (r) => r.cancelled },
                { key: 'noShows', label: 'No-Shows', accessor: (r) => r.no_shows },
                { key: 'cancelRate', label: 'Cancel %', accessor: (r) => `${r.cancellation_rate || 0}%` },
                { key: 'nsRate', label: 'No-Show %', accessor: (r) => `${r.no_show_rate || 0}%` }
              ]} />
          </>
        )
      }
      case 'taxVat': {
        const totalTax = data.total_tax_collected || 0
        const bookingTax = data.booking_tax || []
        const posTax = data.pos_tax || []
        return (
          <>
            <div className="bb-card text-center py-3 mb-4"><p className="text-[10px] font-semibold uppercase text-slate-400">Total Tax Collected</p><p className="text-lg font-bold text-slate-800">{formatCurrency(totalTax, currency)}</p></div>
            {bookingTax.length > 0 && <ReportTable title="Booking Tax" currency={currency} loading={false} rows={bookingTax}
              columns={[
                { key: 'vatRate', label: 'VAT Rate', accessor: (r) => `${r.vat_rate}%` },
                { key: 'count', label: 'Transactions', accessor: (r) => r.transaction_count },
                { key: 'gross', label: 'Gross Amount', accessor: (r) => formatCurrency(r.gross_amount || 0, currency) },
                { key: 'tax', label: 'Tax Amount', accessor: (r) => formatCurrency(r.tax_amount || 0, currency) }
              ]} />}
            {posTax.length > 0 && <ReportTable title="POS Tax" currency={currency} loading={false} rows={posTax}
              columns={[
                { key: 'vatRate', label: 'VAT Rate', accessor: (r) => `${r.vat_rate}%` },
                { key: 'count', label: 'Transactions', accessor: (r) => r.transaction_count },
                { key: 'gross', label: 'Gross Amount', accessor: (r) => formatCurrency(r.gross_amount || 0, currency) },
                { key: 'tax', label: 'Tax Amount', accessor: (r) => formatCurrency(r.tax_amount || 0, currency) }
              ]} />}
          </>
        )
      }
      case 'depositLiability': {
        const breakdown = data.breakdown || []
        return (
          <>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bb-card text-center py-3"><p className="text-[10px] font-semibold uppercase text-slate-400">Total Deposits</p><p className="text-lg font-bold text-slate-800">{formatCurrency(data.total_deposits_collected || 0, currency)}</p></div>
              <div className="bb-card text-center py-3"><p className="text-[10px] font-semibold uppercase text-slate-400">Applied</p><p className="text-lg font-bold text-slate-800">{formatCurrency(data.total_deposits_applied || 0, currency)}</p></div>
              <div className="bb-card text-center py-3"><p className="text-[10px] font-semibold uppercase text-slate-400">Outstanding Liability</p><p className="text-lg font-bold text-amber-600">{formatCurrency(data.outstanding_liability || 0, currency)}</p></div>
            </div>
            <ReportTable title="Deposit Details" currency={currency} loading={false} rows={breakdown}
              columns={[
                { key: 'guest', label: 'Guest', accessor: (r) => r.customer_name || 'N/A' },
                { key: 'checkIn', label: 'Check In', accessor: (r) => r.check_in },
                { key: 'deposit', label: 'Deposit', accessor: (r) => formatCurrency(r.deposit_amount || 0, currency) },
                { key: 'total', label: 'Total', accessor: (r) => formatCurrency(r.total_amount || 0, currency) },
                { key: 'due', label: 'Balance Due', accessor: (r) => formatCurrency(r.balance_due || 0, currency) }
              ]} />
          </>
        )
      }
      case 'folioExceptions': {
        const exceptions = data.exceptions || []
        return (
          <ReportTable title="Folio Exceptions" currency={currency} loading={false} rows={exceptions}
            columns={[
              { key: 'guest', label: 'Guest', accessor: (r) => r.customer_name || 'N/A' },
              { key: 'room', label: 'Room', accessor: (r) => r.room_number || 'N/A' },
              { key: 'charges', label: 'Charges Total', accessor: (r) => formatCurrency(r.charges_total || 0, currency) },
              { key: 'paid', label: 'Amount Paid', accessor: (r) => formatCurrency(r.amount_paid || 0, currency) },
              { key: 'unalloc', label: 'Unallocated', accessor: (r) => formatCurrency(r.unallocated_amount || 0, currency) },
              { key: 'status', label: 'Status', accessor: (r) => r.status }
            ]} />
        )
      }
      case 'ratePerformance': {
        const daily = data.daily || []
        return (
          <ReportTable title="Rate Performance vs BAR" currency={currency} loading={false} rows={daily}
            columns={[
              { key: 'date', label: 'Date', accessor: (r) => r.date },
              { key: 'roomType', label: 'Room Type', accessor: (r) => r.room_type },
              { key: 'avgRate', label: 'Avg Rate', accessor: (r) => formatCurrency(r.avg_rate || 0, currency) },
              { key: 'barRate', label: 'BAR Rate', accessor: (r) => formatCurrency(r.bar_rate || 0, currency) },
              { key: 'premium', label: 'Premium %', accessor: (r) => r.premium_pct != null ? `${r.premium_pct}%` : '-' },
              { key: 'bookings', label: 'Bookings', accessor: (r) => r.bookings_count }
            ]} />
        )
      }
      case 'housekeepingProductivity': {
        const productivity = data.productivity || []
        return (
          <ReportTable title="Housekeeping Productivity" currency={currency} loading={false} rows={productivity}
            columns={[
              { key: 'attendant', label: 'Attendant', accessor: (r) => r.attendant },
              { key: 'cleaned', label: 'Rooms Cleaned', accessor: (r) => r.rooms_cleaned },
              { key: 'first', label: 'First Date', accessor: (r) => r.first_dates || '-' },
              { key: 'last', label: 'Last Date', accessor: (r) => r.last_date || '-' }
            ]} />
        )
      }
      case 'roomDowntime': {
        const rooms = data.rooms || []
        return (
          <ReportTable title="Room Downtime" currency={currency} loading={false} rows={rooms}
            columns={[
              { key: 'room', label: 'Room', accessor: (r) => r.room_number },
              { key: 'type', label: 'Type', accessor: (r) => r.room_type },
              { key: 'days', label: 'Maintenance Days', accessor: (r) => r.maintenance_days },
              { key: 'cost', label: 'Downtime Cost', accessor: (r) => formatCurrency(r.total_downtime_cost || 0, currency) }
            ]} />
        )
      }
      case 'groupPickup': {
        const groups = data.groups || []
        return (
          <ReportTable title="Group Block Pickup" currency={currency} loading={false} rows={groups}
            columns={[
              { key: 'group', label: 'Group', accessor: (r) => r.group_name },
              { key: 'blocked', label: 'Blocked Rooms', accessor: (r) => r.blocked_rooms },
              { key: 'picked', label: 'Picked Up', accessor: (r) => r.picked_up },
              { key: 'pickupPct', label: 'Pickup %', accessor: (r) => `${r.pickup_pct || 0}%` },
              { key: 'revenue', label: 'Revenue', accessor: (r) => formatCurrency(r.revenue || 0, currency) }
            ]} />
        )
      }
      default:
        return <p className="text-sm text-slate-500">Report data not available.</p>
    }
  }

  return (
    <div className={embedded ? '' : 'bb-page'}>
      {!embedded && (
        <div className="bb-page-header">
          <div>
            <p className="bb-section-kicker">ENTERPRISE REPORTS</p>
            <h1 className="bb-page-header-title">Advanced Reports</h1>
          </div>
          <button onClick={runReport} className="btn-secondary"><RefreshCw size={14} /> Refresh</button>
        </div>
      )}
      <div className="bb-card mb-4">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Report Type</label>
            <select className="input" value={reportType} onChange={(e) => setReportType(e.target.value)}>
              {REPORT_TYPES.map((rt) => <option key={rt.key} value={rt.key}>{rt.label}</option>)}
            </select>
          </div>
          <div className="w-44">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Start Date</label>
            <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="w-44">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">End Date</label>
            <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <button onClick={runReport} className="btn-primary h-[38px]"><BarChart3 size={14} /> Run Report</button>
        </div>
      </div>

      {error && <div className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 mb-4"><AlertTriangle size={14} />{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-20"><div className="h-9 w-9 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" /></div>
      ) : data ? (
        renderReport()
      ) : (
        <div className="bb-card flex flex-col items-center justify-center py-16 text-center">
          <BarChart3 size={40} className="mb-3 text-slate-300" />
          <p className="text-sm font-semibold text-slate-600">Select a report type and date range</p>
          <p className="mt-1 text-xs text-slate-400">Click "Run Report" to generate enterprise reports.</p>
        </div>
      )}
    </div>
  )
}
