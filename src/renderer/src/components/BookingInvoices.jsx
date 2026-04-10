import { useEffect, useMemo, useState } from 'react'
import { CreditCard, FileText, Mail, Printer, Receipt, RefreshCw, RotateCcw, Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Modal } from './shared/Modal'
import { Receipt as BookingReceipt } from './shared/Receipt'
import HorizontalScrollArea from './shared/HorizontalScrollArea'
import { DESKTOP_PAYMENT_METHODS } from '../constants/paymentMethods'
import { useAuth, useSettings } from '../App'

const PAYMENT_STATUS_STYLES = {
  paid: 'bg-green-100 text-green-700',
  partial: 'bg-amber-100 text-amber-700',
  unpaid: 'bg-red-100 text-red-700'
}

const BOOKING_STATUS_STYLES = {
  confirmed: 'bg-blue-100 text-blue-700',
  checked_in: 'bg-emerald-100 text-emerald-700',
  checked_out: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-600'
}

const PAYMENT_METHODS = [
  ...DESKTOP_PAYMENT_METHODS.map((method) => ({ value: method.value, label: method.plainLabel })),
  { value: 'refund', label: 'Refund Adjustment' }
]

function fmtMoney(currency, value) {
  return `${currency} ${Number(value || 0).toFixed(2)}`
}

function fmtDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  })
}

function fmtDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatAuditAction(action) {
  const labels = {
    payment_recorded: 'Payment recorded',
    refund_recorded: 'Refund recorded',
    charge_added: 'Charge added',
    charge_deleted: 'Charge voided',
    booking_total_edited: 'Booking total updated',
    booking_status_changed: 'Booking status changed'
  }
  return labels[action] || String(action || 'Audit event').replace(/_/g, ' ')
}

function moneyLine(label, currency, value) {
  if (value == null || value === '') return null
  return `${label}: ${fmtMoney(currency, value)}`
}

function textLine(label, value) {
  if (value == null || value === '') return null
  return `${label}: ${String(value).replace(/_/g, ' ')}`
}

function buildAuditSummary(row, currency) {
  const before = row.before_snapshot || {}
  const after = row.after_snapshot || {}
  const lines = []

  if (row.action === 'payment_recorded' || row.action === 'refund_recorded') {
    lines.push(moneyLine('Transaction amount', currency, row.amount_delta))
    lines.push(textLine('Method', after.payment_method))
    lines.push(textLine('Type', after.payment_type))
    lines.push(moneyLine('Booking paid before', currency, before.amount_paid))
    lines.push(moneyLine('Booking paid after', currency, after.amount_paid ?? before.amount_paid))
    lines.push(textLine('Payment status', after.payment_status ?? before.payment_status))
  } else if (row.action === 'charge_added' || row.action === 'charge_deleted') {
    lines.push(textLine('Charge', after.description))
    lines.push(textLine('Category', after.category))
    lines.push(moneyLine('Charge amount', currency, Math.abs(Number(row.amount_delta || after.amount || 0))))
    lines.push(moneyLine('Charges total before', currency, before.charges_total))
    lines.push(moneyLine('Charges total after', currency, after.charges_total ?? before.charges_total))
    lines.push(textLine('Reason', after.void_reason))
  } else {
    lines.push(moneyLine('Amount change', currency, row.amount_delta))
    lines.push(moneyLine('Paid before', currency, before.amount_paid))
    lines.push(moneyLine('Paid after', currency, after.amount_paid))
    lines.push(moneyLine('Total before', currency, before.total_amount))
    lines.push(moneyLine('Total after', currency, after.total_amount))
    lines.push(textLine('Status before', before.payment_status))
    lines.push(textLine('Status after', after.payment_status))
  }

  return lines.filter(Boolean)
}

function formatStay(invoice) {
  const room = invoice.room_number ? `Room ${invoice.room_number}` : 'Room —'
  const checkIn = fmtDate(invoice.check_in)
  const checkOut = fmtDate(invoice.check_out)
  const nights = Number(invoice.nights || 0)
  return `${room} · ${checkIn} - ${checkOut} · ${nights}N`
}

function canRefundBooking(invoice) {
  const status = String(invoice?.status || '').toLowerCase()
  return ['pending', 'confirmed', 'cancelled'].includes(status)
}

