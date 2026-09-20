import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErrorNotice } from '../shared/ErrorNotice';
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
import { unpackTransport } from '../../transportUnpack';
import { canAccessCapability } from '../../../../shared/accessControl';
import { isBarOnlyMode } from '../../../../shared/propertyTypes';
import { BAR_PRODUCT_CATEGORIES } from '../../../../shared/barModeProfile';
import { summarizeWasteMovements } from '../../../../shared/wasteSummary';
import { calculatePosFinancialTruth, classifyPosTransaction, hasRecordedPosTenderEnvelope, posTenderRows } from '../../../../shared/posFinancialTruth';

const dateKeyInTimeZone = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timeZone || 'Africa/Gaborone', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const money = (value, currency) =>
  `${currency} ${Number(value || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hasRecordedMoney = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const orderDate = (order) =>
  String(order.business_date || order.created_at || order.order_date || '').slice(0, 10);
const orderLabel = (order) => order.order_number ? `Order #${order.order_number}` : `Legacy order ${String(order.id).slice(0, 8)}`;
const receiptLabel = (order) => order.receipt_number || orderLabel(order);
const transactionLabel = (order) => String(order.transaction_type || 'sale').replaceAll('_', ' ');
const statusTone = (order) => {
  const state = classifyPosTransaction(order);
  if (state === 'pending') return 'pending';
  if (state === 'void' || state === 'cancelled') return 'voided';
  if (state === 'sale' || state === 'return') return 'completed';
  return 'neutral';
};
const statusLabel = (order) => {
  const state = classifyPosTransaction(order);
  return state === 'sale' ? 'Completed sale' : state === 'return' ? 'Return' : state === 'void' ? 'Voided' : state === 'cancelled' ? 'Cancelled' : state === 'pending' ? 'Pending sync' : 'Needs review';
};
const tenderLabel = (order) => {
  if (!hasRecordedPosTenderEnvelope(order)) return 'Tender unavailable';
  const methods = [...new Set(posTenderRows(order).map((tender) => tender.method).filter(Boolean))];
  return methods.length > 1 ? 'Split tender' : methods[0] || 'Tender unavailable';
};

