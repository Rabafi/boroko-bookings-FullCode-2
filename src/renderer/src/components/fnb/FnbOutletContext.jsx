import { useEffect, useState } from 'react'

/**
 * Shared F&B outlet context: one slim selector used by Today, floor, POS
 * handoffs, inventory/expense bridges, and planning views. The value is
 * lifted to the hub via onChange and persisted in the URL (?outlet=) so
 * filter context survives navigation back to F&B.
 */
export default function FnbOutletContext({ value, onChange }) {
  const [outlets, setOutlets] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rows = await window.api?.outlets?.getAll?.().catch(() => []) || []
        if (!cancelled) setOutlets(Array.isArray(rows) ? rows : [])
      } catch {
        if (!cancelled) setOutlets([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <label className="flex min-w-[200px] flex-col gap-1 text-xs font-semibold text-slate-600">
      <span>Outlet context</span>
      <select
        aria-label="Outlet context"
        className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-200"
        value={value || ''}
        onChange={(e) => onChange?.(e.target.value || null)}
        disabled={loading}
      >
        <option value="">All outlets</option>
        {outlets.map((outlet) => (
          <option key={outlet.id} value={outlet.id}>{outlet.name || 'Outlet'}</option>
        ))}
      </select>
      <span className="font-normal text-slate-500">
        {loading ? 'Loading outlets…' : 'Shared across Today, floor, reports, and planning.'}
      </span>
    </label>
  )
}