function Badge({ value, styles }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${styles[value] || 'bg-gray-100 text-gray-600'}`}>
      {(value || 'unknown').replace(/_/g, ' ')}
    </span>
  )
}

function LedgerModal({ invoice, currency, onClose }) {
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function loadPayments() {
      setLoading(true)
      setError('')
      const result = await window.api.bookings.getPayments(invoice.booking_id).catch((e) => ({ success: false, error: e.message }))
      if (cancelled) return
      if (result?.success === false) {
        setPayments([])
        setError(result.error || 'Could not load payment history')
      } else {
        setPayments(Array.isArray(result) ? result : [])
      }
      setLoading(false)
    }
    loadPayments()
    return () => { cancelled = true }
  }, [invoice.booking_id])

  return (
    <Modal title={`Payment Ledger · ${invoice.invoice_number}`} onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-600">
          <p className="font-semibold text-gray-900">{invoice.customer_name || 'Walk-in Guest'}</p>
          <p className="mt-1">{formatStay(invoice)}</p>
          <p className="mt-2">
            Total {fmtMoney(currency, invoice.total_amount)} · Paid {fmtMoney(currency, invoice.amount_paid)} · Balance {fmtMoney(currency, invoice.balance_due)}
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-3 py-10 text-sm text-gray-500">
            <RefreshCw size={16} className="animate-spin" />
            Loading payment history…
          </div>
        ) : payments.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 px-6 py-10 text-center text-sm text-gray-500">
            No payment events have been recorded for this booking yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-[0.16em] text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">When</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Method</th>
                  <th className="px-4 py-3 text-right font-semibold">Amount</th>
                  <th className="px-4 py-3 font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id || `${payment.paid_at}-${payment.amount}`} className="border-t border-gray-100">
                    <td className="px-4 py-3 text-gray-600">{fmtDateTime(payment.paid_at || payment.created_at)}</td>
                    <td className="px-4 py-3">
                      <Badge
                        value={payment.type}
                        styles={{
                          payment: 'bg-green-100 text-green-700',
                          deposit: 'bg-blue-100 text-blue-700',
                          refund: 'bg-rose-100 text-rose-700'
                        }}
                      />
                    </td>
                    <td className="px-4 py-3 text-gray-700">{String(payment.method || '—').replace(/_/g, ' ')}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${Number(payment.amount || 0) < 0 ? 'text-rose-700' : 'text-gray-900'}`}>
                      {fmtMoney(currency, payment.amount)}
                    </td>
                    <td className="px-4 py-3 text-xs leading-5 text-gray-500">{payment.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  )
}

