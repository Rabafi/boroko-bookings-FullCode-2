import { useState, useEffect, useCallback } from 'react';
import { Clock, Search, RefreshCw } from 'lucide-react';

const CURRENCY = 'P';
const fmt = (v) => Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Orders({ user, settings, isOnline }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState(() => new Date().toISOString().slice(0, 10));
  const currency = settings?.currency || CURRENCY;

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.api.pos.getOrders({ startDate: dateFilter, endDate: dateFilter });
      setOrders(data || []);
    } catch (e) {
      console.error('Failed to load orders:', e);
    } finally {
      setLoading(false);
    }
  }, [dateFilter]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  const filtered = orders.filter((o) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      String(o.id || '').toLowerCase().includes(q) ||
      String(o.walk_in_name || '').toLowerCase().includes(q) ||
      String(o.table_name || '').toLowerCase().includes(q) ||
      String(o.cashier_name || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Order History</h1>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
          />
          <button onClick={loadOrders} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">
            <RefreshCw className="inline h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by ID, guest, table, cashier..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex py-12 justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-400">No orders found</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Order</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Time</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Guest</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Table</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Method</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Cashier</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">Total</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((order) => (
                <tr key={order.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{String(order.id).slice(0, 8)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {order.created_at ? new Date(order.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '-'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700">{order.walk_in_name || '-'}</td>
                  <td className="px-4 py-3 text-xs text-slate-700">{order.table_name || '-'}</td>
                  <td className="px-4 py-3 text-xs uppercase text-slate-600">{order.payment_method || 'cash'}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{order.cashier_name || '-'}</td>
                  <td className="px-4 py-3 text-right text-xs font-bold text-slate-800">{currency} {fmt(order.total)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      order.status === 'voided'
                        ? 'bg-red-100 text-red-700'
                        : order._pending_sync
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {order.status === 'voided' ? 'Voided' : order._pending_sync ? 'Pending' : 'Completed'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
