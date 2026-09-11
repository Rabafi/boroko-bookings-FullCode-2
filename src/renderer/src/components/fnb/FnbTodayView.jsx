import { useEffect, useState } from 'react'
import { NavLink } from 'react-router'
import { AlertTriangle, RefreshCw } from 'lucide-react'

/**
 * Today landing view: actionable counts only. Money is intentionally absent
 * here; financial evidence lives in the consolidated report with source +
 * completeness certification.
 */
export default function FnbTodayView({ outletId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stale, setStale] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await window.api?.fnb?.getToday?.(outletId || null)
      setData(result)
      setStale(result?._source === 'cache')
      if (result?.success === false) setError(result?.error || 'Today view is unavailable.')
    } catch (e) {
      setError(e?.message || 'Today view is unavailable. Reconnect and retry.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outletId])

  const counts = data?.counts || {}
  const withOutlet = (to) => {
    if (!outletId) return to
    const sep = to.includes('?') ? '&' : '?'
    return `${to}${sep}outlet=${encodeURIComponent(outletId)}`
  }

  const cards = [
    { key: 'open_checks', label: 'Open checks', to: withOutlet('/food-beverage/floor?tab=live'), hint: 'Collect or close running tabs.' },
    { key: 'waiting_tickets', label: 'Waiting tickets', to: withOutlet('/food-beverage/kitchen'), hint: 'Move kitchen work to ready.' },
    { key: 'reservations_due', label: 'Reservations due', to: withOutlet('/food-beverage/floor?tab=reservations'), hint: 'Confirm, seat, or release tables.' },
    { key: 'low_stock', label: 'Low stock signals', to: withOutlet('/inventory?scope=food-beverage&from=food-beverage'), hint: 'Review before service is affected.' },
    { key: 'room_service_open', label: 'Room-service queue', to: withOutlet('/food-beverage/room-service'), hint: 'Prepare, dispatch, deliver.' }
  ]

  return (
    <section aria-label="Today in Food and Beverage" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-900">Today</h2>
          <p className="text-xs text-slate-500">
            Only what needs action right now.
            {stale && ' Showing the last confirmed counts (offline).'}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshCw size={14} />{loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />{error}
        </p>
      )}

      {loading && !data ? (
        <p className="mt-4 text-sm text-slate-500">Loading today&apos;s counts…</p>
      ) : (
        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {cards.map((card) => (
            <NavLink
              key={card.key}
              to={card.to}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 transition hover:border-emerald-300 hover:bg-emerald-50/60"
            >
              <dt className="text-xs font-semibold text-slate-500">{card.label}</dt>
              <dd className="mt-1 text-2xl font-black tabular-nums text-slate-900">{counts[card.key] ?? '—'}</dd>
              <dd className="mt-1 text-[11px] leading-4 text-slate-500">{card.hint}</dd>
            </NavLink>
          ))}
        </dl>
      )}
    </section>
  )
}