function AuditModal({ invoice, currency, onClose }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function loadAudit() {
      setLoading(true)
      setError('')
      const result = await window.api.reports.financialAudit({
        bookingId: invoice.booking_id,
        limit: 80,
        offset: 0
      }).catch((e) => ({ success: false, error: e.message }))
      if (cancelled) return
      if (result?.success === false) {
        setRows([])
        setError(result.error || 'Could not load financial audit history')
      } else {
        setRows(Array.isArray(result) ? result : [])
      }
      setLoading(false)
    }
    loadAudit()
    return () => { cancelled = true }
  }, [invoice.booking_id])

  return (
    <Modal title={`Financial Audit · ${invoice.invoice_number}`} onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-600">
          <p className="font-semibold text-gray-900">{invoice.customer_name || 'Walk-in Guest'}</p>
          <p className="mt-1">{formatStay(invoice)}</p>
          <p className="mt-2">Invoice {invoice.invoice_number} · Total {fmtMoney(currency, invoice.total_amount)} · Balance {fmtMoney(currency, invoice.balance_due)}</p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-3 py-10 text-sm text-gray-500">
            <RefreshCw size={16} className="animate-spin" />
            Loading audit trail…
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 px-6 py-10 text-center text-sm text-gray-500">
            No financial audit rows were returned for this booking.
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <div key={row.id} className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge
                      value={row.action}
                      styles={{
                        payment_recorded: 'bg-green-100 text-green-700',
                        refund_recorded: 'bg-rose-100 text-rose-700',
                        charge_added: 'bg-blue-100 text-blue-700',
                        charge_deleted: 'bg-amber-100 text-amber-700',
                        booking_total_edited: 'bg-purple-100 text-purple-700',
                        booking_status_changed: 'bg-gray-100 text-gray-700'
                      }}
                    />
                    <span className="text-sm font-semibold text-gray-900">{formatAuditAction(row.action)}</span>
                    <span className="text-xs text-gray-500">{fmtDateTime(row.created_at)}</span>
                  </div>
                  <span className={`text-sm font-semibold ${Number(row.amount_delta || 0) < 0 ? 'text-rose-700' : 'text-gray-900'}`}>
                    {row.amount_delta == null ? 'No amount' : fmtMoney(currency, row.amount_delta)}
                  </span>
                </div>
                <div className="mt-3 rounded-xl bg-gray-50 p-4">
                  <div className="grid gap-2">
                    {buildAuditSummary(row, currency).map((line, index) => (
                      <p key={`${row.id}-summary-${index}`} className="text-sm text-gray-700">{line}</p>
                    ))}
                  </div>
                  {(row.after_snapshot?.notes || row.after_snapshot?.void_reason || row.after_snapshot?.payment_id) && (
                    <div className="mt-3 border-t border-gray-200 pt-3 text-xs text-gray-500">
                      {row.after_snapshot?.payment_id && <p>Reference: {row.after_snapshot.payment_id}</p>}
                      {row.after_snapshot?.void_reason && <p>Void reason: {row.after_snapshot.void_reason}</p>}
                      {row.after_snapshot?.notes && <p>Notes: {row.after_snapshot.notes}</p>}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

function DeliveryHistoryModal({ invoice, onClose }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const data = await window.api.reports.invoiceDeliveryHistory({ bookingId: invoice.booking_id, limit: 50 })
        if (cancelled) return
        setRows(Array.isArray(data) ? data : [])
      } catch (err) {
        if (cancelled) return
        setError(err.message || 'Could not load delivery history.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [invoice.booking_id])

  return (
    <Modal title={`Delivery History · ${invoice.invoice_number}`} onClose={onClose} size="lg">
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Email sends, receipt downloads, and print events are recorded here in append-only order.
        </p>
        {loading ? (
          <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
            Loading delivery history…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
            No invoice or receipt delivery events recorded yet.
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <div key={row.entry_hash || row.id} className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900">
                    {String(row.delivery_type || 'delivery').replace(/_/g, ' ')}
                  </p>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    row.delivery_status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                  }`}>
                    {row.delivery_status || 'completed'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-600">
                  {row.recipient || row.file_path || 'No destination recorded'} · {fmtDateTime(row.created_at)}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  By {row.initiated_by_name || 'System'}{row.local_only ? ' · pending server history sync' : ''}
                </p>
                {(row.entry_hash || row.previous_hash) && (
                  <p className="mt-1 break-all text-[11px] text-gray-400">
                    Hash {row.entry_hash || 'pending'}{row.previous_hash ? ` · prev ${row.previous_hash}` : ''}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

function RefundModal({ invoice, currency, onClose, onSaved }) {
  const [form, setForm] = useState({
    retained_percent: 0,
    method: 'bank_transfer',
    notes: '',
    proof_reference: '',
    approval_note: '',
    approver_pin: ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const paidAmount = Math.max(0, Number(invoice.amount_paid || 0))
  const retainedPercent = Math.min(100, Math.max(0, Number(form.retained_percent || 0)))
  const retainedAmount = paidAmount * (retainedPercent / 100)
  const refundAmount = Math.max(0, paidAmount - retainedAmount)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    const result = await window.api.bookings.refund(invoice.booking_id, {
      retained_percent: retainedPercent,
      method: form.method,
      notes: form.notes,
      proof_reference: form.proof_reference,
      approval_note: form.approval_note,
      approver_pin: form.approver_pin,
      intentId: crypto.randomUUID()
    }).catch((e) => ({ success: false, error: e.message }))

    if (result?.success === false) {
      setError(result.error || 'Refund failed')
      setSaving(false)
      return
    }

    setSaving(false)
    onSaved?.(result)
  }

  return (
    <Modal title={`Refund Guest · ${invoice.invoice_number}`} onClose={onClose} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Refund basis</p>
          <p className="mt-1">Paid amount on this booking: {fmtMoney(currency, paidAmount)}</p>
          <p className="mt-1">Set the percentage the lodge is retaining. The rest will be recorded as a refund.</p>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">Percentage retained by lodge</span>
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={form.retained_percent}
            onChange={(event) => setForm((current) => ({ ...current, retained_percent: event.target.value }))}
            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-green-500"
            required
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">Refund method</span>
          <select
            value={form.method}
            onChange={(event) => setForm((current) => ({ ...current, method: event.target.value }))}
            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-green-500"
          >
            {PAYMENT_METHODS.map((method) => (
              <option key={method.value} value={method.value}>{method.label}</option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-gray-500">Use the actual refund path used for the guest. Bank transfer refunds should only be confirmed once POP is available.</p>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">Proof reference</span>
          <input
            type="text"
            value={form.proof_reference}
            onChange={(event) => setForm((current) => ({ ...current, proof_reference: event.target.value }))}
            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-green-500"
            placeholder="Bank reference, signed cash slip, POP number, or refund note ID"
            required
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">Approver note</span>
          <textarea
            rows="2"
            value={form.approval_note}
            onChange={(event) => setForm((current) => ({ ...current, approval_note: event.target.value }))}
            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-green-500"
            placeholder="Policy reference or manager instruction"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">Manager/Admin approval PIN</span>
          <input
            type="password"
            value={form.approver_pin}
            onChange={(event) => setForm((current) => ({ ...current, approver_pin: event.target.value }))}
            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-green-500"
            placeholder="Required to approve and post this refund"
            required
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">Refund notes</span>
          <textarea
            rows="3"
            value={form.notes}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-green-500"
            placeholder="Cancellation reason, policy reference, or manager note"
          />
        </label>

        <div className="grid gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Lodge Retains</p>
            <p className="mt-1 text-lg font-bold text-gray-900">{fmtMoney(currency, retainedAmount)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Refund To Guest</p>
            <p className="mt-1 text-lg font-bold text-rose-700">{fmtMoney(currency, refundAmount)}</p>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || refundAmount <= 0}
            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
          >
            <RotateCcw size={15} />
            {saving ? 'Processing…' : 'Record Refund'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default function BookingInvoices() {
  const { settings } = useSettings()
  const { user } = useAuth()
  const currency = settings?.currency || 'P'
  const navigate = useNavigate()

  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [bookingFilter, setBookingFilter] = useState('all')
  const [sortBy, setSortBy] = useState('issued_desc')
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [receiptInvoice, setReceiptInvoice] = useState(null)
  const [ledgerInvoice, setLedgerInvoice] = useState(null)
  const [auditInvoice, setAuditInvoice] = useState(null)
  const [deliveryInvoice, setDeliveryInvoice] = useState(null)
  const [refundInvoice, setRefundInvoice] = useState(null)
  const [flash, setFlash] = useState(null)
  const [emailingId, setEmailingId] = useState(null)
  const [financialPendingIds, setFinancialPendingIds] = useState(new Set())
  const [financialFailedIds, setFinancialFailedIds] = useState(new Set())
  const [financialCacheStale, setFinancialCacheStale] = useState(false)
  const FINANCIAL_SYNC_BLOCK_MESSAGE = 'Collections and refunds are temporarily locked until booking and payment sync are fully confirmed.'

  const loadInvoices = async () => {
    setLoading(true)
    const data = await window.api.invoices.getBookingInvoices().catch(() => [])
    setInvoices(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  useEffect(() => {
    loadInvoices()
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadSyncStatus = async () => {
      try {
        const status = await window.api.sync.getStatus()
        if (cancelled) return
        setFinancialPendingIds(new Set(status?.financialPendingBookingIds || []))
        setFinancialFailedIds(new Set(status?.financialFailedBookingIds || []))
        setFinancialCacheStale(status?.cacheStale?.active === true)
      } catch {
        if (cancelled) return
        setFinancialPendingIds(new Set())
        setFinancialFailedIds(new Set())
        setFinancialCacheStale(false)
      }
    }
    loadSyncStatus()
    const interval = window.setInterval(loadSyncStatus, 30000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [])

  const isFinanciallySyncBlocked = (bookingId) => (
    financialCacheStale || financialPendingIds.has(bookingId) || financialFailedIds.has(bookingId)
  )

  const pushFlash = (type, text) => {
    setFlash({ type, text })
    setTimeout(() => setFlash(null), 3500)
  }

  const openCollectionFlow = (invoice) => {
    if (!invoice?.booking_id) {
      pushFlash('error', 'This invoice is not linked to a booking payment record.')
      return
    }
    if (isFinanciallySyncBlocked(invoice.booking_id)) {
      pushFlash('error', FINANCIAL_SYNC_BLOCK_MESSAGE)
      return
    }
    if (Number(invoice.balance_due || 0) <= 0 || invoice.status === 'cancelled') {
      pushFlash('error', 'This invoice does not need payment collection.')
      return
    }
    setSelectedInvoice(null)
    setLedgerInvoice(null)
    navigate('/bookings', {
      state: {
        collectPaymentBookingId: invoice.booking_id
      }
    })
  }

  const handleSendEmail = async (invoice) => {
    if (!invoice?.customer_email) {
      pushFlash('error', 'This guest does not have an email address on file.')
      return
    }
    setEmailingId(invoice.booking_id)
    const result = await window.api.invoices.sendBookingInvoiceEmail({
      ...invoice,
      lodge_name: settings?.lodge_name || '',
      currency
    }).catch((e) => ({ success: false, error: e.message }))
    setEmailingId(null)
    if (result?.success === false) {
      pushFlash('error', result.error || 'Could not send invoice email.')
      return
    }
    pushFlash('success', `Invoice sent to ${invoice.customer_email}`)
  }

  const filteredInvoices = useMemo(() => {
    return [...invoices.filter((invoice) => {
      const query = search.trim().toLowerCase()
      const matchesSearch = !query || [
        invoice.invoice_number,
        invoice.customer_name,
        invoice.customer_phone,
        invoice.customer_email,
        invoice.room_number ? `room ${invoice.room_number}` : '',
        invoice.room_type
      ].some((value) => String(value || '').toLowerCase().includes(query))

      const matchesPayment = paymentFilter === 'all' || invoice.payment_status === paymentFilter
      const matchesBooking = bookingFilter === 'all' || invoice.status === bookingFilter

      return matchesSearch && matchesPayment && matchesBooking
    })].sort((a, b) => {
      switch (sortBy) {
        case 'balance_desc':
          return Number(b.balance_due || 0) - Number(a.balance_due || 0)
        case 'balance_asc':
          return Number(a.balance_due || 0) - Number(b.balance_due || 0)
        case 'total_desc':
          return Number(b.total_amount || 0) - Number(a.total_amount || 0)
        case 'guest_asc':
          return String(a.customer_name || '').localeCompare(String(b.customer_name || ''))
        case 'issued_asc':
          return String(a.issued_at || '').localeCompare(String(b.issued_at || ''))
        case 'issued_desc':
        default:
          return String(b.issued_at || '').localeCompare(String(a.issued_at || ''))
      }
    })
  }, [bookingFilter, invoices, paymentFilter, search, sortBy])

  const totals = filteredInvoices.reduce((acc, invoice) => {
    acc.total += Number(invoice.total_amount || 0)
    acc.paid += Number(invoice.amount_paid || 0)
    acc.balance += Number(invoice.balance_due || 0)
    if (invoice.payment_status !== 'paid') acc.openCount += 1
    return acc
  }, { total: 0, paid: 0, balance: 0, openCount: 0 })

  const collectionQueue = useMemo(() => (
    [...filteredInvoices]
      .filter((invoice) => Number(invoice.balance_due || 0) > 0 && invoice.status !== 'cancelled')
      .sort((left, right) => {
        const leftPriority = left.status === 'checked_out' ? 0 : left.status === 'checked_in' ? 1 : 2
        const rightPriority = right.status === 'checked_out' ? 0 : right.status === 'checked_in' ? 1 : 2
        if (leftPriority !== rightPriority) return leftPriority - rightPriority
        return Number(right.balance_due || 0) - Number(left.balance_due || 0)
      })
      .slice(0, 4)
  ), [filteredInvoices])

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-green-700">Finance</p>
          <h1 className="text-3xl font-bold text-gray-900">Booking Invoices</h1>
          <p className="mt-1 text-sm text-gray-500">
            View lodge booking invoices, payment history, refunds, and guest delivery in one place.
          </p>
        </div>
        <button
          type="button"
          onClick={loadInvoices}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl bg-green-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-800 disabled:opacity-60"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {flash && (
        <div className={`rounded-2xl px-4 py-3 text-sm font-medium ${
          flash.type === 'success'
            ? 'border border-green-200 bg-green-50 text-green-700'
            : 'border border-red-200 bg-red-50 text-red-700'
        }`}>
          {flash.text}
        </div>
      )}

      {financialCacheStale && (
        <div className="flex items-start gap-3 rounded-2xl border-2 border-red-400 bg-red-50 px-5 py-4 text-sm text-red-800 font-medium shadow-sm">
          <span className="text-lg leading-none">⛔</span>
          <div>
            <p className="font-semibold">Financial data not yet confirmed from server</p>
            <p className="mt-1 text-xs font-normal text-red-700">Collections and refunds are locked until booking and payment sync are fully confirmed. Do not record or export financial totals until this banner clears.</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Invoices</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{filteredInvoices.length}</p>
          <p className="mt-1 text-sm text-gray-500">Booking invoices in the current view</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Total Invoiced</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{fmtMoney(currency, totals.total)}</p>
          <p className="mt-1 text-sm text-gray-500">Room and booking charges billed</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Collected</p>
          <p className="mt-2 text-3xl font-bold text-green-700">{fmtMoney(currency, totals.paid)}</p>
          <p className="mt-1 text-sm text-gray-500">Payments recorded against these bookings</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Outstanding</p>
          <p className="mt-2 text-3xl font-bold text-amber-700">{fmtMoney(currency, totals.balance)}</p>
          <p className="mt-1 text-sm text-gray-500">{totals.openCount} invoice{totals.openCount === 1 ? '' : 's'} still open</p>
        </div>
      </div>

      {totals.balance > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">Unsettled guest balances are still open</p>
              <p className="mt-1 text-amber-800/80">
                {totals.openCount} invoice{totals.openCount === 1 ? '' : 's'} still carry
                {' '}<span className="font-semibold">{fmtMoney(currency, totals.balance)}</span> in outstanding balance.
              </p>
            </div>
            <div className="rounded-xl border border-amber-300 bg-white/70 px-3 py-2 text-xs font-semibold text-amber-800">
              Sort by “Highest balance” to work the biggest balances first
            </div>
          </div>
        </div>
      )}

      {collectionQueue.length > 0 && (
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">Collection Queue</p>
              <p className="mt-1 text-sm text-gray-500">Start with the bookings that are already in-house or already checked out.</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              Highest-priority balances first
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {collectionQueue.map((invoice) => (
              <div key={`queue-${invoice.booking_id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-gray-900">{invoice.customer_name || 'Walk-in Guest'}</p>
                    <Badge value={invoice.status} styles={BOOKING_STATUS_STYLES} />
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                      {fmtMoney(currency, invoice.balance_due)} due
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {invoice.invoice_number} · {formatStay(invoice)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openCollectionFlow(invoice)}
                  disabled={isFinanciallySyncBlocked(invoice.booking_id)}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <CreditCard size={13} />
                  Collect Payment
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_220px_220px_220px]">
          <label className="relative block">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by invoice, guest, email, phone, or room"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-10 pr-4 text-sm text-gray-800 outline-none transition focus:border-green-500 focus:bg-white"
            />
          </label>
          <select
            value={paymentFilter}
            onChange={(event) => setPaymentFilter(event.target.value)}
            className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 outline-none transition focus:border-green-500 focus:bg-white"
          >
            <option value="all">All Payment Statuses</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="unpaid">Unpaid</option>
          </select>
          <select
            value={bookingFilter}
            onChange={(event) => setBookingFilter(event.target.value)}
            className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 outline-none transition focus:border-green-500 focus:bg-white"
          >
            <option value="all">All Booking Statuses</option>
            <option value="confirmed">Confirmed</option>
            <option value="checked_in">Checked In</option>
            <option value="checked_out">Checked Out</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value)}
            className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 outline-none transition focus:border-green-500 focus:bg-white"
          >
            <option value="issued_desc">Newest issued</option>
            <option value="issued_asc">Oldest issued</option>
            <option value="balance_desc">Highest balance</option>
            <option value="balance_asc">Lowest balance</option>
            <option value="total_desc">Highest total</option>
            <option value="guest_asc">Guest A-Z</option>
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200">
        {loading ? (
          <div className="flex items-center justify-center gap-3 px-6 py-16 text-sm text-gray-500">
            <RefreshCw size={16} className="animate-spin" />
            Loading booking invoices…
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <Receipt size={32} className="mx-auto text-gray-300" />
            <h2 className="mt-4 text-lg font-semibold text-gray-900">No booking invoices found</h2>
            <p className="mt-2 text-sm text-gray-500">
              New booking invoices will appear here once bookings are created with invoice numbers.
            </p>
          </div>
        ) : (
          <HorizontalScrollArea>
            <table className="min-w-[1180px] w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-[0.16em] text-gray-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Invoice</th>
                  <th className="px-5 py-3 font-semibold">Guest</th>
                  <th className="px-5 py-3 font-semibold">Stay</th>
                  <th className="px-5 py-3 text-right font-semibold">Total</th>
                  <th className="px-5 py-3 text-right font-semibold">Balance</th>
                  <th className="px-5 py-3 font-semibold">Payment</th>
                  <th className="px-5 py-3 font-semibold">Booking</th>
                  <th className="px-5 py-3 font-semibold">Issued</th>
                  <th className="px-5 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((invoice, index) => (
                  <tr
                    key={invoice.booking_id}
                    className={`border-t border-gray-100 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                  >
                    <td className="px-5 py-4">
                      <button
                        type="button"
                        onClick={() => setSelectedInvoice(invoice)}
                        className="text-left"
                      >
                        <p className="font-mono text-xs font-semibold text-green-700">{invoice.invoice_number}</p>
                        <p className="mt-1 text-xs text-gray-500">Booking #{String(invoice.booking_id).slice(0, 8)}</p>
                      </button>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-semibold text-gray-900">{invoice.customer_name || 'Walk-in Guest'}</p>
                      <p className="mt-1 text-xs text-gray-500">{invoice.customer_email || invoice.customer_phone || 'No guest contact on file'}</p>
                    </td>
                    <td className="px-5 py-4 align-top">
                      <div className="max-w-[220px]">
                        <p className="truncate text-sm text-gray-800 leading-5">{formatStay(invoice)}</p>
                        <p className="mt-1 truncate text-xs text-gray-500 leading-4">{invoice.room_type || 'Room type not set'}</p>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right font-semibold text-gray-900">
                      {fmtMoney(currency, invoice.total_amount)}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <p className={`font-semibold ${invoice.balance_due > 0 ? 'text-amber-700' : 'text-green-700'}`}>
                        {fmtMoney(currency, invoice.balance_due)}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">Paid {fmtMoney(currency, invoice.amount_paid)}</p>
                      {Number(invoice.balance_due || 0) > 0 && (
                        <p className="mt-1 text-xs font-semibold text-amber-700">Needs collection</p>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <Badge value={invoice.payment_status} styles={PAYMENT_STATUS_STYLES} />
                    </td>
                    <td className="px-5 py-4">
                      <Badge value={invoice.status} styles={BOOKING_STATUS_STYLES} />
                    </td>
                    <td className="px-5 py-4 text-gray-600">
                      {fmtDate(invoice.issued_at)}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedInvoice(invoice)}
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:border-green-500 hover:text-green-700"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => setAuditInvoice(invoice)}
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:border-green-500 hover:text-green-700"
                        >
                          Audit
                        </button>
                        <button
                          type="button"
                          onClick={() => setLedgerInvoice(invoice)}
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:border-green-500 hover:text-green-700"
                        >
                          Ledger
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeliveryInvoice(invoice)}
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:border-green-500 hover:text-green-700"
                        >
                          History
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSendEmail(invoice)}
                          disabled={emailingId === invoice.booking_id}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:border-green-500 hover:text-green-700 disabled:opacity-60"
                        >
                          <Mail size={12} />
                          {emailingId === invoice.booking_id ? 'Sending…' : 'Email'}
                        </button>
                        <button
                          type="button"
                          onClick={() => openCollectionFlow(invoice)}
                          disabled={Number(invoice.balance_due || 0) <= 0 || invoice.status === 'cancelled' || isFinanciallySyncBlocked(invoice.booking_id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:border-amber-400 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <CreditCard size={12} />
                          Collect
                        </button>
                        <button
                          type="button"
                          onClick={() => setReceiptInvoice(invoice)}
                          className="inline-flex items-center gap-1 rounded-lg bg-green-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-green-800"
                        >
                          <Printer size={12} />
                          Receipt
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </HorizontalScrollArea>
        )}
      </div>

      {selectedInvoice && (
        <Modal title={`Invoice ${selectedInvoice.invoice_number}`} onClose={() => setSelectedInvoice(null)} size="xl">
          <div className="space-y-5">
            <div className="rounded-2xl bg-gradient-to-r from-green-900 via-green-800 to-green-700 p-5 text-white">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-green-200">Booking Invoice</p>
                  <h3 className="mt-2 font-mono text-2xl font-bold">{selectedInvoice.invoice_number}</h3>
                  <p className="mt-2 text-sm text-green-100">
                    Issued {fmtDate(selectedInvoice.issued_at)} for {selectedInvoice.customer_name || 'Walk-in Guest'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge value={selectedInvoice.payment_status} styles={PAYMENT_STATUS_STYLES} />
                  <Badge value={selectedInvoice.status} styles={BOOKING_STATUS_STYLES} />
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl bg-gray-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Guest</p>
                <p className="mt-2 font-semibold text-gray-900">{selectedInvoice.customer_name || 'Walk-in Guest'}</p>
                <p className="mt-1 text-sm text-gray-500">{selectedInvoice.customer_email || selectedInvoice.customer_phone || 'No guest contact on file'}</p>
              </div>
              <div className="rounded-2xl bg-gray-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Room</p>
                <p className="mt-2 font-semibold text-gray-900">Room {selectedInvoice.room_number || '—'}</p>
                <p className="mt-1 text-sm text-gray-500">{selectedInvoice.room_type || 'Room type not set'}</p>
              </div>
              <div className="rounded-2xl bg-gray-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Stay</p>
                <p className="mt-2 font-semibold text-gray-900">{selectedInvoice.nights} night{selectedInvoice.nights === 1 ? '' : 's'}</p>
                <p className="mt-1 text-sm text-gray-500">{fmtDate(selectedInvoice.check_in)} → {fmtDate(selectedInvoice.check_out)}</p>
              </div>
              <div className="rounded-2xl bg-gray-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Financials</p>
                <p className="mt-2 font-semibold text-gray-900">{fmtMoney(currency, selectedInvoice.total_amount)}</p>
                <p className="mt-1 text-sm text-gray-500">Paid {fmtMoney(currency, selectedInvoice.amount_paid)}</p>
                <p className="mt-1 text-sm text-amber-700">Balance {fmtMoney(currency, selectedInvoice.balance_due)}</p>
              </div>
            </div>

            {Number(selectedInvoice.balance_due || 0) > 0 && selectedInvoice.status !== 'cancelled' && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">This invoice still needs payment collection</p>
                    <p className="mt-1 text-amber-800/80">
                      Outstanding balance: {fmtMoney(currency, selectedInvoice.balance_due)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openCollectionFlow(selectedInvoice)}
                    className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-800 transition hover:border-amber-400 hover:bg-amber-100"
                  >
                    <CreditCard size={15} />
                    Collect Payment
                  </button>
                </div>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-gray-200 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <FileText size={16} className="text-green-700" />
                  Invoice Notes
                </p>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-600">
                  {selectedInvoice.invoice_notes || 'No invoice-specific notes recorded.'}
                </p>
              </div>
              <div className="rounded-2xl border border-gray-200 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <CreditCard size={16} className="text-green-700" />
                  Booking Notes
                </p>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-600">
                  {selectedInvoice.notes || 'No booking notes recorded.'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setAuditInvoice(selectedInvoice)}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:border-green-500 hover:text-green-700"
              >
                <FileText size={15} />
                Financial Audit
              </button>
              <button
                type="button"
                onClick={() => setLedgerInvoice(selectedInvoice)}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:border-green-500 hover:text-green-700"
              >
                <CreditCard size={15} />
                Payment Ledger
              </button>
              <button
                type="button"
                onClick={() => setDeliveryInvoice(selectedInvoice)}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:border-green-500 hover:text-green-700"
              >
                <Mail size={15} />
                Delivery History
              </button>
              <button
                type="button"
                onClick={() => handleSendEmail(selectedInvoice)}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:border-green-500 hover:text-green-700"
              >
                <Mail size={15} />
                Email Guest
              </button>
              <button
                type="button"
                disabled={Number(selectedInvoice.amount_paid || 0) <= 0 || isFinanciallySyncBlocked(selectedInvoice.booking_id) || !canRefundBooking(selectedInvoice)}
                onClick={() => {
                  if (isFinanciallySyncBlocked(selectedInvoice.booking_id)) {
                    pushFlash('error', FINANCIAL_SYNC_BLOCK_MESSAGE)
                    return
                  }
                  if (!canRefundBooking(selectedInvoice)) {
                    pushFlash('error', 'Refunds are only allowed before check-in or on already-cancelled bookings.')
                    return
                  }
                  setRefundInvoice(selectedInvoice)
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
              >
                <RotateCcw size={15} />
                Refund With Approval
              </button>
              <button
                type="button"
                onClick={() => setReceiptInvoice(selectedInvoice)}
                className="inline-flex items-center gap-2 rounded-xl bg-green-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-green-800"
              >
                <Printer size={15} />
                Open Printable Receipt
              </button>
            </div>
          </div>
        </Modal>
      )}

      {receiptInvoice && (
        <BookingReceipt booking={receiptInvoice} onClose={() => setReceiptInvoice(null)} />
      )}

      {ledgerInvoice && (
        <LedgerModal invoice={ledgerInvoice} currency={currency} onClose={() => setLedgerInvoice(null)} />
      )}

      {auditInvoice && (
        <AuditModal invoice={auditInvoice} currency={currency} onClose={() => setAuditInvoice(null)} />
      )}

      {deliveryInvoice && (
        <DeliveryHistoryModal invoice={deliveryInvoice} onClose={() => setDeliveryInvoice(null)} />
      )}

      {refundInvoice && (
        <RefundModal
          invoice={refundInvoice}
          currency={currency}
          onClose={() => setRefundInvoice(null)}
          onSaved={(result) => {
            setRefundInvoice(null)
            setSelectedInvoice(null)
            pushFlash('success', `Refund recorded for ${refundInvoice.customer_name || 'guest'} and approved by ${result?.approved_by_name || 'manager'}.`)
            loadInvoices()
          }}
        />
      )}
    </div>
  )
}
