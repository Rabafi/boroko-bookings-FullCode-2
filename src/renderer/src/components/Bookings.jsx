import { useEffect, useState } from 'react'
import { Plus, Search, Filter, CreditCard, Building2, CheckCircle2 } from 'lucide-react'
import { StatusBadge } from './shared/StatusBadge'
import { Modal } from './shared/Modal'
import { Receipt } from './shared/Receipt'
import { useAuth } from '../App'
import { useSettings } from '../App'

const STATUS_OPTIONS = ['confirmed', 'checked_in', 'checked_out', 'cancelled']

const PAYMENT_METHODS = [
  { value: 'cash',          label: '💵 Cash' },
  { value: 'card',          label: '💳 Card' },
  { value: 'orange_money',  label: '🟠 Orange Money' },
  { value: 'myzaka',        label: '🔵 MyZaka' },
  { value: 'fnb_ewallet',   label: '🏦 FNB eWallet' },
  { value: 'bank_transfer', label: '🏛️ Bank Transfer' },
  { value: 'other',         label: 'Other' }
]
const METHOD_LABEL = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.value, m.label]))

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
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'

  const [bookings, setBookings] = useState([])
  const [rooms, setRooms] = useState([])
  const [customers, setCustomers] = useState([])
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterPayment, setFilterPayment] = useState('all')
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyBooking)
  const [newCustomer, setNewCustomer] = useState(emptyCustomer)
  const [useNewCustomer, setUseNewCustomer] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [receiptBooking, setReceiptBooking] = useState(null)

  // Event booking modal
  const [showEventModal, setShowEventModal] = useState(false)
  const [eventForm, setEventForm] = useState({ event_name: '', contact_phone: '', contact_email: '', check_in: '', check_out: '', deposit_amount: '', payment_method: 'cash', notes: '' })
  const [eventLoading, setEventLoading] = useState(false)
  const [eventResult, setEventResult] = useState(null) // success result

  // Payment modal
  const [paymentBooking, setPaymentBooking] = useState(null)
  const [payForm, setPayForm] = useState({ payment_status: 'paid', payment_method: 'cash', amount_paid: '' })
  const [payLoading, setPayLoading] = useState(false)

  // Charges modal
  const [chargesBooking, setChargesBooking] = useState(null)
  const [charges, setCharges] = useState([])
  const [chargeForm, setChargeForm] = useState({ description: '', amount: '', category: 'Food & Beverage', quantity: 1 })
  const [chargeLoading, setChargeLoading] = useState(false)

  const openCharges = async (b) => {
    setChargesBooking(b)
    setChargeForm({ description: '', amount: '', category: 'Food & Beverage', quantity: 1 })
    const data = await window.api.charges.getByBooking(b.id).catch(() => [])
    setCharges(data || [])
  }

  const handleAddCharge = async (e) => {
    e.preventDefault()
    setChargeLoading(true)
    await window.api.charges.add(chargesBooking.id, {
      ...chargeForm,
      amount: parseFloat(chargeForm.amount),
      quantity: parseInt(chargeForm.quantity)
    }).catch(console.error)
    const data = await window.api.charges.getByBooking(chargesBooking.id).catch(() => [])
    setCharges(data || [])
    setChargeForm({ description: '', amount: '', category: 'Food & Beverage', quantity: 1 })
    setChargeLoading(false)
  }

  const handleDeleteCharge = async (id) => {
    await window.api.charges.delete(id).catch(console.error)
    const data = await window.api.charges.getByBooking(chargesBooking.id).catch(() => [])
    setCharges(data || [])
  }

  useEffect(() => {
    loadAll()
  }, [])

  const loadAll = async () => {
    const [b, r, c] = await Promise.all([
      window.api.bookings.getAll(),
      window.api.rooms.getAll(),
      window.api.customers.getAll()
    ])
    setBookings(b)
    setRooms(r)
    setCustomers(c)
  }

  const openAdd = () => {
    setEditingId(null)
    setForm({ ...emptyBooking, check_in: today(), check_out: tomorrow() })
    setNewCustomer(emptyCustomer)
    setUseNewCustomer(true)
    setError('')
    setShowModal(true)
  }

  const openEdit = (b) => {
    setEditingId(b.id)
    setForm({
      customer_id: b.customer_id,
      room_id: b.room_id,
      check_in: b.check_in,
      check_out: b.check_out,
      adults: b.adults,
      children: b.children,
      notes: b.notes || ''
    })
    setUseNewCustomer(false)
    setError('')
    setShowModal(true)
  }

  const openPayment = (b) => {
    setPaymentBooking(b)
    setPayForm({
      payment_status: b.payment_status === 'paid' ? 'paid' : b.payment_status === 'partial' ? 'partial' : 'paid',
      payment_method: b.payment_method || 'cash',
      amount_paid: b.payment_status === 'paid' ? b.total_amount : (b.amount_paid || '')
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

      const data = {
        ...form,
        customer_id: customerId,
        room_id: form.room_id,
        adults: parseInt(form.adults),
        children: parseInt(form.children),
        created_by: user.id
      }

      let res
      if (editingId) {
        res = await window.api.bookings.update(editingId, data)
      } else {
        res = await window.api.bookings.create(data)
      }

      if (res.success === false) throw new Error(res.error)
      setShowModal(false)
      loadAll()
    } catch (err) {
      setError(err.message || 'Failed to save booking')
    }
    setLoading(false)
  }

  const handlePaymentSave = async (e) => {
    e.preventDefault()
    setPayLoading(true)
    try {
      await window.api.bookings.updatePayment(
        paymentBooking.id,
        payForm.payment_status,
        payForm.payment_status === 'paid'
          ? paymentBooking.total_amount
          : Number(payForm.amount_paid) || 0,
        payForm.payment_method
      )
      setPaymentBooking(null)
      loadAll()
    } catch (err) {
      console.error(err)
    }
    setPayLoading(false)
  }

  const handleStatusChange = async (id, status) => {
    await window.api.bookings.updateStatus(id, status)
    loadAll()
  }

  const openEventModal = () => {
    setEventForm({ event_name: '', contact_phone: '', contact_email: '', check_in: today(), check_out: tomorrow(), deposit_amount: '', payment_method: 'cash', notes: '' })
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
      setEventResult(res)
      loadAll()
    } catch (err) {
      setError(err.message || 'Failed to create event booking')
    }
    setEventLoading(false)
  }

  const fmtBkNum = (b) => b.booking_number || '—'

  const filtered = bookings.filter((b) => {
    const matchSearch =
      !search ||
      b.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
      b.room_number?.toLowerCase().includes(search.toLowerCase()) ||
      fmtBkNum(b).toLowerCase().includes(search.toLowerCase())
    const matchStatus = filterStatus === 'all' || b.status === filterStatus
    const matchPayment = filterPayment === 'all' || (b.payment_status || 'unpaid') === filterPayment
    return matchSearch && matchStatus && matchPayment
  })

  const nights = (checkIn, checkOut) => {
    if (!checkIn || !checkOut) return 0
    return Math.max(
      0,
      Math.ceil((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24))
    )
  }

  const isEventBooking = (b) => b.notes?.startsWith('[GROUP:')

  const selectedRoom = rooms.find((r) => r.id === form.room_id)
  const estimatedTotal = selectedRoom
    ? selectedRoom.rate_per_night * nights(form.check_in, form.check_out)
    : 0

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Bookings</h1>
          <p className="text-sm text-gray-500 mt-0.5">{bookings.length} total bookings</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={openEventModal}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
          >
            <Building2 size={16} /> Event / Lodge Booking
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
          >
            <Plus size={16} /> New Booking
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="Search guest or room..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={15} className="text-gray-400" />
          <select
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s} className="capitalize">
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <CreditCard size={15} className="text-gray-400" />
          <select
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
            value={filterPayment}
            onChange={(e) => setFilterPayment(e.target.value)}
          >
            <option value="all">All payments</option>
            <option value="unpaid">Unpaid</option>
            <option value="partial">Partial</option>
            <option value="paid">Paid</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
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
            <tbody className="divide-y divide-gray-50">
              {filtered.map((b) => (
                <tr key={b.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-mono text-xs font-semibold text-gray-500">{fmtBkNum(b)}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1.5">
                      <p className="font-medium text-gray-800">{b.customer_name}</p>
                      {isEventBooking(b) && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 flex items-center gap-0.5">
                          <Building2 size={9} /> EVENT
                        </span>
                      )}
                    </div>
                    {b.customer_phone && (
                      <p className="text-xs text-gray-400">{b.customer_phone}</p>
                    )}
                  </td>
                  <td className="px-5 py-3 text-gray-600">
                    <p>Room {b.room_number}</p>
                    <p className="text-xs text-gray-400">{b.room_type}</p>
                  </td>
                  <td className="px-5 py-3 text-gray-600">{b.check_in}</td>
                  <td className="px-5 py-3 text-gray-600">{b.check_out}</td>
                  <td className="px-5 py-3 text-gray-600">
                    {b.adults}A {b.children > 0 ? `${b.children}C` : ''}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="px-5 py-3">
                    <PaymentBadge status={b.payment_status || 'unpaid'} />
                    {b.payment_status === 'partial' && b.amount_paid > 0 && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {currency} {Number(b.amount_paid).toFixed(2)} paid
                      </p>
                    )}
                    {b.payment_method && b.payment_status !== 'unpaid' && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {METHOD_LABEL[b.payment_method] || b.payment_method}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right font-medium text-gray-800">
                    {currency} {Number(b.total_amount || 0).toFixed(2)}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-center gap-1">
                      {b.status === 'confirmed' && (
                        <>
                          <ActionBtn
                            label="Check In"
                            color="green"
                            disabled={b.check_in > today()}
                            title={b.check_in > today() ? `Check-in date is ${b.check_in}` : undefined}
                            onClick={() => handleStatusChange(b.id, 'checked_in')}
                          />
                          <ActionBtn
                            label="Edit"
                            color="gray"
                            onClick={() => openEdit(b)}
                          />
                          <ActionBtn
                            label="Cancel"
                            color="red"
                            onClick={() => handleStatusChange(b.id, 'cancelled')}
                          />
                        </>
                      )}
                      {b.status === 'checked_in' && (
                        <ActionBtn
                          label="Check Out"
                          color="blue"
                          onClick={() => handleStatusChange(b.id, 'checked_out')}
                        />
                      )}
                      {b.payment_status !== 'paid' && b.status !== 'cancelled' && (
                        <ActionBtn
                          label="💰 Pay"
                          color="yellow"
                          onClick={() => openPayment(b)}
                        />
                      )}
                      <ActionBtn
                        label="🧾 Extras"
                        color="gray"
                        onClick={() => openCharges(b)}
                      />
                      <ActionBtn
                        label="🖨️ Receipt"
                        color="gray"
                        onClick={() => setReceiptBooking(b)}
                      />
                      {b.customer_phone && b.status !== 'cancelled' && (
                        <ActionBtn
                          label="💬 WhatsApp"
                          color="green"
                          onClick={() => {
                            const phone = formatWhatsAppPhone(b.customer_phone)
                            const msg = buildWhatsAppMessage(b, settings)
                            window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank')
                          }}
                        />
                      )}
                      {b.customer_email && b.status !== 'cancelled' && (
                        <ActionBtn
                          label="✉️ Email"
                          color="blue"
                          onClick={() => {
                            const lodge = settings?.lodge_name || 'the Lodge'
                            const subject = `Booking Confirmation — ${lodge}`
                            const msg = buildWhatsAppMessage(b, settings)
                            window.api.shell.openExternal(
                              `mailto:${b.customer_email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(msg)}`
                            )
                          }}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-5 py-10 text-center text-gray-400">
                    No bookings found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Receipt */}
      {receiptBooking && (
        <Receipt booking={receiptBooking} onClose={() => setReceiptBooking(null)} />
      )}

      {/* Extras / Charges Modal */}
      {chargesBooking && (
        <Modal
          title={`Extra Charges — ${chargesBooking.customer_name}`}
          onClose={() => setChargesBooking(null)}
          size="sm"
        >
          <div className="space-y-4">
            {/* Existing charges */}
            {charges.length > 0 ? (
              <div className="divide-y divide-gray-100">
                {charges.map((c) => (
                  <div key={c.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <p className="font-medium text-gray-800">{c.description}</p>
                      <p className="text-xs text-gray-400">{c.category} · qty {c.quantity ?? 1}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-800">
                        {currency} {Number(c.amount).toFixed(2)}
                      </span>
                      <button
                        onClick={() => handleDeleteCharge(c.id)}
                        className="text-red-400 hover:text-red-600 text-xs px-1"
                      >✕</button>
                    </div>
                  </div>
                ))}
                <div className="flex justify-between pt-2 text-sm font-bold text-gray-800">
                  <span>Total extras</span>
                  <span>{currency} {charges.reduce((s, c) => s + Number(c.amount), 0).toFixed(2)}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-2">No extra charges yet.</p>
            )}

            {/* Add charge form */}
            <form onSubmit={handleAddCharge} className="border-t pt-4 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Add Charge</p>
              <input
                type="text"
                className="input"
                placeholder="Description (e.g. Breakfast, Laundry)"
                value={chargeForm.description}
                onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })}
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
                  required
                />
                <input
                  type="number"
                  min="1"
                  className="input"
                  placeholder="Qty"
                  value={chargeForm.quantity}
                  onChange={(e) => setChargeForm({ ...chargeForm, quantity: e.target.value })}
                />
              </div>
              <select
                className="input"
                value={chargeForm.category}
                onChange={(e) => setChargeForm({ ...chargeForm, category: e.target.value })}
              >
                {['Food & Beverage', 'Minibar', 'Laundry', 'Transport', 'Activities', 'Telephone', 'Other'].map(
                  (c) => <option key={c} value={c}>{c}</option>
                )}
              </select>
              <button type="submit" disabled={chargeLoading} className="btn-primary w-full">
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
          onClose={() => setPaymentBooking(null)}
          size="sm"
        >
          <form onSubmit={handlePaymentSave} className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3 text-sm">
              <p className="font-medium text-gray-800">{paymentBooking.customer_name}</p>
              <p className="text-gray-500">Room {paymentBooking.room_number} — Total: <span className="font-semibold text-gray-800">{currency} {Number(paymentBooking.total_amount || 0).toFixed(2)}</span></p>
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
                    amount_paid: ps === 'paid' ? paymentBooking.total_amount : f.amount_paid
                  }))
                }}
              >
                <option value="paid">✅ Paid in Full</option>
                <option value="partial">⚡ Partial Payment</option>
                <option value="unpaid">❌ Mark as Unpaid</option>
              </select>
            </F>

            <F label="Payment Method">
              <select
                className="input"
                value={payForm.payment_method}
                onChange={(e) => setPayForm((f) => ({ ...f, payment_method: e.target.value }))}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </F>

            {payForm.payment_status === 'partial' && (
              <F label={`Amount Paid (${currency})`}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  max={paymentBooking.total_amount}
                  className="input"
                  value={payForm.amount_paid}
                  onChange={(e) => setPayForm((f) => ({ ...f, amount_paid: e.target.value }))}
                  placeholder={`Max: ${currency} ${Number(paymentBooking.total_amount || 0).toFixed(2)}`}
                  required
                />
                {payForm.amount_paid > 0 && (
                  <p className="text-xs text-orange-500 mt-1">
                    Outstanding: {currency} {(Number(paymentBooking.total_amount || 0) - Number(payForm.amount_paid || 0)).toFixed(2)}
                  </p>
                )}
              </F>
            )}

            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setPaymentBooking(null)} className="btn-secondary flex-1">
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
              <h3 className="text-lg font-bold text-gray-800 mb-1">Event Booking Created!</h3>
              <p className="text-sm text-gray-500 mb-4">
                <span className="font-semibold text-gray-700">{eventForm.event_name}</span> has been booked into{' '}
                <span className="font-semibold text-green-700">{eventResult.count} room{eventResult.count !== 1 ? 's' : ''}</span>.
              </p>
              <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm text-gray-600 mb-5 text-left">
                <p className="font-medium text-gray-700 mb-1">Rooms booked:</p>
                <p>{eventResult.rooms.map((n) => `Room ${n}`).join(' · ')}</p>
                <p className="mt-1 text-gray-400">{eventForm.check_in} → {eventForm.check_out}</p>
              </div>
              <button onClick={() => setShowEventModal(false)} className="btn-primary px-8">Done</button>
            </div>
          ) : (
            /* ── Booking form ── */
            <form onSubmit={handleEventSave} className="space-y-5">
              <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-3 text-sm text-indigo-800">
                Books <strong>all available rooms</strong> for the selected dates under one event name. Rooms already reserved will be skipped automatically.
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
                <F label={`Total Deposit (${currency}) — optional`}>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="input"
                    value={eventForm.deposit_amount}
                    onChange={(e) => setEventForm({ ...eventForm, deposit_amount: e.target.value })}
                    placeholder="Split evenly across all rooms"
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
                <div className="bg-red-50 text-red-600 text-sm px-4 py-2.5 rounded-lg">{error}</div>
              )}

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowEventModal(false)} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={eventLoading} className="btn-primary flex-1 bg-indigo-600 hover:bg-indigo-700">
                  {eventLoading ? 'Booking rooms...' : '🏢 Book All Available Rooms'}
                </button>
              </div>
            </form>
          )}
        </Modal>
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
                <div className="flex gap-4 mb-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={useNewCustomer}
                      onChange={() => setUseNewCustomer(true)}
                    />
                    <span className="text-sm font-medium text-gray-700">New Guest</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={!useNewCustomer}
                      onChange={() => setUseNewCustomer(false)}
                    />
                    <span className="text-sm font-medium text-gray-700">Existing Guest</span>
                  </label>
                </div>

                {useNewCustomer ? (
                  <div className="grid grid-cols-2 gap-3 p-4 bg-gray-50 rounded-lg">
                    <F label="Full Name *">
                      <input
                        className="input"
                        value={newCustomer.name}
                        onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                        placeholder="Guest name"
                      />
                    </F>
                    <F label="Phone">
                      <input
                        className="input"
                        value={newCustomer.phone}
                        onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
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
                        <div className="mt-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
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
            <div className="grid grid-cols-2 gap-4">
              <F label="Room *">
                <select
                  className="input"
                  value={form.room_id}
                  onChange={(e) => setForm({ ...form, room_id: e.target.value })}
                  required
                >
                  <option value="">-- Select room --</option>
                  {rooms
                    .filter((r) => r.status !== 'maintenance')
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        Room {r.room_number} — {r.room_type} ({currency}{r.rate_per_night}/night)
                      </option>
                    ))}
                </select>
              </F>
              <F label="Adults">
                <input
                  type="number"
                  min="1"
                  max="20"
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
                  required
                />
              </F>
              <F label="Children">
                <input
                  type="number"
                  min="0"
                  max="20"
                  className="input"
                  value={form.children}
                  onChange={(e) => setForm({ ...form, children: e.target.value })}
                />
              </F>
            </div>

            {/* Estimated Total */}
            {estimatedTotal > 0 && (
              <div className="bg-green-50 rounded-lg px-4 py-3 text-sm">
                <span className="text-gray-600">
                  {nights(form.check_in, form.check_out)} night(s) × {currency}{' '}
                  {selectedRoom?.rate_per_night?.toFixed(2)} ={' '}
                </span>
                <span className="font-bold text-green-700">{currency} {estimatedTotal.toFixed(2)}</span>
              </div>
            )}

            {/* Deposit — only for new bookings */}
            {!editingId && estimatedTotal > 0 && (
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
                  </F>
                )}
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
              <div className="bg-red-50 text-red-600 text-sm px-4 py-2.5 rounded-lg">{error}</div>
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
    </div>
  )
}

function F({ label, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  )
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
    paid: 'bg-green-100 text-green-700',
    partial: 'bg-yellow-100 text-yellow-700',
    unpaid: 'bg-red-100 text-red-600'
  }
  const labels = {
    paid: '✅ Paid',
    partial: '⚡ Partial',
    unpaid: '❌ Unpaid'
  }
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${styles[status] || styles.unpaid}`}>
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
