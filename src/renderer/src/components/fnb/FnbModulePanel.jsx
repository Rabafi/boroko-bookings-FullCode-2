import { useState } from 'react'
import { AlertTriangle, CheckCircle2, LockKeyhole } from 'lucide-react'
import { FNB_OPTIONAL_MODULES, resolveFnbModuleDisplayState } from '../../../../shared/fnbModules.js'

/**
 * More tools panel: enabled advanced tools first, disabled tools remain
 * visible with a short benefit statement and one clear activation action.
 * Disabling hides navigation and stops new work; it never deletes data or
 * blocks authorised reads of retained history.
 */
export default function FnbModulePanel({ preferenceMap, updatingKey, error, offline, onToggle, onNavigate }) {
  const [confirmKey, setConfirmKey] = useState(null)
  const [blockers, setBlockers] = useState([])

  const entries = FNB_OPTIONAL_MODULES.map((def) => {
    const entry = preferenceMap?.get?.(def.key)
    const display = resolveFnbModuleDisplayState(entry)
    return { def, entry, display }
  })
  const sorted = [...entries].sort((a, b) => {
    const aOn = a.entry?.enabled ? 0 : 1
    const bOn = b.entry?.enabled ? 0 : 1
    return aOn - bOn
  })

  const handleAction = async (item) => {
    setBlockers([])
    const { def, entry, display } = item
    if (display.state === 'request_access' || display.state === 'ask_admin' || display.state === 'unverified' || display.state === 'unknown') return
    if (entry?.enabled) {
      setConfirmKey(def.key)
      return
    }
    try {
      await onToggle?.(def.key, true, entry?.version ?? 0)
    } catch (e) {
      if (Array.isArray(e?.blockers)) setBlockers(e.blockers)
    }
  }

  const confirmDisable = async (item) => {
    try {
      await onToggle?.(item.def.key, false, item.entry?.version ?? 0)
      setConfirmKey(null)
    } catch (e) {
      if (Array.isArray(e?.blockers)) setBlockers(e.blockers)
    }
  }

  return (
    <section aria-label="More Food and Beverage tools" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
      <h2 className="text-base font-bold text-slate-900">More tools</h2>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        Advanced modules are installed but off by default. Enabling one never grants a licence or
        permission — feature checks still run on every action. Turning one off hides it and stops
        new work, but keeps all history and money records.
        {offline && ' You are offline: activation needs a server-confirmed connection.'}
      </p>
      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />{error}
        </p>
      )}
      {blockers.length > 0 && (
        <div role="alert" className="mt-3 rounded-xl border border-red-300 bg-red-50 px-3 py-2">
          <p className="text-xs font-bold text-red-900">Resolve this in-progress work first:</p>
          <ul className="mt-1 list-disc pl-5 text-xs text-red-800">
            {blockers.map((b, i) => <li key={i}>{b.message || b.code} {b.count ? `(${b.count})` : ''}</li>)}
          </ul>
        </div>
      )}
      <ul className="mt-4 grid gap-2 md:grid-cols-2">
        {sorted.map((item) => {
          const { def, entry, display } = item
          const busy = updatingKey === def.key
          return (
            <li key={def.key} className={`rounded-xl border p-3 ${entry?.enabled ? 'border-emerald-300 bg-emerald-50/50' : 'border-slate-200 bg-slate-50'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                    {entry?.enabled && <CheckCircle2 size={15} className="text-emerald-700" />}
                    {!entry?.enabled && display.state !== 'disabled' && <LockKeyhole size={14} className="text-slate-400" />}
                    {def.label}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">{def.benefit}</p>
                  {display.message && <p className="mt-1 text-[11px] font-semibold text-slate-500">{display.message}</p>}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {entry?.enabled ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onNavigate?.(def)}
                      className="inline-flex min-h-[40px] items-center rounded-xl bg-emerald-700 px-3 text-xs font-bold text-white hover:bg-emerald-800"
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAction(item)}
                      disabled={busy || offline}
                      className="inline-flex min-h-[40px] items-center rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                    >
                      {busy ? 'Working…' : 'Disable'}
                    </button>
                  </>
                ) : display.state === 'disabled' ? (
                  <button
                    type="button"
                    onClick={() => handleAction(item)}
                    disabled={busy || offline}
                    className="inline-flex min-h-[40px] items-center rounded-xl bg-slate-900 px-3 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-60"
                  >
                    {busy ? 'Working…' : offline ? 'Reconnect to enable' : `Enable ${def.label}`}
                  </button>
                ) : (
                  <span className="inline-flex min-h-[40px] items-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-500">
                    {display.actionLabel}
                  </span>
                )}
              </div>
              {confirmKey === def.key && (
                <div className="mt-3 rounded-xl border border-red-200 bg-white p-3">
                  <p className="text-xs font-semibold text-slate-700">
                    Disable {def.label}? New work stops immediately. History, audit, and money records are kept.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => confirmDisable(item)}
                      disabled={busy}
                      className="inline-flex min-h-[40px] items-center rounded-xl bg-red-700 px-3 text-xs font-bold text-white hover:bg-red-800 disabled:opacity-60"
                    >
                      {busy ? 'Working…' : 'Yes, disable'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmKey(null)}
                      className="inline-flex min-h-[40px] items-center rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-100"
                    >
                      Keep enabled
                    </button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
