// @ts-check
import { useMemo } from 'react'
import {
  addTenderRow,
  centsToMoney,
  defaultProviderStatus,
  evaluateTenders,
  referenceRequired,
  removeTenderRow,
  updateTenderRow
} from './tenderMath.js'

/**
 * @param {{
 *   totalCents: number,
 *   rows: Array<Record<string, unknown>>,
 *   onChange: (rows: Array<Record<string, unknown>>) => void,
 *   disabled?: boolean,
 *   customers?: Array<Record<string, unknown>>,
 *   canUseStoreCredit?: boolean,
 *   canUseVoucher?: boolean
 * }} props
 */
export default function BarLocalTenderEditor({ totalCents, rows, onChange, disabled = false, customers = [], canUseStoreCredit = false, canUseVoucher = false }) {
  const evaluation = useMemo(() => evaluateTenders({ totalCents, rows }), [totalCents, rows])
  const due = Number.isSafeInteger(totalCents) && totalCents >= 0 ? centsToMoney(totalCents) : '-'

  const update = (id, patch) => onChange(updateTenderRow(rows, id, patch))

  return (
    <section className="mt-4 rounded-xl border border-slate-700 bg-slate-900 p-4" aria-label="Split tender payment">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Payment</h3>
        <p className="text-sm">Amount due <span className="font-semibold">{due}</span></p>
      </div>
      <ul className="mt-3 space-y-3">
        {rows.map((row, index) => {
          const method = String(row.method ?? 'cash')
          return (
            <li key={String(row.id)} className="rounded border border-slate-800 bg-slate-950 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-300">Tender {index + 1}</p>
                {rows.length > 1 && <button type="button" disabled={disabled} onClick={() => onChange(removeTenderRow(rows, String(row.id)))} className="text-xs text-amber-300 disabled:opacity-40">Remove</button>}
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="text-xs">Method
                  <select
                    value={method}
                    disabled={disabled}
                    onChange={(event) => {
                      const nextMethod = event.target.value
                      update(String(row.id), {
                        method: nextMethod,
                        provider_status: defaultProviderStatus(nextMethod),
                        reference: nextMethod === method ? row.reference : '',
                        customer_id: nextMethod === 'customer_credit' ? row.customer_id : '',
                        voucher_code: nextMethod === 'voucher' ? row.voucher_code : ''
                      })
                    }}
                    className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"
                  >
                    <option value="cash">Cash</option>
                    <option value="card">Card terminal</option>
                    <option value="mobile_money">Mobile money</option>
                    <option value="bank_transfer">Bank transfer</option>
                    <option value="external">External terminal</option>
                    {canUseStoreCredit && <option value="customer_credit">Customer credit</option>}
                    {canUseVoucher && <option value="voucher">Voucher</option>}
                    <option value="room_charge" disabled>Room charge (unavailable in local Bar)</option>
                  </select>
                </label>
                <label className="text-xs">{method === 'cash' ? 'Cash applied to this sale' : 'Amount'}
                  <input
                    inputMode="decimal"
                    value={String(row.amount ?? '')}
                    disabled={disabled}
                    placeholder="0.00"
                    onChange={(event) => update(String(row.id), { amount: event.target.value })}
                    className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"
                  />
                </label>
              </div>

              {method === 'cash' && (
                <label className="mt-2 block text-xs">Cash received from customer (optional; change is calculated)
                  <input
                    inputMode="decimal"
                    value={String(row.tendered ?? '')}
                    disabled={disabled}
                    placeholder="Leave blank for exact payment"
                    onChange={(event) => update(String(row.id), { tendered: event.target.value })}
                    className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"
                  />
                </label>
              )}

              {method === 'customer_credit' && (
                <label className="mt-2 block text-xs">Customer account
                  <select
                    value={String(row.customer_id ?? '')}
                    disabled={disabled}
                    onChange={(event) => update(String(row.id), { customer_id: event.target.value })}
                    className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"
                  >
                    <option value="">Select an active customer</option>
                    {customers.filter((customer) => customer.status !== 'suspended').map((customer) => (
                      <option key={String(customer.customer_id)} value={String(customer.customer_id)}>
                        {String(customer.name)} - outstanding {String(customer.outstanding ?? '0.00')} / limit {String(customer.credit_limit ?? '0.00')}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {method === 'voucher' && (
                <label className="mt-2 block text-xs">Voucher code
                  <input
                    maxLength={60}
                    value={String(row.voucher_code ?? '')}
                    disabled={disabled}
                    onChange={(event) => update(String(row.id), { voucher_code: event.target.value.toUpperCase() })}
                    className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"
                  />
                </label>
              )}

              {referenceRequired(method) && (
                <label className="mt-2 block text-xs">
                  {method === 'room_charge' ? 'Room and guest reference' : 'Terminal, bank or authorisation reference'}
                  <input
                    maxLength={120}
                    value={String(row.reference ?? '')}
                    disabled={disabled}
                    onChange={(event) => update(String(row.id), { reference: event.target.value })}
                    className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"
                  />
                </label>
              )}

              {['card', 'mobile_money', 'bank_transfer', 'external'].includes(method) && (
                <p role="status" className="mt-2 rounded border border-amber-800 bg-amber-950/40 p-2 text-xs text-amber-100">Recorded locally only. This Bar authority cannot verify provider authorisation or settlement.</p>
              )}
              {method === 'room_charge' && <p role="alert" className="mt-2 rounded border border-amber-800 bg-amber-950/40 p-2 text-xs text-amber-100">Room charges require the hotel authority and cannot be completed in local Bar mode. Select another tender.</p>}
            </li>
          )
        })}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={disabled || rows.length >= 20} onClick={() => onChange(addTenderRow(rows))} className="rounded border border-slate-600 px-3 py-2 text-sm disabled:opacity-40">Add tender</button>
        <button type="button" disabled={disabled || rows.length !== 1} onClick={() => { const only = rows[0]; if (!only) return; onChange([{ ...only, amount: centsToMoney(totalCents), provider_status: defaultProviderStatus(String(only.method ?? 'cash')) }]) }} className="rounded border border-slate-600 px-3 py-2 text-sm disabled:opacity-40">Use exact total</button>
      </div>

      <div className="mt-3 grid gap-1 border-t border-slate-800 pt-3 text-xs text-slate-300">
        <p className="flex justify-between"><span>Tendered total</span><span>{evaluation.sumCents > 0 ? centsToMoney(evaluation.sumCents) : '-'}</span></p>
        <p className="flex justify-between"><span>Remaining</span><span>{centsToMoney(evaluation.remainingCents)}</span></p>
        <p className="flex justify-between"><span>Cash change</span><span>{centsToMoney(evaluation.changeCents)}</span></p>
      </div>
      {evaluation.error && <p role="alert" className="mt-2 rounded border border-amber-700 bg-amber-950/40 p-2 text-xs text-amber-100">{evaluation.error}</p>}
      {!evaluation.error && <p className="mt-2 text-xs text-emerald-200">Tenders balance exactly. The local authority will reprice and validate the payment on commit.</p>}
    </section>
  )
}
