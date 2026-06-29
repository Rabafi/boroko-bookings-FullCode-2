import { useCallback, useEffect, useMemo, useState } from 'react'
import { CreditCard, Download, FileText, History, Plus, Printer, RefreshCw, RotateCcw, Search, Undo2 } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAccess, useAuth, useSettings } from '../app-context'
import { canAccessCapability } from '../../../shared/accessControl'
import { Modal } from './shared/Modal'

const PAYMENT_METHODS = [
  ['cash', 'Cash'],
  ['card', 'Card'],
  ['bank_transfer', 'Bank transfer'],
  ['mobile_money', 'Mobile money'],
  ['other', 'Other']
]

const emptyReceipt = { amount: '', method: 'cash', reference: '', notes: '' }

function money(currency, value) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function entryEffect(entry) {
  return ['receipt', 'adjustment_in', 'reversal_in'].includes(entry.entry_type) ? 1 : -1
}

function isCancelledBookingCredit(entry) {
  return entry?.method === 'customer_credit_transfer' && entry?.entry_type === 'adjustment_in'
}

function entryLabel(entry) {
  if (isCancelledBookingCredit(entry)) return 'Credit from cancelled booking'
  return {
    receipt: 'Advance payment received',
    booking_allocation: 'Applied to booking',
    refund: 'Credit refunded',
    adjustment_in: 'Credit added',
    adjustment_out: 'Credit removed',
    reversal_in: 'Credit restored',
    reversal_out: 'Credit reversed'
  }[entry?.entry_type] || String(entry?.entry_type || 'Credit activity').replaceAll('_', ' ')
}

