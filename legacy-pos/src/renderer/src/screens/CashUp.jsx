import { useState, useEffect, useCallback, useMemo } from 'react';
import { Calculator, RefreshCw, Download } from 'lucide-react';

const CURRENCY = 'P';
const fmt = (v) => Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'orange_money', 'myzaka', 'smega', 'other'];

export default function CashUp({ user, settings, isOnline }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openingFloat, setOpeningFloat] = useState('');
  const [countedCash, setCountedCash] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cashups, setCashups] = useState([]);
  const currency = settings?.currency || CURRENCY;

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.api.pos.getOrders({ startDate: date, endDate: date });
      setOrders(data || []);
      const c = await window.api.pos.getCashups({ limit: 10 });
      setCashups(c || []);
    } catch (e) {
      console.error('Failed to load cash-up data:', e);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  const summary = useMemo(() => {
    const completed = orders.filter((o) => o.status === 'completed');
    const voided = orders.filter((o) => o.status === 'voided');
    const byMethod = {};
    let grossSales = 0;
    let returnTotal = 0;
    let pendingCount = 0;

    for (const order of completed) {
      const total = Number(order.total || 0);
      const breakdown = Array.isArray(order.payment_breakdown)
        ? order.payment_breakdown
        : typeof order.payment_breakdown === 'string'
          ? (() => { try { return JSON.parse(order.payment_breakdown) } catch { return [] } })()
          : [];

      for (const p of breakdown) {
        byMethod[p.method] = Number(byMethod[p.method] || 0) + Number(p.amount || 0);
      }
      if (total >= 0) grossSales += total;
      else returnTotal += Math.abs(total);
      if (order._pending_sync) pendingCount++;
    }

    const netSales = completed.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const float = Number(openingFloat) || 0;
    const cashSales = Number(byMethod.cash || 0);

    return {
      orders_count: completed.length,
      void_count: voided.length,
      pending_count: pendingCount,
      gross_sales: grossSales,
      returns_total: returnTotal,
      net_sales: netSales,
      by_method: byMethod,
      expected_cash_drawer: float + cashSales,
      counted_cash: Number(countedCash) || 0,
      cash_variance: (Number(countedCash) || 0) - (float + cashSales)
    };
  }, [orders, openingFloat, countedCash]);

  const handleSubmitCashup = async () => {
    setSubmitting(true);
    try {
      const payload = {
        date,
        opening_float: Number(openingFloat) || 0,
        expected_cash_drawer: summary.expected_cash_drawer,
        expected_by_method: summary.by_method,
        counted_by_method: { cash: Number(countedCash) || 0 },
        variance_by_method: { cash: summary.cash_variance },
        cash_over_short: summary.cash_variance,
        orders_count: summary.orders_count,
        void_count: summary.void_count,
        pending_count: summary.pending_count,
        gross_sales: summary.gross_sales,
        returns_total: summary.returns_total,
        net_sales: summary.net_sales,
        notes: notes || null,
        cashier_id: user.id,
        cashier_name: user.name || user.email
      };
      await window.api.pos.createCashup(payload);
      setOpeningFloat('');
      setCountedCash('');
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
        <div className="flex py-12 justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Summary */}
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-4 font-bold text-slate-800">Sales Summary</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Orders</span><span className="font-semibold">{summary.orders_count}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Voids</span><span className="font-semibold text-red-600">{summary.void_count}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Pending Sync</span><span className="font-semibold text-amber-600">{summary.pending_count}</span></div>
                <hr className="border-slate-100" />
                <div className="flex justify-between"><span className="text-slate-500">Gross Sales</span><span className="font-semibold">{currency} {fmt(summary.gross_sales)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Returns</span><span className="font-semibold text-red-600">-{currency} {fmt(summary.returns_total)}</span></div>
                <div className="flex justify-between border-t border-slate-200 pt-2"><span className="font-bold">Net Sales</span><span className="font-bold text-emerald-700">{currency} {fmt(summary.net_sales)}</span></div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-4 font-bold text-slate-800">By Payment Method</h2>
              <div className="space-y-2 text-sm">
                {PAYMENT_METHODS.filter((m) => summary.by_method[m] > 0).map((m) => (
                  <div key={m} className="flex justify-between">
                    <span className="text-slate-500 capitalize">{m.replace(/_/g, ' ')}</span>
                    <span className="font-semibold">{currency} {fmt(summary.by_method[m])}</span>
                  </div>
                ))}
                {PAYMENT_METHODS.every((m) => !summary.by_method[m]) && (
                  <p className="text-xs text-slate-400">No sales for this date</p>
                )}
              </div>
            </div>
          </div>

          {/* Cash Count */}
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-4 font-bold text-slate-800">Cash Count</h2>
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
                <div>
                  <label className="text-xs font-medium text-slate-500">Expected Cash Drawer ({currency})</label>
                  <p className="mt-1 text-lg font-bold text-slate-800">{currency} {fmt(summary.expected_cash_drawer)}</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">Counted Cash ({currency})</label>
                  <input
                    type="number"
                    value={countedCash}
                    onChange={(e) => setCountedCash(e.target.value)}
                    placeholder="0.00"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    min="0"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">Variance ({currency})</label>
                  <p className={`mt-1 text-lg font-bold ${summary.cash_variance === 0 ? 'text-slate-800' : summary.cash_variance > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {currency} {fmt(summary.cash_variance)}
                  </p>
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
