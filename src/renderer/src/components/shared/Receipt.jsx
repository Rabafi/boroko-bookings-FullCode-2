import { useEffect, useMemo, useState } from 'react'
import { Printer, X, Download, CreditCard } from 'lucide-react'
import { useSettings } from '../../app-context'

function formatEventDate(value) {
  if (!value) return 'Time not recorded'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Time not recorded'
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function stripGroupTag(notes) {
  if (!notes) return ''
  return notes.replace(/\[GROUP:[^\]]+\]/g, '').trim()
}

export function Receipt({ booking, onClose, onCollectPayment = null }) {
  const { settings } = useSettings()
  const [charges, setCharges] = useState([])
  const [payments, setPayments] = useState([])
  const [saving, setSaving] = useState(false)
  const bookingId = booking.id || booking.booking_id

  useEffect(() => {
    if (!bookingId) return
    window.api.charges.getByBooking(bookingId).then(setCharges).catch(() => {})
    window.api.bookings.getPayments(bookingId).then((data) => setPayments(Array.isArray(data) ? data : [])).catch(() => {})
  }, [bookingId])

  const d1 = booking.check_in ? new Date(booking.check_in) : null
  const d2 = booking.check_out ? new Date(booking.check_out) : null
  const nights = (d1 && d2 && !Number.isNaN(d1.getTime()) && !Number.isNaN(d2.getTime()))
    ? Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)))
    : 0

  const isEvent = booking.is_exclusive_event || booking._event_group || booking.notes?.includes('[GROUP:')

  const currency = settings?.currency || 'P'
  const ratePerNight = Number(booking.rate_per_night || 0)
  const roomSubtotal = Number(booking.total_amount || 0)  // server-authoritative room cost; avoids rate×nights drift for event bookings
  const extraTotal = charges.reduce((sum, c) => sum + Number(c.amount || 0), 0)
  const grandTotal = roomSubtotal + extraTotal
  const amountPaid = Number(booking.amount_paid || 0)
  const isCancelled = booking.status === 'cancelled'
  const outstanding = !isCancelled ? Math.max(0, grandTotal - amountPaid) : 0
  const refundDue = isCancelled && amountPaid > grandTotal ? amountPaid - grandTotal : 0

  const issueDate = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  })
  const receiptNo = booking.invoice_number
    || (booking._pending_sync ? 'PENDING' : `RCP-${String(booking.id).slice(0, 8).toUpperCase()}`)

  const logo = settings?.logo || ''
  const lodgeName = settings?.lodge_name || 'Lodge'
  const companyName = settings?.company_name || ''
  const address = [settings?.address, settings?.city, settings?.country].filter(Boolean).join(', ')
  const phone = settings?.phone || ''
  const email = settings?.email || ''
  const website = settings?.website || ''
  const vatNumber = settings?.vat_number || ''

  const handlePrint = async () => {
    await window.api.invoices.recordDelivery?.({
      booking_id: bookingId,
      invoice_number: receiptNo,
      delivery_type: 'receipt_print',
      delivery_status: 'completed',
      recipient: booking.customer_name || null,
      render_version: 'receipt-v1',
      metadata: {
        customer_name: booking.customer_name || null
      }
    }).catch(() => {})
    window.print()
  }

  const handleSavePDF = async () => {
    setSaving(true)
    try {
      await window.api.receipts.savePDF({
        guestName: booking.customer_name,
        bookingId,
        invoiceNumber: receiptNo
      })
      await window.api.reports.invoiceDeliveryHistory?.({ bookingId }).catch(() => [])
    } finally {
      setSaving(false)
    }
  }

  const timelineEvents = useMemo(() => {
    const events = []

    if (booking.created_at) {
      events.push({
        key: `created-${bookingId}`,
        at: booking.created_at,
        tone: 'bg-slate-100 text-slate-700',
        title: 'Booking created',
        detail: `${booking.customer_name || 'Guest'} was added to the system.`
      })
    }

    events.push({
      key: `stay-${bookingId}`,
      at: booking.check_in,
      tone: 'bg-blue-100 text-blue-700',
      title: 'Stay scheduled',
      detail: `${booking.check_in} to ${booking.check_out} · ${nights} night${nights !== 1 ? 's' : ''}`
    })

    charges.forEach((charge) => {
      events.push({
        key: `charge-${charge.id || `${charge.description}-${charge.created_at}`}`,
        at: charge.created_at || charge.date || booking.updated_at || booking.created_at,
        tone: 'bg-amber-100 text-amber-700',
        title: 'Extra charge added',
        detail: `${charge.description || 'Extra charge'} · ${currency} ${Number(charge.amount || 0).toFixed(2)}`
      })
    })

    payments.forEach((payment) => {
      const amount = Math.abs(Number(payment.amount || 0))
      const kind = payment.type === 'refund' ? 'Refund recorded' : payment.type === 'deposit' ? 'Deposit recorded' : 'Payment recorded'
      const method = String(payment.method || 'method not set').replace(/_/g, ' ')
      events.push({
        key: `payment-${payment.id || `${payment.created_at}-${amount}`}`,
        at: payment.paid_at || payment.created_at || booking.updated_at || booking.created_at,
        tone: payment.type === 'refund' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700',
        title: kind,
        detail: `${currency} ${amount.toFixed(2)} via ${method}`
      })
    })

    if (booking.status === 'checked_in' || booking.status === 'checked_out') {
      events.push({
        key: `status-${booking.status}-${bookingId}`,
        at: booking.updated_at || booking.check_in,
        tone: booking.status === 'checked_out' ? 'bg-slate-100 text-slate-700' : 'bg-emerald-100 text-emerald-700',
        title: booking.status === 'checked_out' ? 'Guest checked out' : 'Guest checked in',
        detail: booking.status === 'checked_out' ? 'Booking was closed at front desk.' : 'Guest stay is currently active.'
      })
    }

    return events.sort((left, right) => {
      const leftTime = left.at ? new Date(left.at).getTime() : 0
      const rightTime = right.at ? new Date(right.at).getTime() : 0
      return rightTime - leftTime
    })
  }, [booking.check_in, booking.check_out, booking.created_at, booking.customer_name, booking.status, booking.updated_at, bookingId, charges, currency, nights, payments])

  return (
    <>
      {/* Backdrop overlay — screen only, never printed */}
      <div className="fixed inset-0 bg-black/50 z-50 no-print" />

      {/* Modal container — visible in both screen and print */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto print:p-0 print:static print:bg-white">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl my-auto print:max-h-none print:overflow-visible print:shadow-none print:rounded-none">
          {/* Modal Header — screen only */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 no-print">
            <h2 className="text-lg font-semibold text-gray-800">Guest Receipt</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSavePDF}
                disabled={saving}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50"
              >
                <Download size={15} /> {saving ? 'Saving…' : 'Save as PDF'}
              </button>
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
              >
                <Printer size={15} /> Print Receipt
              </button>
              {onCollectPayment && !isCancelled && outstanding > 0 && (
                <button
                  onClick={() => onCollectPayment(booking)}
                  className="flex items-center gap-2 bg-amber-500 text-white px-4 py-2 rounded-lg hover:bg-amber-600 transition-colors text-sm font-medium"
                >
                  <CreditCard size={15} /> Collect {currency} {outstanding.toFixed(2)}
                </button>
              )}
              {onCollectPayment && isCancelled && refundDue > 0 && (
                <button
                  onClick={() => onCollectPayment(booking)}
                  className="flex items-center gap-2 bg-rose-600 text-white px-4 py-2 rounded-lg hover:bg-rose-700 transition-colors text-sm font-medium"
                >
                  <CreditCard size={15} /> Record Refund ({currency} {refundDue.toFixed(2)})
                </button>
              )}
              <button
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Receipt Content */}
          <div id="printable-receipt" className="p-8 sm:p-12 md:p-16 bg-white print:p-0 print:w-[210mm] print:mx-auto">
            {/* Draft disclaimer — shown when booking hasn't synced to server yet */}
            {booking._pending_sync && (
              <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-amber-700 text-xs font-medium text-center">
                ⚠️ DRAFT — This booking has not yet been confirmed by the server.
                Do not treat this receipt as final until sync completes.
              </div>
            )}
            {/* Payment estimate disclaimer — only when booking is server-confirmed but payment amounts are locally estimated */}
            {booking._pending_payment && !booking._pending_sync && (
              <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-amber-700 text-xs font-medium text-center">
                ⏳ Payment amounts are estimated — pending server confirmation.
                Totals will update once connectivity is restored.
              </div>
            )}
            {/* Lodge Header */}
            <div className="text-center mb-6">
              {logo ? (
                <img
                  src={logo}
                  alt={lodgeName}
                  className="h-20 max-w-48 object-contain mx-auto mb-2"
                />
              ) : (
                <div className="text-3xl mb-1">🏕️</div>
              )}
              <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase">
                {lodgeName}
              </h1>
              {companyName && companyName !== lodgeName && (
                <p className="text-sm text-gray-500 mt-0.5">{companyName}</p>
              )}
              <div className="mt-2 text-xs text-gray-400 space-y-0.5">
                {address && <p>{address}</p>}
                <p>
                  {phone && `Tel: ${phone}`}
                  {phone && email && ' | '}
                  {email && `Email: ${email}`}
                </p>
                {website && <p>{website}</p>}
                {vatNumber && <p>VAT No: {vatNumber}</p>}
              </div>
            </div>

            {/* Divider */}
            <div className="border-t-2 border-slate-900 mb-1" />
            <div className="border-t border-slate-200 mb-8" />

            {/* Receipt Title & Number */}
            <div className="flex justify-between items-start mb-5">
              <div>
                <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">
                  {vatNumber ? 'Tax Invoice' : 'Invoice'}
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Invoice No: <span className="font-bold text-slate-900">{receiptNo}</span>
                </p>
              </div>
              <div className="text-right text-xs text-gray-500">
                <p>Date Issued:</p>
                <p className="font-semibold text-gray-700">{issueDate}</p>
              </div>
            </div>

            {/* Guest Details */}
            <div className="bg-gray-50 rounded-lg p-4 mb-5">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Guest Information
              </h3>
              <div className="grid grid-cols-2 gap-y-2 text-sm">
                <div>
                  <p className="text-xs text-gray-400">Name</p>
                  <p className="font-semibold text-gray-800">{booking.customer_name}</p>
                </div>
                {booking.customer_phone && (
                  <div>
                    <p className="text-xs text-gray-400">Phone</p>
                    <p className="font-medium text-gray-700">{booking.customer_phone}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Booking Details */}
            <div className="bg-gray-50 rounded-lg p-4 mb-5">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Booking Details
              </h3>
              <div className="grid grid-cols-2 gap-y-2 text-sm">
                <div>
                  <p className="text-xs text-gray-400">Room</p>
                  {isEvent ? (
                    <>
                      <p className="font-semibold text-gray-800">Full Lodge Booking</p>
                      {booking.room_count > 0 && (
                        <p className="text-xs text-gray-500">{booking.room_count} rooms · Exclusive use</p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="font-semibold text-gray-800">Room {booking.room_number}</p>
                      <p className="text-xs text-gray-500">{booking.room_type}</p>
                    </>
                  )}
                </div>
                <div>
                  <p className="text-xs text-gray-400">Guests</p>
                  <p className="font-medium text-gray-700">
                    {booking.adults} Adult{booking.adults !== 1 ? 's' : ''}
                    {booking.children > 0
                      ? `, ${booking.children} Child${booking.children !== 1 ? 'ren' : ''}`
                      : ''}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Check In</p>
                  <p className="font-medium text-gray-700">{booking.check_in}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Check Out</p>
                  <p className="font-medium text-gray-700">{booking.check_out}</p>
                </div>
              </div>
            </div>

            {/* Charges */}
            <div className="mb-5">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Charges
              </h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 text-gray-600 font-medium">Description</th>
                    <th className="text-center py-2 text-gray-600 font-medium">Qty</th>
                    <th className="text-right py-2 text-gray-600 font-medium">Rate</th>
                    <th className="text-right py-2 text-gray-600 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Room charge */}
                  <tr className="border-b border-gray-100">
                    <td className="py-3 text-gray-700">
                      {isEvent
                        ? `Full Lodge (${booking.room_count ? `${booking.room_count} rooms, ` : ''}exclusive use) — ${booking.room_type || 'Event Booking'}`
                        : `Room ${booking.room_number} — ${booking.room_type}`}
                    </td>
                    <td className="py-3 text-center text-gray-700">{nights} night{nights !== 1 ? 's' : ''}</td>
                    <td className="py-3 text-right text-gray-700">
                      {currency} {ratePerNight.toFixed(2)}
                    </td>
                    <td className="py-3 text-right font-medium text-gray-800">
                      {currency} {roomSubtotal.toFixed(2)}
                    </td>
                  </tr>
                  {/* Extra charges */}
                  {charges.map((c) => (
                    <tr key={c.id} className="border-b border-gray-100">
                      <td className="py-2 text-gray-700">
                        {c.description}
                        {c.category && (
                          <span className="ml-1 text-xs text-gray-400">({c.category})</span>
                        )}
                      </td>
                      <td className="py-2 text-center text-gray-700">{c.quantity ?? 1}</td>
                      <td className="py-2 text-right text-gray-700">—</td>
                      <td className="py-2 text-right font-medium text-gray-800">
                        {currency} {Number(c.amount).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Total */}
            <div className="border-t-2 border-gray-200 pt-3">
              {extraTotal > 0 && (
                <div className="flex justify-between items-center text-sm text-gray-500 mb-1">
                  <span>Extras subtotal</span>
                  <span>{currency} {extraTotal.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-base font-black text-slate-900 uppercase tracking-widest">
                  Total Amount
                </span>
                <span className={`text-3xl font-black ${isCancelled ? (refundDue > 0 ? 'text-rose-600' : 'text-slate-400') : 'text-slate-950'}`}>
                  {currency} {grandTotal.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center mt-1">
                <span className="text-xs text-gray-400">Booking Status</span>
                <span
                  className={`text-xs font-semibold uppercase px-2 py-0.5 rounded-full ${
                    booking.status === 'checked_out'
                      ? 'bg-gray-100 text-gray-600'
                      : booking.status === 'checked_in'
                      ? 'bg-blue-100 text-blue-700'
                      : booking.status === 'confirmed'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-red-100 text-red-600'
                  }`}
                >
                  {booking.status?.replace('_', ' ')}
                </span>
              </div>
              <div className="flex justify-between items-center mt-1">
                <span className="text-xs text-gray-400">Payment</span>
                <span
                  className={`text-xs font-semibold uppercase px-2 py-0.5 rounded-full ${
                    booking.payment_status === 'paid'
                      ? 'bg-green-100 text-green-700'
                      : booking.payment_status === 'partial'
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-red-100 text-red-600'
                  }`}
                >
                  {booking.payment_status === 'paid'
                    ? '✅ Paid'
                    : booking.payment_status === 'partial'
                    ? `⚡ Partial — ${currency} ${Number(booking.amount_paid || 0).toFixed(2)} paid`
                    : '❌ Unpaid'}
                </span>
              </div>
            </div>

            {/* Notes */}
            {stripGroupTag(booking.notes) && (
              <div className="mt-4 p-3 bg-yellow-50 rounded-lg text-xs text-gray-600">
                <span className="font-semibold">Notes: </span>
                {stripGroupTag(booking.notes)}
              </div>
            )}

            {/* Removed Booking Activity timeline from guest view as requested */}

            {/* Footer */}
            <div className="mt-8 pt-4 border-t border-dashed border-gray-300 text-center text-xs text-gray-400 space-y-1">
              <p className="font-medium text-gray-500">Thank you for choosing {lodgeName}!</p>
              <p>We hope to welcome you again soon.</p>
              {companyName && (
                <p className="mt-2 text-gray-300">— {companyName} —</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
