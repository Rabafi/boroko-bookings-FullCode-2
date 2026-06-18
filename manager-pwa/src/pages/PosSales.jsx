import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Banknote,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  History,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Search,
  ShoppingCart,
  TrendingUp,
  X
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getManagerPosSnapshot, getManagerPosTransactions } from '../lib/api'
import { money, shortDateTime, titleCase } from '../lib/format'
import DataFreshness from '../components/DataFreshness'
import EmptyState from '../components/EmptyState'

const PAGE_SIZE = 30

function localDate(value = new Date()) {
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dateBefore(days) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return localDate(date)
}

function Kpi({ label, value, sub, icon: Icon, tone = 'text-white' }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-gray-800 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-gray-400">{label}</p>
          <p className={`mt-1 text-xl font-bold ${tone}`}>{value}</p>
          {sub ? <p className="mt-1 text-[11px] text-gray-500">{sub}</p> : null}
        </div>
        <div className="rounded-xl bg-gray-900 p-2 text-green-300"><Icon size={17} /></div>
      </div>
    </div>
  )
}

function paymentLabel(transaction) {
  const rows = Array.isArray(transaction?.payment_breakdown) ? transaction.payment_breakdown : []
  if (rows.length > 1) return 'Split payment'
  return titleCase(rows[0]?.method || transaction?.payment_method || 'cash')
}

function transactionLabel(transaction) {
  return transaction?.receipt_number
    || `TX-${String(transaction?.id || '').slice(0, 8).toUpperCase()}`
}

