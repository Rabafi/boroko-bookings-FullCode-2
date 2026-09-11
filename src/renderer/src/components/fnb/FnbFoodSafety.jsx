import { useEffect, useState } from 'react'

function newOperationId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `op-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/**
 * Food-safety and temperature controls.
 * - Every reading is evaluated against a manager-owned check template, so
 *   "within range" always means a real range was checked.
 * - Out-of-range readings open a corrective action automatically; the
 *   exception queue below closes each one explicitly with audit evidence.
 * - Evidence is immutable: logs are append-only, actions close once.
 */
export default function FnbFoodSafety({ outletId }) {
  const [templates, setTemplates] = useState([])
  const [queue, setQueue] = useState([])
  const [loading, setLoading] = useState(true)
  const [log, setLog] = useState({ template_id: '', location_label: '', temp_c: '', notes: '' })
  const [closeNoteByAction, setCloseNoteByAction] = useState({})
  const [templateForm, setTemplateForm] = useState({ name: '', min_temp_c: '', max_temp_c: '' })
  const [busy, setBusy] = useState(null)
  const [message, setMessage] = useState({ text: '', tone: 'info' })
  const say = (text, tone = 'info') => setMessage({ text, tone })

  const loadAll = async () => {
    setLoading(true)
    try {
      const [t, q] = await Promise.all([
        window.api?.fnb?.getFoodSafetyTemplates?.().catch(() => null),
        window.api?.fnb?.getCorrectiveQueue?.(false).catch(() => null)
      ])
      setTemplates(Array.isArray(t?.templates) ? t.templates : [])
      setQueue(Array.isArray(q?.actions) ? q.actions : [])
      if (t && t.success === false) say(t.error || 'Templates are unavailable.', 'error')
      else if (q && q.success === false) say(q.error || 'Corrective queue is unavailable.', 'error')
    } catch (err) {
      say(err?.message || 'Could not load food-safety data.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submitTemplate = async (e) => {
    e?.preventDefault?.()
    setBusy('template')
    try {
      const result = await window.api?.fnb?.createFoodSafetyTemplate?.(
        {
          name: templateForm.name.trim(),
          min_temp_c: templateForm.min_temp_c === '' ? null : Number(templateForm.min_temp_c),
          max_temp_c: templateForm.max_temp_c === '' ? null : Number(templateForm.max_temp_c),
          outlet_id: outletId || null
        },
        newOperationId()
      )
      if (!result || result.success === false) throw new Error(result?.error || 'Could not create the template.')
      say('Check template created.', 'ok')
      setTemplateForm({ name: '', min_temp_c: '', max_temp_c: '' })
      await loadAll()
    } catch (err) {
      say(err?.message || 'Could not create the template.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const submitLog = async (e) => {
    e?.preventDefault?.()
    setBusy('log')
    try {
      const result = await window.api?.fnb?.createTemperatureLog?.(
        {
          template_id: log.template_id,
          location_label: log.location_label.trim(),
          temp_c: Number(log.temp_c),
          notes: log.notes.trim() || null,
          outlet_id: outletId || null
        },
        newOperationId()
      )
      if (!result || result.success === false) throw new Error(result?.error || 'Could not record the temperature.')
      if (result.offline) say('Saved offline. It will replay with the same key.', 'warn')
      else if (result.within_range === false) say(`Out of range (${result.template || 'template'}). A corrective action was opened below — close it after fixing the cause.`, 'warn')
      else say(`Recorded within range (${result.template || 'template'}).`, 'ok')
      setLog({ template_id: '', location_label: '', temp_c: '', notes: '' })
      await loadAll()
    } catch (err) {
      say(err?.message || 'Could not record the temperature.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const submitClose = async (action) => {
    setBusy(action.id)
    try {
      const note = String(closeNoteByAction[action.id] || '').trim()
      if (!note) throw new Error('A close-out note is required as audit evidence.')
      const result = await window.api?.fnb?.closeCorrectiveAction?.(action.id, note, newOperationId())
      if (!result || result.success === false) throw new Error(result?.error || 'Could not close the action.')
      say('Corrective action closed with audit evidence.', 'ok')
      await loadAll()
    } catch (err) {
      say(err?.message || 'Could not close the action.', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={submitLog} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Record a temperature</h2>
          <p className="mt-1 text-xs text-slate-500">Evaluated against the template range. Out-of-range opens a corrective action automatically.</p>
          <div className="mt-3 grid gap-3">
            <label className="fnb-field grid gap-1 text-xs font-semibold text-slate-600">Check template (required)
              <select className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={log.template_id} onChange={(e) => setLog({ ...log, template_id: e.target.value })} required>
                <option value="">{loading ? 'Loading templates…' : templates.length === 0 ? 'No templates yet — create one' : 'Choose a template…'}</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.min_temp_c ?? '…'} to {t.max_temp_c ?? '…'}°C)</option>)}
              </select>
            </label>
            <label className="fnb-field grid gap-1 text-xs font-semibold text-slate-600">Location
              <input className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={log.location_label} onChange={(e) => setLog({ ...log, location_label: e.target.value })} placeholder="e.g. Walk-in fridge" required />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="fnb-field grid gap-1 text-xs font-semibold text-slate-600">Temp (°C)
                <input inputMode="decimal" className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={log.temp_c} onChange={(e) => setLog({ ...log, temp_c: e.target.value })} placeholder="4.0" required />
              </label>
              <label className="fnb-field grid gap-1 text-xs font-semibold text-slate-600">Notes
                <input className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={log.notes} onChange={(e) => setLog({ ...log, notes: e.target.value })} placeholder="Optional" />
              </label>
            </div>
          </div>
          <div className="mt-4 flex justify-end border-t border-slate-100 pt-3">
            <button type="submit" disabled={busy === 'log'} className="inline-flex min-h-[44px] items-center rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60">Record</button>
          </div>
        </form>

        <form onSubmit={submitTemplate} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">New check template</h2>
          <p className="mt-1 text-xs text-slate-500">Manager or administrator only. At least one bound is required.</p>
          <div className="mt-3 grid gap-3">
            <label className="fnb-field grid gap-1 text-xs font-semibold text-slate-600">Name
              <input className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={templateForm.name} onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })} placeholder="e.g. Walk-in fridge" required />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="fnb-field grid gap-1 text-xs font-semibold text-slate-600">Min °C
                <input inputMode="decimal" className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={templateForm.min_temp_c} onChange={(e) => setTemplateForm({ ...templateForm, min_temp_c: e.target.value })} placeholder="2" />
              </label>
              <label className="fnb-field grid gap-1 text-xs font-semibold text-slate-600">Max °C
                <input inputMode="decimal" className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={templateForm.max_temp_c} onChange={(e) => setTemplateForm({ ...templateForm, max_temp_c: e.target.value })} placeholder="5" />
              </label>
            </div>
          </div>
          <div className="mt-4 flex justify-end border-t border-slate-100 pt-3">
            <button type="submit" disabled={busy === 'template'} className="inline-flex min-h-[44px] items-center rounded-xl bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-60">Create template</button>
          </div>
        </form>
      </div>

      <section aria-label="Corrective actions" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-bold text-slate-900">Open corrective actions ({queue.length})</h2>
          <button type="button" onClick={loadAll} disabled={loading} className="inline-flex min-h-[40px] items-center rounded-xl border border-slate-300 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">Refresh</button>
        </div>
        {queue.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">No open corrective actions.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 font-bold">Status</th>
                <th className="px-4 py-2 font-bold">Issue</th>
                <th className="px-4 py-2 font-bold">Close-out evidence</th>
              </tr>
            </thead>
            <tbody className="[&>tr]:border-t [&>tr]:border-slate-100">
              {queue.map((action) => (
                <tr key={action.id}>
                  <td className="px-4 py-2"><span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">{action.status}</span></td>
                  <td className="px-4 py-2 text-slate-700"><p className="font-semibold">{action.title}</p><p className="text-xs text-slate-500">{action.detail}</p></td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1.5">
                      <input aria-label={`Close-out note for ${action.title}`} className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-slate-300 px-2 text-xs" placeholder="What was fixed? (required)" value={closeNoteByAction[action.id] || ''} onChange={(e) => setCloseNoteByAction((prev) => ({ ...prev, [action.id]: e.target.value }))} />
                      <button type="button" disabled={busy === action.id} onClick={() => submitClose(action)} className="inline-flex min-h-[40px] shrink-0 items-center rounded-xl bg-slate-900 px-3 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-60">
                        {busy === action.id ? '…' : 'Close'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {message.text && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-3 py-2 text-xs font-semibold ${message.tone === 'error' ? 'border-red-300 bg-red-50 text-red-900' : message.tone === 'warn' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-300 bg-emerald-50 text-emerald-900'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}
