import { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react'
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
  Briefcase,
  ShoppingCart,
  Package,
  Boxes,
  Globe,
  Tag,
  CheckCircle,
  XCircle,
  Clock,
  CreditCard,
  HardDrive,
  ShieldCheck,
  Settings,
  MessageCircle,
  Send,
  UtensilsCrossed,
  Coffee,
  ChefHat,
  LayoutGrid,
  UserCheck,
  Wallet,
  BarChart,
  ClipboardCheck
} from 'lucide-react'
import { StatusBadge } from './shared/StatusBadge'
import HorizontalScrollArea from './shared/HorizontalScrollArea'
import UpgradeNudgeBanner from './shared/UpgradeNudgeBanner'
import { useSettings, useFeatures, useOnlineRequests } from '../app-context'
import { localToday } from '../utils/localDate'
import {
  MONTHLY_USAGE_RESET_COPY,
  countMonthlyUsageBookings,
  getEarlyUpgradePromptState,
  getPlanRecommendation,
  getPlanUsageLimits,
  getUsageLimitStatus,
  getUsagePriorityScore,
  getUsageStateKey,
  normalizeSubscriptionPlan
} from '../../../shared/subscriptionPlans'
import { normalizeSupportMessages, supportMessageSide, supportSenderMeta, supportSenderName } from '../../../shared/supportThreads'
import { isRestaurantOnly, isHotelPropertyType } from '../../../shared/propertyTypes'

const HotelDashboard = lazy(() => import('./HotelDashboard'))

const SHORTCUTS = [
  { label: 'Bookings',      to: '/bookings',   icon: BookOpen },
  { label: 'Expenses',      to: '/expenses',   icon: Receipt,       feature: 'expenses',   tier: 'Standard' },
  { label: 'Reports',       to: '/reports',    icon: BarChart3,     feature: 'reports',    tier: 'Standard' },
  { label: 'Night Audit',   to: '/audit',      icon: ClipboardList, feature: 'audit',      tier: 'Standard' },
  { label: 'Conference',    to: '/conference', icon: Presentation,  feature: 'conference', tier: 'Standard' },
  { label: 'Day Use',       to: '/dayuse',     icon: Briefcase,     feature: 'pool',       tier: 'Standard' },
  { label: 'Staff',         to: '/staff',      icon: Users,         feature: 'staff',      tier: 'Standard' },
  { label: 'POS',           to: '/pos',        icon: ShoppingCart,  feature: 'pos',        tier: 'Pro' },
  { label: 'Inventory',     to: '/inventory',  icon: Package,       feature: 'inventory',  tier: 'Pro' },
  { label: 'Room Supplies', to: '/supplies',   icon: Boxes,         feature: 'supplies',   tier: 'Pro' },
]