export default function Prepayments() {
  const location = useLocation()
  const navigate = useNavigate()
  const access = useAccess()
  const { user } = useAuth()
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const canRecord = canAccessCapability(access, 'payments.record')
  const canRefund = canAccessCapability(access, 'payments.refund')

  const [customers, setCustomers] = useState([])
  const [summary, setSummary] = useState([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [balance, setBalance] = useState(0)
  const [history, setHistory] = useState([])
  const [bookings, setBookings] = useState([])
  const [allBookings, setAllBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [receiveOpen, setReceiveOpen] = useState(false)
  const [receiveForm, setReceiveForm] = useState(emptyReceipt)
  const [saving, setSaving] = useState(false)
  const [receipt, setReceipt] = useState(null)

  const [applyEntry, setApplyEntry] = useState(false)
  const [applyForm, setApplyForm] = useState({ bookingId: '', amount: '', notes: '' })
  const [refundOpen, setRefundOpen] = useState(false)
  const [refundForm, setRefundForm] = useState({ amount: '', method: 'cash', reference: '', notes: '' })

  const loadBase = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [customerRows, summaryRows] = await Promise.all([
        window.api.customers.getAll(),
        window.api.customerCredit.getSummary(null, 100, 0)
      ])
      setCustomers(Array.isArray(customerRows) ? customerRows : [])
      setSummary(Array.isArray(summaryRows) ? summaryRows : [])
    } catch (err) {
      setError(err.message || 'Could not load prepayments.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadCustomer = useCallback(async (customer) => {
    if (!customer?.id) return
    setSelected(customer)
    setError('')
    try {
      const [balanceResult, historyRows, bookingRows] = await Promise.all([
        window.api.customerCredit.getBalance(customer.id),
        window.api.customerCredit.getHistory(customer.id, 100, 0),
        window.api.customers.getBookings(customer.id)
      ])
      if (balanceResult?.success === false) throw new Error(balanceResult.error)
      if (historyRows?.success === false) throw new Error(historyRows.error)
      setBalance(Number(balanceResult?.balance || 0))
      setHistory(Array.isArray(historyRows) ? historyRows : [])
      const customerBookings = Array.isArray(bookingRows) ? bookingRows : []
      setAllBookings(customerBookings)
      setBookings(customerBookings.filter((booking) => {
        const outstanding = Number(booking.total_amount || 0) + Number(booking.charges_total || 0) - Number(booking.amount_paid || 0)
        return !['cancelled', 'checked_out'].includes(booking.status) && outstanding > 0.009
      }))
    } catch (err) {
      setError(err.message || 'Could not load this customer’s credit.')
    }
  }, [])

  useEffect(() => { loadBase() }, [loadBase])

  useEffect(() => {
    const targetCustomerId = location.state?.customerId
    if (!targetCustomerId || customers.length === 0) return
    const customer = customers.find((row) => String(row.id) === String(targetCustomerId))
    if (!customer) return
    loadCustomer(customer)
    if (location.state?.openReceive === true && canRecord) {
      setReceiveOpen(true)
    }
    navigate(location.pathname, { replace: true, state: {} })
  }, [canRecord, customers, loadCustomer, location.pathname, location.state, navigate])

  const customerRows = useMemo(() => {
    const balances = new Map(summary.map((row) => [row.customer_id, row]))
    const needle = search.trim().toLowerCase()
    return customers
      .filter((customer) => !needle || [customer.name, customer.phone, customer.email].some((value) => String(value || '').toLowerCase().includes(needle)))
      .map((customer) => ({ ...customer, credit: balances.get(customer.id) || null }))
      .sort((a, b) => Number(b.credit?.balance || 0) - Number(a.credit?.balance || 0) || String(a.name || '').localeCompare(String(b.name || '')))
  }, [customers, search, summary])

  const refreshSelected = async () => {
    await loadBase()
    if (selected) await loadCustomer(selected)
  }

  const bookingById = useMemo(() => {
    return new Map(allBookings.map((booking) => [String(booking.id), booking]))
  }, [allBookings])

  const openLinkedInvoice = (bookingId) => {
    if (!bookingId) return
    navigate('/invoices', {
      state: {
        viewBookingId: bookingId
      }
    })
  }

  const receive = async (event) => {
    event.preventDefault()
    if (!selected) return
    setSaving(true)
    setError('')
    try {
      const result = await window.api.customerCredit.record({
        customerId: selected.id,
        amount: Number(receiveForm.amount),
        method: receiveForm.method,
        reference: receiveForm.reference,
        notes: receiveForm.notes,
        recordedBy: user?.id || null
      })
      if (result?.success === false) throw new Error(result.error)
      const receiptData = {
        id: result.entry_id,
        receipt_number: result.receipt_number || (result.offline ? `PRE-PENDING-${String(result.entry_id).slice(0, 6).toUpperCase()}` : null),
        customer: selected,
        amount: Number(receiveForm.amount),
        method: receiveForm.method,
        reference: receiveForm.reference,
        notes: receiveForm.notes,
        balance: result.balance,
        offline: result.offline === true,
        created_at: new Date().toISOString()
      }
      setReceipt(receiptData)
      setReceiveOpen(false)
      setReceiveForm(emptyReceipt)
      setSuccess(result.offline ? 'Prepayment saved locally and queued for synchronization.' : 'Prepayment recorded successfully.')
      await refreshSelected()
    } catch (err) {
      setError(err.message || 'Could not record the prepayment.')
    } finally {
      setSaving(false)
    }
  }

  const applyCredit = async (event) => {
    event.preventDefault()
    const booking = bookings.find((row) => row.id === applyForm.bookingId)
    if (!booking) return
    setSaving(true)
    setError('')
    try {
      const result = await window.api.customerCredit.applyToBooking({
        customerId: selected.id,
        bookingId: booking.id,
        amount: Number(applyForm.amount),
        notes: applyForm.notes,
        recordedBy: user?.id || null,
        expectedBookingUpdatedAt: booking.updated_at || null
      })
      if (result?.success === false) throw new Error(result.error)
      setApplyEntry(false)
      setApplyForm({ bookingId: '', amount: '', notes: '' })
      setSuccess('Customer credit applied to the booking.')
      await refreshSelected()
    } catch (err) {
      setError(err.message || 'Could not apply customer credit.')
    } finally {
      setSaving(false)
    }
  }

  const refundCredit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const result = await window.api.customerCredit.refund({
        customerId: selected.id,
        amount: Number(refundForm.amount),
        method: refundForm.method,
        reference: refundForm.reference,
        notes: refundForm.notes,
        requestedBy: user?.id || null,
        approvedBy: user?.id || null
      })
      if (result?.success === false) throw new Error(result.error)
      setRefundOpen(false)
      setRefundForm({ amount: '', method: 'cash', reference: '', notes: '' })
      setSuccess('Customer credit refund recorded.')
      await refreshSelected()
    } catch (err) {
      setError(err.message || 'Could not refund customer credit.')
    } finally {
      setSaving(false)
    }
  }

  const reverseEntry = async (entry) => {
    const reason = window.prompt('Reason for reversing this entry:')
    if (!reason?.trim()) return
    setSaving(true)
    setError('')
    try {
      const result = await window.api.customerCredit.reverse({ entryId: entry.id, notes: reason, recordedBy: user?.id || null })
      if (result?.success === false) throw new Error(result.error)
      setSuccess('Credit entry reversed with a compensating transaction.')
      await refreshSelected()
    } catch (err) {
      setError(err.message || 'Could not reverse this entry.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Prepayments</h1>
          <p className="mt-1 text-sm text-slate-500">Hold customer money without reserving a room, then allocate it when dates are confirmed.</p>
        </div>
        <button onClick={refreshSelected} className="btn-secondary flex items-center gap-2"><RefreshCw size={15} /> Refresh</button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <section className="bb-card overflow-hidden">
          <div className="border-b border-slate-100 p-4">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-3 text-slate-400" />
              <input className="input w-full pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customers…" />
            </div>
          </div>
          <div className="max-h-[650px] overflow-y-auto">
            {loading ? <p className="p-5 text-sm text-slate-500">Loading customers…</p> : customerRows.map((customer) => (
              <button key={customer.id} onClick={() => loadCustomer(customer)} className={`w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${selected?.id === customer.id ? 'bg-emerald-50' : ''}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">{customer.name}</p>
                    <p className="truncate text-xs text-slate-500">{customer.phone || customer.email || 'No contact details'}</p>
                  </div>
                  <span className={`text-sm font-bold ${Number(customer.credit?.balance || 0) > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>{money(currency, customer.credit?.balance || 0)}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          {!selected ? (
            <div className="bb-card p-10 text-center text-slate-500">Select a customer to manage their prepayments.</div>
          ) : (
            <>
              <div className="bb-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-slate-500">{selected.name}</p>
                    <p className="mt-1 text-3xl font-bold text-emerald-700">{money(currency, balance)}</p>
                    <p className="mt-1 text-xs text-slate-500">Confirmed customer credit available for allocation or refund.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canRecord && <button onClick={() => setReceiveOpen(true)} className="btn-primary flex items-center gap-2"><Plus size={15} /> Receive prepayment</button>}
                    {canRecord && balance > 0 && bookings.length > 0 && <button onClick={() => setApplyEntry(true)} className="btn-secondary flex items-center gap-2"><CreditCard size={15} /> Apply to booking</button>}
                    {canRefund && balance > 0 && <button onClick={() => setRefundOpen(true)} className="btn-secondary flex items-center gap-2 text-rose-700"><Undo2 size={15} /> Refund credit</button>}
                  </div>
                </div>
              </div>

              <div className="bb-card overflow-hidden">
                <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4"><History size={17} /><h2 className="font-semibold text-slate-800">Credit ledger</h2></div>
                {history.length === 0 ? <p className="p-6 text-sm text-slate-500">No prepayment activity for this customer.</p> : (
                  <div className="divide-y divide-slate-100">
                    {history.map((entry) => {
                      const sign = entryEffect(entry)
                      const isReversal = ['reversal_in', 'reversal_out'].includes(entry.entry_type)
                      return (
                        <div key={entry.id} className="flex items-center justify-between gap-4 px-5 py-4">
                          <div>
                            <p className="text-sm font-semibold text-slate-800">{entryLabel(entry)}</p>
                            <p className="mt-1 text-xs text-slate-500">{new Date(entry.created_at).toLocaleString()} · {String(entry.method || 'internal').replaceAll('_', ' ')}</p>
                            {(entry.reference || entry.notes) && <p className="mt-1 text-xs text-slate-500">{entry.reference || entry.notes}</p>}
                            {entry.booking_id && (
                              <button
                                type="button"
                                onClick={() => openLinkedInvoice(entry.booking_id)}
                                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800"
                              >
                                <FileText size={13} />
                                Open {bookingById.get(String(entry.booking_id))?.invoice_number || 'linked invoice'}
                              </button>
                            )}
                            {entry.entry_type === 'receipt' && (
                              <button
                                type="button"
                                onClick={() => setReceipt({
                                  id: entry.id,
                                  receipt_number: entry.receipt_number,
                                  customer: selected,
                                  amount: Number(entry.amount || 0),
                                  method: entry.method || 'other',
                                  reference: entry.reference || '',
                                  notes: entry.notes || '',
                                  balance,
                                  offline: entry._pending_sync === true,
                                  created_at: entry.created_at
                                })}
                                className="mt-2 text-xs font-semibold text-emerald-700 hover:text-emerald-800"
                              >
                                Open receipt
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`font-bold ${sign > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{sign > 0 ? '+' : '−'}{money(currency, entry.amount)}</span>
                            {canRefund && !isReversal && !entry.reversed && (
                              <button disabled={saving} onClick={() => reverseEntry(entry)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Reverse entry"><RotateCcw size={15} /></button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {receiveOpen && <Modal title="Receive Prepayment" onClose={() => setReceiveOpen(false)} size="sm">
        <form onSubmit={receive} className="space-y-4">
          <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">This records money as customer credit. It does not reserve a room or guarantee availability.</p>
          <Field label={`Amount (${currency})`}><input className="input w-full" required type="number" min="0.01" step="0.01" value={receiveForm.amount} onChange={(e) => setReceiveForm({ ...receiveForm, amount: e.target.value })} /></Field>
          <MethodSelect value={receiveForm.method} onChange={(method) => setReceiveForm({ ...receiveForm, method })} />
          <Field label="Reference / POP number"><input className="input w-full" value={receiveForm.reference} onChange={(e) => setReceiveForm({ ...receiveForm, reference: e.target.value })} /></Field>
          <Field label="Notes"><textarea className="input min-h-20 w-full" value={receiveForm.notes} onChange={(e) => setReceiveForm({ ...receiveForm, notes: e.target.value })} /></Field>
          <div className="flex gap-2"><button type="button" onClick={() => setReceiveOpen(false)} className="btn-secondary flex-1">Cancel</button><button disabled={saving} className="btn-primary flex-1">{saving ? 'Recording…' : 'Record prepayment'}</button></div>
        </form>
      </Modal>}

      {applyEntry && <Modal title="Apply Credit to Booking" onClose={() => setApplyEntry(false)} size="sm">
        <form onSubmit={applyCredit} className="space-y-4">
          <p className="text-sm text-slate-600">Available credit: <strong>{money(currency, balance)}</strong></p>
          <Field label="Booking"><select required className="input w-full" value={applyForm.bookingId} onChange={(e) => setApplyForm({ ...applyForm, bookingId: e.target.value })}><option value="">Select booking…</option>{bookings.map((booking) => <option key={booking.id} value={booking.id}>{booking.invoice_number || booking.id.slice(0, 8)} · {booking.check_in} · Due {money(currency, Number(booking.total_amount || 0) + Number(booking.charges_total || 0) - Number(booking.amount_paid || 0))}</option>)}</select></Field>
          <Field label={`Amount (${currency})`}><input required className="input w-full" type="number" min="0.01" step="0.01" max={balance} value={applyForm.amount} onChange={(e) => setApplyForm({ ...applyForm, amount: e.target.value })} /></Field>
          <Field label="Notes"><textarea className="input min-h-20 w-full" value={applyForm.notes} onChange={(e) => setApplyForm({ ...applyForm, notes: e.target.value })} /></Field>
          <div className="flex gap-2"><button type="button" onClick={() => setApplyEntry(false)} className="btn-secondary flex-1">Cancel</button><button disabled={saving} className="btn-primary flex-1">Apply credit</button></div>
        </form>
      </Modal>}

      {refundOpen && <Modal title="Refund Customer Credit" onClose={() => setRefundOpen(false)} size="sm">
        <form onSubmit={refundCredit} className="space-y-4">
          <p className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700">This records money leaving the lodge. Confirm the external refund before posting it.</p>
          <Field label={`Amount (${currency})`}><input required className="input w-full" type="number" min="0.01" step="0.01" max={balance} value={refundForm.amount} onChange={(e) => setRefundForm({ ...refundForm, amount: e.target.value })} /></Field>
          <MethodSelect value={refundForm.method} onChange={(method) => setRefundForm({ ...refundForm, method })} />
          <Field label="Refund reference"><input required className="input w-full" value={refundForm.reference} onChange={(e) => setRefundForm({ ...refundForm, reference: e.target.value })} /></Field>
          <Field label="Reason"><textarea required className="input min-h-20 w-full" value={refundForm.notes} onChange={(e) => setRefundForm({ ...refundForm, notes: e.target.value })} /></Field>
          <div className="flex gap-2"><button type="button" onClick={() => setRefundOpen(false)} className="btn-secondary flex-1">Cancel</button><button disabled={saving} className="btn-primary flex-1 bg-rose-600 hover:bg-rose-700">Record refund</button></div>
        </form>
      </Modal>}

      {receipt && <AdvanceReceipt receipt={receipt} currency={currency} settings={settings} onClose={() => setReceipt(null)} />}
    </div>
  )
}

function Field({ label, children }) {
  return <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>{children}</label>
}

function MethodSelect({ value, onChange }) {
  return <Field label="Payment method"><select className="input w-full" value={value} onChange={(e) => onChange(e.target.value)}>{PAYMENT_METHODS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
}

function AdvanceReceipt({ receipt, currency, settings, onClose }) {
  const print = () => window.api.receipts.printCurrent({ silent: false }).catch(() => null)
  const receiptNumber = receipt.receipt_number || `PRE-PENDING-${String(receipt.id).slice(0, 6).toUpperCase()}`
  const save = () => window.api.receipts.savePDF({
    guestName: receipt.customer.name,
    invoiceNumber: receiptNumber,
    documentType: 'prepayment',
    defaultFilename: `${receiptNumber}-${receipt.customer.name}`,
    receipt: {
      receiptNumber,
      customerName: receipt.customer.name,
      amount: Number(receipt.amount || 0),
      currency,
      method: receipt.method,
      reference: receipt.reference || '',
      notes: receipt.notes || '',
      balance: Number(receipt.balance || 0),
      createdAt: receipt.created_at,
      provisional: receipt.offline === true,
      lodgeName: settings?.lodge_name || settings?.company_name || 'Lodge',
      companyName: settings?.company_name || '',
      address: settings?.address || '',
      phone: settings?.phone || '',
      email: settings?.email || '',
      website: settings?.website || '',
      logo: settings?.logo || ''
    }
  }).catch(() => null)
  return <Modal title="Advance Payment Receipt" onClose={onClose} size="lg">
    <div id="printable-receipt" className="mx-auto min-h-[297mm] w-full max-w-[210mm] space-y-8 bg-white p-8 sm:p-12 print:min-h-0 print:w-[210mm] print:max-w-none print:p-[16mm]">
      {receipt.offline && <div className="rounded-lg bg-amber-50 p-3 text-center text-xs font-semibold text-amber-800">PROVISIONAL — PENDING SERVER CONFIRMATION</div>}
      <div className="text-center">
        <h2 className="text-2xl font-bold">{settings?.lodge_name || settings?.company_name || 'Lodge'}</h2>
        <p className="text-sm text-slate-500">{settings?.address || ''}</p>
        <h3 className="mt-8 text-xl font-semibold">Advance Payment Receipt</h3>
        <p className="mt-1 text-sm text-slate-500">{receiptNumber}</p>
      </div>
      <div className="grid grid-cols-2 gap-4 rounded-xl border border-slate-200 p-4 text-sm">
        <div><span className="text-slate-500">Customer</span><p className="font-semibold">{receipt.customer.name}</p></div>
        <div><span className="text-slate-500">Date</span><p className="font-semibold">{new Date(receipt.created_at).toLocaleString()}</p></div>
        <div><span className="text-slate-500">Method</span><p className="font-semibold">{receipt.method.replaceAll('_', ' ')}</p></div>
        <div><span className="text-slate-500">Reference</span><p className="font-semibold">{receipt.reference || '—'}</p></div>
      </div>
      <div className="rounded-xl bg-emerald-50 p-5 text-center"><p className="text-sm text-emerald-700">Amount received</p><p className="text-3xl font-bold text-emerald-800">{money(currency, receipt.amount)}</p><p className="mt-2 text-sm text-emerald-700">Remaining customer credit: {money(currency, receipt.balance)}</p></div>
      {receipt.notes && <div className="rounded-xl border border-slate-200 p-4 text-sm"><span className="text-slate-500">Notes</span><p className="mt-1 text-slate-800">{receipt.notes}</p></div>}
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center text-sm font-semibold text-amber-900">This payment is held as customer credit. It does not reserve accommodation or guarantee room availability until a booking is confirmed.</p>
      <div className="flex justify-end gap-2 print:hidden"><button onClick={save} className="btn-secondary flex items-center gap-2"><Download size={15} /> Save PDF</button><button onClick={print} className="btn-primary flex items-center gap-2"><Printer size={15} /> Print</button></div>
    </div>
  </Modal>
}
