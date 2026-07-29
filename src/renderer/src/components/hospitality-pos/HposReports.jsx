import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  LockKeyhole,
  ReceiptText,
  RefreshCw,
  Search,
  TrendingUp,
  X,
} from 'lucide-react';
import { useAccess, useAuth, useSettings } from '../../app-context';
import { canAccessCapability } from '../../../../shared/accessControl';
import { isBarOnlyMode } from '../../../../shared/propertyTypes';

const dateKeyInTimeZone = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timeZone || 'Africa/Gaborone', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const money = (value, currency) =>
  `${currency} ${Number(value || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const orderDate = (order) =>
  String(order.business_date || order.created_at || order.order_date || '').slice(0, 10);
const orderLabel = (order) => order.order_number ? `Order #${order.order_number}` : `Legacy order ${String(order.id).slice(0, 8)}`;
const receiptLabel = (order) => order.receipt_number || orderLabel(order);
const transactionLabel = (order) => String(order.transaction_type || 'sale').replaceAll('_', ' ');
const statusTone = (order) => {
  if (order?._pending_sync) return 'pending';
  const status = String(order?.status || 'completed').toLowerCase();
  if (status === 'voided' || status === 'cancelled') return 'voided';
  if (status === 'completed' || status === 'settled') return 'completed';
  return 'neutral';
};

