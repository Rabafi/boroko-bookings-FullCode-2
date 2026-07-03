import { useEffect, useState, useRef } from 'react'
import { Plus, Search, MoreVertical, FileText, Building2, BedDouble } from 'lucide-react'
import { Modal } from './shared/Modal'
import HorizontalScrollArea from './shared/HorizontalScrollArea'
import { DESKTOP_PAYMENT_METHODS } from '../constants/paymentMethods'
import { useAuth, useSettings } from '../app-context'
import { localToday } from '../utils/localDate'

// ─── Constants ────────────────────────────────────────────────────────────────

const PAYMENT_METHODS = DESKTOP_PAYMENT_METHODS

const STATUS_OPTIONS = ['all', 'draft', 'sent', 'accepted', 'expired', 'cancelled', 'converted']

const emptyForm = {
  quotation_type:'room',
  customer_id:    '',
  customer_name:  '',
  customer_phone: '',
  event_name:     '',
  event_daily_rate:'',
  room_id:        '',
  room_name:      '',
  accommodation_lines: [],
  check_in:       '',
  check_out:      '',
  adults:         1,
  children:       0,
  subtotal:       '',
  tax_amount:     0,
  total_amount:   '',
  currency:       'BWP',
  valid_until:    '',
  notes:          ''
}

// ─── WhatsApp Helpers ─────────────────────────────────────────────────────────

function formatWaPhone(phone) {
  if (!phone) return ''
  let p = phone.replace(/\D/g, '')
  if (p.startsWith('00')) p = p.slice(2)
  if (!p.startsWith('267') && p.length <= 8) p = '267' + p
  return p
}

function buildQuotationWhatsAppMessage(q, settings) {
  const lodge    = settings?.lodge_name || 'the Lodge'
  const currency = q.currency || settings?.currency || 'BWP'
  const isEvent  = q.quotation_type === 'exclusive_event'
  const roomLines = quotationRoomLines(q)
  const nights   = q.check_in && q.check_out
    ? Math.max(0, Math.ceil((new Date(q.check_out) - new Date(q.check_in)) / 86400000))
    : null
  const lines = [
    `Dear ${q.customer_name},`,
    '',
    `📋 *Quotation — ${lodge}*`,
    `No: ${q.quotation_number}`,
    '',
    isEvent && q.event_name ? `🏢  Event: ${q.event_name}` : null,
    quotationRoomLabel(q) ? `${isEvent ? '🏢' : '🛏️'}  ${quotationRoomLabel(q)}` : null,
    q.check_in   ? `📅  Check-in:  ${q.check_in}` : null,
    q.check_out  ? `📅  Check-out: ${q.check_out}${nights !== null ? ` (${nights} night${nights !== 1 ? 's' : ''})` : ''}` : null,
    !isEvent ? `👥  Guests: ${q.adults} adult${q.adults !== 1 ? 's' : ''}${q.children > 0 ? `, ${q.children} child${q.children !== 1 ? 'ren' : ''}` : ''}` : null,
    isEvent && Number(q.event_daily_rate) > 0 ? `💵  Daily rate: ${currency} ${Number(q.event_daily_rate).toFixed(2)}` : null,
    `💰  Total: ${currency} ${Number(q.total_amount || 0).toFixed(2)}`,
    q.valid_until ? `📆  Valid until: ${q.valid_until}` : null,
    q.notes       ? `\n📝 ${q.notes}` : null,
    '',
    `We look forward to welcoming you!`,
    settings?.phone ? `📞 ${settings.phone}` : null
  ]
  return lines
    .filter(l => l !== null && l !== undefined)
    .filter((l, i, arr) => !(l === '' && (i === 0 || arr[i - 1] === '')))
    .join('\n')
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function today() {
  return localToday()
}

function isExpired(q) {
  return q.valid_until && q.valid_until < today() && !q?.converted_booking_id && q.status !== 'converted'
}

function normalizeQuotationRow(q) {
  if (!q) return q
  const accommodationLines = Array.isArray(q.accommodation_lines) ? q.accommodation_lines : []
  const convertedBookingId = q.converted_booking_id || (q.status === 'converted' ? '__converted__' : null)
  return {
    ...q,
    quotation_type: q.quotation_type === 'exclusive_event' ? 'exclusive_event' : 'room',
    accommodation_lines: accommodationLines,
    event_name: q.quotation_type === 'exclusive_event' ? (q.event_name || q.customer_name || 'Exclusive event') : null,
    converted_booking_id: convertedBookingId,
    status: convertedBookingId ? 'converted' : (q.status || 'draft')
  }
}

function canConvert(q) {
  if (q?.converted_booking_id) return false
  if (['converted', 'cancelled'].includes(q.status)) return false
  if (!['sent', 'accepted'].includes(q.status)) return false
  return true
}

// Financial fields are locked once the quotation has been dispatched
const LOCKED_STATUSES = ['sent', 'accepted', 'converted']
function isFinanciallyLocked(q) {
  return LOCKED_STATUSES.includes(q?.status)
}

function fmt(amount, currency) {
  const safeCurrency = String(currency || 'BWP').trim()
  const currencyLabel = safeCurrency.length <= 8 && !/\d/.test(safeCurrency) ? safeCurrency : 'BWP'
  return `${currencyLabel} ${Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function quotationNights(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0
  const start = new Date(checkIn).getTime()
  const end = new Date(checkOut).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
  return Math.ceil((end - start) / 86400000)
}

function quotationRoomLines(q) {
  return Array.isArray(q?.accommodation_lines) ? q.accommodation_lines.filter(line => line?.room_id) : []
}

function quotationRoomLabel(q) {
  const lines = quotationRoomLines(q)
  if (lines.length > 1) return `${lines.length} rooms`
  return q.room_name || ''
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function QuotationStatusBadge({ status, expired }) {
  if (expired && status !== 'converted') {
    return (
      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 uppercase">
        Expired
      </span>
    )
  }
  const styles = {
    draft:     'bg-gray-100 text-gray-600',
    sent:      'bg-blue-100 text-blue-700',
    accepted:  'bg-green-100 text-green-700',
    declined:  'bg-red-100 text-red-600',
    expired:   'bg-orange-100 text-orange-700',
    cancelled: 'bg-gray-200 text-gray-500',
    converted: 'bg-emerald-100 text-emerald-700'
  }
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full uppercase ${styles[status] || styles.draft}`}>
      {status}
    </span>
  )
}

// ─── Actions Dropdown ─────────────────────────────────────────────────────────

