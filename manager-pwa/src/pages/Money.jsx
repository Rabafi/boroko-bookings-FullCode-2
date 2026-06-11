import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, FileText, HandCoins, ReceiptText, RefreshCw, ScrollText, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getNightAudit, getRefundHistory, listExpenses, listInvoices, listQuotations } from '../lib/api'
import { money, paymentStatusClass, shortDate, shortDateTime, titleCase } from '../lib/format'
import { sendFrontDeskRequest } from '../lib/frontDeskRequests'
import { readCacheEntry } from '../lib/runtime'
import DataFreshness from '../components/DataFreshness'
import EmptyState from '../components/EmptyState'
import MobileBoundaryNotice from '../components/MobileBoundaryNotice'
import { useToast } from '../App'

function RouteCard({ to, title, value, sub, icon: Icon }) {
  return (
    <Link to={to} className="bg-gray-800 rounded-2xl p-4 flex items-center gap-3 active:scale-[0.98] transition-transform">
      <div className="w-11 h-11 rounded-2xl bg-green-900/40 text-green-300 flex items-center justify-center">
        <Icon size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="text-xl font-bold text-white mt-0.5">{value}</p>
        <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
      </div>
      <ArrowRight size={18} className="text-gray-500" />
    </Link>
  )
}

function Sheet({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end bg-black/60" onClick={onClose}>
      <div className="bg-gray-900 rounded-t-3xl p-5 pb-28 w-full max-h-[85vh] overflow-y-auto overscroll-contain" onClick={(event) => event.stopPropagation()}>
        <div className="w-10 h-1 bg-gray-700 rounded-full mx-auto mb-4" />
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <button onClick={onClose} className="text-gray-500"><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

export default function Money() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [sendingRequest, setSendingRequest] = useState('')
  const [requestNote, setRequestNote] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)
  const [sheet, setSheet] = useState(null)
  const balancesRef = useRef(null)
  const handledFocusRef = useRef('')
  const [snapshot, setSnapshot] = useState({
    quotations: [],
    invoices: [],
    expenses: [],
    refunds: [],
    audit: null
  })

  useEffect(() => {
    let cancelled = false
    async function load(silent = false) {
      if (!silent) setLoading(true)
      if (!silent) setLoadError('')
      const today = new Date().toISOString().slice(0, 10)
      const monthStart = `${today.slice(0, 7)}-01`
      try {
        const [quotations, invoices, expenses, refunds, audit] = await Promise.all([
          listQuotations(user.lodge_id).catch(() => []),
          listInvoices(user.lodge_id, { forceFresh: true }),
          listExpenses(user.lodge_id, monthStart, today, { forceFresh: true }).catch(() => []),
          getRefundHistory(user.lodge_id, 6).catch(() => []),
          getNightAudit(user.lodge_id, today).catch(() => null)
        ])
        if (cancelled) return
        setSnapshot({ quotations, invoices, expenses, refunds, audit })
        const expenseCacheKey = `expenses:${monthStart}:${today}`
        const cacheTimes = [
          readCacheEntry(user.lodge_id, 'invoice_summary_v2', null)?.updatedAt,
          readCacheEntry(user.lodge_id, expenseCacheKey, null)?.updatedAt,
          readCacheEntry(user.lodge_id, 'quotations', null)?.updatedAt
        ].filter(Boolean).sort().at(-1) || null
        setLastUpdated(cacheTimes)
      } catch (error) {
        if (!cancelled) {
          setLoadError(error?.message || 'Money data could not load.')
        }
      } finally {
        if (!silent && !cancelled) setLoading(false)
      }
    }
    load()
    const handleVisible = () => {
      if (document.visibilityState === 'visible') load(true)
    }
    const interval = window.setInterval(() => load(true), 60_000)
    document.addEventListener('visibilitychange', handleVisible)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisible)
    }
  }, [user.lodge_id])

  const currency = 'P'
  const outstanding = snapshot.invoices.reduce((sum, invoice) => sum + Number(invoice.balance_due || 0), 0)
  const monthExpenses = snapshot.expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)
  const activeQuotes = snapshot.quotations.filter((item) => ['draft', 'sent', 'accepted'].includes(item.status)).length
  const expenseCategories = useMemo(() => {
    const grouped = new Map()
    snapshot.expenses.forEach((expense) => {
      const key = expense.category || 'Other'
      grouped.set(key, (grouped.get(key) || 0) + Number(expense.amount || 0))
    })
    return [...grouped.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((left, right) => right.amount - left.amount)
      .slice(0, 6)
  }, [snapshot.expenses])
  const topBalances = [...snapshot.invoices]
    .sort((left, right) => Number(right.balance_due || 0) - Number(left.balance_due || 0))
    .slice(0, 5)

  useEffect(() => {
    const focus = searchParams.get('focus')
    if (focus !== 'outstanding' || loading || handledFocusRef.current === focus) return
    handledFocusRef.current = focus
    setSheet('balances')
    window.setTimeout(() => balancesRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 120)
  }, [loading, searchParams])

  async function sendRequest(type) {
    setSendingRequest(type)
    const templates = {
      balance: {
        title: 'Balance follow-up request',
        description: 'Please check the top outstanding balances and confirm today’s collection plan.',
        category: 'Front Desk Request',
        priority: 'High'
      },
      refund: {
        title: 'Refund clarification request',
        description: 'Please review the latest refund activity and confirm guest communication is complete.',
        category: 'Front Desk Request',
        priority: 'Normal'
      },
      expense: {
        title: 'Expense clarification request',
        description: 'Please review today’s main expense entries and add any missing notes or receipts on the desktop.',
        category: 'Front Desk Request',
        priority: 'Normal'
      }
    }
    try {
      const note = requestNote.trim()
      const description = note
        ? `${templates[type].description}\n\nAdded note: ${note}`
        : templates[type].description
      const result = await sendFrontDeskRequest({
        user,
        title: templates[type].title,
        description,
        category: templates[type].category,
        priority: templates[type].priority,
        context: { kind: `money-${type}` }
      })
      if (!result?.queued) setRequestNote('')
      showToast({
        title: result?.queued ? 'Request saved offline' : 'Request sent',
        message: result?.queued
          ? 'It will reach front desk automatically when the device reconnects.'
          : 'Front desk can now review this request on the desktop dashboard.',
        tone: result?.queued ? 'queued' : 'success'
      })
    } catch (error) {
      showToast({
        title: 'Request was not sent',
        message: error?.message || 'Please try again.',
        tone: 'error'
      })
    } finally {
      setSendingRequest('')
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-12 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">Money</h1>
            <p className="text-xs text-gray-400">Watch cash, refunds, balances, and spend without changing financial records from mobile</p>
            <DataFreshness updatedAt={lastUpdated} loading={loading} error={loadError} className="mt-1" />
          </div>
          <button
            onClick={async () => {
              try {
                setLoading(true)
                const today = new Date().toISOString().slice(0, 10)
                const monthStart = `${today.slice(0, 7)}-01`
                const [quotations, invoices, expenses, refunds, audit] = await Promise.all([
                  listQuotations(user.lodge_id).catch(() => []),
                  listInvoices(user.lodge_id, { forceFresh: true }),
                  listExpenses(user.lodge_id, monthStart, today, { forceFresh: true }).catch(() => []),
                  getRefundHistory(user.lodge_id, 6).catch(() => []),
                  getNightAudit(user.lodge_id, today).catch(() => null)
                ])
                setSnapshot({ quotations, invoices, expenses, refunds, audit })
                const expenseCacheKey = `expenses:${monthStart}:${today}`
                const cacheTimes = [
                  readCacheEntry(user.lodge_id, 'invoice_summary_v2', null)?.updatedAt,
                  readCacheEntry(user.lodge_id, expenseCacheKey, null)?.updatedAt,
                  readCacheEntry(user.lodge_id, 'quotations', null)?.updatedAt
                ].filter(Boolean).sort().at(-1) || null
                setLastUpdated(cacheTimes)
                setLoadError('')
                showToast({
                  title: 'Money view refreshed',
                  message: 'Latest bookings, invoices, refunds, and expenses were reloaded.',
                  tone: 'success'
                })
              } catch (error) {
                showToast({
                  title: 'Money view could not refresh',
                  message: error?.message || 'Please try again.',
                  tone: 'error'
                })
              } finally {
                setLoading(false)
              }
            }}
            className="p-2 text-gray-400 hover:text-white"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="px-4 py-4 space-y-3">
        {loadError && <p className="text-sm text-red-400">{loadError}</p>}
        <div className="grid grid-cols-1 gap-3">
          <RouteCard to="/quotations" title="Quotations" value={loading ? '…' : activeQuotes} sub="Open offers and booking conversions" icon={ScrollText} />
          <RouteCard to="/invoices" title="Invoices" value={loading ? '…' : money(outstanding, currency)} sub="Outstanding guest balances" icon={ReceiptText} />
          <RouteCard to="/expenses" title="Expenses" value={loading ? '…' : money(monthExpenses, currency)} sub="This month’s operating spend" icon={HandCoins} />
          <RouteCard to="/audit" title="Night Audit" value="Daily close" sub="End-of-day summary and payment follow-up" icon={FileText} />
        </div>

        <div ref={balancesRef} className="bg-gray-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-white">Shift Snapshot</p>
            <Link to="/audit" className="text-xs text-green-400">Full audit</Link>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setSheet('shift')} className="bg-gray-900 rounded-xl px-3 py-3 text-left">
              <p className="text-xs text-gray-400">Gross collected</p>
              <p className="text-lg font-bold text-white mt-1">{money(snapshot.audit?.gross_collected)}</p>
            </button>
            <button onClick={() => setSheet('refunds')} className="bg-gray-900 rounded-xl px-3 py-3 text-left">
              <p className="text-xs text-gray-400">Refunds today</p>
              <p className="text-lg font-bold text-rose-300 mt-1">{money(snapshot.audit?.refunds_issued)}</p>
            </button>
            <button onClick={() => setSheet('expenses')} className="bg-gray-900 rounded-xl px-3 py-3 text-left">
              <p className="text-xs text-gray-400">Expenses today</p>
              <p className="text-lg font-bold text-red-300 mt-1">{money(snapshot.audit?.expenses_total)}</p>
            </button>
            <button onClick={() => setSheet('balances')} className="bg-gray-900 rounded-xl px-3 py-3 text-left">
              <p className="text-xs text-gray-400">Outstanding</p>
              <p className="text-lg font-bold text-yellow-300 mt-1">{money(snapshot.audit?.outstanding_total)}</p>
            </button>
          </div>
        </div>

        <div className="bg-gray-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-white">Front Desk Requests</p>
            <span className="text-xs text-gray-500">Lightweight only</span>
          </div>
          <p className="mb-3 text-xs text-gray-500">These requests appear on the front-desk desktop dashboard so the team can reply without giving mobile access to money-changing actions.</p>
          <textarea
            className="mb-3 w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-3 text-white text-sm h-24 resize-none"
            placeholder="Optional note for front desk"
            value={requestNote}
            onChange={(event) => setRequestNote(event.target.value)}
            maxLength={500}
          />
          <div className="grid grid-cols-1 gap-2">
            <button onClick={() => sendRequest('balance')} disabled={sendingRequest !== ''} className="bg-gray-900 text-white rounded-xl px-3 py-3 text-sm font-medium text-left disabled:opacity-60">
              {sendingRequest === 'balance' ? 'Sending…' : 'Ask front desk to follow up outstanding balances'}
            </button>
            <button onClick={() => sendRequest('refund')} disabled={sendingRequest !== ''} className="bg-gray-900 text-white rounded-xl px-3 py-3 text-sm font-medium text-left disabled:opacity-60">
              {sendingRequest === 'refund' ? 'Sending…' : 'Ask for a refund clarification'}
            </button>
            <button onClick={() => sendRequest('expense')} disabled={sendingRequest !== ''} className="bg-gray-900 text-white rounded-xl px-3 py-3 text-sm font-medium text-left disabled:opacity-60">
              {sendingRequest === 'expense' ? 'Sending…' : 'Ask for an expense clarification'}
            </button>
          </div>
        </div>

        <div className="bg-gray-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-white">Open Invoices</p>
            <Link to="/invoices" className="text-xs text-green-400">View all</Link>
          </div>
          <div className="space-y-2">
            {snapshot.invoices.slice(0, 5).map((invoice) => (
              <div key={invoice.booking_id} className="bg-gray-900 rounded-xl px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{invoice.customer_name || 'Guest'}</p>
                    <p className="text-xs text-gray-400">{invoice.invoice_number} • {shortDate(invoice.issued_at)}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${paymentStatusClass(invoice.payment_status)}`}>
                    {titleCase(invoice.payment_status)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs mt-2">
                  <span className="text-gray-400">Balance</span>
                  <span className="text-yellow-300 font-semibold">{money(invoice.balance_due, currency)}</span>
                </div>
              </div>
            ))}
            {!loading && snapshot.invoices.length === 0 && (
              <EmptyState
                embedded
                icon={ReceiptText}
                title="No open invoices"
                message="There are no invoices cached on this device. Refresh Money or ask front desk if an expected balance is missing."
              />
            )}
          </div>
        </div>

        <div className="bg-gray-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-white">Recent Refunds</p>
            <Link to="/invoices" className="text-xs text-green-400">Invoices</Link>
          </div>
          <div className="space-y-2">
            {snapshot.refunds.map((refund) => (
              <div key={refund.id} className="bg-gray-900 rounded-xl px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{refund.invoice_number || 'Invoice'}</p>
                    <p className="text-xs text-gray-400 mt-1">{refund.approved_by_name || 'Approver pending'} • {shortDateTime(refund.created_at)}</p>
                  </div>
                  <p className="text-sm font-bold text-rose-300">{money(refund.refund_amount)}</p>
                </div>
                <p className="text-xs text-gray-500 mt-2">Retained {money(refund.retained_amount)} • {Number(refund.retained_percent || 0)}%</p>
              </div>
            ))}
            {!loading && snapshot.refunds.length === 0 && (
              <EmptyState
                embedded
                icon={FileText}
                title="No recent refunds"
                message="Refund activity will appear here after it is recorded on desktop."
              />
            )}
          </div>
        </div>

        <div className="bg-gray-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-white">Expense Categories</p>
            <Link to="/expenses" className="text-xs text-green-400">Expenses</Link>
          </div>
          <div className="space-y-2">
            {expenseCategories.map((entry) => (
              <div key={entry.category} className="bg-gray-900 rounded-xl px-3 py-3 flex items-center justify-between gap-3">
                <p className="text-sm text-white">{entry.category}</p>
                <p className="text-sm font-semibold text-red-300">{money(entry.amount)}</p>
              </div>
            ))}
            {!loading && expenseCategories.length === 0 && (
              <EmptyState
                embedded
                icon={HandCoins}
                title="No expense categories yet"
                message="This month’s spend will appear here after front desk or desktop records expenses."
              />
            )}
          </div>
        </div>

        <div className="bg-gray-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-white">Top Balances</p>
            <Link to="/invoices" className="text-xs text-green-400">Invoices</Link>
          </div>
          <div className="space-y-2">
            {topBalances.map((invoice) => (
              <div key={invoice.booking_id} className="bg-gray-900 rounded-xl px-3 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{invoice.customer_name || 'Guest'}</p>
                  <p className="text-xs text-gray-400 mt-1">{invoice.invoice_number} • {shortDate(invoice.check_in)}</p>
                </div>
                <p className="text-sm font-semibold text-yellow-300">{money(invoice.balance_due)}</p>
              </div>
            ))}
            {!loading && topBalances.length === 0 && (
              <EmptyState
                embedded
                icon={ReceiptText}
                title="No outstanding balances"
                message="Nothing needs collection follow-up from the Money view right now."
              />
            )}
          </div>
        </div>

        <MobileBoundaryNotice compact>
          Money is review-and-request on mobile. Front desk or desktop completes payments, invoices, refunds, and expense changes.
        </MobileBoundaryNotice>
      </div>
      {sheet === 'shift' && (
        <Sheet title="Shift Snapshot" onClose={() => setSheet(null)}>
          <div className="space-y-2">
            {[
              ['Gross collected', snapshot.audit?.gross_collected, 'text-white'],
              ['Refunds', snapshot.audit?.refunds_issued, 'text-rose-300'],
              ['Net collected', snapshot.audit?.net_collected, 'text-green-300'],
              ['POS revenue', snapshot.audit?.pos_revenue, 'text-blue-300'],
              ['Outstanding', snapshot.audit?.outstanding_total, 'text-yellow-300']
            ].map(([label, value, tone]) => (
              <div key={label} className="bg-gray-800 rounded-xl px-3 py-3 flex items-center justify-between gap-3">
                <p className="text-sm text-white">{label}</p>
                <p className={`text-sm font-semibold ${tone}`}>{money(value)}</p>
              </div>
            ))}
          </div>
        </Sheet>
      )}
      {sheet === 'refunds' && (
        <Sheet title="Recent Refunds" onClose={() => setSheet(null)}>
          <div className="space-y-2">
            {snapshot.refunds.map((refund) => (
              <div key={refund.id} className="bg-gray-800 rounded-xl px-3 py-3">
                <p className="text-sm font-semibold text-white">{refund.invoice_number || 'Invoice'}</p>
                <p className="text-xs text-gray-400 mt-1">{shortDateTime(refund.created_at)}</p>
                <p className="text-sm font-semibold text-rose-300 mt-2">{money(refund.refund_amount)}</p>
              </div>
            ))}
            {snapshot.refunds.length === 0 && <p className="text-sm text-gray-500">No refunds recorded recently.</p>}
          </div>
        </Sheet>
      )}
      {sheet === 'expenses' && (
        <Sheet title="Expense Categories" onClose={() => setSheet(null)}>
          <div className="space-y-2">
            {expenseCategories.map((entry) => (
              <div key={entry.category} className="bg-gray-800 rounded-xl px-3 py-3 flex items-center justify-between gap-3">
                <p className="text-sm text-white">{entry.category}</p>
                <p className="text-sm font-semibold text-red-300">{money(entry.amount)}</p>
              </div>
            ))}
          </div>
        </Sheet>
      )}
      {sheet === 'balances' && (
        <Sheet title="Top Outstanding Balances" onClose={() => setSheet(null)}>
          <div className="space-y-2">
            {topBalances.map((invoice) => (
              <div key={invoice.booking_id} className="bg-gray-800 rounded-xl px-3 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{invoice.customer_name || 'Guest'}</p>
                  <p className="text-xs text-gray-400 mt-1">{invoice.invoice_number}</p>
                </div>
                <p className="text-sm font-semibold text-yellow-300">{money(invoice.balance_due)}</p>
              </div>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  )
}
