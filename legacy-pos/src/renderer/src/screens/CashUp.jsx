import { useState, useEffect, useCallback, useMemo } from 'react';
import { Calculator, RefreshCw, Download } from 'lucide-react';

const CURRENCY = 'P';
const fmt = (v) => Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'orange_money', 'myzaka', 'smega', 'other'];

export default function CashUp({ user, settings, isOnline }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [openingFloat, setOpeningFloat] = useState('');
  const [countedMethods, setCountedMethods] = useState({});
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cashups, setCashups] = useState([]);
  const [summary, setSummary] = useState(null);
  const currency = settings?.currency || CURRENCY;

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const s = await window.api.pos.getCashupSummary({ date, openingFloat: Number(openingFloat) || 0 });
      setSummary(s);
      const c = await window.api.pos.getCashups({ limit: 10 });
      setCashups(c || []);
    } catch (e) {
      console.error('Failed to load cash-up data:', e);
    } finally {
      setLoading(false);
    }
  }, [date, openingFloat]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  useEffect(() => {
    if (summary?.by_method) {
      const initial = {};
      for (const m of PAYMENT_METHODS) {
        initial[m] = '';
      }
      setCountedMethods((prev) => ({ ...initial, ...prev }));
    }
  }, [summary?.by_method]);

  const varianceByMethod = useMemo(() => {
    if (!summary) return {};
    const result = {};
    for (const m of PAYMENT_METHODS) {
      const expected = m === 'cash'
        ? (Number(summary.by_method?.cash || 0) + (Number(openingFloat) || 0))
        : Number(summary.by_method?.[m] || 0);
      const counted = Number(countedMethods[m]) || 0;
      result[m] = counted - expected;
    }
    return result;
  }, [summary, countedMethods, openingFloat]);

  const totalVariance = useMemo(() => {
    return Object.values(varianceByMethod).reduce((sum, v) => sum + v, 0);
  }, [varianceByMethod]);

  const handleSubmitCashup = async () => {
    setSubmitting(true);
    try {
      const payload = {
        date,
        opening_float: Number(openingFloat) || 0,
        counted_by_method: {},
        variance_by_method: {},
        cash_over_short: 0,
        notes: notes || null,
        cashier_id: user.id,
        cashier_name: user.name || user.email
      };
      for (const m of PAYMENT_METHODS) {
        const counted = Number(countedMethods[m]) || 0;
        if (counted > 0 || m === 'cash') {
          payload.counted_by_method[m] = counted;
        }
        if (varianceByMethod[m] !== undefined) {
          payload.variance_by_method[m] = varianceByMethod[m];
        }
      }
      payload.cash_over_short = totalVariance;
      await window.api.pos.createCashup(payload);
      setOpeningFloat('');
      setCountedMethods({});
      setNotes('');
      await loadOrders();
      alert('Cash-up saved successfully!');
    } catch (e) {
      alert(e?.message || 'Failed to save cash-up.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Cash-Up</h1>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
          />
          <button onClick={loadOrders} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">
            <RefreshCw className="inline h-4 w-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
              <div className="h-5 w-32 animate-pulse rounded bg-slate-200" />
              {[1,2,3,4,5].map((i) => <div key={i} className="h-4 w-full animate-pulse rounded bg-slate-100" />)}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
              <div className="h-5 w-48 animate-pulse rounded bg-slate-200" />
              {[1,2,3].map((i) => <div key={i} className="h-4 w-full animate-pulse rounded bg-slate-100" />)}
            </div>
          </div>
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
              <div className="h-5 w-40 animate-pulse rounded bg-slate-200" />
              {[1,2,3,4].map((i) => <div key={i} className="h-10 w-full animate-pulse rounded bg-slate-100" />)}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Summary */}
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-4 font-bold text-slate-800">Sales Summary</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Orders</span><span className="font-semibold">{summary?.orders_count || 0}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Voids</span><span className="font-semibold text-red-600">{summary?.void_count || 0}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Pending Sync</span><span className="font-semibold text-amber-600">{summary?.pending_count || 0}</span></div>
                <hr className="border-slate-100" />
                <div className="flex justify-between"><span className="text-slate-500">Gross Sales</span><span className="font-semibold">{currency} {fmt(summary?.gross_sales)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Returns</span><span className="font-semibold text-red-600">-{currency} {fmt(summary?.returns_total)}</span></div>
                <div className="flex justify-between border-t border-slate-200 pt-2"><span className="font-bold">Net Sales</span><span className="font-bold text-emerald-700">{currency} {fmt(summary?.net_sales)}</span></div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-4 font-bold text-slate-800">By Payment Method (Expected)</h2>
              <div className="space-y-2 text-sm">
                {PAYMENT_METHODS.filter((m) => (summary?.by_method?.[m] || 0) > 0).map((m) => (
                  <div key={m} className="flex justify-between">
                    <span className="text-slate-500 capitalize">{m.replace(/_/g, ' ')}</span>
                    <span className="font-semibold">{currency} {fmt(summary?.by_method?.[m])}</span>
                  </div>
                ))}
                {PAYMENT_METHODS.every((m) => !(summary?.by_method?.[m] > 0)) && (
                  <p className="text-xs text-slate-400">No sales for this date</p>
                )}
              </div>
            </div>
          </div>

          {/* Cash Count */}
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-4 font-bold text-slate-800">Count & Variance</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-500">Opening Float ({currency})</label>
                  <input
                    type="number"
                    value={openingFloat}
                    onChange={(e) => setOpeningFloat(e.target.value)}
                    placeholder="0.00"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    min="0"
                  />
                </div>
                {PAYMENT_METHODS.map((m) => {
                  const expected = m === 'cash'
                    ? (Number(summary?.by_method?.cash || 0) + (Number(openingFloat) || 0))
                    : Number(summary?.by_method?.[m] || 0);
                  if (expected <= 0 && m !== 'cash') return null;
                  return (
                    <div key={m} className="grid grid-cols-3 gap-2 items-end">
                      <div>
                        <label className="text-xs font-medium text-slate-500 capitalize">{m.replace(/_/g, ' ')} Expected</label>
                        <p className="mt-1 text-sm font-semibold text-slate-700">{currency} {fmt(expected)}</p>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-500">Counted</label>
                        <input
                          type="number"
                          value={countedMethods[m] || ''}
                          onChange={(e) => setCountedMethods((prev) => ({ ...prev, [m]: e.target.value }))}
                          placeholder="0.00"
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          min="0"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-500">Variance</label>
                        <p className={`mt-1 text-sm font-bold ${varianceByMethod[m] === 0 ? 'text-slate-800' : varianceByMethod[m] > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                          {currency} {fmt(varianceByMethod[m])}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div className="pt-2 border-t border-slate-200">
                  <div className="flex justify-between">
                    <span className="text-xs font-medium text-slate-500">Total Variance</span>
                    <span className={`text-sm font-bold ${totalVariance === 0 ? 'text-slate-800' : totalVariance > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                      {currency} {fmt(totalVariance)}
                    </span>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">Notes</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Optional notes..."
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    rows={2}
                  />
                </div>
                <button
                  onClick={handleSubmitCashup}
                  disabled={submitting}
                  className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Submit Cash-Up'}
                </button>
              </div>
            </div>

            {/* Recent Cash-Ups */}
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-4 font-bold text-slate-800">Recent Cash-Ups</h2>
              {cashups.length === 0 ? (
                <p className="text-xs text-slate-400">No cash-ups yet</p>
              ) : (
                <div className="space-y-2">
                  {cashups.slice(0, 5).map((c) => (
                    <div key={c.id} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
                      <span className="text-slate-500">{c.date || c.created_at?.slice(0, 10)}</span>
                      <span className="font-semibold">{currency} {fmt(c.net_sales)}</span>
                      {c._pending_sync && <span className="text-amber-600">Pending</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
