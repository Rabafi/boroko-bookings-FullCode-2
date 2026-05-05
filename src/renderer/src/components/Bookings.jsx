import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search, Filter, CreditCard, Building2, CheckCircle2, MoreVertical, RefreshCw } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { StatusBadge } from './shared/StatusBadge'
import { Modal } from './shared/Modal'
import { Receipt } from './shared/Receipt'
import HorizontalScrollArea from './shared/HorizontalScrollArea'
import UsageLimitIndicator from './shared/UsageLimitIndicator'
import UsageUpgradePrompt from './shared/UpgradePromptModal'
import UpgradeNudgeBanner from './shared/UpgradeNudgeBanner'
import { DESKTOP_PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '../constants/paymentMethods'
import { useAccess, useAuth, useSettings } from '../app-context'
import { MONTHLY_USAGE_RESET_COPY, canCreateBooking, countMonthlyUsageBookings, getEarlyUpgradePromptState, getPlanUsageLimits, normalizeSubscriptionPlan } from '../../../shared/subscriptionPlans'

const STATUS_OPTIONS = ['confirmed', 'checked_in', 'checked_out', 'cancelled']

const PAYMENT_METHODS = DESKTOP_PAYMENT_METHODS
const METHOD_LABEL = PAYMENT_METHOD_LABELS

function getOnlineRequestAgeMeta(createdAt) {
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
    const hours = Math.floor(ageHours)
    return {
      label: `${hours}h waiting`,
      detail: `Waiting for ${hours} hour${hours === 1 ? '' : 's'}`,
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

function buildWhatsAppMessage(b, settings) {
  const lodge = settings?.lodge_name || 'the Lodge'
  const currency = settings?.currency || 'P'
  const nights = Math.max(0, Math.ceil((new Date(b.check_out) - new Date(b.check_in)) / 86400000))
  return [
    `Dear ${b.customer_name},`,
    '',
    `✅ *Booking Confirmed — ${lodge}*`,
    '',
    `🛏️  Room ${b.room_number} (${b.room_type})`,
    `📅  Check-in:  ${b.check_in}`,
    `📅  Check-out: ${b.check_out}  (${nights} night${nights !== 1 ? 's' : ''})`,
    `👥  Guests: ${b.adults} adult${b.adults !== 1 ? 's' : ''}${b.children > 0 ? `, ${b.children} child${b.children !== 1 ? 'ren' : ''}` : ''}`,
    `💰  Total: ${currency} ${Number(b.total_amount || 0).toFixed(2)}`,
    '',
    `We look forward to welcoming you!`,
    settings?.phone ? `📞 ${settings.phone}` : ''
  ].filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n')
}

function bookingOutstandingAmount(booking) {
  return Math.max(0, Number(booking.total_amount || 0) + Number(booking.charges_total || 0) - Number(booking.amount_paid || 0))
}

function bookingNeedsAttention(booking) {
  const total = Math.max(0, Number(booking.total_amount || 0) + Number(booking.charges_total || 0))
  const paid = Math.max(0, Number(booking.amount_paid || 0))
  const status = String(booking.payment_status || 'unpaid')
  if (paid > total + 0.01) return true
  if (status === 'paid' && paid < total - 0.01) return true
  if (status === 'unpaid' && paid > 0.01) return true
  if (status === 'partial' && (paid <= 0.01 || paid >= total - 0.01)) return true
  return false
}

function bookingHasSyncFailure(booking, failedSyncIds) {
  const syncState = String(booking?._sync_state || '').trim().toLowerCase()
  return failedSyncIds.has(booking?.id) || syncState === 'failed' || syncState === 'sync_failed'
}

function bookingHasAttentionState(booking) {
  const syncState = String(booking?._sync_state || '').trim().toLowerCase()
  return booking?._needs_attention === true || syncState === 'manual_review_required'
}

function normalizeChargesResponse(result) {
  if (Array.isArray(result)) return { items: result, unavailable: false }
  if (result?.unavailable) return { items: [], unavailable: true }
  return { items: [], unavailable: false }
}

// Sanitize raw sync error text for display to front-desk operators.
// Strips UUIDs and translates known technical patterns to plain language.
// Returns null for errors already covered by a specific badge (e.g. room conflict).
function sanitizeSyncError(raw) {
  if (!raw) return null
  const msg = String(raw)
  if (/room.*conflict|no_overlapping_bookings/i.test(msg)) return null
  if (/idempotency.*required/i.test(msg)) return 'Retry required — open System Health to resend.'
  if (/authenticated.*required|authentication.*required|session.*required/i.test(msg)) return 'Session expired — sign in again, then retry in System Health.'
  if (/lodge.*role|permission denied|insufficient.*privilege/i.test(msg)) return 'Permission denied — check your account role.'
  if (/unique.*violation|duplicate key/i.test(msg)) return 'Duplicate record detected — this item may already exist on the server.'
  if (/not found/i.test(msg)) return 'Record not found on server — it may have been deleted remotely.'
  if (/overpay/i.test(msg)) return 'Payment exceeds booking total — adjust the amount before retrying.'
  if (/below zero/i.test(msg)) return 'Adjustment would reduce balance below zero.'
  const cleaned = msg
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '…')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > 120 ? `${cleaned.slice(0, 117)}…` : cleaned
}

const emptyCustomer = { name: '', email: '', phone: '', id_number: '', nationality: '' }
const emptyBooking = {
  customer_id: '',
  room_id: '',
  check_in: '',
  check_out: '',
  adults: 1,
  children: 0,
  deposit_amount: '',
  notes: ''
}

export default function Bookings() {
  const { user } = useAuth()
  const access = useAccess()
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const location = useLocation()
  const navigate = useNavigate()

  const [openMenuId, setOpenMenuId] = useState(null)
  const [bookings, setBookings] = useState([])
  const [rooms, setRooms] = useState([])
  const [customers, setCustomers] = useState([])
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterPayment, setFilterPayment] = useState('all')
  const [filterOnline, setFilterOnline] = useState(false) // true = show only online requests
  const [sortBy, setSortBy] = useState('created_desc')
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editingGroupId, setEditingGroupId] = useState(null)
  const [editingBaseUpdatedAt, setEditingBaseUpdatedAt] = useState(null)
  const [form, setForm] = useState(emptyBooking)
  const [newCustomer, setNewCustomer] = useState(emptyCustomer)
  const [useNewCustomer, setUseNewCustomer] = useState(true)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [success, setSuccess] = useState('')
  const [usageSnapshot, setUsageSnapshot] = useState(null)
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false)
  const successTimerRef = useRef(null)
  const [modalWarning, setModalWarning] = useState('')  // amber — booking saved but deposit failed
  const [loading, setLoading] = useState(false)
  const [statusLoadingId, setStatusLoadingId] = useState(null)
  const [applicableRate, setApplicableRate] = useState(null)
  const [receiptBooking, setReceiptBooking] = useState(null)
  const [failedSyncIds, setFailedSyncIds] = useState(new Set())
  const [financialPendingIds, setFinancialPendingIds] = useState(new Set())
  const [financialFailedIds, setFinancialFailedIds] = useState(new Set())
  const [financialCacheStale, setFinancialCacheStale] = useState(false)
  const FINANCIAL_SYNC_BLOCK_MESSAGE = 'Financial actions are temporarily locked until booking and payment sync are fully confirmed. Review System Health, then try again.'

  // Poll sync status every 30s (independent of bookings refresh — sync can change without a data reload)
  useEffect(() => {
    const loadSyncStatus = async () => {
      try {
        const s = await window.api.sync.getStatus()
        setFailedSyncIds(new Set(s?.failedBookingIds || []))
        setFinancialPendingIds(new Set(s?.financialPendingBookingIds || []))
        setFinancialFailedIds(new Set(s?.financialFailedBookingIds || []))
        setFinancialCacheStale(s?.cacheStale?.active === true)
      } catch { /* non-fatal — sync status is informational */ }
    }
    loadSyncStatus()
    const interval = setInterval(loadSyncStatus, 30_000)
    return () => clearInterval(interval)
  }, [])

  // History Timeline modal
  const [showHistory, setShowHistory] = useState(false)
  const [historyBooking, setHistoryBooking] = useState(null)

  // Event booking modal
  const [showEventModal, setShowEventModal] = useState(false)
  const [eventForm, setEventForm] = useState({ event_name: '', contact_phone: '', contact_email: '', check_in: '', check_out: '', event_daily_rate: '', deposit_amount: '', payment_method: 'cash', notes: '' })
  const [eventLoading, setEventLoading] = useState(false)
  const [eventResult, setEventResult] = useState(null) // success result

  // Payment modal
  const [paymentBooking, setPaymentBooking] = useState(null)
  const [paymentIntentKey, setPaymentIntentKey] = useState(null)
  const [payForm, setPayForm] = useState({ payment_status: 'paid', payment_method: 'cash', amount_paid: '' })
  const [payLoading, setPayLoading] = useState(false)
  const [payError, setPayError] = useState('')
  const paymentIntentCacheRef = useRef(new Map())

  // Charges modal
  const [chargesBooking, setChargesBooking] = useState(null)
  const [charges, setCharges] = useState([])
  const [chargesUnavailable, setChargesUnavailable] = useState(false)
  const [chargeForm, setChargeForm] = useState({ description: '', amount: '', category: 'Food & Beverage', quantity: 1, outlet_id: '' })
  const [chargeLoading, setChargeLoading] = useState(false)
  const [chargeError, setChargeError] = useState('')

  // Outlets for charge attribution
  const [chargeOutlets, setChargeOutlets] = useState([])
  const [frontDeskId, setFrontDeskId] = useState('')

  const openCharges = async (b) => {
    if (isFinanciallySyncBlocked(b.id)) {
      setWarning(FINANCIAL_SYNC_BLOCK_MESSAGE)
      return
    }
    setChargesBooking(b)
    setChargeForm({ description: '', amount: '', category: 'Food & Beverage', quantity: 1, outlet_id: frontDeskId })
    setChargeError('')
    const result = await window.api.charges.getByBooking(b.id).catch(() => ({ unavailable: true }))
    const normalized = normalizeChargesResponse(result)
    setCharges(normalized.items)
    setChargesUnavailable(normalized.unavailable)
  }

  const handleAddCharge = async (e) => {
    e.preventDefault()
    if (isFinanciallySyncBlocked(chargesBooking?.id)) {
      setChargeError(FINANCIAL_SYNC_BLOCK_MESSAGE)
      return
    }
    setChargeLoading(true)
    setChargeError('')
    try {
      const res = await window.api.charges.add(chargesBooking.id, {
        ...chargeForm,
        unit_price: parseFloat(chargeForm.amount),
        amount: parseFloat(chargeForm.amount),
        quantity: parseInt(chargeForm.quantity)
      })
      if (res?.success === false) throw new Error(res.error || 'Failed to add charge')
      const result = await window.api.charges.getByBooking(chargesBooking.id).catch(() => ({ unavailable: true }))
      const normalized = normalizeChargesResponse(result)
      setCharges(normalized.items)
      setChargesUnavailable(normalized.unavailable)
      setChargeForm({ description: '', amount: '', category: 'Food & Beverage', quantity: 1, outlet_id: frontDeskId })
      // Reload bookings so charges_total is current if user opens payment modal next
      loadAll()
      showSuccess('Extra charge added. Booking totals have been refreshed.')
    } catch (err) {
      setChargeError(err.message || 'Failed to add charge')
    }
    setChargeLoading(false)
  }

  const handleDeleteCharge = async (id) => {
    if (isFinanciallySyncBlocked(chargesBooking?.id)) {
      setChargeError(FINANCIAL_SYNC_BLOCK_MESSAGE)
      return
    }
    const reason = window.prompt(
      'Void this extra charge.\n\nEnter a short reason for the audit trail:',
      'Entered in error'
    )
    if (reason === null) return
    if (!String(reason || '').trim()) {
      setChargeError('A void reason is required.')
      return
    }
    const result = await window.api.charges.delete(id, String(reason).trim()).catch((error) => ({ success: false, error: error?.message }))
    if (result?.success === false) {
      setChargeError(result.error || 'Failed to void charge')
      return
    }
    const chargesResult = await window.api.charges.getByBooking(chargesBooking.id).catch(() => ({ unavailable: true }))
    const normalized = normalizeChargesResponse(chargesResult)
    setCharges(normalized.items)
    setChargesUnavailable(normalized.unavailable)
    // Reload bookings so charges_total is current if user opens payment modal next
    loadAll()
    showSuccess('Extra charge voided. Booking totals have been refreshed.')
  }

  const [listLoading, setListLoading] = useState(true)

  const loadAll = useCallback(async () => {
    setListLoading(true)
    const [b, r, c] = await Promise.all([
      window.api.bookings.getAll(),
      window.api.rooms.getAll(),
      window.api.customers.getAll()
    ])
    setBookings(b)
    setRooms(r)
    setCustomers(c)
    setListLoading(false)
  }, [])

  const isFinanciallySyncBlocked = (bookingId) => (
    financialCacheStale || financialPendingIds.has(bookingId) || financialFailedIds.has(bookingId)
  )

  const getCheckoutBlockMessage = (booking) => {
    if (!booking) return ''
    if (booking._pending_payment) return 'Cannot checkout: payment is pending sync'
    if (isFinanciallySyncBlocked(booking.id)) return FINANCIAL_SYNC_BLOCK_MESSAGE
    const outstanding = bookingOutstandingAmount(booking)
    if (outstanding > 0) return `Settle ${currency} ${outstanding.toFixed(2)} before checkout`
    return 'Check out guest'
  }

  // Reload bookings whenever this page becomes active — catches stale data after navigating away
  // (e.g. returning from the invoices refund flow without a full page remount)
  useEffect(() => {
    loadAll()
  }, [location.pathname, loadAll])

  useEffect(() => {
    loadAll()
    // Load outlets for booking charge attribution; fail silently — outlet_id will be null if unavailable
    window.api.outlets.getAll()
      .then((data) => {
        const list = data || []
        setChargeOutlets(list)
        const fd = list.find(o =>
          o.name?.toLowerCase().includes('front') || o.type === 'accommodation'
        )
        if (fd) {
          setFrontDeskId(fd.id)
          setChargeForm(f => ({ ...f, outlet_id: fd.id }))
        }
      })
      .catch(() => {}) // non-critical; charge will save with outlet_id = null
  }, [loadAll])

  useEffect(() => {
    if (!window.api?.usage?.getSnapshot) return
    window.api.usage.getSnapshot().then((snapshot) => {
      if (!snapshot?.error) setUsageSnapshot(snapshot)
    }).catch(() => {})
  }, [bookings.length])

  useEffect(() => {
    if (!location.state?.prefillName) return
    const name = location.state.prefillName
    openAdd()
    setUseNewCustomer(true)
    setNewCustomer(prev => ({ ...prev, name }))
    navigate(location.pathname, { replace: true, state: {} })
  }, [location.state, location.pathname, navigate])

  useEffect(() => {
    if (!location.state?.showPendingOnline) return
    setFilterOnline(true)
    setFilterStatus('pending')
    setSearch('')
    setWarning('Showing pending online booking requests that need front-desk action.')
    navigate(location.pathname, { replace: true, state: {} })
  }, [location.pathname, location.state, navigate])

  useEffect(() => {
    const reviewBookingId = location.state?.reviewBookingId
    const focusBookingId = location.state?.focusBookingId
    const targetBookingId = location.state?.collectPaymentBookingId
    const targetId = targetBookingId || reviewBookingId || focusBookingId
    if (!targetId || paymentBooking) return
    if (!bookings.length) return

    const booking = bookings.find((entry) => String(entry.id) === String(targetId))
    if (!booking) {
      setWarning('Could not find that booking. Please refresh bookings and try again.')
      navigate(location.pathname, { replace: true, state: {} })
      return
    }

    if (targetBookingId && booking.status === 'cancelled') {
      setWarning('That booking has been cancelled, so no payment can be collected from the invoice screen.')
    } else if (targetBookingId && isFinanciallySyncBlocked(booking.id)) {
      setWarning(FINANCIAL_SYNC_BLOCK_MESSAGE)
    } else if (targetBookingId && bookingOutstandingAmount(booking) <= 0) {
      setWarning('That booking is already fully settled.')
    } else if (targetBookingId) {
      openPayment(booking)
      showSuccess(`Opened payment collection for ${booking.customer_name || 'this guest'}.`)
    } else {
      setSearch(booking.invoice_number || booking.customer_name || booking.room_number || '')
      setReceiptBooking(booking)
      setWarning(
        reviewBookingId
          ? `Opened ${booking.customer_name || 'this booking'} for review after a sync issue.`
          : `Focused ${booking.customer_name || 'this booking'} in the bookings list.`
      )
    }

    navigate(location.pathname, { replace: true, state: {} })
  }, [bookings, location.pathname, location.state, navigate, paymentBooking, financialCacheStale, financialFailedIds, financialPendingIds])

  useEffect(() => () => window.clearTimeout(successTimerRef.current), [])

  useEffect(() => {
    let cancelled = false

    const loadApplicableRate = async () => {
      if (!showModal || !form.room_id || !form.check_in || !form.check_out) {
        if (!cancelled) setApplicableRate(null)
        return
      }

      try {
        const result = await window.api.rateOverrides.getApplicable(form.room_id, form.check_in, form.check_out)
        if (cancelled) return
        if (result && Number.isFinite(Number(result.rate))) {
          setApplicableRate({
            rate_per_night: Number(result.rate),
            name: result.name || ''
          })
        } else {
          setApplicableRate(null)
        }
      } catch {
        if (!cancelled) setApplicableRate(null)
      }
    }

    loadApplicableRate()
    return () => { cancelled = true }
  }, [showModal, form.room_id, form.check_in, form.check_out])

  const showSuccess = (message) => {
    setSuccess(message)
    window.clearTimeout(successTimerRef.current)
    successTimerRef.current = window.setTimeout(() => setSuccess(''), 3500)
  }

  const openAdd = () => {
    if (bookingCreateBlocked) {
      setShowUpgradePrompt(true)
      return
    }
    setEditingId(null)
    setEditingGroupId(null)
    setEditingBaseUpdatedAt(null)
    setForm({ ...emptyBooking, check_in: today(), check_out: tomorrow() })
    setApplicableRate(null)
    setNewCustomer(emptyCustomer)
    setUseNewCustomer(true)
    setError('')
    setWarning('')
    setSuccess('')
    setModalWarning('')
    setShowModal(true)
  }

  const openEdit = (b) => {
    setEditingId(b.id)
    setEditingBaseUpdatedAt(b.updated_at || null)
    
    const groupMatch = b.notes?.match(/\[GROUP:[^\]]+\]/)
    const groupId = groupMatch ? groupMatch[0] : null
    setEditingGroupId(groupId)
    const displayNotes = b.notes ? b.notes.replace(/\[GROUP:[^\]]+\]/g, '').trim() : ''
    
    setForm({
      customer_id: b.customer_id,
      room_id: b.room_id,
      check_in: b.check_in,
      check_out: b.check_out,
      adults: b.adults,
      children: b.children,
      notes: displayNotes
    })
    setApplicableRate(null)
    setUseNewCustomer(false)
    setError('')
    setSuccess('')
    setModalWarning('')
    setShowModal(true)
  }

  const closePaymentModal = () => {
    setPaymentBooking(null)
    setPaymentIntentKey(null)
    setPayError('')
  }

  const getPaymentAttemptSignature = (bookingId, paymentStatus, amount) => {
    const safeAmount = Math.max(0, Number(amount) || 0).toFixed(2)
    return `${bookingId}:${paymentStatus}:${safeAmount}`
  }

  const getOrCreatePaymentIntentKey = (bookingId, paymentStatus, amount) => {
    const signature = getPaymentAttemptSignature(bookingId, paymentStatus, amount)
    const existing = paymentIntentCacheRef.current.get(bookingId)
    if (existing?.signature === signature && existing?.key) {
      return existing.key
    }
    const key = crypto.randomUUID()
    paymentIntentCacheRef.current.set(bookingId, { signature, key })
    return key
  }

  const openPayment = (b) => {
    if (isFinanciallySyncBlocked(b.id)) {
      setWarning(FINANCIAL_SYNC_BLOCK_MESSAGE)
      return
    }
    const initialStatus = b.payment_status === 'paid' ? 'paid' : b.payment_status === 'partial' ? 'partial' : 'paid'
    const initialAmount = initialStatus === 'paid'
      ? Number(b.total_amount || 0) + Number(b.charges_total || 0) - Number(b.amount_paid || 0)
      : (b.amount_paid || '')
    setPaymentBooking(b)
    setPaymentIntentKey(getOrCreatePaymentIntentKey(b.id, initialStatus, initialAmount))
    setPayError('')
    setPayForm({
      payment_status: initialStatus,
      payment_method: b.payment_method || 'cash',
      amount_paid: initialAmount
    })
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      let customerId = form.customer_id

      if (useNewCustomer && !editingId) {
        if (!newCustomer.name.trim()) {
          setError('Guest name is required')
          setLoading(false)
          return
        }
        const res = await window.api.customers.create(newCustomer)
        if (!res.success) throw new Error(res.error)
        customerId = res.id
      }

      if (!editingId && selectedRoom) {
        const totalGuests = parseInt(form.adults) + parseInt(form.children)
        const maxOccupancy = selectedRoom.max_occupancy || 2
        if (totalGuests > maxOccupancy) {
          setError(`Number of guests (${totalGuests}) exceeds room maximum occupancy (${maxOccupancy})`)
          setLoading(false)
          return
        }
      }

      const data = {
        ...form,
        customer_id: customerId,
        room_id: form.room_id,
        notes: editingGroupId ? `${form.notes} ${editingGroupId}`.trim() : form.notes,
        adults: parseInt(form.adults),
        children: parseInt(form.children),
        created_by: user.id,
        ...(editingId && editingBaseUpdatedAt ? { expected_updated_at: editingBaseUpdatedAt } : {})
      }

      let res
      if (editingId) {
        res = await window.api.bookings.update(editingId, data)
      } else {
        const bookingLimitStatus = canCreateBooking({
          plan: access?.entitlement?.plan || 'Starter',
          used: thisMonthBookings
        })
        if (bookingLimitStatus.isBlocked) {
          const plan = access?.entitlement?.plan || 'Starter'
          const nextPlan = plan === 'Starter' ? 'Standard' : 'Pro'
          throw new Error(`You’ve reached ${thisMonthBookings} / ${bookingLimitStatus.effectiveLimit} monthly bookings on ${plan}. Upgrade to ${nextPlan} for higher monthly booking capacity.`)
        }
        res = await window.api.bookings.create(data)
      }

      if (res.success === false) throw new Error(res.error)

      if (res.depositWarning) {
        // Booking was created. Only the deposit write failed.
        // Show amber warning IN the modal — do NOT close. Red error is for actual creation failure.
        setModalWarning(res.depositWarning)
        loadAll()
        setLoading(false)
        return
      }

      setModalWarning('')
      setShowModal(false)
      setEditingBaseUpdatedAt(null)
      loadAll()
      showSuccess(editingId ? 'Booking changes saved.' : 'Booking created successfully.')
    } catch (err) {
      const message = err.message || 'Failed to save booking'
      if (/modified on another device|refresh and try again/i.test(message)) {
        await loadAll()
        setEditingBaseUpdatedAt(null)
        setError('This booking changed on another device. The latest booking list has been refreshed. Re-open the booking and apply your edit again.')
      } else {
        setError(message)
      }
    }
    setLoading(false)
  }

  const handlePaymentSave = async (e) => {
    e.preventDefault()
    if (isFinanciallySyncBlocked(paymentBooking?.id)) {
      setPayError(FINANCIAL_SYNC_BLOCK_MESSAGE)
      return
    }
    setPayLoading(true)
    setPayError('')

    // Compute the delta amount to pay
    let amountToPay = 0
    if (payForm.payment_status === 'paid') {
      // Canonical balance = room total + charges; || 0 guards against null charges_total
      amountToPay = Math.max(0, Number(paymentBooking.total_amount || 0) + Number(paymentBooking.charges_total || 0) - Number(paymentBooking.amount_paid || 0))
    } else if (payForm.payment_status === 'partial') {
      amountToPay = Number(payForm.amount_paid) || 0
    }

    const resolvedIntentKey = getOrCreatePaymentIntentKey(
      paymentBooking.id,
      payForm.payment_status,
      amountToPay
    )
    setPaymentIntentKey(resolvedIntentKey)

    // Reuse the same key for the same booking+amount even across modal reopen.
    const result = await window.api.bookings.updatePayment(
      paymentBooking.id,
      amountToPay,
      payForm.payment_method,
      resolvedIntentKey
    )

    if (result?.success === false) {
      // Do NOT clear paymentIntentKey — retry must reuse the same key for safe deduplication
      setPayError(result.error || 'Payment failed. Please try again.')
      setPayLoading(false)
      return
    }

    paymentIntentCacheRef.current.delete(paymentBooking.id)
    closePaymentModal()
    loadAll()
    const remaining = Math.max(0, (Number(paymentBooking.total_amount || 0) + Number(paymentBooking.charges_total || 0)) - Number(paymentBooking.amount_paid || 0) - Number(amountToPay || 0))
    showSuccess(
      result?.offline
        ? 'Payment saved locally — will sync when online'
        : remaining > 0
          ? `Payment recorded. ${currency} ${remaining.toFixed(2)} remains outstanding.`
          : 'Payment recorded and the booking is now settled in full.'
    )
    setPayLoading(false)
  }

  const handleStatusChange = async (id, status) => {
    const booking = bookings.find((entry) => entry.id === id)
    const isOfflineCreatedPendingBooking = booking?._pending_sync && booking?._sync_created_offline
    if (status === 'checked_out' && isFinanciallySyncBlocked(id)) {
      setWarning(FINANCIAL_SYNC_BLOCK_MESSAGE)
      return
    }
    if (status === 'cancelled' && isFinanciallySyncBlocked(id) && !isOfflineCreatedPendingBooking) {
      setWarning(FINANCIAL_SYNC_BLOCK_MESSAGE)
      return
    }
    if (status === 'cancelled') {
      const hasDeposit = Number(booking?.amount_paid || 0) > 0
      const msg = hasDeposit
        ? `This booking has a deposit of ${currency} ${Number(booking.amount_paid).toFixed(2)}.\n\nCancelling will mark this as "Pending Refund". You must process the refund in the Financial Reconciliation section later to clear the balance.\n\nContinue with cancellation?`
        : 'Cancel this booking?\n\nThis removes it from active operations and can affect room availability and reporting. Continue only if the guest is definitely not staying.'
      
      const confirmed = window.confirm(msg)
      if (!confirmed) return
    }
    if (status === 'checked_in' && booking) {
      if (booking.check_in > today()) {
        setWarning(`Cannot check in before the check-in date (${booking.check_in}).`)
        return
      }
    }
    if (status === 'checked_out' && booking) {
      if (booking._pending_payment) {
        setWarning('Cannot checkout: payment is pending sync')
        return
      }
      const outstanding = bookingOutstandingAmount(booking)
      if (outstanding > 0) {
        setWarning(`Cannot check out ${booking.customer_name || 'this guest'} until the full balance is paid. Outstanding: ${currency} ${outstanding.toFixed(2)}.`)
        return
      }
    }
    setStatusLoadingId(id)
    try {
      const result = await window.api.bookings.updateStatus(id, status)
      if (result?.success === false) {
        setWarning(`Status update failed: ${result.error || 'Please try again.'}`)
      } else {
        loadAll()
        const labels = {
          checked_in: 'Guest checked in successfully.',
          checked_out: 'Guest checked out successfully.',
          cancelled: 'Booking cancelled.'
        }
        showSuccess(labels[status] || 'Booking status updated.')
      }
    } finally {
      setStatusLoadingId(null)
    }
  }

  const openEventModal = () => {
    setEventForm({ event_name: '', contact_phone: '', contact_email: '', check_in: today(), check_out: tomorrow(), event_daily_rate: '', deposit_amount: '', payment_method: 'cash', notes: '' })
    setEventResult(null)
    setError('')
    setShowEventModal(true)
  }

  const handleEventSave = async (e) => {
    e.preventDefault()
    setEventLoading(true)
    try {
      const res = await window.api.bookings.createEvent({ ...eventForm, created_by: user.id })
      if (res.success === false) throw new Error(res.error)
      // Pass depositWarning into eventResult so the success screen can display it
      setEventResult({ ...res, depositWarning: res.depositWarning || null })
      loadAll()
    } catch (err) {
      setError(err.message || 'Failed to create event booking')
    }
    setEventLoading(false)
  }

  // Show PENDING for offline-queued bookings without a server-assigned invoice number.
  // Once sync completes the cache is refreshed from the server and the real number appears.
  const fmtBkNum = (b) => b.invoice_number || b._local_invoice_number || (b._pending_sync ? 'PENDING' : '—')

  const filtered = useMemo(() => bookings.filter((b) => {
    const matchSearch =
      !search ||
      b.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
      b.room_number?.toLowerCase().includes(search.toLowerCase()) ||
      String(fmtBkNum(b)).toLowerCase().includes(search.toLowerCase())
    const matchStatus = filterStatus === 'all' || b.status === filterStatus
    const matchPayment = filterPayment === 'all' || (b.payment_status || 'unpaid') === filterPayment
    const matchOnline = !filterOnline || b.source === 'online'
    return matchSearch && matchStatus && matchPayment && matchOnline
  }), [bookings, filterOnline, filterPayment, filterStatus, search])

  const nights = (checkIn, checkOut) => {
    if (!checkIn || !checkOut) return 0
    return Math.max(
      0,
      Math.ceil((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24))
    )
  }

  const isEventBooking = (b) => b && (b._event_group || b.is_exclusive_event || b.notes?.includes('[GROUP:'))

  const sortBookings = useCallback((list) => {
    const safeDate = (value) => {
      const time = value ? new Date(value).getTime() : NaN
      return Number.isFinite(time) ? time : 0
    }
    const safeText = (value) => String(value || '').toLowerCase()

    return [...list].sort((left, right) => {
      switch (sortBy) {
        case 'created_asc':
          return safeDate(left.created_at) - safeDate(right.created_at)
        case 'check_in_asc':
          return safeDate(left.check_in) - safeDate(right.check_in)
        case 'check_in_desc':
          return safeDate(right.check_in) - safeDate(left.check_in)
        case 'room_asc':
          return safeText(left.room_number).localeCompare(safeText(right.room_number), undefined, { numeric: true, sensitivity: 'base' })
        case 'created_desc':
        default:
          return safeDate(right.created_at) - safeDate(left.created_at)
      }
    })
  }, [sortBy])

  const groupEventBookings = useCallback((list) => {
    const regular   = list.filter(b => !b.is_exclusive_event)
    const eventRows = list.filter(b => b.is_exclusive_event)
    const groupMap  = {}
    eventRows.forEach(b => {
      if (!b) return
      const match   = b.notes?.match(/\[GROUP:([^\]]+)\]/)
      const groupId = match?.[1] || b.check_in || 'unknown'
      const roomCountMatch = String(b.notes || '').match(/\[ROOMS:(\d+)\]/)
      const expectedRoomCount = Number(roomCountMatch?.[1] || 0)
      if (!groupMap[groupId]) {
        groupMap[groupId] = {
          ...b,
          room_count: 0,
          total_amount: 0,
          amount_paid: 0,
          _event_group: true,
          room_number: 'Full Lodge'
        }
      }
      groupMap[groupId].room_count = Math.max(groupMap[groupId].room_count + 1, expectedRoomCount || 0)
      groupMap[groupId].total_amount += Number(b.total_amount || 0)
      groupMap[groupId].amount_paid  += Number(b.amount_paid  || 0)
    })
    return [...regular, ...Object.values(groupMap)]
  }, [])

  const groupedFilteredBookings = useMemo(
    () => sortBookings(groupEventBookings(filtered)),
    [filtered, groupEventBookings, sortBookings]
  )
  const pendingOnlineCount = useMemo(
    () => bookings.filter((b) => b.source === 'online' && b.status === 'pending').length,
    [bookings]
  )
  const pendingSyncCount = useMemo(
    () => bookings.filter((b) => b._pending_sync && !bookingHasSyncFailure(b, failedSyncIds)).length,
    [bookings, failedSyncIds]
  )
  const reviewCount = useMemo(
    () => bookings.filter((b) => bookingHasSyncFailure(b, failedSyncIds)).length,
    [bookings, failedSyncIds]
  )
  const attentionCount = useMemo(
    () => bookings.filter((b) => bookingHasAttentionState(b) || financialFailedIds.has(b.id) || bookingNeedsAttention(b)).length,
    [bookings, financialFailedIds]
  )
  const oldestPendingOnlineCreatedAt = useMemo(() => {
    const pendingOnline = bookings.filter((b) => b.source === 'online' && b.status === 'pending' && b.created_at)
    if (!pendingOnline.length) return null
    return pendingOnline.reduce((oldest, booking) => (
      !oldest || String(booking.created_at) < String(oldest) ? booking.created_at : oldest
    ), null)
  }, [bookings])
  const selectedRoom = useMemo(
    () => rooms.find((r) => r.id === form.room_id),
    [rooms, form.room_id]
  )
  const selectableRooms = useMemo(
    () => rooms,
    [rooms]
  )

  const selectedNightlyRate = applicableRate?.rate_per_night ?? selectedRoom?.rate_per_night ?? 0
  const estimatedTotal = selectedRoom
    ? selectedNightlyRate * nights(form.check_in, form.check_out)
    : 0
  const bookingGrandTotal = paymentBooking
    ? Number(paymentBooking.total_amount || 0) + Number(paymentBooking.charges_total || 0)
    : 0
  const outstandingBeforePayment = paymentBooking
    ? Math.max(0, bookingGrandTotal - Number(paymentBooking.amount_paid || 0))
    : 0
  const partialRemaining = paymentBooking
    ? Math.max(0, outstandingBeforePayment - Number(payForm.amount_paid || 0))
    : 0
  const usageLimits = getPlanUsageLimits(access?.entitlement?.plan || 'Starter')
  const currentPlan = normalizeSubscriptionPlan(usageSnapshot?.plan || access?.entitlement?.plan || 'Starter')
  const isProPlan = currentPlan === 'Pro'
  const thisMonthBookings = countMonthlyUsageBookings(bookings, new Date())
  const bookingLimitStatus = usageSnapshot?.statuses?.bookings || canCreateBooking({ plan: access?.entitlement?.plan || 'Starter', used: thisMonthBookings })
  const bookingCreateBlocked = usageSnapshot?.bookingAllowance?.isBlocked === true || bookingLimitStatus.isBlocked === true
  const bookingEarlyPrompt = getEarlyUpgradePromptState({
    plan: currentPlan,
    bookingsUsage: usageSnapshot?.usage?.monthlyBookings ?? thisMonthBookings,
    roomsUsage: usageSnapshot?.usage?.rooms ?? 0,
    usersUsage: usageSnapshot?.usage?.users ?? 0,
    limits: usageLimits
  })
  const showBookingEarlyPrompt = !isProPlan && !bookingCreateBlocked && bookingEarlyPrompt.shouldPrompt
  const bookingLimitMessage = usageSnapshot?.warning || (
    bookingCreateBlocked
      ? 'Booking creation is restricted until usage drops or the plan is upgraded.'
      : bookingLimitStatus.isInGrace
        ? 'A small booking grace allowance is active right now.'
        : ''
  )

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
      <div className="bb-page-header">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700/70">Front Desk</p>
          <h1 className="bb-page-header-title mt-2">Bookings</h1>
          <p className="bb-page-header-subtitle">{bookings.length} total bookings across current and upcoming stays.</p>
          <div className="mt-2">
            {isProPlan ? (
              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                Unlimited access
              </span>
            ) : (
              <UsageLimitIndicator label="Monthly bookings" used={usageSnapshot?.usage?.monthlyBookings ?? thisMonthBookings} limit={usageLimits.monthlyBookings} grace={usageLimits.monthlyBookingsGrace} />
            )}
            {usageSnapshot?.source === 'cache' && !isProPlan && (
              <p className="mt-2 text-xs text-amber-700">
                Usage count may be outdated because the app is offline. New records may be rejected during sync if the subscription limit has already been reached.
              </p>
            )}
            {!isProPlan && (
              <>
                <p className="mt-2 text-xs text-slate-500">{usageSnapshot?.monthlyResetCopy || MONTHLY_USAGE_RESET_COPY}</p>
                {bookingLimitMessage && (
                  <p className={`mt-2 text-xs ${bookingCreateBlocked ? 'text-rose-700' : 'text-amber-700'}`}>
                    {bookingLimitMessage}
                  </p>
                )}
              </>
            )}
            <div className="mt-3">
              <UpgradeNudgeBanner
                visible={showBookingEarlyPrompt}
                message="You’re approaching your plan limits. Consider upgrading to avoid interruptions."
                sessionKey="boroko:upgrade-nudge:bookings"
                lodgeId={settings?.lodge_id || ''}
                lodgeName={settings?.lodge_name || settings?.company_name || ''}
                plan={currentPlan}
                usage={usageSnapshot?.usage || { monthlyBookings: thisMonthBookings, rooms: 0, users: 0 }}
                recommendation={bookingEarlyPrompt}
                trigger="banner"
                onUpgrade={() => setShowUpgradePrompt(true)}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={openEventModal}
            className="inline-flex items-center gap-2 rounded-2xl border border-indigo-500/20 bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-[0_10px_24px_rgba(79,70,229,0.24)] transition-colors hover:bg-indigo-700"
          >
            <Building2 size={16} /> Event / Lodge Booking
          </button>
          <button
            onClick={openAdd}
            disabled={bookingCreateBlocked}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus size={16} /> New Booking
          </button>
        </div>
      </div>

      {warning && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-sm">
          ⚠️ {warning}
        </div>
      )}
      {success && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-sm">
          ✓ {success}
        </div>
      )}
      {bookingCreateBlocked && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 shadow-sm">
          {bookingLimitMessage || 'Booking creation is currently restricted for this lodge.'}
        </div>
      )}
      {pendingOnlineCount > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">
                {pendingOnlineCount} online booking request{pendingOnlineCount === 1 ? '' : 's'} waiting for action
              </p>
              <p className="mt-1 text-amber-800/85">
                Oldest request: {getOnlineRequestAgeMeta(oldestPendingOnlineCreatedAt).label}. Confirm or decline these before relying on arrivals and availability.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setFilterOnline(true)
                setFilterStatus('pending')
              }}
              className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100"
            >
              Focus Pending Requests
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bb-filter-bar">
        <div className="relative min-w-[260px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Search guest or room..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 shadow-sm">
          <Filter size={15} className="text-slate-400" />
          <select
            className="border-0 bg-transparent text-sm font-medium text-slate-700 focus:outline-none"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending (online)</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s} className="capitalize">
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 shadow-sm">
          <CreditCard size={15} className="text-slate-400" />
          <select
            className="border-0 bg-transparent text-sm font-medium text-slate-700 focus:outline-none"
            value={filterPayment}
            onChange={(e) => setFilterPayment(e.target.value)}
          >
            <option value="all">All payments</option>
            <option value="unpaid">Unpaid</option>
            <option value="partial">Partial</option>
            <option value="paid">Paid</option>
          </select>
        </div>
        <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 shadow-sm">
          <Filter size={15} className="text-slate-400" />
          <select
            className="border-0 bg-transparent text-sm font-medium text-slate-700 focus:outline-none"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="created_desc">Newest created</option>
            <option value="created_asc">Oldest created</option>
            <option value="check_in_asc">Check-in soonest</option>
            <option value="check_in_desc">Check-in latest</option>
            <option value="room_asc">Room number</option>
          </select>
        </div>
        {/* Online Requests quick filter */}
        {bookings.some(b => b.source === 'online') && (
          <button
            type="button"
            onClick={() => setFilterOnline(prev => !prev)}
            className={`flex items-center gap-1.5 rounded-2xl border px-3 py-2 text-xs font-semibold shadow-sm transition-colors ${
              filterOnline
                ? 'border-amber-400 bg-amber-50 text-amber-700'
                : 'border-slate-200 bg-white/80 text-slate-600 hover:border-amber-300 hover:text-amber-700'
            }`}
          >
            🌐 Online requests
            {pendingOnlineCount > 0 && (
              <span className="rounded-full bg-amber-500 text-white text-[10px] px-1.5 py-0.5 leading-none">
                {pendingOnlineCount}
              </span>
            )}
          </button>
        )}
        <div className="ml-auto text-xs text-slate-500">
          Search, filter, and sort bookings so new reservations are easier to find.
        </div>
      </div>

      {(pendingSyncCount > 0 || reviewCount > 0 || attentionCount > 0 || financialCacheStale) && (
        <div className="mt-[-8px] flex flex-wrap gap-3">
          {pendingSyncCount > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
              <span className="font-semibold">{pendingSyncCount}</span> booking{pendingSyncCount !== 1 ? 's are' : ' is'} still syncing. Keep this device online until they clear.
            </div>
          )}
          {reviewCount > 0 && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-sm">
              <span className="font-semibold">{reviewCount}</span> booking{reviewCount !== 1 ? 's need' : ' needs'} review before staff can trust the record.
            </div>
          )}
          {attentionCount > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
              <span className="font-semibold">{attentionCount}</span> booking{attentionCount !== 1 ? 's have' : ' has'} payment totals that need attention.
            </div>
          )}
          {financialCacheStale && (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 shadow-sm">
              Financial actions are temporarily locked while fresh booking data is still being confirmed from the server.
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="bb-table-shell overflow-visible">
        <HorizontalScrollArea viewportClassName="overflow-y-visible">
          <table className="min-w-[1180px] w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="px-5 py-3 text-left">#</th>
                <th className="px-5 py-3 text-left">Guest</th>
                <th className="px-5 py-3 text-left">Room</th>
                <th className="px-5 py-3 text-left">Check In</th>
                <th className="px-5 py-3 text-left">Check Out</th>
                <th className="px-5 py-3 text-left">Guests</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-left">Payment</th>
                <th className="px-5 py-3 text-right">Amount</th>
                <th className="px-5 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groupedFilteredBookings.map((b) => (
                <tr key={b.id} className="hover:bg-emerald-50/30" data-testid={`booking-row-${b.id}`}>
                  <td className="px-5 py-4 font-mono text-xs font-semibold text-slate-500">{fmtBkNum(b)}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-1.5">
                      <p className="font-semibold text-slate-800">{b.customer_name}</p>
                      {isEventBooking(b) && (
                        <span className="flex items-center gap-0.5 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                          <Building2 size={9} /> EVENT
                        </span>
                      )}
                      {b.source === 'online' && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                          🌐 ONLINE
                        </span>
                      )}
                    </div>
                    {b.customer_phone && (
                      <p className="mt-1 text-xs text-slate-500">{b.customer_phone}</p>
                    )}
                    {(b._pending_sync || bookingHasSyncFailure(b, failedSyncIds)) && (
                      <p className={`mt-1 text-xs font-medium ${
                        bookingHasSyncFailure(b, failedSyncIds) ? 'text-red-700' : 'text-amber-700'
                      }`}>
                        {bookingHasSyncFailure(b, failedSyncIds)
                          ? b._sync_state === 'sync_failed'
                            ? 'Room conflict — this room was taken by another booking. Reassign or cancel.'
                            : sanitizeSyncError(b._sync_error) || 'Sync failed — open System Health to see the reason and retry.'
                          : 'Changes are queued and will sync when the app is online.'}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-4 text-slate-600">
                    {b._event_group
                      ? <p className="font-medium text-indigo-600">{b.room_count} rooms (whole lodge)</p>
                      : <><p>Room {b.room_number}</p><p className="mt-1 text-xs text-slate-400">{b.room_type}</p></>
                    }
                  </td>
                  <td className="px-5 py-4 text-slate-600"><div className="font-medium text-slate-700">{b.check_in}</div></td>
                  <td className="px-5 py-4 text-slate-600"><div className="font-medium text-slate-700">{b.check_out}</div></td>
                  <td className="px-5 py-4 text-slate-600">
                    {b.adults}A {b.children > 0 ? `${b.children}C` : ''}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={b.status} />
                    {b.source === 'online' && b.status === 'pending' && (
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold whitespace-nowrap ${getOnlineRequestAgeMeta(b.created_at).tone}`}>
                        {getOnlineRequestAgeMeta(b.created_at).label}
                      </span>
                    )}
                    {bookingOutstandingAmount(b) > 0 && b.status !== 'cancelled' && (
                      <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700 whitespace-nowrap">
                        Balance {currency} {bookingOutstandingAmount(b).toFixed(2)}
                      </span>
                    )}
                    {b.status === 'cancelled' && Number(b.amount_paid || 0) > 0.01 && b.payment_status !== 'paid' && (
                      <span className="rounded-full border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 whitespace-nowrap">
                        ⚠️ Refund Pending
                      </span>
                    )}
                    {b._pending_sync && !bookingHasSyncFailure(b, failedSyncIds) && (
                      <span
                        className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-600 whitespace-nowrap"
                        data-testid={`booking-pending-sync-${b.id}`}
                      >
                        ⏳ Pending Sync
                      </span>
                    )}
                    {bookingHasSyncFailure(b, failedSyncIds) && (
                      <span
                        className="rounded-full border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-600 whitespace-nowrap"
                        data-testid={`booking-sync-failed-${b.id}`}
                      >
                        {b._sync_state === 'sync_failed' ? '⛔ Room Conflict' : '⛔ Sync Failed'}
                      </span>
                    )}
                    {!bookingHasSyncFailure(b, failedSyncIds) && !b._pending_sync && (bookingHasAttentionState(b) || financialFailedIds.has(b.id) || bookingNeedsAttention(b)) && (
                      <span
                        className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700 whitespace-nowrap"
                        data-testid={`booking-needs-attention-${b.id}`}
                      >
                        {financialFailedIds.has(b.id)
                          ? '⚠️ Payment Issue'
                          : bookingNeedsAttention(b)
                            ? '⚠️ Balance Mismatch'
                            : '⚠️ Review Required'}
                      </span>
                    )}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <PaymentBadge status={b.payment_status || 'unpaid'} />
                    {b._pending_payment && (
                      <>
                        <span className="ml-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700 align-middle whitespace-nowrap animate-pulse">
                          ⏳ Payment pending sync
                        </span>
                        <p className="mt-1 text-xs text-amber-700">
                          Payment saved locally — will sync when online
                        </p>
                      </>
                    )}
                    {b.payment_status === 'partial' && b.amount_paid > 0 && (
                      <p className="mt-1 text-xs text-slate-500">
                        {currency} {Number(b.amount_paid).toFixed(2)} paid
                      </p>
                    )}
                    {b.payment_method && b.payment_status !== 'unpaid' && (
                      <p className="mt-1 text-xs text-slate-500">
                        {METHOD_LABEL[b.payment_method] || b.payment_method}
                        {!b._pending_payment && !b._pending_sync && !bookingHasSyncFailure(b, failedSyncIds) && (
                          <span className="ml-1 text-emerald-600">✔</span>
                        )}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="font-semibold text-slate-800">{currency} {Number(b.total_amount || 0).toFixed(2)}</div>
                  </td>
                  <td className="px-5 py-4 text-center relative">
                    <div className="flex items-center justify-center gap-1.5">
                      {/* Room conflict — reassign or cancel */}
                      {bookingHasSyncFailure(b, failedSyncIds) && b._sync_state === 'sync_failed' ? (
                        <>
                          <button
                            onClick={() => openEdit(b)}
                            className="cursor-pointer rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-600"
                            title="Change room or dates to resolve the conflict"
                          >
                            Reassign Room
                          </button>
                          <button
                            onClick={() => handleStatusChange(b.id, 'cancelled')}
                            className="cursor-pointer rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-100"
                            title="Cancel this booking"
                          >
                            Cancel
                          </button>
                        </>
                      ) : b.status === 'pending' && b.source === 'online' ? (
                        /* Online booking pending: Confirm or Reject */
                        <>
                          <button
                            onClick={() => handleStatusChange(b.id, 'confirmed')}
                            className="cursor-pointer rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700"
                          >
                            ✓ Confirm
                          </button>
                          <button
                            onClick={() => handleStatusChange(b.id, 'cancelled')}
                            className="cursor-pointer rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-100"
                          >
                            ✕ Reject
                          </button>
                        </>
                      ) : (
                        <>
                          {b.status === 'confirmed' && (
                            <button
                              onClick={() => handleStatusChange(b.id, 'checked_in')}
                              disabled={b.check_in > today() || statusLoadingId === b.id}
                              title={b.check_in > today() ? `Check-in date is ${b.check_in}` : statusLoadingId === b.id ? 'Checking in…' : undefined}
                              className={`cursor-pointer rounded-xl px-3 py-1.5 text-xs font-semibold text-white transition-colors ${
                                b.check_in > today() || statusLoadingId === b.id
                                  ? 'bg-slate-300 text-slate-600 cursor-not-allowed'
                                  : 'bg-emerald-600 hover:bg-emerald-700'
                              }`}
                            >
                              {statusLoadingId === b.id ? 'Checking in…' : 'Check In'}
                            </button>
                          )}
                          {b.status === 'checked_in' && (
                            <button
                              onClick={() => handleStatusChange(b.id, 'checked_out')}
                              disabled={bookingOutstandingAmount(b) > 0 || isFinanciallySyncBlocked(b.id) || b._pending_payment || statusLoadingId === b.id}
                              title={statusLoadingId === b.id ? 'Checking out…' : getCheckoutBlockMessage(b)}
                              className={`cursor-pointer rounded-xl px-3 py-1.5 text-xs font-semibold text-white transition-colors ${
                                bookingOutstandingAmount(b) > 0 || isFinanciallySyncBlocked(b.id) || b._pending_payment || statusLoadingId === b.id
                                  ? 'bg-slate-300 text-slate-600 cursor-not-allowed'
                                  : 'bg-indigo-600 hover:bg-indigo-700'
                              }`}
                            >
                              {statusLoadingId === b.id ? 'Checking out…' : 'Check Out'}
                            </button>
                          )}
                          {b.payment_status !== 'paid' && b.status !== 'cancelled' && (
                            <button
                              onClick={() => openPayment(b)}
                              disabled={isFinanciallySyncBlocked(b.id)}
                              title={isFinanciallySyncBlocked(b.id) ? FINANCIAL_SYNC_BLOCK_MESSAGE : `Collect ${currency} ${bookingOutstandingAmount(b).toFixed(2)}`}
                              className={`cursor-pointer rounded-xl px-3 py-1.5 text-xs font-semibold text-white transition-colors ${
                                isFinanciallySyncBlocked(b.id)
                                  ? 'bg-slate-300 text-slate-600 cursor-not-allowed'
                                  : 'bg-blue-600 hover:bg-blue-700'
                              }`}
                            >
                              Collect Balance
                            </button>
                          )}
                          {b.status === 'cancelled' && Number(b.amount_paid || 0) > 0.01 && b.payment_status !== 'paid' && (
                            <button
                              onClick={() => {
                                if (isFinanciallySyncBlocked(b.id)) {
                                  setWarning(FINANCIAL_SYNC_BLOCK_MESSAGE)
                                  return
                                }
                                navigate('/invoices', { state: { refundBookingId: b.id } })
                              }}
                              disabled={isFinanciallySyncBlocked(b.id)}
                              title={isFinanciallySyncBlocked(b.id) ? FINANCIAL_SYNC_BLOCK_MESSAGE : `Refund ${currency} ${Number(b.amount_paid).toFixed(2)}`}
                              className={`cursor-pointer rounded-xl px-3 py-1.5 text-xs font-semibold text-white transition-colors ${
                                isFinanciallySyncBlocked(b.id)
                                  ? 'bg-slate-300 text-slate-600 cursor-not-allowed'
                                  : 'bg-rose-600 hover:bg-rose-700'
                              }`}
                            >
                              Process Refund
                            </button>
                          )}
                        </>
                      )}
                      <BookingMenu
                        b={b}
                        isOpen={openMenuId === b.id}
                        onToggle={() => setOpenMenuId(prev => prev === b.id ? null : b.id)}
                        onClose={() => setOpenMenuId(null)}
                        onCheckIn={() => handleStatusChange(b.id, 'checked_in')}
                        onCheckOut={() => handleStatusChange(b.id, 'checked_out')}
                        onCancel={() => handleStatusChange(b.id, 'cancelled')}
                        onEdit={() => openEdit(b)}
                        onPayment={() => openPayment(b)}
                        onExtras={() => openCharges(b)}
                        onReceipt={() => setReceiptBooking(b)}
                        onHistory={() => { setHistoryBooking(b); setShowHistory(true) }}
                        settings={settings}
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {listLoading && bookings.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-5 py-10">
                    <div className="flex items-center justify-center gap-3 py-10 text-sm text-gray-500">
                      <RefreshCw size={16} className="animate-spin" />
                      Loading bookings…
                    </div>
                  </td>
                </tr>
              )}
              {!listLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-5 py-10">
                    <div className="bb-empty-state py-10">
                      <p className="text-base font-semibold text-slate-800">No bookings found</p>
                      <p className="text-sm text-slate-500">Try adjusting the search or filters, or create a new booking to continue front-desk work.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </HorizontalScrollArea>
      </div>

      {/* Receipt */}
      {receiptBooking && (
        <Receipt
          booking={receiptBooking}
          onClose={() => setReceiptBooking(null)}
          onCollectPayment={(booking) => {
            setReceiptBooking(null)
            openPayment(booking)
          }}
        />
      )}

      {/* Extras / Charges Modal */}
      {chargesBooking && (
        <Modal
          title={`Extra Charges — ${chargesBooking.customer_name}`}
          onClose={() => {
            setChargesBooking(null)
            setChargesUnavailable(false)
          }}
          size="sm"
        >
          <div className="space-y-4">
            {/* Existing charges */}
            {chargesUnavailable ? (
              <div className="bb-empty-state py-8">
                <p className="text-sm font-semibold text-slate-800">Charges unavailable offline</p>
                <p className="text-sm text-slate-500">Reconnect to the internet to load the booking folio charges for this guest.</p>
              </div>
            ) : charges.length > 0 ? (
              <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white/70 px-1">
                {charges.map((c) => (
                  <div key={c.id} className="flex items-center justify-between px-3 py-3 text-sm">
                    <div>
                      <p className="font-medium text-slate-800">{c.description}</p>
                      <p className="text-xs text-slate-500">
                        {c.category} · qty {c.quantity ?? 1} · {c.outlets?.name || 'Unassigned'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-800">
                        {currency} {Number(c.amount).toFixed(2)}
                      </span>
                      <button
                        onClick={() => handleDeleteCharge(c.id)}
                        className="rounded-lg px-1 text-xs text-red-400 transition-colors hover:bg-red-50 hover:text-red-600"
                      >✕</button>
                    </div>
                  </div>
                ))}
                <div className="flex justify-between px-3 pb-2 pt-3 text-sm font-bold text-slate-800">
                  <span>Total extras</span>
                  <span>{currency} {charges.reduce((s, c) => s + Number(c.amount), 0).toFixed(2)}</span>
                </div>
              </div>
            ) : (
              <div className="bb-empty-state py-8">
                <p className="text-sm font-semibold text-slate-800">No extra charges yet</p>
                <p className="text-sm text-slate-500">Add minibar, food, laundry, or other extras to the folio.</p>
              </div>
            )}

            {/* Add charge form */}
            <form onSubmit={handleAddCharge} className="space-y-3 border-t border-slate-200 pt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Add Charge</p>
              <p className="text-xs text-slate-500">
                {chargesUnavailable
                  ? 'Charges are unavailable offline. Reconnect to add or review folio extras.'
                  : 'Use extras for minibar, food, laundry, or other folio items that should increase the guest balance.'}
              </p>
              <input
                type="text"
                className="input"
                placeholder="Description (e.g. Breakfast, Laundry)"
                value={chargeForm.description}
                onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })}
                disabled={chargesUnavailable}
                required
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input"
                  placeholder={`Amount (${currency})`}
                  value={chargeForm.amount}
                  onChange={(e) => setChargeForm({ ...chargeForm, amount: e.target.value })}
                  disabled={chargesUnavailable}
                  required
                />
                <input
                  type="number"
                  min="1"
                  className="input"
                  placeholder="Qty"
                  value={chargeForm.quantity}
                  onChange={(e) => setChargeForm({ ...chargeForm, quantity: e.target.value })}
                  disabled={chargesUnavailable}
                />
              </div>
              <select
                className="input"
                value={chargeForm.category}
                onChange={(e) => setChargeForm({ ...chargeForm, category: e.target.value })}
                disabled={chargesUnavailable}
              >
                {['Food & Beverage', 'Minibar', 'Laundry', 'Transport', 'Activities', 'Telephone', 'Other'].map(
                  (c) => <option key={c} value={c}>{c}</option>
                )}
              </select>
              {chargeOutlets.length > 0 && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Charge Outlet</label>
                  <select
                    className="input"
                    value={chargeForm.outlet_id}
                    onChange={(e) => setChargeForm({ ...chargeForm, outlet_id: e.target.value })}
                    disabled={chargesUnavailable}
                  >
                    {chargeOutlets.map(o => (
                      <option key={o.id || o.name} value={o.id || ''}>{o.name}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-400">Front Desk for room/admin charges. Kitchen or Bar for food/beverage.</p>
                </div>
              )}
              {chargeError && <p className="text-sm text-red-500">{chargeError}</p>}
              <button type="submit" disabled={chargeLoading || chargesUnavailable} className="btn-primary w-full">
                {chargeLoading ? 'Adding...' : '+ Add Charge'}
              </button>
            </form>
          </div>
        </Modal>
      )}

      {/* Payment Modal */}
      {paymentBooking && (
        <Modal
          title="Record Payment"
          onClose={closePaymentModal}
          size="sm"
        >
          <form onSubmit={handlePaymentSave} className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-4 text-sm">
              <p className="font-semibold text-slate-800">{paymentBooking.customer_name}</p>
              <p className="mt-1 text-slate-500">Room {paymentBooking.room_number} — Total: <span className="font-semibold text-slate-800">{currency} {bookingGrandTotal.toFixed(2)}</span>{paymentBooking.charges_total > 0 && <span className="ml-1 text-xs text-slate-400">(incl. extras)</span>}</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Already paid</p>
                  <p className="mt-1 text-sm font-semibold text-slate-800">{currency} {Number(paymentBooking.amount_paid || 0).toFixed(2)}</p>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-500">Outstanding</p>
                  <p className="mt-1 text-sm font-semibold text-amber-800">{currency} {outstandingBeforePayment.toFixed(2)}</p>
                </div>
              </div>
            </div>

            <F label="Payment Status">
              <select
                className="input"
                value={payForm.payment_status}
                onChange={(e) => {
                  const ps = e.target.value
                  setPayForm((f) => ({
                    ...f,
                    payment_status: ps,
                    amount_paid: ps === 'paid' ? (Number(paymentBooking.total_amount || 0) + Number(paymentBooking.charges_total || 0)) : f.amount_paid
                  }))
                }}
                data-testid="booking-payment-status-select"
              >
                <option value="paid">✅ Paid in Full</option>
                <option value="partial">⚡ Partial Payment</option>
              </select>
              <p className="mt-1.5 text-xs text-slate-500">
                Choose <strong>Paid in Full</strong> to settle the full outstanding balance, or <strong>Partial Payment</strong> to record only what was received today.
              </p>
              <p className="mt-1.5 text-xs text-slate-500">
                To leave a booking unpaid, close this modal without recording a payment. To reverse a payment, use the refund/reversal flow.
              </p>
            </F>

            <F label="Payment Method">
              <select
                className="input"
                value={payForm.payment_method}
                onChange={(e) => setPayForm((f) => ({ ...f, payment_method: e.target.value }))}
                data-testid="booking-payment-method-select"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-slate-500">
                This will be stored as the method for the payment being recorded right now. Bank transfer payments require POP before you confirm them.
              </p>
            </F>

            {payForm.payment_status === 'partial' && (
              <F label={`Amount Paid (${currency})`}>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={outstandingBeforePayment}
                  className="input"
                  value={payForm.amount_paid}
                  onChange={(e) => setPayForm((f) => ({ ...f, amount_paid: e.target.value }))}
                  placeholder={`Outstanding: ${currency} ${outstandingBeforePayment.toFixed(2)}`}
                  required
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  Enter only the amount received in this payment. The remaining balance will stay open on the booking.
                </p>
                {payForm.amount_paid > 0 && (
                  <p className="mt-1 text-xs text-orange-500">
                    Remaining after this payment: {currency} {partialRemaining.toFixed(2)}
                  </p>
                )}
              </F>
            )}
            {payForm.payment_status === 'paid' && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                This will clear the current outstanding balance of <strong>{currency} {outstandingBeforePayment.toFixed(2)}</strong>.
              </div>
            )}
            {payError && (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{payError}</p>
            )}

            <div className="flex gap-3 pt-1">
              <button type="button" onClick={closePaymentModal} className="btn-secondary flex-1">
                Cancel
              </button>
              <button type="submit" disabled={payLoading} className="btn-primary flex-1">
                {payLoading ? 'Saving...' : 'Save Payment'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Event / Lodge Booking Modal */}
      {showEventModal && (
        <Modal
          title="🏢 Event / Lodge Booking"
          onClose={() => setShowEventModal(false)}
          size="lg"
        >
          {eventResult ? (
            /* ── Success screen ── */
            <div className="text-center py-6">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 size={28} className="text-green-600" />
              </div>
              <h3 className="mb-1 text-lg font-bold text-slate-800">Entire Lodge Reserved!</h3>
              <p className="mb-4 text-sm text-slate-500">
                <span className="font-semibold text-slate-700">"{eventForm.event_name}"</span> — Entire lodge reserved.
              </p>
              <div className="mb-5 space-y-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm text-slate-600">
                <p className="font-medium text-slate-700">All {eventResult.count} rooms · Conference · Pool · Bar · Kitchen</p>
                <p className="text-slate-500">{eventForm.check_in} → {eventForm.check_out} ({eventResult.nights} night{eventResult.nights !== 1 ? 's' : ''})</p>
                {eventResult.totalPrice > 0 && (
                  <p className="font-semibold text-green-700">Total: {currency} {eventResult.totalPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                )}
              </div>
              {eventResult?.depositWarning && (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm text-amber-800">
                  ⚠️ Deposit not recorded: {eventResult.depositWarning}. Please record it manually.
                </div>
              )}
              <button onClick={() => setShowEventModal(false)} className="btn-primary px-8">Done</button>
            </div>
          ) : (
            /* ── Booking form ── */
            <form onSubmit={handleEventSave} className="space-y-5">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <strong>EXCLUSIVE lodge booking.</strong> The entire property — all rooms, conference room, pool, bar and kitchen — will be reserved for one guest. No other bookings can be made during this period. <strong>Any existing bookings must be cancelled first.</strong>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <F label="Event / Group Name *">
                    <input
                      className="input"
                      value={eventForm.event_name}
                      onChange={(e) => setEventForm({ ...eventForm, event_name: e.target.value })}
                      placeholder="e.g. ABC Conference, Smith Wedding, Company Retreat"
                      required
                    />
                  </F>
                </div>
                <F label="Contact Phone">
                  <input
                    className="input"
                    value={eventForm.contact_phone}
                    onChange={(e) => setEventForm({ ...eventForm, contact_phone: e.target.value })}
                    placeholder="+267 ..."
                  />
                </F>
                <F label="Contact Email">
                  <input
                    type="email"
                    className="input"
                    value={eventForm.contact_email}
                    onChange={(e) => setEventForm({ ...eventForm, contact_email: e.target.value })}
                  />
                </F>
                <F label="Check In *">
                  <input
                    type="date"
                    className="input"
                    value={eventForm.check_in}
                    onChange={(e) => setEventForm({ ...eventForm, check_in: e.target.value })}
                    required
                  />
                </F>
                <F label="Check Out *">
                  <input
                    type="date"
                    className="input"
                    value={eventForm.check_out}
                    min={eventForm.check_in}
                    onChange={(e) => setEventForm({ ...eventForm, check_out: e.target.value })}
                    required
                  />
                </F>
                <div className="col-span-2">
                  <F label={`Daily Rate (${currency}) *`}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="input"
                      value={eventForm.event_daily_rate}
                      onChange={(e) => setEventForm({ ...eventForm, event_daily_rate: e.target.value })}
                      placeholder="Fixed daily rate for the entire lodge"
                      required
                    />
                  </F>
                  {Number(eventForm.event_daily_rate) > 0 && eventForm.check_in && eventForm.check_out && (() => {
                    const nights = Math.max(0, Math.ceil((new Date(eventForm.check_out) - new Date(eventForm.check_in)) / 86400000))
                    const total = Number(eventForm.event_daily_rate) * nights
                    return nights > 0 ? (
                      <p className="text-xs text-green-700 font-medium mt-1.5">
                        Total: {currency} {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({nights} night{nights !== 1 ? 's' : ''} × {currency} {Number(eventForm.event_daily_rate).toLocaleString(undefined, { minimumFractionDigits: 2 })}/night)
                      </p>
                    ) : null
                  })()}
                </div>
                <F label={`Deposit (${currency}) — optional`}>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="input"
                    value={eventForm.deposit_amount}
                    onChange={(e) => setEventForm({ ...eventForm, deposit_amount: e.target.value })}
                    placeholder="Optional deposit amount"
                  />
                </F>
                {Number(eventForm.deposit_amount) > 0 && (
                  <F label="Deposit Payment Method">
                    <select
                      className="input"
                      value={eventForm.payment_method}
                      onChange={(e) => setEventForm({ ...eventForm, payment_method: e.target.value })}
                    >
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                    <p className="mt-1.5 text-xs text-slate-500">If the deposit comes by bank transfer, confirm POP before saving the event booking.</p>
                  </F>
                )}
                <div className="col-span-2">
                  <F label="Notes">
                    <textarea
                      className="input resize-none"
                      rows={2}
                      value={eventForm.notes}
                      onChange={(e) => setEventForm({ ...eventForm, notes: e.target.value })}
                      placeholder="Event details, special requirements..."
                    />
                  </F>
                </div>
              </div>

              {error && (
                <div className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</div>
              )}

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowEventModal(false)} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={eventLoading} className="btn-primary flex-1 bg-indigo-600 hover:bg-indigo-700">
                  {eventLoading ? 'Reserving lodge...' : '🏢 Reserve Entire Lodge'}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}

      {showHistory && historyBooking && (
        <BookingHistoryModal
          booking={historyBooking}
          onClose={() => { setShowHistory(false); setHistoryBooking(null) }}
        />
      )}

      {/* Booking Modal */}
      {showModal && (
        <Modal
          title={editingId ? 'Edit Booking' : 'New Booking'}
          onClose={() => setShowModal(false)}
          size="lg"
        >
          <form onSubmit={handleSave} className="space-y-5">
            {/* Guest Section */}
            {!editingId && (
              <div>
                <div className="mb-3">
                  <p className="text-sm font-semibold text-slate-800">Guest Details</p>
                  <p className="mt-1 text-xs text-slate-500">Choose whether this booking is for a new guest profile or an existing guest already on file.</p>
                </div>
                <div className="flex gap-4 mb-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={useNewCustomer}
                      onChange={() => setUseNewCustomer(true)}
                    />
                    <span className="text-sm font-medium text-slate-700">New Guest</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={!useNewCustomer}
                      onChange={() => setUseNewCustomer(false)}
                    />
                    <span className="text-sm font-medium text-slate-700">Existing Guest</span>
                  </label>
                </div>

                {useNewCustomer ? (
                  <div className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <F label="Full Name *">
                      <input
                        className="input"
                        value={newCustomer.name}
                        onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                        data-testid="booking-new-guest-name-input"
                        placeholder="Guest name"
                      />
                    </F>
                    <F label="Phone">
                      <input
                        className="input"
                        value={newCustomer.phone}
                        onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                        data-testid="booking-new-guest-phone-input"
                        placeholder="+267 ..."
                      />
                    </F>
                    <F label="Email">
                      <input
                        type="email"
                        className="input"
                        value={newCustomer.email}
                        onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                      />
                    </F>
                    <F label="ID / Passport No.">
                      <input
                        className="input"
                        value={newCustomer.id_number}
                        onChange={(e) =>
                          setNewCustomer({ ...newCustomer, id_number: e.target.value })
                        }
                      />
                    </F>
                    <F label="Nationality">
                      <input
                        className="input"
                        value={newCustomer.nationality}
                        onChange={(e) =>
                          setNewCustomer({ ...newCustomer, nationality: e.target.value })
                        }
                      />
                    </F>
                  </div>
                ) : (
                  <div>
                    <F label="Select Guest *">
                      <select
                        className="input"
                        value={form.customer_id}
                        onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
                        required
                      >
                        <option value="">-- Choose guest --</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.is_blacklisted ? '🚫 ' : ''}{c.name} {c.phone ? `(${c.phone})` : ''}
                          </option>
                        ))}
                      </select>
                    </F>
                    {/* Blacklist warning */}
                    {form.customer_id && (() => {
                      const sel = customers.find((c) => c.id === Number(form.customer_id))
                      return sel?.is_blacklisted ? (
                        <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                          ⚠ <strong>Blacklisted guest.</strong>
                          {sel.blacklist_reason ? ` Reason: ${sel.blacklist_reason}` : ''}
                        </div>
                      ) : null
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* Room & Dates */}
            <div>
              <div className="mb-3">
                <p className="text-sm font-semibold text-slate-800">Stay Details</p>
                <p className="mt-1 text-xs text-slate-500">Select the room and stay dates first so the estimated total and deposit guidance stay accurate.</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
              <F label="Room *">
                <select
                  className="input"
                  value={form.room_id}
                  onChange={(e) => setForm({ ...form, room_id: e.target.value })}
                  data-testid="booking-room-select"
                  required
                >
                  <option value="">-- Select room --</option>
                  {selectableRooms.map((r) => (
                      <option key={r.id} value={r.id} disabled={r.status === 'maintenance'}>
                        Room {r.room_number} — {r.room_type} ({currency}{r.rate_per_night}/night) {r.status === 'maintenance' ? ' (UNDER MAINTENANCE)' : ''}
                      </option>
                    ))}
                </select>
              </F>
              <F label="Adults">
                <input
                  type="number"
                  min="1"
                  max={selectedRoom?.max_occupancy || 20}
                  className="input"
                  value={form.adults}
                  onChange={(e) => setForm({ ...form, adults: e.target.value })}
                />
              </F>
              <F label="Check In *">
                <input
                  type="date"
                  className="input"
                  value={form.check_in}
                  onChange={(e) => setForm({ ...form, check_in: e.target.value })}
                  data-testid="booking-check-in-input"
                  required
                />
              </F>
              <F label="Check Out *">
                <input
                  type="date"
                  className="input"
                  value={form.check_out}
                  min={form.check_in}
                  onChange={(e) => setForm({ ...form, check_out: e.target.value })}
                  data-testid="booking-check-out-input"
                  required
                />
              </F>
              <F label="Children">
                <input
                  type="number"
                  min="0"
                  max={selectedRoom?.max_occupancy || 20}
                  className="input"
                  value={form.children}
                  onChange={(e) => setForm({ ...form, children: e.target.value })}
                />
              </F>
              </div>
            </div>

            {/* Estimated Total */}
            {estimatedTotal > 0 && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
                <span className="text-slate-600">
                  {nights(form.check_in, form.check_out)} night(s) × {currency}{' '}
                  {Number(selectedNightlyRate || 0).toFixed(2)} ={' '}
                </span>
                <span className="font-bold text-green-700">{currency} {estimatedTotal.toFixed(2)}</span>
                {applicableRate && selectedRoom && Number(applicableRate.rate_per_night) !== Number(selectedRoom.rate_per_night) && (
                  <p className="mt-1 text-xs font-medium text-emerald-700">
                    Seasonal/Event pricing applied: {applicableRate.name || 'Override'} instead of the standard {currency} {Number(selectedRoom.rate_per_night || 0).toFixed(2)}/night.
                  </p>
                )}
                <p className="mt-1 text-xs text-emerald-700/80">Estimated total before any future extra charges, refunds, or manual adjustments.</p>
              </div>
            )}

            {/* Deposit — only for new bookings */}
            {!editingId && estimatedTotal > 0 && (
              <div>
                <div className="mb-3">
                  <p className="text-sm font-semibold text-slate-800">Deposit</p>
                  <p className="mt-1 text-xs text-slate-500">Use this only if money is actually received now. If not, leave the deposit blank and record payment later.</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                <F label={`Deposit / Advance (${currency}) — optional`}>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    max={estimatedTotal}
                    className="input"
                    value={form.deposit_amount}
                    onChange={(e) => setForm({ ...form, deposit_amount: e.target.value })}
                    placeholder="0.00 — leave blank if none"
                  />
                  <p className="mt-1.5 text-xs text-slate-500">Any deposit recorded here will reduce the guest’s outstanding balance immediately.</p>
                </F>
                {Number(form.deposit_amount) > 0 && (
                  <F label="Deposit Payment Method">
                    <select
                      className="input"
                      value={form.payment_method || 'cash'}
                      onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
                    >
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                    <p className="mt-1.5 text-xs text-slate-500">Choose how the deposit was received so the booking ledger stays clear. Bank transfer deposits require POP.</p>
                  </F>
                )}
                </div>
              </div>
            )}

            <F label="Notes">
              <textarea
                className="input resize-none"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Special requests, notes..."
              />
            </F>

            {error && (
              <div className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</div>
            )}

            {modalWarning && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
                ⚠️ Booking saved — deposit not recorded: {modalWarning}. Please record the deposit manually before closing.
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1">
                Cancel
              </button>
              <button type="submit" disabled={loading} className="btn-primary flex-1">
                {loading ? 'Saving...' : editingId ? 'Save Changes' : 'Create Booking'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <UsageUpgradePrompt
        open={showUpgradePrompt}
        onClose={() => setShowUpgradePrompt(false)}
        onUpgrade={() => {
          setShowUpgradePrompt(false)
          navigate('/settings', { state: { activeTab: 'license' } })
        }}
        resourceLabel="Bookings"
        currentPlan={usageSnapshot?.plan || access?.entitlement?.plan || 'Starter'}
        used={usageSnapshot?.usage?.monthlyBookings ?? thisMonthBookings}
        limit={usageLimits.monthlyBookings}
        grace={usageLimits.monthlyBookingsGrace}
        status={bookingLimitStatus}
        message={usageSnapshot?.warning || 'Monthly booking creation is restricted for this lodge right now.'}
        usage={usageSnapshot?.usage}
        recommendation={usageSnapshot?.recommendation}
        lodgeName={settings?.lodge_name || settings?.company_name || ''}
        lodgeId={settings?.lodge_id || ''}
      />
    </div>
  )
}

function F({ label, children }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
      {children}
    </div>
  )
}

function BookingHistoryModal({ booking, onClose }) {
  const { settings } = useSettings()
  const [charges, setCharges] = useState([])
  const [chargesUnavailable, setChargesUnavailable] = useState(false)
  const [payments, setPayments] = useState([])
  const bookingId = booking.id || booking.booking_id

  useEffect(() => {
    if (!bookingId) return
    window.api.charges.getByBooking(bookingId).then((result) => {
      const normalized = normalizeChargesResponse(result)
      setCharges(normalized.items)
      setChargesUnavailable(normalized.unavailable)
    }).catch(() => {
      setCharges([])
      setChargesUnavailable(true)
    })
    window.api.bookings.getPayments(bookingId).then((data) => setPayments(Array.isArray(data) ? data : [])).catch(() => {})
  }, [bookingId])

  const currency = settings?.currency || 'P'
  const nights = Math.max(0, Math.ceil((new Date(booking.check_out) - new Date(booking.check_in)) / (1000 * 60 * 60 * 24)))

  const events = useMemo(() => {
    const list = []
    if (booking.created_at) {
      list.push({
        at: booking.created_at,
        tone: 'bg-slate-100 text-slate-700',
        title: 'Booking created',
        detail: `${booking.customer_name || 'Guest'} added.`
      })
    }
    list.push({
      at: booking.check_in,
      tone: 'bg-blue-100 text-blue-700',
      title: 'Stay scheduled',
      detail: `${booking.check_in} to ${booking.check_out} · ${nights} night${nights !== 1 ? 's' : ''}`
    })
    charges.forEach(c => {
      list.push({
        at: c.created_at || c.date || booking.created_at,
        tone: 'bg-amber-100 text-amber-700',
        title: 'Extra charge',
        detail: `${c.description} · ${currency} ${Number(c.amount || 0).toFixed(2)}`
      })
    })
    payments.forEach(p => {
      const amount = Math.abs(Number(p.amount || 0))
      list.push({
        at: p.paid_at || p.created_at || booking.created_at,
        tone: p.type === 'refund' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700',
        title: p.type === 'refund' ? 'Refund recorded' : 'Payment recorded',
        detail: `${currency} ${amount.toFixed(2)} via ${String(p.method || 'cash').replace(/_/g, ' ')}`
      })
    })
    if (booking.status === 'checked_in' || booking.status === 'checked_out') {
      list.push({
        at: booking.updated_at || booking.check_in,
        tone: booking.status === 'checked_out' ? 'bg-slate-100 text-slate-700' : 'bg-emerald-100 text-emerald-700',
        title: booking.status === 'checked_out' ? 'Checked out' : 'Checked in',
        detail: booking.status === 'checked_out' ? 'Booking closed.' : 'Guest is currently in house.'
      })
    }
    return list.sort((a, b) => new Date(b.at) - new Date(a.at))
  }, [booking, charges, payments, currency, nights])

  return (
    <Modal title={`Booking Activity · ${booking.invoice_number || booking._local_invoice_number || 'Draft'}`} onClose={onClose} size="sm">
      <div className="space-y-4">
        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="font-bold text-slate-800">{booking.customer_name}</p>
          <p className="text-xs text-slate-500 mt-1">{booking.room_number ? `Room ${booking.room_number}` : 'Multiple Rooms'} · {booking.check_in} to {booking.check_out}</p>
        </div>
        <div className="space-y-3">
          {chargesUnavailable && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Charges unavailable offline
            </div>
          )}
          {events.map((e, i) => (
            <div key={i} className="flex gap-3">
              <div className={`mt-0.5 h-2 w-2 rounded-full ${e.tone.split(' ')[0]}`} />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-slate-800">{e.title}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${e.tone}`}>
                    {new Date(e.at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{e.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

function BookingMenu({ b, isOpen, onToggle, onClose, onCheckIn, onCheckOut, onCancel, onEdit, onPayment, onExtras, onReceipt, onHistory, settings }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!isOpen) return
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen, onClose])

  const phone = formatWhatsAppPhone(b.customer_phone)
  const msg = buildWhatsAppMessage(b, settings)
  const outstanding = bookingOutstandingAmount(b)

  return (
    <>
      <style>{`
        @keyframes borokoFadeScale {
          from { opacity: 0; transform: scale(0.95); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
      <div ref={ref} className="relative inline-block">
        <button
          onClick={onToggle}
          data-testid={`booking-menu-toggle-${b.id}`}
          className="cursor-pointer rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
        >
          <MoreVertical size={15} />
        </button>

        {isOpen && (
          <div
            className="absolute right-0 z-50 mt-1 w-56 origin-top-right rounded-2xl border border-slate-200 bg-white py-2 text-sm shadow-[0_18px_40px_rgba(15,23,42,0.16)]"
            style={{ animation: 'borokoFadeScale 120ms ease-out' }}
          >

          {/* Booking actions */}
          {b.status === 'confirmed' && (
            <>
              <MenuItem onClick={() => { onEdit(); onClose() }}>
                ✏️ Edit Booking
              </MenuItem>
              <MenuItem
                onClick={() => { onCheckIn(); onClose() }}
                disabled={b.check_in > today()}
                title={b.check_in > today() ? `Check-in date is ${b.check_in}` : undefined}
                color="green"
              >
                ✅ Check In
              </MenuItem>
              <MenuItem onClick={() => { onCancel(); onClose() }} color="red">
                ✖ Cancel Booking
              </MenuItem>
            </>
          )}
          {b.status === 'checked_in' && (
            <MenuItem
              onClick={() => { onCheckOut(); onClose() }}
              disabled={outstanding > 0}
              title={outstanding > 0 ? `Settle the outstanding balance first: ${outstanding.toFixed(2)}` : undefined}
              color="blue"
            >
              🏁 Check Out
            </MenuItem>
          )}

          <Divider />

          {/* Payment actions */}
          {b.payment_status !== 'paid' && b.status !== 'cancelled' && (
            <MenuItem onClick={() => { onPayment(); onClose() }} color="primary">
              💰 Add Payment
            </MenuItem>
          )}
          <MenuItem onClick={() => { onExtras(); onClose() }}>
            🧾 Add Extras
          </MenuItem>

          <Divider />

          {/* Documents */}
          <MenuItem onClick={() => { onReceipt(); onClose() }}>
            📄 View Receipt
          </MenuItem>
          <MenuItem onClick={() => { onHistory(); onClose() }}>
            📋 View History
          </MenuItem>

          {/* Communication */}
          {(b.customer_phone && b.status !== 'cancelled') || (b.customer_email && b.status !== 'cancelled') ? (
            <Divider />
          ) : null}
          {b.customer_phone && b.status !== 'cancelled' && (
            <MenuItem
              color="whatsapp"
              onClick={() => {
                window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank')
                onClose()
              }}
            >
              💬 WhatsApp
            </MenuItem>
          )}
          {b.customer_email && b.status !== 'cancelled' && (
            <MenuItem
              color="blue"
              onClick={() => {
                const lodge = settings?.lodge_name || 'the Lodge'
                const subject = `Booking Confirmation — ${lodge}`
                window.api.shell.openExternal(
                  `mailto:${b.customer_email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(msg)}`
                )
                onClose()
              }}
            >
              ✉️ Email Guest
            </MenuItem>
          )}
          </div>
        )}
      </div>
    </>
  )
}

function MenuItem({ children, onClick, disabled, title, color }) {
  const colors = {
    default:  'text-slate-700 hover:bg-slate-50',
    green:    'text-green-600 hover:bg-green-50',
    blue:     'text-blue-600 hover:bg-blue-50',
    red:      'text-red-500 hover:bg-red-50',
    primary:  'text-blue-700 font-semibold hover:bg-blue-50',
    whatsapp: 'text-[#25D366] font-medium hover:bg-green-50',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`w-full text-left px-3.5 py-2 text-sm transition-colors
        ${disabled ? 'opacity-40 cursor-not-allowed text-slate-400' : `cursor-pointer ${colors[color] || colors.default}`}`}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <div className="my-1 border-t border-slate-100" />
}

function ActionBtn({ label, color, onClick, disabled, title }) {
  const colors = {
    green: 'text-green-600 hover:bg-green-50',
    blue: 'text-blue-600 hover:bg-blue-50',
    red: 'text-red-500 hover:bg-red-50',
    gray: 'text-gray-500 hover:bg-gray-100',
    yellow: 'text-amber-600 hover:bg-amber-50'
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`text-xs px-2 py-1 rounded transition-colors ${disabled ? 'opacity-40 cursor-not-allowed' : colors[color]}`}
    >
      {label}
    </button>
  )
}

function PaymentBadge({ status }) {
  const styles = {
    paid: 'border-green-200 bg-green-50 text-green-700',
    partial: 'border-yellow-200 bg-yellow-50 text-yellow-700',
    unpaid: 'border-red-200 bg-red-50 text-red-600'
  }
  const labels = {
    paid: '✅ Paid',
    partial: '⚡ Partial',
    unpaid: '❌ Unpaid'
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${styles[status] || styles.unpaid}`}>
      {labels[status] || '❌ Unpaid'}
    </span>
  )
}

function today() {
  return new Date().toISOString().split('T')[0]
}
function tomorrow() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}
