import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ArrowRight, FileText, HandCoins, ReceiptText, RefreshCw, ScrollText, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getNightAudit, getRefundHistory, listExpenses, listInvoices, listQuotations, getCustomerCreditSummaryPwa, getManagerPosSnapshot } from '../lib/api'
import { businessDate, money, shortDate, shortDateTime } from '../lib/format'
import { sendFrontDeskRequest } from '../lib/frontDeskRequests'
import { readCacheEntry } from '../lib/runtime'
import DataFreshness from '../components/DataFreshness'
import EmptyState from '../components/EmptyState'
import MobileBoundaryNotice from '../components/MobileBoundaryNotice'
import { useToast } from '../App'
import { isBarHospitalityMode } from '../lib/productShell'

function BarMoney({ lodgeId }) {
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await getManagerPosSnapshot(lodgeId, { forceFresh: true })
      setSnapshot(result)
      setUpdatedAt(result?.as_of || new Date().toISOString())
    } catch (loadError) {
      setSnapshot(null)
      setError(loadError?.message || 'Bar money data could not be loaded from the server.')
    } finally {
      setLoading(false)
    }
  }, [lodgeId])

  useEffect(() => { load() }, [load])
  const confirmed = snapshot?.complete === true
  const currency = 'P'

  return <div className="min-h-screen bg-gray-950 pb-24">
    <header className="bg-gray-900 px-4 pb-4 pt-12"><div className="flex items-start justify-between gap-3"><div><h1 className="text-lg font-bold text-white">Bar money</h1><p className="mt-1 text-xs text-gray-400">Server-confirmed POS sales, tenders and close readiness</p><DataFreshness updatedAt={updatedAt} loading={loading} error={error} className="mt-1" /></div><button type="button" onClick={load} className="rounded-full bg-white/5 p-2 text-gray-300" aria-label="Refresh Bar money"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button></div></header>
    <main className="space-y-4 px-4 py-4">
      {error && <div className="rounded-2xl border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{error}</div>}
      {snapshot && !confirmed && <div className="rounded-2xl border border-amber-800 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">The POS source is incomplete. Monetary totals remain unavailable until unresolved transactions are cleared.</div>}
      <section className="grid grid-cols-2 gap-3"><div className="rounded-2xl bg-gray-800 p-4"><p className="text-xs text-gray-400">Net sales</p><p className="mt-1 text-xl font-bold text-emerald-200">{confirmed ? money(snapshot.net_sales, currency) : 'Unavailable'}</p></div><div className="rounded-2xl bg-gray-800 p-4"><p className="text-xs text-gray-400">Completed sales</p><p className="mt-1 text-xl font-bold text-white">{confirmed ? snapshot.sale_count : 'Unavailable'}</p></div><div className="rounded-2xl bg-gray-800 p-4"><p className="text-xs text-gray-400">Open tabs</p><p className="mt-1 text-xl font-bold text-amber-200">{confirmed ? snapshot.open_count : 'Unavailable'}</p></div><div className="rounded-2xl bg-gray-800 p-4"><p className="text-xs text-gray-400">Returns</p><p className="mt-1 text-xl font-bold text-rose-200">{confirmed ? money(snapshot.returns_total, currency) : 'Unavailable'}</p></div></section>
      <section className="rounded-2xl bg-gray-800 p-4"><h2 className="text-sm font-semibold text-white">Tender totals</h2>{confirmed && Array.isArray(snapshot.by_payment) && snapshot.by_payment.length > 0 ? <div className="mt-3 space-y-2">{snapshot.by_payment.map((row) => <div key={row.method} className="flex justify-between text-sm"><span className="capitalize text-gray-400">{String(row.method).replace(/_/g, ' ')}</span><span className="font-semibold text-white">{money(row.amount, currency)}</span></div>)}</div> : <p className="mt-2 text-sm text-gray-500">{confirmed ? 'No posted tenders in this period.' : 'Unavailable until the POS report is complete.'}</p>}</section>
      <p className="text-xs text-gray-500">Cash-up approval, returns, voids and corrections remain in the desktop Bar workflow. This mobile page is read-only.</p>
    </main>
  </div>
}

