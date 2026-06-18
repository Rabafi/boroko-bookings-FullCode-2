import { useState, useEffect, useCallback } from 'react';
import { Clock, Search, RefreshCw, XCircle, RotateCcw, Eye, EyeOff } from 'lucide-react';

const CURRENCY = 'P';
const fmt = (v) => Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function getOrderItems(order = {}) {
  if (Array.isArray(order.pos_order_items)) return order.pos_order_items;
  if (Array.isArray(order.items)) return order.items;
  return [];
}

function getItemName(item = {}) {
  return item.item_name || item.name || item.menu_item_name || 'Item';
}

function formatOrderItems(order = {}) {
  const items = getOrderItems(order);
  if (items.length === 0) return 'No items saved';
  return items.map((item) => {
    const quantity = Number(item.quantity || 0);
    const qtyLabel = Number.isFinite(quantity) && quantity !== 0 ? ` x${Math.abs(quantity)}` : '';
    return `${getItemName(item)}${qtyLabel}`;
  }).join(', ');
}

function PinInput({ value, onChange, autoFocus = false }) {
  const [showPin, setShowPin] = useState(false);
  return (
    <div className="relative mt-1">
      <input
        type={showPin ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 text-sm"
        placeholder="Enter PIN"
        inputMode="numeric"
        autoFocus={autoFocus}
      />
      <button
        type="button"
        onClick={() => setShowPin((current) => !current)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
        aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
        title={showPin ? 'Hide PIN' : 'Show PIN'}
      >
        {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function PINModal({ title, onClose, onConfirm, submitting }) {
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-bold text-slate-800">{title}</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-500">Supervisor PIN</label>
            <PinInput value={pin} onChange={setPin} autoFocus />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500">Reason</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={2} placeholder="Reason..." />
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={() => onConfirm(pin, reason)} disabled={!pin || submitting}
              className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
              {submitting ? 'Processing...' : 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReturnModal({ order, onClose, onConfirm, submitting }) {
  const [items, setItems] = useState(
    (order.pos_order_items || []).map((item) => ({ ...item, returnQty: 0 }))
  );
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const currency = 'P';

  const toggleItem = (idx) => {
    setItems((prev) => prev.map((item, i) => i === idx ? { ...item, returnQty: item.returnQty > 0 ? 0 : item.quantity } : item));
  };

  const returnItems = items.filter((i) => i.returnQty > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="touch-scroll-y w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl max-h-[80vh] overflow-y-auto">
        <h3 className="mb-4 text-lg font-bold text-slate-800">Partial Return - {String(order.id).slice(0, 8)}</h3>
        <div className="space-y-3">
          {items.map((item, idx) => (
            <div key={idx} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
              <input type="checkbox" checked={item.returnQty > 0} onChange={() => toggleItem(idx)} className="h-4 w-4" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-slate-800">{item.item_name}</p>
                <p className="text-xs text-slate-500">Qty: {item.quantity} x {currency} {fmt(item.unit_price)}</p>
              </div>
              {item.returnQty > 0 && (
                <span className="text-xs font-semibold text-red-600">-{currency} {fmt(item.returnQty * item.unit_price)}</span>
              )}
            </div>
          ))}
          {returnItems.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-4">Select items to return</p>
          )}
          <div>
            <label className="text-xs font-medium text-slate-500">Reason</label>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Reason for return..." />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500">Supervisor PIN</label>
            <PinInput value={pin} onChange={setPin} />
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={() => onConfirm(returnItems, pin, reason)} disabled={returnItems.length === 0 || !pin || submitting}
              className="flex-1 rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
              {submitting ? 'Processing...' : 'Submit Return'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Orders({ user, settings, isOnline }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState(() => new Date().toISOString().slice(0, 10));
  const [voidModal, setVoidModal] = useState(null);
  const [returnModal, setReturnModal] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const currency = settings?.currency || CURRENCY;

  const copyOrderId = (id) => {
    navigator.clipboard.writeText(String(id)).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

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
      String(o.cashier_name || '').toLowerCase().includes(q) ||
      formatOrderItems(o).toLowerCase().includes(q)
    );
  });

  const canVoid = (order) => order.status === 'completed' && !order._pending_void;
  const canReturn = (order) => order.status === 'completed' && !order._pending_sync;

  const handleVoidConfirm = async (pin, reason) => {
    setSubmitting(true);
    try {
      await window.api.pos.voidOrder({
        order_id: voidModal.id,
        approved_by: user.id,
        pin,
        reason: reason || 'Void from orders',
        outlet_id: voidModal.outlet_id
      });
      setVoidModal(null);
      await loadOrders();
    } catch (e) {
      alert(e?.message || 'Void failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReturnConfirm = async (returnItems, pin, reason) => {
    setSubmitting(true);
    try {
      const payload = {
        order_id: returnModal.id,
        pin,
        reason: reason || `Partial return for order ${returnModal.id}`,
        lines: returnItems.map((item) => ({
          line_id: item.id || null,
          menu_item_id: item.menu_item_id,
          quantity: item.returnQty
        })),
        cashier_user_id: user.id,
        cashier_name: user.name || user.email,
        outlet_id: returnModal.outlet_id || null
      };
      await window.api.pos.partialReturn(payload);
      setReturnModal(null);
      await loadOrders();
    } catch (e) {
      alert(e?.message || 'Return failed.');
    } finally {
      setSubmitting(false);
    }
  };

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
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
            <div className="h-4 w-full animate-pulse rounded bg-slate-200" />
          </div>
          {[1,2,3,4,5].map((i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-slate-100">
              <div className="h-4 w-20 animate-pulse rounded bg-slate-100" />
              <div className="h-4 w-16 animate-pulse rounded bg-slate-100" />
              <div className="h-4 w-24 animate-pulse rounded bg-slate-100" />
              <div className="h-4 w-20 animate-pulse rounded bg-slate-100" />
              <div className="h-4 w-16 animate-pulse rounded bg-slate-100 ml-auto" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-400">No orders found</p>
      ) : (
        <div className="touch-scroll overflow-auto rounded-xl border border-slate-200 bg-white" style={{ maxHeight: 'calc(100vh - 220px)' }}>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/80">
              <tr>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Order</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Time</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Guest</th>
                <th className="min-w-[220px] px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Items</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Method</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">Total</th>
                <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">Status</th>
                <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((order) => (
                <tr key={order.id} className="group hover:bg-slate-50/80 transition-colors">
                  <td className="px-4 py-3">
                    <button onClick={() => copyOrderId(order.id)}
                      className="font-mono text-xs text-slate-500 hover:text-emerald-600 transition-colors cursor-pointer"
                      title="Click to copy full ID">
                      {String(order.id).slice(0, 8)}
                      {copiedId === order.id && <span className="ml-1 text-[10px] text-emerald-500">copied</span>}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {order.created_at ? new Date(order.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium text-slate-700">{order.walk_in_name || '-'}</span>
                    {order.table_name && <span className="ml-1 text-[10px] text-slate-400">T:{order.table_name}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <p className="max-w-[360px] truncate text-xs font-medium text-slate-700" title={formatOrderItems(order)}>
                      {formatOrderItems(order)}
                    </p>
                    {getOrderItems(order).length > 0 && (
                      <p className="mt-0.5 text-[10px] text-slate-400">{getOrderItems(order).length} line{getOrderItems(order).length === 1 ? '' : 's'}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
                      {order.payment_method || 'cash'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-xs font-bold text-slate-800">{currency} {fmt(order.total)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      order.status === 'voided'
                        ? 'bg-red-100 text-red-600'
                        : order._pending_sync
                          ? 'bg-amber-100 text-amber-600'
                          : 'bg-emerald-50 text-emerald-600'
                    }`}>
                      {order.status === 'voided' ? 'Voided' : order._pending_sync ? 'Syncing' : 'Done'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {canVoid(order) && (
                        <button onClick={() => setVoidModal(order)} title="Void Order"
                          className="min-h-10 min-w-10 rounded-md p-1.5 text-red-500 hover:bg-red-50 hover:text-red-600 transition-colors">
                          <XCircle className="h-4 w-4" />
                        </button>
                      )}
                      {canReturn(order) && (
                        <button onClick={() => setReturnModal(order)} title="Partial Return"
                          className="min-h-10 min-w-10 rounded-md p-1.5 text-amber-500 hover:bg-amber-50 hover:text-amber-600 transition-colors">
                          <RotateCcw className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {voidModal && (
        <PINModal
          title={`Void Order ${String(voidModal.id).slice(0, 8)}`}
          onClose={() => setVoidModal(null)}
          onConfirm={handleVoidConfirm}
          submitting={submitting}
        />
      )}
      {returnModal && (
        <ReturnModal
          order={returnModal}
          onClose={() => setReturnModal(null)}
          onConfirm={handleReturnConfirm}
          submitting={submitting}
        />
      )}
    </div>
  );
}
