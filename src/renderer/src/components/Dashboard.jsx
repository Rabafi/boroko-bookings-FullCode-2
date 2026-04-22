import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  BedDouble,
  CalendarCheck,
  CalendarX,
  DollarSign,
  TrendingUp,
  Users,
  ArrowRight,
  AlertTriangle,
  Lock,
  BookOpen,
  BarChart3,
  Receipt,
  ClipboardList,
  Presentation,
  Waves,
  ShoppingCart,
  Package,
  Boxes,
  Globe,
  Tag,
  CheckCircle,
  XCircle,
  Clock,
  CreditCard
} from 'lucide-react'
import { StatusBadge } from './shared/StatusBadge'
import HorizontalScrollArea from './shared/HorizontalScrollArea'
import { useSettings, useFeatures, useOnlineRequests } from '../app-context'

const SHORTCUTS = [
  { label: 'Bookings',      to: '/bookings',   icon: BookOpen },
  { label: 'Expenses',      to: '/expenses',   icon: Receipt,       feature: 'expenses',   tier: 'Standard' },
  { label: 'Reports',       to: '/reports',    icon: BarChart3,     feature: 'reports',    tier: 'Standard' },
  { label: 'Night Audit',   to: '/audit',      icon: ClipboardList, feature: 'audit',      tier: 'Standard' },
  { label: 'Conference',    to: '/conference', icon: Presentation,  feature: 'conference', tier: 'Standard' },
  { label: 'Day Use',       to: '/dayuse',     icon: Waves,         feature: 'pool',       tier: 'Standard' },
  { label: 'Staff',         to: '/staff',      icon: Users,         feature: 'staff',      tier: 'Standard' },
  { label: 'POS',           to: '/pos',        icon: ShoppingCart,  feature: 'pos',        tier: 'Pro' },
  { label: 'Inventory',     to: '/inventory',  icon: Package,       feature: 'inventory',  tier: 'Pro' },
  { label: 'Room Supplies', to: '/supplies',   icon: Boxes,         feature: 'supplies',   tier: 'Pro' },
]

function getRequestAgeMeta(createdAt) {
  const time = createdAt ? new Date(createdAt).getTime() : NaN
  if (!Number.isFinite(time)) {
    return {
      label: 'New',
      detail: 'Recently submitted',
      tone: 'bg-slate-100 text-slate-700'
    }
  }

  const ageHours = Math.max(0, (Date.now() - time) / 3600000)
  if (ageHours >= 24) {
    const days = Math.floor(ageHours / 24)
    return {
      label: `${days}d waiting`,
      detail: `Waiting for ${days} day${days === 1 ? '' : 's'}`,
      tone: 'bg-red-100 text-red-700'
    }
  }
  if (ageHours >= 4) {
    return {
      label: `${Math.floor(ageHours)}h waiting`,
      detail: `Waiting for ${Math.floor(ageHours)} hour${Math.floor(ageHours) === 1 ? '' : 's'}`,
      tone: 'bg-amber-100 text-amber-700'
    }
  }
  return {
    label: 'New',
    detail: 'Submitted recently',
    tone: 'bg-emerald-100 text-emerald-700'
  }
}

function formatWhatsAppPhone(phone) {
  if (!phone) return ''
  let p = phone.replace(/\D/g, '')
  if (p.startsWith('00')) p = p.slice(2)
  if (!p.startsWith('267') && p.length <= 8) p = '267' + p
  return p
}