export default function HposReports({ correctionMode = false, sharedTillHistoryMode = false }) {
  const { settings } = useSettings();
  const { user } = useAuth();
  const access = useAccess();
  const currency = settings?.currency || 'P';
  const businessTimeZone = settings?.timezone || 'Africa/Gaborone';
  const barOnly = isBarOnlyMode(settings);
  const canRequestVoid = canAccessCapability(access, 'pos.view');
  const canExport = canAccessCapability(access, 'reports.export');
  const canViewWaste = canAccessCapability(access, 'inventory.view');
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
  const [readCompleteness, setReadCompleteness] = useState({ source: 'unknown', complete: false });
  const [serverControls, setServerControls] = useState(null);
  const [voidTemplates, setVoidTemplates] = useState([]);
  // Waste summary (Bar base, quantities only): recent stock-waste movements
  // for the selected period. Costed waste and margin stay in Pro.
  const [waste, setWaste] = useState({ rows: [], source: 'unknown', complete: false });
  // Slow movers (Bar base, quantities only): stocked items with no sale in
  // the last 14 days. Descriptive only — no reorder advice, no costs.
  const [slowStock, setSlowStock] = useState({ items: [], aging: [], itemsComplete: false, agingOk: false });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    if (sharedTillHistoryMode) {
      setServerControls(null);
      try {
        const cached = await window.api?.pos?.getSharedTillHistory?.(start, end, { refresh: false });
        setOrders(cached?.orders || []);
        setReadCompleteness({ source: cached?.source || 'local_cache', complete: cached?.complete === true, tenderComplete: cached?.tender_complete === true, itemDetailComplete: cached?.item_detail_complete === true });
        setVoidHistory([]);
        setHistorySource(cached?.source === 'local_cache' ? 'Showing this terminal’s saved history. Checking for updates…' : 'Loading PIN-verified sales…');
        setLoading(false);
        const refreshed = await window.api?.pos?.getSharedTillHistory?.(start, end, { refresh: true });
        setOrders(refreshed?.orders || []);
        setReadCompleteness({ source: refreshed?.source || 'server', complete: refreshed?.complete === true, tenderComplete: refreshed?.tender_complete === true, itemDetailComplete: refreshed?.item_detail_complete === true });
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
      setServerControls(null);
      const [history, loadedVoids] = await Promise.all([
        correctionMode
          ? window.api?.pos?.getMyOrders?.(start, end)
          : window.api?.pos?.getCertifiedReportHistory?.(start, end),
        // A waiter correction screen must never expose the outlet-wide void audit.
        correctionMode ? Promise.resolve([]) : window.api?.pos?.getVoidHistory?.(start, end),
      ]);
      const loadedOrders = correctionMode ? unpackTransport(history) : unpackTransport(history?.orders);
      setOrders(loadedOrders || []);
      setReadCompleteness(correctionMode
        ? { source: loadedOrders?._source || 'unknown', complete: loadedOrders?._complete === true, tenderComplete: loadedOrders?._tender_complete === true, itemDetailComplete: loadedOrders?._item_detail_complete === true }
        : { source: history?.source || 'unknown', complete: history?.complete === true, tenderComplete: history?.tender_complete === true, itemDetailComplete: history?.item_detail_complete === true });
      if (!correctionMode && history?.complete === true && history?.source === 'server' && history?.control_totals) {
        setServerControls(history.control_totals);
      }
      if (!correctionMode && history?.success === false && history?.error) setNotice(history.error);
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
  useEffect(() => {
    if (!barOnly || correctionMode || sharedTillHistoryMode) return;
    window.api?.pos?.getVoidReasonTemplates?.().then((result) => {
      if (Array.isArray(result)) setVoidTemplates(result);
    }).catch(() => {});
  }, [barOnly, correctionMode, sharedTillHistoryMode]);
  useEffect(() => {
    if (!barOnly || correctionMode || sharedTillHistoryMode || !canViewWaste) {
      setWaste({ rows: [], source: 'unknown', complete: false });
      return;
    }
    let active = true;
    window.api?.inventory?.getMovementsWithReadStatus?.({ start_date: start, end_date: end, limit: 500 })
      .then((result) => {
        if (!active) return;
        setWaste({
          rows: Array.isArray(result?.rows) ? result.rows : [],
          source: result?.source || 'unknown',
          complete: result?.complete === true,
        });
      })
      .catch(() => {
        if (active) setWaste({ rows: [], source: 'unavailable', complete: false });
      });
    return () => {
      active = false;
    };
  }, [barOnly, correctionMode, sharedTillHistoryMode, canViewWaste, start, end]);
  useEffect(() => {
    if (!barOnly || correctionMode || sharedTillHistoryMode || !canViewWaste) {
      setSlowStock({ items: [], aging: [], itemsComplete: false, agingOk: false });
      return;
    }
    let active = true;
    Promise.all([
      window.api?.inventory?.getItemsWithReadStatus?.(),
      window.api?.inventory?.getBarStockAging?.(null),
    ])
      .then(([itemsResult, agingResult]) => {
        if (!active) return;
        setSlowStock({
          items: unpackTransport(itemsResult?.items) || [],
          aging: Array.isArray(agingResult) ? agingResult : [],
          itemsComplete: itemsResult?.complete === true,
          agingOk: true,
        });
      })
      .catch(() => {
        if (active) setSlowStock({ items: [], aging: [], itemsComplete: false, agingOk: false });
      });
    return () => {
      active = false;
    };
  }, [barOnly, correctionMode, sharedTillHistoryMode, canViewWaste]);

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
      const classification = classifyPosTransaction(order);
      const status = classification === 'void' ? 'voided' : classification === 'failed/manual review' ? 'failed' : classification;
      const statusMatches = statusFilter === 'all' || status === statusFilter || (statusFilter === 'attention' && ['pending', 'failed', 'voided', 'cancelled'].includes(status));
      const textMatches = !term || `${order.receipt_number || ''} ${order.order_number || ''} ${transactionLabel(order)} ${order.table_name || ''} ${order.service_mode || ''} ${order.payment_method || ''}`.toLowerCase().includes(term);
      return statusMatches && textMatches;
    });
  }, [query, rows, statusFilter]);
  const metrics = useMemo(() => {
    const truth = calculatePosFinancialTruth(rows, { dataset_complete: readCompleteness.complete });
    const completed = truth.rows.filter((o) => o.classification === 'sale');
    // For the normal report workspace the server report run, not renderer
    // aggregation, is the source of financial controls. The local calculation
    // remains only for classifications and correction-mode views.
    const controls = !correctionMode && serverControls
      ? { ...truth.controls, ...serverControls, dataset_complete: true, dataset_status: 'certified' }
      : truth.controls;
    const sales = controls.net_recorded_sales;
    const discounts = controls.discounts;
    const attention = rows.filter(
      (o) =>
        o._sync_state === 'failed' ||
        o._pending_sync ||
        ['voided', 'cancelled'].includes(String(o.status || '').toLowerCase()),
    ).length;
    const payment = controls.tender_totals;
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
      average: controls.average_completed_sale,
      controls,
    };
  }, [correctionMode, readCompleteness.complete, rows, serverControls]);
  const financialReady = readCompleteness.complete
    && metrics.controls.dataset_complete === true
    && (correctionMode || serverControls !== null);
  const tenderReady = financialReady && readCompleteness.tenderComplete === true && rows.filter((order) => ['sale', 'return'].includes(classifyPosTransaction(order))).every(hasRecordedPosTenderEnvelope);
  const itemDetailReady = financialReady && readCompleteness.itemDetailComplete === true;
  const basicBarBreakdown = useMemo(() => {
    if (!barOnly || !itemDetailReady) return { categories: [], products: [], poolTables: [], poolTotal: 0 };
    const categoryTotals = new Map();
    const productTotals = new Map();
    rows.filter((order) => classifyPosTransaction(order) === 'sale').forEach((order) => {
      (Array.isArray(order.pos_order_items) ? order.pos_order_items : []).forEach((item) => {
        const quantity = Number(item.quantity || 0);
        const amount = Number(item.net_subtotal ?? item.subtotal ?? item.gross_subtotal);
        if (!Number.isFinite(quantity) || !Number.isFinite(amount)) return;
        const rawCategory = String(item.category || item.menu_category || '').trim();
        const category = BAR_PRODUCT_CATEGORIES.find((value) => value.toLowerCase() === rawCategory.toLowerCase()) || 'Other';
        const name = String(item.item_name || item.name || 'Unnamed product').trim() || 'Unnamed product';
        const currentCategory = categoryTotals.get(category) || { quantity: 0, amount: 0 };
        categoryTotals.set(category, { quantity: currentCategory.quantity + quantity, amount: currentCategory.amount + amount });
        const productId = String(item.product_id || item.menu_item_id || item.item_id || item.id || `custom:${name.toLowerCase()}`);
        const currentProduct = productTotals.get(productId) || { label: name, category, quantity: 0, amount: 0 };
        productTotals.set(productId, { label: currentProduct.label, category, quantity: currentProduct.quantity + quantity, amount: currentProduct.amount + amount });
      });
    });
    const products = [...productTotals.values()].sort((a, b) => b.quantity - a.quantity || b.amount - a.amount);
    const poolTables = products
      .filter((row) => String(row.category || '').trim().toLowerCase() === 'pool')
      .sort((a, b) => b.amount - a.amount);
    const poolTotal = poolTables.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    return {
      categories: [...categoryTotals.entries()].map(([label, value]) => ({ label, ...value })).sort((a, b) => b.amount - a.amount),
      products: products.slice(0, 8),
      poolTables,
      poolTotal,
    };
  }, [barOnly, itemDetailReady, rows]);

  // Quantities only: costed waste, valuation and margin stay Pro-exclusive,
  // so money never appears here. Shared with the POS history exports.
  const wasteBreakdown = useMemo(() => {
    if (!barOnly || !canViewWaste || waste.source !== 'server' || waste.complete !== true) return null;
    return summarizeWasteMovements(waste.rows).items.slice(0, 8);
  }, [barOnly, canViewWaste, waste]);

  // Idle threshold for the slow-movers card: stocked items with no sale in
  // this window read as gathering dust. Fixed and labeled, never advice.
  const slowMovers = useMemo(() => {
    if (!barOnly || !canViewWaste || !slowStock.itemsComplete || !slowStock.agingOk) return null;
    const idleMs = 14 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const lastSoldByItem = new Map((slowStock.aging || []).map((row) => [String(row?.item_id || ''), row?.last_sold_at || null]));
    return (slowStock.items || [])
      .filter((item) => item?.is_active !== false && Number(item?.current_stock || 0) > 0)
      .map((item) => {
        const lastSoldAt = lastSoldByItem.get(String(item?.id || ''));
        const lastSoldTime = lastSoldAt ? new Date(lastSoldAt).getTime() : NaN;
        if (Number.isFinite(lastSoldTime) && now - lastSoldTime < idleMs) return null;
        if (!Number.isFinite(lastSoldTime)) {
          const createdTime = new Date(item?.created_at || 0).getTime();
          if (Number.isFinite(createdTime) && now - createdTime < idleMs) return null;
        }
        const idleDays = Number.isFinite(lastSoldTime) ? Math.floor((now - lastSoldTime) / (24 * 60 * 60 * 1000)) : null;
        return {
          label: String(item?.name || 'Inventory item'),
          unit: String(item?.unit || 'unit'),
          onHand: Number(item?.current_stock || 0),
          idleLabel: idleDays === null ? 'never sold' : `last sold ${idleDays} days ago`,
          idleRank: idleDays === null ? Number.MAX_SAFE_INTEGER : idleDays,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.idleRank - a.idleRank || b.onHand - a.onHand)
      .slice(0, 8);
  }, [barOnly, canViewWaste, slowStock]);

  const exportReport = async (format) => {
    setExporting(format);
    setNotice('');
    try {
      const device = String(format || '').startsWith('device-');
      const fn =
        format === 'pdf'
          ? window.api?.pos?.exportHistoryPdf
          : format === 'device-pdf'
            ? window.api?.pos?.exportDeviceRecordsPdf
            : format === 'device-excel'
              ? window.api?.pos?.exportDeviceRecordsExcel
              : window.api?.pos?.exportHistoryExcel;
      const result = await fn?.({ start, end });
      setNotice(
        result?.success
          ? `${device ? 'Unconfirmed device records' : format === 'pdf' ? 'PDF' : 'Excel workbook'} created${result.filePath ? `: ${result.filePath}` : '.'}${device ? ' Marked UNCONFIRMED — not server-certified.' : ''}`
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
    let breakdown = selectedOrder?.payment_breakdown;
    if (typeof breakdown === 'string') {
      try { breakdown = JSON.parse(breakdown); } catch { breakdown = null; }
    }
    if (Array.isArray(breakdown)) {
      return posTenderRows(selectedOrder)
        .filter((row) => Number(row?.amount || 0) !== 0)
        .map((row) => [row.method || 'Unspecified', Number(row.amount || 0), row.reference || null, row.tender_id]);
    }
    if (!breakdown || typeof breakdown !== 'object') return [];
    return Object.entries(breakdown).filter(([, value]) => Number(value || 0) !== 0).map(([method, value]) => [method, Number(value || 0), null, `${selectedOrder?.id || 'order'}:${method}`]);
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
              ? (financialReady ? 'Server-confirmed sales, tender, counter-versus-tab, discount, and exception detail for your selected period.' : 'Review sales and exceptions for your selected period. Financial totals remain provisional until the server confirms the complete source.')
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
          {!correctionMode && !sharedTillHistoryMode && canExport && <button onClick={() => exportReport('excel')} disabled={!!exporting || !readCompleteness.complete} title={!readCompleteness.complete ? 'Reconnect and refresh before exporting complete financial history.' : undefined}>
            <FileSpreadsheet size={16} />
            {exporting === 'excel' ? 'Building…' : 'Excel'}
          </button>}
          {!correctionMode && !sharedTillHistoryMode && canExport && <button onClick={() => exportReport('pdf')} disabled={!!exporting || !readCompleteness.complete} title={!readCompleteness.complete ? 'Reconnect and refresh before exporting complete financial history.' : undefined}>
            <Download size={16} />
            {exporting === 'pdf' ? 'Building…' : 'PDF'}
          </button>}
          {!correctionMode && !sharedTillHistoryMode && canExport && <button onClick={() => exportReport('device-excel')} disabled={!!exporting || !visibleRows.length} title="Export this terminal's saved records, marked UNCONFIRMED. Works offline.">
            <FileSpreadsheet size={16} />
            {exporting === 'device-excel' ? 'Building…' : 'Device Excel'}
          </button>}
          {!correctionMode && !sharedTillHistoryMode && canExport && <button onClick={() => exportReport('device-pdf')} disabled={!!exporting || !visibleRows.length} title="Export this terminal's saved records, marked UNCONFIRMED. Works offline.">
            <Download size={16} />
            {exporting === 'device-pdf' ? 'Building…' : 'Device PDF'}
          </button>}
          <button type="button" onClick={load} disabled={loading} title="Refresh report">
            <RefreshCw size={16} className={loading ? 'is-spinning' : ''} />
            Refresh
          </button>
        </div>
      </header>
      {error && <ErrorNotice className="hpos-inline-error">{error}</ErrorNotice>}
      {notice && (
        <div className="hpos-inline-notice" role="status">
          {notice}
        </div>
      )}
      {sharedTillHistoryMode && <div className="hpos-inline-notice" role="status">{historySource || 'Loading your PIN-verified Till history…'}</div>}
      {!correctionMode && !sharedTillHistoryMode && !readCompleteness.complete && <div className="hpos-inline-notice" role="status">This transaction view is provisional ({readCompleteness.source || 'source unavailable'}). Refresh online before treating totals or exports as complete.</div>}
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
            <strong>{loading ? '—' : financialReady ? value : 'Unavailable'}</strong>
          </div>
        ))}
      </div>}
      {!correctionMode && !sharedTillHistoryMode && <div className="hpos-report-grid">
        <section className="hpos-insight-card">
          <h2>Payment mix</h2>
          {tenderReady ? Object.entries(metrics.payment)
            .sort((a, b) => b[1] - a[1])
            .map(([label, value]) => (
              <div className="hpos-insight-row" key={label}>
                <span>{label}</span>
                <strong>{money(value, currency)}</strong>
              </div>
            )) : <p>Unavailable until the server confirms a complete POS source.</p>}
          {tenderReady && !loading && !Object.keys(metrics.payment).length && (
            <p>No posted payments in this period.</p>
          )}
          {!tenderReady && <p>Tender allocation is unavailable until the server confirms complete recorded payment envelopes.</p>}
        </section>
        <section className="hpos-insight-card">
          <h2>{barOnly ? 'Counter & tab mix' : 'Service mix'}</h2>
          {financialReady && Object.entries(metrics.service)
            .sort((a, b) => b[1] - a[1])
            .map(([label, value]) => (
              <div className="hpos-insight-row" key={label}>
                <span>{label.replaceAll('_', ' ')}</span>
                <strong>{value} orders</strong>
              </div>
            ))}
          {financialReady && <div className="hpos-insight-row">
            <span>Recorded discounts</span>
            <strong>{financialReady ? money(metrics.discounts, currency) : 'Unavailable'}</strong>
          </div>}
          {!financialReady && <p>Service mix and discounts are unavailable until the server confirms a complete POS source.</p>}
        </section>
      </div>}
      {barOnly && !correctionMode && !sharedTillHistoryMode && <div className="hpos-report-grid hpos-bar-basic-report-grid">
        <section className="hpos-insight-card"><h2>Bar sales by category</h2>{!itemDetailReady ? <p>Unavailable until the server certifies complete item detail.</p> : basicBarBreakdown.categories.length ? basicBarBreakdown.categories.map((row) => <div className="hpos-insight-row" key={row.label}><span>{row.label}</span><strong>{row.quantity} units · {money(row.amount, currency)}</strong></div>) : <p>No certified item sales in this period.</p>}</section>
        <section className="hpos-insight-card" aria-label="Pool tables"><h2>Pool tables</h2>{!itemDetailReady ? <p>Unavailable until the server certifies complete item detail.</p> : basicBarBreakdown.poolTables.length ? (<>{basicBarBreakdown.poolTables.map((row) => <div className="hpos-insight-row" key={row.label}><span>{row.label}</span><strong>{money(row.amount, currency)} collected</strong></div>)}<div className="hpos-insight-row"><span>All pool tables</span><strong>{money(basicBarBreakdown.poolTotal, currency)}</strong></div><p>Each table is entered once per day: quantity means pula.</p></>) : <p>No pool cash in this period. Add Pool Table 1 in Products, price P1, then type each table box cash as quantity at night.</p>}</section>
        <section className="hpos-insight-card"><h2>Top products</h2>{!itemDetailReady ? <p>Unavailable until the server certifies complete item detail.</p> : basicBarBreakdown.products.length ? basicBarBreakdown.products.map((row) => <div className="hpos-insight-row" key={row.label}><span>{row.label}</span><strong>{row.quantity} units · {money(row.amount, currency)}</strong></div>) : <p>No certified item sales in this period.</p>}</section>
        <section className="hpos-insight-card"><h2>Waste</h2>{!canViewWaste ? <p>Waste needs the stock permission.</p> : !wasteBreakdown ? <p>Unavailable until the server confirms the complete movement ledger.</p> : wasteBreakdown.length ? wasteBreakdown.map((row) => <div className="hpos-insight-row" key={row.label}><span>{row.label} · {row.topReason}</span><strong>{row.quantity} {row.unit}</strong></div>) : <p>No recorded waste in this period.</p>}{canViewWaste && wasteBreakdown && wasteBreakdown.length > 0 && <p>Quantities only; no cost values.</p>}</section>
        <section className="hpos-insight-card"><h2>Slow movers</h2>{!canViewWaste ? <p>Slow movers need the stock permission.</p> : !slowMovers ? <p>Unavailable until the server confirms complete stock and aging reads.</p> : slowMovers.length ? slowMovers.map((row) => <div className="hpos-insight-row" key={row.label}><span>{row.label}</span><strong>{row.onHand} {row.unit} · {row.idleLabel}</strong></div>) : <p>Nothing idle: every stocked item sold in the last 14 days.</p>}{canViewWaste && slowMovers && slowMovers.length > 0 && <p>No sale in the last 14 days. Quantities only.</p>}</section>
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
        {visibleRows.map((order) => (
          <button key={order.id} type="button" className="hpos-report-ledger-row hpos-report-ledger-row--typed" onClick={() => { setSelectedOrder(order); setVoidError(''); }} aria-label={`Open receipt ${receiptLabel(order)}`}>
            <strong>
              {receiptLabel(order)}
            </strong>
            <span>{orderDate(order) || '—'}</span>
            <span>{transactionLabel(order)}</span>
            <span>{order.table_name || order.service_mode || 'Counter'}</span>
            <span>{tenderReady ? (posTenderRows(order).map((tender) => `${tender.method}: ${money(tender.amount, currency)}`).join(' · ') || 'Tender unavailable') : 'Unavailable'}</span>
            <span className={`hpos-transaction-status is-${statusTone(order)}`}>
              {statusLabel(order)}
            </span>
            <strong>{financialReady && hasRecordedMoney(order.total ?? order.total_amount) ? money(order.total ?? order.total_amount, currency) : 'Unavailable'}</strong>
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
              <div className="hpos-money-kpi"><small>Tender</small><strong>{tenderLabel(selectedOrder)}</strong></div>
               <div className="hpos-money-kpi"><small>Recorded total</small><strong>{financialReady && hasRecordedMoney(selectedOrder.total ?? selectedOrder.total_amount) ? money(selectedOrder.total ?? selectedOrder.total_amount, currency) : 'Unavailable'}</strong></div>
              <div className="hpos-money-kpi"><small>Status</small><strong>{selectedOrder._pending_sync ? 'Pending sync' : selectedOrder.status || 'Completed'}</strong></div>
            </div>
            <div className="hpos-report-detail-grid">
              <div><h3>Receipt detail</h3><p>Business date: {orderDate(selectedOrder) || '—'} · Created: {selectedOrder.created_at ? new Date(selectedOrder.created_at).toLocaleString() : '—'}</p><p>{selectedOrder.table_name || selectedOrder.service_mode || 'Counter'} · Outlet {selectedOrder.outlet_id || '—'} · Shift {selectedOrder.shift_id || '—'}</p><p>{selectedOrder.waiter_name || selectedOrder.cashier_name || 'Operator not recorded'} · Sync {selectedOrder._sync_state || 'synced'}</p><p>{selectedOrder.notes || 'No receipt note.'}</p></div>
               <div><h3>Payment information</h3>{tenderReady && selectedPaymentBreakdown.length ? selectedPaymentBreakdown.map(([method, value, reference], index) => <p key={`${method}-${index}`}>{method}: <strong>{hasRecordedMoney(value) ? money(value, currency) : 'Unavailable'}</strong>{reference && <small className="ml-2 text-slate-500">Ref {reference}</small>}</p>) : <p>Tender allocation is unavailable until the server confirms a complete recorded payment envelope.</p>}</div>
            </div>
             <div className="hpos-report-detail-items"><h3>Items</h3>{itemDetailReady && (selectedOrder.pos_order_items || []).length ? selectedOrder.pos_order_items.map((item) => { const lineAmount = item.net_subtotal ?? item.subtotal ?? item.gross_subtotal; return <p key={item.id || `${item.item_name}-${item.quantity}`}>{item.quantity} × {item.item_name} <strong>{hasRecordedMoney(lineAmount) ? money(lineAmount, currency) : 'Unavailable'}</strong></p> }) : <p>Item detail is unavailable until the server confirms recorded line amounts.</p>}</div>
            {selectedVoid && <div className="hpos-inline-notice"><CheckCircle2 size={17} /> <span><strong>Void audit reference</strong><br />{selectedVoid.reason} · approved by {selectedVoid.approver_name || 'authorised PIN holder'} · {new Date(selectedVoid.created_at).toLocaleString()}</span></div>}
            {!sharedTillHistoryMode && !selectedVoid && ['sale', 'pending'].includes(classifyPosTransaction(selectedOrder)) && canRequestVoid && (
              <form onSubmit={submitVoid} className="hpos-report-void-form">
                <h3><LockKeyhole size={18} /> {correctionMode ? 'Request supervisor correction' : 'Void this sale'}</h3>
                <p>{correctionMode ? 'You can request a correction for your own sale. A supervisor, manager or admin must enter their PIN; you cannot approve it yourself.' : 'This is irreversible. An authorised supervisor, manager, or admin must supply their PIN.'} Packaged stock is restored only when returned unopened. Food, cocktails and recipe items remain consumed.{classifyPosTransaction(selectedOrder) === 'pending' ? ' This sale has not synced yet: the correction queues behind it and applies on the server in order.' : ''}</p>
                {voidError && <ErrorNotice className="hpos-inline-error">{voidError}</ErrorNotice>}
                <label>Authorised approver PIN<input type="password" inputMode="numeric" value={voidPin} onChange={(event) => setVoidPin(event.target.value.replace(/\D/g, '').slice(0, 6))} maxLength="6" disabled={voiding} required /></label>
                {barOnly && voidTemplates.length > 0 && <label>Reason template<select value="" onChange={(event) => { const template = voidTemplates.find((row) => row.code === event.target.value); if (template) setVoidReason(`${template.label}: `); }} disabled={voiding}><option value="">Choose a starting point…</option>{voidTemplates.map((template) => <option key={template.id || template.code} value={template.code}>{template.label}</option>)}</select></label>}
                <label>Reason and detail<input value={voidReason} onChange={(event) => setVoidReason(event.target.value)} maxLength="200" placeholder="Choose a template, then explain what happened" disabled={voiding} required /></label>
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