function RouteLink({ to, title, value, sub, icon: Icon }) {
  return (
    <Link to={to} className="bg-gray-800 rounded-2xl p-3 flex items-center gap-3 active:scale-[0.98] transition-transform">
      <div className="w-10 h-10 rounded-xl bg-green-900/40 text-green-300 flex items-center justify-center shrink-0">
        <Icon size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="text-lg font-bold text-white mt-0.5">{value}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>
      </div>
      <ArrowRight size={16} className="text-gray-500 shrink-0" />
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
  if (isBarHospitalityMode(user?.hospitality_mode)) return <BarMoney lodgeId={user?.lodge_id} />
  return <LodgingMoney />
}

function LodgingMoney() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)
  const [sheet, setSheet] = useState(null)
  const balancesRef = useRef(null)
  const handledFocusRef = useRef('')
  const [snapshot, setSnapshot] = useState({
    quotations: [],
    invoices: [],
    expenses: [],
    refunds: [],
    audit: null,
    customerCredits: []
  })

  useEffect(() => {
    let cancelled = false
    async function load(silent = false) {
      if (!silent) setLoading(true)
      if (!silent) setLoadError('')
      const today = businessDate()
      const monthStart = `${today.slice(0, 7)}-01`
      try {
        const [quotations, invoices, expenses, refunds, audit, customerCredits] = await Promise.all([
          listQuotations(user.lodge_id).catch(() => []),
          listInvoices(user.lodge_id, { forceFresh: true }),
          listExpenses(user.lodge_id, monthStart, today, { forceFresh: true }).catch((error) => ({ error })),
          getRefundHistory(user.lodge_id, 6).catch(() => []),
          getNightAudit(user.lodge_id, today).catch(() => null),
          getCustomerCreditSummaryPwa(user.lodge_id).catch(() => [])
        ])
        if (cancelled) return
        const expenseReadError = expenses?.error
        setSnapshot({ quotations, invoices, expenses: expenseReadError ? [] : expenses, refunds, audit, customerCredits })
        if (expenseReadError) setLoadError(expenseReadError.message || 'Expenses could not be loaded from the server; no estimate was included.')
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
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') load(true)
    }, 2 * 60_000)
    document.addEventListener('visibilitychange', handleVisible)
    window.addEventListener('online', () => load(true))
    return () => {
      cancelled = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisible)
    }
  }, [user.lodge_id])

  const currency = 'P'
  const outstanding = snapshot.invoices.reduce((sum, invoice) => sum + Number(invoice.balance_due || 0), 0)
  const topBalances = [...snapshot.invoices]
    .sort((left, right) => Number(right.balance_due || 0) - Number(left.balance_due || 0))
    .slice(0, 3)
  const totalCustomerCredit = snapshot.customerCredits.reduce((sum, c) => sum + Number(c.balance || 0), 0)

  useEffect(() => {
    const focus = searchParams.get('focus')
    if (focus !== 'outstanding' || loading || handledFocusRef.current === focus) return
    handledFocusRef.current = focus
    setSheet('balances')
    window.setTimeout(() => balancesRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 120)
  }, [loading, searchParams])

  async function sendFollowUp(invoice) {
    try {
      const result = await sendFrontDeskRequest({
        user,
        title: 'Balance follow-up request',
        description: `Please follow up ${invoice.customer_name || 'this guest'} about the outstanding balance of ${money(invoice.balance_due)}. Invoice: ${invoice.invoice_number}.`,
        priority: 'High',
        context: { kind: 'money-balance', referenceId: invoice.booking_id }
      })
      showToast({
        title: result?.queued ? 'Request saved offline' : 'Request sent',
        message: result?.queued
          ? 'It will reach front desk automatically when the device reconnects.'
          : 'Front desk can now review this request on desktop.',
        tone: result?.queued ? 'queued' : 'success'
      })
    } catch (error) {
      showToast({
        title: 'Request was not sent',
        message: error?.message || 'Please try again.',
        tone: 'error'
      })
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-2 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">Money</h1>
            <DataFreshness updatedAt={lastUpdated} loading={loading} error={loadError} className="mt-0.5" />
          </div>
          <button
            onClick={async () => {
              try {
                setLoading(true)
                const today = businessDate()
                const monthStart = `${today.slice(0, 7)}-01`
                const [quotations, invoices, expenses, refunds, audit] = await Promise.all([
                  listQuotations(user.lodge_id).catch(() => []),
                  listInvoices(user.lodge_id, { forceFresh: true }),
                  listExpenses(user.lodge_id, monthStart, today, { forceFresh: true }).catch((error) => ({ error })),
                  getRefundHistory(user.lodge_id, 6).catch(() => []),
                  getNightAudit(user.lodge_id, today).catch(() => null)
                ])
                const expenseReadError = expenses?.error
                setSnapshot((current) => ({ ...current, quotations, invoices, expenses: expenseReadError ? [] : expenses, refunds, audit }))
                if (expenseReadError) setLoadError(expenseReadError.message || 'Expenses could not be loaded from the server; no estimate was included.')
                const expenseCacheKey = `expenses:${monthStart}:${today}`
                const cacheTimes = [
                  readCacheEntry(user.lodge_id, 'invoice_summary_v2', null)?.updatedAt,
                  readCacheEntry(user.lodge_id, expenseCacheKey, null)?.updatedAt,
                  readCacheEntry(user.lodge_id, 'quotations', null)?.updatedAt
                ].filter(Boolean).sort().at(-1) || null
                setLastUpdated(cacheTimes)
                setLoadError('')
                showToast({ title: 'Money view refreshed', tone: 'success' })
              } catch (error) {
                showToast({ title: 'Money view could not refresh', message: error?.message, tone: 'error' })
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

      <div className="px-4 py-3 space-y-3">
        {loadError && <p className="text-sm text-red-400">{loadError}</p>}

        <div ref={balancesRef} className="bg-gray-800 rounded-2xl p-3">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setSheet('shift')} className="bg-gray-900 rounded-xl px-3 py-2.5 text-left">
              <p className="text-[11px] text-gray-400">Gross collected</p>
              <p className="text-lg font-bold text-white mt-0.5">{money(snapshot.audit?.gross_collected)}</p>
            </button>
            <button onClick={() => setSheet('refunds')} className="bg-gray-900 rounded-xl px-3 py-2.5 text-left">
              <p className="text-[11px] text-gray-400">Refunds today</p>
              <p className="text-lg font-bold text-rose-300 mt-0.5">{money(snapshot.audit?.refunds_issued)}</p>
            </button>
            <button onClick={() => setSheet('expenses')} className="bg-gray-900 rounded-xl px-3 py-2.5 text-left">
              <p className="text-[11px] text-gray-400">Expenses today</p>
              <p className="text-lg font-bold text-red-300 mt-0.5">{money(snapshot.audit?.expenses_total)}</p>
            </button>
            <button onClick={() => setSheet('balances')} className="bg-gray-900 rounded-xl px-3 py-2.5 text-left">
              <p className="text-[11px] text-gray-400">Outstanding</p>
              <p className="text-lg font-bold text-yellow-300 mt-0.5">{money(snapshot.audit?.outstanding_total)}</p>
            </button>
          </div>
          {totalCustomerCredit > 0 && (
            <button onClick={() => setSheet('customerCredit')} className="w-full bg-gray-900 rounded-xl px-3 py-2.5 text-left mt-2">
              <p className="text-[11px] text-gray-400">Customer Credit Outstanding</p>
              <p className="text-lg font-bold text-cyan-300 mt-0.5">{money(totalCustomerCredit)}</p>
              <p className="text-[11px] text-gray-500 mt-0.5">{snapshot.customerCredits.length} customer{snapshot.customerCredits.length !== 1 ? 's' : ''} with credit</p>
            </button>
          )}
        </div>

        {topBalances.length > 0 && (
          <div className="bg-gray-800 rounded-2xl p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-white">Top Balances</p>
              <Link to="/invoices" className="text-xs text-green-400">Invoices</Link>
            </div>
            <div className="space-y-1.5">
              {topBalances.map((invoice) => (
                <div key={invoice.booking_id} className="bg-gray-900 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white truncate">{invoice.customer_name || 'Guest'}</p>
                    <p className="text-[11px] text-gray-400">{invoice.invoice_number} \u2022 {shortDate(invoice.check_in)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-yellow-300">{money(invoice.balance_due)}</p>
                    <button
                      onClick={() => sendFollowUp(invoice)}
                      className="shrink-0 p-1.5 rounded-lg bg-green-700/80 text-white hover:bg-green-600"
                      aria-label="Ask front desk to follow up"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <RouteLink to="/quotations" title="Quotations" value={loading ? '\u2026' : snapshot.quotations.filter((q) => ['draft', 'sent', 'accepted'].includes(q.status)).length} sub="Open offers" icon={ScrollText} />
          <RouteLink to="/invoices" title="Invoices" value={loading ? '\u2026' : money(outstanding, currency)} sub="Outstanding" icon={ReceiptText} />
          <RouteLink to="/expenses" title="Expenses" value={loading ? '\u2026' : money(snapshot.expenses.reduce((s, e) => s + Number(e.amount || 0), 0), currency)} sub="This month" icon={HandCoins} />
          <RouteLink to="/audit" title="Night Audit" value="Daily close" sub="End-of-day summary" icon={FileText} />
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
            {(() => {
              const grouped = new Map()
              snapshot.expenses.forEach((expense) => {
                const key = expense.category || 'Other'
                grouped.set(key, (grouped.get(key) || 0) + Number(expense.amount || 0))
              })
              return [...grouped.entries()]
                .map(([category, amount]) => ({ category, amount }))
                .sort((a, b) => b.amount - a.amount)
                .slice(0, 6)
                .map((entry) => (
                  <div key={entry.category} className="bg-gray-800 rounded-xl px-3 py-3 flex items-center justify-between gap-3">
                    <p className="text-sm text-white">{entry.category}</p>
                    <p className="text-sm font-semibold text-red-300">{money(entry.amount)}</p>
                  </div>
                ))
            })()}
          </div>
        </Sheet>
      )}
      {sheet === 'balances' && (
        <Sheet title="Top Outstanding Balances" onClose={() => setSheet(null)}>
          <div className="space-y-2">
            {[...snapshot.invoices]
              .sort((a, b) => Number(b.balance_due || 0) - Number(a.balance_due || 0))
              .slice(0, 5)
              .map((invoice) => (
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
      {sheet === 'customerCredit' && (
        <Sheet title="Customer Credit Balances" onClose={() => setSheet(null)}>
          <div className="space-y-2">
            {snapshot.customerCredits.length > 0 ? (
              snapshot.customerCredits.map((entry) => (
                <div key={entry.customer_id} className="bg-gray-800 rounded-xl px-3 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{entry.customer_name || 'Guest'}</p>
                    {entry.customer_email && <p className="text-xs text-gray-400 mt-0.5">{entry.customer_email}</p>}
                  </div>
                  <p className="text-sm font-semibold text-cyan-300">{money(entry.balance)}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500">No customer credit balances.</p>
            )}
          </div>
        </Sheet>
      )}
    </div>
  )
}
