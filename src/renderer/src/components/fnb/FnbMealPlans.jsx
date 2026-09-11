import { useEffect, useMemo, useState } from 'react'

function newOperationId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `op-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/**
 * Meal plans and included-meal consumption.
 * - Grants attach covers to an active booking with a validity window.
 * - Redemption decrements covers atomically and is blocked outside the
 *   plan window. No inventory movement or folio entry is posted here, so the
 *   record honestly stores neither — money and stock stay canonical.
 */
export default function FnbMealPlans() {
  const [bookings, setBookings] = useState([])
  const [entitlements, setEntitlements] = useState([])
  const [loading, setLoading] = useState(true)
  const [grant, setGrant] = useState({ booking_id: '', customer_name: '', plan_code: 'FULL_BOARD', total_covers: '2', valid_from: '', valid_to: '' })
  const [redeem, setRedeem] = useState({ entitlement_id: '', covers: '1', complimentary: false, complimentary_reason: '' })
  const [busy, setBusy] = useState(null)
  const [message, setMessage] = useState({ text: '', tone: 'info' })
  const say = (text, tone = 'info') => setMessage({ text, tone })

  const loadAll = async () => {
    setLoading(true)
    try {
      const [b, e] = await Promise.all([
        window.api?.bookings?.getAll?.().catch(() => []),
        window.api?.fnb?.getMealEntitlements?.(false).catch(() => null)
      ])
      setBookings(Array.isArray(b) ? b : [])
      setEntitlements(Array.isArray(e?.entitlements) ? e.entitlements : [])
      if (e && e.success === false) say(e.error || 'Meal plans are unavailable.', 'error')
    } catch (err) {
      say(err?.message || 'Could not load meal plans.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeBookings = useMemo(
    () => bookings.filter((b) => ['confirmed', 'checked_in'].includes(String(b.status || '').toLowerCase())),
    [bookings]
  )

  const submitGrant = async (e) => {
    e?.preventDefault?.()
    setBusy('grant')
    try {
      const result = await window.api?.fnb?.createMealEntitlement?.(
        {
          booking_id: grant.booking_id || null,
          customer_name: grant.customer_name.trim() || null,
          plan_code: grant.plan_code,
          total_covers: Number(grant.total_covers) || 0,
          valid_from: grant.valid_from || null,
          valid_to: grant.valid_to || null
        },
        newOperationId()
      )
      if (!result || result.success === false) throw new Error(result?.error || 'Could not grant the plan.')
      say(result.offline ? 'Saved offline. It will replay with the same key.' : 'Meal plan granted.', result.offline ? 'warn' : 'ok')
      setGrant({ booking_id: '', customer_name: '', plan_code: 'FULL_BOARD', total_covers: '2', valid_from: '', valid_to: '' })
      await loadAll()
    } catch (err) {
      say(err?.message || 'Could not grant the plan.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const submitRedeem = async (e) => {
    e?.preventDefault?.()
    setBusy('redeem')
    try {
      if (!redeem.entitlement_id) throw new Error('Choose an entitlement from the list.')
      const result = await window.api?.fnb?.redeemMeal?.(
        redeem.entitlement_id,
        {
          covers: Number(redeem.covers) || 1,
          complimentary: Boolean(redeem.complimentary),
          complimentary_reason: redeem.complimentary_reason.trim() || null
        },
        newOperationId()
      )
      if (!result || result.success === false) throw new Error(result?.error || 'Could not redeem the meal.')
      say(result.offline ? 'Saved offline. It will replay with the same key.' : `Redeemed. ${result.remaining_covers ?? ''} cover(s) remain.`.trim(), result.offline ? 'warn' : 'ok')
      setRedeem({ entitlement_id: '', covers: '1', complimentary: false, complimentary_reason: '' })
      await loadAll()
    } catch (err) {
      say(err?.message || 'Could not redeem the meal.', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-4">
      <section aria-label="Active meal plans" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-bold text-slate-900">Active plans ({entitlements.length})</h2>
          <button type="button" onClick={loadAll} disabled={loading} className="inline-flex min-h-[40px] items-center rounded-xl border border-slate-300 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">Refresh</button>
        </div>
        {loading && entitlements.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">Loading plans…</p>
        ) : entitlements.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">No active plans. Grant one below.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 font-bold">Plan</th>
                <th className="px-4 py-2 font-bold">Guest</th>
                <th className="px-4 py-2 text-right font-bold">Remaining</th>
                <th className="px-4 py-2 font-bold">Valid</th>
              </tr>
            </thead>
            <tbody className="[&>tr]:border-t [&>tr]:border-slate-100">
              {entitlements.map((plan) => (
                <tr key={plan.id} className={redeem.entitlement_id === plan.id ? 'bg-emerald-50/60' : ''}>
                  <td className="px-4 py-2 font-semibold text-slate-800">{String(plan.plan_code || '').replace(/_/g, ' ')}</td>
                  <td className="px-4 py-2 text-slate-600">{plan.customer_name || '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-900">{plan.remaining_covers}/{plan.total_covers}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{plan.valid_from || '…'} → {plan.valid_to || '…'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={submitGrant} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Grant a meal plan</h2>
          <p className="mt-1 text-xs text-slate-500">Attach covers to an active booking. Idempotent on retry.</p>
          <div className="mt-3 grid gap-3">
            <label className="fnb-field grid gap-1 text-xs font-semibold text-slate-600">Booking
              <select className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={grant.booking_id} onChange={(e) => setGrant({ ...grant, booking_id: e.target.value })}>
                <option value="">No booking (guest only)</option>
                {activeBookings.map((b) => <option key={b.id} value={b.id}>{b.customer_name || b.guest_name || 'Guest'} · {b.status}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="fnb-field grid gap-1 text-xs font-semibold text-slate-600">Plan
                <select className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={grant.plan_code} onChange={(e) => setGrant({ ...grant, plan_code: e.target.value })}>
                  <option value="FULL_BOARD">Full board</option>
                  <option value="HALF_BOARD">Half board</option>
                  <option value="BED_BREAKFAST">Bed &amp; breakfast</option>
                  <option value="VOUCHER">Voucher</option>
                </select>
              </label>
              <label className="fnb-field grid gap-1 text-xs font-semibold text-slate-600">Total covers
                <input inputMode="numeric" className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={grant.total_covers} onChange={(e) => setGrant({ ...grant, total_covers: e.target.value })} required />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="fnb-field grid gap-1 text-xs font-semibold text-slate-600">Valid from
                <input type="date" className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={grant.valid_from} onChange={(e) => setGrant({ ...grant, valid_from: e.target.value })} />
              </label>
              <label className="fnb-field grid gap-1 text-xs font-semibold text-slate-600">Valid to
                <input type="date" className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={grant.valid_to} onChange={(e) => setGrant({ ...grant, valid_to: e.target.value })} />
              </label>
            </div>
            <label className="fnb-field grid gap-1 text-xs font-semibold text-slate-600">Guest
              <input className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={grant.customer_name} onChange={(e) => setGrant({ ...grant, customer_name: e.target.value })} placeholder="Guest name" />
            </label>
          </div>
          <div className="mt-4 flex justify-end border-t border-slate-100 pt-3">
            <button type="submit" disabled={busy === 'grant'} className="inline-flex min-h-[44px] items-center rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60">Grant plan</button>
          </div>
        </form>

        <form onSubmit={submitRedeem} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Redeem covers</h2>
          <p className="mt-1 text-xs text-slate-500">Complimentary redemptions need a reason and a manager-level role.</p>
          <div className="mt-3 grid gap-3">
            <label className="fnb-field grid gap-1 text-xs font-semibold text-slate-600">Entitlement
              <select className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={redeem.entitlement_id} onChange={(e) => setRedeem({ ...redeem, entitlement_id: e.target.value })} required>
                <option value="">Choose a plan…</option>
                {entitlements.map((plan) => <option key={plan.id} value={plan.id}>{String(plan.plan_code || '').replace(/_/g, ' ')} · {plan.customer_name || 'guest'} · {plan.remaining_covers} left</option>)}
              </select>
            </label>
            <label className="fnb-field grid gap-1 text-xs font-semibold text-slate-600">Covers
              <input inputMode="numeric" className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={redeem.covers} onChange={(e) => setRedeem({ ...redeem, covers: e.target.value })} required />
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              <input type="checkbox" checked={redeem.complimentary} onChange={(e) => setRedeem({ ...redeem, complimentary: e.target.checked })} className="h-4 w-4 accent-emerald-700" />
              Complimentary (manager approval + reason required)
            </label>
            {redeem.complimentary && (
              <label className="fnb-field grid gap-1 text-xs font-semibold text-slate-600">Complimentary reason
                <input className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm" value={redeem.complimentary_reason} onChange={(e) => setRedeem({ ...redeem, complimentary_reason: e.target.value })} placeholder="Why is this complimentary?" required />
              </label>
            )}
          </div>
          <div className="mt-4 flex justify-end border-t border-slate-100 pt-3">
            <button type="submit" disabled={busy === 'redeem'} className="inline-flex min-h-[44px] items-center rounded-xl bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-60">Redeem</button>
          </div>
        </form>
      </div>

      {message.text && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-3 py-2 text-xs font-semibold ${message.tone === 'error' ? 'border-red-300 bg-red-50 text-red-900' : message.tone === 'warn' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-300 bg-emerald-50 text-emerald-900'}`}>
          {message.text}
        </p>
      )}
      <p className="text-[11px] leading-4 text-slate-500">Redemption records covers consumed only. Serve the meal through the POS; nothing here posts inventory or folio entries.</p>
    </div>
  )
}
