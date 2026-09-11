import { useCallback, useEffect, useMemo, useState } from 'react'
import { BarChart3, RefreshCw } from 'lucide-react'
import { useAccess, useSettings } from '../../app-context'
import { getProductDefinition, getRuntimeProductId } from '../../../../shared/productIdentity'
import { getUiVocabulary } from '../../../../shared/uiVocabulary'
import { canAccessCapability } from '../../../../shared/accessControl'

const BUILD_PRODUCT = getProductDefinition(getRuntimeProductId())

function defaultStartDate() {
  return new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
}

function defaultEndDate() {
  return new Date().toISOString().slice(0, 10)
}

function isValidDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(new Date(String(value)).getTime())
}

/**
 * Per-staff rollup of raw per-day productivity rows. Kept local to this panel
 * so the Starter-visible lodge surface does not depend on the hotel-only
 * StaffOperations workspace.
 */
export function rollupStaffProductivity(metrics = []) {
  const grouped = new Map()
  for (const metric of Array.isArray(metrics) ? metrics : []) {
    if (!metric || typeof metric !== 'object') continue
    const name = String(metric.staff_name || metric.user_name || 'Unknown').trim() || 'Unknown'
    const key = String(metric.staff_id || name)
    const row = grouped.get(key) || {
      staff_id: metric.staff_id || null,
      staff_name: name,
      days: 0,
      completed: 0,
      onTime: 0,
      incidents: 0,
      timeTotal: 0,
      timeTasks: 0,
      ratingTotal: 0,
      ratingDays: 0
    }
    const completed = Math.max(0, Number(metric.tasks_completed) || 0)
    const onTime = Math.min(completed, Math.max(0, Number(metric.tasks_on_time) || 0))
    const avgTime = Number(metric.avg_completion_time_minutes)
    const rating = Number(metric.rating)
    row.days += 1
    row.completed += completed
    row.onTime += onTime
    row.incidents += Math.max(0, Number(metric.incidents) || 0)
    if (Number.isFinite(avgTime) && completed > 0) {
      row.timeTotal += avgTime * completed
      row.timeTasks += completed
    }
    if (Number.isFinite(rating)) {
      row.ratingTotal += rating
      row.ratingDays += 1
    }
    grouped.set(key, row)
  }
  return [...grouped.values()]
    .map((row) => ({
      ...row,
      onTimeRate: row.completed > 0 ? row.onTime / row.completed : null,
      avgTime: row.timeTasks > 0 ? row.timeTotal / row.timeTasks : null,
      avgRating: row.ratingDays > 0 ? row.ratingTotal / row.ratingDays : null
    }))
    .sort((a, b) => b.completed - a.completed || a.staff_name.localeCompare(b.staff_name))
}

/**
 * Read-only staff activity & performance view. Mounted inside the Staff page
 * for the lodging app so Starter teams can see it without the Enterprise
 * Workforce add-on. Copy follows the active product + property vocabulary.
 */
