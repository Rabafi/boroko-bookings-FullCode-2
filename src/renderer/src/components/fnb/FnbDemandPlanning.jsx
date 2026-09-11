import { useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

function newOperationId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `op-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Occupancy-driven demand and prep planning: read-only advisory
 * recommendations with freshness, confidence, source, and exceptions.
 * Creating prep batches or draft purchase orders always needs an explicit
 * manager approval with a stable operation ID.
 */
export default function FnbDemandPlanning({ outletId }) {
  const [date, setDate] = useState(todayKey())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionMsg, setActionMsg] = useState('')
  const [busyKey, setBusyKey] = useState(null)

  const load = async (forDate = date) => {
    setLoading(true)
    setError('')
    try {
      const result = await window.api?.fnb?.getDemandRecommendations?.(forDate, outletId || null)
      setData(result)
      if (result?.success === false) setError(result?.error || 'Demand planning is unavailable.')
    } catch (e) {
      setError(e?.message || 'Demand planning is unavailable. Reconnect and retry.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outletId])

  const approve = async (rec) => {
    setBusyKey(rec.key)
    setActionMsg('')
    try {
      const result = await window.api?.fnb?.approveDemandRecommendation?.(
        rec.key, rec.action, { outlet_id: outletId || null, date, title: rec.title }, newOperationId()
      )
      if (!result || result.success === false) throw new Error(result?.error || 'Could not approve.')
      setActionMsg(result.replayed ? 'Already approved — replayed safely.' : 'Approved as a draft request. Complete it in its canonical workflow (prep / purchasing).')
    } catch (e) {
      setActionMsg(e?.message || 'Could not approve.')
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="grid gap-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Demand &amp; prep planning</h2>
            <p className="mt-1 text-xs text-slate-500">
              Advisory only — occupancy, events, reservations, history, recipes, stock, and lead times.
              Confidence {data?.confidence ? <strong>{data.confidence}</strong> : '—'} · Source {data?.source || 'server-advisory'} ·
              Freshness {data?.freshness ? new Date(data.freshness).toLocaleString() : '—'}
              {data?._source === 'cache' && ' · Showing the last confirmed plan (offline).'}
            </p>
          </div>
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); load() }}>
            <label className="grid gap-1 text-xs font-semibold text-slate-600">Service date
              <input type="date" className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={date} onChange={(e) => setDate(e.target.value)} required />
            </label>
            <button type="submit" disabled={loading} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              <RefreshCw size={14} />{loading ? 'Loading…' : 'Reload'}
            </button>
          </form>
        </div>

        {error && (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />{error}
          </p>
        )}

        {Array.isArray(data?.exceptions) && data.exceptions.length > 0 && (
          <ul className="mt-3 grid gap-1 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
            {data.exceptions.map((ex, i) => <li key={i}>• {ex.message || ex.code} — treated as unavailable, not zero.</li>)}
          </ul>
        )}

        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['Occupancy', data?.occupancy_pct != null ? `${data.occupancy_pct}%` : '—'],
            ['Reservation covers', data?.reservation_covers ?? '—'],
            ['Historic covers', data?.historic_covers ?? '—'],
            ['Events', data?.events ?? '—']
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <dt className="text-[11px] font-semibold text-slate-500">{label}</dt>
              <dd className="text-lg font-black tabular-nums text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-label="Recommendations" className="grid gap-2">
        {(data?.recommendations || []).map((rec) => (
          <article key={rec.key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-900">{rec.title}</h3>
                <p className="mt-1 text-xs leading-5 text-slate-600">{rec.detail}</p>
                <p className="mt-1 text-[11px] text-slate-500">Source: {rec.source} · Confidence: {rec.confidence}</p>
              </div>
              <button
                type="button"
                onClick={() => approve(rec)}
                disabled={busyKey === rec.key}
                className="inline-flex min-h-[40px] shrink-0 items-center rounded-xl bg-slate-900 px-3 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-60"
              >
                {busyKey === rec.key ? 'Approving…' : rec.action === 'prep_batch' ? 'Approve prep request' : 'Approve draft PO request'}
              </button>
            </div>
          </article>
        ))}
        {!loading && (!data?.recommendations || data.recommendations.length === 0) && (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">No recommendations for this date yet.</p>
        )}
      </section>

      {actionMsg && <p role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">{actionMsg}</p>}
    </div>
  )
}
