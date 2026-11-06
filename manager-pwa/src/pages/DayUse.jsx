import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { listDayUseEntries } from '../lib/api'
import { money } from '../lib/format'
import { normalizeDayUseReportRow } from '../../../src/shared/dayUseReporting'

/** @typedef {{id: string, total?: number | string | null, extras?: unknown}} DayUseEntryExpectedView */
/** @typedef {{name?: string | null, quantity?: number | string | null}} DayUseExtraExpectedView */

export default function DayUse() {
  // AppShell renders this route only after its authenticated-user guard.
  const { user } = /** @type {{user: NonNullable<ReturnType<typeof useAuth>['user']>}} */ (useAuth())
  const [entries, setEntries] = useState(/** @type {DayUseEntryExpectedView[]} */ ([]))
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))

  const load = async () => {
    // Cached rows are not runtime validated; preserve the page's existing row view.
    const data = /** @type {DayUseEntryExpectedView[]} */ (await listDayUseEntries(user.lodge_id, date, date).catch(() => []))
    setEntries(data)
  }

  useEffect(() => { load() }, [user.lodge_id, date])

  const revenue = entries.reduce((sum, entry) => sum + Number(entry.total || 0), 0)

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-12 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">Day Use</h1>
            <p className="text-xs text-gray-400">Facility guests • {money(revenue)}</p>
          </div>
        </div>
        <input className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white mt-3" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </div>

      <div className="px-4 py-4 space-y-3">
        <div className="rounded-2xl border border-blue-900 bg-blue-950/30 px-4 py-3 text-sm text-blue-100">
          Day-use entries are view-only in the manager mobile app. Use the front desk to add or remove walk-ins.
        </div>
        {entries.map((entry) => {
          // The report helper reads unvalidated cache fields; these three UI views assume the source text columns/fallbacks.
          const row = normalizeDayUseReportRow(entry)
          return (
          <div key={entry.id} className="bg-gray-800 rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">{/** @type {string} */ (row.guest)}</p>
                <p className="text-xs text-gray-400 mt-1">{/** @type {string} */ (row.templateName || row.activityLabel)}</p>
                <p className="text-xs text-gray-400 mt-1">{row.statusLabel} • {row.adults} adults • {row.children} children</p>
                <p className="text-xs text-gray-500 mt-1">{/** @type {string} */ (row.paymentMethod || 'Tender unavailable')}{row.resourceName ? ` • ${row.resourceName}` : ''}</p>
                {Array.isArray(entry.extras) && entry.extras.length > 0 && (
                  <p className="text-xs text-amber-300 mt-1">
                    Extras: {/** @type {DayUseExtraExpectedView[]} */ (entry.extras).map((extra) => `${extra.name} x${Number(extra.quantity || 0)}`).join(', ')}
                  </p>
                )}
                {row.balanceDue > 0 && (
                  <p className="text-xs text-violet-300 mt-1">Balance due: {money(row.balanceDue)}</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-white">{money(row.total)}</p>
              </div>
            </div>
          </div>
          )
        })}
      </div>
    </div>
  )
}
