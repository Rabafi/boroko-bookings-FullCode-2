// @ts-check
import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Presentation, Plus, Pencil, Trash2, X, Users, Clock, Calendar, ChevronDown, ChevronUp, CreditCard, Building2 } from 'lucide-react'
import { PAYMENT_METHOD_PLAIN_OPTIONS } from '../constants/paymentMethods'
import { useSettings } from '../app-context'
import { localToday } from '../utils/localDate'
import { ErrorNotice } from './shared/ErrorNotice'

/** Expected consumer views of existing event/conference IPC and SQL producers. These types do not validate returned JSON or cache rows. */
/** @typedef {{id: string, booking_date: string, start_time: string, end_time: string, client_name: string, total_amount: number|null, deposit_paid: number|null, payment_status: string|null, event_name?: string|null, company?: string|null, event_type?: string|null, reservation_scope?: string|null, status?: string|null, attendees?: number|null, adults?: number|null, children?: number|null, amount_paid?: number|null, setup_type?: string|null, room_name?: string|null, includes_catering?: boolean|null, catering_notes?: string|null, payment_method?: string|null, currency?: string|null, notes?: string|null, extras_total?: number|null, check_in?: string|null, check_out?: string|null, room_ids?: string[]|null, customer_id?: string|null, customer_name?: string|null, exclusive_booking_id?: string|null, event_daily_rate?: number|string|null}} ConferenceBookingExpectedView */
/** @typedef {{booking_date: string, start_time: string, end_time: string, client_name: string, company: string, event_name: string, customer_id: string, event_type: string, reservation_scope: string, check_in: string, check_out: string, room_ids: string[], resource_keys: string[], status: string, attendees: string, adults: string, children: string, setup_type: string, room_name: string, includes_catering: boolean, catering_notes: string, total_amount: string, event_daily_rate: string, deposit_paid: string, deposit_amount: string, payment_status: string, payment_method: string, currency: string, notes: string}} ConferenceFormExpectedView */
/** @typedef {{id: string, name: string, phone?: string|null, email?: string|null}} ConferenceCustomerExpectedView */
/** @typedef {{key: string, name: string, type?: string|null, allows_shared_use?: boolean, default_price?: number|string|null}} VenueResourceExpectedView */
/** @typedef {{id: string, status: string|null, room_number: string|number}} ConferenceRoomExpectedView */
/** @typedef {{id: string, event_booking_id: string, line_type: string, description: string, quantity: number|string, unit_price: number|string, voided_at?: string|null}} EventLineExpectedView */
/** @typedef {{id: string, resource_key?: string|null, resource_name_snapshot: string}} EventResourceExpectedView */
/** @typedef {{booking_id: string, room_id?: string|null, room_number: string|number|null, check_in: string, check_out: string, total_amount: number|string|null}} EventRoomExpectedView */
/** @typedef {{id: string, type?: string|null, amount: number|string|null, method: string}} EventPaymentExpectedView */
/** @typedef {{line_items: EventLineExpectedView[], resources: EventResourceExpectedView[], rooms: EventRoomExpectedView[], payments: EventPaymentExpectedView[]}} EventDetailsExpectedView */
/** @typedef {{description: string, quantity: number|string, unit_price: number|string}} EventExtraDraftExpectedView */
/** @typedef {{amount: string, method: string}} EventPaymentFormExpectedView */

const EVENT_TYPES = [
  { value: 'conference', label: 'Conference' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'party', label: 'Party' },
  { value: 'wedding', label: 'Wedding' },
  { value: 'corporate', label: 'Corporate' },
  { value: 'pool_party', label: 'Pool Party' },
  { value: 'braai', label: 'Braai' },
  { value: 'reception', label: 'Reception' },
  { value: 'other', label: 'Other' }
]
const RESERVATION_SCOPES = [
  { value: 'venue_only', label: 'Venue Only' },
  { value: 'venue_with_rooms', label: 'Venue + Rooms' },
  { value: 'exclusive_lodge', label: 'Entire Lodge' }
]
const EVENT_STATUSES = ['draft', 'reserved', 'confirmed', 'active', 'completed', 'cancelled']
const PAYMENT_METHODS = PAYMENT_METHOD_PLAIN_OPTIONS

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-600',
  reserved: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-indigo-100 text-indigo-800',
  active: 'bg-green-100 text-green-800',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-800',
  pending: 'bg-yellow-100 text-yellow-800',
  deposit_paid: 'bg-blue-100 text-blue-800',
  paid: 'bg-green-100 text-green-800',
  unpaid: 'bg-gray-100 text-gray-600',
  partial: 'bg-amber-100 text-amber-800'
}
const STATUS_LABELS = {
  draft: 'Draft', reserved: 'Reserved', confirmed: 'Confirmed', active: 'Active',
  completed: 'Completed', cancelled: 'Cancelled',
  pending: 'Pending', deposit_paid: 'Deposit Paid', paid: 'Paid', unpaid: 'Unpaid', partial: 'Partial'
}
const EVENT_TYPE_LABELS = Object.fromEntries(EVENT_TYPES.map((e) => [e.value, e.label]))
const SCOPE_LABELS = Object.fromEntries(RESERVATION_SCOPES.map((s) => [s.value, s.label]))
const SCOPE_COLORS = {
  venue_only: 'bg-purple-100 text-purple-700',
  venue_with_rooms: 'bg-teal-100 text-teal-700',
  exclusive_lodge: 'bg-amber-100 text-amber-700'
}

