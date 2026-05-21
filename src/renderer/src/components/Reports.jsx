import { useEffect, useMemo, useState } from 'react'
import { TrendingUp, BedDouble, DollarSign, Calendar, Download, Printer, FileDown, Table, PiggyBank, ShoppingCart, Package, Building2, CreditCard, Presentation, Briefcase } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { formatPaymentMethod } from '../constants/paymentMethods'
import { useSettings, useAccess } from '../app-context'
import HorizontalScrollArea from './shared/HorizontalScrollArea'
import { canAccessCapability } from '../../../shared/accessControl'
import { getDayUseActivityLabel, normalizeDayUseReportRow, summarizeDayUseExtras } from '../../../shared/dayUseReporting'

function formatLocalDate(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function monthStart() {
  const d = new Date()
  return formatLocalDate(new Date(d.getFullYear(), d.getMonth(), 1))
}
function monthEnd() {
  const d = new Date()
  return formatLocalDate(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}

function occColor(rate) {
  if (rate >= 70) return { bar: 'bg-green-500',  text: 'text-green-700',  bg: 'bg-green-50' }
  if (rate >= 30) return { bar: 'bg-yellow-400', text: 'text-yellow-700', bg: 'bg-yellow-50' }
  return           { bar: 'bg-red-400',   text: 'text-red-600',   bg: 'bg-red-50' }
}

const PAYMENT_LABELS = {
  folio: 'Room Folio'
}

function getEventGroupId(booking) {
  if (!booking?.is_exclusive_event && !String(booking?.notes || '').includes('[GROUP:')) return null
  const match = String(booking?.notes || '').match(/\[GROUP:([^\]]+)\]/)
  return match?.[1] || `${booking.customer_id || booking.customer_name || 'event'}-${booking.check_in}-${booking.check_out}`
}

function groupEventBookings(rows = []) {
  const grouped = []
  const groups = new Map()
  for (const booking of rows) {
    const groupId = getEventGroupId(booking)
    if (!groupId) {
      grouped.push(booking)
      continue
    }
    if (!groups.has(groupId)) {
      const parent = {
        ...booking,
        _event_group: true,
        _event_booking_ids: [booking.id],
        room_count: 1,
        room_number: null,
        room_type: 'Full Lodge',
        total_amount: Number(booking.total_amount || 0),
        charges_total: Number(booking.charges_total || 0),
        amount_paid: Number(booking.amount_paid || 0)
      }
      groups.set(groupId, parent)
      grouped.push(parent)
      continue
    }
    const parent = groups.get(groupId)
    parent._event_booking_ids.push(booking.id)
    parent.room_count += 1
    parent.total_amount += Number(booking.total_amount || 0)
    parent.charges_total += Number(booking.charges_total || 0)
    parent.amount_paid += Number(booking.amount_paid || 0)
  }
  return grouped
}

const REPORT_TITLES = {
  bookings: 'Occupancy & Revenue Report',
  expenses: 'Expenses Report',
  pos: 'POS Sales Report',
  costs: 'Stock Costs Report',
  pl: 'Profit & Loss Report'
}

function formatFilenameStamp(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  const pad = (value) => String(value).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3, '0')}`
}

function slugifyFilenamePart(value, fallback = 'report') {
  return String(value || fallback)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .toLowerCase() || fallback
}

function normalizeMaintenanceExpense(row = {}) {
  const date = String(row.reported_date || row.created_at || row.date || '').slice(0, 10)
  const title = row.title || row.issue || row.description || 'Maintenance repair'
  const details = [
    row.room_number ? `Room ${row.room_number}` : '',
    row.status ? `Status: ${String(row.status).replace(/_/g, ' ')}` : '',
    row.description || ''
  ].filter(Boolean)
  return {
    id: `maintenance-${row.id || row._queue_id || date || title}`,
    date,
    description: title,
    category: 'Maintenance & Repairs',
    notes: details.join(' · '),
    amount: Number(row.total_cost || 0),
    outlet_id: null,
    source: 'Maintenance'
  }
}

export default function Reports() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const access = useAccess()
  const navigate = useNavigate()
  const canViewCombinedReports = canAccessCapability(access, 'pos.combined_reports')

  const [activeTab, setActiveTab] = useState('bookings')
  const [start, setStart] = useState(monthStart)
  const [end, setEnd]     = useState(monthEnd)

  // Bookings tab
  const [occupancy, setOccupancy] = useState([])
  const [revenue, setRevenue]     = useState(null)
  const [reportBookings, setReportBookings] = useState([])
  const [conferenceBookings, setConferenceBookings] = useState([])
  const [dayUseEntries, setDayUseEntries] = useState([])
  const [snapshot, setSnapshot]   = useState(null)
  const [syncStatus, setSyncStatus] = useState(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [tabError, setTabError]   = useState('')
  const [savingPDF, setSavingPDF]   = useState(false)
  const [savingXLSX, setSavingXLSX] = useState(false)
  const [exportSuccess, setExportSuccess] = useState('')

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
  const [pl, setPl]                 = useState(null)
  const [plLoading, setPlLoading]   = useState(false)
  const [outletPL, setOutletPL]     = useState(null)
  const [roomProfitability, setRoomProfitability] = useState([])

  // Outlet filter — applies to POS, Expenses, and Costs (inventory) tabs only
  const [outlets, setOutlets]           = useState([])
  const [selectedOutlet, setSelectedOutlet] = useState('all')
  const reportTitle = REPORT_TITLES[activeTab] || 'Report'
  const companyDisplayName = settings?.lodge_name || settings?.company_name || 'Boroko Lodge'
  const companyLegalName = settings?.company_name && settings?.company_name !== companyDisplayName ? settings.company_name : ''
  const selectedOutletLabel = useMemo(() => {
    if (selectedOutlet === 'all') return 'All Outlets'
    if (selectedOutlet === 'unassigned') return 'Others'
    return outlets.find((outlet) => String(outlet.id) === String(selectedOutlet))?.name || 'Selected Outlet'
  }, [outlets, selectedOutlet])
  const dayUseInsights = useMemo(() => {
    const templateMap = new Map()
    const resourceMap = new Map()
    const extrasMap = new Map()
    const balances = []
    for (const entry of dayUseEntries) {
      const row = normalizeDayUseReportRow(entry)
      const templateKey = row.templateName || row.activityLabel
      const templateSummary = templateMap.get(templateKey) || { label: templateKey, count: 0, revenue: 0 }
      templateSummary.count += 1
      templateSummary.revenue += row.total
      templateMap.set(templateKey, templateSummary)

      if (row.resourceName) {
        const resourceSummary = resourceMap.get(row.resourceName) || { label: row.resourceName, count: 0, revenue: 0 }
        resourceSummary.count += 1
        resourceSummary.revenue += row.total
        resourceMap.set(row.resourceName, resourceSummary)
      }

      for (const extra of Array.isArray(entry.extras) ? entry.extras : []) {
        const key = String(extra?.name || '').trim()
        if (!key) continue
        const extraSummary = extrasMap.get(key) || { label: key, quantity: 0, revenue: 0 }
        extraSummary.quantity += Number(extra?.quantity || 0)
        extraSummary.revenue += Number(extra?.quantity || 0) * Number(extra?.unit_price || 0)
        extrasMap.set(key, extraSummary)
      }

      if (row.balanceDue > 0 && row.status !== 'cancelled') {
        balances.push({
          id: entry.id,
          guest: row.guest,
          template: templateKey,
          balance: row.balanceDue,
          date: row.date
        })
      }
    }
    return {
      templates: Array.from(templateMap.values()).sort((a, b) => b.revenue - a.revenue),
      resources: Array.from(resourceMap.values()).sort((a, b) => b.count - a.count || b.revenue - a.revenue),
      extras: Array.from(extrasMap.values()).sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue),
      balances: balances.sort((a, b) => b.balance - a.balance)
    }
  }, [dayUseEntries])

  useEffect(() => {
    window.api.outlets.getAll().then(d => setOutlets(d || [])).catch(() => {})
  }, [])

  useEffect(() => {
    window.api.sync.getStatus().then((status) => setSyncStatus(status || null)).catch(() => {})
  }, [])

  useEffect(() => { runReport(start, end) }, [start, end])

  useEffect(() => {
    const loadTabData = async () => {
      setTabError('')
      if (activeTab === 'expenses') {
        setExpLoading(true)
        try {
          const showPropertyWideCosts = !selectedOutlet || selectedOutlet === 'all' || selectedOutlet === 'unassigned'
          const [expenseData, maintenanceData] = await Promise.all([
            window.api.expenses.getAll(start, end, selectedOutlet),
            showPropertyWideCosts
              ? window.api.reports.maintenanceRows(start, end).catch(() => [])
              : Promise.resolve([])
          ])
          const combinedExpenses = [
            ...(expenseData || []),
            ...(maintenanceData || []).map(normalizeMaintenanceExpense)
          ].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
          setExpenses(combinedExpenses)
        } catch (err) {
          setExpenses([])
          setTabError(`Could not load expenses: ${err?.message || 'Unknown error'}`)
        } finally {
          setExpLoading(false)
        }
      }
      if (activeTab === 'pos') {
        setPosLoading(true)
        try {
          const data = await window.api.reports.posSales(start, end, selectedOutlet)
          setPosSales(data)
        } catch (err) {
          setPosSales(null)
          setTabError(`Could not load POS sales: ${err?.message || 'Unknown error'}`)
        } finally {
          setPosLoading(false)
        }
      }
      if (activeTab === 'costs') {
        setCostsLoading(true)
        try {
          const [inv, sup] = await Promise.all([
            window.api.reports.inventorySpend(start, end, selectedOutlet),
            window.api.reports.supplySpend(start, end)
          ])
          setInvSpend(inv)
          setSupSpend(sup)
        } catch (err) {
          setInvSpend(null)
          setSupSpend(null)
          setTabError(`Could not load stock costs: ${err?.message || 'Unknown error'}`)
        } finally {
          setCostsLoading(false)
        }
      }
      if (activeTab === 'pl') {
        setPlLoading(true)
        try {
          const [plData, outletData] = await Promise.all([
            window.api.reports.profitLoss(start, end),
            canViewCombinedReports ? window.api.reports.outletProfitLoss(start, end) : Promise.resolve(null)
          ])
          setPl(plData)
          setOutletPL(outletData)
        } catch (err) {
          setPl(null)
          setOutletPL(null)
          setTabError(`Could not load P&L: ${err?.message || 'Unknown error'}`)
        } finally {
          setPlLoading(false)
        }
      }
    }
    loadTabData()
  }, [activeTab, start, end, selectedOutlet])

  const runReport = async (s, e) => {
    if (!s || !e) return
    setLoading(true)
    setError('')
    try {
      const [occ, rev, bookings, reportsSnapshot, confBookings, dayUseRows] = await Promise.all([
        window.api.reports.occupancy(s, e),
        window.api.reports.revenue(s, e),
        window.api.bookings.getAll().catch(() => []),
        window.api.reports.snapshot(e).catch(() => null),
        window.api.conference.getAll(s, e).catch(() => []),
        window.api.dayuse.getAll(s, e).catch(() => [])
      ])
      setOccupancy(Array.isArray(occ) ? occ : [])
      setRevenue(rev && typeof rev === 'object' ? rev : null)
      setReportBookings(Array.isArray(bookings) ? bookings : [])
      setConferenceBookings(Array.isArray(confBookings) ? confBookings : [])
      setDayUseEntries(Array.isArray(dayUseRows) ? dayUseRows : [])
      setSnapshot(reportsSnapshot && typeof reportsSnapshot === 'object' ? reportsSnapshot : null)
      const roomRows = await window.api.reports.roomProfitability(s, e).catch(() => [])
      setRoomProfitability(Array.isArray(roomRows) ? roomRows : [])
    } catch (err) {
      setError(`Could not load report: ${err?.message || 'Unknown error'}`)
      setReportBookings([])
      setConferenceBookings([])
      setDayUseEntries([])
      setSnapshot(null)
      setRevenue(null)
      setRoomProfitability([])
    } finally {
      setLoading(false)
    }
  }

  const exportCSV = () => {
    const totalNights = Math.max(1, Math.ceil((new Date(end) - new Date(start)) / 86400000))
    const avgOcc = occupancy.length
      ? Math.round(occupancy.reduce((s, r) => s + r.occupancy_rate, 0) / occupancy.length) : 0
    const csvStamp = formatFilenameStamp()
    const rows = [
      [`${companyDisplayName} — Bookings Report`],
      ['Lodge', companyDisplayName],
      ...(companyLegalName ? [['Company', companyLegalName]] : []),
      [`Period: ${exportPeriod}`],
      [`Generated: ${new Date().toLocaleString()}`],
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
    a.href = url
    a.download = `boroko-bookings-report-${start}-to-${end}-${csvStamp}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setExportSuccess(`CSV export started for the bookings report (${exportPeriod}). Your download should begin shortly.`)
    setTimeout(() => setExportSuccess(''), 4000)
  }

  const handleSaveExcel = async () => {
    if (revenue?.source === 'local') {
      setError('Cannot export reports while using local fallback data. Please restore internet connection and refresh the report.')
      return
    }
    setSavingXLSX(true); setError('')
    try {
      const result = await window.api.reports.saveExcel({
        occupancy,
        revenue,
        expenses,
        posSales,
        invSpend,
        supSpend,
        profitLoss: pl,
        start,
        end,
        currency,
        reportType: 'finance-workbook',
        reportTitle: 'Finance Workbook',
        lodgeName: settings?.lodge_name || '',
        companyName: settings?.company_name || '',
        outletLabel: selectedOutletLabel,
        generatedAt: new Date().toLocaleString()
      })
      if (result.success) {
        setExportSuccess(`Excel workbook saved: ${result.filePath}. It includes separate sheets for bookings, occupancy, expenses, POS sales, stock costs, and P&L.`)
        setTimeout(() => setExportSuccess(''), 6500)
      }
      else if (result.error) setError(`Excel export could not be completed: ${result.error}`)
    } catch (err) { setError(`Excel export could not be completed: ${err?.message}`) }
    setSavingXLSX(false)
  }

  const handleSavePDF = async () => {
    if (revenue?.source === 'local') {
      setError('Cannot export reports while using local fallback data. Please restore internet connection and refresh the report.')
      return
    }
    setSavingPDF(true); setExportSuccess(''); setError('')
    try {
      const result = await window.api.reports.savePDF({
        reportType: activeTab,
        reportTitle,
        start,
        end,
        lodgeName: settings?.lodge_name || '',
        companyName: settings?.company_name || '',
        outletLabel: ['expenses', 'pos', 'costs'].includes(activeTab) ? selectedOutletLabel : '',
        generatedAt: new Date().toLocaleString()
      })
      if (result.success) {
        setExportSuccess(`PDF saved for ${reportTitle}: ${result.filePath}`)
        setTimeout(() => setExportSuccess(''), 5000)
      }
      else if (result.error) setError(`PDF export could not be completed: ${result.error}`)
    } catch (err) { setError(`PDF export could not be completed: ${err?.message}`) }
    setSavingPDF(false)
  }

  const handlePrint = () => {
    if (revenue?.source !== 'server') {
      setError('Cannot print reports while using local fallback data. Please restore internet connection and refresh the report.')
      return
    }
    setExportSuccess(`Print dialog opened for the ${reportTitle}. Review the preview before confirming.`)
    setTimeout(() => setExportSuccess(''), 3500)
    window.print()
  }

  const totalNights = Math.max(1, Math.ceil((new Date(end) - new Date(start)) / 86400000))
  const avgOccupancy = occupancy.length
    ? Math.round(occupancy.reduce((s, r) => s + r.occupancy_rate, 0) / occupancy.length) : 0
  const summarySnapshot = snapshot && typeof snapshot === 'object' ? snapshot : null
  const totalBookingCount = (revenue?.confirmed_count || 0) + (revenue?.checked_in_count || 0) +
    (revenue?.checked_out_count || 0) + (revenue?.cancelled_count || 0)
  const bestRoom = occupancy.length
    ? occupancy.reduce((best, r) => r.occupancy_rate > (best?.occupancy_rate || -1) ? r : best, null) : null
  const topRoomContribution = roomProfitability.length > 0 ? roomProfitability[0] : null
  const collectionQueue = useMemo(() => (
    groupEventBookings(reportBookings)
      .filter((booking) => {
        const bookingDate = String(booking.check_in || booking.created_at || '')
        return bookingDate >= start && bookingDate <= end
      })
      .map((booking) => ({
        ...booking,
        outstanding_balance: Math.max(0, Number(booking.total_amount || 0) + Number(booking.charges_total || 0) - Number(booking.amount_paid || 0))
      }))
      .filter((booking) => booking.status !== 'cancelled' && booking.outstanding_balance > 0)
      .sort((left, right) => {
        const leftPriority = left.status === 'checked_out' ? 0 : left.status === 'checked_in' ? 1 : 2
        const rightPriority = right.status === 'checked_out' ? 0 : right.status === 'checked_in' ? 1 : 2
        if (leftPriority !== rightPriority) return leftPriority - rightPriority
        return Number(right.outstanding_balance || 0) - Number(left.outstanding_balance || 0)
      })
      .slice(0, 5)
  ), [end, reportBookings, start])
  const summaryOutstanding = Number(summarySnapshot?.unpaidTotal ?? revenue?.outstanding_amount ?? collectionQueue.reduce((sum, booking) => sum + Number(booking.outstanding_balance || 0), 0))
  const summaryOutstandingCount = Number(summarySnapshot?.unpaidCount ?? (Number(revenue?.unpaid_count || 0) + Number(revenue?.partial_count || 0) || collectionQueue.length))
  const summaryNetCash = Number(summarySnapshot?.monthRev ?? revenue?.paid_revenue ?? 0)
  const summaryRefunds = Number(summarySnapshot?.monthRefunds ?? revenue?.refunds_issued ?? 0)
  const summaryRetained = Number(summarySnapshot?.monthRetainedRevenue ?? revenue?.retained_revenue ?? 0)
  const summaryGrossCash = summaryNetCash + summaryRefunds
  const summaryRooms = Number(summarySnapshot?.totalRooms ?? occupancy.length)
  const summaryCheckedIn = Number(summarySnapshot?.currentOcc ?? revenue?.checked_in_count ?? 0)
  const revenueSource = revenue?.source === 'server' ? 'server-authoritative' : revenue?.source === 'local' ? 'local fallback' : ''
  const profitLossSource = pl?.source === 'server' ? 'server-authoritative' : pl?.source === 'local' ? 'local fallback' : ''
  const outletProfitLossSource = outletPL?.source === 'server' ? 'server-authoritative' : outletPL?.source === 'local' ? 'local fallback' : ''
  const roomProfitabilitySource = roomProfitability[0]?.source === 'server' ? 'server-authoritative' : roomProfitability[0]?.source === 'local' ? 'local fallback' : ''
  const posSalesSource = posSales?.source === 'server' ? 'server-authoritative' : posSales?.source === 'local' ? 'local fallback' : ''
  const inventorySpendSource = invSpend?.source === 'server' ? 'server-authoritative' : invSpend?.source === 'local' ? 'local fallback' : ''
  const supplySpendSource = supSpend?.source === 'server' ? 'server-authoritative' : supSpend?.source === 'local' ? 'local fallback' : ''
  const exportPeriod = `${start} to ${end}`
  const formatSyncTs = (value) => {
    if (!value) return 'unknown'
    try { return new Date(value).toLocaleString('en-GB') } catch { return String(value) }
  }
  const activeTabUsesOfflineData = (
    syncStatus?.isOnline === false
    || (activeTab === 'bookings' && (revenue?.source && revenue.source !== 'server' || summarySnapshot?.source && summarySnapshot.source !== 'server'))
    || (activeTab === 'expenses' && syncStatus?.isOnline === false)
    || (activeTab === 'pos' && posSales?.source && posSales.source !== 'server')
    || (activeTab === 'costs' && (
      (invSpend?.source && invSpend.source !== 'server')
      || (supSpend?.source && supSpend.source !== 'server')
    ))
    || (activeTab === 'pl' && (
      (pl?.source && pl.source !== 'server')
      || (canViewCombinedReports && outletPL?.source && outletPL.source !== 'server')
    ))
  )
  const offlineDataLabel = `Offline data (last synced: ${formatSyncTs(syncStatus?.lastSuccessfulSyncAt || summarySnapshot?.last_synced_at || summarySnapshot?.as_of || null)})`
  const reportSourceBadges = useMemo(() => {
    const badges = []
    const addBadge = ({ key, label, value, tone, title }) => {
      if (!value) return
      badges.push({ key, label, value, tone, title })
    }

    if (summarySnapshot) {
      addBadge({
        key: 'snapshot',
        label: 'Snapshot',
        value: summarySnapshot.source === 'server' ? 'server' : 'local',
        tone: summarySnapshot.source === 'server' ? 'green' : 'amber',
        title: `Shared reports snapshot in use: ${summarySnapshot.source === 'server' ? 'server-authoritative' : 'local fallback'} as of ${summarySnapshot.as_of || end}.`
      })
    }
    if (activeTab === 'bookings' && revenueSource) {
      addBadge({
        key: 'revenue',
        label: 'Revenue',
        value: revenueSource.replace('-authoritative', ''),
        tone: revenue?.source === 'server' ? 'green' : 'amber',
        title: `Revenue source: ${revenueSource} for ${start} to ${end}.`
      })
    }
    if (activeTab === 'bookings' && roomProfitabilitySource) {
      addBadge({
        key: 'room-profit',
        label: 'Room profit',
        value: roomProfitabilitySource.replace('-authoritative', ''),
        tone: roomProfitability[0]?.source === 'server' ? 'green' : 'amber',
        title: `Room profitability source: ${roomProfitabilitySource} for ${start} to ${end}.`
      })
    }
    if (activeTab === 'pl' && profitLossSource) {
      addBadge({
        key: 'pl',
        label: 'P&L',
        value: profitLossSource.replace('-authoritative', ''),
        tone: pl?.source === 'server' ? 'green' : 'amber',
        title: `Profit and loss source: ${profitLossSource} for ${start} to ${end}.`
      })
    }
    if (activeTab === 'pl' && outletProfitLossSource && canViewCombinedReports) {
      addBadge({
        key: 'outlet-pl',
        label: 'Outlet P&L',
        value: outletProfitLossSource.replace('-authoritative', ''),
        tone: outletPL?.source === 'server' ? 'green' : 'amber',
        title: `Outlet profit and loss source: ${outletProfitLossSource} for ${start} to ${end}.`
      })
    }
    if (activeTab === 'pos' && posSalesSource) {
      addBadge({
        key: 'pos',
        label: 'POS',
        value: posSalesSource.replace('-authoritative', ''),
        tone: posSales?.source === 'server' ? 'green' : 'amber',
        title: `POS sales source: ${posSalesSource} for ${start} to ${end}.`
      })
    }
    if (activeTab === 'costs' && (inventorySpendSource || supplySpendSource)) {
      addBadge({
        key: 'costs',
        label: 'Costs',
        value: `${inventorySpendSource || 'unknown'} / ${supplySpendSource || 'unknown'}`,
        tone: inventorySpendSource === 'server-authoritative' && supplySpendSource === 'server-authoritative' ? 'green' : 'amber',
        title: `Inventory spend source: ${inventorySpendSource || 'unknown'} for ${start} to ${end}. Room supplies source: ${supplySpendSource || 'unknown'} for ${start} to ${end}.`
      })
    }
    return badges
  }, [
    activeTab,
    canViewCombinedReports,
    end,
    inventorySpendSource,
    outletPL?.source,
    outletProfitLossSource,
    pl?.source,
    posSales?.source,
    posSalesSource,
    profitLossSource,
    revenue?.source,
    revenueSource,
    roomProfitabilitySource,
    roomProfitability,
    start,
    summarySnapshot,
    supplySpendSource
  ])

  const PRESETS = [
    { label: 'This Month', fn: () => [monthStart(), monthEnd()] },
    { label: 'Last Month', fn: () => {
        const d = new Date()
        const s = new Date(d.getFullYear(), d.getMonth() - 1, 1)
        const e = new Date(d.getFullYear(), d.getMonth(), 0)
        return [formatLocalDate(s), formatLocalDate(e)]
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
    <div className="mx-auto flex max-w-7xl flex-col gap-6" id="printable-report">

      {/* Header */}
      <div className="bb-page-header no-print">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700/70">Finance & Analytics</p>
          <h1 className="bb-page-header-title mt-2">Reports</h1>
          <p className="bb-page-header-subtitle">Occupancy, revenue, cost, and performance analysis across operations.</p>
        </div>

<div className="flex flex-wrap gap-2">
          {/* Disable all exports when data is from local fallback — money numbers must be authoritative */}
          <button onClick={exportCSV} disabled={!revenue || loading || revenue?.source !== 'server'}
            className="btn-secondary disabled:opacity-40"
            title={revenue?.source !== 'server' ? 'Export blocked: report is using local fallback data, not server-authoritative data' : 'CSV export for the bookings report'}>
            <Download size={14} /> CSV
          </button>
          <button onClick={handleSaveExcel} disabled={!revenue || loading || savingXLSX || revenue?.source !== 'server'}
            className="inline-flex items-center gap-2 rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-40"
            title={revenue?.source !== 'server' ? 'Export blocked: report is using local fallback data, not server-authoritative data' : 'Excel workbook exports the full report pack in separate sheets'}>
            <Table size={14} /> {savingXLSX ? 'Saving…' : 'Excel Workbook'}
          </button>
          <button onClick={handlePrint} disabled={!revenue || loading || revenue?.source !== 'server'}
            className="btn-secondary disabled:opacity-40"
            title={revenue?.source !== 'server' ? 'Print blocked: report is using local fallback data, not server-authoritative data' : ''}>
            <Printer size={14} /> Print
          </button>
          <button onClick={handleSavePDF} disabled={!revenue || loading || savingPDF || revenue?.source !== 'server'}
            className="btn-primary disabled:opacity-40"
            title={revenue?.source !== 'server' ? 'Export blocked: report is using local fallback data, not server-authoritative data' : ''}>
            <FileDown size={14} /> {savingPDF ? 'Saving…' : 'Save PDF'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bb-card no-print flex flex-wrap gap-2 p-2">
        {TABS.map(([v, l]) => (
          <button key={v} onClick={() => setActiveTab(v)}
            className={`rounded-2xl px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === v ? 'bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-[0_10px_24px_rgba(22,101,52,0.24)]' : 'bg-white text-slate-600 hover:bg-slate-50 shadow-sm'
            }`}>
            {l}
          </button>
        ))}
      </div>

      {/* Date Range + Outlet Filter */}
      <div className="bb-filter-bar no-print items-end">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">From</label>
          <input type="date" className="input text-sm" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">To</label>
          <input type="date" className="input text-sm" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </div>
        {/* Outlet selector — only shown for tabs where outlet filtering applies */}
        {['pos', 'expenses', 'costs'].includes(activeTab) && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Outlet</label>
            <select
              className="input w-auto text-sm"
              value={selectedOutlet}
              onChange={(e) => setSelectedOutlet(e.target.value)}
            >
              {/* Only show "All Outlets" option if user has full outlet access */}
              {!access?.allowedOutletIds && <option value="all">All Outlets</option>}
              {outlets
                .filter(o => !access?.allowedOutletIds || access.allowedOutletIds.includes(o.id))
                .map(o => (
                  <option key={o.id || o.name} value={o.id || ''}>{o.name}</option>
                ))}
              {/* Unassigned only for full-access users */}
              {!access?.allowedOutletIds && <option value="unassigned">Others</option>}
            </select>
          </div>
        )}
        {(loading || posLoading || costsLoading || expLoading || plLoading) && (
          <span className="self-end pb-2 text-sm italic text-slate-400">Refreshing the {activeTab} report…</span>
        )}
        <div className="ml-auto flex gap-2">
          {PRESETS.map(({ label, fn }) => (
            <button key={label} onClick={() => { const [s, e] = fn(); setStart(s); setEnd(e) }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50">
              {label}
            </button>
          ))}
        </div>
        <div className="w-full text-xs text-slate-500">
          Choose a date range or use a preset to refresh the currently selected report. Exports always use the active tab and current dates.
          <span className="mt-1 block">Excel export bundles the report pack into separate sheets for bookings, occupancy, expenses, POS sales, stock costs, and P&amp;L.</span>
        </div>
      </div>

      <div className="print-only mb-6 border-b-2 border-green-700 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700/70">Report Export</p>
            <h2 className="text-xl font-bold text-slate-800">{companyDisplayName} - {reportTitle}</h2>
            {companyLegalName && (
              <p className="mt-1 text-sm text-slate-500">{companyLegalName}</p>
            )}
            <p className="mt-1 text-sm text-slate-500">Period: {exportPeriod}</p>
            {['expenses', 'pos', 'costs'].includes(activeTab) && (
              <p className="mt-1 text-sm text-slate-500">Outlet: {selectedOutletLabel}</p>
            )}
          </div>
          <p className="text-xs text-slate-400">Generated: {new Date().toLocaleString()}</p>
        </div>
      </div>

      {error && (
        <div className="no-print flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>⚠</span><span>{error}</span>
        </div>
      )}
      {tabError && (
        <div className="no-print flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>⚠</span><span>{tabError}</span>
        </div>
      )}
      {exportSuccess && (
        <div className="no-print rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          ✓ {exportSuccess}
        </div>
      )}
      {reportSourceBadges.length > 0 && (
        <div className="no-print overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="flex min-w-max items-center gap-2 text-[11px] text-slate-600">
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Data source</span>
            {reportSourceBadges.map((badge) => (
              <span
                key={badge.key}
                title={badge.title}
                className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 font-medium ${
                  badge.tone === 'green'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-amber-200 bg-amber-50 text-amber-800'
                }`}
              >
                <span className="font-semibold">{badge.label}</span>
                <span>•</span>
                <span>{badge.value}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {activeTabUsesOfflineData && (
        <div className="no-print rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">{offlineDataLabel}</p>
          <p className="mt-1 text-xs text-amber-800">Financial metrics on this tab are using offline, cached, or fallback data and should not be treated as final until live sync is restored.</p>
        </div>
      )}
      {activeTab === 'bookings' && revenueSource && revenue?.source !== 'server' && (
        <div className="no-print flex items-start gap-3 rounded-2xl border-2 border-red-400 bg-red-50 px-5 py-4 text-sm text-red-800 font-medium shadow-sm">
          <span className="text-lg leading-none">⛔</span>
          <div>
            <p className="font-semibold">Financial data is using local fallback — NOT server-authoritative</p>
            <p className="mt-1 text-xs font-normal text-red-700">Exports are blocked. Restore server connectivity and reload to get verified numbers. Do not make financial decisions based on this data.</p>
          </div>
        </div>
      )}

      {/* ── POS SALES TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'pos' && (
        <div>
          {posLoading ? (
            <div className="bb-empty-state min-h-[220px]">
              <p className="text-sm font-medium text-slate-500">Loading POS data…</p>
            </div>
          ) : !posSales ? (
            <div className="bb-empty-state min-h-[220px]">
              <ShoppingCart size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No completed POS orders were recorded in this period.</p>
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
                <div className="bb-card mb-6 p-5">
                  <h2 className="mb-4 text-lg font-semibold tracking-[-0.02em] text-slate-800">By Payment Method</h2>
                  <div className="space-y-3">
                    {Object.entries(posSales.by_payment).sort((a, b) => b[1] - a[1]).map(([method, amt]) => {
                      const pct = posSales.total_revenue > 0 ? (amt / posSales.total_revenue) * 100 : 0
                      return (
                        <div key={method} className="flex items-center gap-3">
                          <span className="w-36 shrink-0 text-sm text-slate-600">
                            {PAYMENT_LABELS[method] || formatPaymentMethod(method)}
                          </span>
                          <div className="h-2.5 flex-1 rounded-full bg-slate-100">
                            <div className="bg-green-500 h-2.5 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="w-28 text-right text-sm font-semibold text-slate-800">
                            {currency} {Number(amt).toFixed(2)}
                          </span>
                          <span className="w-10 text-xs text-slate-400">{Math.round(pct)}%</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Top selling items */}
              {posSales.top_items.length > 0 && (
                <div className="bb-table-shell mb-6">
                  <div className="border-b border-slate-200/80 px-5 py-4">
                    <h2 className="text-lg font-semibold tracking-[-0.02em] text-slate-800">Top Selling Items</h2>
                  </div>
                  <HorizontalScrollArea>
                    <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                      <tr>
                        <th className="px-5 py-3 text-left">#</th>
                        <th className="px-5 py-3 text-left">Item</th>
                        <th className="px-5 py-3 text-right">Qty Sold</th>
                        <th className="px-5 py-3 text-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {posSales.top_items.map((item, i) => (
                        <tr key={item.name} className="hover:bg-slate-50">
                          <td className="px-5 py-3 text-xs font-mono text-slate-400">{i + 1}</td>
                          <td className="px-5 py-3 font-medium text-slate-800">{item.name}</td>
                          <td className="px-5 py-3 text-right text-slate-600">{item.qty}</td>
                          <td className="px-5 py-3 text-right font-semibold text-slate-800">
                            {currency} {Number(item.revenue).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    </table>
                  </HorizontalScrollArea>
                </div>
              )}

              {/* Daily totals */}
              {posSales.daily.length > 0 && (
                <div className="bb-card p-5">
                  <h2 className="mb-4 text-lg font-semibold tracking-[-0.02em] text-slate-800">Daily Sales</h2>
                  <div className="space-y-2">
                    {posSales.daily.map((d) => {
                      const maxDay = Math.max(...posSales.daily.map((x) => x.total))
                      const pct = maxDay > 0 ? (d.total / maxDay) * 100 : 0
                      return (
                        <div key={d.date} className="flex items-center gap-3">
                          <span className="w-24 shrink-0 text-xs text-slate-500">{d.date}</span>
                          <div className="h-2 flex-1 rounded-full bg-slate-100">
                            <div className="bg-green-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="w-24 text-right text-xs font-semibold text-slate-700">
                            {currency} {Number(d.total).toFixed(2)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-3 flex justify-between border-t border-slate-100 pt-3 text-sm font-bold text-slate-800">
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
            <div className="bb-empty-state min-h-[220px]">
              <p className="text-sm font-medium text-slate-500">Loading cost data…</p>
            </div>
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
                <div className="bb-card mb-6 p-5">
                  <h2 className="mb-4 text-lg font-semibold tracking-[-0.02em] text-slate-800">Inventory by Category</h2>
                  <div className="space-y-3">
                    {Object.entries(invSpend.by_category).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => {
                      const pct = invSpend.total > 0 ? (amt / invSpend.total) * 100 : 0
                      return (
                        <div key={cat} className="flex items-center gap-3">
                          <span className="w-32 shrink-0 truncate text-xs text-slate-500">{cat}</span>
                          <div className="h-2.5 flex-1 rounded-full bg-slate-100">
                            <div className="bg-orange-400 h-2.5 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="w-24 text-right text-xs font-semibold text-slate-700">
                            {currency} {Number(amt).toFixed(2)}
                          </span>
                          <span className="w-10 text-xs text-slate-400">{Math.round(pct)}%</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Inventory purchases table */}
              {invSpend?.purchases?.length > 0 && (
                <div className="bb-table-shell mb-6">
                  <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4">
                    <h2 className="font-semibold text-slate-700">Inventory Purchases</h2>
                    <span className="text-sm font-bold text-slate-800">
                      Total: {currency} {Number(invSpend.total).toFixed(2)}
                    </span>
                  </div>
                  <HorizontalScrollArea>
                    <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                      <tr>
                        <th className="px-5 py-3 text-left">Date</th>
                        <th className="px-5 py-3 text-left">Item</th>
                        <th className="px-5 py-3 text-left">Category</th>
                        <th className="px-5 py-3 text-right">Qty</th>
                        <th className="px-5 py-3 text-right">Unit Cost</th>
                        <th className="px-5 py-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {invSpend.purchases.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50">
                          <td className="whitespace-nowrap px-5 py-2.5 text-slate-500">
                            {(p.purchased_at || '').split('T')[0]}
                          </td>
                          <td className="px-5 py-2.5 font-medium text-slate-800">
                            {p.inventory_items?.name || '—'}
                          </td>
                          <td className="px-5 py-2.5">
                            <span className="text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-700">
                              {p.inventory_items?.category || '—'}
                            </span>
                          </td>
                          <td className="px-5 py-2.5 text-right text-slate-600">{p.quantity_purchased}</td>
                          <td className="px-5 py-2.5 text-right text-slate-600">
                            {currency} {Number(p.unit_cost || 0).toFixed(2)}
                          </td>
                          <td className="px-5 py-2.5 text-right font-semibold text-slate-800">
                            {currency} {Number(p.total_cost || 0).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    </table>
                  </HorizontalScrollArea>
                </div>
              )}

              {/* Room Supplies purchases table */}
              {supSpend?.purchases?.length > 0 && (
                <div className="bb-table-shell">
                  <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4">
                    <h2 className="font-semibold text-slate-700">Room Supplies Purchases</h2>
                    <span className="text-sm font-bold text-slate-800">
                      Total: {currency} {Number(supSpend.total).toFixed(2)}
                    </span>
                  </div>
                  <HorizontalScrollArea>
                    <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                      <tr>
                        <th className="px-5 py-3 text-left">Date</th>
                        <th className="px-5 py-3 text-left">Item</th>
                        <th className="px-5 py-3 text-right">Qty</th>
                        <th className="px-5 py-3 text-right">Unit Cost</th>
                        <th className="px-5 py-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {supSpend.purchases.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50">
                          <td className="whitespace-nowrap px-5 py-2.5 text-slate-500">
                            {(p.purchased_at || '').split('T')[0]}
                          </td>
                          <td className="px-5 py-2.5 font-medium text-slate-800">
                            {p.supply_items?.name || '—'}
                          </td>
                          <td className="px-5 py-2.5 text-right text-slate-600">{p.quantity_purchased}</td>
                          <td className="px-5 py-2.5 text-right text-slate-600">
                            {currency} {Number(p.unit_cost || 0).toFixed(2)}
                          </td>
                          <td className="px-5 py-2.5 text-right font-semibold text-slate-800">
                            {currency} {Number(p.total_cost || 0).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    </table>
                  </HorizontalScrollArea>
                </div>
              )}

              {(!invSpend?.purchases?.length && !supSpend?.purchases?.length) && (
                <div className="bb-empty-state min-h-[220px]">
                  <Package size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No stock purchases were recorded in this period. Inventory and room-supplies purchases will appear here automatically.</p>
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
              <div className="bb-empty-state min-h-[220px]">
                <p className="text-sm font-medium text-slate-500">Loading expense analysis…</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  {Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([cat, amt]) => (
                    <div key={cat} className="bb-card p-4">
                      <p className="text-xl font-bold text-slate-800">{currency} {Number(amt).toFixed(2)}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{cat}</p>
                    </div>
                  ))}
                  {Object.keys(byCategory).length === 0 && (
                    <div className="bb-card col-span-4 p-4">
                      <p className="text-xl font-bold text-slate-800">{currency} 0.00</p>
                      <p className="mt-0.5 text-xs text-slate-500">No expenses recorded</p>
                    </div>
                  )}
                </div>
                <div className="bb-table-shell mb-6">
                  <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4">
                    <h2 className="text-lg font-semibold tracking-[-0.02em] text-slate-800">Expense Breakdown</h2>
                    <span className="text-sm font-bold text-slate-800">Total: {currency} {total.toFixed(2)}</span>
                  </div>
                  <HorizontalScrollArea>
                    <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                      <tr>
                        <th className="px-5 py-3 text-left">Date</th>
                        <th className="px-5 py-3 text-left">Description</th>
                        <th className="px-5 py-3 text-left">Category</th>
                        <th className="px-5 py-3 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {expenses.map((e) => (
                        <tr key={e.id} className="hover:bg-slate-50">
                          <td className="px-5 py-2.5 text-slate-500 whitespace-nowrap">{e.date}</td>
                          <td className="px-5 py-2.5 text-slate-800">{e.description}</td>
                          <td className="px-5 py-2.5">
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{e.category}</span>
                          </td>
                          <td className="px-5 py-2.5 text-right font-semibold text-slate-800">
                            {currency} {Number(e.amount).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                      {expenses.length === 0 && (
                        <tr><td colSpan={4} className="px-5 py-10"><div className="bb-empty-state py-10"><p className="text-base font-semibold text-slate-800">No expenses for this period</p><p className="text-sm text-slate-500">Recorded expenses in this range will appear here automatically.</p></div></td></tr>
                      )}
                    </tbody>
                    {expenses.length > 0 && (
                      <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                        <tr>
                          <td colSpan={3} className="px-5 py-3 text-xs font-semibold uppercase text-slate-500">Total</td>
                          <td className="px-5 py-3 text-right text-sm font-bold text-slate-800">
                            {currency} {total.toFixed(2)}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                    </table>
                  </HorizontalScrollArea>
                </div>
                {Object.keys(byCategory).length > 0 && (
                  <div className="bb-card p-5">
                    <h2 className="mb-4 text-lg font-semibold tracking-[-0.02em] text-slate-800">By Category</h2>
                    <div className="space-y-3">
                      {Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => {
                        const pct = total > 0 ? (amt / total) * 100 : 0
                        return (
                          <div key={cat} className="flex items-center gap-3">
                            <span className="w-36 shrink-0 truncate text-xs text-slate-500">{cat}</span>
                            <div className="h-2.5 flex-1 rounded-full bg-slate-100">
                              <div className="bg-blue-500 h-2.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="w-24 text-right text-xs font-semibold text-slate-700">
                              {currency} {Number(amt).toFixed(2)}
                            </span>
                            <span className="w-10 text-xs text-slate-400">{Math.round(pct)}%</span>
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
      {revenue && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-6">
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
        <SummaryCard icon={PiggyBank}   label="Net Cash Collected"
          value={`${currency} ${Number(revenue.paid_revenue || 0).toFixed(2)}`}
            sub={`Refunds ${currency} ${Number(revenue.refunds_issued || 0).toFixed(2)} · kept ${currency} ${Number(revenue.retained_revenue || 0).toFixed(2)}`}
            color="bg-emerald-50 text-emerald-600" />
          <SummaryCard icon={DollarSign}  label="Outstanding"
            value={`${currency} ${Number(revenue.outstanding_amount || 0).toFixed(2)}`}
            sub={`${Number(revenue.unpaid_count || 0) + Number(revenue.partial_count || 0)} booking${(Number(revenue.unpaid_count || 0) + Number(revenue.partial_count || 0)) === 1 ? '' : 's'} still open`}
            color={Number(revenue.outstanding_amount || 0) > 0 ? 'bg-rose-50 text-rose-600' : 'bg-slate-50 text-slate-600'} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 mb-6">
        <SummaryCard icon={Building2} label="Rooms In Lodge"
          value={summaryRooms}
          color="bg-slate-50 text-slate-600" />
        <SummaryCard icon={BedDouble} label="Checked In Now"
          value={summaryCheckedIn}
          color="bg-blue-50 text-blue-600" />
        <SummaryCard icon={CreditCard} label="Shared Outstanding"
          value={`${currency} ${summaryOutstanding.toFixed(2)}`}
          sub={`${summaryOutstandingCount} booking${summaryOutstandingCount === 1 ? '' : 's'} still open`}
          color={summaryOutstanding > 0 ? 'bg-rose-50 text-rose-600' : 'bg-slate-50 text-slate-600'} />
        <SummaryCard icon={PiggyBank} label="Shared Net Cash"
          value={`${currency} ${summaryNetCash.toFixed(2)}`}
          sub={`Gross ${currency} ${summaryGrossCash.toFixed(2)} · refunds ${currency} ${summaryRefunds.toFixed(2)} · kept ${currency} ${summaryRetained.toFixed(2)}`}
          color="bg-emerald-50 text-emerald-600" />
      </div>

      {revenue?.vat_enabled && (
        <div className="mb-6 flex flex-wrap gap-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm">
          <span className="text-amber-700 font-medium">
            {revenue.vat_mixed ? 'VAT (mixed historical rates)' : `VAT (${revenue.vat_rate}% inclusive)`}
          </span>
          <span className="text-slate-600">Gross: <span className="font-semibold text-slate-800">{currency} {Number(revenue.total_revenue || 0).toFixed(2)}</span></span>
          <span className="text-slate-600">VAT portion: <span className="font-semibold text-amber-700">{currency} {Number(revenue.vat_amount || 0).toFixed(2)}</span></span>
          <span className="text-slate-600">Net (excl. VAT): <span className="font-semibold text-slate-800">{currency} {Number(revenue.net_revenue || 0).toFixed(2)}</span></span>
        </div>
      )}

      {revenue && (
        <div className="bb-card mb-6 p-5">
          <h2 className="mb-4 text-lg font-semibold tracking-[-0.02em] text-slate-800">Booking Status Breakdown</h2>
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
                  <span className="w-24 shrink-0 text-xs text-slate-500">{label}</span>
                  <div className="h-2.5 flex-1 rounded-full bg-slate-100">
                    <div className={`${color} h-2.5 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-8 text-right text-xs font-semibold text-slate-700">{count}</span>
                  <span className="w-8 text-xs text-slate-400">{pct}%</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {revenue && revenue.paid_revenue !== undefined && (
        <div className="bb-card mb-6 p-5">
          <h2 className="mb-4 text-lg font-semibold tracking-[-0.02em] text-slate-800">Cash Movement & Open Balances</h2>
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl bg-emerald-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Net Cash</p>
              <p className="mt-1 text-lg font-semibold text-emerald-800">{currency} {Number(revenue.paid_revenue || 0).toFixed(2)}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Gross Receipts</p>
              <p className="mt-1 text-lg font-semibold text-slate-800">{currency} {Number(revenue.gross_collected || 0).toFixed(2)}</p>
            </div>
            <div className="rounded-2xl bg-rose-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-600">Refunds</p>
              <p className="mt-1 text-lg font-semibold text-rose-700">{currency} {Number(revenue.refunds_issued || 0).toFixed(2)}</p>
            </div>
            <div className="rounded-2xl bg-amber-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">Fees kept from refunds</p>
              <p className="mt-1 text-lg font-semibold text-amber-800">{currency} {Number(revenue.retained_revenue || 0).toFixed(2)}</p>
            </div>
          </div>
          <p className="mb-4 text-xs text-slate-500">
            Revenue is based on booked stay value for this period. Cash movement is based on payment events recorded during this period, and fees kept from refunds are shown separately.
          </p>
          <div className="grid grid-cols-3 gap-4">
            <StatusStat label="Paid"    value={revenue.paid_count    || 0} color="bg-green-500" />
            <StatusStat label="Partial" value={revenue.partial_count || 0} color="bg-yellow-400" />
            <StatusStat label="Unpaid"  value={revenue.unpaid_count  || 0} color="bg-red-400" />
          </div>
        </div>
      )}

      {revenue && revenue.booking_payment_by_method && Object.keys(revenue.booking_payment_by_method).length > 0 && (
        <div className="bb-card mb-6 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-slate-800">Booking Payment Methods</h2>
              <p className="mt-1 text-sm text-slate-500">How booking money was collected across the selected period.</p>
            </div>
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
              <CreditCard size={18} />
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {Object.entries(revenue.booking_payment_by_method)
              .sort(([, left], [, right]) => Number(right || 0) - Number(left || 0))
              .map(([method, amount]) => {
                const totalCollected = Number(revenue.gross_collected || 0)
                const pct = totalCollected > 0 ? (Number(amount || 0) / totalCollected) * 100 : 0
                return (
                  <div key={method} className="flex items-center gap-3">
                    <span className="w-40 shrink-0 text-sm text-slate-600">
                      {formatPaymentMethod(method, { plain: true })}
                    </span>
                    <div className="h-2.5 flex-1 rounded-full bg-slate-100">
                      <div className="h-2.5 rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.max(4, pct)}%` }} />
                    </div>
                    <span className="w-28 text-right text-sm font-semibold text-slate-800">
                      {currency} {Number(amount || 0).toFixed(2)}
                    </span>
                    <span className="w-10 text-xs text-slate-400">{Math.round(pct)}%</span>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {collectionQueue.length > 0 && (
        <div className="bb-card mb-6 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-slate-800">Collection Queue</h2>
              <p className="mt-1 text-sm text-slate-500">Use this to work the most urgent balances for the selected period.</p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/invoices')}
              className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
            >
              Open Invoices
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {collectionQueue.map((booking) => (
              <div key={`report-queue-${booking._event_booking_ids?.join('-') || booking.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-slate-900">{booking.customer_name || 'Guest'}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      booking.status === 'checked_out'
                        ? 'bg-slate-100 text-slate-700'
                        : booking.status === 'checked_in'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                    }`}>
                      {String(booking.status || 'confirmed').replace(/_/g, ' ')}
                    </span>
                    <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                      {currency} {Number(booking.outstanding_balance || 0).toFixed(2)} due
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {booking._event_group ? `Full Lodge · ${booking.room_count} rooms` : `Room ${booking.room_number || '—'}`} · {booking.check_in} → {booking.check_out}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/bookings', { state: { collectPaymentBookingId: booking.id } })}
                  className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
                >
                  Collect Payment
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {revenue?.event_count > 0 && (
        <div className="mb-6 rounded-2xl border border-indigo-100 bg-indigo-50 p-5">
          <h2 className="text-sm font-semibold text-indigo-800 mb-3 flex items-center gap-2">
            <Building2 size={15} /> Exclusive Events ({revenue.event_count})
          </h2>
          <div className="space-y-2">
            {revenue.event_bookings.map(evt => (
              <div key={evt.group_id} className="flex items-center justify-between text-sm">
                <span className="text-slate-600">
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

      {conferenceBookings.length > 0 && (
        <div className="bb-table-shell mb-6">
          <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-slate-800 flex items-center gap-2">
                <Presentation size={17} className="text-amber-600" /> Conference Bookings ({conferenceBookings.length})
              </h2>
              <p className="mt-1 text-sm text-slate-500">Conference reservations for the selected period.</p>
            </div>
          </div>
          <HorizontalScrollArea>
          <table className="min-w-[900px] w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="px-5 py-3 text-left">Client</th>
                <th className="px-5 py-3 text-left">Date</th>
                <th className="px-5 py-3 text-left">Room</th>
                <th className="px-5 py-3 text-left">Attendees</th>
                <th className="px-5 py-3 text-right">Total</th>
                <th className="px-5 py-3 text-right">Deposit</th>
                <th className="px-5 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {conferenceBookings.map((cb) => (
                <tr key={cb.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-800">{cb.client_name}</p>
                    {cb.company && <p className="text-xs text-slate-500">{cb.company}</p>}
                  </td>
                  <td className="px-5 py-3 text-slate-600 whitespace-nowrap">
                    {cb.booking_date}{cb.start_time ? ` ${cb.start_time}–${cb.end_time}` : ''}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{cb.room_name}</td>
                  <td className="px-5 py-3 text-slate-600">{cb.attendees || '-'}</td>
                  <td className="px-5 py-3 text-right font-medium text-slate-800">{currency} {Number(cb.total_amount || 0).toFixed(2)}</td>
                  <td className="px-5 py-3 text-right font-medium text-slate-800">{currency} {Number(cb.deposit_paid || 0).toFixed(2)}</td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      cb.payment_status === 'paid'
                        ? 'bg-green-100 text-green-700'
                        : cb.payment_status === 'deposit_paid'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {String(cb.payment_status || 'pending').replace(/_/g, ' ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </HorizontalScrollArea>
        </div>
      )}

      {dayUseEntries.length > 0 && (
        <div className="bb-table-shell mb-6">
          <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-slate-800 flex items-center gap-2">
                <Briefcase size={17} className="text-cyan-600" /> Day Use & Facility Access ({dayUseEntries.length})
              </h2>
              <p className="mt-1 text-sm text-slate-500">Pool visits, facility chilling, braai usage, and optional extras for the selected period.</p>
            </div>
          </div>
          <div className="grid gap-4 border-b border-slate-200/80 bg-slate-50/70 px-5 py-4 lg:grid-cols-4">
            <div className="rounded-2xl border border-cyan-100 bg-white px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Top Templates</p>
              <div className="mt-3 space-y-2">
                {dayUseInsights.templates.slice(0, 3).map((item) => (
                  <div key={`template-${item.label}`} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-slate-700">{item.label}</span>
                    <span className="font-semibold text-cyan-700">{currency} {item.revenue.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Most-used Resources</p>
              <div className="mt-3 space-y-2">
                {dayUseInsights.resources.slice(0, 3).map((item) => (
                  <div key={`resource-${item.label}`} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-slate-700">{item.label}</span>
                    <span className="font-semibold text-emerald-700">{item.count} use{item.count === 1 ? '' : 's'}</span>
                  </div>
                ))}
                {dayUseInsights.resources.length === 0 && <p className="text-sm text-slate-500">No resources assigned in this period.</p>}
              </div>
            </div>
            <div className="rounded-2xl border border-amber-100 bg-white px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">Top Extras</p>
              <div className="mt-3 space-y-2">
                {dayUseInsights.extras.slice(0, 3).map((item) => (
                  <div key={`extra-${item.label}`} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-slate-700">{item.label}</span>
                    <span className="font-semibold text-amber-700">{item.quantity} sold</span>
                  </div>
                ))}
                {dayUseInsights.extras.length === 0 && <p className="text-sm text-slate-500">No extras sold in this period.</p>}
              </div>
            </div>
            <div className="rounded-2xl border border-violet-100 bg-white px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-700">Outstanding Day Use Balances</p>
              <div className="mt-3 space-y-2">
                {dayUseInsights.balances.slice(0, 3).map((item) => (
                  <div key={`balance-${item.id}`} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-slate-700">{item.guest}</span>
                    <span className="font-semibold text-violet-700">{currency} {item.balance.toFixed(2)}</span>
                  </div>
                ))}
                {dayUseInsights.balances.length === 0 && <p className="text-sm text-slate-500">No open balances in this period.</p>}
              </div>
            </div>
          </div>
          <HorizontalScrollArea>
          <table className="min-w-[1280px] w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="px-5 py-3 text-left">Guest</th>
                <th className="px-5 py-3 text-left">Date</th>
                <th className="px-5 py-3 text-left">Template</th>
                <th className="px-5 py-3 text-left">Activity</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-left">Access</th>
                <th className="px-5 py-3 text-left">Resource</th>
                <th className="px-5 py-3 text-left">Extras</th>
                <th className="px-5 py-3 text-right">Extras Total</th>
                <th className="px-5 py-3 text-right">Guests</th>
                <th className="px-5 py-3 text-right">Deposit</th>
                <th className="px-5 py-3 text-right">Balance</th>
                <th className="px-5 py-3 text-right">Total</th>
                <th className="px-5 py-3 text-left">Payment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dayUseEntries.map((entry) => {
                const row = normalizeDayUseReportRow(entry)
                const extrasSummary = summarizeDayUseExtras(entry.extras)
                const accessSummary = row.accessSummary || getDayUseActivityLabel(entry)
                return (
                  <tr key={entry.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-800">{row.guest}</p>
                      {entry.phone && <p className="text-xs text-slate-500">{entry.phone}</p>}
                    </td>
                    <td className="px-5 py-3 text-slate-600 whitespace-nowrap">{row.date}</td>
                    <td className="px-5 py-3 text-slate-600">{row.templateName || '-'}</td>
                    <td className="px-5 py-3 text-slate-600">{row.activityLabel}</td>
                    <td className="px-5 py-3 text-slate-600">{row.statusLabel}</td>
                    <td className="px-5 py-3 text-slate-600">{accessSummary}</td>
                    <td className="px-5 py-3 text-slate-600">{row.resourceName || '-'}</td>
                    <td className="px-5 py-3 text-slate-600">{extrasSummary || '-'}</td>
                    <td className="px-5 py-3 text-right text-amber-700">{currency} {row.extrasTotal.toFixed(2)}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{row.adults + row.children}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{currency} {row.depositAmount.toFixed(2)}</td>
                    <td className="px-5 py-3 text-right text-violet-700">{currency} {row.balanceDue.toFixed(2)}</td>
                    <td className="px-5 py-3 text-right font-medium text-slate-800">{currency} {row.total.toFixed(2)}</td>
                    <td className="px-5 py-3 text-slate-600">{formatPaymentMethod(row.paymentMethod)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </HorizontalScrollArea>
        </div>
      )}

      <div className="bb-table-shell">
        <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4">
          <h2 className="text-lg font-semibold tracking-[-0.02em] text-slate-800">Room Occupancy — {totalNights}-day period</h2>
          {bestRoom && bestRoom.occupancy_rate > 0 && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">
              🏆 Best: Room {bestRoom.room_number} ({bestRoom.occupancy_rate}%)
            </span>
          )}
        </div>
        <div className="flex gap-4 border-b border-slate-200/80 bg-slate-50 px-5 py-2 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" /> 70%+ High</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-yellow-400 inline-block" /> 30–69% Medium</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block" /> &lt;30% Low</span>
        </div>
        <HorizontalScrollArea>
          <table className="min-w-[980px] w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="px-5 py-3 text-left">Room</th>
                <th className="px-5 py-3 text-left">Type</th>
                <th className="px-5 py-3 text-left">Rate / Night</th>
                <th className="px-5 py-3 text-left">Nights Booked</th>
                <th className="px-5 py-3 text-left w-48">Occupancy</th>
                <th className="px-5 py-3 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={6} className="px-5 py-10"><div className="bb-empty-state py-8"><p className="text-sm font-medium text-slate-500">Loading occupancy and revenue performance…</p></div></td></tr>}
              {!loading && occupancy.map((room) => {
                const col = occColor(room.occupancy_rate)
                const isBest = bestRoom?.id === room.id && room.occupancy_rate > 0
                return (
                  <tr key={room.id} className={`hover:bg-slate-50 ${isBest ? 'bg-green-50/30' : ''}`}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800">Room {room.room_number}</span>
                        {isBest && <span className="text-[10px] text-green-600">🏆</span>}
                        {room.has_event && <span className="text-[9px] font-bold bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded">EVENT</span>}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{room.room_type}</td>
                    <td className="px-5 py-3 text-slate-600">{currency} {Number(room.rate_per_night).toFixed(2)}</td>
                    <td className="px-5 py-3 text-slate-600">{room.occupied_nights} / {totalNights}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 flex-1 rounded-full bg-slate-100">
                          <div className={`${col.bar} h-2.5 rounded-full transition-all`} style={{ width: `${room.occupancy_rate}%` }} />
                        </div>
                        <span className={`text-xs font-semibold w-10 text-right ${col.text}`}>{room.occupancy_rate}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-slate-800">
                      {currency} {Number(room.actual_revenue || 0).toFixed(2)}
                    </td>
                  </tr>
                )
              })}
              {!loading && occupancy.length === 0 && !error && (
                <tr><td colSpan={6} className="px-5 py-10"><div className="bb-empty-state py-10"><p className="text-base font-semibold text-slate-800">No data for selected period</p><p className="text-sm text-slate-500">Try a different date range to review occupancy and revenue performance.</p></div></td></tr>
              )}
            </tbody>
            {!loading && occupancy.length > 0 && (
              <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                <tr>
                  <td colSpan={3} className="px-5 py-3 text-xs font-semibold uppercase text-slate-500">Totals / Averages</td>
                  <td className="px-5 py-3 text-sm font-semibold text-slate-700">
                    {occupancy.reduce((s, r) => s + r.occupied_nights, 0)} nights total
                  </td>
                  <td className="px-5 py-3 text-sm font-semibold text-slate-700">{avgOccupancy}% avg</td>
                  <td className="px-5 py-3 text-right text-sm font-bold text-green-700">
                    {currency} {occupancy.reduce((s, r) => s + (r.actual_revenue || 0), 0).toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </HorizontalScrollArea>
      </div>

        <div className="bb-table-shell mt-6">
          <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-slate-800">Room Profitability</h2>
              <p className="mt-1 text-xs text-slate-500">Uses tracked room revenue minus tracked room-supply cost and recorded maintenance cost. Running cost combines both.</p>
            </div>
            {topRoomContribution && topRoomContribution.contribution > 0 && (
              <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full font-medium">
                Top contribution: Room {topRoomContribution.room_number}
              </span>
            )}
          </div>
          <HorizontalScrollArea>
          <table className="min-w-[1280px] w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-5 py-3 text-left">Room</th>
                  <th className="px-5 py-3 text-left">Type</th>
                  <th className="px-5 py-3 text-right">Occupancy</th>
                  <th className="px-5 py-3 text-right">Revenue</th>
                  <th className="px-5 py-3 text-right">Supply Cost</th>
                  <th className="px-5 py-3 text-right">Maintenance Cost</th>
                  <th className="px-5 py-3 text-right">Running Cost</th>
                  <th className="px-5 py-3 text-right">Contribution</th>
                  <th className="px-5 py-3 text-right">Margin</th>
                  <th className="px-5 py-3 text-right">Supply Units</th>
                  <th className="px-5 py-3 text-right">Maintenance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={11} className="px-5 py-10"><div className="bb-empty-state py-8"><p className="text-sm font-medium text-slate-500">Loading room profitability…</p></div></td></tr>}
              {!loading && roomProfitability.map((room) => {
                const runningCost = Number(room.running_cost ?? (Number(room.supply_cost || 0) + Number(room.maintenance_cost || 0)))
                return (
                  <tr key={room.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-800">Room {room.room_number}</td>
                    <td className="px-5 py-3 text-slate-600">{room.room_type}</td>
                    <td className="px-5 py-3 text-right text-slate-700">{room.occupancy_rate}%</td>
                    <td className="px-5 py-3 text-right font-medium text-slate-800">{currency} {Number(room.revenue || 0).toFixed(2)}</td>
                    <td className="px-5 py-3 text-right text-amber-700">{currency} {Number(room.supply_cost || 0).toFixed(2)}</td>
                    <td className="px-5 py-3 text-right text-rose-700">{currency} {Number(room.maintenance_cost || 0).toFixed(2)}</td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-700">{currency} {runningCost.toFixed(2)}</td>
                    <td className={`px-5 py-3 text-right font-semibold ${Number(room.contribution || 0) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{currency} {Number(room.contribution || 0).toFixed(2)}</td>
                    <td className={`px-5 py-3 text-right font-semibold ${Number(room.margin_pct || 0) >= 50 ? 'text-emerald-700' : Number(room.margin_pct || 0) >= 0 ? 'text-slate-700' : 'text-red-600'}`}>{Number(room.margin_pct || 0)}%</td>
                    <td className="px-5 py-3 text-right text-slate-600">{Number(room.supply_units_used || 0).toFixed(0)}</td>
                    <td className="px-5 py-3 text-right text-slate-600">
                      {room.maintenance_count || 0}
                      {room.open_maintenance_count > 0 && <span className="ml-1 text-[11px] font-semibold text-red-500">({room.open_maintenance_count} open)</span>}
                    </td>
                  </tr>
                )
              })}
              {!loading && roomProfitability.length === 0 && !error && (
                <tr><td colSpan={11} className="px-5 py-10"><div className="bb-empty-state py-10"><p className="text-base font-semibold text-slate-800">No room profitability data yet</p><p className="text-sm text-slate-500">You will see room-level contribution here once bookings, room-supply usage, and maintenance have been recorded.</p></div></td></tr>
              )}
            </tbody>
          </table>
        </HorizontalScrollArea>
      </div>
      </>}

      {/* ── P&L TAB ──────────────────────────────────────────────────────────── */}
      {activeTab === 'pl' && (
        <div>
          {plLoading ? (
            <div className="bb-empty-state min-h-[220px]">
              <p className="text-sm font-medium text-slate-500">Loading P&amp;L…</p>
            </div>
          ) : !pl ? (
            <div className="bb-empty-state min-h-[220px]">
              <p className="text-sm">No data is available for this period yet. Try a different range or confirm activity has been recorded.</p>
            </div>
          ) : (
            <>
              {/* Revenue */}
              <div className="bb-card mb-4 p-5">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Revenue</h2>
                <div className="space-y-2">
                  <PLRow label="Booking Revenue"   value={`${currency} ${Number(pl.bookingRevenue).toFixed(2)}`} />
                  <PLRow label="Fees Kept From Refunds" value={`${currency} ${Number(pl.retainedRevenue || 0).toFixed(2)}`} />
                  <PLRow label="POS Revenue"        value={`${currency} ${Number(pl.posRevenue).toFixed(2)}`} />
                  {(pl.conferenceRevenue > 0) && (
                    <PLRow label="Conference Revenue" value={`${currency} ${Number(pl.conferenceRevenue).toFixed(2)}`} />
                  )}
                  {(pl.poolRevenue > 0) && (
                    <PLRow label="Day Use / Facility Access" value={`${currency} ${Number(pl.poolRevenue).toFixed(2)}`} />
                  )}
                  <PLRow label="Total Revenue" value={`${currency} ${Number(pl.totalRevenue).toFixed(2)}`} bold />
                  {pl.vatEnabled && <>
                    <PLRow label={pl.vatMixed ? 'VAT (mixed historical rates)' : `VAT (${pl.vatRate}% inclusive)`} value={`- ${currency} ${Number(pl.vatAmount).toFixed(2)}`} muted />
                    <PLRow label="Net Revenue (excl. VAT)" value={`${currency} ${Number(pl.netRevenue).toFixed(2)}`} muted />
                  </>}
                </div>
              </div>

              {/* Expenses */}
              <div className="bb-card mb-4 p-5">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Operating Expenses</h2>
                <div className="space-y-2">
                  {Object.entries(pl.expByCategory || {}).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
                    <PLRow key={cat} label={cat} value={`${currency} ${Number(amt).toFixed(2)}`} />
                  ))}
                  {Object.keys(pl.expByCategory || {}).length === 0 && (
                    <p className="text-sm text-slate-400">No expenses have been recorded for this period.</p>
                  )}
                  <PLRow label="Total Expenses" value={`${currency} ${Number(pl.totalExpenses).toFixed(2)}`} bold />
                </div>
              </div>

              {/* Stock Costs */}
              <div className="bb-card mb-4 p-5">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Stock & Maintenance Costs</h2>
                <div className="space-y-2">
                  <PLRow label="Inventory Purchases" value={`${currency} ${Number(pl.invCosts || 0).toFixed(2)}`} />
                  <PLRow label="Room Supplies"       value={`${currency} ${Number(pl.supCosts || 0).toFixed(2)}`} />
                  <PLRow label="Maintenance Repairs" value={`${currency} ${Number(pl.maintenanceCosts || 0).toFixed(2)}`} />
                  <PLRow label="Total Stock & Maintenance Costs"   value={`${currency} ${Number(pl.totalCosts || 0).toFixed(2)}`} bold />
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
                <p className="mt-1 text-xs text-slate-500">Revenue, including fees kept from refunds, minus expenses and stock & maintenance costs.</p>
              </div>

              {/* Outlet P&L Breakdown — only for users with combined report access */}
              {outletPL && canViewCombinedReports && (
                <div className="bb-card mt-4 p-5">
                  <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Profit &amp; Loss by Outlet</h2>
                  <HorizontalScrollArea>
                    <table className="min-w-[1100px] w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-400">
                          <th className="pb-2 text-left">Outlet</th>
                          <th className="pb-2 text-right">POS Revenue</th>
                          <th className="pb-2 text-right">Booking Revenue</th>
                          <th className="pb-2 text-right">Total Revenue</th>
                          <th className="pb-2 text-right">Inventory Cost</th>
                          <th className="pb-2 text-right">Room Supplies</th>
                          <th className="pb-2 text-right">Maintenance Cost</th>
                          <th className="pb-2 text-right">Expenses</th>
                          <th className="pb-2 text-right">Profit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {outletPL.outlets.map(row => (
                          <tr key={row.key} className="border-b border-slate-100">
                            <td className="py-2 font-medium text-slate-700">{row.name}</td>
                            <td className="py-2 text-right text-slate-600">{currency} {Number(row.posRevenue).toFixed(2)}</td>
                            <td className="py-2 text-right text-slate-600">{currency} {Number(row.bookingRevenue).toFixed(2)}</td>
                            <td className="py-2 text-right font-semibold text-slate-700">{currency} {Number(row.revenue).toFixed(2)}</td>
                            <td className="py-2 text-right text-slate-600">{currency} {Number(row.inventoryCost).toFixed(2)}</td>
                            <td className="py-2 text-right text-slate-600">{currency} {Number(row.supplyCost).toFixed(2)}</td>
                            <td className="py-2 text-right text-rose-700">{currency} {Number(row.maintenanceCost || 0).toFixed(2)}</td>
                            <td className="py-2 text-right text-slate-600">{currency} {Number(row.expenses).toFixed(2)}</td>
                            <td className={`py-2 text-right font-semibold ${row.profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                              {row.profit < 0 ? '- ' : ''}{currency} {Math.abs(row.profit).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                        {/* Combined row */}
                        <tr className="bg-slate-50 font-bold">
                          <td className="rounded-l-lg py-2.5 pl-2 text-slate-800">Combined</td>
                          <td className="py-2.5 text-right text-slate-700">{currency} {Number(outletPL.combined.posRevenue).toFixed(2)}</td>
                          <td className="py-2.5 text-right text-slate-700">{currency} {Number(outletPL.combined.bookingRevenue).toFixed(2)}</td>
                          <td className="py-2.5 text-right text-slate-800">{currency} {Number(outletPL.combined.revenue).toFixed(2)}</td>
                          <td className="py-2.5 text-right text-slate-700">{currency} {Number(outletPL.combined.inventoryCost).toFixed(2)}</td>
                          <td className="py-2.5 text-right text-slate-700">{currency} {Number(outletPL.combined.supplyCost).toFixed(2)}</td>
                          <td className="py-2.5 text-right text-rose-700">{currency} {Number(outletPL.combined.maintenanceCost || 0).toFixed(2)}</td>
                          <td className="py-2.5 text-right text-slate-700">{currency} {Number(outletPL.combined.expenses).toFixed(2)}</td>
                          <td className={`rounded-r-lg py-2.5 pr-0 text-right ${outletPL.combined.profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                            {outletPL.combined.profit < 0 ? '- ' : ''}{currency} {Math.abs(outletPL.combined.profit).toFixed(2)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </HorizontalScrollArea>
                  <p className="mt-3 text-xs text-slate-400">Room supply and room-based maintenance costs are grouped under Front Desk. Booking revenue is attributed to Front Desk only.</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function PLRow({ label, value, bold, muted }) {
  return (
    <div className={`flex justify-between border-b border-slate-100 py-1 text-sm ${bold ? 'border-t border-slate-200 pt-2 font-semibold' : ''} ${muted ? 'text-slate-400' : 'text-slate-700'}`}>
      <span>{label}</span>
      <span className={bold ? 'text-slate-900' : ''}>{value}</span>
    </div>
  )
}

function SummaryCard({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="bb-card p-4">
      <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-2xl ${color}`}>
        <Icon size={17} />
      </div>
      <p className="text-xl font-bold text-slate-800">{value}</p>
      <p className="mt-0.5 text-xs text-slate-500">{label}</p>
      {sub && <p className="mt-0.5 text-[10px] text-slate-400">{sub}</p>}
    </div>
  )
}

function StatusStat({ label, value, color }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-2.5 h-2.5 rounded-full ${color} flex-shrink-0`} />
      <div>
        <p className="text-lg font-bold text-slate-800">{value}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </div>
  )
}