const RESTAURANT_SHORTCUTS = [
  { label: 'POS',             to: '/pos',                   icon: ShoppingCart,    feature: 'pos',        tier: 'Pro' },
  { label: 'Floor & Service', to: '/restaurant/floor',      icon: LayoutGrid,      feature: 'pos',        tier: 'Pro' },
  { label: 'Kitchen',         to: '/restaurant/kitchen-workspace', icon: ChefHat,   feature: 'pos',        tier: 'Pro' },
  { label: 'Menu & Production', to: '/restaurant/menu-production', icon: UtensilsCrossed, feature: 'pos', tier: 'Pro' },
  { label: 'Stock & Purchasing', to: '/restaurant/stock-purchasing', icon: Package, feature: 'inventory', tier: 'Pro' },
  { label: 'Team',            to: '/restaurant/team',       icon: Users,           feature: 'staff',      tier: 'Standard' },
  { label: 'Cash & Close',    to: '/restaurant/cash-close', icon: Wallet,          feature: 'pos',        tier: 'Pro' },
  { label: 'Expenses',        to: '/expenses',              icon: Receipt,         feature: 'expenses',   tier: 'Standard' },
  { label: 'Reports',         to: '/reports',               icon: BarChart3,       feature: 'reports',    tier: 'Standard' },
  { label: 'Customers',       to: '/restaurant/customers',  icon: UserCheck,       feature: 'staff',      tier: 'Standard' },
  { label: 'Control',         to: '/restaurant/control',    icon: AlertTriangle,   feature: 'staff',      tier: 'Standard' },
  { label: 'Data',            to: '/data-management',       icon: HardDrive,       feature: null,         tier: null },
  { label: 'Settings',        to: '/settings',              icon: Settings,        feature: null,         tier: null },
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

function getLatestSupportMessage(request) {
  const messages = normalizeSupportMessages(request)
  return messages[messages.length - 1] || null
}

function timeAgo(value) {
  if (!value) return ''
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return ''

  const diffMs = Math.max(0, Date.now() - timestamp)
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`

  return new Date(timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
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
  const propertyType = settings?.property_type || settings?.business_type || 'lodge'
  const restaurantMode = isRestaurantOnly(propertyType)
  const { requests: onlineRequests, refresh: refreshOnlineRequests } = useOnlineRequests()
  const [actioningId, setActioningId] = useState(null)

  const [stats, setStats] = useState(null)
  const [usageSnapshot, setUsageSnapshot] = useState(null)
  const [recentBookings, setRecentBookings] = useState([])
  const [loading, setLoading] = useState(false)
  const [bookingHealth, setBookingHealth] = useState({ outstandingTotal: 0, unpaidCount: 0 })
  const [overdueBalances, setOverdueBalances] = useState([])
  const [activeBalanceCount, setActiveBalanceCount] = useState(0)
  const [upcoming, setUpcoming] = useState({ today: [], tomorrow: [], dayAfter: [] })
  const [forecast, setForecast] = useState([])
  const [lowStock, setLowStock] = useState([])
  const [paymentMixToday, setPaymentMixToday] = useState({ total_collected: 0, gross_collected: 0, refunds_issued: 0, by_method: {}, payment_count: 0, date: null })
  const [frontDeskRequests, setFrontDeskRequests] = useState([])
  const [activeSpecials, setActiveSpecials] = useState([])
  const [backupInfo, setBackupInfo] = useState(null)
  const [activeInboxRequestId, setActiveInboxRequestId] = useState('')
  const [inboxDraft, setInboxDraft] = useState('')
  const [inboxSending, setInboxSending] = useState(false)
  const [inboxError, setInboxError] = useState('')
  const [restaurantTables, setRestaurantTables] = useState([])
  const [kitchenTickets, setKitchenTickets] = useState([])
  const [activeShifts, setActiveShifts] = useState([])
  const [cashDrawer, setCashDrawer] = useState(null)
  const [activeAlerts, setActiveAlerts] = useState([])
  const pendingOnlineRequests = onlineRequests || []
  const managerInboxRequests = useMemo(
    () => frontDeskRequests
      .filter((request) => String(request.category || '').trim().toLowerCase() === 'front desk request')
      .sort((left, right) => String(right.updated_at || right.created_at || '').localeCompare(String(left.updated_at || left.created_at || ''))),
    [frontDeskRequests]
  )
  const pendingFrontDeskRequests = useMemo(
    () => frontDeskRequests.filter((request) => !['resolved', 'closed'].includes(String(request.status || '').toLowerCase())),
    [frontDeskRequests]
  )
  const activeInboxRequest = managerInboxRequests.find((request) => request.id === activeInboxRequestId) || managerInboxRequests[0] || null

  useEffect(() => {
    const handleNavigate = (e) => {
      const page = e.detail?.page
      if (page) navigate(`/${page}`)
    }
    window.addEventListener('bb_navigate', handleNavigate)
    return () => {
      window.removeEventListener('bb_navigate', handleNavigate)
    }
  }, [navigate])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const baseCalls = [
        window.api.dashboard.stats(),
        window.api.inventory.getLowStock().catch(() => []),
        window.api.dashboard.bookingPaymentsToday().catch(() => ({ total_collected: 0, gross_collected: 0, refunds_issued: 0, by_method: {}, payment_count: 0, date: null })),
        window.api.requests?.getAll?.(50).catch(() => []),
        window.api.users.getAll().catch(() => []),
        window.api.usage?.getSnapshot
          ? window.api.usage.getSnapshot({ forceRemoteRefresh: navigator.onLine === true }).catch(() => null)
          : Promise.resolve(null),
        window.api.backup?.getInfo ? window.api.backup.getInfo().catch(() => null) : Promise.resolve(null)
      ]
      const accomCalls = restaurantMode ? [] : [
        window.api.bookings.getAll(),
        window.api.notifications.upcoming(),
        window.api.dashboard.forecast(30).catch(() => []),
        window.api.rooms.getAll().catch(() => []),
        window.api.rateOverrides.getAll().catch(() => []),
        window.api.conference.getAll().catch(() => [])
      ]
      const restaurantCalls = restaurantMode ? [
        (window.api.pos.getTablesWithStatus?.() || window.api.pos.getTables?.()).catch(() => []),
        window.api.pos.getTickets?.({ station: 'all' }).catch(() => []),
        window.api.pos.getActiveShifts?.().catch(() => []),
        window.api.pos.getOpenCashDrawer?.().catch(() => null),
        window.api.pos.getActiveAlerts?.().catch(() => [])
      ] : []
      const [s, ls, paymentMix, lodgeRequests, users, usage, backups, ...restResults] = await Promise.all([...baseCalls, ...accomCalls, ...restaurantCalls])
      const [bookings, up, fc, rooms, rateOverrides, confBookings] = restaurantMode ? [ [], [], [], [], [], [] ] : restResults.slice(0, 6)
      const [rTables, rTickets, rShifts, rDrawer, rAlerts] = restaurantMode ? restResults.slice(0, 5) : [ [], [], [], null, [] ]
      const allBookings = Array.isArray(bookings) ? bookings : []
      const allConfBookings = Array.isArray(confBookings) ? confBookings : []
      const allRooms = Array.isArray(rooms) ? rooms : []
      const allUsers = Array.isArray(users) ? users : []
      setBackupInfo(backups || null)
      setRestaurantTables(Array.isArray(rTables) ? rTables : [])
      setKitchenTickets(Array.isArray(rTickets) ? rTickets : [])
      setActiveShifts(Array.isArray(rShifts) ? rShifts : [])
      setCashDrawer(rDrawer || null)
      setActiveAlerts(Array.isArray(rAlerts) ? rAlerts : [])
      const usagePlan = normalizeSubscriptionPlan(usage?.plan || s?.plan || settings?.subscription_plan || 'Starter')
      const usageLimits = getPlanUsageLimits(usagePlan)
      const usageCounts = usage && !usage.error && usage.usage
        ? {
            monthlyBookings: Number(usage.usage.monthlyBookings || 0),
            rooms: Number(usage.usage.rooms || 0),
            users: Number(usage.usage.users || 0)
          }
        : {
            monthlyBookings: countMonthlyUsageBookings(allBookings, new Date()),
            rooms: allRooms.length,
            users: allUsers.length
          }
      const usageStatuses = usage && !usage.error && usage.statuses
        ? usage.statuses
        : {
            bookings: getUsageLimitStatus({ used: usageCounts.monthlyBookings, limit: usageLimits.monthlyBookings, grace: usageLimits.monthlyBookingsGrace }),
            rooms: getUsageLimitStatus({ used: usageCounts.rooms, limit: usageLimits.rooms }),
            users: getUsageLimitStatus({ used: usageCounts.users, limit: usageLimits.users })
          }
      const usageRecommendation = usage && !usage.error && usage.recommendation
        ? usage.recommendation
        : getPlanRecommendation({
            plan: usagePlan,
            bookingsUsage: usageCounts.monthlyBookings,
            roomsUsage: usageCounts.rooms,
            usersUsage: usageCounts.users,
            limits: usageLimits
          })
      const usageStateKey = [usageStatuses.bookings, usageStatuses.rooms, usageStatuses.users]
        .sort((left, right) => getUsagePriorityScore(right) - getUsagePriorityScore(left))[0]
      setUsageSnapshot({
        ...(usage && !usage.error ? usage : {}),
        plan: usagePlan,
        usage: usageCounts,
        statuses: usageStatuses,
        recommendation: usageRecommendation,
        usageStateKey: getUsageStateKey(usageStateKey),
        monthlyResetCopy: usage?.monthlyResetCopy || MONTHLY_USAGE_RESET_COPY,
        source: usage?.source || 'cache'
      })
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
    const confMapped = allConfBookings.map((cb) => ({
      id: cb.id,
      customer_name: cb.client_name,
      status: cb.payment_status,
      total_amount: Number(cb.total_amount || 0),
      amount_paid: Number(cb.deposit_paid || 0),
      charges_total: 0,
      check_in: cb.booking_date,
      check_out: cb.booking_date,
      booking_type: 'conference'
    })).filter((cb) => cb.status !== 'cancelled')
    const revenueEligible = [
      ...combined.filter((b) => b && (b.status || '') !== 'cancelled'),
      ...confMapped
    ]
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
        const leftPriority = left.status === 'checked_out' ? 0 : left.status === 'checked_in' ? 1 : (left.booking_type === 'conference' ? 2 : 2)
        const rightPriority = right.status === 'checked_out' ? 0 : right.status === 'checked_in' ? 1 : (right.booking_type === 'conference' ? 2 : 2)
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
    const todayKey = localToday()
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

  useEffect(() => {
    if (managerInboxRequests.length === 0) {
      setActiveInboxRequestId('')
      return
    }
    if (!managerInboxRequests.some((request) => request.id === activeInboxRequestId)) {
      setActiveInboxRequestId(managerInboxRequests[0].id)
      setInboxDraft('')
      setInboxError('')
    }
  }, [activeInboxRequestId, managerInboxRequests])

  const sendInboxReply = useCallback(async () => {
    if (!activeInboxRequest?.id || !window.api?.requests?.addMessage) return
    const body = inboxDraft.trim()
    if (!body) return
    setInboxSending(true)
    setInboxError('')
    try {
      const result = await window.api.requests.addMessage(activeInboxRequest.id, {
        body,
        status: 'in_progress',
        metadata: { source: 'desktop_dashboard_inbox' }
      })
      if (!result?.success) throw new Error(result?.error || 'Could not send inbox reply')
      setInboxDraft('')
      await loadData()
    } catch (error) {
      setInboxError(error?.message || 'Could not send this inbox reply.')
    } finally {
      setInboxSending(false)
    }
  }, [activeInboxRequest?.id, inboxDraft, loadData])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    const refreshInbox = () => loadData()
    window.addEventListener('boroko:desktop-inbox-updated', refreshInbox)
    return () => window.removeEventListener('boroko:desktop-inbox-updated', refreshInbox)
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
  const dayUseCollectionQueue = useMemo(
    () => allUpcoming
      .filter((entry) => entry.booking_type === 'day_use' && Number(entry.balance_due || 0) > 0 && entry.status !== 'cancelled')
      .sort((left, right) => Number(right.balance_due || 0) - Number(left.balance_due || 0)),
    [allUpcoming]
  )
  const currentPlan = normalizeSubscriptionPlan(usageSnapshot?.plan || settings?.subscription_plan || 'Starter')
  const isProPlan = currentPlan === 'Pro'
  const usageLimits = getPlanUsageLimits(currentPlan)
  const usageCounts = usageSnapshot?.usage || { monthlyBookings: 0, rooms: 0, users: 0 }
  const bookingStatus = usageSnapshot?.statuses?.bookings || getUsageLimitStatus({ used: usageCounts.monthlyBookings, limit: usageLimits.monthlyBookings, grace: usageLimits.monthlyBookingsGrace })
  const roomStatus = usageSnapshot?.statuses?.rooms || getUsageLimitStatus({ used: usageCounts.rooms, limit: usageLimits.rooms })
  const userStatus = usageSnapshot?.statuses?.users || getUsageLimitStatus({ used: usageCounts.users, limit: usageLimits.users })
  const dashboardStatus = [bookingStatus, roomStatus, userStatus].sort((left, right) => getUsagePriorityScore(right) - getUsagePriorityScore(left))[0] || bookingStatus
  const dashboardPrompt = getEarlyUpgradePromptState({
    plan: currentPlan,
    bookingsUsage: usageCounts.monthlyBookings,
    roomsUsage: usageCounts.rooms,
    usersUsage: usageCounts.users,
    limits: usageLimits
  })
  const showDashboardPrompt = !isProPlan && dashboardPrompt.shouldPrompt
  const openTableCount = restaurantTables.filter(t => t.status === 'occupied' || t.status === 'reserved').length
  const totalTableCount = restaurantTables.length
  const pendingTicketCount = kitchenTickets.filter(t => ['pending', 'preparing'].includes(String(t.status || '').toLowerCase())).length
  const drawerOpen = !!cashDrawer
  const todayQueue = restaurantMode ? [
    {
      key: 'pos-sales',
      label: 'POS Sales',
      value: `${currency} ${Number(paymentMixToday.total_collected || 0).toFixed(2)}`,
      detail: `${paymentMixToday.payment_count || 0} payment${paymentMixToday.payment_count === 1 ? '' : 's'} today`,
      icon: ShoppingCart,
      tone: 'emerald',
      to: '/pos'
    },
    {
      key: 'kitchen',
      label: 'Kitchen Pending',
      value: pendingTicketCount,
      detail: pendingTicketCount > 0 ? 'Needs attention' : 'All clear',
      icon: ChefHat,
      tone: pendingTicketCount > 0 ? 'amber' : 'emerald',
      to: '/restaurant/kitchen-workspace'
    },
    {
      key: 'tables',
      label: 'Open Tables',
      value: `${openTableCount}/${totalTableCount}`,
      detail: `${totalTableCount - openTableCount} available`,
      icon: LayoutGrid,
      tone: 'sky',
      to: '/restaurant/floor'
    },
    {
      key: 'stock',
      label: 'Low Stock',
      value: lowStock.length,
      detail: 'Items below par',
      icon: Package,
      tone: lowStock.length > 0 ? 'orange' : 'emerald',
      to: '/restaurant/stock-purchasing'
    },
    {
      key: 'shifts',
      label: 'Staff On Shift',
      value: activeShifts.length,
      detail: activeShifts.length > 0 ? 'Active now' : 'No one clocked in',
      icon: Users,
      tone: 'violet',
      to: '/restaurant/team'
    },
    {
      key: 'alerts',
      label: 'Alerts',
      value: activeAlerts.length,
      detail: activeAlerts.length > 0 ? 'Check alerts' : 'All clear',
      icon: AlertTriangle,
      tone: activeAlerts.length > 0 ? 'rose' : 'emerald',
      to: '/restaurant/control'
    }
  ] : [
    {
      key: 'arrivals',
      label: 'Arrivals',
      value: Number(stats?.checkins_today || 0),
      detail: 'Guests expected today',
      icon: CalendarCheck,
      tone: 'emerald',
      to: '/bookings'
    },
    {
      key: 'departures',
      label: 'Departures',
      value: Number(stats?.checkouts_today || 0),
      detail: 'Check-outs to clear',
      icon: CalendarX,
      tone: 'amber',
      to: '/bookings'
    },
    {
      key: 'requests',
      label: 'Online requests',
      value: pendingOnlineRequests.length,
      detail: 'Need front-desk decision',
      icon: Globe,
      tone: 'sky',
      to: '/bookings'
    },
    {
      key: 'balances',
      label: 'Balances',
      value: bookingHealth.unpaidCount,
      detail: `${currency} ${Number(bookingHealth.outstandingTotal || 0).toFixed(2)} outstanding`,
      icon: CreditCard,
      tone: 'rose',
      to: '/invoices'
    },
    {
      key: 'stock',
      label: 'Low stock',
      value: lowStock.length,
      detail: 'Items below par',
      icon: Package,
      tone: 'orange',
      to: '/inventory'
    }
  ]
  const attentionSummary = restaurantMode ? [
    pendingTicketCount > 0 && `${pendingTicketCount} pending kitchen ticket${pendingTicketCount === 1 ? '' : 's'}`,
    lowStock.length > 0 && `${lowStock.length} low-stock item${lowStock.length === 1 ? '' : 's'}`,
    activeAlerts.length > 0 && `${activeAlerts.length} active alert${activeAlerts.length === 1 ? '' : 's'}`
  ].filter(Boolean) : [
    pendingOnlineRequests.length > 0 && `${pendingOnlineRequests.length} website request${pendingOnlineRequests.length === 1 ? '' : 's'}`,
    bookingHealth.unpaidCount > 0 && `${bookingHealth.unpaidCount} balance${bookingHealth.unpaidCount === 1 ? '' : 's'}`,
    lowStock.length > 0 && `${lowStock.length} low-stock item${lowStock.length === 1 ? '' : 's'}`,
    pendingFrontDeskRequests.length > 0 && `${pendingFrontDeskRequests.length} desk request${pendingFrontDeskRequests.length === 1 ? '' : 's'}`
  ].filter(Boolean)
  const cockpitCards = restaurantMode ? [
    {
      label: 'Today Sales',
      value: `${currency} ${Number(paymentMixToday.total_collected || 0).toFixed(2)}`,
      detail: `${paymentMixToday.payment_count || 0} payment${paymentMixToday.payment_count === 1 ? '' : 's'} recorded`,
      to: '/pos'
    },
    {
      label: 'Open Tables',
      value: `${openTableCount}/${totalTableCount}`,
      detail: `${totalTableCount - openTableCount} available`,
      to: '/restaurant/tables'
    },
    {
      label: 'Kitchen Pending',
      value: pendingTicketCount,
      detail: `${kitchenTickets.length} total ticket${kitchenTickets.length === 1 ? '' : 's'} today`,
      to: '/restaurant/kitchen'
    },
    {
      label: 'Cash Drawer',
      value: drawerOpen ? `${currency} ${Number(cashDrawer.opening_float || 0).toFixed(2)}` : 'Closed',
      detail: drawerOpen ? 'Drawer is open' : 'No active drawer',
      to: '/restaurant/cash-close'
    },
    {
      label: 'Low Stock',
      value: lowStock.length,
      detail: lowStock.length > 0 ? 'Items below par level' : 'All items stocked',
      to: '/restaurant/stock-purchasing'
    },
    {
      label: 'Staff On Shift',
      value: activeShifts.length,
      detail: activeShifts.length > 0 ? `${activeShifts.length} active` : 'No active shifts',
      to: '/restaurant/team'
    },
    {
      label: 'Alerts',
      value: activeAlerts.length,
      detail: activeAlerts.length > 0 ? 'Active alerts need attention' : 'All clear',
      to: '/restaurant/control'
    },
    {
      label: 'Daily Close',
      value: drawerOpen ? 'Ready' : 'Not started',
      detail: drawerOpen ? 'Close the day when ready' : 'Open a drawer to start',
      to: '/restaurant/cash-close'
    }
  ] : [
    {
      label: 'Cash Today',
      value: `${currency} ${Number(paymentMixToday.total_collected || 0).toFixed(2)}`,
      detail: `${paymentMixToday.payment_count || 0} payment${paymentMixToday.payment_count === 1 ? '' : 's'} recorded`,
      to: '/invoices'
    },
    {
      label: 'Occupancy',
      value: `${Number(stats?.occupied_today || 0)}/${Number(stats?.total_rooms || 0)}`,
      detail: 'Rooms occupied today',
      to: '/rooms'
    },
    {
      label: 'Upcoming',
      value: Number(stats?.upcoming_bookings || 0),
      detail: 'Future bookings on the books',
      to: '/bookings'
    },
    {
      label: 'Low Stock',
      value: lowStock.length,
      detail: 'Items below par level',
      to: '/inventory'
    }
  ]
  const backupPolicy = backupInfo?.policy || {}
  const backupNeedsAttention = ['disabled', 'setup_required', 'pending_first_run', 'overdue'].includes(backupPolicy.compliance_state)
  const backupEnforcement = backupPolicy.enforcement_level || 'reminder'
  const backupReminderTone = backupEnforcement === 'strict'
    ? 'border-l-red-500 bg-red-50 text-red-900'
    : backupEnforcement === 'warning'
      ? 'border-l-amber-500 bg-amber-50 text-amber-900'
      : 'border-l-sky-500 bg-sky-50 text-sky-900'
  const backupReminderTitle =
    backupPolicy.compliance_state === 'disabled' ? 'Weekly backup reminders are off' :
    backupPolicy.compliance_state === 'setup_required' ? 'Choose a synced backup folder' :
    backupPolicy.compliance_state === 'pending_first_run' ? 'Run the first managed backup' :
    backupPolicy.compliance_state === 'overdue' ? 'Weekly backup is overdue' :
    'Backup reminder'
  const backupReminderCopy =
    backupPolicy.compliance_state === 'disabled'
      ? 'Turn on managed weekly exports so the lodge has an off-device Excel backup.'
      : backupPolicy.compliance_state === 'setup_required'
        ? 'Managed exports are enabled, but they need a OneDrive, Google Drive, Dropbox, or other synced folder.'
        : backupPolicy.compliance_state === 'pending_first_run'
          ? 'Managed exports are enabled. Run one now so the backup policy starts from a known good file.'
          : backupPolicy.compliance_state === 'overdue'
            ? 'A fresh off-device export is due. Run the weekly export before closing the release or handing over the device.'
            : 'Keep weekly exports current for recovery and support.'
  const onboardingActions = restaurantMode ? [
    {
      key: 'pos',
      title: 'Open the POS',
      copy: 'Start taking orders and tracking sales from your first shift.',
      icon: ShoppingCart,
      to: '/pos',
      action: 'Open POS'
    },
    {
      key: 'tables',
      title: 'Set up your floor plan',
      copy: 'Add tables and arrange your restaurant layout for quick service.',
      icon: LayoutGrid,
      to: '/restaurant/floor',
      action: 'Manage tables'
    },
    {
      key: 'menu',
      title: 'Build your menu',
      copy: 'Add menu items, categories, and modifier groups.',
      icon: UtensilsCrossed,
      to: '/restaurant/menu-production',
      action: 'Manage menu'
    },
    {
      key: 'recipes',
      title: 'Add recipes & costing',
      copy: 'Link ingredients to menu items for cost tracking and stock depletion.',
      icon: Coffee,
      to: '/restaurant/menu-production?tab=recipes',
      action: 'Manage recipes'
    },
    {
      key: 'staff',
      title: 'Set up your team',
      copy: 'Add staff members and set up roles for clock-in/clock-out.',
      icon: Users,
      to: '/restaurant/team',
      action: 'Manage staff'
    },
    backupNeedsAttention && {
      key: 'backup',
      title: backupReminderTitle,
      copy: backupReminderCopy,
      icon: HardDrive,
      to: '/data-management',
      action: 'Open backups'
    }
  ].filter(Boolean).slice(0, 4) : [
    Number(stats?.total_rooms || 0) === 0 && {
      key: 'rooms',
      title: 'Add your first room',
      copy: 'Create the room list before bookings, housekeeping, and availability can work properly.',
      icon: BedDouble,
      to: '/rooms',
      action: 'Add rooms'
    },
    recentBookings.length === 0 && Number(stats?.total_rooms || 0) > 0 && {
      key: 'booking',
      title: 'Create your first booking',
      copy: 'Start tracking guest stays, balances, check-ins, and receipts.',
      icon: BookOpen,
      to: '/bookings',
      action: 'New booking'
    },
    backupNeedsAttention && {
      key: 'backup',
      title: backupReminderTitle,
      copy: backupReminderCopy,
      icon: HardDrive,
      to: '/data-management',
      action: 'Open backups'
    },
    !settings?.email_host && !settings?.smtp_host && {
      key: 'email',
      title: 'Configure email sending',
      copy: 'Set up email so invoices, quotations, and booking messages can be sent from the app.',
      icon: Settings,
      to: '/settings',
      action: 'Open settings'
    }
  ].filter(Boolean).slice(0, 4)

  return (
    <div className="bb-page">
      <div className="bb-page-header">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700/70">Operations Overview</p>
          <h1 className="bb-page-header-title mt-2">Dashboard</h1>
          <p className="bb-page-header-subtitle">{today}</p>
        </div>
      </div>

      <section className="bb-ops-brief">
        <div className="bb-ops-brief__intro">
          <p className="bb-section-kicker">Today Queue</p>
          <h2 className="bb-section-title mt-1">{restaurantMode ? 'The key numbers that keep the restaurant running.' : 'The next actions that keep the lodge moving.'}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {attentionSummary.length > 0
              ? `Focus first on ${attentionSummary.join(', ')}.`
              : restaurantMode
                ? 'Everything is running smoothly right now.'
                : 'Nothing urgent is blocking operations right now.'}
          </p>
        </div>
        <div className="bb-ops-queue">
          {todayQueue.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => navigate(item.to)}
                className={`bb-ops-queue-card bb-ops-queue-card--${item.tone}`}
              >
                <span className="bb-ops-queue-card__icon"><Icon size={17} /></span>
                <span className="min-w-0">
                  <span className="bb-ops-queue-card__value">{item.value}</span>
                  <span className="bb-ops-queue-card__label">{item.label}</span>
                  <span className="bb-ops-queue-card__detail">{item.detail}</span>
                </span>
                <ArrowRight size={14} className="bb-ops-queue-card__arrow" />
              </button>
            )
          })}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cockpitCards.map((card) => (
          <button key={card.label} type="button" onClick={() => navigate(card.to)} className="bb-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-emerald-200">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{card.label}</p>
            <p className="mt-2 text-xl font-black tracking-[-0.04em] text-slate-900">{card.value}</p>
            <p className="mt-1 text-sm leading-6 text-slate-500">{card.detail}</p>
          </button>
        ))}
      </section>

      {backupNeedsAttention && backupEnforcement !== 'reminder' && (
        <section className={`bb-card border-l-4 p-5 ${backupReminderTone}`}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/80">
                <ShieldCheck size={20} />
              </div>
              <div>
                <p className="text-sm font-bold">
                  {backupEnforcement === 'strict' ? 'Strict backup warning' : 'Backup needs attention'}
                </p>
                <p className="mt-1 text-sm opacity-80">{backupReminderCopy}</p>
                {backupPolicy.last_success_at && (
                  <p className="mt-1 text-xs opacity-70">
                    Last successful export: {new Date(backupPolicy.last_success_at).toLocaleString('en-GB')}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate('/data-management')}
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
            >
              Open Backups
            </button>
          </div>
        </section>
      )}

      {onboardingActions.length > 0 && (
        <section className="bb-card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="bb-section-kicker">Setup Guide</p>
              <h2 className="bb-section-title mt-1">Recommended next steps</h2>
            </div>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
              {onboardingActions.length} open
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {onboardingActions.map(({ key, title, copy, icon: Icon, to, action }) => (
              <button
                key={key}
                type="button"
                onClick={() => navigate(to)}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-white"
              >
                <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm">
                  <Icon size={18} />
                </div>
                <p className="text-sm font-bold text-slate-900">{title}</p>
                <p className="mt-1 min-h-[42px] text-xs leading-5 text-slate-500">{copy}</p>
                <p className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                  {action} <ArrowRight size={13} />
                </p>
              </button>
            ))}
          </div>
        </section>
      )}

      {showDashboardPrompt && (
        <UpgradeNudgeBanner
          visible={showDashboardPrompt}
          message="You’re approaching your plan limits. Consider upgrading to avoid interruptions."
          sessionKey="boroko:upgrade-nudge:dashboard"
          lodgeId={settings?.lodge_id || ''}
          lodgeName={settings?.lodge_name || settings?.company_name || ''}
          plan={currentPlan}
          usage={usageCounts}
          recommendation={dashboardPrompt}
          trigger="banner"
          onUpgrade={() => navigate('/settings', { state: { activeTab: 'license' } })}
        />
      )}

      {/* Quick Access */}
      <section className="bb-card p-4">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Quick Access</h2>
            <p className="mt-1 text-sm text-slate-500">{restaurantMode ? 'Jump into the most-used modules.' : 'Jump into the most-used desk and back-office modules.'}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-10">
          {(restaurantMode ? RESTAURANT_SHORTCUTS : SHORTCUTS).map(({ label, to, icon: Icon, feature, tier }) => {
            const isLocked = feature && Object.keys(features).length > 0 && features[feature] === false
            const tierColor = tier === 'Pro' ? 'text-purple-500' : 'text-blue-500'
            return (
              <button
                key={to}
                onClick={() => navigate(to)}
                className={`relative flex flex-col items-start gap-2 rounded-2xl border px-3.5 py-3 text-left transition-all ${
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

      {/* ── Online Booking Requests ─────────────────────────────────────── */}
      {!restaurantMode && onlineRequests.length > 0 && (
        <section className="bb-card overflow-hidden border-l-4 border-l-amber-500">
          <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <Globe size={18} className="text-amber-600" />
              <p className="text-sm font-bold text-slate-800">Online Booking Requests</p>
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

      {features.pwa === true && (
        <section className="bb-card overflow-hidden p-0">
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                  <MessageCircle size={18} />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Inbox</p>
                  <h2 className="mt-1 text-lg font-semibold text-slate-900">Manager mobile chats</h2>
                </div>
              </div>
              {pendingFrontDeskRequests.length > 0 ? (
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                  {pendingFrontDeskRequests.length} open
                </span>
              ) : null}
            </div>
          </div>

          <div className="grid min-h-[440px] lg:grid-cols-[320px_1fr]">
            <div className="border-b border-slate-200 bg-slate-50/70 lg:border-b-0 lg:border-r">
              {managerInboxRequests.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <MessageCircle size={30} className="mx-auto text-slate-300" />
                  <p className="mt-3 text-sm font-semibold text-slate-900">No manager chats yet</p>
                  <p className="mt-1 text-sm text-slate-500">Messages from the manager mobile app will appear here.</p>
                </div>
              ) : (
                <div className="max-h-[440px] overflow-y-auto">
                  {managerInboxRequests.map((request) => {
                    const latest = getLatestSupportMessage(request)
                    const active = activeInboxRequest?.id === request.id
                    return (
                      <button
                        key={request.id}
                        type="button"
                        onClick={() => {
                          setActiveInboxRequestId(request.id)
                          setInboxDraft('')
                          setInboxError('')
                        }}
                        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                          active ? 'bg-white shadow-sm' : 'hover:bg-white/70'
                        }`}
                      >
                        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                          active ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'
                        }`}>
                          {(request.requester_name || 'Manager').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'MG'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="truncate text-sm font-semibold text-slate-900">{request.title || 'Manager message'}</p>
                            <span className="shrink-0 text-[11px] text-slate-400">{timeAgo(request.updated_at || request.created_at)}</span>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-slate-500">
                            {supportSenderName(latest || request)}: {latest?.body || request.description || 'No messages yet'}
                          </p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="flex min-h-[440px] flex-col">
              {activeInboxRequest ? (
                <>
                  <div className="border-b border-slate-200 px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold text-slate-900">{activeInboxRequest.title}</p>
                        <p className="mt-1 text-sm text-slate-500">
                          {activeInboxRequest.requester_name ? `${activeInboxRequest.requester_name} - ` : ''}{activeInboxRequest.created_at ? new Date(activeInboxRequest.created_at).toLocaleString('en-GB') : 'Recently'}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${requestStatusTone(activeInboxRequest.status)}`}>
                        {requestStatusLabel(activeInboxRequest.status)}
                      </span>
                    </div>
                  </div>

                  <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-5 py-4">
                    {normalizeSupportMessages(activeInboxRequest).map((message) => {
                      const isDesk = supportMessageSide(message) === 'desk'
                      return (
                        <div key={message.id} className={`flex ${isDesk ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[78%] rounded-2xl px-4 py-3 shadow-sm ${
                            isDesk
                              ? 'rounded-br-md bg-emerald-700 text-white'
                              : 'rounded-bl-md border border-slate-200 bg-white text-slate-800'
                          }`}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${isDesk ? 'text-emerald-100' : 'text-slate-500'}`}>
                                  {supportSenderName(message)}
                                </p>
                                {supportSenderMeta(message) ? (
                                  <p className={`mt-0.5 text-[11px] ${isDesk ? 'text-emerald-100/75' : 'text-slate-400'}`}>
                                    {supportSenderMeta(message)}
                                  </p>
                                ) : null}
                              </div>
                              <span className={`shrink-0 text-[11px] ${isDesk ? 'text-emerald-100/75' : 'text-slate-400'}`}>
                                {message.created_at ? new Date(message.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Now'}
                              </span>
                            </div>
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{message.body}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  <div className="border-t border-slate-200 bg-white px-5 py-4">
                    {inboxError ? (
                      <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        {inboxError}
                      </div>
                    ) : null}
                    <div className="flex items-end gap-3">
                      <textarea
                        className="input min-h-[52px] flex-1 resize-none"
                        value={inboxDraft}
                        onChange={(event) => setInboxDraft(event.target.value)}
                        placeholder="Write a reply..."
                      />
                      <button
                        type="button"
                        onClick={sendInboxReply}
                        disabled={inboxSending || !inboxDraft.trim()}
                        className="btn-primary shrink-0"
                      >
                        <Send size={15} /> {inboxSending ? 'Sending...' : 'Send'}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                  <MessageCircle size={34} className="text-slate-300" />
                  <p className="mt-3 text-sm font-semibold text-slate-900">Select a chat</p>
                  <p className="mt-1 text-sm text-slate-500">Manager mobile conversations will open here.</p>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {!restaurantMode && (
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
      )}

      {!restaurantMode && bookingHealth.outstandingTotal > 0 && (
        <section className="bb-card p-5 border-l-4 border-l-rose-500">
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

      {!restaurantMode && paymentMixToday.payment_count > 0 && (
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

      {!restaurantMode && overdueBalances.length > 0 && (
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

      {!restaurantMode && dayUseCollectionQueue.length > 0 && (
        <section className="bb-card p-5 border-l-4 border-l-violet-500">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-slate-800">Day Use Balance Follow-up</h2>
              <p className="mt-1 text-sm text-slate-500">Reserved and active walk-in entries that still need payment collection.</p>
            </div>
            <Link
              to="/dayuse"
              className="inline-flex items-center gap-1 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-100"
            >
              Open Day Use <ArrowRight size={14} />
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {dayUseCollectionQueue.slice(0, 4).map((entry) => (
              <div key={`dayuse-balance-${entry.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-slate-900">{entry.customer_name || 'Walk-in Guest'}</p>
                    <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-[11px] font-semibold text-cyan-700">
                      {entry.template_name || 'Day Use'}
                    </span>
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                      Balance {currency}{Number(entry.balance_due || 0).toFixed(2)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {entry.check_in} · {entry.resource_name || 'No resource'} · {entry.payment_method || 'Cash'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/dayuse')}
                  className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-700"
                >
                  <CreditCard size={13} />
                  Settle in Day Use
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 30-Day Occupancy Forecast */}
      {!restaurantMode && forecast.length > 0 && (
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

      {/* Low Stock Alert */}
      {lowStock.length > 0 && (
        <section className="bb-card p-5 border-l-4 border-l-amber-500">
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

      {!restaurantMode && (
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
                        <div className="mt-4 flex flex-wrap justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => navigate(Number(stats?.total_rooms || 0) > 0 ? '/bookings' : '/rooms')}
                            className="btn-primary"
                          >
                            {Number(stats?.total_rooms || 0) > 0 ? 'Create first booking' : 'Add rooms first'}
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate('/data-management')}
                            className="btn-secondary"
                          >
                            Import bookings
                          </button>
                        </div>
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
                      {b.booking_type === 'conference' && (
                        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-700">Conference</span>
                      )}
                      {b.booking_type === 'day_use' && (
                        <span className="shrink-0 rounded-full bg-cyan-100 px-2 py-1 text-[11px] font-medium text-cyan-700">Day Use</span>
                      )}
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
                    {b.booking_type === 'conference' ? (
                      <p className="mt-1 text-xs text-slate-500">
                        {b.room_number} · {b.adults} attendees · {b.check_in}{b.start_time ? ` ${b.start_time}–${b.end_time}` : ''}
                      </p>
                    ) : b.booking_type === 'day_use' ? (
                      <p className="mt-1 text-xs text-slate-500">
                        {b.template_name || 'Day Use Entry'} · {b.adults}A{b.children > 0 ? ` ${b.children}C` : ''} · {b.check_in}
                        {b.resource_name ? ` · ${b.resource_name}` : ''}
                        {Number(b.balance_due || 0) > 0 ? ` · Balance ${currency}${Number(b.balance_due || 0).toFixed(2)}` : ''}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-slate-500">
                        Room {b.room_number} · {b.adults}A{b.children > 0 ? ` ${b.children}C` : ''} · {b.check_in} → {b.check_out}
                      </p>
                    )}
                  </div>
                </div>
                {/* Action buttons — room bookings only */}
                {b.booking_type !== 'conference' && b.booking_type !== 'day_use' && (
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
                        ].filter(Boolean).join('\r\n')
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
                        ].filter(Boolean).join('\r\n')
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
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
      )}

      {isHotelPropertyType(propertyType) && (
        <section className="mt-6">
          <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading hotel dashboard...</div>}>
            <HotelDashboard />
          </Suspense>
        </section>
      )}

    </div>
  )
}

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="bb-card p-4">
      <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-2xl ${color}`}>
        <Icon size={18} />
      </div>
      <p className="text-2xl font-bold tracking-[-0.03em] text-slate-900">{value}</p>
      <p className="mt-1 text-sm font-medium text-slate-500">{label}</p>
    </div>
  )
}

function requestStatusLabel(status) {
  const value = String(status || 'open').trim().toLowerCase()
  if (value === 'acknowledged') return 'Acknowledged'
  if (value === 'in_progress') return 'In progress'
  if (value === 'resolved') return 'Resolved'
  if (value === 'closed') return 'Closed'
  return 'Open'
}

function requestStatusTone(status) {
  const value = String(status || 'open').trim().toLowerCase()
  if (value === 'resolved' || value === 'closed') return 'bg-emerald-100 text-emerald-700'
  if (value === 'in_progress') return 'bg-sky-100 text-sky-700'
  if (value === 'acknowledged') return 'bg-amber-100 text-amber-700'
  return 'bg-slate-100 text-slate-700'
}