function QuotationMenu({ q, isOpen, onToggle, onClose, onEdit, onStatusChange, onConvert, onPreview, onDuplicate, onCancel, expired }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!isOpen) return
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen, onClose])

  const isTerminal = Boolean(q?.converted_booking_id) || ['converted', 'cancelled'].includes(q.status)

  return (
    <>
      <style>{`
        @keyframes qMenuFade {
          from { opacity: 0; transform: scale(0.95); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
      <div ref={ref} className="relative inline-block">
        <button
          onClick={onToggle}
          className="p-2 rounded bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-800 transition-colors cursor-pointer"
        >
          <MoreVertical size={15} />
        </button>

        {isOpen && (
          <div
            className="absolute right-0 z-50 mt-1 w-56 bg-white rounded-lg shadow-lg border border-gray-100 py-1 text-sm origin-top-right"
            style={{ animation: 'qMenuFade 120ms ease-out' }}
          >
            {/* Preview / PDF */}
            <QMenuItem onClick={() => { onPreview(); onClose() }}>
              🖨️ Preview / PDF
            </QMenuItem>

            {/* Duplicate — always available */}
            <QMenuItem onClick={() => { onDuplicate(); onClose() }}>
              📋 Duplicate Quotation
            </QMenuItem>

            <QDivider />

            {/* Edit */}
            <QMenuItem
              disabled={isTerminal}
              onClick={() => { onEdit(); onClose() }}
            >
              ✏️ Edit Quotation
            </QMenuItem>

            <QDivider />

            {/* Status changes */}
            {!isTerminal && q.status !== 'sent' && (
              <QMenuItem onClick={() => { onStatusChange('sent'); onClose() }}>
                📤 Mark as Sent
              </QMenuItem>
            )}
            {q.status === 'sent' && (
              <QMenuItem color="green" onClick={() => { onStatusChange('accepted'); onClose() }}>
                ✅ Mark as Accepted
              </QMenuItem>
            )}

            {/* Convert */}
            {canConvert(q) && (
              <>
                <QDivider />
                <QMenuItem
                  color="primary"
                  disabled={expired}
                  title={expired ? 'Quotation has expired — edit valid_until to re-enable' : undefined}
                  onClick={() => { onConvert(); onClose() }}
                >
                  🔄 {q.quotation_type === 'exclusive_event' ? 'Reserve Full Lodge' : 'Convert to Booking'}
                </QMenuItem>
              </>
            )}

            {/* Cancel */}
            {!isTerminal && (
              <>
                <QDivider />
                <QMenuItem color="red" onClick={() => { onCancel(); onClose() }}>
                  🚫 Cancel Quotation
                </QMenuItem>
              </>
            )}
          </div>
        )}
      </div>
    </>
  )
}

function QMenuItem({ children, onClick, disabled, color, title }) {
  const colors = {
    default: 'text-gray-700 hover:bg-gray-50',
    green:   'text-green-600 hover:bg-green-50',
    red:     'text-red-500 hover:bg-red-50',
    primary: 'text-blue-700 font-semibold hover:bg-blue-50'
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`w-full text-left px-3 py-2 text-sm transition-colors
        ${disabled ? 'opacity-40 cursor-not-allowed text-gray-400' : `cursor-pointer ${colors[color] || colors.default}`}`}
    >
      {children}
    </button>
  )
}

function QDivider() {
  return <div className="my-1 border-t border-gray-100" />
}

// ─── Quotation Preview / PDF ──────────────────────────────────────────────────

function QuotationPreview({ quotation: q, settings, onClose, onConvert, canConvertQ, onStatusSent, onAccept }) {
  const [pdfError, setPdfError] = useState('')
  const currency = q.currency || settings?.currency || 'BWP'
  const isEvent  = q.quotation_type === 'exclusive_event'
  const nights   = q.check_in && q.check_out
    ? Math.max(0, Math.ceil((new Date(q.check_out) - new Date(q.check_in)) / 86400000))
    : null
  const phone    = q.customer_phone || ''
  const waPhone  = formatWaPhone(phone)
  const expired  = isExpired(q)

  async function handleDownload() {
    setPdfError('')
    // savePDF now takes (id, number, name) — backend auto-marks 'sent'
    const res = await window.api.quotations.savePDF(q.id, q.quotation_number, q.customer_name)
    if (!res.success) { setPdfError(res.error || 'Failed to save PDF.'); return }
    if (onStatusSent) onStatusSent()
  }

  function handlePrint() {
    window.print()
  }

  async function handleWhatsApp() {
    if (!waPhone) { setPdfError('No phone number on file for this customer.'); return }
    const msg  = buildQuotationWhatsAppMessage(q, settings)
    const url  = `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`
    window.api.shell.openExternal(url)
  }

  // Issue date: created_at or today
  const issueDate = q.created_at ? q.created_at.split('T')[0] : today()

  return (
    <>
      {/* Backdrop — sibling, never a parent of the printable content */}
      <div className="fixed inset-0 bg-black/50 z-50 no-print" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:p-0 print:static print:bg-white">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-auto print:max-h-none print:overflow-visible print:shadow-none print:rounded-none">

          {/* Toolbar — screen only */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 no-print">
            <span className="font-semibold text-gray-700">Quotation Preview</span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDownload}
                className="text-xs px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-700 font-medium transition-colors cursor-pointer"
              >
                ⬇ Download PDF
              </button>
              <button
                onClick={handlePrint}
                className="text-xs px-3 py-1.5 rounded bg-gray-600 text-white hover:bg-gray-700 font-medium transition-colors cursor-pointer"
              >
                🖨 Print
              </button>
              {waPhone && (
                <button
                  onClick={handleWhatsApp}
                  className="text-xs px-3 py-1.5 rounded font-medium transition-colors cursor-pointer"
                  style={{ background: '#25D366', color: '#fff' }}
                  onMouseOver={e => e.currentTarget.style.background = '#1ebe5d'}
                  onMouseOut={e  => e.currentTarget.style.background = '#25D366'}
                >
                  WhatsApp
                </button>
              )}
              {q.status === 'sent' && onAccept && (
                <button
                  onClick={onAccept}
                  className="text-xs px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-700 font-medium transition-colors cursor-pointer"
                >
                  ✅ Accepted
                </button>
              )}
              {canConvertQ && !expired && (
                <button
                  onClick={onConvert}
                  className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 font-medium transition-colors cursor-pointer"
                >
                  🔄 Convert
                </button>
              )}
              <button
                onClick={onClose}
                className="text-xs px-3 py-1.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 font-medium transition-colors cursor-pointer"
              >
                ✕ Close
              </button>
            </div>
          </div>

          {pdfError && (
            <div className="mx-5 mt-3 bg-red-50 text-red-600 text-xs px-3 py-2 rounded-lg no-print">
              {pdfError}
            </div>
          )}

          {/* Printable content */}
          <div id="printable-quotation" className="p-8 print:max-h-none print:overflow-visible">

            {/* Lodge header */}
            <div className="flex items-start justify-between mb-4">
              <div>
                {settings?.logo_url && (
                  <img src={settings.logo_url} alt="Lodge logo" className="h-14 mb-2 object-contain" />
                )}
                <h2 className="text-lg font-bold text-gray-900">{settings?.lodge_name || 'Lodge'}</h2>
                {settings?.address && <p className="text-xs text-gray-500">{settings.address}</p>}
                {settings?.phone   && <p className="text-xs text-gray-500">Tel: {settings.phone}</p>}
                {settings?.email   && <p className="text-xs text-gray-500">{settings.email}</p>}
              </div>
              <div className="text-right">
                <span className="text-2xl font-extrabold tracking-widest text-green-700 uppercase">
                  Quotation
                </span>
                <p className="text-xs text-gray-500 mt-1">No: <span className="font-mono font-semibold text-gray-800">{q.quotation_number}</span></p>
                <p className="text-xs text-gray-500">Issued: {issueDate}</p>
                {q.valid_until && (
                  <p className="text-xs text-gray-500">Valid until: <span className={expired ? 'text-red-500 font-semibold' : 'text-gray-700 font-semibold'}>{q.valid_until}</span></p>
                )}
              </div>
            </div>

            {/* Double rule */}
            <div className="border-t-4 border-green-600 mb-1" />
            <div className="border-t border-green-300 mb-5" />

            {/* Prepared for */}
            <div className="bg-gray-50 rounded-lg p-4 mb-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Prepared For</p>
              <p className="text-base font-bold text-gray-900">{q.customer_name}</p>
              {phone && <p className="text-sm text-gray-500">{phone}</p>}
            </div>

            {/* Details table */}
            <table className="w-full text-sm mb-5 border border-gray-200 rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-green-600 text-white text-xs uppercase">
                  <th className="px-4 py-2 text-left">Detail</th>
                  <th className="px-4 py-2 text-left">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isEvent && q.event_name && (
                  <tr className="bg-white">
                    <td className="px-4 py-2 text-gray-500 font-medium">Event / Group</td>
                    <td className="px-4 py-2 text-gray-800">{q.event_name}</td>
                  </tr>
                )}
                {quotationRoomLabel(q) && (
                  <tr className={isEvent ? 'bg-gray-50' : 'bg-white'}>
                    <td className="px-4 py-2 text-gray-500 font-medium">{isEvent ? 'Reservation' : 'Room'}</td>
                    <td className="px-4 py-2 text-gray-800">{quotationRoomLabel(q)}</td>
                  </tr>
                )}
                {!isEvent && roomLines.length > 1 && roomLines.map((line, index) => {
                  return (
                    <tr key={`${line.room_id}-${index}`} className={index % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                      <td className="px-4 py-2 text-gray-500 font-medium">Room line {index + 1}</td>
                      <td className="px-4 py-2 text-gray-800">
                        {line.room_name || `Room ${index + 1}`} · {line.adults || 1} adult{Number(line.adults || 1) !== 1 ? 's' : ''}{Number(line.children || 0) > 0 ? `, ${line.children} child${Number(line.children) !== 1 ? 'ren' : ''}` : ''} · {fmt(line.amount, currency)}
                      </td>
                    </tr>
                  )
                })}
                {q.check_in && (
                  <tr className="bg-gray-50">
                    <td className="px-4 py-2 text-gray-500 font-medium">Check-in</td>
                    <td className="px-4 py-2 text-gray-800">{q.check_in}</td>
                  </tr>
                )}
                {q.check_out && (
                  <tr className="bg-white">
                    <td className="px-4 py-2 text-gray-500 font-medium">Check-out</td>
                    <td className="px-4 py-2 text-gray-800">
                      {q.check_out}
                      {nights !== null && <span className="text-gray-400 ml-2">({nights} night{nights !== 1 ? 's' : ''})</span>}
                    </td>
                  </tr>
                )}
                {isEvent ? (
                  <tr className="bg-gray-50">
                    <td className="px-4 py-2 text-gray-500 font-medium">Whole-lodge daily rate</td>
                    <td className="px-4 py-2 text-gray-800">{fmt(q.event_daily_rate, currency)}</td>
                  </tr>
                ) : (
                  <tr className="bg-gray-50">
                    <td className="px-4 py-2 text-gray-500 font-medium">Guests</td>
                    <td className="px-4 py-2 text-gray-800">
                      {q.adults} adult{q.adults !== 1 ? 's' : ''}
                      {q.children > 0 ? `, ${q.children} child${q.children !== 1 ? 'ren' : ''}` : ''}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* Total */}
            <div className="flex justify-end mb-5">
              <div className="bg-green-50 border border-green-200 rounded-lg px-6 py-4 text-right min-w-48">
                <p className="text-xs text-green-600 font-semibold uppercase tracking-wider mb-1">Total Amount</p>
                <p className="text-2xl font-extrabold text-green-700">
                  {currency} {Number(q.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>

            {/* Notes */}
            {q.notes && (
              <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-4 mb-5">
                <p className="text-xs font-semibold text-yellow-700 uppercase tracking-wider mb-1">Notes</p>
                <p className="text-sm text-gray-700 whitespace-pre-line">{q.notes}</p>
              </div>
            )}

            {/* Footer */}
            <div className="border-t border-gray-200 pt-4 mt-4 text-center">
              <p className="text-xs text-gray-400">
                Thank you for considering {settings?.lodge_name || 'us'} — we look forward to {isEvent ? 'hosting your event' : 'welcoming you'}!
              </p>
              {(settings?.phone || settings?.email) && (
                <p className="text-xs text-gray-400 mt-1">
                  {[settings?.phone, settings?.email].filter(Boolean).join('  ·  ')}
                </p>
              )}
            </div>

          </div>{/* /printable-quotation */}
        </div>
      </div>
    </>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Quotations() {
  const { user }     = useAuth()
  const { settings } = useSettings()
  const currency     = settings?.currency || 'BWP'

  // Data
  const [quotations, setQuotations] = useState([])
  const [customers,  setCustomers]  = useState([])
  const [rooms,      setRooms]      = useState([])

  // UI state
  const [loading,      setLoading]      = useState(false)
  const [pageError,    setPageError]    = useState('')
  const [search,       setSearch]       = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [openMenuId,   setOpenMenuId]   = useState(null)

  // Create / Edit modal
  const [showModal,       setShowModal]       = useState(false)
  const [editingId,       setEditingId]       = useState(null)
  const [form,            setForm]            = useState(emptyForm)
  const [formError,       setFormError]       = useState('')
  const [saving,          setSaving]          = useState(false)
  const [financialLocked, setFinancialLocked] = useState(false)
  const [useNewCustomer,  setUseNewCustomer]  = useState(true)
  const [newCustomer,     setNewCustomer]     = useState({ name: '', phone: '', email: '' })

  // Preview / PDF
  const [previewTarget, setPreviewTarget] = useState(null)

  // Convert modal
  const [convertTarget,  setConvertTarget]  = useState(null)
  const [convertDeposit, setConvertDeposit] = useState('')
  const [convertMethod,  setConvertMethod]  = useState('cash')
  const [converting,     setConverting]     = useState(false)
  const [convertError,   setConvertError]   = useState('')
  const [convertSuccess, setConvertSuccess] = useState('')
  const [convertWarning, setConvertWarning] = useState('')  // amber — booking converted but deposit failed

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setPageError('')
    try {
      const [q, c, r, bookings] = await Promise.all([
        window.api.quotations.getAll(),
        window.api.customers.getAll().catch(() => []),
        window.api.rooms.getAll().catch(() => []),
        window.api.bookings.getAll().catch(() => [])
      ])
      const convertedQuotationMap = new Map(
        (bookings || [])
          .filter((booking) => booking?.quotation_id)
          .map((booking) => [booking.quotation_id, booking.id])
      )
      setQuotations((q || []).map((row) => normalizeQuotationRow({
        ...row,
        converted_booking_id: row?.converted_booking_id || convertedQuotationMap.get(row?.id) || null
      })))
      setCustomers(c || [])
      setRooms(r || [])
    } catch (e) {
      console.error('Failed to load quotations:', e)
      setPageError(e?.message || 'Could not load quotations right now. Please try again.')
    }
    setLoading(false)
  }

  // ── Filter ────────────────────────────────────────────────────────────────

  const filtered = quotations.filter(q => {
    const matchSearch =
      !search ||
      (q.quotation_number || '').toLowerCase().includes(search.toLowerCase()) ||
      (q.customer_name   || '').toLowerCase().includes(search.toLowerCase()) ||
      (q.event_name      || '').toLowerCase().includes(search.toLowerCase())
    const matchStatus =
      filterStatus === 'all' ||
      (filterStatus === 'expired' ? isExpired(q) : q.status === filterStatus)
    return matchSearch && matchStatus
  })

  function upsertQuotation(nextQuotation) {
    setQuotations((prev) => [
      normalizeQuotationRow(nextQuotation),
      ...prev.filter((q) => q.id !== nextQuotation.id)
    ])
  }

  // ── Create / Edit ─────────────────────────────────────────────────────────

  function openCreate() {
    setPageError('')
    setEditingId(null)
    setForm({ ...emptyForm, currency })
    setFormError('')
    setFinancialLocked(false)
    setUseNewCustomer(true)
    setNewCustomer({ name: '', phone: '', email: '' })
    setShowModal(true)
  }

  function openEdit(q) {
    setPageError('')
    setEditingId(q.id)
    setUseNewCustomer(false)
    setForm({
      quotation_type:q.quotation_type === 'exclusive_event' ? 'exclusive_event' : 'room',
      customer_id:    q.customer_id    || '',
      customer_name:  q.customer_name  || '',
      customer_phone: q.customer_phone || '',
      event_name:     q.event_name     || '',
      event_daily_rate:q.event_daily_rate ?? '',
      room_id:        q.room_id        || '',
      room_name:      q.room_name      || '',
      accommodation_lines: quotationRoomLines(q),
      check_in:       q.check_in       || '',
      check_out:      q.check_out      || '',
      adults:         q.adults         || 1,
      children:       q.children       || 0,
      subtotal:       q.subtotal       ?? q.total_amount ?? '',
      tax_amount:     q.tax_amount     ?? 0,
      total_amount:   q.total_amount   || '',
      currency:       q.currency       || 'BWP',
      valid_until:    q.valid_until    || '',
      notes:          q.notes          || ''
    })
    setFormError('')
    setFinancialLocked(isFinanciallyLocked(q))
    setShowModal(true)
  }

  function addRoomLine() {
    setForm(f => ({
      ...f,
      accommodation_lines: [
        ...(Array.isArray(f.accommodation_lines) ? f.accommodation_lines : []),
        { room_id: '', adults: Number(f.adults || 1), children: Number(f.children || 0), amount: '' }
      ]
    }))
  }

  function updateRoomLine(index, patch) {
    setForm(f => {
      const lines = Array.isArray(f.accommodation_lines) ? [...f.accommodation_lines] : []
      lines[index] = { ...(lines[index] || {}), ...patch }
      const total = lines.reduce((sum, line) => sum + Number(line.amount || 0), 0)
      return { ...f, accommodation_lines: lines, total_amount: total > 0 ? total : f.total_amount, subtotal: total > 0 ? total : f.subtotal }
    })
  }

  function removeRoomLine(index) {
    setForm(f => {
      const lines = (Array.isArray(f.accommodation_lines) ? f.accommodation_lines : []).filter((_, i) => i !== index)
      const total = lines.reduce((sum, line) => sum + Number(line.amount || 0), 0)
      return { ...f, accommodation_lines: lines, total_amount: total > 0 ? total : '', subtotal: total > 0 ? total : '' }
    })
  }

  async function handleSave(e) {
    e.preventDefault()
    setFormError('')

    if (useNewCustomer && !editingId) {
      if (!newCustomer.name.trim()) { setFormError('Guest name is required.'); return }
    } else {
      if (!form.customer_id) { setFormError('Please select a customer.'); return }
    }
    const isEvent = form.quotation_type === 'exclusive_event'
    const accommodationLines = !isEvent
      ? (Array.isArray(form.accommodation_lines) ? form.accommodation_lines : [])
          .filter(line => line?.room_id)
          .map(line => {
            const selectedRoom = rooms.find(r => r.id === line.room_id)
            return {
              room_id: line.room_id,
              room_name: line.room_name || (selectedRoom?.room_number ? `Room ${selectedRoom.room_number}` : ''),
              adults: Math.max(1, Number(line.adults || 1)),
              children: Math.max(0, Number(line.children || 0)),
              amount: Math.max(0, Number(line.amount || 0))
            }
          })
      : []
    const roomLineTotal = accommodationLines.reduce((sum, line) => sum + Number(line.amount || 0), 0)
    const quotedTotal = accommodationLines.length > 0 ? roomLineTotal : Number(form.total_amount || 0)
    if (!isEvent && (!quotedTotal || quotedTotal <= 0)) { setFormError('Enter a valid amount.'); return }
    if (!isEvent && accommodationLines.some(line => Number(line.amount || 0) <= 0)) { setFormError('Each selected room needs a valid quoted amount.'); return }
    if (!isEvent && new Set(accommodationLines.map(line => line.room_id)).size !== accommodationLines.length) { setFormError('Each room can only be selected once.'); return }
    if (form.check_in && form.check_out && form.check_out <= form.check_in) {
      setFormError('Check-out must be after check-in.')
      return
    }
    if (isEvent) {
      if (!form.event_name.trim()) { setFormError('Event / group name is required.'); return }
      if (!form.check_in || !form.check_out) { setFormError('Event check-in and check-out dates are required.'); return }
      if (Number(form.event_daily_rate || 0) <= 0) { setFormError('Enter a valid whole-lodge daily rate.'); return }
    }

    setSaving(true)

    let customerId = form.customer_id
    if (useNewCustomer && !editingId) {
      const res = await window.api.customers.create({
        name: newCustomer.name.trim(),
        phone: newCustomer.phone.trim() || '',
        email: newCustomer.email.trim() || ''
      })
      if (!res.success) { setFormError(res.error || 'Failed to create customer.'); setSaving(false); return }
      customerId = res.id
      setCustomers(prev => [...prev, {
        id: res.id,
        name: newCustomer.name.trim(),
        phone: newCustomer.phone.trim() || '',
        email: newCustomer.email.trim() || ''
      }])
    }

    const customer = customers.find(c => c.id === customerId)
    const room     = !isEvent ? rooms.find(r => r.id === form.room_id) : null
    const eventTotal = isEvent
      ? Number(form.event_daily_rate || 0) * quotationNights(form.check_in, form.check_out)
      : 0
    const subtotal    = isEvent ? eventTotal : quotedTotal
    const tax_amount  = isEvent ? 0 : Number(form.tax_amount || 0)
    const data = {
      ...form,
      customer_id:    customerId,
      customer_name:  customer?.name  || newCustomer.name.trim() || form.customer_name,
      customer_phone: customer?.phone || newCustomer.phone.trim() || form.customer_phone || '',
      quotation_type: isEvent ? 'exclusive_event' : 'room',
      event_name:     isEvent ? form.event_name.trim() : null,
      event_daily_rate:isEvent ? Number(form.event_daily_rate || 0) : null,
      room_id:        isEvent ? '' : (accommodationLines[0]?.room_id || form.room_id),
      room_name:      isEvent ? 'Full Lodge' : accommodationLines.length > 1 ? `${accommodationLines.length} rooms` : room?.room_number ? `Room ${room.room_number}` : form.room_name,
      accommodation_lines: isEvent ? [] : accommodationLines,
      adults:         isEvent ? 1 : (accommodationLines[0]?.adults || form.adults),
      children:       isEvent ? 0 : (accommodationLines[0]?.children || form.children),
      subtotal,
      tax_amount,
      total_amount:   subtotal + tax_amount
    }

    if (editingId) {
      const existing = quotations.find(q => q.id === editingId)
      const res = await window.api.quotations.update(editingId, { ...data, status: existing?.status || 'draft' })
      if (!res.success) { setFormError(res.error || 'Update failed.'); setSaving(false); return }
      upsertQuotation({
        ...(existing || {}),
        ...data,
        id: editingId,
        status: existing?.status || 'draft',
        updated_at: new Date().toISOString()
      })
    } else {
      const res = await window.api.quotations.create(data)
      if (!res.success) { setFormError(res.error || 'Create failed.'); setSaving(false); return }
      const createdAt = new Date().toISOString()
      upsertQuotation({
        id: res.id,
        quotation_number: res.quotation_number,
        ...data,
        status: 'draft',
        created_at: createdAt,
        updated_at: createdAt
      })
    }
    setSaving(false)
    setShowModal(false)
  }

  // ── Status update ─────────────────────────────────────────────────────────

  const [statusChanging, setStatusChanging] = useState(false)

  async function handleStatusChange(q, newStatus) {
    if (statusChanging) return
    setStatusChanging(true)
    try {
      setPageError('')
      const res = await window.api.quotations.update(q.id, { ...q, status: newStatus })
      if (!res?.success) {
        setPageError(res?.error || 'Could not update quotation status right now.')
        return
      }
      setQuotations((prev) => prev.map((row) => row.id === q.id
        ? normalizeQuotationRow({ ...row, status: newStatus, updated_at: new Date().toISOString() })
        : row
      ))
    } catch (e) {
      setPageError(e?.message || 'Could not update quotation status right now.')
    } finally {
      setStatusChanging(false)
    }
  }

  // ── Cancel ────────────────────────────────────────────────────────────────

  async function handleCancel(q) {
    try {
      setPageError('')
      const res = await window.api.quotations.update(q.id, { ...q, status: 'cancelled' })
      if (!res?.success) {
        setPageError(res?.error || 'Could not cancel this quotation right now.')
        return
      }
      setQuotations((prev) => prev.map((row) => row.id === q.id
        ? normalizeQuotationRow({ ...row, status: 'cancelled', updated_at: new Date().toISOString() })
        : row
      ))
    } catch (e) {
      setPageError(e?.message || 'Could not cancel this quotation right now.')
    }
  }

  // ── Duplicate ─────────────────────────────────────────────────────────────

  async function handleDuplicate(q) {
    try {
      setPageError('')
      const res = await window.api.quotations.duplicate(q.id)
      if (res.success) {
        const createdAt = new Date().toISOString()
        const newQ = {
          ...q,
          id: res.id,
          quotation_number: res.quotation_number,
          status: 'draft',
          created_at: createdAt,
          updated_at: createdAt
        }
        upsertQuotation(newQ)
        if (newQ) openEdit(newQ)
        return
      }
      setPageError(res?.error || 'Could not duplicate this quotation right now.')
    } catch (e) {
      setPageError(e?.message || 'Could not duplicate this quotation right now.')
    }
  }

  // ── Convert to booking ────────────────────────────────────────────────────

  function openConvert(q) {
    setConvertTarget(q)
    setConvertDeposit('')
    setConvertMethod('cash')
    setConvertError('')
    setConvertSuccess('')
    setConvertWarning('')
  }

  async function handleConvert(e) {
    e.preventDefault()
    setConvertError('')
    setConvertWarning('')
    setConverting(true)
    const res = await window.api.quotations.convert(
      convertTarget.id,
      Number(convertDeposit) || 0,
      convertMethod
    )
    setConverting(false)
    if (res.success) {
      setConvertSuccess(res.pendingSync
        ? `Booking queued offline. ${convertTarget.quotation_type === 'exclusive_event' ? 'The full-lodge reservation will be finalized during sync. ' : ''}Local reference: ${res.invoice_number || 'PENDING'}`
        : `${convertTarget.quotation_type === 'exclusive_event' ? 'Event / lodge booking' : 'Booking'} created! Invoice: ${res.invoice_number || '—'}`)
      setQuotations((prev) => prev.map((row) => row.id === convertTarget.id
        ? normalizeQuotationRow({ ...row, status: 'converted', converted_booking_id: res.booking_id || true, updated_at: new Date().toISOString() })
        : row
      ))
      setPreviewTarget((prev) => prev && prev.id === convertTarget.id
        ? normalizeQuotationRow({ ...prev, status: 'converted', converted_booking_id: res.booking_id || true, updated_at: new Date().toISOString() })
        : prev
      )
      if (res.depositWarning) {
        // Booking converted. Deposit failed. Show amber warning — do NOT auto-close.
        // Operator must read and manually dismiss.
        setConvertWarning(res.depositWarning)
      } else {
        setTimeout(async () => {
          await load().catch(() => {})
          setConvertTarget(null)
          setConvertSuccess('')
        }, 2800)
      }
    } else {
      setConvertError(res.error || 'Conversion failed.')
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={22} className="text-green-600" />
          <h1 className="text-xl font-bold text-gray-800">Quotations</h1>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> New Quotation
        </button>
      </div>

      {pageError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {pageError}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-9"
            placeholder="Search quotation # or customer..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input w-auto"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
        >
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{s === 'all' ? 'All statuses' : s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <HorizontalScrollArea viewportClassName="overflow-y-visible">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-5 py-3 text-left">#</th>
                <th className="px-5 py-3 text-left">Customer</th>
                <th className="px-5 py-3 text-left">Booking</th>
                <th className="px-5 py-3 text-left">Dates</th>
                <th className="px-5 py-3 text-right">Amount</th>
                <th className="px-5 py-3 text-left">Valid Until</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading && (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-gray-400">
                    Loading quotations…
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-gray-400">
                    No quotations found
                  </td>
                </tr>
              )}
              {!loading && filtered.map(q => {
                const expired = isExpired(q)
                return (
                  <tr key={q.id} className="hover:bg-gray-50">
                    {/* Quotation # */}
                    <td className="px-5 py-3 font-mono text-xs font-semibold text-gray-500">
                      {q.quotation_number}
                    </td>

                    {/* Customer */}
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-800">{q.customer_name}</p>
                      {q.customer_phone && (
                        <p className="text-xs text-gray-400">{q.customer_phone}</p>
                      )}
                    </td>

                    {/* Room */}
                    <td className="px-5 py-3 text-gray-600">
                      {q.quotation_type === 'exclusive_event' ? (
                        <div>
                          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                            <Building2 size={11} /> Full Lodge
                          </span>
                          {q.event_name && <p className="mt-1 text-xs text-gray-500">{q.event_name}</p>}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          {quotationRoomLabel(q) ? <><BedDouble size={13} className="text-gray-400" /> {quotationRoomLabel(q)}</> : <span className="text-gray-300">—</span>}
                        </span>
                      )}
                    </td>

                    {/* Dates */}
                    <td className="px-5 py-3 text-gray-600 text-xs">
                      {q.check_in && q.check_out
                        ? <>{q.check_in}<br /><span className="text-gray-400">→ {q.check_out}</span></>
                        : <span className="text-gray-300">—</span>
                      }
                    </td>

                    {/* Amount */}
                    <td className="px-5 py-3 text-right font-medium text-gray-800">
                      {fmt(q.total_amount, q.currency || currency)}
                    </td>

                    {/* Valid Until */}
                    <td className="px-5 py-3 text-xs">
                      {q.valid_until
                        ? <span className={expired ? 'text-red-500 font-medium' : 'text-gray-600'}>
                            {q.valid_until}
                          </span>
                        : <span className="text-gray-300">—</span>
                      }
                    </td>

                    {/* Status */}
                    <td className="px-5 py-3">
                      <QuotationStatusBadge status={q.status} expired={expired} />
                    </td>

                    {/* Actions */}
                    <td className="px-5 py-3 text-center relative">
                      <div className="flex items-center justify-center gap-1.5">
                        {/* Inline Preview button */}
                        <button
                          onClick={() => setPreviewTarget(q)}
                          className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 font-medium transition-colors cursor-pointer"
                        >
                          Preview
                        </button>
                        {/* Inline Convert button */}
                        {canConvert(q) && !expired && (
                          <button
                            onClick={() => openConvert(q)}
                            className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 font-medium transition-colors cursor-pointer"
                          >
                            Convert
                          </button>
                        )}
                        <QuotationMenu
                          q={q}
                          expired={expired}
                          isOpen={openMenuId === q.id}
                          onToggle={() => setOpenMenuId(prev => prev === q.id ? null : q.id)}
                          onClose={() => setOpenMenuId(null)}
                          onEdit={() => openEdit(q)}
                          onStatusChange={s => handleStatusChange(q, s)}
                          onConvert={() => openConvert(q)}
                          onPreview={() => setPreviewTarget(q)}
                          onCancel={() => handleCancel(q)}
                          onDuplicate={() => handleDuplicate(q)}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </HorizontalScrollArea>
      </div>

      {/* ── Create / Edit Modal ───────────────────────────────────────────── */}
      {showModal && (
        <Modal
          title={editingId ? 'Edit Quotation' : 'New Quotation'}
          onClose={() => setShowModal(false)}
          size="lg"
        >
          <form onSubmit={handleSave} className="space-y-4">
            {formError && (
              <div className="bg-red-50 text-red-600 text-sm px-3 py-2 rounded-lg">{formError}</div>
            )}

            {/* Financial lock warning */}
            {financialLocked && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 flex items-start gap-2">
                <span className="text-amber-500 text-base mt-0.5">⚠️</span>
                <div className="flex-1 text-xs text-amber-800">
                  <strong>Financial fields are locked</strong> — this quotation has already been sent.
                  Only notes and valid-until can be edited.
                  <br />
                  <button
                    type="button"
                    className="mt-1.5 text-blue-600 underline cursor-pointer"
                    onClick={async () => {
                      setShowModal(false)
                      const src = quotations.find(x => x.id === editingId)
                      if (src) await handleDuplicate(src)
                    }}
                  >
                    Duplicate &amp; Edit a new draft instead
                  </button>
                </div>
              </div>
            )}

            {/* Quotation type */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Booking Type
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={financialLocked}
                  onClick={() => setForm(f => ({
                    ...f,
                    quotation_type: 'room',
                    event_name: '',
                    event_daily_rate: '',
                    room_name: ''
                  }))}
                  className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                    form.quotation_type === 'room'
                      ? 'border-green-500 bg-green-50 text-green-800'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  } ${financialLocked ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold"><BedDouble size={16} /> Room Stay</span>
                  <span className="mt-1 block text-xs opacity-75">One room or an accommodation offer.</span>
                </button>
                <button
                  type="button"
                  disabled={financialLocked}
                  onClick={() => setForm(f => ({
                    ...f,
                    quotation_type: 'exclusive_event',
                    room_id: '',
                    room_name: 'Full Lodge',
                    adults: 1,
                    children: 0,
                    tax_amount: 0
                  }))}
                  className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                    form.quotation_type === 'exclusive_event'
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-800'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  } ${financialLocked ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold"><Building2 size={16} /> Event / Full Lodge</span>
                  <span className="mt-1 block text-xs opacity-75">Reserve the entire property for one group.</span>
                </button>
              </div>
            </div>

            {/* Customer */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Customer *
              </label>
              {!editingId && (
                <div className="flex gap-4 mb-2">
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                    <input type="radio" checked={useNewCustomer} onChange={() => setUseNewCustomer(true)} />
                    New Guest
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                    <input type="radio" checked={!useNewCustomer} onChange={() => setUseNewCustomer(false)} />
                    Existing Guest
                  </label>
                </div>
              )}
              {(!editingId && useNewCustomer) ? (
                <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 rounded-lg">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Full Name *</label>
                    <input
                      className="input"
                      value={newCustomer.name}
                      onChange={e => setNewCustomer(n => ({ ...n, name: e.target.value }))}
                      placeholder="Guest name"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Phone</label>
                    <input
                      className="input"
                      value={newCustomer.phone}
                      onChange={e => setNewCustomer(n => ({ ...n, phone: e.target.value }))}
                      placeholder="+267 ..."
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">Email address</label>
                    <input
                      className="input"
                      type="email"
                      value={newCustomer.email}
                      onChange={e => setNewCustomer(n => ({ ...n, email: e.target.value }))}
                      placeholder="guest@email.com"
                    />
                    <p className="mt-1 text-xs text-gray-400">Add an email here if you want this quotation to be sent by email later.</p>
                  </div>
                </div>
              ) : (
                <select
                  required
                  disabled={financialLocked}
                  className={`input ${financialLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                  value={form.customer_id}
                  onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))}
                >
                  <option value="">Select customer…</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}{c.phone ? ` — ${c.phone}` : ''}</option>
                  ))}
                </select>
              )}
            </div>

            {form.quotation_type === 'exclusive_event' ? (
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-indigo-700 uppercase tracking-wider mb-1">
                    Event / Group Name *
                  </label>
                  <input
                    className={`input ${financialLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                    disabled={financialLocked}
                    value={form.event_name}
                    onChange={e => setForm(f => ({ ...f, event_name: e.target.value }))}
                    placeholder="e.g. Smith Wedding or ABC Retreat"
                  />
                </div>
                <div className="col-span-2 text-xs text-indigo-700">
                  Conversion will reserve every bookable room and block other lodge bookings for these dates.
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Room Lines
                  </label>
                  <button
                    type="button"
                    disabled={financialLocked}
                    onClick={addRoomLine}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-green-500 hover:text-green-700 disabled:opacity-50"
                  >
                    Add Room
                  </button>
                </div>
                {(Array.isArray(form.accommodation_lines) && form.accommodation_lines.length > 0 ? form.accommodation_lines : [{ room_id: form.room_id, adults: form.adults, children: form.children, amount: form.total_amount }]).map((line, index) => (
                  <div key={index} className="grid grid-cols-12 gap-2">
                    <select
                      disabled={financialLocked}
                      className={`input col-span-5 ${financialLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                      value={line.room_id || ''}
                      onChange={e => {
                        const selectedRoom = rooms.find(r => r.id === e.target.value)
                        updateRoomLine(index, { room_id: e.target.value, room_name: selectedRoom?.room_number ? `Room ${selectedRoom.room_number}` : '' })
                        if (index === 0) setForm(f => ({ ...f, room_id: e.target.value, room_name: selectedRoom?.room_number ? `Room ${selectedRoom.room_number}` : '' }))
                      }}
                    >
                      <option value="">Select room…</option>
                      {rooms.filter(r => r.status !== 'inactive').map(r => (
                        <option key={r.id} value={r.id}>Room {r.room_number} — {r.room_type}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      disabled={financialLocked}
                      className={`input col-span-2 ${financialLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                      value={line.adults ?? 1}
                      onChange={e => updateRoomLine(index, { adults: Number(e.target.value) })}
                    />
                    <input
                      type="number"
                      min={0}
                      disabled={financialLocked}
                      className={`input col-span-2 ${financialLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                      value={line.children ?? 0}
                      onChange={e => updateRoomLine(index, { children: Number(e.target.value) })}
                    />
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      disabled={financialLocked}
                      className={`input col-span-2 ${financialLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                      value={line.amount ?? ''}
                      onChange={e => updateRoomLine(index, { amount: e.target.value })}
                      placeholder="Amount"
                    />
                    <button
                      type="button"
                      disabled={financialLocked}
                      onClick={() => removeRoomLine(index)}
                      className="col-span-1 rounded-lg border border-gray-200 text-gray-500 hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  {form.quotation_type === 'exclusive_event' ? 'Event Start *' : 'Check-in'}
                </label>
                <input
                  type="date"
                  disabled={financialLocked}
                  className={`input ${financialLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                  value={form.check_in}
                  onChange={e => setForm(f => ({ ...f, check_in: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  {form.quotation_type === 'exclusive_event' ? 'Event End *' : 'Check-out'}
                </label>
                <input
                  type="date"
                  disabled={financialLocked}
                  className={`input ${financialLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                  value={form.check_out}
                  min={form.check_in || undefined}
                  onChange={e => setForm(f => ({ ...f, check_out: e.target.value }))}
                />
              </div>
            </div>

            {/* Guests */}
            {form.quotation_type !== 'exclusive_event' && (!Array.isArray(form.accommodation_lines) || form.accommodation_lines.length === 0) && <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Adults
                </label>
                <input
                  type="number" min={1}
                  disabled={financialLocked}
                  className={`input ${financialLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                  value={form.adults}
                  onChange={e => setForm(f => ({ ...f, adults: Number(e.target.value) }))}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Children
                </label>
                <input
                  type="number" min={0}
                  disabled={financialLocked}
                  className={`input ${financialLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                  value={form.children}
                  onChange={e => setForm(f => ({ ...f, children: Number(e.target.value) }))}
                />
              </div>
            </div>}

            {/* Amount + Currency */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  {form.quotation_type === 'exclusive_event'
                    ? `Whole-Lodge Daily Rate *`
                    : financialLocked ? 'Total Amount (locked)' : 'Total Amount *'}
                </label>
                <input
                  type="number" min={0} step="0.01"
                  required={!financialLocked}
                  disabled={financialLocked}
                  className={`input ${financialLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                  placeholder="0.00"
                  value={form.quotation_type === 'exclusive_event' ? form.event_daily_rate : form.total_amount}
                  onChange={e => setForm(f => form.quotation_type === 'exclusive_event'
                    ? ({ ...f, event_daily_rate: e.target.value })
                    : ({ ...f, total_amount: e.target.value, subtotal: e.target.value }))}
                />
                {form.quotation_type === 'exclusive_event' && Number(form.event_daily_rate) > 0 && quotationNights(form.check_in, form.check_out) > 0 && (
                  <p className="mt-1.5 text-xs font-medium text-indigo-700">
                    Quoted total: {form.currency || currency} {(Number(form.event_daily_rate) * quotationNights(form.check_in, form.check_out)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    {' '}({quotationNights(form.check_in, form.check_out)} night{quotationNights(form.check_in, form.check_out) !== 1 ? 's' : ''})
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Currency
                </label>
                <input
                  type="text"
                  disabled
                  className="input opacity-70 cursor-not-allowed"
                  value={currency}
                  readOnly
                />
              </div>
            </div>

            {/* Valid Until */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Valid Until (optional)
              </label>
              <input
                type="date" className="input"
                value={form.valid_until}
                onChange={e => setForm(f => ({ ...f, valid_until: e.target.value }))}
              />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Notes
              </label>
              <textarea
                rows={3} className="input resize-none"
                placeholder="Additional details…"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>

            {/* Buttons */}
            <div className="flex gap-3 pt-1">
              <button type="submit" disabled={saving} className="btn-primary flex-1">
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Quotation'}
              </button>
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1">
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Quotation Preview / PDF ───────────────────────────────────────── */}
      {previewTarget && (
      <QuotationPreview
        quotation={previewTarget}
        settings={settings}
        canConvertQ={canConvert(previewTarget) && !isExpired(previewTarget)}
        onConvert={() => { setPreviewTarget(null); openConvert(previewTarget) }}
        onClose={() => setPreviewTarget(null)}
          onStatusSent={() => {
            setQuotations((prev) => prev.map((row) => row.id === previewTarget?.id
              ? normalizeQuotationRow({ ...row, status: 'sent', updated_at: new Date().toISOString() })
              : row
            ))
            setPreviewTarget(prev => prev ? normalizeQuotationRow({ ...prev, status: 'sent' }) : prev)
          }}
          onAccept={() => {
            if (!previewTarget) return
            handleStatusChange(previewTarget, 'accepted')
            setPreviewTarget(prev => prev ? normalizeQuotationRow({ ...prev, status: 'accepted' }) : prev)
          }}
        />
      )}

      {/* ── Convert to Booking Modal ──────────────────────────────────────── */}
      {convertTarget && (
        <Modal
          title={convertTarget.quotation_type === 'exclusive_event' ? 'Reserve Event / Full Lodge' : 'Convert to Booking'}
          onClose={() => setConvertTarget(null)}
          size="sm"
        >
          {convertSuccess ? (
            <div className="text-center py-6 space-y-2">
              <div className="text-4xl">✅</div>
              <p className="font-semibold text-green-700">{convertSuccess}</p>
              {convertWarning ? (
                <>
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2 rounded-lg text-left mt-3">
                    ⚠️ Deposit not recorded: {convertWarning}. Please record the deposit manually before closing.
                  </div>
                  <button onClick={() => { setConvertTarget(null); setConvertSuccess(''); setConvertWarning('') }} className="btn-secondary mt-3 px-6">
                    Close
                  </button>
                </>
              ) : (
                <p className="text-sm text-gray-500">Redirecting you back to quotations…</p>
              )}
            </div>
          ) : (
            <form onSubmit={handleConvert} className="space-y-4">
              {/* Quotation summary */}
              <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                <p className="font-semibold text-gray-800">{convertTarget.customer_name}</p>
                <p className="text-gray-500">{convertTarget.quotation_number}</p>
                {convertTarget.quotation_type === 'exclusive_event' && (
                  <p className="font-medium text-indigo-700">Full Lodge · {convertTarget.event_name}</p>
                )}
                {convertTarget.quotation_type !== 'exclusive_event' && quotationRoomLabel(convertTarget) && <p className="text-gray-500">{quotationRoomLabel(convertTarget)}</p>}
                <p className="font-medium text-gray-800">{fmt(convertTarget.total_amount, convertTarget.currency || currency)}</p>
              </div>

              {convertError && (
                <div className="bg-red-50 text-red-600 text-sm px-3 py-2 rounded-lg">{convertError}</div>
              )}

              {/* Deposit */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Deposit (optional)
                </label>
                <input
                  type="number" min={0} step="0.01" className="input"
                  placeholder="0.00"
                  value={convertDeposit}
                  onChange={e => setConvertDeposit(e.target.value)}
                />
              </div>

              {/* Payment method */}
              {Number(convertDeposit) > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Payment Method
                  </label>
                  <select
                    className="input"
                    value={convertMethod}
                    onChange={e => setConvertMethod(e.target.value)}
                  >
                    {PAYMENT_METHODS.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-xs text-slate-500">If you record a deposit by bank transfer, confirm POP before converting this quotation.</p>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button type="submit" disabled={converting} className="btn-primary flex-1">
                  {converting ? 'Converting…' : convertTarget.quotation_type === 'exclusive_event' ? 'Reserve Full Lodge' : 'Convert to Booking'}
                </button>
                <button type="button" onClick={() => setConvertTarget(null)} className="btn-secondary flex-1">
                  Cancel
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  )
}
