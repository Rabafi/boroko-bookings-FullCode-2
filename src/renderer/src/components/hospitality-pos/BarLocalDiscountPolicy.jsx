import { useEffect, useState } from 'react'

const PERCENT = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,4})?$/

/** Owner settings for the service-enforced local discount guardrails. */
export default function BarLocalDiscountPolicy({ policy, busy, blocked, onCommand }) {
  const [draft, setDraft] = useState({ approval: '', maximum: '' })
  const [error, setError] = useState('')

  useEffect(() => {
    if (!policy) return
    setDraft({ approval: String(policy.approval_threshold_percent), maximum: String(policy.maximum_percent) })
    setError('')
  }, [policy?.approval_threshold_percent, policy?.maximum_percent])

  const save = (event, key, value, other) => {
    event.preventDefault()
    setError('')
    if (!PERCENT.test(value) || Number(value) > 100 || !PERCENT.test(other) || Number(other) > 100) {
      setError('Enter percentages from 0 to 100 with up to four decimal places.')
      return
    }
    const approval = key === 'discount_approval_threshold_percent' ? Number(value) : Number(other)
    const maximum = key === 'discount_max_percent' ? Number(value) : Number(other)
    if (approval > maximum) {
      setError('The approval threshold cannot exceed the maximum discount.')
      return
    }
    onCommand('settings.update', { key, value })
  }

  return <section className="mt-5 max-w-3xl rounded-xl border border-slate-700 bg-slate-900 p-4">
    <h3 className="font-semibold">Discount limits</h3>
    <p className="mt-1 text-xs text-slate-400">The local authority enforces these limits on every sale and tab settlement. Above the approval threshold, a different manager must approve. The maximum cannot be overridden.</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <form onSubmit={(event) => save(event, 'discount_approval_threshold_percent', draft.approval, draft.maximum)}>
        <label className="block text-xs">Manager approval threshold (%)<input required inputMode="decimal" value={draft.approval} onChange={(event) => setDraft((current) => ({ ...current, approval: event.target.value }))} disabled={busy || blocked || !policy} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
        <button type="submit" disabled={busy || blocked || !policy || draft.approval === String(policy?.approval_threshold_percent)} className="mt-2 rounded bg-slate-700 px-3 py-2 text-sm disabled:opacity-40">Save threshold</button>
      </form>
      <form onSubmit={(event) => save(event, 'discount_max_percent', draft.maximum, draft.approval)}>
        <label className="block text-xs">Maximum discount (%)<input required inputMode="decimal" value={draft.maximum} onChange={(event) => setDraft((current) => ({ ...current, maximum: event.target.value }))} disabled={busy || blocked || !policy} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
        <button type="submit" disabled={busy || blocked || !policy || draft.maximum === String(policy?.maximum_percent)} className="mt-2 rounded bg-slate-700 px-3 py-2 text-sm disabled:opacity-40">Save maximum</button>
      </form>
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-red-200">{error}</p>}
    {!policy && <p className="mt-2 text-xs text-amber-200">Discount policy is unavailable until the local authority refresh succeeds.</p>}
  </section>
}