export default function Dashboard() {
  const { settings } = useSettings()
  const features = useFeatures()
  const navigate = useNavigate()
  const currency = settings?.currency || 'P'
  const { requests: onlineRequests, refresh: refreshOnlineRequests } = useOnlineRequests()
  const [actioningId, setActioningId] = useState(null)

  const [stats, setStats] = useState(null)
  const [recentBookings, setRecentBookings] = useState([])
  const [bookingHealth, setBookingHealth] = useState({ outstandingTotal: 0, unpaidCount: 0 })
  const [overdueBalances, setOverdueBalances] = useState([])
  const [activeBalanceCount, setActiveBalanceCount] = useState(0)
  const [upcoming, setUpcoming] = useState({ today: [], tomorrow: [], dayAfter: [] })
  const [forecast, setForecast] = useState([])
  const [lowStock, setLowStock] = useState([])
  const [paymentMixToday, setPaymentMixToday] = useState({ total_collected: 0, gross_collected: 0, refunds_issued: 0, by_method: {}, payment_count: 0, date: null })
  const [frontDeskRequests, setFrontDeskRequests] = useState([])
  const [activeSpecials, setActiveSpecials] = useState([])
  const [requestDialog, setRequestDialog] = useState(null)
  const [requestStatus, setRequestStatus] = useState('open')
  const [requestNote, setRequestNote] = useState('')
  const [requestSaving, setRequestSaving] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [s, bookings, up, fc, ls, paymentMix, lodgeRequests, rooms, rateOverrides] = await Promise.all([
        window.api.dashboard.stats(),
        window.api.bookings.getAll(),
        window.api.notifications.upcoming(),
        window.api.dashboard.forecast(30).catch(() => []),
        window.api.inventory.getLowStock().catch(() => []),
        window.api.dashboard.bookingPaymentsToday().catch(() => ({ total_collected: 0, gross_collected: 0, refunds_issued: 0, by_method: {}, payment_count: 0, date: null })),
        window.api.requests?.getAll?.(8).catch(() => []),
        window.api.rooms.getAll().catch(() => []),
        window.api.rateOverrides.getAll().catch(() => [])
      ])
      const allBookings = Array.isArray(bookings) ? bookings : []
      setStats(s || null)

    // Collapse exclusive event room-rows into one entry per event group
    const regularBookings = allBookings.filter(b => !b.is_exclusive_event)
    const eventRows       = allBookings.filter(b => b.is_exclusive_event)
    const eventGroupMap   = {}
    eventRows.forEach(b => {
      if (!b) return
      const match   = b.notes?.match(/\[GROUP:([^\]]+)\]/)
      const groupId = match?.[1] || b.check_in || 'unknown'
      if (!eventGroupMap[groupId]) {
        eventGroupMap[groupId] = { ...b, room_count: 0, total_amount: 0, amount_paid: 0, _event_group: true }
      }
      eventGroupMap[groupId].room_count++
      eventGroupMap[groupId].total_amount += Number(b.total_amount || 0)
      eventGroupMap[groupId].amount_paid  += Number(b.amount_paid  || 0)
    })

    const combined = [...regularBookings, ...Object.values(eventGroupMap)]
      .filter(Boolean)
      .sort((a, b_) => {
        const da = a.check_in ? new Date(a.check_in) : new Date(0)
        const db_ = b_.check_in ? new Date(b_.check_in) : new Date(0)
        return db_ - da
      })
    setRecentBookings(combined.slice(0, 6))
    const revenueEligible = combined.filter((b) => b && (b.status || '') !== 'cancelled')
    const computedOutstandingTotal = revenueEligible.reduce((sum, booking) => (
      sum + Math.max(0, Number(booking?.total_amount || 0) + Number(booking?.charges_total || 0) - Number(booking?.amount_paid || 0))
    ), 0)
    const computedUnpaidCount = revenueEligible.filter((booking) => (
      Math.max(0, Number(booking?.total_amount || 0) + Number(booking?.charges_total || 0) - Number(booking?.amount_paid || 0)) > 0
    )).length
    const mostOverdueBalances = revenueEligible
      .map((booking) => ({
        ...booking,
        outstanding_balance: Math.max(0, Number(booking?.total_amount || 0) + Number(booking?.charges_total || 0) - Number(booking?.amount_paid || 0))
      }))
      .filter((booking) => booking.outstanding_balance > 0)
      .sort((left, right) => {
        const leftPriority = left.status === 'checked_out' ? 0 : left.status === 'checked_in' ? 1 : 2
        const rightPriority = right.status === 'checked_out' ? 0 : right.status === 'checked_in' ? 1 : 2
        if (leftPriority !== rightPriority) return leftPriority - rightPriority
        return String(left.check_out || left.check_in || left.created_at || '').localeCompare(
          String(right.check_out || right.check_in || right.created_at || '')
        )
      })
    setBookingHealth({
      outstandingTotal: Number(s?.outstanding_total ?? computedOutstandingTotal),
      unpaidCount: Number(s?.unpaid_count ?? computedUnpaidCount)
    })
    setActiveBalanceCount(
      revenueEligible.filter((booking) => (
        ['confirmed', 'checked_in'].includes(booking.status) &&
        Math.max(0, Number(booking.total_amount || 0) + Number(booking.charges_total || 0) - Number(booking.amount_paid || 0)) > 0
      )).length
    )
    setOverdueBalances(mostOverdueBalances.slice(0, 4))
    setUpcoming(up && typeof up === 'object' ? up : { today: [], tomorrow: [], dayAfter: [] })
    setForecast(Array.isArray(fc) ? fc : [])
    setLowStock(Array.isArray(ls) ? ls : [])
    setFrontDeskRequests(Array.isArray(lodgeRequests) ? lodgeRequests : [])
    const roomNumberById = new Map((Array.isArray(rooms) ? rooms : []).map((room) => [room.id, room.room_number]))
    const todayKey = new Date().toISOString().slice(0, 10)
    setActiveSpecials(
      (Array.isArray(rateOverrides) ? rateOverrides : [])
        .filter((row) => row?.start_date && row?.end_date && row.start_date <= todayKey && row.end_date >= todayKey)
        .map((row) => {
          const start = new Date(`${row.start_date}T00:00:00`)
          const end = new Date(`${row.end_date}T00:00:00`)
          const durationDays = Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())
            ? Math.max(1, Math.round((end - start) / 86400000) + 1)
            : 0
          const daysRemaining = Number.isFinite(end.getTime())
            ? Math.max(1, Math.round((end - new Date(`${todayKey}T00:00:00`)) / 86400000) + 1)
            : 0
          return {
            ...row,
            roomLabel: row.room_id ? `Room ${roomNumberById.get(row.room_id) || row.room_id}` : 'All rooms',
            durationDays,
            daysRemaining
          }
        })
        .sort((left, right) => String(left.end_date || '').localeCompare(String(right.end_date || '')))
    )
      setPaymentMixToday(paymentMix && typeof paymentMix === 'object'
          ? {
            total_collected: Number(paymentMix.total_collected || 0),
            gross_collected: Number(paymentMix.gross_collected || 0),
            refunds_issued: Number(paymentMix.refunds_issued || 0),
            by_method: paymentMix.by_method && typeof paymentMix.by_method === 'object' ? paymentMix.by_method : {},
            payment_count: Number(paymentMix.payment_count || 0),
            date: paymentMix.date || null
          }
        : { total_collected: 0, gross_collected: 0, refunds_issued: 0, by_method: {}, payment_count: 0, date: null })
    } catch (err) {
      console.error('[Dashboard] Failed to load dashboard data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const openRequestDialog = useCallback((request) => {
    setRequestDialog(request)
    setRequestStatus(request?.status || 'open')
    setRequestNote(request?.admin_notes || '')
  }, [])

  const saveRequestUpdate = useCallback(async () => {
    if (!requestDialog?.id || !window.api?.requests?.update) return
    setRequestSaving(true)
    try {
      const result = await window.api.requests.update(requestDialog.id, {
        status: requestStatus,
        admin_notes: requestNote
      })
      if (!result?.success) throw new Error(result?.error || 'Could not update request')
      setRequestDialog(null)
      await loadData()
    } finally {
      setRequestSaving(false)
    }
  }, [loadData, requestDialog?.id, requestNote, requestStatus])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleOnlineBookingAction = async (bookingId, action) => {
    setActioningId(bookingId)
    try {
      // 'confirmed' or 'cancelled'
      await window.api.bookings.updateStatus(bookingId, action)
      await refreshOnlineRequests()
    } catch { /* non-fatal */ } finally {
      setActioningId(null)
    }
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  const allUpcoming = useMemo(() => [
    ...(upcoming.today || []).map((b) => ({ ...b, _label: 'Today' })),
    ...(upcoming.tomorrow || []).map((b) => ({ ...b, _label: 'Tomorrow' })),
    ...(upcoming.dayAfter || []).map((b) => ({ ...b, _label: 'Day After' }))
  ], [upcoming])

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="bb-page-header">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700/70">Operations Overview</p>
          <h1 className="bb-page-header-title mt-2">Dashboard</h1>
          <p className="bb-page-header-subtitle">{today}</p>
        </div>

<div className="bb-card-muted min-w-[240px] px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">At a glance</p>
          <p className="mt-2 text-sm text-slate-600">
            Review occupancy, arrivals, revenue, and operational alerts without losing sight of the front desk.
          </p>
        </div>
      </div>

      {/* ── Online Booking Requests ─────────────────────────────────────── */}
      {onlineRequests.length > 0 && (
        <section className="rounded-2xl border-2 border-amber-400 bg-amber-50 shadow-[0_8px_32px_rgba(217,119,6,0.18)] overflow-hidden">
          <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-amber-200">
            <div className="flex items-center gap-3">
              <Globe size={18} className="text-amber-600" />
              <p className="text-sm font-bold text-amber-900">Online Booking Requests</p>
            </div>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold shadow animate-pulse">
              {onlineRequests.length}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-100/70 px-5 py-3">
            <p className="text-sm font-medium text-amber-900">
              These requests are waiting for front-desk action before guests can be relied on in operations.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-xl border border-amber-300 bg-white/80 px-3 py-2 text-xs font-semibold text-amber-800">
                Oldest request: {getRequestAgeMeta(
                  onlineRequests.reduce((oldest, booking) => {
                    if (!oldest) return booking?.created_at || null
                    return String(booking?.created_at || '') < String(oldest) ? booking.created_at : oldest
                  }, null)
                ).label}
              </span>
              <button
                type="button"
                onClick={() => navigate('/bookings', { state: { showPendingOnline: true } })}
                className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-50"
              >
                Open Booking Queue <ArrowRight size={13} />
              </button>
            </div>
          </div>
          <div className="divide-y divide-amber-100">
            {onlineRequests.map((booking) => {
              const nights = booking.check_in && booking.check_out
                ? Math.round((new Date(booking.check_out) - new Date(booking.check_in)) / 86400000)
                : 0
              const isActioning = actioningId === booking.id
              const ageMeta = getRequestAgeMeta(booking.created_at)
              return (
                <div key={booking.id} className="flex flex-col sm:flex-row sm:items-center gap-4 px-5 py-4 hover:bg-amber-100/50 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-slate-800 text-sm truncate">{booking.customer_name || 'Guest'}</p>
                      <span className="shrink-0 rounded-full bg-amber-200 text-amber-800 text-[10px] font-semibold px-2 py-0.5 flex items-center gap-1">
                        <Clock size={9} /> Pending
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${ageMeta.tone}`}>
                        {ageMeta.label}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 truncate">
                      {booking.room_number} · {booking.room_type} · {nights} night{nights !== 1 ? 's' : ''}
                      {' · '}{new Date(booking.check_in).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      {' → '}{new Date(booking.check_out).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                    <p className="mt-1 text-xs font-medium text-amber-800/90">{ageMeta.detail}</p>
                    {booking.customer_email && (
                      <p className="text-xs text-slate-400 truncate mt-0.5">{booking.customer_email}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-bold text-slate-700">{currency}{Number(booking.total_amount).toLocaleString()}</span>
                    <button
                      disabled={isActioning}
                      onClick={() => handleOnlineBookingAction(booking.id, 'confirmed')}
                      className="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold px-3 py-2 transition-colors"
                    >
                      <CheckCircle size={13} />
                      Confirm
                    </button>
                    <button
                      disabled={isActioning}
                      onClick={() => handleOnlineBookingAction(booking.id, 'cancelled')}
                      className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-white hover:bg-red-50 disabled:opacity-50 text-red-600 text-xs font-semibold px-3 py-2 transition-colors"
                    >
                      <XCircle size={13} />
                      Decline
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section className="bb-card p-5">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
              <Tag size={18} />
            </div>
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Running Specials</h2>
              <p className="mt-1 text-sm text-slate-500">Seasonal and event pricing that is active today.</p>
            </div>
          </div>
          <Link
            to="/rooms"
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
          >
            Manage Specials <ArrowRight size={13} />
          </Link>
        </div>
        {activeSpecials.length === 0 ? (
          <p className="text-sm text-slate-500">No seasonal or event specials are running today.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {activeSpecials.map((special) => (
              <div key={special.id} className="rounded-2xl border border-emerald-100 bg-emerald-50/60 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-800">{special.name || 'Special price'}</p>
                    <p className="mt-1 text-xs text-slate-500">{special.roomLabel}</p>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700 shadow-sm">
                    {currency} {Number(special.rate_per_night || 0).toFixed(2)}
                  </span>
                </div>
                <div className="mt-3 space-y-1 text-xs text-slate-600">
                  <p>{special.start_date} to {special.end_date}</p>
                  <p>Duration: {special.durationDays} day{special.durationDays === 1 ? '' : 's'}</p>
                  <p>{special.daysRemaining} day{special.daysRemaining === 1 ? '' : 's'} remaining</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Quick Access */}
      <section className="bb-card p-5">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Quick Access</h2>
            <p className="mt-1 text-sm text-slate-500">Jump into the most-used desk and back-office modules.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-10">
          {SHORTCUTS.map(({ label, to, icon: Icon, feature, tier }) => {
            const isLocked = feature && Object.keys(features).length > 0 && features[feature] === false
            const tierColor = tier === 'Pro' ? 'text-purple-500' : 'text-blue-500'
            return (
              <button
                key={to}
                onClick={() => navigate(to)}
                className={`relative flex flex-col items-start gap-2 rounded-2xl border px-4 py-4 text-left transition-all ${
                  isLocked
                    ? 'border-slate-200 bg-slate-50/90 opacity-60 hover:opacity-80'
                    : 'border-slate-200 bg-white/90 hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50/60 hover:shadow-md'
                }`}
              >
                <div className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl ${isLocked ? 'bg-slate-100 text-slate-400' : 'bg-slate-100 text-slate-700'}`}>
                  <Icon size={20} />
                </div>
                <span className="text-sm font-semibold leading-tight text-slate-700">{label}</span>
                {isLocked && (
                  <Lock size={10} className={`absolute top-1.5 right-1.5 ${tierColor}`} />
                )}
                {isLocked && tier && (
                  <span className={`text-[9px] font-bold ${tierColor}`}>{tier}</span>
                )}
              </button>
            )
          })}
        </div>
      </section>

      {/* Stats Grid */}
      {stats && (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            icon={BedDouble}
            label="Total Rooms"
            value={stats.total_rooms}
            color="bg-blue-50 text-blue-600"
          />
          <StatCard
            icon={Users}
            label="Occupied Today"
            value={stats.occupied_today}
            color="bg-green-50 text-green-600"
          />
          <StatCard
            icon={CalendarCheck}
            label="Check-ins Today"
            value={stats.checkins_today}
            color="bg-teal-50 text-teal-600"
          />
          <StatCard
            icon={CalendarX}
            label="Check-outs Today"
            value={stats.checkouts_today}
            color="bg-orange-50 text-orange-600"
          />
          <StatCard
            icon={DollarSign}
            label="Net Cash This Month"
            value={`${currency} ${Number(stats.revenue_month || 0).toFixed(2)}`}
            color="bg-purple-50 text-purple-600"
          />
          <StatCard
            icon={TrendingUp}
            label="Upcoming Bookings"
            value={stats.upcoming_bookings}
            color="bg-rose-50 text-rose-600"
          />
        </section>
      )}

      {bookingHealth.outstandingTotal > 0 && (
        <section className="rounded-[22px] border border-rose-200 bg-[linear-gradient(135deg,rgba(255,241,242,0.96),rgba(254,226,226,0.82))] p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-rose-700">
                <DollarSign size={20} />
              </div>
              <div>
                <p className="text-sm font-semibold text-rose-900">Outstanding guest balance needs attention</p>
                <p className="mt-1 text-sm text-rose-800/80">
                  {bookingHealth.unpaidCount} booking{bookingHealth.unpaidCount === 1 ? '' : 's'} still owe
                  {' '}<span className="font-semibold">{currency} {Number(bookingHealth.outstandingTotal || 0).toFixed(2)}</span>.
                </p>
                {activeBalanceCount > 0 && (
                  <p className="mt-1 text-xs font-semibold text-rose-700">
                    {activeBalanceCount} active stay{activeBalanceCount === 1 ? '' : 's'} still need collection attention now.
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => navigate('/roomgrid')}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white/70 px-3 py-2 text-xs font-semibold text-rose-700 transition-colors hover:bg-white"
              >
                Open Room Board <ArrowRight size={13} />
              </button>
              <button
                type="button"
                onClick={() => navigate('/invoices')}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-300 bg-white/80 px-3 py-2 text-xs font-semibold text-rose-800 transition-colors hover:bg-white"
              >
                Review Open Invoices <ArrowRight size={13} />
              </button>
            </div>
          </div>
        </section>
      )}

      {paymentMixToday.payment_count > 0 && (
        <section className="bb-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-slate-800">Booking Cash Today by Method</h2>
              <p className="mt-1 text-sm text-slate-500">A quick front-desk view of booking cash movement today, with refunds deducted from the headline total.</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
              {currency} {Number(paymentMixToday.total_collected || 0).toFixed(2)} net
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Gross Collected</p>
              <p className="mt-1 text-lg font-semibold text-slate-800">{currency} {Number(paymentMixToday.gross_collected || 0).toFixed(2)}</p>
            </div>
            <div className="rounded-2xl bg-rose-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-600">Refunds</p>
              <p className="mt-1 text-lg font-semibold text-rose-700">{currency} {Number(paymentMixToday.refunds_issued || 0).toFixed(2)}</p>
            </div>
            <div className="rounded-2xl bg-emerald-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Net Cash</p>
              <p className="mt-1 text-lg font-semibold text-emerald-800">{currency} {Number(paymentMixToday.total_collected || 0).toFixed(2)}</p>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {Object.entries(paymentMixToday.by_method)
              .sort(([, left], [, right]) => Number(right || 0) - Number(left || 0))
              .map(([method, amount]) => {
                const pct = paymentMixToday.total_collected > 0 ? (Number(amount || 0) / paymentMixToday.total_collected) * 100 : 0
                return (
                  <div key={`today-method-${method}`} className="flex items-center gap-3">
                    <span className="w-32 shrink-0 text-sm text-slate-600">{String(method || 'unknown').replace(/_/g, ' ')}</span>
                    <div className="h-2.5 flex-1 rounded-full bg-slate-100">
                      <div className="h-2.5 rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.max(4, pct)}%` }} />
                    </div>
                    <span className="w-24 text-right text-sm font-semibold text-slate-800">
                      {currency} {Number(amount || 0).toFixed(2)}
                    </span>
                    <span className="w-10 text-xs text-slate-400">{Math.round(pct)}%</span>
                  </div>
                )
              })}
          </div>
        </section>
      )}

      {overdueBalances.length > 0 && (
        <section className="bb-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-slate-800">Balance Collection Queue</h2>
              <p className="mt-1 text-sm text-slate-500">Same urgency language as the room board and calendar: checked out first, then active stays, then upcoming arrivals.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => navigate('/calendar')}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                Open Calendar <ArrowRight size={13} />
              </button>
              <button
                type="button"
                onClick={() => navigate('/invoices')}
                className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
              >
                Open All Invoices <ArrowRight size={13} />
              </button>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {overdueBalances.map((booking) => {
              const dueDate = booking.status === 'checked_out' ? booking.check_out : booking.check_in
              return (
                <div key={booking.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-slate-900">{booking.customer_name || 'Guest'}</p>
                      <StatusBadge status={booking.status} />
                      {booking.status === 'checked_out' && (
                        <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                          Checked out and unpaid
                        </span>
                      )}
                      <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                        Due {currency} {Number(booking.outstanding_balance || 0).toFixed(2)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {booking._event_group ? `${booking.room_count} rooms` : `Room ${booking.room_number || '—'}`}
                      {' · '}
                      {booking.status === 'checked_out' ? 'Checkout date' : booking.status === 'checked_in' ? 'Current stay' : 'Arrival date'}
                      {': '}
                      {dueDate || 'Not set'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/bookings', { state: { collectPaymentBookingId: booking.id } })}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
                  >
                    <CreditCard size={13} />
                    Collect Now
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* 30-Day Occupancy Forecast */}
      {forecast.length > 0 && (
        <section className="bb-card p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold tracking-[-0.02em] text-slate-800">30-Day Occupancy Forecast</h2>
            <p className="mt-1 text-sm text-slate-500">See expected room pressure over the next month.</p>
          </div>
          <div className="flex items-end gap-1 h-20 overflow-x-auto pb-1">
            {forecast.map((day) => {
              const pct = day.total > 0 ? (day.occupied / day.total) * 100 : 0
              const barH = Math.max(4, Math.round(pct * 0.72)) // max 72px
              const color =
                pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-400' : 'bg-gray-300'
              const label = new Date(day.date).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short'
              })
              return (
                <div
                  key={day.date}
                  className="flex flex-col items-center gap-1 shrink-0 group relative"
                  style={{ width: '28px' }}
                >
                  {/* Tooltip */}
                  <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                    <div className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-white whitespace-nowrap shadow-lg">
                      {label}: {day.occupied}/{day.total} ({Math.round(pct)}%)
                    </div>
                  </div>
                  <div
                    className={`w-5 rounded-sm ${color} transition-all`}
                    style={{ height: `${barH}px` }}
                  />
                  {(day.date.endsWith('-01') || day.date === forecast[0]?.date || day.date === forecast[6]?.date || day.date === forecast[13]?.date || day.date === forecast[20]?.date || day.date === forecast[27]?.date) && (
                    <span className="text-[9px] text-slate-400 rotate-45 origin-left">
                      {new Date(day.date).getDate()}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-green-500 inline-block" /> ≥80%</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-yellow-400 inline-block" /> ≥50%</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-gray-300 inline-block" /> &lt;50%</span>
          </div>
        </section>
      )}

      {frontDeskRequests.length > 0 && (
        <section className="rounded-[22px] border border-sky-200 bg-[linear-gradient(135deg,rgba(239,246,255,0.98),rgba(224,242,254,0.82))] p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-sky-950">Front Desk Requests</p>
              <p className="mt-1 text-sm text-sky-900/80">
                Requests sent from the Manager PWA appear here. Update the status so the manager can follow progress on mobile.
              </p>
            </div>
            <span className="rounded-full border border-sky-200 bg-white/80 px-3 py-1 text-xs font-semibold text-sky-800">
              {frontDeskRequests.filter((request) => request.status !== 'resolved').length} active
            </span>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
            {frontDeskRequests.map((request) => (
              <button
                key={request.id}
                type="button"
                onClick={() => openRequestDialog(request)}
                className="rounded-2xl border border-sky-100 bg-white/85 px-4 py-4 text-left shadow-sm transition-colors hover:bg-white"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{request.title}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {request.category || 'Request'} · {request.updated_at || request.created_at ? new Date(request.updated_at || request.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Just now'}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${requestStatusTone(request.status)}`}>
                    {requestStatusLabel(request.status)}
                  </span>
                </div>
                <p className="mt-3 text-sm text-slate-700">{request.description || 'No extra detail was added.'}</p>
                {request.admin_notes ? (
                  <div className="mt-3 rounded-xl bg-sky-50 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">Latest desk note</p>
                    <p className="mt-1 text-xs text-sky-900">{request.admin_notes}</p>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-slate-500">No desk update added yet.</p>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Low Stock Alert */}
      {lowStock.length > 0 && (
        <section className="rounded-[22px] border border-amber-200 bg-[linear-gradient(135deg,rgba(255,251,235,0.96),rgba(254,243,199,0.76))] p-4 shadow-sm">
          <div className="flex items-start gap-3">
          <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
            <AlertTriangle size={20} className="shrink-0" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900">
              {lowStock.length} item{lowStock.length > 1 ? 's' : ''} low on stock
            </p>
            <p className="mt-1 text-sm text-amber-800/80">Critical supplies are running low and may affect service continuity.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {lowStock.slice(0, 6).map((item) => (
                <span key={item.id} className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900">
                  {item.name} — {item.current_stock} {item.unit} left
                </span>
              ))}
              {lowStock.length > 6 && (
                <span className="text-xs text-amber-600">+{lowStock.length - 6} more</span>
              )}
            </div>
          </div>
          <Link to="/inventory" className="shrink-0 rounded-xl border border-amber-300 bg-white/70 px-3 py-2 text-xs font-semibold text-amber-800 transition-colors hover:bg-white">
            View Inventory
          </Link>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        {/* Recent Bookings — 3 cols */}
        <section className="bb-table-shell xl:col-span-3">
          <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-slate-800">Recent Bookings</h2>
              <p className="mt-1 text-sm text-slate-500">Latest guest activity and new reservations.</p>
            </div>
            <Link
              to="/bookings"
              className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
            >
              View all <ArrowRight size={14} />
            </Link>
          </div>
          <HorizontalScrollArea>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-5 py-3 text-left">#</th>
                  <th className="px-5 py-3 text-left">Guest</th>
                  <th className="px-5 py-3 text-left">Room</th>
                  <th className="px-5 py-3 text-left">Check In</th>
                  <th className="px-5 py-3 text-left">Status</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentBookings.map((b) => (
                <tr key={b.id} className="hover:bg-emerald-50/30">
                    <td className="px-5 py-4 font-mono text-xs font-semibold text-slate-400">{b._event_group ? '—' : (b.booking_number || '—')}</td>
                    <td className="px-5 py-4 font-medium text-slate-800">
                      <div className="flex items-center gap-1.5">
                        {b.customer_name}
                        {b._event_group && (
                          <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[9px] font-bold text-indigo-600 flex-shrink-0">EVENT</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-slate-600">{b._event_group ? `${b.room_count} rooms` : `Room ${b.room_number}`}</td>
                    <td className="px-5 py-4 text-slate-600">{b.check_in}</td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={b.status} />
                        {Math.max(0, Number(b.total_amount || 0) + Number(b.charges_total || 0) - Number(b.amount_paid || 0)) > 0 && (b.status || '') !== 'cancelled' && (
                          <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                            Due {currency} {Math.max(0, Number(b.total_amount || 0) + Number(b.charges_total || 0) - Number(b.amount_paid || 0)).toFixed(2)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right font-semibold text-slate-800">
                      {currency} {Number(b.total_amount || 0).toFixed(2)}
                    </td>
                  </tr>
                ))}
                {recentBookings.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-10">
                      <div className="bb-empty-state py-10">
                        <p className="text-base font-semibold text-slate-800">No bookings yet</p>
                        <p className="text-sm text-slate-500">Create your first booking to start tracking guest stays and revenue.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </HorizontalScrollArea>
        </section>

        {/* Upcoming Check-ins — 2 cols */}
        <section className="bb-card xl:col-span-2 overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-slate-800">Upcoming Check-ins</h2>
              <p className="mt-1 text-sm text-slate-500">The next three days of arrivals, ready for guest outreach.</p>
            </div>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-500">{allUpcoming.length} arrivals</span>
          </div>
          <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
            {allUpcoming.length === 0 && (
              <div className="p-5">
                <div className="bb-empty-state py-10">
                  <p className="text-base font-semibold text-slate-800">No arrivals in the next 3 days</p>
                  <p className="text-sm text-slate-500">This queue will fill automatically as confirmed bookings approach check-in.</p>
                </div>
              </div>
            )}
            {allUpcoming.map((b) => (
              <div key={b.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm text-slate-800 truncate">{b.customer_name}</p>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-medium ${
                        b._label === 'Today'
                          ? 'bg-green-100 text-green-700'
                          : b._label === 'Tomorrow'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}>
                        {b._label}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Room {b.room_number} · {b.adults}A{b.children > 0 ? ` ${b.children}C` : ''} · {b.check_in} → {b.check_out}
                    </p>
                  </div>
                </div>
                {/* Action buttons */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {b.customer_phone && (
                    <button
                      onClick={() => {
                        const phone = formatWhatsAppPhone(b.customer_phone)
                        const lodge = settings?.lodge_name || 'the Lodge'
                        const msg = [
                          `Dear ${b.customer_name},`,
                          '',
                          `This is a reminder of your upcoming check-in at *${lodge}*.`,
                          '',
                          `🛏️  Room ${b.room_number}`,
                          `📅  Check-in: ${b.check_in}`,
                          `📅  Check-out: ${b.check_out}`,
                          '',
                          `We look forward to welcoming you!`,
                          settings?.phone ? `📞 ${settings.phone}` : ''
                        ].filter(Boolean).join('\n')
                        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank')
                      }}
                      className="rounded-xl bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 transition-colors hover:bg-green-100"
                    >
                      💬 WhatsApp
                    </button>
                  )}
                  {b.customer_email && (
                    <button
                      onClick={() => {
                        const lodge = settings?.lodge_name || 'the Lodge'
                        const subject = `Check-in Reminder — ${lodge}`
                        const msg = [
                          `Dear ${b.customer_name},`,
                          '',
                          `This is a reminder of your upcoming check-in at ${lodge}.`,
                          '',
                          `Room: ${b.room_number}`,
                          `Check-in: ${b.check_in}`,
                          `Check-out: ${b.check_out}`,
                          '',
                          `We look forward to welcoming you!`,
                          settings?.phone ? `Phone: ${settings.phone}` : ''
                        ].filter(Boolean).join('\n')
                        window.api.shell.openExternal(
                          `mailto:${b.customer_email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(msg)}`
                        )
                      }}
                      className="rounded-xl bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100"
                    >
                      ✉️ Email
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {requestDialog && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onClick={() => setRequestDialog(null)}>
          <div className="w-full max-w-xl rounded-[28px] border border-white/70 bg-white p-6 shadow-[0_28px_90px_rgba(15,23,42,0.28)]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Manager Request</p>
                <h3 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-slate-900">{requestDialog.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{requestDialog.description || 'No extra detail was added.'}</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${requestStatusTone(requestDialog.status)}`}>
                {requestStatusLabel(requestDialog.status)}
              </span>
            </div>

            <div className="mt-5 rounded-2xl bg-sky-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Why this matters</p>
              <p className="mt-1 text-sm text-sky-950">
                This update goes back to the manager’s phone, so they can see whether the desk has acknowledged it, is working on it, or has finished it.
              </p>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Status</label>
                <select className="input w-full" value={requestStatus} onChange={(event) => setRequestStatus(event.target.value)}>
                  <option value="open">Open</option>
                  <option value="acknowledged">Acknowledged</option>
                  <option value="in_progress">In progress</option>
                  <option value="resolved">Resolved</option>
                </select>
              </div>
              <div>
                <p className="mb-1.5 block text-sm font-medium text-slate-700">Requested</p>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  {requestDialog.created_at ? new Date(requestDialog.created_at).toLocaleString('en-GB') : 'Recently'}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Desk note</label>
              <textarea
                className="input h-28 w-full resize-none"
                value={requestNote}
                onChange={(event) => setRequestNote(event.target.value)}
                placeholder="Short update for the manager, for example: Guest was called and promised to settle before 18:00."
              />
              <p className="mt-2 text-xs text-slate-500">Keep it short and practical. This note is shown back in the Manager PWA.</p>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button type="button" onClick={() => setRequestDialog(null)} className="btn-secondary">
                Close
              </button>
              <button type="button" onClick={saveRequestUpdate} disabled={requestSaving} className="btn-primary">
                {requestSaving ? 'Saving…' : 'Save Update'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="bb-card p-5">
      <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-2xl ${color}`}>
        <Icon size={20} />
      </div>
      <p className="text-[30px] font-bold tracking-[-0.03em] text-slate-900">{value}</p>
      <p className="mt-1 text-sm font-medium text-slate-500">{label}</p>
    </div>
  )
}

function requestStatusLabel(status) {
  const value = String(status || 'open').trim().toLowerCase()
  if (value === 'acknowledged') return 'Acknowledged'
  if (value === 'in_progress') return 'In progress'
  if (value === 'resolved') return 'Resolved'
  return 'Open'
}

function requestStatusTone(status) {
  const value = String(status || 'open').trim().toLowerCase()
  if (value === 'resolved') return 'bg-emerald-100 text-emerald-700'
  if (value === 'in_progress') return 'bg-sky-100 text-sky-700'
  if (value === 'acknowledged') return 'bg-amber-100 text-amber-700'
  return 'bg-slate-100 text-slate-700'
}