export default function HposReports({ correctionMode = false, sharedTillHistoryMode = false }) {
  const { settings } = useSettings();
  const { user } = useAuth();
  const access = useAccess();
  const currency = settings?.currency || 'P';
  const businessTimeZone = settings?.timezone || 'Africa/Gaborone';
  const barOnly = isBarOnlyMode(settings);
  const canRequestVoid = canAccessCapability(access, 'pos.view');
  const now = new Date();
  const [start, setStart] = useState(
    sharedTillHistoryMode
      ? dateKeyInTimeZone(now, businessTimeZone)
      : dateKeyInTimeZone(new Date(now.getFullYear(), now.getMonth(), 1), businessTimeZone),
  );
  const [end, setEnd] = useState(dateKeyInTimeZone(now, businessTimeZone));
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [voidHistory, setVoidHistory] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [voidPin, setVoidPin] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const [directStockDisposition, setDirectStockDisposition] = useState('return_to_stock');
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState('');
  const [historySource, setHistorySource] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    if (sharedTillHistoryMode) {
      try {
        const cached = await window.api?.pos?.getSharedTillHistory?.(start, end, { refresh: false });
        setOrders(cached?.orders || []);
        setVoidHistory([]);
        setHistorySource(cached?.source === 'local_cache' ? 'Showing this terminal’s saved history. Checking for updates…' : 'Loading PIN-verified sales…');
        setLoading(false);
        const refreshed = await window.api?.pos?.getSharedTillHistory?.(start, end, { refresh: true });
        setOrders(refreshed?.orders || []);
        setHistorySource(refreshed?.refreshed ? 'Updated from the server.' : 'Showing this terminal’s saved history while offline.');
      } catch (loadError) {
        setOrders([]);
        setVoidHistory([]);
        setError(loadError?.message || 'Unlock Till with your Staff PIN to view your sales history.');
      } finally {
        setLoading(false);
      }
      return;
    }
    try {
      const [loadedOrders, loadedVoids] = await Promise.all([
        correctionMode ? window.api?.pos?.getMyOrders?.(start, end) : window.api?.pos?.getOrders?.(start, end),
        // A waiter correction screen must never expose the outlet-wide void audit.
        correctionMode ? Promise.resolve([]) : window.api?.pos?.getVoidHistory?.(start, end),
      ]);
      setOrders(loadedOrders || []);
      setVoidHistory(loadedVoids || []);
    } catch (loadError) {
      setOrders([]);
      setVoidHistory([]);
      setError(loadError?.message || 'Sales detail could not be loaded for this period.');
    } finally {
      setLoading(false);
    }
  }, [correctionMode, sharedTillHistoryMode, start, end]);
  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(
    () =>
      orders.filter(
        (order) =>
          (!start || orderDate(order) >= start) &&
          (!end || orderDate(order) <= end),
      ),
    [orders, start, end],
  );
  const visibleRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.filter((order) => {
      const status = String(order.status || 'completed').toLowerCase();
      const statusMatches = statusFilter === 'all' || status === statusFilter || (statusFilter === 'attention' && (order._pending_sync || order._sync_state === 'failed' || ['voided', 'cancelled'].includes(status)));
      const textMatches = !term || `${order.receipt_number || ''} ${order.order_number || ''} ${transactionLabel(order)} ${order.table_name || ''} ${order.service_mode || ''} ${order.payment_method || ''}`.toLowerCase().includes(term);
      return statusMatches && textMatches;
    });
  }, [query, rows, statusFilter]);
  const metrics = useMemo(() => {
    const completed = rows.filter(
      (o) =>
        !['voided', 'cancelled'].includes(String(o.status || '').toLowerCase()),
    );
    const sales = completed.reduce(
      (sum, o) => sum + Number(o.total || o.total_amount || 0),
      0,
    );
    const discounts = completed.reduce(
      (sum, o) => sum + Number(o.discount_amount || o.discount || 0),
      0,
    );
    const attention = rows.filter(
      (o) =>
        o._sync_state === 'failed' ||
        o._pending_sync ||
        ['voided', 'cancelled'].includes(String(o.status || '').toLowerCase()),
    ).length;
    const payment = completed.reduce((acc, o) => {
      const key = o.payment_method || 'Unspecified';
      acc[key] = (acc[key] || 0) + Number(o.total || o.total_amount || 0);
      return acc;
    }, {});
    const service = completed.reduce((acc, o) => {
      const key = o.service_mode || 'counter';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return {
      completed,
      sales,
      discounts,
      attention,
      payment,
      service,
      average: completed.length ? sales / completed.length : 0,
    };
  }, [rows]);

  const exportReport = async (format) => {
    setExporting(format);
    setNotice('');
    try {
      const fn =
        format === 'pdf'
          ? window.api?.pos?.exportHistoryPdf
          : window.api?.pos?.exportHistoryExcel;
      const result = await fn?.({ start, end });
      setNotice(
        result?.success
          ? `${format === 'pdf' ? 'PDF' : 'Excel workbook'} created${result.filePath ? `: ${result.filePath}` : '.'}`
          : result?.error || 'Export was cancelled.',
      );
    } catch (error) {
      setNotice(error.message || 'Could not export this report.');
    } finally {
      setExporting('');
    }
  };

  const selectedVoid = useMemo(
    () => voidHistory.find((entry) => entry.order_id === selectedOrder?.id),
    [selectedOrder?.id, voidHistory],
  );
  const selectedPaymentBreakdown = useMemo(() => {
    const breakdown = selectedOrder?.payment_breakdown;
    if (!breakdown || typeof breakdown !== 'object' || Array.isArray(breakdown)) return [];
    return Object.entries(breakdown).filter(([, value]) => Number(value || 0) !== 0);
  }, [selectedOrder]);
  const closeDetail = (force = false) => {
    if (voiding && !force) return;
    setSelectedOrder(null);
    setVoidPin('');
    setVoidReason('');
    setDirectStockDisposition('return_to_stock');
    setVoidError('');
  };
  const submitVoid = async (event) => {
    event.preventDefault();
    if (!selectedOrder?.id || !voidPin.trim() || !voidReason.trim()) {
      setVoidError('An authorised approver PIN and a reason are required.');
      return;
    }
    setVoiding(true);
    setVoidError('');
    try {
      const result = await window.api?.pos?.approveVoidWithPin?.({
        order_id: selectedOrder.id,
        pin: voidPin.trim(),
        reason: voidReason.trim(),
        direct_stock_disposition: directStockDisposition,
        cashier_user_id: user?.id || null,
        outlet_id: selectedOrder.outlet_id || null,
      });
      if (!result?.success) {
        setVoidError(result?.error || 'The sale could not be voided.');
        return;
      }
      setNotice(result?.offline ? 'Void approval is pending server confirmation.' : 'Sale voided. The receipt and stock history have been updated.');
      closeDetail(true);
      await load();
    } catch (submitError) {
      setVoidError(submitError?.message || 'The sale could not be voided.');
    } finally {
      setVoiding(false);
    }
  };
  const selectedHasDirectStock = (selectedOrder?.pos_order_items || []).some((item) => item.inventory_item_id);

  return (
    <div
      className="hpos-money-page"
      style={{ maxWidth: 1380, margin: '0 auto' }}
    >
      <header className="hpos-money-hero hpos-report-hero">
        <div>
          <p className="hpos-eyebrow">Performance intelligence</p>
          <h1>
            {sharedTillHistoryMode ? 'My Till sales' : (correctionMode ? 'Request a sale correction' : (barOnly ? 'Bar sales & control report' : 'Sales & service report'))}
          </h1>
          <p>
            {sharedTillHistoryMode
              ? 'Only the Staff PIN holder’s sales appear here. Saved terminal history appears first, then refreshes from the server when connected.'
              : correctionMode
              ? 'Only your own Till sales appear here. A supervisor, manager or admin must confirm the final action with their PIN.'
              : (barOnly
              ? 'Decision-ready sales, tender, counter-versus-tab, discount, and exception detail for your selected period.'
              : 'Decision-ready sales, tender, service-mode, and exception detail for your selected period.')}
          </p>
        </div>
        <div className="hpos-report-actions">
          <label>
            From
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          {!correctionMode && !sharedTillHistoryMode && <button onClick={() => exportReport('excel')} disabled={!!exporting}>
            <FileSpreadsheet size={16} />
            {exporting === 'excel' ? 'Building…' : 'Excel'}
          </button>}
          {!correctionMode && !sharedTillHistoryMode && <button onClick={() => exportReport('pdf')} disabled={!!exporting}>
            <Download size={16} />
            {exporting === 'pdf' ? 'Building…' : 'PDF'}
          </button>}
          <button type="button" onClick={load} disabled={loading} title="Refresh report">
            <RefreshCw size={16} className={loading ? 'is-spinning' : ''} />
            Refresh
          </button>
        </div>
      </header>
      {error && <div className="hpos-inline-error" role="alert">{error}</div>}
      {notice && (
        <div className="hpos-inline-notice" role="status">
          {notice}
        </div>
      )}
      {sharedTillHistoryMode && <div className="hpos-inline-notice" role="status">{historySource || 'Loading your PIN-verified Till history…'}</div>}
      {!correctionMode && !sharedTillHistoryMode && <div className="hpos-money-kpis">
        {[
          [
            'Net recorded sales',
            money(metrics.sales, currency),
            TrendingUp,
            '#c95635',
          ],
          [
            'Completed orders',
            metrics.completed.length,
            ReceiptText,
            '#7256a8',
          ],
          [
            'Average bill',
            money(metrics.average, currency),
            BarChart3,
            '#d49a3a',
          ],
          [
            'Exceptions',
            metrics.attention,
            AlertTriangle,
            metrics.attention ? '#b84a38' : '#477b68',
          ],
        ].map(([label, value, Icon, color], i) => (
          <div
            key={label}
            className="hpos-money-kpi"
            style={{ '--hpos-kpi-tone': color, '--hpos-kpi-index': i }}
          >
            <span className="hpos-money-kpi-icon">
              <Icon size={18} />
            </span>
            <small>{label}</small>
            <strong>{loading ? '—' : value}</strong>
          </div>
        ))}
      </div>}
      {!correctionMode && !sharedTillHistoryMode && <div className="hpos-report-grid">
        <section className="hpos-insight-card">
          <h2>Payment mix</h2>
          {Object.entries(metrics.payment)
            .sort((a, b) => b[1] - a[1])
            .map(([label, value]) => (
              <div className="hpos-insight-row" key={label}>
                <span>{label}</span>
                <strong>{money(value, currency)}</strong>
              </div>
            ))}
          {!loading && !Object.keys(metrics.payment).length && (
            <p>No payments in this period.</p>
          )}
        </section>
        <section className="hpos-insight-card">
          <h2>{barOnly ? 'Counter & tab mix' : 'Service mix'}</h2>
          {Object.entries(metrics.service)
            .sort((a, b) => b[1] - a[1])
            .map(([label, value]) => (
              <div className="hpos-insight-row" key={label}>
                <span>{label.replaceAll('_', ' ')}</span>
                <strong>{value} orders</strong>
              </div>
            ))}
          <div className="hpos-insight-row">
            <span>Recorded discounts</span>
            <strong>{money(metrics.discounts, currency)}</strong>
          </div>
        </section>
      </div>}
      <section className="hpos-money-ledger">
        <div className="hpos-ledger-title">
          <div>
            <strong>Transaction detail</strong>
            <small>
              {visibleRows.length} shown · {rows.length} records · {start} to {end}
            </small>
          </div>
        </div>
        <div className="hpos-report-ledger-tools">
          <label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={barOnly ? 'Search receipt, tab, operator or tender' : 'Search receipt, table, service or tender'} /></label>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Transaction status"><option value="all">All statuses</option><option value="completed">Completed</option><option value="attention">Needs attention</option><option value="voided">Voided</option><option value="cancelled">Cancelled</option></select>
        </div>
        <div className="hpos-report-ledger-head" aria-hidden="true"><span>Receipt</span><span>Date</span><span>Type</span><span>Service</span><span>Tender</span><span>Status</span><span>Total</span></div>
        {visibleRows.slice(0, 100).map((order) => (
          <button key={order.id} type="button" className="hpos-report-ledger-row hpos-report-ledger-row--typed" onClick={() => { setSelectedOrder(order); setVoidError(''); }} aria-label={`Open receipt ${receiptLabel(order)}`}>
            <strong>
              {receiptLabel(order)}
            </strong>
            <span>{orderDate(order) || '—'}</span>
            <span>{transactionLabel(order)}</span>
            <span>{order.table_name || order.service_mode || 'Counter'}</span>
            <span>{order.payment_method || 'Unspecified'}</span>
            <span className={`hpos-transaction-status is-${statusTone(order)}`}>
              {order._pending_sync
                ? 'Pending sync'
                : order.status || 'Completed'}
            </span>
            <strong>
              {money(order.total || order.total_amount, currency)}
            </strong>
          </button>
        ))}
        {!loading && visibleRows.length === 0 && (
          <p className="hpos-ledger-empty">No orders match this period and filter.</p>
        )}
      </section>
      {selectedOrder && (
        <div className="hpos-modal-backdrop" role="presentation">
          <section className="hpos-service-dialog hpos-report-detail" role="dialog" aria-modal="true" aria-label="Receipt and reversal details">
          <div>
            <header>
              <div><p className="hpos-eyebrow">Receipt & audit trail</p><h2>{receiptLabel(selectedOrder)}</h2><p>{orderLabel(selectedOrder)} · {transactionLabel(selectedOrder)}</p></div>
              <button type="button" onClick={closeDetail} disabled={voiding} aria-label="Close receipt details"><X size={20} /></button>
            </header>
            <div className="hpos-money-kpis">
              <div className="hpos-money-kpi"><small>Tender</small><strong>{selectedOrder.payment_method || 'Unspecified'}</strong></div>
              <div className="hpos-money-kpi"><small>Recorded total</small><strong>{money(selectedOrder.total || selectedOrder.total_amount, currency)}</strong></div>
              <div className="hpos-money-kpi"><small>Status</small><strong>{selectedOrder._pending_sync ? 'Pending sync' : selectedOrder.status || 'Completed'}</strong></div>
            </div>
            <div className="hpos-report-detail-grid">
              <div><h3>Receipt detail</h3><p>{orderDate(selectedOrder) || '—'} · {selectedOrder.table_name || selectedOrder.service_mode || 'Counter'}</p><p>{selectedOrder.waiter_name || selectedOrder.cashier_name || 'Operator not recorded'}</p><p>{selectedOrder.notes || 'No receipt note.'}</p></div>
              <div><h3>Payment information</h3>{selectedPaymentBreakdown.length ? selectedPaymentBreakdown.map(([method, value]) => <p key={method}>{method}: <strong>{money(value, currency)}</strong></p>) : <p>{selectedOrder.payment_method || 'Unspecified'}: <strong>{money(selectedOrder.total || selectedOrder.total_amount, currency)}</strong></p>}</div>
            </div>
            <div className="hpos-report-detail-items"><h3>Items</h3>{(selectedOrder.pos_order_items || []).length ? selectedOrder.pos_order_items.map((item) => <p key={item.id || `${item.item_name}-${item.quantity}`}>{item.quantity} × {item.item_name} <strong>{money(item.subtotal, currency)}</strong></p>) : <p>Item detail is unavailable for this receipt.</p>}</div>
            {selectedVoid && <div className="hpos-inline-notice"><CheckCircle2 size={17} /> <span><strong>Void audit reference</strong><br />{selectedVoid.reason} · approved by {selectedVoid.approver_name || 'authorised PIN holder'} · {new Date(selectedVoid.created_at).toLocaleString()}</span></div>}
            {!sharedTillHistoryMode && !selectedVoid && !['voided', 'cancelled'].includes(String(selectedOrder.status || '').toLowerCase()) && canRequestVoid && (
              <form onSubmit={submitVoid} className="hpos-report-void-form">
                <h3><LockKeyhole size={18} /> {correctionMode ? 'Request supervisor correction' : 'Void this sale'}</h3>
                <p>{correctionMode ? 'You can request a correction for your own sale. A supervisor, manager or admin must enter their PIN; you cannot approve it yourself.' : 'This is irreversible. An authorised supervisor, manager, or admin must supply their PIN.'} Packaged stock is restored only when returned unopened. Food, cocktails and recipe items remain consumed.</p>
                {voidError && <div className="hpos-inline-error" role="alert">{voidError}</div>}
                <label>Authorised approver PIN<input type="password" inputMode="numeric" value={voidPin} onChange={(event) => setVoidPin(event.target.value.replace(/\D/g, '').slice(0, 6))} maxLength="6" disabled={voiding} required /></label>
                <label>Reason<input value={voidReason} onChange={(event) => setVoidReason(event.target.value)} maxLength="200" placeholder="Explain why this sale must be voided" disabled={voiding} required /></label>
                {selectedHasDirectStock && <label>Packaged stock outcome<select value={directStockDisposition} onChange={(event) => setDirectStockDisposition(event.target.value)} disabled={voiding}><option value="return_to_stock">Returned unopened — restore packaged stock</option><option value="consumed_or_damaged">Broken, opened or damaged — keep stock depleted</option></select><small>Food, cocktails and other recipe items always remain consumed when voided.</small></label>}
                <footer><button type="button" onClick={closeDetail} disabled={voiding}>Cancel</button><button type="submit" disabled={voiding}>{voiding ? 'Authorising…' : correctionMode ? 'Ask approver to confirm' : 'Authorise void'}</button></footer>
              </form>
            )}
            {!selectedVoid && String(selectedOrder.status || '').toLowerCase() === 'settled' && <div className="hpos-inline-notice">This receipt is settled. Use the protected return workflow in Till so the correct return tender and line items are recorded.</div>}
          </div>
          </section>
        </div>
      )}
    </div>
  );
}