const empty = () => ({
  booking_date: localToday(),
  start_time: '08:00',
  end_time: '17:00',
  client_name: '',
  company: '',
  event_name: '',
  customer_id: '',
  event_type: 'conference',
  reservation_scope: 'venue_only',
  check_in: localToday(),
  check_out: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  room_ids: [],
  resource_keys: [],
  status: 'reserved',
  attendees: '',
  adults: '',
  children: '',
  setup_type: 'Theatre',
  room_name: 'Conference Room',
  includes_catering: false,
  catering_notes: '',
  total_amount: '',
  event_daily_rate: '',
  deposit_paid: '',
  deposit_amount: '',
  payment_status: 'pending',
  payment_method: '',
  currency: 'BWP',
  notes: ''
})

/** @param {string|null|undefined} start @param {string|null|undefined} end */
function duration(start, end) {
  if (!start || !end) return ''
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const mins = (eh * 60 + em) - (sh * 60 + sm)
  if (mins <= 0) return ''
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`
}

export default function Conference() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const navigate = useNavigate()
  const location = useLocation()

  const [bookings, setBookings] = useState(/** @type {ConferenceBookingExpectedView[]} */ ([]))
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(/** @type {ConferenceBookingExpectedView|null} */ (null))
  const [form, setForm] = useState(empty())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [filterDate, setFilterDate] = useState('')
  const [deleting, setDeleting] = useState(null)
  const [payBooking, setPayBooking] = useState(/** @type {ConferenceBookingExpectedView|null} */ (null))
  const [payForm, setPayForm] = useState(/** @type {EventPaymentFormExpectedView} */ ({ amount: '', method: 'cash' }))
  const [paySaving, setPaySaving] = useState(false)
  const [payError, setPayError] = useState('')
  const [pendingPaymentIntent, setPendingPaymentIntent] = useState(false)
  const [rooms, setRooms] = useState(/** @type {ConferenceRoomExpectedView[]} */ ([]))
  const [venueResources, setVenueResources] = useState(/** @type {VenueResourceExpectedView[]} */ ([]))
  const [customers, setCustomers] = useState(/** @type {ConferenceCustomerExpectedView[]} */ ([]))
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '' })
  const [customerSaving, setCustomerSaving] = useState(false)
  const [operationId, setOperationId] = useState('')
  const createIntentConsumed = useRef(false)
  const paymentIntentRef = useRef(/** @type {{eventId: string, amount: string, method: string, type: string, key: string, pending: boolean}} */ ({ eventId: '', amount: '', method: '', type: 'payment', key: '', pending: false }))
  const [detailsById, setDetailsById] = useState(/** @type {Record<string, EventDetailsExpectedView|null>} */ ({}))
  const [detailsLoadingId, setDetailsLoadingId] = useState(null)
  const [extraDrafts, setExtraDrafts] = useState(/** @type {Record<string, EventExtraDraftExpectedView>} */ ({}))
  const [folioError, setFolioError] = useState('')

  const load = async () => {
    setLoading(true)
    const start = filterDate || undefined
    const end = filterDate || undefined
    const data = await window.api.events.getAll(start, end).catch(() =>
      window.api.conference.getAll(start, end).catch(() => [])
    )
    // Both handlers return the query result array or the existing [] fallback.
    setBookings(/** @type {ConferenceBookingExpectedView[]} */ (data))
    setLoading(false)
  }

  useEffect(() => { load() }, [filterDate])

  useEffect(() => {
    window.api.rooms.getAll().then((rows) => setRooms(Array.isArray(rows) ? /** @type {ConferenceRoomExpectedView[]} */ (rows) : [])).catch(() => setRooms([]))
    window.api.customers.getAll().then((rows) => setCustomers(Array.isArray(rows) ? /** @type {ConferenceCustomerExpectedView[]} */ (rows) : [])).catch(() => setCustomers([]))
    window.api.dayuse.getConfig().then((config) => {
      setVenueResources(Array.isArray(config?.resources) ? /** @type {VenueResourceExpectedView[]} */ (config.resources) : [])
    }).catch(() => setVenueResources([]))
  }, [])

  // A Bookings-originated "Event / Lodge Booking" action carries a one-shot
  // intent. Consume it exactly once, clear it from history state, and open the
  // single authoritative create form. Back/refresh/return-from-payment can
  // never re-open the dialog or re-submit a record.
  useEffect(() => {
    const intent = /** @type {{createEventIntent?: {scope?: string, source?: string, requestedAt?: number}}|undefined} */ (location.state)
      ?.createEventIntent
    if (!intent || createIntentConsumed.current) return
    createIntentConsumed.current = true
    const next = empty()
    next.reservation_scope = intent.scope === 'exclusive_lodge' ? 'exclusive_lodge' : 'venue_only'
    next.booking_date = localToday()
    next.check_in = localToday()
    next.check_out = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    setEditing(null)
    setForm(next)
    setOperationId(crypto.randomUUID())
    setError('')
    setShowForm(true)
    navigate(location.pathname, { replace: true, state: {} })
  }, [location.state, location.pathname, navigate])

  useEffect(() => {
    const targetId = location.state?.collectPaymentBookingId
    if (!targetId || !bookings.length) return
    const booking = bookings.find((b) => b.id === targetId)
    if (booking) {
      const outstanding = Math.max(0, (booking.total_amount || 0) - (booking.deposit_paid || 0))
      if (outstanding > 0) openPayment(booking)
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [bookings, location.state])

  /** @template {keyof ConferenceFormExpectedView} K @param {K} f @param {ConferenceFormExpectedView[K]} v */
  const set = (f, v) => setForm((prev) => ({ ...prev, [f]: v }))

  /** @param {ConferenceBookingExpectedView} booking */
  const toggleDetails = async (booking) => {
    if (expandedId === booking.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(booking.id)
    setFolioError('')
    if (detailsById[booking.id]) return
    setDetailsLoadingId(booking.id)
    try {
      const details = /** @type {EventDetailsExpectedView|null} */ (await window.api.events.getDetails(booking.id))
      setDetailsById((prev) => ({ ...prev, [booking.id]: details }))
    } catch (err) {
      setFolioError(err?.message || 'Could not load the event folio.')
    } finally {
      setDetailsLoadingId(null)
    }
  }

  /** @param {string} eventId */
  const refreshDetails = async (eventId) => {
    const details = /** @type {EventDetailsExpectedView|null} */ (await window.api.events.getDetails(eventId))
    setDetailsById((prev) => ({ ...prev, [eventId]: details }))
    await load()
  }

  /** @param {string} eventId */
  const addExtra = async (eventId) => {
    const draft = extraDrafts[eventId] || /** @type {EventExtraDraftExpectedView} */ ({})
    const description = String(draft.description || '').trim()
    const quantity = Number(draft.quantity || 1)
    const unitPrice = Number(draft.unit_price || 0)
    if (!description) { setFolioError('Enter an extra description.'); return }
    if (quantity <= 0 || unitPrice < 0) { setFolioError('Enter a valid quantity and price.'); return }
    setFolioError('')
    try {
      await window.api.events.addLineItem({
        event_booking_id: eventId,
        line_type: 'manual',
        description,
        category: 'event_extra',
        quantity,
        unit_price: unitPrice,
        idempotency_key: `event-extra-${eventId}-${crypto.randomUUID()}`
      })
      setExtraDrafts((prev) => ({ ...prev, [eventId]: { description: '', quantity: 1, unit_price: '' } }))
      await refreshDetails(eventId)
    } catch (err) {
      setFolioError(err?.message || 'Could not add the extra.')
    }
  }

  /** @param {string} eventId @param {EventLineExpectedView} lineItem */
  const voidExtra = async (eventId, lineItem) => {
    const reason = window.prompt(`Reason for voiding "${lineItem.description}"?`)
    if (!reason?.trim()) return
    setFolioError('')
    try {
      await window.api.events.voidLineItem(lineItem.id, reason.trim())
      await refreshDetails(eventId)
    } catch (err) {
      setFolioError(err?.message || 'Could not void the extra.')
    }
  }

  const openCreate = () => {
    setEditing(null)
    setForm(empty())
    setOperationId(crypto.randomUUID())
    setNewCustomer({ name: '', phone: '', email: '' })
    setError('')
    setShowForm(true)
  }

  /** @param {ConferenceBookingExpectedView} b */
  const openEdit = async (b) => {
    setDetailsLoadingId(b.id)
    setError('')
    try {
      const details = /** @type {{event?: ConferenceBookingExpectedView, rooms?: EventRoomExpectedView[], resources?: EventResourceExpectedView[]}} */ (
        await window.api.events.getDetails(b.id)
      )
      const event = details?.event || b
      const eventRooms = Array.isArray(details?.rooms) ? details.rooms : []
      const roomIds = eventRooms.map((room) => room.room_id).filter(Boolean)
      if (event.reservation_scope === 'venue_with_rooms' && roomIds.length === 0) {
        throw new Error('Room assignment details are unavailable. Refresh while online before editing this event.')
      }
      const datesIn = eventRooms.map((room) => room.check_in).filter(Boolean).sort()
      const datesOut = eventRooms.map((room) => room.check_out).filter(Boolean).sort()
      if (event.reservation_scope === 'exclusive_lodge' && (!datesIn.length || !datesOut.length)) {
        throw new Error('Whole-lodge dates are unavailable. Refresh while online before editing this event.')
      }
      setEditing(event)
      setForm({
        booking_date: event.booking_date,
        start_time: event.start_time,
        end_time: event.end_time,
        client_name: event.client_name,
        company: event.company || '',
        event_name: event.event_name || event.client_name || '',
        customer_id: event.customer_id || '',
        event_type: event.event_type || 'conference',
        reservation_scope: event.reservation_scope || 'venue_only',
        check_in: datesIn[0] || event.check_in || event.booking_date,
        check_out: datesOut[datesOut.length - 1] || event.check_out || event.booking_date,
        room_ids: event.reservation_scope === 'venue_with_rooms' ? roomIds : [],
        resource_keys: (details.resources || []).map((resource) => resource.resource_key).filter(Boolean),
        status: event.status || 'reserved',
        attendees: String(event.attendees || ''),
        adults: String(event.adults || ''),
        children: String(event.children || ''),
        setup_type: event.setup_type || 'Theatre',
        room_name: event.room_name || 'Conference Room',
        includes_catering: event.includes_catering || false,
        catering_notes: event.catering_notes || '',
        total_amount: String(event.total_amount || ''),
        event_daily_rate: String(event.event_daily_rate || ''),
        deposit_paid: String(event.deposit_paid || event.amount_paid || ''),
        deposit_amount: '',
        payment_status: event.payment_status || 'pending',
        payment_method: event.payment_method || '',
        currency: event.currency || 'BWP',
        notes: event.notes || ''
      })
      setShowForm(true)
    } catch (err) {
      setError(err?.message || 'Could not load authoritative event assignment details.')
    } finally {
      setDetailsLoadingId(null)
    }
  }

  /**
   * Resolve one scoped customer for the reservation. Prefer an explicit
   * selection, then an exact known customer, and only then create a new
   * customer through the authoritative IPC contract. A display name alone is
   * never used to merge two different customers.
   * @param {string} name
   * @returns {Promise<string|null>}
   */
  const resolveCustomerId = async (name) => {
    if (form.customer_id) return form.customer_id
    const trimmed = name.trim()
    if (!trimmed) return null
    const exactMatches = customers.filter((customer) => String(customer.name || '').trim().toLowerCase() === trimmed.toLowerCase())
    if (exactMatches.length > 0) {
      throw new Error(exactMatches.length === 1
        ? 'Select the matching customer record above so the reservation links to the verified customer.'
        : 'Several customers have this name. Select the correct customer record above before saving.')
    }
    setCustomerSaving(true)
    try {
      const created = await window.api.customers.create({
        name: trimmed,
        phone: (newCustomer.phone || '').trim(),
        email: (newCustomer.email || '').trim()
      })
      if (created?.success === false) throw new Error(created.error || 'Could not create customer')
      const id = created?.id || created?.customer?.id || null
      if (id) {
        setCustomers((prev) => [...prev, { id, name: trimmed, phone: newCustomer.phone, email: newCustomer.email }])
      }
      return id
    } finally {
      setCustomerSaving(false)
    }
  }

  /** @param {import('react').FormEvent<HTMLFormElement>} e */
  const handleSave = async (e) => {
    e.preventDefault()
    const customerName = form.client_name.trim()
    const eventName = form.event_name.trim() || customerName
    if (!customerName) { setError('Customer / client name is required'); return }
    if (!eventName) { setError('Event or group name is required'); return }
    if (!form.booking_date) { setError('Date is required'); return }
    if (!form.start_time || !form.end_time) { setError('Start and end time are required'); return }
    if (form.reservation_scope !== 'venue_only' && (!form.check_in || !form.check_out || form.check_out <= form.check_in)) {
      setError('Valid room check-in and check-out dates are required')
      return
    }
    if (form.reservation_scope === 'venue_with_rooms' && form.room_ids.length === 0) {
      setError('Select at least one guest room')
      return
    }
    setSaving(true)
    setError('')
    try {
      const customerId = await resolveCustomerId(customerName)
      const hasNewFields = form.event_type || form.reservation_scope || form.event_name
      const payload = {
        ...form,
        booking_date: form.reservation_scope === 'venue_only' ? form.booking_date : form.check_in,
        event_name: eventName,
        client_name: customerName,
        customer_id: customerId,
        operation_id: editing ? undefined : operationId || crypto.randomUUID(),
        company: null,
        setup_type: 'Default',
        room_name: null,
        attendees: Number(form.attendees) || 0,
        adults: Number(form.adults) || Number(form.attendees) || 0,
        children: Number(form.children) || 0,
        total_amount: form.reservation_scope === 'exclusive_lodge'
          ? Math.round((Number(form.event_daily_rate || 0) * Math.max(0, (new Date(`${form.check_out}T00:00:00`).getTime() - new Date(`${form.check_in}T00:00:00`).getTime()) / 86400000)) * 100) / 100
          : parseFloat(form.total_amount) || 0,
        event_daily_rate: form.reservation_scope === 'exclusive_lodge' ? Number(form.event_daily_rate || 0) : null,
        deposit_paid: parseFloat(form.deposit_paid) || 0,
        deposit_amount: parseFloat(form.deposit_amount) || parseFloat(form.deposit_paid) || 0,
        resources: venueResources
          .filter((resource) => form.resource_keys.includes(resource.key))
          .map((resource) => ({
            resource_key: resource.key,
            resource_name: resource.name,
            resource_type: resource.type || 'venue',
            exclusive_use: resource.allows_shared_use !== true,
            quantity: 1,
            unit_price: Number(resource.default_price || 0)
          }))
      }
      if (editing) {
        if (hasNewFields) {
          await window.api.events.update(editing.id, payload)
        } else {
          await window.api.conference.update(editing.id, payload)
        }
      } else {
        if (hasNewFields) {
          await window.api.events.create(payload)
        } else {
          await window.api.conference.create(payload)
        }
      }
      setShowForm(false)
      load()
    } catch (err) {
      setError(err.message || 'Failed to save booking')
    }
    setSaving(false)
  }

  /** @param {string} id */
  const handleDelete = async (id) => {
    if (!window.confirm('Delete this event booking?')) return
    setDeleting(id)
    await window.api.events.cancel(id, 'Deleted by user', true).catch(() =>
      window.api.conference.delete(id).catch(() => {})
    )
    setDeleting(null)
    load()
  }

  /** @param {ConferenceBookingExpectedView} booking */
  const openPayment = async (booking) => {
    const paid = booking.amount_paid || booking.deposit_paid || 0
    const outstanding = Math.max(0, (booking.total_amount || 0) - paid)
    setPayBooking(booking)
    setPayForm({ amount: String(outstanding), method: booking.payment_method || 'cash' })
    paymentIntentRef.current = { eventId: '', amount: '', method: '', type: 'payment', key: '', pending: false }
    setPendingPaymentIntent(false)
    setPayError('')
    const pending = await window.api.events.getPendingPaymentIntent(booking.id).catch(() => null)
    if (pending?.pending && pending.idempotency_key) {
      const amount = Number(pending.amount).toFixed(2)
      paymentIntentRef.current = {
        eventId: booking.id,
        amount,
        method: pending.method,
        type: pending.type || 'payment',
        key: pending.idempotency_key,
        pending: true
      }
      setPayForm({ amount, method: pending.method })
      setPendingPaymentIntent(true)
    }
  }

  const closePaymentModal = () => {
    setPayBooking(null)
    setPayForm({ amount: '', method: 'cash' })
    paymentIntentRef.current = { eventId: '', amount: '', method: '', type: 'payment', key: '', pending: false }
    setPendingPaymentIntent(false)
    setPayError('')
  }

  /** @param {import('react').FormEvent<HTMLFormElement>} e */
  const handlePaymentSave = async (e) => {
    e.preventDefault()
    const amount = parseFloat(payForm.amount) || 0
    if (amount <= 0) { setPayError('Enter a valid amount'); return }
    const outstanding = Math.max(0, (payBooking.total_amount || 0) - (payBooking.amount_paid || payBooking.deposit_paid || 0))
    if (amount > outstanding) { setPayError(`Maximum payment is ${currency} ${outstanding.toFixed(2)}`); return }
    setPaySaving(true)
    setPayError('')
    try {
      // Retry the exact same operation key while the event/amount payload is
      // unchanged; a different amount is a different request and gets a new key.
      const amountKey = amount.toFixed(2)
      const intent = paymentIntentRef.current
      const sameEnvelope = intent.eventId === payBooking.id
        && intent.amount === amountKey
        && intent.method === payForm.method
        && intent.type === 'payment'
        && intent.key
      if (intent.pending && !sameEnvelope) {
        throw new Error('This payment has an uncertain result. Retry the original amount and method after sync; do not change it or start another payment yet.')
      }
      const intentKey = sameEnvelope
        ? intent.key
        : `evt-pay-${payBooking.id}-${crypto.randomUUID()}`
      paymentIntentRef.current = { eventId: payBooking.id, amount: amountKey, method: payForm.method, type: 'payment', key: intentKey, pending: true }
      setPendingPaymentIntent(true)
      const result = await window.api.events.updatePayment(payBooking.id, amount, payForm.method, 'payment', intentKey)
      if (result?.success === false) throw new Error(result.error || 'Payment failed')
      closePaymentModal()
      load()
    } catch (err) {
      setPayError(err.message || 'Payment failed')
    }
    setPaySaving(false)
  }

  const grouped = bookings.reduce((/** @type {Record<string, ConferenceBookingExpectedView[]>} */ acc, b) => {
    const d = b.booking_date
    if (!acc[d]) acc[d] = []
    acc[d].push(b)
    return acc
  }, /** @type {Record<string, ConferenceBookingExpectedView[]>} */ ({}))

  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Presentation size={26} className="text-green-700" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Events & Venues</h1>
            <p className="text-sm text-gray-500">Manage events, conferences, and venue reservations</p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-green-700 hover:bg-green-800 text-white px-4 py-2.5 rounded-lg font-medium text-sm transition-colors"
        >
          <Plus size={16} /> New Event
        </button>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3 mb-5">
        <Calendar size={16} className="text-gray-400" />
        <input
          type="date"
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
        {filterDate && (
          <button onClick={() => setFilterDate('')} className="text-xs text-gray-500 hover:text-gray-700 underline">
            Clear filter
          </button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading...</div>
      ) : bookings.length === 0 ? (
        <div className="text-center py-16">
          <Presentation size={40} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No events found</p>
          <button onClick={openCreate} className="mt-3 text-green-700 text-sm font-medium hover:underline">
            Create your first event
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedDates.map((date) => (
            <div key={date} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
              <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200">
                <p className="text-sm font-semibold text-gray-700">
                  {new Date(date + 'T00:00:00').toLocaleDateString('en-ZA', {
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                  })}
                </p>
              </div>
              <div className="divide-y divide-gray-100">
                {grouped[date].map((b) => (
                  <div key={b.id}>
                    <div className="px-4 py-3 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-gray-900 text-sm">{b.event_name || b.client_name}</p>
                          {b.company && <span className="text-xs text-gray-500">· {b.company}</span>}
                          {b.event_type && b.event_type !== 'conference' && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">
                              {EVENT_TYPE_LABELS[b.event_type] || b.event_type}
                            </span>
                          )}
                          {b.reservation_scope && b.reservation_scope !== 'venue_only' && (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SCOPE_COLORS[b.reservation_scope] || 'bg-gray-100 text-gray-600'}`}>
                              {SCOPE_LABELS[b.reservation_scope] || b.reservation_scope}
                            </span>
                          )}
                          {b.status && b.status !== 'reserved' && (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[b.status] || STATUS_COLORS.pending}`}>
                              {STATUS_LABELS[b.status] || b.status}
                            </span>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[b.payment_status] || ''}`}>
                            {STATUS_LABELS[b.payment_status] || b.payment_status}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-xs text-gray-500 flex-wrap">
                          <span className="flex items-center gap-1">
                            <Clock size={12} />
                            {b.start_time} – {b.end_time}
                            {duration(b.start_time, b.end_time) && (
                              <span className="text-gray-400">({duration(b.start_time, b.end_time)})</span>
                            )}
                          </span>
                          <span className="flex items-center gap-1">
                            <Users size={12} /> {b.adults || b.attendees || 0}{b.children > 0 ? `+${b.children}` : ''} pax
                          </span>
                          <span>{b.setup_type}</span>
                          {b.room_name && b.room_name !== 'Conference Room' && <span>· {b.room_name}</span>}
                          {b.includes_catering && <span className="text-green-600 font-medium">+ Catering</span>}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-bold text-gray-900 text-sm">{currency}{(b.total_amount || 0).toFixed(2)}</p>
                        {(b.amount_paid || b.deposit_paid || 0) > 0 && (
                          <p className="text-xs text-gray-400">Paid: {currency}{(b.amount_paid || b.deposit_paid || 0).toFixed(2)}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 ml-2">
                        <button
                          onClick={() => toggleDetails(b)}
                          className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
                        >
                          {expandedId === b.id ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                        </button>
                        <button onClick={() => openEdit(b)} className="p-1.5 text-gray-400 hover:text-green-700 rounded">
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => handleDelete(b.id)}
                          disabled={deleting === b.id}
                          className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                        >
                          <Trash2 size={15} />
                        </button>
                        {b.payment_status !== 'paid' && (b.total_amount || 0) > 0 && (
                          <button
                            onClick={() => openPayment(b)}
                            className="p-1.5 text-gray-400 hover:text-blue-600 rounded"
                            title={`Collect payment — ${currency} ${Math.max(0, (b.total_amount || 0) - (b.amount_paid || b.deposit_paid || 0)).toFixed(2)} outstanding`}
                          >
                            <CreditCard size={15} />
                          </button>
                        )}
                      </div>
                    </div>
                    {expandedId === b.id && (
                      <div className="px-4 pb-4 bg-gray-50 text-xs text-gray-600 space-y-3 border-t border-gray-100 pt-3">
                        {b.event_type && <p>Event Type: <span className="font-medium">{EVENT_TYPE_LABELS[b.event_type] || b.event_type}</span></p>}
                        {b.reservation_scope && <p>Scope: <span className="font-medium">{SCOPE_LABELS[b.reservation_scope] || b.reservation_scope}</span></p>}
                        {b.status && <p>Status: <span className="font-medium">{STATUS_LABELS[b.status] || b.status}</span></p>}
                        {b.payment_method && <p>Payment Method: <span className="font-medium">{b.payment_method}</span></p>}
                        {(b.total_amount || 0) > 0 && (
                          <p>Outstanding: <span className={`font-medium ${(b.amount_paid || b.deposit_paid || 0) < (b.total_amount || 0) ? 'text-amber-700' : 'text-green-700'}`}>
                            {currency} {Math.max(0, (b.total_amount || 0) - (b.amount_paid || b.deposit_paid || 0)).toFixed(2)}
                          </span></p>
                        )}
                        {b.catering_notes && <p>Catering Notes: <span className="font-medium">{b.catering_notes}</span></p>}
                        {b.notes && <p>Notes: <span className="font-medium">{b.notes}</span></p>}
                        {detailsLoadingId === b.id && <p className="text-gray-400">Loading event folio…</p>}
                        {folioError && <ErrorNotice className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700">{folioError}</ErrorNotice>}
                        {detailsById[b.id] && (() => {
                          const details = detailsById[b.id]
                          const activeLines = (details.line_items || []).filter((line) => !line.voided_at)
                          const extraLines = activeLines.filter((line) => line.line_type !== 'venue')
                          const draft = extraDrafts[b.id] || { description: '', quantity: 1, unit_price: '' }
                          return (
                            <div className="grid gap-3 lg:grid-cols-2">
                              <div className="space-y-3">
                                <div className="rounded-xl border border-purple-200 bg-white p-3">
                                  <p className="font-semibold text-purple-900">Reserved venues</p>
                                  {(details.resources || []).length === 0
                                    ? <p className="mt-1 text-gray-400">No specific venue resources reserved.</p>
                                    : (details.resources || []).map((resource) => <p key={resource.id} className="mt-1">{resource.resource_name_snapshot}</p>)}
                                </div>
                                <div className="rounded-xl border border-teal-200 bg-white p-3">
                                  <p className="font-semibold text-teal-900">Guest rooms</p>
                                  {(details.rooms || []).length === 0
                                    ? <p className="mt-1 text-gray-400">No guest rooms linked.</p>
                                    : (details.rooms || []).map((room) => <p key={room.booking_id} className="mt-1">Room {room.room_number} · {room.check_in} → {room.check_out} · {currency}{Number(room.total_amount || 0).toFixed(2)}</p>)}
                                </div>
                                <div className="rounded-xl border border-blue-200 bg-white p-3">
                                  <p className="font-semibold text-blue-900">Payments</p>
                                  {(details.payments || []).length === 0
                                    ? <p className="mt-1 text-gray-400">No payments recorded.</p>
                                    : (details.payments || []).map((payment) => <p key={payment.id} className="mt-1">{payment.type || 'payment'} · {currency}{Number(payment.amount || 0).toFixed(2)} · {payment.method}</p>)}
                                </div>
                              </div>
                              <div className="rounded-xl border border-amber-200 bg-white p-3">
                                <div className="flex items-center justify-between">
                                  <p className="font-semibold text-amber-900">Event folio extras</p>
                                  <span className="font-semibold">{currency}{Number(b.extras_total || 0).toFixed(2)}</span>
                                </div>
                                <div className="mt-2 space-y-2">
                                  {extraLines.map((line) => (
                                    <div key={line.id} className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-2.5 py-2">
                                      <span>{line.description} · {line.quantity} × {currency}{Number(line.unit_price || 0).toFixed(2)}</span>
                                      {line.line_type !== 'pos' && <button onClick={() => voidExtra(b.id, line)} className="text-red-600 hover:text-red-800" title="Void extra"><Trash2 size={13} /></button>}
                                    </div>
                                  ))}
                                  {extraLines.length === 0 && <p className="text-gray-400">No extras added yet.</p>}
                                </div>
                                {!['cancelled', 'completed'].includes(b.status) && (
                                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_72px_92px_auto]">
                                    <input className="rounded-lg border border-gray-200 px-2 py-2" placeholder="Extra description" value={draft.description || ''} onChange={(e) => setExtraDrafts((prev) => ({ ...prev, [b.id]: { ...draft, description: e.target.value } }))} />
                                    <input className="rounded-lg border border-gray-200 px-2 py-2" type="number" min="0.01" step="0.01" value={draft.quantity || 1} onChange={(e) => setExtraDrafts((prev) => ({ ...prev, [b.id]: { ...draft, quantity: e.target.value } }))} />
                                    <input className="rounded-lg border border-gray-200 px-2 py-2" type="number" min="0" step="0.01" placeholder="Price" value={draft.unit_price || ''} onChange={(e) => setExtraDrafts((prev) => ({ ...prev, [b.id]: { ...draft, unit_price: e.target.value } }))} />
                                    <button onClick={() => addExtra(b.id)} className="rounded-lg bg-amber-600 px-3 py-2 font-semibold text-white hover:bg-amber-700">Add</button>
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })()}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">
                {editing ? 'Edit Event' : 'New Event'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSave} className="px-6 py-5 space-y-4">
              {error && (
                <ErrorNotice className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</ErrorNotice>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Event / Group Name *</label>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="e.g. ABC Conference, Smith Wedding"
                    value={form.event_name}
                    onChange={(e) => set('event_name', e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
                    value={form.customer_id}
                    onChange={(e) => {
                      const id = e.target.value
                      const found = customers.find((customer) => customer.id === id)
                      set('customer_id', id)
                      if (found) set('client_name', found.name || '')
                    }}
                  >
                    <option value="">— Select or create —</option>
                    {[...customers]
                      .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')))
                      .map((customer) => (
                        <option key={customer.id} value={customer.id}>{customer.name}</option>
                      ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Customer / Contact Name *</label>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-100"
                    placeholder="Name of the person or company holding the reservation"
                    value={form.client_name}
                    onChange={(e) => set('client_name', e.target.value)}
                    readOnly={Boolean(form.customer_id)}
                    required
                  />
                  {!form.customer_id && (
                    <p className="mt-1 text-xs text-gray-500">
                      A verified customer record is created for this name when you save. Select an existing customer above to link instead.
                    </p>
                  )}
                </div>
                {!form.customer_id && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                      <input
                        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                        placeholder="+267 ..."
                        value={newCustomer.phone}
                        onChange={(e) => setNewCustomer((prev) => ({ ...prev, phone: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                      <input
                        type="email"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                        placeholder="name@example.com"
                        value={newCustomer.email}
                        onChange={(e) => setNewCustomer((prev) => ({ ...prev, email: e.target.value }))}
                      />
                    </div>
                  </>
                )}
              </div>

              {venueResources.length > 0 && (
                <div className="rounded-xl border border-purple-200 bg-purple-50 p-4">
                  <p className="text-sm font-semibold text-purple-900">Venue resources</p>
                  <p className="mb-2 text-xs text-purple-700">Reserve the pool, bar, gazebo, braai area, or other configured spaces for this event.</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {venueResources.map((resource) => {
                      const checked = form.resource_keys.includes(resource.key)
                      return (
                        <label key={resource.key} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer ${checked ? 'border-purple-500 bg-white text-purple-900' : 'border-purple-200 text-purple-800'}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => set('resource_keys', e.target.checked
                              ? [...form.resource_keys, resource.key]
                              : form.resource_keys.filter((key) => key !== resource.key))}
                          />
                          {resource.name}
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}

              {form.reservation_scope !== 'venue_only' && (
                <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-teal-900 mb-1">Room Check-in</label>
                      <input type="date" className="w-full border border-teal-200 rounded-lg px-3 py-2.5 text-sm bg-white" value={form.check_in} onChange={(e) => set('check_in', e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-teal-900 mb-1">Room Check-out</label>
                      <input type="date" className="w-full border border-teal-200 rounded-lg px-3 py-2.5 text-sm bg-white" value={form.check_out} onChange={(e) => set('check_out', e.target.value)} />
                    </div>
                  </div>
                  {form.reservation_scope === 'venue_with_rooms' && (
                    <div>
                      <p className="text-sm font-semibold text-teal-900">Guest rooms</p>
                      <p className="text-xs text-teal-700 mb-2">Selected rooms become real room bookings and reserve availability.</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {rooms.filter((room) => room.status !== 'maintenance').map((room) => {
                          const checked = form.room_ids.includes(room.id)
                          return (
                            <label key={room.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer ${checked ? 'border-teal-500 bg-white text-teal-900' : 'border-teal-200 bg-teal-50 text-teal-800'}`}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => set('room_ids', e.target.checked
                                  ? [...form.room_ids, room.id]
                                  : form.room_ids.filter((id) => id !== room.id))}
                              />
                              Room {room.room_number}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Event Type</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                    value={form.event_type}
                    onChange={(e) => set('event_type', e.target.value)}
                  >
                    {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reservation Scope</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white disabled:bg-gray-100"
                    value={form.reservation_scope}
                    onChange={(e) => set('reservation_scope', e.target.value)}
                    disabled={Boolean(editing)}
                  >
                    {RESERVATION_SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                  {editing && (
                    <p className="mt-1 text-xs text-gray-500">Scope cannot be changed after creation. Cancel and recreate the event to change it safely.</p>
                  )}
                </div>
              </div>

              {form.reservation_scope === 'exclusive_lodge' && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <p className="font-semibold">Entire lodge reservation</p>
                  <p className="mt-1 text-xs">
                    All {rooms.filter((room) => room.status !== 'maintenance').length} bookable rooms will be reserved for this event.
                    Entire-lodge scope does not multiply the whole-lodge price by room count.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {form.reservation_scope === 'venue_only' && <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                  <input
                    type="date"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    value={form.booking_date}
                    onChange={(e) => set('booking_date', e.target.value)}
                    required
                  />
                </div>}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Time *</label>
                  <input
                    type="time"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    value={form.start_time}
                    onChange={(e) => set('start_time', e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Time *</label>
                  <input
                    type="time"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    value={form.end_time}
                    onChange={(e) => set('end_time', e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Adults</label>
                  <input
                    type="number"
                    min="0"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="0"
                    value={form.adults || form.attendees}
                    onChange={(e) => { set('adults', e.target.value); set('attendees', e.target.value) }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Children</label>
                  <input
                    type="number"
                    min="0"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="0"
                    value={form.children}
                    onChange={(e) => set('children', e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="catering"
                  checked={form.includes_catering}
                  onChange={(e) => set('includes_catering', e.target.checked)}
                  className="w-4 h-4 text-green-600 rounded"
                />
                <label htmlFor="catering" className="text-sm font-medium text-gray-700">Includes Catering</label>
              </div>

              {form.includes_catering && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Catering Notes</label>
                  <textarea
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                    placeholder="e.g. Tea breaks, lunch buffet, dietary requirements..."
                    value={form.catering_notes}
                    onChange={(e) => set('catering_notes', e.target.value)}
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {form.reservation_scope === 'exclusive_lodge' ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Whole-lodge daily rate ({currency}) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      required={!editing}
                      disabled={Boolean(editing)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-100"
                      placeholder="0.00"
                      value={form.event_daily_rate}
                      onChange={(e) => set('event_daily_rate', e.target.value)}
                    />
                    {editing && <p className="mt-1 text-xs text-gray-500">Pricing is locked after creation. Cancel and recreate to change it safely.</p>}
                    <p className="mt-1 text-xs text-gray-500">
                      {Math.max(0, Math.round((new Date(`${form.check_out}T00:00:00`).getTime() - new Date(`${form.check_in}T00:00:00`).getTime()) / 86400000))} night(s) · whole-lodge total {currency}{(Number(form.event_daily_rate || 0) * Math.max(0, Math.round((new Date(`${form.check_out}T00:00:00`).getTime() - new Date(`${form.check_in}T00:00:00`).getTime()) / 86400000))).toFixed(2)}
                    </p>
                  </div>
                ) : <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Base Venue / Package Fee ({currency})</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="0.00"
                    value={form.total_amount}
                    onChange={(e) => set('total_amount', e.target.value)}
                  />
                </div>}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Deposit Paid ({currency})</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="0.00"
                    value={form.deposit_paid}
                    onChange={(e) => set('deposit_paid', e.target.value)}
                  />
                </div>
              </div>

              <div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                    value={form.payment_method}
                    onChange={(e) => set('payment_method', e.target.value)}
                  >
                    <option value="">— Select —</option>
                    {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                  placeholder="Any additional notes..."
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || customerSaving}
                  className="px-5 py-2.5 text-sm font-medium bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white rounded-lg transition-colors"
                >
                  {saving ? 'Saving...' : editing ? 'Update Booking' : 'Create Booking'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {payBooking && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Collect Payment</h2>
              <button onClick={closePaymentModal} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handlePaymentSave} className="px-6 py-5 space-y-4">
              {payError && (
                <ErrorNotice className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{payError}</ErrorNotice>
              )}
              {pendingPaymentIntent && (
                <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                  A previous payment is awaiting confirmation. Retry the saved amount and method after sync; changing them could duplicate a receipt.
                </p>
              )}
              <div>
                <p className="text-sm font-medium text-gray-900">{payBooking.event_name || payBooking.client_name}</p>
                {payBooking.company && <p className="text-xs text-gray-500">{payBooking.company}</p>}
                <p className="text-xs text-gray-500 mt-1">{payBooking.booking_date} · {payBooking.room_name}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500">Total</p>
                  <p className="font-semibold">{currency} {(payBooking.total_amount || 0).toFixed(2)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500">Already Paid</p>
                  <p className="font-semibold">{currency} {(payBooking.amount_paid || payBooking.deposit_paid || 0).toFixed(2)}</p>
                </div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                <span className="font-semibold text-amber-800">Outstanding: {currency} {Math.max(0, (payBooking.total_amount || 0) - (payBooking.amount_paid || payBooking.deposit_paid || 0)).toFixed(2)}</span>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={Math.max(0, (payBooking.total_amount || 0) - (payBooking.amount_paid || payBooking.deposit_paid || 0))}
                  disabled={pendingPaymentIntent || paySaving}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  value={payForm.amount}
                  onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
                <select
                  disabled={pendingPaymentIntent || paySaving}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                  value={payForm.method}
                  onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}
                >
                  {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closePaymentModal}
                  className="px-4 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={paySaving}
                  className="px-5 py-2.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg transition-colors"
                >
                  {paySaving ? 'Saving...' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