function TransactionDetail({ transaction, onClose }) {
  if (!transaction) return null
  const isReturn = transaction.transaction_type === 'return'
  const items = Array.isArray(transaction.items) ? transaction.items : []
  const payments = Array.isArray(transaction.payment_breakdown) && transaction.payment_breakdown.length > 0
    ? transaction.payment_breakdown
    : [{ method: transaction.payment_method || 'cash', amount: transaction.total }]

  return (
    <div className="fixed inset-0 z-[80] flex items-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-[28px] border border-white/10 bg-gray-950 px-4 pb-8 pt-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-gray-700" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-gray-500">{isReturn ? 'Return' : 'POS transaction'}</p>
            <h2 className="mt-1 text-lg font-bold text-white">{transactionLabel(transaction)}</h2>
            <p className="mt-1 text-xs text-gray-400">{shortDateTime(transaction.completed_at || transaction.created_at)}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-white/5 p-2 text-gray-300" aria-label="Close transaction detail">
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl bg-gray-900 p-3"><p className="text-xs text-gray-500">Outlet</p><p className="mt-1 font-semibold text-white">{transaction.outlet_name}</p></div>
          <div className="rounded-xl bg-gray-900 p-3"><p className="text-xs text-gray-500">Cashier</p><p className="mt-1 font-semibold text-white">{transaction.cashier_name}</p></div>
          <div className="rounded-xl bg-gray-900 p-3"><p className="text-xs text-gray-500">Payment</p><p className="mt-1 font-semibold text-white">{paymentLabel(transaction)}</p></div>
          <div className="rounded-xl bg-gray-900 p-3"><p className="text-xs text-gray-500">Status</p><p className="mt-1 font-semibold text-white">{titleCase(transaction.status)}</p></div>
        </div>

        {(transaction.guest_name || transaction.walk_in_name || transaction.room_number || transaction.table_name || transaction.tab_name) ? (
          <div className="mt-3 rounded-2xl bg-gray-900 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Customer context</p>
            <p className="mt-2 text-sm text-white">
              {transaction.guest_name || transaction.walk_in_name || transaction.tab_name || transaction.table_name || 'Walk-in'}
              {transaction.room_number ? ` · Room ${transaction.room_number}` : ''}
            </p>
          </div>
        ) : null}

        <div className="mt-3 rounded-2xl bg-gray-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Items</p>
            <span className="text-xs text-gray-500">{items.length}</span>
          </div>
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 border-b border-white/5 pb-3 last:border-0 last:pb-0">
                <div>
                  <p className="text-sm font-medium text-white">{item.item_name}</p>
                  <p className="mt-1 text-xs text-gray-500">{Number(item.quantity || 0)} × {money(item.unit_price)}</p>
                </div>
                <p className="text-sm font-semibold text-white">{money(item.net_subtotal)}</p>
              </div>
            ))}
            {items.length === 0 ? <p className="text-sm text-gray-500">No item detail was stored for this transaction.</p> : null}
          </div>
        </div>

        <div className="mt-3 rounded-2xl bg-gray-900 p-4 text-sm">
          <div className="flex justify-between py-1 text-gray-400"><span>Gross</span><span>{money(transaction.gross_total)}</span></div>
          <div className="flex justify-between py-1 text-gray-400"><span>Discount</span><span>-{money(transaction.discount_total)}</span></div>
          <div className="flex justify-between py-1 text-gray-400"><span>Tax</span><span>{money(transaction.tax_total)}</span></div>
          {Number(transaction.tip_total || 0) !== 0 ? <div className="flex justify-between py-1 text-gray-400"><span>Tips</span><span>{money(transaction.tip_total)}</span></div> : null}
          <div className="mt-2 flex justify-between border-t border-white/10 pt-3 text-base font-bold text-white">
            <span>{isReturn ? 'Returned' : 'Total'}</span>
            <span className={isReturn ? 'text-rose-300' : 'text-green-300'}>{money(Math.abs(Number(transaction.total || 0)))}</span>
          </div>
        </div>

        <div className="mt-3 rounded-2xl bg-gray-900 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Payment allocation</p>
          <div className="mt-2 space-y-2">
            {payments.map((payment, index) => (
              <div key={`${payment.method}-${index}`} className="flex justify-between text-sm">
                <span className="text-gray-400">{titleCase(payment.method || 'cash')}</span>
                <span className="text-white">{money(payment.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function PosSales() {
  const { user } = useAuth()
  const [startDate, setStartDate] = useState(dateBefore(6))
  const [endDate, setEndDate] = useState(localDate())
  const [outletId, setOutletId] = useState('')
  const [status, setStatus] = useState('posted')
  const [transactionType, setTransactionType] = useState('all')
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [snapshot, setSnapshot] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)

  const filters = useMemo(() => ({
    startDate,
    endDate,
    outletId: outletId || null,
    status,
    transactionType,
    search: appliedSearch
  }), [appliedSearch, endDate, outletId, startDate, status, transactionType])

  const load = useCallback(async ({ append = false, silent = false } = {}) => {
    if (append) setLoadingMore(true)
    else if (!silent) setLoading(true)
    if (!append) setError('')
    try {
      const offset = append ? transactions.length : 0
      const [nextSnapshot, history] = await Promise.all([
        append ? Promise.resolve(snapshot) : getManagerPosSnapshot(user.lodge_id, { ...filters, forceFresh: true }),
        getManagerPosTransactions(user.lodge_id, { ...filters, limit: PAGE_SIZE, offset })
      ])
      if (!append) setSnapshot(nextSnapshot)
      setTransactions((current) => append ? [...current, ...history.transactions] : history.transactions)
      setTotalCount(history.total_count)
      setUpdatedAt(new Date().toISOString())
    } catch (nextError) {
      setError(nextError?.message || 'POS sales could not load.')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [filters, snapshot, transactions.length, user.lodge_id])

  useEffect(() => {
    load()
  }, [filters])

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') load({ silent: true })
    }, 60_000)
    return () => window.clearInterval(interval)
  }, [load])

  const applyPreset = (preset) => {
    const today = localDate()
    if (preset === 'today') setStartDate(today)
    if (preset === 'week') setStartDate(dateBefore(6))
    if (preset === 'month') setStartDate(`${today.slice(0, 7)}-01`)
    setEndDate(today)
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pb-4 pt-12">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">POS Sales</h1>
            <p className="text-xs text-gray-400">Live sales snapshot and transaction history</p>
            <DataFreshness updatedAt={updatedAt} loading={loading} error={error} className="mt-1" />
          </div>
          <button type="button" onClick={() => load()} className="rounded-full bg-white/5 p-2 text-gray-300" aria-label="Refresh POS sales">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            ['today', 'Today'],
            ['week', '7 days'],
            ['month', 'Month']
          ].map(([value, label]) => (
            <button key={value} type="button" onClick={() => applyPreset(value)} className="rounded-xl bg-gray-800 px-2 py-2 text-xs font-semibold text-gray-200">
              {label}
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white" />
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white" />
        </div>
        <select value={outletId} onChange={(event) => setOutletId(event.target.value)} className="mt-2 w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white">
          <option value="">All outlets</option>
          {(snapshot?.outlets || []).map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}
        </select>
      </div>

      <div className="space-y-4 px-4 py-4">
        {error ? <div className="rounded-2xl border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}

        <div className="grid grid-cols-2 gap-3">
          <Kpi label="Net sales" value={money(snapshot?.net_sales)} sub={`${Number(snapshot?.sale_count || 0)} sales`} icon={TrendingUp} tone="text-green-300" />
          <Kpi label="Gross sales" value={money(snapshot?.gross_sales)} sub={`Avg ${money(snapshot?.average_sale)}`} icon={CircleDollarSign} />
          <Kpi label="Returns" value={money(snapshot?.returns_total)} sub={`${Number(snapshot?.return_count || 0)} returns`} icon={RotateCcw} tone="text-rose-300" />
          <Kpi label="Discounts" value={money(snapshot?.discount_total)} sub={`${Number(snapshot?.void_count || 0)} voided`} icon={ReceiptText} tone="text-amber-300" />
        </div>

        <section className="rounded-2xl bg-gray-800 p-4">
          <p className="text-sm font-semibold text-white">Payment methods</p>
          <div className="mt-3 space-y-2">
            {(snapshot?.by_payment || []).map((row) => (
              <div key={row.method} className="flex items-center justify-between rounded-xl bg-gray-900 px-3 py-3">
                <span className="flex items-center gap-2 text-sm text-gray-300">{row.method === 'cash' ? <Banknote size={15} /> : <CreditCard size={15} />}{titleCase(row.method)}</span>
                <span className="text-sm font-semibold text-white">{money(row.amount)}</span>
              </div>
            ))}
            {!loading && (snapshot?.by_payment || []).length === 0 ? <p className="text-sm text-gray-500">No posted payments in this period.</p> : null}
          </div>
        </section>

        {(snapshot?.by_outlet || []).length > 0 ? (
          <section className="rounded-2xl bg-gray-800 p-4">
            <p className="text-sm font-semibold text-white">Sales by outlet</p>
            <div className="mt-3 space-y-2">
              {snapshot.by_outlet.map((row) => (
                <div key={row.outlet_id || 'unassigned'} className="rounded-xl bg-gray-900 px-3 py-3">
                  <div className="flex justify-between gap-3"><span className="text-sm font-medium text-white">{row.outlet_name}</span><span className="text-sm font-semibold text-green-300">{money(row.net_sales)}</span></div>
                  <p className="mt-1 text-xs text-gray-500">{row.sale_count} sales · {row.return_count} returns</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {(snapshot?.top_items || []).length > 0 ? (
          <section className="rounded-2xl bg-gray-800 p-4">
            <p className="text-sm font-semibold text-white">Top items</p>
            <div className="mt-3 space-y-2">
              {snapshot.top_items.slice(0, 6).map((row) => (
                <div key={row.item_name} className="flex items-center justify-between rounded-xl bg-gray-900 px-3 py-3">
                  <div><p className="text-sm text-white">{row.item_name}</p><p className="mt-1 text-xs text-gray-500">{Number(row.quantity || 0)} sold</p></div>
                  <span className="text-sm font-semibold text-white">{money(row.net_sales)}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div><p className="text-sm font-semibold text-white">Transaction history</p><p className="mt-1 text-xs text-gray-500">{totalCount} matching transactions</p></div>
            <History size={18} className="text-gray-500" />
          </div>

          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              setAppliedSearch(search.trim())
            }}
          >
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-3 text-gray-500" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Receipt, item, cashier…" className="w-full rounded-xl border border-gray-700 bg-gray-800 py-2.5 pl-9 pr-3 text-sm text-white" />
            </div>
            <button className="rounded-xl bg-green-700 px-4 text-sm font-semibold text-white">Find</button>
          </form>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-xs text-white">
              <option value="posted">Posted</option>
              <option value="all">All statuses</option>
              <option value="voided">Voided</option>
              <option value="open">Open</option>
            </select>
            <select value={transactionType} onChange={(event) => setTransactionType(event.target.value)} className="rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-xs text-white">
              <option value="all">Sales & returns</option>
              <option value="sale">Sales only</option>
              <option value="return">Returns only</option>
            </select>
          </div>

          <div className="mt-3 space-y-2">
            {transactions.map((transaction) => {
              const isReturn = transaction.transaction_type === 'return'
              return (
                <button key={transaction.id} type="button" onClick={() => setSelected(transaction)} className="flex w-full items-center gap-3 rounded-2xl bg-gray-800 px-3 py-3 text-left">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isReturn ? 'bg-rose-950 text-rose-300' : 'bg-green-950 text-green-300'}`}>
                    {isReturn ? <RotateCcw size={17} /> : <ShoppingCart size={17} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-white">{transactionLabel(transaction)}</p>
                      <p className={`shrink-0 text-sm font-bold ${isReturn ? 'text-rose-300' : 'text-green-300'}`}>{money(transaction.total)}</p>
                    </div>
                    <p className="mt-1 truncate text-xs text-gray-500">{transaction.outlet_name} · {paymentLabel(transaction)} · {shortDateTime(transaction.completed_at || transaction.created_at)}</p>
                  </div>
                  <ChevronRight size={16} className="shrink-0 text-gray-600" />
                </button>
              )
            })}
          </div>

          {!loading && transactions.length === 0 ? <div className="mt-3"><EmptyState icon={ReceiptText} title="No POS transactions" message="Try a wider date range or another filter." /></div> : null}
          {transactions.length < totalCount ? (
            <button type="button" onClick={() => load({ append: true })} disabled={loadingMore} className="mt-3 w-full rounded-xl bg-gray-800 py-3 text-sm font-semibold text-white disabled:opacity-60">
              {loadingMore ? 'Loading…' : 'Load more transactions'}
            </button>
          ) : null}
        </section>
      </div>

      <TransactionDetail transaction={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
