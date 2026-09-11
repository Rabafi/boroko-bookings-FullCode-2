import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'

function monthStart() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function money(value, complete) {
  // Uncertified money is Unavailable, never zero: a failed source must not
  // read as a ledger-backed total.
  if (complete === false) return 'Unavailable'
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'Unavailable'
  return Number(value).toFixed(2)
}

/**
 * Consolidated F&B performance reporting from server-confirmed sources.
 * Uncertified money is labelled Unavailable with its source — never silently
 * promoted from a local estimate to financial truth.
 */
export default function FnbConsolidatedReport({ outletId }) {
  const [range, setRange] = useState({ start: monthStart(), end: todayKey() })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = async (e) => {
    e?.preventDefault?.()
    setLoading(true)
    setError('')
    try {
      const result = await window.api?.fnb?.getConsolidatedReport?.(range.start, range.end, outletId || null)
      setData(result)
      if (result?.success === false) setError(result?.error || 'Report is unavailable.')
    } catch (err) {
      setError(err?.message || 'Report is unavailable. Reconnect and retry.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid gap-4">
      <form onSubmit={load} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-bold text-slate-900">Consolidated F&amp;B performance</h2>
        <p className="mt-1 text-xs text-slate-500">
          Server-confirmed sales, purchase cost, and operating expenses. Uncertified money stays Unavailable.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs font-semibold text-slate-600">From
            <input type="date" className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} required />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-600">To
            <input type="date" className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} required />
          </label>
          <button type="submit" disabled={loading} className="inline-flex min-h-[44px] items-center rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60">
            {loading ? 'Loading…' : 'Load report'}
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />{error}
          </p>
        )}
      </form>

      {data?.success && (
        <section aria-label="Consolidated figures" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 font-bold">Measure</th>
                <th className="px-4 py-2 text-right font-bold">Value</th>
                <th className="px-4 py-2 font-bold">Source</th>
              </tr>
            </thead>
            <tbody className="[&>tr]:border-t [&>tr]:border-slate-100">
              <tr>
                <td className="px-4 py-2 font-semibold text-slate-700">POS sales</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-900">{money(data.sales_total, data._source === 'cache' ? false : data.sales_complete)}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{data.sales_source || 'pos_orders.total'}{data.sales_complete && data._source !== 'cache' ? '' : ' (uncertified)'}{data._source === 'cache' ? ' · cached' : ''}</td>
              </tr>
              <tr>
                <td className="px-4 py-2 font-semibold text-slate-700">Purchase cost</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-900">{money(data.purchase_cost, data._source === 'cache' ? false : data.purchase_cost_complete)}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{data.purchase_cost_source || 'inventory_purchases.total_cost'}{data.purchase_cost_complete && data._source !== 'cache' ? '' : ' (uncertified)'}{data._source === 'cache' ? ' · cached' : ''}</td>
              </tr>
              <tr>
                <td className="px-4 py-2 font-semibold text-slate-700">Operating expenses</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-900">{money(data.expense_total, data._source === 'cache' ? false : data.expense_complete)}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{data.expense_source || 'expenses.amount'}{data.expense_complete && data._source !== 'cache' ? '' : ' (uncertified)'}{data._source === 'cache' ? ' · cached' : ''}</td>
              </tr>
              <tr>
                <td className="px-4 py-2 font-semibold text-slate-700">Covers</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-900">{data.covers ?? '—'}</td>
                <td className="px-4 py-2 text-xs text-slate-500">pos orders</td>
              </tr>
            </tbody>
          </table>
          <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
            Generated {data.generated_at ? new Date(data.generated_at).toLocaleString() : '—'} · {data.source || 'server'}
            {data._source === 'cache' && ' · cached estimate — reconnect to certify.'}
          </p>
        </section>
      )}
    </div>
  )
}
