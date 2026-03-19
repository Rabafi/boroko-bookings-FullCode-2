import { useState, useEffect } from 'react'
import { Printer, X, Download } from 'lucide-react'
import { useSettings } from '../../App'

export function Receipt({ booking, onClose }) {
  const { settings } = useSettings()
  const [charges, setCharges] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.charges.getByBooking(booking.id).then(setCharges).catch(() => {})
  }, [booking.id])

  const nights = Math.max(
    0,
    Math.ceil(
      (new Date(booking.check_out) - new Date(booking.check_in)) / (1000 * 60 * 60 * 24)
    )
  )

  const currency = settings?.currency || 'P'
  const ratePerNight = Number(booking.rate_per_night || 0)
  const roomSubtotal = ratePerNight * nights
  const extraTotal = charges.reduce((sum, c) => sum + Number(c.amount || 0), 0)
  const grandTotal = roomSubtotal + extraTotal

  const issueDate = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  })
  const receiptNo = booking.booking_number || `RCP-${String(booking.id).slice(0, 8).toUpperCase()}`

  const logo = settings?.logo || ''
  const lodgeName = settings?.lodge_name || 'Lodge'
  const companyName = settings?.company_name || ''
  const address = [settings?.address, settings?.city, settings?.country].filter(Boolean).join(', ')
  const phone = settings?.phone || ''
  const email = settings?.email || ''
  const website = settings?.website || ''
  const vatNumber = settings?.vat_number || ''

  const handlePrint = () => window.print()

  const handleSavePDF = async () => {
    setSaving(true)
    try {
      await window.api.receipts.savePDF(booking.customer_name)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 no-print">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-auto">
          {/* Modal Header */}
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
              <button
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Receipt Content */}
          <div id="printable-receipt" className="p-8">
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
              <h1 className="text-2xl font-bold text-green-800 tracking-wide uppercase">
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
            <div className="border-t-2 border-green-700 mb-1" />
            <div className="border-t border-green-300 mb-5" />

            {/* Receipt Title & Number */}
            <div className="flex justify-between items-start mb-5">
              <div>
                <h2 className="text-lg font-bold text-gray-800 uppercase tracking-wider">
                  Receipt / Invoice
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Receipt No: <span className="font-semibold text-gray-700">{receiptNo}</span>
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
                  <p className="font-semibold text-gray-800">Room {booking.room_number}</p>
                  <p className="text-xs text-gray-500">{booking.room_type}</p>
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
                      Room {booking.room_number} — {booking.room_type}
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
                <span className="text-base font-bold text-gray-800 uppercase tracking-wide">
                  Total
                </span>
                <span className="text-2xl font-bold text-green-700">
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
            {booking.notes && (
              <div className="mt-4 p-3 bg-yellow-50 rounded-lg text-xs text-gray-600">
                <span className="font-semibold">Notes: </span>
                {booking.notes}
              </div>
            )}

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