export default function StaffProductivityPanel() {
  const access = useAccess()
  const { settings } = useSettings()
  const vocab = useMemo(() => getUiVocabulary({ settings }), [settings])

  const [startDate, setStartDate] = useState(defaultStartDate)
  const [endDate, setEndDate] = useState(defaultEndDate)
  const [data, setData] = useState({ metrics: [], summary: {} })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const canView = canAccessCapability(access, 'staff.view') || canAccessCapability(access, 'workforce_scheduling.view')

  const load = useCallback(async (from, to) => {
    if (!isValidDay(from) || !isValidDay(to)) {
      setError('Pick a valid from/to date to load performance data.')
      return
    }
    if (from > to) {
      setError('The from-date must be on or before the to-date.')
      return
    }
    if (typeof window?.api?.staffOperations?.getStaffProductivityDashboard !== 'function') {
      setError('Performance data is unavailable in this preview. Open the desktop app to load it.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.staffOperations.getStaffProductivityDashboard(from, to)
      if (result && result.success === false) {
        setError(result.error || 'Performance data is not available for this business yet.')
        return
      }
      setData({
        metrics: Array.isArray(result?.metrics) ? result.metrics : [],
        summary: result?.summary && typeof result.summary === 'object' ? result.summary : {}
      })
    } catch (e) {
      setError(e?.message || 'Could not load performance data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (canView) load(defaultStartDate(), defaultEndDate())
    else setLoading(false)
  }, [canView, load])

  const rows = useMemo(() => rollupStaffProductivity(data.metrics), [data.metrics])
  const summary = data.summary || {}
  const hasSummary = Object.keys(summary).length > 0

  if (!canView) {
    return (
      <section className="bb-card p-5">
        <p className="text-sm font-semibold text-slate-800">Performance is restricted</p>
        <p className="mt-1 text-xs text-slate-500">
          Your role does not include team visibility. Ask a manager or administrator to update your access.
        </p>
      </section>
    )
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <BarChart3 size={15} className="text-emerald-700" />
            {vocab.nounTitle} team performance
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Server-recorded task activity for {vocab.theNoun} team — completions, timing, ratings and incidents by staff member.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            From{' '}
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="ml-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-normal text-slate-700"
            />
          </label>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            To{' '}
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="ml-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-normal text-slate-700"
            />
          </label>
          <button
            onClick={() => load(startDate, endDate)}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bb-card mb-4 border-rose-200 bg-rose-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-rose-700">{error}</p>
            <button onClick={() => load(startDate, endDate)} className="shrink-0 text-xs font-semibold text-rose-800 hover:underline">
              Try again
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-700 border-t-transparent" />
        </div>
      ) : !hasSummary ? (
        <p className="text-xs text-slate-400">Performance data is not available yet.</p>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="bb-card p-4 text-center">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Tasks done</p>
              <p className="text-2xl font-bold text-slate-800">{summary.total_tasks || 0}</p>
            </div>
            <div className="bb-card p-4 text-center">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">On time</p>
              <p className="text-2xl font-bold text-emerald-600">{summary.on_time_tasks || 0}</p>
            </div>
            <div className="bb-card p-4 text-center">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Avg rating</p>
              <p className="text-2xl font-bold text-amber-600">{summary.avg_rating || '—'}</p>
            </div>
            <div className="bb-card p-4 text-center">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Team members</p>
              <p className="text-2xl font-bold text-slate-800">{summary.staff_count || 0}</p>
            </div>
          </div>

          {rows.length > 0 ? (
            <div className="bb-table-shell">
              <table className="bb-table">
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th>Days active</th>
                    <th>Completed</th>
                    <th>On time</th>
                    <th>Avg min / task</th>
                    <th>Incidents</th>
                    <th>Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={String(row.staff_id || row.staff_name)}>
                      <td className="font-medium text-slate-800">{row.staff_name}</td>
                      <td className="text-slate-600">{row.days}</td>
                      <td className="text-slate-800">{row.completed}</td>
                      <td className="text-slate-600">
                        {row.onTimeRate === null ? '—' : `${Math.round(row.onTimeRate * 100)}%`}
                      </td>
                      <td className="text-slate-600">{row.avgTime === null ? '—' : row.avgTime.toFixed(1)}</td>
                      <td className="text-slate-600">{row.incidents}</td>
                      <td><span className="font-semibold">{row.avgRating === null ? '—' : row.avgRating.toFixed(1)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-slate-400">
              No performance data for this period. Assign and complete tasks to see {vocab.noun} team activity here.
            </p>
          )}
          <p className="mt-3 text-[10px] text-slate-400">
            Read-only on {BUILD_PRODUCT.brandName || BUILD_PRODUCT.name} Starter — scheduling, task assignment and handovers stay in the Workforce add-on.
          </p>
        </>
      )}
    </section>
  )
}
