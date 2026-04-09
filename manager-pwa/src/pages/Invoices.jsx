import { useEffect, useState } from 'react'
import { CreditCard, ReceiptText, RefreshCw, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { FRONT_DESK_ONLY_MESSAGE, getBookingPayments, listInvoices } from '../lib/api'
import { money, paymentStatusClass, shortDate, shortDateTime, titleCase } from '../lib/format'

function LedgerSheet({ lodgeId, invoice, onClose }) {
  const [payments, setPayments] = useState([])

  useEffect(() => {
    getBookingPayments(lodgeId, invoice.booking_id).then(setPayments).catch(() => setPayments([]))
  }, [invoice.booking_id, lodgeId])

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div className="bg-gray-900 rounded-t-3xl p-5 w-full max-h-[90vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
        <div className="w-10 h-1 bg-gray-700 rounded-full mx-auto mb-4" />
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">Payment Ledger</h2>
          <button onClick={onClose} className="text-gray-500"><X size={20} /></button>
        </div>
        <div className="space-y-2">
          {payments.map((payment) => (
            <div key={payment.id || `${payment.amount}-${payment.paid_at}`} className="bg-gray-800 rounded-xl p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">{titleCase(payment.type || 'payment')}</p>
                  <p className="text-xs text-gray-400 mt-1">{shortDateTime(payment.paid_at || payment.created_at)} • {titleCase(payment.method || 'cash')}</p>
                </div>
                <p className={`text-sm font-bold ${Number(payment.amount || 0) < 0 ? 'text-red-300' : 'text-green-300'}`}>{money(payment.amount)}</p>
              </div>
              {payment.notes && <p className="text-xs text-gray-500 mt-2">{payment.notes}</p>}
            </div>
          ))}
          {payments.length === 0 && <p className="text-sm text-gray-500">No payment history found for this booking.</p>}
        </div>
      </div>
    </div>
  )
}

export default function Invoices() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [invoices, setInvoices] = useState([])
  const [ledger, setLedger] = useState(null)
  const [search, setSearch] = useState('')

  const load = async () => {
    setLoading(true)
    const data = await listInvoices(user.lodge_id, { forceFresh: true }).catch(() => [])
    setInvoices(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [user.lodge_id])

  const filtered = invoices.filter((invoice) => {
    const query = search.toLowerCase()
    return !query || invoice.customer_name?.toLowerCase().includes(query) || invoice.invoice_number?.toLowerCase().includes(query)
  })

  const outstanding = filtered.reduce((sum, invoice) => sum + Number(invoice.balance_due || 0), 0)

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-12 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">Invoices</h1>
            <p className="text-xs text-gray-400">Outstanding • {money(outstanding)}</p>
          </div>
          <button onClick={load} className="p-2 text-gray-400"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
        </div>
        <input className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white mt-3" placeholder="Search invoices…" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="mt-3 rounded-xl border border-yellow-800 bg-yellow-950/40 px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-yellow-300">Front Desk only</p>
          <p className="mt-1 text-sm text-yellow-100">{FRONT_DESK_ONLY_MESSAGE}</p>
        </div>
      </div>

      <div className="px-4 py-4 space-y-3">
        {filtered.map((invoice) => (
          <div key={invoice.booking_id} className="bg-gray-800 rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">{invoice.customer_name || 'Guest'}</p>
                <p className="text-xs text-gray-400 mt-1">{invoice.invoice_number} • {shortDate(invoice.issued_at)}</p>
                <p className="text-xs text-gray-500 mt-1">Paid {money(invoice.amount_paid)} • Balance {money(invoice.balance_due)}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${paymentStatusClass(invoice.payment_status)}`}>
                {titleCase(invoice.payment_status)}
              </span>
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={() => setLedger(invoice)} className="flex-1 bg-gray-900 text-white rounded-xl py-2 text-xs font-semibold flex items-center justify-center gap-1">
                <CreditCard size={13} /> Ledger
              </button>
              <div className="bg-yellow-950/40 border border-yellow-800 text-yellow-100 rounded-xl px-3 py-2 text-[11px] font-medium flex items-center">
                Refunds must be processed from Front Desk
              </div>
            </div>
          </div>
        ))}
        {!loading && filtered.length === 0 && (
          <div className="text-sm text-gray-500 flex items-center gap-2">
            <ReceiptText size={16} /> No invoices found.
          </div>
        )}
      </div>

      {ledger && <LedgerSheet lodgeId={user.lodge_id} invoice={ledger} onClose={() => setLedger(null)} />}
    </div>
  )
}
