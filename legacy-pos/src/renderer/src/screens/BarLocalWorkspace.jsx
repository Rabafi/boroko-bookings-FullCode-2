import BarLocalDrawerHandover from '../../../../../src/renderer/src/components/hospitality-pos/BarLocalDrawerHandover.jsx';
import BarReplacementConnection from '../../../../../src/renderer/src/components/hospitality-pos/BarReplacementConnection.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { estimateBarCashSale, exceedsDiscountMaximum, formatBarLocalMoney, isDiscountApprovalRequired, validateBarPromotionSnapshot } from '../../../../../src/shared/barLocalCashEstimate.js';
import BarLocalDiscountPolicy from '../../../../../src/renderer/src/components/hospitality-pos/BarLocalDiscountPolicy.jsx';
import BarLocalModifierManager from '../../../../../src/renderer/src/components/hospitality-pos/BarLocalModifierManager.jsx';
import BarLocalStaffStatus from '../../../../../src/renderer/src/components/hospitality-pos/BarLocalStaffStatus.jsx';
import BarLocalAdminPanel from '../components/BarLocalAdminPanel';
import BarLocalOperationsPanel from '../components/BarLocalOperationsPanel';
import BarLocalTenderEditor from '../components/bar-local/BarLocalTenderEditor';
import { evaluateTenders, makeTenderRow, moneyToCents } from '../components/bar-local/tenderMath';
import { loadCompleteBarList } from '../../../../../src/shared/barLocalPagination.js';
import { barLocalOperatorError, barLocalReadinessMessage, canVoidRemainingBarSale, canReturnBarSaleLines, barReturnQuantityWithinRemaining, barSaleShiftIsClosed, canPostCloseCorrectBarSale, canPostCloseReturnBarSaleLines, barPostCloseCorrectionBlockedMessage } from '../../../../../src/shared/barLocalOperatorMessages.js';

/** Read-site shapes for the existing Legacy preload/service bridge. Query and
 * IPC data remain unvalidated unless a consumer below calls a validator. */
/** @typedef {{authority_id: string, business_id: string, outlet_id: string, mode?: string, configured?: boolean, restart_required?: boolean, blocked_reason?: {code?: string, message?: string} | null}} BarLocalAuthorityExpectedView */
/** @typedef {{ready: boolean, blockers: unknown[], checkedAt?: number, unavailableAt: number | null}} BarLocalReadinessView */
/** @typedef {{staff_id?: string, display_name: string, role: string, capabilities: string[], expiresAt?: number}} BarLocalStaffExpectedView */
/** @typedef {{shift_id: string, business_date?: string, opening_float?: string | number}} BarLocalShiftExpectedView */
/** @typedef {{operation_id: string, command: string, payload: unknown, state?: string, attempts?: number, recovered?: boolean}} BarLocalPendingOperationView */
/** @typedef {{operation_id: string, command: string, state: string, attempts: number, created_at?: string, updated_at?: string}} BarLocalOpenIntentExpectedView */
/** @typedef {{approval_threshold_percent: string, maximum_percent: string}} BarLocalDiscountPolicyReadView */
/** @typedef {{promotion_id: string, code: string, discount_type: 'percent' | 'amount', percent: string, amount: string, minimum_subtotal: string, scope: 'all' | 'product' | 'category', product_id?: string, category?: string}} BarLocalPromotionReadView */
/** @typedef {{option_id?: string, modifier_option_id?: string, name: string, price_delta: string | number}} BarLocalModifierOptionExpectedView */
/** @typedef {{modifier_group_id?: string, group_id?: string, name: string, required?: boolean, min_selections?: number, max_selections?: number, options?: BarLocalModifierOptionExpectedView[]}} BarLocalModifierGroupExpectedView */
/** @typedef {{product_id: string, sku: string, name: string, category?: string | null, price: string | number, tax_rate: string | number, track_stock?: boolean, product_active?: boolean, available?: boolean, modifier_groups?: BarLocalModifierGroupExpectedView[]}} BarLocalProductExpectedView */
/** @typedef {{product_id: string, sku: string, name: string, category?: string | null, price: string | number, tax_rate: string | number, track_stock: boolean, product_active: boolean, available: boolean, availability_version: number}} BarLocalMenuEditRowExpectedView */
/** @typedef {{customer_id: string, name: string, outstanding?: string | number, credit_limit?: string | number}} BarLocalCustomerExpectedView */
/** @typedef {{product_id: string, sku: string, name: string, quantity?: string | number, available_quantity?: string | number, reorder_level?: string | number, track_stock?: boolean}} BarLocalStockExpectedView */
/** @typedef {{movement_id: string, name: string, sku?: string, lot_code?: string | null, received_quantity: string | number, expires_on?: string | null, supplier_reference?: string | null, expiry_status: string}} BarLocalStockLotExpectedView */
/** @typedef {{lot_id: string, product_id: string, name: string, sku: string, lot_code?: string | null, received_quantity: string | number, allocated_quantity: string | number, remaining_quantity: string | number, expires_on?: string | null, expiry_status: string, source_kind: string, provenance: string}} BarLocalStockLotBalanceExpectedView */
/** @typedef {{cartId: string, product: BarLocalProductExpectedView, quantity: number, modifiers: string[]}} BarLocalCartLineView */
/** @typedef {{tab_id: string, status: string, version: number, gross_total: string | number, table_label?: string | null, owner_name: string, line_count: string | number}} BarLocalOpenTabExpectedView */
/** @typedef {{tab_line_id: string, status: string, name: string, quantity: string | number, line_total: string | number}} BarLocalTabLineExpectedView */
/** @typedef {BarLocalOpenTabExpectedView & {lines: BarLocalTabLineExpectedView[]}} BarLocalSelectedTabExpectedView */
/** @typedef {{sale_line_id: string, name: string, quantity: string | number, line_total: string | number, remaining_quantity: string | number, post_close_corrected_quantity?: string | number}} BarLocalSaleLineExpectedView */
/** @typedef {{kind: string, business_date: string, original_business_date?: string, correction_receipt_number: string | number, correction_sale_id?: string, total: string | number, reason: string, requested_by_name?: string, approved_by_name?: string}} BarLocalPostCloseCorrectionExpectedView */
/** @typedef {{sale_id: string, receipt_number: string | number, business_date: string, status: string, total: string | number, original_sale_id?: string | null, shift_status?: string, post_close_eligible?: boolean, post_close_tip_remaining?: string | number, post_close_corrections?: BarLocalPostCloseCorrectionExpectedView[], lines: BarLocalSaleLineExpectedView[]}} BarLocalSelectedSaleExpectedView */
/** @typedef {{sale_id: string, receipt_number: string | number, business_date: string, status: string, total: string | number, original_sale_id?: string | null}} BarLocalSaleListExpectedView */
/** @typedef {{cashup?: BarLocalCashupReviewExpectedView | null, shift_id: string, business_date: string, status: string, expected_cash: string | number, cash_sales: string | number, card_sales: string | number, cash_movements?: Array<{type: string, amount: string | number, reason: string, created_at: string}>}} BarLocalCashupSummaryExpectedView */
/** @typedef {{cashup_id: string, status: string, counted_cash: string | number, expected_cash: string | number, variance: string | number, counted_card?: string | number, notes?: string | null}} BarLocalCashupReviewExpectedView */
/** @typedef {{cashup_id: string, shift_id: string, business_date: string, cashup_status: string, counted_cash: string | number, expected_cash: string | number, cash_variance: string | number}} BarLocalCashupRowExpectedView */
/** @typedef {{period?: {from?: string, to?: string}, totals?: {gross_sales?: string | number, returns?: string | number, voids?: string | number, net_sales?: string | number, discounts?: string | number, tax?: string | number, tips?: string | number, sale_count?: string | number, average_sale?: string | number}, by_tender?: Array<{method: string, amount: string | number, entry_count?: string | number, entries?: string | number}>, tenders?: Array<{method: string, amount: string | number, entry_count?: string | number, entries?: string | number}>, by_day?: Array<{business_date: string, gross_sales: string | number, returns: string | number, net_sales: string | number, sale_count?: string | number}>, days?: Array<{business_date: string, gross_sales: string | number, returns: string | number, net_sales: string | number, sale_count?: string | number}>}} BarLocalSalesReportExpectedView */
/** @typedef {{period?: {from?: string, to?: string}, low_stock_threshold?: string | number, complete?: boolean, unavailable?: string[], valuation_totals?: {valued_amount?: string | number}, low_stock?: Array<{product_id: string, name: string, sku: string, quantity: string | number}>, movements?: unknown[]}} BarLocalStockReportExpectedView */
/** @typedef {{period?: {from?: string, to?: string}, complete?: boolean, unavailable?: string[], card_settlement_status?: string, totals?: {expected_cash?: string | number, counted_cash?: string | number, cash_variance?: string | number}, shifts?: Array<{shift_id: string, business_date: string, cashup_status: string, shift_status: string, expected_cash: string | number, counted_cash: string | number}>}} BarLocalCashupReportExpectedView */
/** @typedef {{sale_line_id: string, name: string, quantity: string | number, line_total: string | number, modifiers?: unknown[]}} BarLocalReceiptLineExpectedView */
/** @typedef {{sale_id: string, receipt_number: string | number, total: string | number, lines: BarLocalReceiptLineExpectedView[]}} BarLocalReceiptExpectedView */
/** @typedef {{shift_id: string, expected_cash?: string | number, counted_cash?: string | number, variance?: string | number}} BarLocalClosedShiftView */
/** @typedef {{code: string, expiresAt: number, fingerprint: string, addresses: string[]}} BarLocalPairingCodeView */
/** @typedef {{staff_id: string, display_name: string, role: string, status: string}} BarLocalStaffListExpectedView */
/** @typedef {{id?: string | number, operation_id?: string, action?: string, created_at?: string, actor_staff_id?: string, before?: unknown, after?: unknown}} BarLocalAuditRowExpectedView */

// MENU_EDIT_SNAPSHOT_BEGIN
/** @param {(name: string, filters: Record<string, unknown>) => Promise<any>} query */
async function loadVerifiedMenuEditSnapshot(query) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    /** @type {Array<Record<string, any>>} */
    const rows = []
    /** @type {Record<string, number>} */
    const versions = {}
    const ids = new Set()
    const cursors = new Set()
    let cursor = null
    let watermark = null
    let scope = null
    let changed = false
    for (let page = 0; page < 100; page += 1) {
      const filters = { include_inactive: true, limit: 200, ...(cursor ? { cursor } : {}) }
      const [availability, products] = await Promise.all([query('menu.availability', filters), query('menu.list', filters)])
      for (const result of [availability, products]) {
        if (result?.complete !== true || !Array.isArray(result.data) || !Array.isArray(result.unavailable) || result.unavailable.length ||
            !Number.isSafeInteger(result.snapshot_watermark) || result.snapshot_watermark < 0 ||
            !result.scope?.business_id || !result.scope?.outlet_id || !result.scope?.device_id || !result.scope?.actor_staff_id ||
            typeof result.pagination?.has_more !== 'boolean') {
          throw new Error('The local menu snapshot is incomplete. Refresh before editing a product.')
        }
        const currentScope = JSON.stringify([result.scope.business_id, result.scope.outlet_id, result.scope.device_id, result.scope.actor_staff_id])
        if (scope !== null && currentScope !== scope) throw new Error('The local menu scope changed. Sign in again before editing.')
        if (watermark !== null && result.snapshot_watermark !== watermark) { changed = true; break }
        scope = currentScope
        watermark = result.snapshot_watermark
      }
      if (changed) break
      if (availability.pagination.has_more !== products.pagination.has_more ||
          availability.pagination.next_cursor !== products.pagination.next_cursor ||
          availability.data.length !== products.data.length) throw new Error('The local menu pages do not match. Refresh before editing.')
      const pageProducts = new Map()
      for (const product of products.data) {
        if (!product || typeof product.product_id !== 'string' || !product.product_id || typeof product.sku !== 'string' ||
            !Number.isSafeInteger(product.version) || product.version < 1 || pageProducts.has(product.product_id)) {
          throw new Error('The local product versions are incomplete. Refresh before editing.')
        }
        pageProducts.set(product.product_id, product)
      }
      for (const row of availability.data) {
        const product = row && pageProducts.get(row.product_id)
        if (!product || ids.has(row.product_id) || product.sku !== row.sku) {
          throw new Error('The local menu products do not match. Refresh before editing.')
        }
        ids.add(row.product_id)
        versions[row.product_id] = product.version
        rows.push(row)
      }
      if (!availability.pagination.has_more) return { rows, versions }
      const next = availability.pagination.next_cursor
      if (typeof next !== 'string' || !next || cursors.has(next) || availability.data.length === 0) {
        throw new Error('The local menu returned an invalid cursor. Refresh before editing.')
      }
      cursors.add(next)
      cursor = next
    }
    if (!changed) throw new Error('The local menu exceeds the safe page limit. Refresh before editing.')
  }
  throw new Error('The local menu changed while loading. Refresh before editing.')
}
// MENU_EDIT_SNAPSHOT_END

const MONEY_TWO = /^\d+(?:\.\d{1,2})?$/;
const QUANTITY_SIX = /^\d+(?:\.\d{1,6})?$/;
const COST_FOUR = /^\d+(?:\.\d{1,4})?$/;
const READINESS_MAX_AGE_MS = 45000;

/** @param {BarLocalReadinessView | null} readiness @param {number} [now] */
function getReadinessState(readiness, now = Date.now()) {
  if (!readiness) return 'unknown';
  if (!Number.isFinite(readiness.checkedAt)) return readiness.unavailableAt ? 'unavailable' : 'unknown';
  if (now - /** @type {number} */ (readiness.checkedAt) >= READINESS_MAX_AGE_MS) return 'stale';
  if (readiness.unavailableAt) return 'unavailable';
  return readiness.ready === true ? 'ready' : 'blocked';
}

/** @param {string} state @param {BarLocalReadinessView | null} readiness */
function describeReadiness(state, readiness) {
  return barLocalReadinessMessage(state);
}

/** @param {unknown} error */
function getMessage(error) {
  return barLocalOperatorError(error);
}

function displayMoney(value) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : String(value);
}

function displayQuantity(value) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : String(value);
}

function displayModifierNames(value) {
  if (!Array.isArray(value)) return '';
  return value.map((modifier) => modifier && typeof modifier.option_name === 'string' ? modifier.option_name : '').filter(Boolean).join(', ');
}

/** @param {string} command */
function commandNotice(command) {
  if (command === 'sale.commit') return 'Sale committed by the local Bar service.';
  if (command === 'sale.return') return 'Return committed by the local Bar service.';
  if (command === 'sale.void') return 'Sale void committed by the local Bar service.';
  if (command === 'shift.open') return 'Shift opened by the local Bar service.';
  if (command === 'shift.close') return 'Shift closed by the local Bar service.';
  if (command === 'cashup.submit') return 'Cash-up submitted to the local authority for review.';
  if (command === 'cashup.review') return 'Cash-up decision recorded by the local authority.';
  if (command === 'cashup.reopen') return 'A new cash-up revision was submitted; the reviewed snapshot remains in the local audit history.';
  if (command === 'tab.open') return 'Tab opened by the local Bar service.';
  if (command === 'tab.add') return 'Current cart added to the selected tab.';
  if (command === 'tab.settle') return 'Tab settled by the local Bar service.';
  if (command === 'tab.transfer') return 'Tab ownership transferred by the local Bar service.';
  if (command === 'tab.split') return 'Selected tab lines moved into a new tab by the local Bar service.';
  if (command === 'tab.merge') return 'Tab merged by the local Bar service.';
  if (command === 'stock.receive') return 'Stock receipt committed by the local Bar service.';
  if (command === 'stock.adjust') return 'Negative stock adjustment committed with manager approval.';
  if (command === 'stock.stocktake') return 'Stocktake reconciliation committed by the local Bar service.';
  if (command === 'stock.waste') return 'Stock waste committed with manager approval.';
  if (command === 'stock.transfer') return 'Stock transfer committed by the local Bar service.';
  if (command === 'drawer.movement') return 'Drawer movement committed by the local Bar service.';
  if (command === 'catalogue.upsert') return 'Product saved to the local catalogue.';
  if (command === 'catalogue.availability.set') return 'Product availability saved by the local Bar authority.';
  if (command === 'support.report.create') return 'Support report recorded locally; external delivery is disabled.';
  return 'Operation committed by the local Bar service.';
}

/** @param {BarLocalAuthorityExpectedView} authority @returns {Promise<{products: BarLocalProductExpectedView[], snapshot_watermark: number}>} */
async function loadCompleteCatalogue(authority) {
  const products = [];
  let cursor = null;
  let snapshotWatermark = null;
  for (let page = 0; page < 100; page += 1) {
    const filters = { available_only: true, limit: 200, ...(cursor ? { cursor } : {}) };
    const result = await window.api.pos.barLocal.query('menu.availability', filters);
    if (!result || result.complete !== true || !Array.isArray(result.data) || (Array.isArray(result.unavailable) && result.unavailable.length)
      || !Number.isSafeInteger(result.snapshot_watermark) || result.snapshot_watermark < 0
      || result.scope?.business_id !== authority.business_id || result.scope?.outlet_id !== authority.outlet_id) {
      throw new Error('The local catalogue snapshot is incomplete. Ask a manager to refresh the published menu.');
    }
    if (snapshotWatermark !== null && result.snapshot_watermark !== snapshotWatermark) throw new Error('The local menu changed while pages were loading. Refresh before trading.');
    snapshotWatermark = result.snapshot_watermark;
    products.push(...result.data.filter((product) => product.product_active === true && product.available === true));
    if (result.pagination?.has_more !== true) return { products, snapshot_watermark: snapshotWatermark };
    if (typeof result.pagination.next_cursor !== 'string' || result.pagination.next_cursor === cursor) {
      throw new Error('The local catalogue pagination is invalid. Trading is paused until it is repaired.');
    }
    cursor = result.pagination.next_cursor;
  }
  throw new Error('The local catalogue exceeds the supported safe page limit. Ask a manager to investigate.');
}

/** @param {{authority: BarLocalAuthorityExpectedView}} props */
export default function BarLocalWorkspace({ authority }) {
  const [loginMode, setLoginMode] = useState('staff');
  const [staffId, setStaffId] = useState('');
  const [pin, setPin] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [staff, setStaff] = useState(/** @type {BarLocalStaffExpectedView | null} */ (null));
  const [readiness, setReadiness] = useState(/** @type {BarLocalReadinessView | null} */ (null));
  const [products, setProducts] = useState(/** @type {BarLocalProductExpectedView[]} */ ([]));
  const [catalogueSyncError, setCatalogueSyncError] = useState('');
  const catalogueEventCursor = useRef(0);
  const [menuRows, setMenuRows] = useState(/** @type {BarLocalMenuEditRowExpectedView[]} */ ([]));
  const [menuProductVersions, setMenuProductVersions] = useState({});
  const [modifierConfig, setModifierConfig] = useState(null);
  const [cashierPromotions, setCashierPromotions] = useState(/** @type {BarLocalPromotionReadView[]} */ ([]));
  const [discountPolicy, setDiscountPolicy] = useState(/** @type {BarLocalDiscountPolicyReadView | null} */ (null));
  const [promotionCode, setPromotionCode] = useState('');
  const [discountApprovalPin, setDiscountApprovalPin] = useState('');
  const [discountApprovalBusy, setDiscountApprovalBusy] = useState(false);
  const [shift, setShift] = useState(/** @type {BarLocalShiftExpectedView | null} */ (null));
  const [cart, setCart] = useState(/** @type {BarLocalCartLineView[]} */ ([]));
  const [openingFloat, setOpeningFloat] = useState('0.00');
  const [menuDraft, setMenuDraft] = useState({ productId: '', expectedVersion: '', sku: '', name: '', category: '', price: '', taxRate: '0.00', trackStock: true, active: true });
  const [pending, setPending] = useState(/** @type {BarLocalPendingOperationView | null} */ (null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeTab, setActiveTab] = useState('counter');
  const [panelVersion, setPanelVersion] = useState(0);
  const [openTabs, setOpenTabs] = useState(/** @type {BarLocalOpenTabExpectedView[]} */ ([]));
  const [selectedTabId, setSelectedTabId] = useState('');
  const [selectedTab, setSelectedTab] = useState(/** @type {BarLocalSelectedTabExpectedView | null} */ (null));
  const [tabDraft, setTabDraft] = useState({ table_label: '', note: '' });
  const [saleTenderRows, setSaleTenderRows] = useState(() => [makeTenderRow()]);
  const [tabSettleRows, setTabSettleRows] = useState(() => [makeTenderRow()]);
  const [customers, setCustomers] = useState(/** @type {BarLocalCustomerExpectedView[]} */ ([]));
  const [tabActionBusy, setTabActionBusy] = useState(false);
  const [tabTransferDraft, setTabTransferDraft] = useState({ target_staff_id: '', reason: '', pin: '' });
  const [tabSplitSelection, setTabSplitSelection] = useState([]);
  const [tabSplitDraft, setTabSplitDraft] = useState({ target_owner_staff_id: '', table_label: '', note: '', reason: '', pin: '' });
  const [tabMergeTargetId, setTabMergeTargetId] = useState('');
  const [tabMergeDraft, setTabMergeDraft] = useState({ reason: '', pin: '' });
  const [stock, setStock] = useState(/** @type {BarLocalStockExpectedView[]} */ ([]));
  const [stockLotRows, setStockLotRows] = useState(/** @type {BarLocalStockLotExpectedView[]} */ ([]));
  const [stockLotBalanceRows, setStockLotBalanceRows] = useState(/** @type {BarLocalStockLotBalanceExpectedView[]} */ ([]));
  const [sales, setSales] = useState(/** @type {BarLocalSaleListExpectedView[]} */ ([]));
  const [selectedSaleId, setSelectedSaleId] = useState('');
  const [selectedSale, setSelectedSale] = useState(/** @type {BarLocalSelectedSaleExpectedView | null} */ (null));
  const [returnDraft, setReturnDraft] = useState({ lineQuantities: {}, reason: '', disposition: 'restock' });
  const [returnApprovalPin, setReturnApprovalPin] = useState('');
  const [cashupSummary, setCashupSummary] = useState(/** @type {BarLocalCashupSummaryExpectedView | null} */ (null));
  const [cashupRows, setCashupRows] = useState(/** @type {BarLocalCashupRowExpectedView[]} */ ([]));
  const [cashupReportComplete, setCashupReportComplete] = useState(true);
  const [selectedCashupShiftId, setSelectedCashupShiftId] = useState('');
  const [closedShift, setClosedShift] = useState(/** @type {BarLocalClosedShiftView | null} */ (null));
  const [cashupDraft, setCashupDraft] = useState({ counted_cash: '', counted_card: '0.00', notes: '' });
  const [cashupReviewDraft, setCashupReviewDraft] = useState({ decision: 'approved', reason: '', pin: '' });
  const [cashupApprovalBusy, setCashupApprovalBusy] = useState(false);
  const [cashupReopenDraft, setCashupReopenDraft] = useState({ counted_cash: '', counted_card: '0.00', notes: '', proof_ref: '', reason: '', pin: '' });
  const [drawerDraft, setDrawerDraft] = useState({ type: 'paid_in', amount: '', reason: '' });
  // The command response is rendered as an expected status view; no runtime validation occurs here.
  const [cashupResult, setCashupResult] = useState(/** @type {{status?: string} | null} */ (null));
  const [report, setReport] = useState(/** @type {BarLocalSalesReportExpectedView | null} */ (null));
  const [stockReport, setStockReport] = useState(/** @type {BarLocalStockReportExpectedView | null} */ (null));
  const [cashupReport, setCashupReport] = useState(/** @type {BarLocalCashupReportExpectedView | null} */ (null));
  const [lastReceipt, setLastReceipt] = useState(/** @type {BarLocalReceiptExpectedView | null} */ (null));
  const [staffRows, setStaffRows] = useState(/** @type {BarLocalStaffListExpectedView[]} */ ([]));
  const [auditRows, setAuditRows] = useState(/** @type {BarLocalAuditRowExpectedView[]} */ ([]));
  const [auditSearch, setAuditSearch] = useState('');
  const [auditAction, setAuditAction] = useState('');
  const [auditCursor, setAuditCursor] = useState('');
  const [auditHasMore, setAuditHasMore] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [supportReports, setSupportReports] = useState(/** @type {Array<Record<string, unknown>>} */ ([]));
  const [supportReportsLoading, setSupportReportsLoading] = useState(false);
  const [supportReportsError, setSupportReportsError] = useState('');
  const [supportDraft, setSupportDraft] = useState({ category: 'operations', severity: 'normal', subject: '', message: '' });
  const [staffDraft, setStaffDraft] = useState({ display_name: '', role: 'cashier', pin: '' });
  const [pairingCode, setPairingCode] = useState(/** @type {BarLocalPairingCodeView | null} */ (null));
  const [pairingBusy, setPairingBusy] = useState(false);
  const saleEstimate = useMemo(() => {
    try {
      const code = promotionCode.trim().toUpperCase();
      const promotion = code ? cashierPromotions.find((row) => String(row.code).toUpperCase() === code) : null;
      if (code && !promotion) return null;
      if (!discountPolicy) return null;
      return estimateBarCashSale(cart, promotion);
    } catch { return null; }
  }, [cart, cashierPromotions, discountPolicy, promotionCode]);
  const total = saleEstimate && discountPolicy && !exceedsDiscountMaximum(saleEstimate.promotionDiscountCents, saleEstimate.subtotalCents, discountPolicy.maximum_percent) ? saleEstimate.totalCents : null;
  const saleTotalCents = total === null ? null : moneyToCents(formatBarLocalMoney(total));
  const saleTenderEvaluation = useMemo(() => evaluateTenders({ totalCents: saleTotalCents ?? 0, rows: saleTenderRows }), [saleTotalCents, saleTenderRows]);
  const promotionApprovalRequired = Boolean(saleEstimate && discountPolicy && isDiscountApprovalRequired(saleEstimate.promotionDiscountCents, saleEstimate.subtotalCents, discountPolicy.approval_threshold_percent));

  useEffect(() => {
    // Unresolved work must be visible before any operator can start trading,
    // including on a fresh sign-in after a crash. Never show an empty queue
    // just because the journal could not be read.
    let mounted = true;
    void window.api.pos.barLocal.getOpenIntents().then((open) => {
      if (!mounted || !Array.isArray(open) || open.length === 0) return;
      const intent = open[0];
      setPending({ operation_id: intent.operation_id, command: intent.command, state: intent.state, attempts: intent.attempts, payload: {}, recovered: true });
      setError('A saved local operation has not been resolved. Sign in with a local staff account and check its status before starting another operation.');
    }).catch((cause) => { if (mounted) setError(getMessage(cause)); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!staff) return undefined;
    let mounted = true;
    const check = async () => {
      try {
        const result = await window.api.pos.barLocal.refreshReadiness();
        if (mounted) setReadiness({ ready: result.ready === true, blockers: result.blockers, checkedAt: Date.now(), unavailableAt: null });
      } catch { if (mounted) setReadiness((current) => ({ ...(current || {}), ready: false, blockers: current?.blockers || [], unavailableAt: Date.now() })); }
    };
    void check();
    void window.api.pos.barLocal.getOpenIntents().then((open) => {
      if (!mounted || !Array.isArray(open) || open.length === 0) return;
      const intent = open[0];
      setPending({ operation_id: intent.operation_id, command: intent.command, state: intent.state, attempts: intent.attempts, payload: {}, recovered: true });
      setError('A saved local operation has not been resolved. Retry its original operation ID before starting another operation.');
    }).catch((cause) => { if (mounted) setError(getMessage(cause)); });
    const timer = window.setInterval(() => { void check(); }, 15000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [staff]);

  useEffect(() => {
    if (!staff || activeTab !== 'menu') return undefined;
    let cancelled = false;
    setMenuRows([]);
    setMenuProductVersions({});
    setMenuDraft((draft) => draft.productId ? { ...draft, expectedVersion: '' } : draft);
    void (async () => {
      try {
        const { rows, versions } = await loadVerifiedMenuEditSnapshot((name, filters) => window.api.pos.barLocal.query(name, filters));
        if (!cancelled) {
          // The checked menu query validates snapshot identity and versions; row fields remain expected data.
          setMenuRows(/** @type {BarLocalMenuEditRowExpectedView[]} */ (rows));
          setMenuProductVersions(versions);
        }
      } catch (cause) { if (!cancelled) { setMenuRows([]); setMenuProductVersions({}); setError(getMessage(cause)); } }
    })();
    return () => { cancelled = true; };
  }, [staff, activeTab, panelVersion]);

  useEffect(() => {
    if (!staff || activeTab !== 'tabs') return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const result = await window.api.pos.barLocal.query('tabs.list', { status: 'open', limit: 100 });
        if (cancelled) return;
        if (result?.complete !== true || !Array.isArray(result.data)) throw new Error('The open tab list is incomplete. Refresh before using tabs.');
        setOpenTabs(result.data);
      } catch (cause) { if (!cancelled) setError(getMessage(cause)); }
    })();
    return () => { cancelled = true; };
  }, [staff, activeTab, panelVersion]);

  useEffect(() => {
    if (!staff || activeTab !== 'tabs' || !selectedTabId) { setSelectedTab(null); return undefined; }
    let cancelled = false;
    void (async () => {
      try {
        const result = await window.api.pos.barLocal.query('tab.get', { tab_id: selectedTabId });
        if (cancelled) return;
        if (result?.complete !== true || !result.data) throw new Error('The selected tab could not be read completely. Refresh before settling it.');
        setSelectedTab(result.data);
      } catch (cause) { if (!cancelled) setError(getMessage(cause)); }
    })();
    return () => { cancelled = true; };
  }, [staff, activeTab, selectedTabId, panelVersion]);

  useEffect(() => {
    if (!staff || !['stock', 'purchasing'].includes(activeTab)) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const [stockRows, lotRows, lotBalanceRows] = await Promise.all([
          loadCompleteBarList((name, filters) => window.api.pos.barLocal.query(name, filters), 'stock.list'),
          loadCompleteBarList((name, filters) => window.api.pos.barLocal.query(name, filters), 'stock.lot_expiry'),
          loadCompleteBarList((name, filters) => window.api.pos.barLocal.query(name, filters), 'stock.lot_balances')
        ]);
        if (cancelled) return;
        // Pagination verifies scope and completeness but does not validate row fields.
        setStock(/** @type {BarLocalStockExpectedView[]} */ (stockRows));
        setStockLotRows(/** @type {BarLocalStockLotExpectedView[]} */ (lotRows));
        setStockLotBalanceRows(/** @type {BarLocalStockLotBalanceExpectedView[]} */ (lotBalanceRows));
      } catch (cause) { if (!cancelled) setError(getMessage(cause)); }
    })();
    return () => { cancelled = true; };
  }, [staff, activeTab, panelVersion]);

  useEffect(() => {
    if (!staff || activeTab !== 'returns') return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const result = await window.api.pos.barLocal.query('sales.list', { limit: 100 });
        if (cancelled) return;
        if (result?.complete !== true || !Array.isArray(result.data)) throw new Error('The local sales list is incomplete. Refresh before starting a return.');
        setSales(result.data);
      } catch (cause) { if (!cancelled) setError(getMessage(cause)); }
    })();
    return () => { cancelled = true; };
  }, [staff, activeTab, panelVersion]);

  useEffect(() => {
    if (!staff || activeTab !== 'returns' || !selectedSaleId) { setSelectedSale(null); return undefined; }
    let cancelled = false;
    void (async () => {
      try {
        const result = await window.api.pos.barLocal.query('sale.get', { sale_id: selectedSaleId });
        if (cancelled) return;
        if (result?.complete !== true || !result.data) throw new Error('The selected sale could not be read completely.');
        setSelectedSale(result.data);
      } catch (cause) { if (!cancelled) setError(getMessage(cause)); }
    })();
    return () => { cancelled = true; };
  }, [staff, activeTab, selectedSaleId, panelVersion]);

  useEffect(() => {
    if (!staff || !['cashup', 'drawer'].includes(activeTab)) return undefined;
    const targetShiftId = activeTab === 'cashup'
      ? selectedCashupShiftId || closedShift?.shift_id || shift?.shift_id
      : shift?.shift_id;
    if (!targetShiftId) { setCashupSummary(null); return undefined; }
    let cancelled = false;
    void (async () => {
      try {
        const result = await window.api.pos.barLocal.query('cashup.summary', { shift_id: targetShiftId });
        if (cancelled) return;
        if (result?.complete !== true || !result.data) throw new Error('The shift drawer summary is incomplete. Refresh before relying on it.');
        setCashupSummary(result.data);
      } catch (cause) { if (!cancelled) { setCashupSummary(null); setError(getMessage(cause)); } }
    })();
    return () => { cancelled = true; };
  }, [staff, activeTab, shift?.shift_id, closedShift?.shift_id, selectedCashupShiftId, panelVersion]);

  useEffect(() => {
    if (!staff || activeTab !== 'cashup') return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const result = await window.api.pos.barLocal.query('reports.cashup', {});
        if (cancelled) return;
        const rows = result?.data && Array.isArray(result.data.shifts) ? result.data.shifts : null;
        if (!rows) throw new Error('The local cash-up review list is unavailable. Refresh before reviewing a cash-up.');
        setCashupRows(rows);
        setCashupReportComplete(result.complete === true);
      } catch (cause) {
        if (!cancelled) { setCashupRows([]); setCashupReportComplete(false); setError(getMessage(cause)); }
      }
    })();
    return () => { cancelled = true; };
  }, [staff, activeTab, panelVersion]);

  useEffect(() => {
    if (!staff || activeTab !== 'reports') return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const [result, stockResult, cashupResult] = await Promise.all([
          window.api.pos.barLocal.query('reports.sales_summary', {}),
          window.api.pos.barLocal.query('reports.stock', {}),
          window.api.pos.barLocal.query('reports.cashup', {})
        ]);
        if (cancelled) return;
        if (result?.complete !== true || !result.data) throw new Error('The local sales summary is incomplete. Refresh the report.');
        if (!stockResult?.data || !stockResult.scope?.business_id || !stockResult.scope?.outlet_id) throw new Error('The local stock report is incomplete or unscoped. Refresh before relying on it.');
        if (!cashupResult?.data || !cashupResult.scope?.business_id || !cashupResult.scope?.outlet_id) throw new Error('The local cash-up report is incomplete or unscoped. Refresh before relying on it.');
        setReport(result.data);
        setStockReport({ ...stockResult.data, complete: stockResult.complete === true, unavailable: stockResult.unavailable || [] });
        setCashupReport({ ...cashupResult.data, complete: cashupResult.complete === true, unavailable: cashupResult.unavailable || [] });
      } catch (cause) { if (!cancelled) setError(getMessage(cause)); }
    })();
    return () => { cancelled = true; };
  }, [staff, activeTab, panelVersion]);

  useEffect(() => {
    const mayManageStaff = Array.isArray(staff?.capabilities) && staff.capabilities.includes('staff.manage');
    if (!staff || !mayManageStaff || !['settings', 'tabs'].includes(activeTab)) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const result = await window.api.pos.barLocal.query('staff.list', { include_suspended: true, limit: 100 });
        if (cancelled) return;
        if (result?.complete !== true || !Array.isArray(result.data)) throw new Error('The staff list is incomplete. Refresh before changing local access.');
        setStaffRows(result.data);
      } catch (cause) { if (!cancelled) setError(getMessage(cause)); }
    })();
    return () => { cancelled = true; };
  }, [staff, activeTab, panelVersion]);

  useEffect(() => {
    const mayManageCustomers = Array.isArray(staff?.capabilities) && staff.capabilities.includes('customers.manage');
    if (!staff || !mayManageCustomers) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const result = await window.api.pos.barLocal.query('customers.list', { limit: 200 });
        if (cancelled) return;
        if (result?.complete !== true || !Array.isArray(result.data) || result.scope?.business_id !== authority.business_id || result.scope?.outlet_id !== authority.outlet_id) {
          throw new Error('The local customer list is incomplete or outside this outlet. Customer credit is unavailable until it is refreshed.');
        }
        setCustomers(result.data);
      } catch (cause) { if (!cancelled) setError(getMessage(cause)); }
    })();
    return () => { cancelled = true; };
  }, [staff, authority.business_id, authority.outlet_id, panelVersion]);

  useEffect(() => {
    setTabSettleRows([makeTenderRow()]);
    setTabSplitSelection([]);
    setTabTransferDraft({ target_staff_id: '', reason: '', pin: '' });
    setTabSplitDraft({ target_owner_staff_id: '', table_label: '', note: '', reason: '', pin: '' });
    setTabMergeTargetId('');
    setTabMergeDraft({ reason: '', pin: '' });
  }, [selectedTabId]);

  useEffect(() => {
    if (!pairingCode) return undefined;
    const timer = window.setTimeout(() => setPairingCode(null), Math.max(0, pairingCode.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [pairingCode]);

  const readinessState = getReadinessState(readiness);
  const localReady = readinessState === 'ready';
  const capabilities = Array.isArray(staff?.capabilities) ? staff.capabilities : [];
  const canManageMenu = capabilities.includes('pos.menu_manage');
  const canApplyDiscount = capabilities.includes('pos.discount');
  const canManageTill = capabilities.includes('pos.manage');
  const canCashup = capabilities.includes('pos.cashup');
  const canInventoryView = capabilities.includes('inventory.view');
  const canReports = capabilities.includes('pos.reports');
  const canManageStaff = capabilities.includes('staff.manage');
  const canManageSettings = capabilities.includes('settings.manage');
  const canManageBackup = capabilities.includes('backup.manage');
  const canManageCustomers = capabilities.includes('customers.manage');
  const canManageVouchers = capabilities.includes('vouchers.manage');
  const canReadAccounting = capabilities.includes('accounting.read');
  const selectedSaleClosed = barSaleShiftIsClosed(selectedSale);
  const canPostCloseSelectedSale = canPostCloseCorrectBarSale(selectedSale);
  const postCloseBlockedCopy = selectedSaleClosed ? barPostCloseCorrectionBlockedMessage(selectedSale) : '';
  const selectedSaleCorrections = Array.isArray(selectedSale?.post_close_corrections) ? selectedSale.post_close_corrections : [];
  const panels = [
    { id: 'counter', label: 'Counter' },
    ...(canManageMenu ? [{ id: 'menu', label: 'Menu' }] : []),
    ...(canCashup ? [{ id: 'drawer', label: 'Drawer' }] : []),
    ...(canManageTill ? [{ id: 'tabs', label: 'Tabs' }] : []),
    ...(canManageTill && canReports ? [{ id: 'returns', label: 'Returns' }] : []),
    ...(canCashup ? [{ id: 'cashup', label: 'Cash-up' }] : []),
    ...(canInventoryView ? [{ id: 'stock', label: 'Stock' }, { id: 'purchasing', label: 'Purchasing' }] : []),
    ...(canManageCustomers ? [{ id: 'customers', label: 'Customers' }] : []),
    ...(canManageTill ? [{ id: 'control', label: 'Control' }] : []),
    ...(canManageStaff ? [{ id: 'workforce', label: 'Workforce' }, { id: 'settings', label: 'Settings' }] : []),
    ...(canReadAccounting ? [{ id: 'accounting', label: 'Accounting' }] : []),
    ...(canReports ? [{ id: 'reports', label: 'Reports' }] : []),
    ...(canManageSettings ? [{ id: 'audit', label: 'Audit' }, { id: 'support', label: 'Support' }, { id: 'admin', label: 'Administration' }] : [])
  ];

  useEffect(() => {
    if (!staff || activeTab !== 'menu' || !canManageMenu) return undefined;
    let cancelled = false;
    void window.api.pos.barLocal.query('menu.modifiers', {}).then((result) => {
      if (cancelled) return;
      if (result?.complete !== true || !result.data || result.scope?.outlet_id !== authority.outlet_id) {
        throw new Error('The local modifier configuration could not be verified for this outlet.');
      }
      setModifierConfig(result.data);
    }).catch((cause) => { if (!cancelled) setError(getMessage(cause)); });
    return () => { cancelled = true; };
  }, [staff, activeTab, canManageMenu, panelVersion, authority.outlet_id]);

  const searchAudit = async (append = false) => {
    setAuditLoading(true); setError('');
    try {
      const cursor = append ? auditCursor : '';
      const result = await window.api.pos.barLocal.query('audit.search', {
        limit: 50,
        ...(auditSearch.trim() ? { search: auditSearch.trim() } : {}),
        ...(auditAction.trim() ? { action: auditAction.trim() } : {}),
        ...(cursor ? { cursor } : {})
      });
      if (!Array.isArray(result?.data) || result.unavailable?.length || !result.scope?.business_id || !result.scope?.outlet_id) throw new Error('The local audit result is incomplete or unscoped. Refresh before relying on it.');
      setAuditRows((current) => append ? [...current, ...result.data] : result.data);
      const next = result.pagination?.next_cursor;
      setAuditCursor(next === null || next === undefined ? '' : String(next));
      setAuditHasMore(result.pagination?.has_more === true);
    } catch (cause) { setError(getMessage(cause)); }
    finally { setAuditLoading(false); }
  };

  useEffect(() => {
    if (!staff || activeTab !== 'audit' || !canManageSettings) return undefined;
    void searchAudit(false);
    return undefined;
  }, [staff, activeTab, canManageSettings, panelVersion]);

  const loadSupportReports = async () => {
    setSupportReportsLoading(true); setSupportReportsError('');
    try {
      const rows = await loadCompleteBarList((name, filters) => window.api.pos.barLocal.query(name, filters), 'support.reports.list', { limit: 50 });
      setSupportReports(rows.map((row) => row && typeof row === 'object' ? row : {}));
    } catch (cause) { setSupportReports([]); setSupportReportsError(getMessage(cause)); }
    finally { setSupportReportsLoading(false); }
  };

  useEffect(() => {
    if (!staff || activeTab !== 'support' || !canManageSettings) return undefined;
    void loadSupportReports();
    return undefined;
  }, [staff, activeTab, canManageSettings, panelVersion]);

  const refresh = async () => {
    const [menu, current, promotionResult] = await Promise.all([
      loadCompleteCatalogue(authority),
      window.api.pos.barLocal.query('shift.current', {}),
      window.api.pos.barLocal.query('menu.promotions', {})
    ]);
    const promotionSnapshot = validateBarPromotionSnapshot(promotionResult, authority.business_id, authority.outlet_id);
    setProducts(menu.products);
    catalogueEventCursor.current = menu.snapshot_watermark;
    setCatalogueSyncError('');
    setShift(current?.data?.status === 'open' ? current.data : null);
    setCashierPromotions(promotionSnapshot.promotions);
    setDiscountPolicy(promotionSnapshot.discountPolicy);
  };

  useEffect(() => {
    if (!staff) return undefined;
    let mounted = true;
    let inFlight = false;
    const pollCatalogue = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const feed = await window.api.pos.barLocal.events(catalogueEventCursor.current, 200);
        if (!mounted) return;
        const gap = feed.gap_detected === true;
        let replayCursor = catalogueEventCursor.current;
        if (gap) {
          const floor = feed.retention_floor_sequence;
          if (!Number.isSafeInteger(floor) || floor < 0) throw new Error('The local menu event history is incomplete. Reconnect this till and ask a manager to verify the catalogue.');
          replayCursor = floor;
        } else {
          if (!Number.isSafeInteger(feed.next_cursor) || feed.next_cursor < catalogueEventCursor.current) throw new Error('The local menu event cursor moved backwards. Refresh before trading.');
          replayCursor = feed.next_cursor;
        }
        if (!Array.isArray(feed.events) || feed.events.some((event) => !event || typeof event.event_type !== 'string')) throw new Error('The local menu event history is malformed. Refresh before trading.');
        const catalogueChanged = gap || feed.events.some((event) => ['catalogue.', 'menu.', 'promotion.'].some((prefix) => event.event_type.startsWith(prefix)));
        if (!catalogueChanged) { catalogueEventCursor.current = replayCursor; setCatalogueSyncError(''); return; }
        const [menu, promotionResult] = await Promise.all([
          loadCompleteCatalogue(authority),
          window.api.pos.barLocal.query('menu.promotions', {})
        ]);
        if (!mounted) return;
        const promotionSnapshot = validateBarPromotionSnapshot(promotionResult, authority.business_id, authority.outlet_id);
        setProducts(menu.products);
        setCashierPromotions(promotionSnapshot.promotions);
        setDiscountPolicy(promotionSnapshot.discountPolicy);
        catalogueEventCursor.current = Math.max(menu.snapshot_watermark, replayCursor);
        setCart([]);
        setSaleTenderRows([makeTenderRow()]);
        setPromotionCode('');
        setCatalogueSyncError('');
        setNotice('The shared local menu changed. Your unsent cart was cleared; review the current menu and add items again.');
      } catch (cause) {
        if (mounted) setCatalogueSyncError(`${getMessage(cause)} The current menu could not be verified; refresh it before selling.`);
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => { void pollCatalogue(); }, 15000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [staff, authority.business_id, authority.outlet_id]);

  const signIn = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = loginMode === 'owner'
        ? await window.api.pos.barLocal.login({ email: ownerEmail.trim(), password: ownerPassword })
        : await window.api.pos.barLocal.login(staffId.trim(), pin);
      setStaff(result.staff); setPin('');
      await refresh();
    } catch (cause) { setError(getMessage(cause)); }
    finally { setBusy(false); }
  };

  const runCommand = async (command, payload, prior = null, afterCommit = null, operationIdOverride = null, allowBusy = false) => {
    if (busy && !allowBusy) return null;
    if (pending && pending.operation_id !== (prior?.operation_id || operationIdOverride)) {
      setError(`Operation ${pending.operation_id} (${pending.command}) is still unresolved. Retry its original operation ID or check its status before running ${command}.`);
      return null;
    }
    const operationId = prior?.operation_id || operationIdOverride || crypto.randomUUID();
    setPending({ operation_id: operationId, command, payload });
    setBusy(true); setError(''); setNotice('');
    let result = null;
    try {
      result = prior
        ? await window.api.pos.barLocal.retry(operationId)
        : await window.api.pos.barLocal.command(command, payload, { operationId });
      if (result?.outcome === 'committed_local') {
        setPending(null);
        setNotice(commandNotice(command));
        if (command === 'drawer.movement' && payload?.type === 'count' && result.result && typeof result.result === 'object') {
          setNotice(`Drawer count recorded: counted ${displayMoney(result.result.counted_cash)}, expected ${displayMoney(result.result.expected_cash)}, variance ${displayMoney(result.result.variance)}. The count does not change the drawer balance.`);
        }
        if (command === 'sale.commit') { setCart([]); setSaleTenderRows([makeTenderRow()]); setPromotionCode(''); setDiscountApprovalPin(''); }
        if (command === 'sale.commit' || command === 'tab.settle') {
          const receipt = result.result?.receipt || result.receipt;
          if (receipt && typeof receipt === 'object') setLastReceipt(receipt);
        }
        if (command === 'catalogue.upsert') setMenuDraft({ productId: '', expectedVersion: '', sku: '', name: '', category: '', price: '', taxRate: '0.00', trackStock: true, active: true });
        if (command === 'support.report.create') setSupportDraft({ category: 'operations', severity: 'normal', subject: '', message: '' });
        if (command === 'tab.settle') { setSelectedTabId(''); setSelectedTab(null); }
        if (command === 'shift.close') {
          const closed = result.result || {};
          setClosedShift({
            shift_id: closed.shift_id || payload?.shift_id,
            expected_cash: closed.expected_cash,
            counted_cash: closed.counted_cash,
            variance: closed.variance
          });
          setCashupResult(null);
        }
        if (command === 'cashup.submit') setCashupResult(result.result || null);
        if (command === 'drawer.movement') setDrawerDraft((draft) => ({ ...draft, amount: '', reason: '' }));
      } else if (result?.outcome === 'refused') {
        setPending(null); setError(result.error?.message || 'The local authority refused this operation.');
      } else {
        setError('The local authority has not confirmed this operation. Retry the same operation ID; do not create a new operation.');
      }
    } catch (cause) {
      setError(`${getMessage(cause)} The result may be unknown. Retry the same operation ID; do not create a new operation.`);
    }
    try {
      if (result?.outcome === 'committed_local') {
        await refresh();
        if (typeof afterCommit === 'function') await afterCommit(result);
        setPanelVersion((version) => version + 1);
        const open = await window.api.pos.barLocal.getOpenIntents();
        if (Array.isArray(open) && open.length > 0) {
          const intent = open[0];
          setPending({ operation_id: intent.operation_id, command: intent.command, payload: {}, recovered: true });
          setError('A saved local operation has not been resolved. Retry its original operation ID before starting another operation.');
        }
      }
    } catch (cause) {
      setError(`The operation was committed locally, but the follow-up refresh failed: ${getMessage(cause)}. Refresh before continuing.`);
    } finally {
      setBusy(false);
    }
    return result;
  };

  const approveAndRunTabCommand = async (command, payload, pin, afterCommit) => {
    if (busy || pending || tabActionBusy) return null;
    if (!/^\d{4,12}$/.test(String(pin || ''))) {
      setError('A different authorised operator must enter a valid numeric PIN.');
      return null;
    }
    const operationId = crypto.randomUUID();
    setTabActionBusy(true); setError(''); setNotice('');
    try {
      const approval = await window.api.pos.barLocal.requestApproval(command, payload, pin, { operationId });
      if (!approval?.approval_id) throw new Error('Operator approval was not confirmed. Nothing was submitted.');
      return await runCommand(command, { ...payload, approval_id: approval.approval_id }, null, afterCommit, operationId, true);
    } catch (cause) {
      setError(getMessage(cause));
      return null;
    } finally {
      setTabActionBusy(false);
    }
  };

  const resolvePending = async () => {
    if (!pending || busy) return;
    const command = pending.command;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await window.api.pos.barLocal.resolveOperation(pending.operation_id);
      if (result?.outcome === 'committed_local') {
        setPending(null);
        setNotice(`${commandNotice(command)} Resolved from the local authority record; nothing was re-submitted.`);
        if (command === 'sale.commit') { setCart([]); setSaleTenderRows([makeTenderRow()]); setPromotionCode(''); setDiscountApprovalPin(''); }
        if (command === 'sale.commit' || command === 'tab.settle') {
          const receipt = result.receipt || result.result?.receipt;
          if (receipt && typeof receipt === 'object') setLastReceipt(receipt);
        }
        await refresh();
        setPanelVersion((version) => version + 1);
      } else if (result?.outcome === 'refused') {
        setPending(null);
        setError(result.error?.message || 'The local authority refused this operation.');
        setPanelVersion((version) => version + 1);
      } else {
        setError('The local authority still reports this operation as in progress. Keep this till open and use Check status or Retry same operation again shortly. Do not start another sale.');
        await refresh();
      }
    } catch (cause) {
      setError(`${getMessage(cause)} The operation is still saved on this till. Retry or check the same operation ID; do not start another sale.`);
    } finally {
      setBusy(false);
    }
    try {
      const open = await window.api.pos.barLocal.getOpenIntents();
      if (Array.isArray(open) && open.length > 0) {
        const intent = open[0];
        setPending({ operation_id: intent.operation_id, command: intent.command, state: intent.state, attempts: intent.attempts, payload: {}, recovered: true });
        setError('Another saved local operation remains unresolved. Resolve it before starting a new operation.');
      }
    } catch (cause) {
      setError(`${getMessage(cause)} Trading is paused until the local operation journal is recovered.`);
    }
  };

  const openShift = (event) => {
    event.preventDefault();
    if (!MONEY_TWO.test(openingFloat)) { setError('Opening float must be a non-negative amount with up to two decimal places.'); return; }
    void runCommand('shift.open', { opening_float: openingFloat });
  };

  const saveProduct = (event) => {
    event.preventDefault(); setError('');
    if (!menuDraft.sku.trim() || !menuDraft.name.trim() || !MONEY_TWO.test(menuDraft.price)
      || !COST_FOUR.test(menuDraft.taxRate)) {
      setError('Enter a SKU, product name, price with up to two decimals and tax multiplier with up to four decimals.'); return;
    }
    const payload = {
      sku: menuDraft.sku.trim(), name: menuDraft.name.trim(), category: menuDraft.category.trim() || undefined,
      price: menuDraft.price, tax_rate: menuDraft.taxRate, track_stock: menuDraft.trackStock, active: true
    };
    if (menuDraft.productId) {
      if (!Number.isSafeInteger(Number(menuDraft.expectedVersion)) || Number(menuDraft.expectedVersion) < 1) { setError('The current product version is unavailable. Refresh the menu and reopen this product before saving.'); return; }
      payload.product_id = menuDraft.productId;
      payload.expected_version = Number(menuDraft.expectedVersion);
      payload.active = menuDraft.active;
    }
    void runCommand('catalogue.upsert', payload);
  };

  const editProduct = (row) => {
    const productId = String(row.product_id);
    const expectedVersion = menuProductVersions[productId];
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) { setError('The current product version is unavailable. Refresh the menu before editing this product.'); return; }
    setMenuDraft({ productId, expectedVersion: String(expectedVersion), sku: String(row.sku || ''), name: String(row.name || ''), category: String(row.category || ''), price: String(row.price ?? ''), taxRate: String(row.tax_rate ?? '0.00'), trackStock: row.track_stock === true, active: row.product_active === true });
    setActiveTab('counter');
    setError('');
    setNotice(`Editing ${String(row.name || 'product')} at version ${expectedVersion}. A concurrent change will be rejected; refresh and review it before retrying.`);
  };

  const createSupportReport = (event) => {
    event.preventDefault();
    if (!supportDraft.subject.trim() || !supportDraft.message.trim()) { setError('Enter a subject and describe the support issue.'); return; }
    void runCommand('support.report.create', {
      ...supportDraft,
      diagnostics: { service_ready: readiness?.ready === true, readiness_blockers: Array.isArray(readiness?.blockers) ? readiness.blockers : [] },
      metadata: { application: 'legacy-pos', authority_id: authority.authority_id }
    });
  };

  const commitSale = () => {
    if (catalogueSyncError) { setError('The shared menu is not verified. Refresh it before committing a sale.'); return; }
    if (busy) return;
    if (pending) { setError(`Operation ${pending.operation_id} (${pending.command}) is unresolved. Keep this sale unchanged and retry or check its original operation ID; do not submit a new sale.`); return; }
    if (!shift || !cart.length || total === null) return;
    if (saleTenderEvaluation.error || saleTenderEvaluation.tenders.length === 0) {
      setError(saleTenderEvaluation.error || 'Prepare the split payment before committing the sale.');
      return;
    }
    const code = promotionCode.trim().toUpperCase();
    if (code && !canApplyDiscount) { setError('Your role is not authorised to apply this promotion. Ask a manager for an authorised operator.'); return; }
    const payload = {
      shift_id: shift.shift_id,
      items: cart.map((line) => ({ product_id: line.product.product_id, quantity: String(line.quantity), modifiers: line.modifiers || [] })),
      tenders: saleTenderEvaluation.tenders,
      discount_amount: '0.00', tip_amount: '0.00', ...(code ? { promotion_code: code } : {})
    };
    if (!code || !promotionApprovalRequired) { void runCommand('sale.commit', payload); return; }
    if (!/^\d{4,12}$/.test(discountApprovalPin)) { setError('A different manager must enter a valid PIN to approve this promotion discount.'); return; }
    void (async () => {
      const operationId = crypto.randomUUID();
      setDiscountApprovalBusy(true); setError('');
      try {
        const approval = await window.api.pos.barLocal.requestApproval('sale.commit', payload, discountApprovalPin, { operationId });
        if (!approval?.approval_id) throw new Error('Manager approval was not confirmed. No sale was submitted.');
        setDiscountApprovalPin('');
        await runCommand('sale.commit', { ...payload, approval_id: approval.approval_id }, null, null, operationId);
      } catch (cause) { setError(getMessage(cause)); }
      finally { setDiscountApprovalBusy(false); }
    })();
  };

  const toggleModifier = (cartId, optionId, checked, group) => setCart((current) => current.map((line) => {
    if (line.cartId !== cartId) return line;
    const ids = (Array.isArray(group.options) ? group.options : []).map((option) => String(option.option_id || option.modifier_option_id));
    const selected = new Set((line.modifiers || []).filter((id) => !ids.includes(id)));
    if (checked && !selected.has(String(optionId))) {
      const maximum = Number(group.max_selections || 1);
      if ((line.modifiers || []).filter((id) => ids.includes(id)).length >= maximum) return line;
      selected.add(String(optionId));
    } else if (!checked) selected.delete(String(optionId));
    return { ...line, modifiers: [...selected] };
  }));

  const openTab = (event) => {
    event.preventDefault(); setError('');
    if (!shift) { setError('Open your shift before opening a tab.'); return; }
    if (!tabDraft.table_label.trim() && !tabDraft.note.trim()) { setError('Enter a table label or note for the tab.'); return; }
    void runCommand('tab.open', {
      table_label: tabDraft.table_label.trim() || undefined,
      note: tabDraft.note.trim() || undefined
    }, null, (result) => {
      if (result?.result?.tab_id) setSelectedTabId(result.result.tab_id);
      setTabDraft({ table_label: '', note: '' });
    });
  };

  const selectTab = (tabId) => {
    setSelectedTabId(tabId);
    setSelectedTab(null);
  };

  const addCartToTab = () => {
    if (catalogueSyncError) { setError('The shared menu is not verified. Refresh it before adding items to a tab.'); return; }
    if (!selectedTab || !shift || !cart.length) return;
    if (selectedTab.status !== 'open') { setError('This tab is no longer open. Select an open tab before adding lines.'); return; }
    void runCommand('tab.add', {
      tab_id: selectedTab.tab_id,
      expected_version: selectedTab.version,
      items: cart.map((line) => ({ product_id: line.product.product_id, quantity: String(line.quantity), modifiers: line.modifiers || [] }))
    }, null, (result) => {
      setSelectedTabId(selectedTab.tab_id);
      const version = result?.result?.version;
      if (Number.isSafeInteger(version)) setSelectedTab((current) => (current ? { ...current, version } : current));
      setCart([]);
    });
  };

  const settleTab = () => {
    if (!selectedTab || !shift) return;
    if (selectedTab.status !== 'open') { setError('This tab is no longer open. Select an open tab before settling.'); return; }
    const totalCents = moneyToCents(selectedTab.gross_total);
    if (!Number.isSafeInteger(totalCents) || totalCents <= 0) { setError('This tab has no valid amount due to settle.'); return; }
    const evaluation = evaluateTenders({ totalCents, rows: tabSettleRows });
    if (evaluation.error || evaluation.tenders.length === 0) {
      setError(evaluation.error || 'Prepare the split payment before settling the tab.');
      return;
    }
    void runCommand('tab.settle', {
      tab_id: selectedTab.tab_id,
      expected_version: selectedTab.version,
      tenders: evaluation.tenders,
      tip_amount: '0.00',
      discount_amount: '0.00'
    }, null, () => setTabSettleRows([makeTenderRow()]));
  };

  const toggleTabSplitLine = (lineId) => {
    setTabSplitSelection((current) => current.includes(lineId)
      ? current.filter((id) => id !== lineId)
      : [...current, lineId]);
  };

  const transferTab = (event) => {
    event.preventDefault(); setError(''); setNotice('');
    if (!selectedTab) return;
    if (selectedTab.status !== 'open') { setError('Only an open tab can be transferred.'); return; }
    if (!tabTransferDraft.target_staff_id) { setError('Select the active staff member receiving the tab.'); return; }
    if (!/^\d{4,12}$/.test(tabTransferDraft.pin)) { setError('A different manager must enter a valid PIN to approve the ownership transfer.'); return; }
    void approveAndRunTabCommand('tab.transfer', {
      tab_id: selectedTab.tab_id,
      expected_version: selectedTab.version,
      target_staff_id: tabTransferDraft.target_staff_id,
      ...(tabTransferDraft.reason.trim() ? { reason: tabTransferDraft.reason.trim() } : {})
    }, tabTransferDraft.pin, () => setTabTransferDraft({ target_staff_id: '', reason: '', pin: '' }));
  };

  const splitTab = (event) => {
    event.preventDefault(); setError(''); setNotice('');
    if (!selectedTab) return;
    if (selectedTab.status !== 'open') { setError('Only an open tab can be split.'); return; }
    if (tabSplitSelection.length === 0) { setError('Select at least one open line to move into the new tab.'); return; }
    if (!/^\d{4,12}$/.test(tabSplitDraft.pin)) { setError('A different manager must enter a valid PIN to approve the tab split.'); return; }
    void approveAndRunTabCommand('tab.split', {
      source_tab_id: selectedTab.tab_id,
      expected_version: selectedTab.version,
      line_ids: tabSplitSelection,
      ...(tabSplitDraft.target_owner_staff_id ? { target_owner_staff_id: tabSplitDraft.target_owner_staff_id } : {}),
      ...(tabSplitDraft.table_label.trim() ? { table_label: tabSplitDraft.table_label.trim() } : {}),
      ...(tabSplitDraft.note.trim() ? { note: tabSplitDraft.note.trim() } : {}),
      ...(tabSplitDraft.reason.trim() ? { reason: tabSplitDraft.reason.trim() } : {})
    }, tabSplitDraft.pin, () => {
      setTabSplitSelection([]);
      setTabSplitDraft({ target_owner_staff_id: '', table_label: '', note: '', reason: '', pin: '' });
    });
  };

  const mergeTab = (event) => {
    event.preventDefault(); setError(''); setNotice('');
    const target = openTabs.find((tab) => String(tab.tab_id) === tabMergeTargetId);
    if (!selectedTab || !target) { setError('Select another open tab to merge into.'); return; }
    if (selectedTab.status !== 'open' || target.status !== 'open') { setError('Both tabs must still be open.'); return; }
    if (!/^\d{4,12}$/.test(tabMergeDraft.pin)) { setError('A different manager must enter a valid PIN to approve the tab merge.'); return; }
    void approveAndRunTabCommand('tab.merge', {
      source_tab_id: selectedTab.tab_id,
      source_expected_version: selectedTab.version,
      target_tab_id: target.tab_id,
      target_expected_version: target.version,
      ...(tabMergeDraft.reason.trim() ? { reason: tabMergeDraft.reason.trim() } : {})
    }, tabMergeDraft.pin, () => {
      setTabMergeTargetId('');
      setTabMergeDraft({ reason: '', pin: '' });
    });
  };

  const selectSale = (saleId) => {
    setSelectedSaleId(saleId);
    setSelectedSale(null);
    setReturnDraft({ lineQuantities: {}, reason: '', disposition: 'restock' });
    setReturnApprovalPin('');
  };

  const submitReturn = async (event) => {
    event.preventDefault(); setError(''); setNotice('');
    if (getReadinessState(readiness) !== 'ready') { setError('Trading is paused until the local Bar server readiness check succeeds. Keep this return and check readiness.'); return; }
    if (!selectedSale) { setError('Select a sale before preparing a return.'); return; }
    if (!canReturnBarSaleLines(selectedSale)) { setError('This receipt has no remaining items to return. Refresh and check the original receipt.'); return; }
    const selectedLines = (Array.isArray(selectedSale.lines) ? selectedSale.lines : [])
      .map((line) => ({ line, quantity: String(returnDraft.lineQuantities[String(line.sale_line_id)] ?? '').trim() }))
      .filter(({ quantity }) => quantity !== '');
    if (selectedLines.length === 0) { setError('Enter a return quantity for at least one sale line.'); return; }
    for (const { line, quantity } of selectedLines) {
      if (!QUANTITY_SIX.test(quantity) || Number(quantity) <= 0) { setError('Each return quantity must be greater than zero with up to six decimals.'); return; }
      if (!barReturnQuantityWithinRemaining(quantity, line.remaining_quantity)) { setError(`Return quantity for ${String(line.name)} exceeds the remaining returnable quantity. Refresh the receipt before trying again.`); return; }
    }
    if (!returnDraft.reason.trim()) { setError('Enter a reason for the return.'); return; }
    if (!/^\d{4,12}$/.test(returnApprovalPin)) { setError('A manager must enter their numeric PIN to approve this return.'); return; }
    if (busy || pending) return;
    const payload = {
      sale_id: selectedSale.sale_id,
      reason: returnDraft.reason.trim(),
      disposition: returnDraft.disposition,
      lines: selectedLines.map(({ line, quantity }) => ({ sale_line_id: String(line.sale_line_id), quantity }))
    };
    const operationId = crypto.randomUUID();
    setBusy(true);
    try {
      const approval = await window.api.pos.barLocal.requestApproval('sale.return', payload, returnApprovalPin, { operationId });
      setReturnApprovalPin('');
      await runCommand('sale.return', { ...payload, approval_id: approval.approval_id }, null, () => {
        setReturnDraft({ lineQuantities: {}, reason: '', disposition: 'restock' });
        setPanelVersion((version) => version + 1);
      }, operationId, true);
    } catch (cause) {
      setReturnApprovalPin('');
      setError(getMessage(cause));
    } finally { setBusy(false); }
  };

  const submitSaleVoid = async () => {
    setError(''); setNotice('');
    if (getReadinessState(readiness) !== 'ready') { setError('Trading is paused until the local Bar server readiness check succeeds. Keep this void and check readiness.'); return; }
    if (!selectedSale) { setError('Select a sale before preparing a void.'); return; }
    if (!canVoidRemainingBarSale(selectedSale)) { setError('This receipt has no remaining sale or tip to cancel. Refresh and check the original receipt.'); return; }
    if (!returnDraft.reason.trim()) { setError('Enter a reason before voiding the sale.'); return; }
    if (!/^\d{4,12}$/.test(returnApprovalPin)) { setError('A different manager must enter their numeric PIN.'); return; }
    if (busy || pending) return;
    if (!window.confirm(`Cancel the remaining items and unallocated tip on receipt ${String(selectedSale.receipt_number)}? Already returned items will not be refunded again. The original drawer must still be open.`)) return;
    const payload = { sale_id: selectedSale.sale_id, reason: returnDraft.reason.trim() };
    const operationId = crypto.randomUUID();
    setBusy(true);
    try {
      const approval = await window.api.pos.barLocal.requestApproval('sale.void', payload, returnApprovalPin, { operationId });
      setReturnApprovalPin('');
      await runCommand('sale.void', { ...payload, approval_id: approval.approval_id }, null, null, operationId, true);
    } catch (cause) {
      setReturnApprovalPin('');
      setError(getMessage(cause));
    } finally { setBusy(false); }
  };

  const submitPostCloseReturn = async (event) => {
    event.preventDefault(); setError(''); setNotice('');
    if (getReadinessState(readiness) !== 'ready') { setError('Trading is paused until the local Bar server readiness check succeeds. Keep this correction and check readiness.'); return; }
    if (!selectedSale) { setError('Select a closed-day original sale before preparing a correction.'); return; }
    if (!canPostCloseReturnBarSaleLines(selectedSale)) { setError(barPostCloseCorrectionBlockedMessage(selectedSale) || 'This receipt has no remaining items to correct.'); return; }
    const selectedLines = (Array.isArray(selectedSale.lines) ? selectedSale.lines : [])
      .map((line) => ({ line, quantity: String(returnDraft.lineQuantities[String(line.sale_line_id)] ?? '').trim() }))
      .filter(({ quantity }) => quantity !== '');
    if (selectedLines.length === 0) { setError('Enter a correction quantity for at least one remaining sale line.'); return; }
    for (const { line, quantity } of selectedLines) {
      if (!QUANTITY_SIX.test(quantity) || Number(quantity) <= 0) { setError('Each correction quantity must be greater than zero with up to six decimals.'); return; }
      if (!barReturnQuantityWithinRemaining(quantity, line.remaining_quantity)) { setError(`Correction quantity for ${String(line.name)} exceeds the remaining quantity. Refresh the receipt before trying again.`); return; }
    }
    if (!returnDraft.reason.trim()) { setError('Enter a reason for the post-close correction.'); return; }
    if (!/^\d{4,12}$/.test(returnApprovalPin)) { setError('A manager must enter their numeric PIN to approve this correction.'); return; }
    if (busy || pending) return;
    if (!window.confirm(`Post a current-date compensating return for closed receipt ${String(selectedSale.receipt_number)}? The original receipt and its closed business date will not be changed.`)) return;
    const payload = {
      sale_id: selectedSale.sale_id,
      kind: 'return',
      reason: returnDraft.reason.trim(),
      disposition: returnDraft.disposition,
      lines: selectedLines.map(({ line, quantity }) => ({ sale_line_id: String(line.sale_line_id), quantity }))
    };
    const operationId = crypto.randomUUID();
    setBusy(true);
    try {
      const approval = await window.api.pos.barLocal.requestApproval('sale.correct_after_close', payload, returnApprovalPin, { operationId });
      if (!approval?.approval_id) throw new Error('Manager approval was not confirmed. Nothing was submitted.');
      setReturnApprovalPin('');
      await runCommand('sale.correct_after_close', { ...payload, approval_id: approval.approval_id }, null, () => {
        setReturnDraft({ lineQuantities: {}, reason: '', disposition: 'restock' });
        setPanelVersion((version) => version + 1);
      }, operationId, true);
    } catch (cause) {
      setReturnApprovalPin('');
      setError(getMessage(cause));
    } finally { setBusy(false); }
  };

  const submitPostCloseVoid = async () => {
    setError(''); setNotice('');
    if (getReadinessState(readiness) !== 'ready') { setError('Trading is paused until the local Bar server readiness check succeeds. Keep this correction and check readiness.'); return; }
    if (!selectedSale) { setError('Select a closed-day original sale before preparing a correction.'); return; }
    if (!canPostCloseSelectedSale) { setError(barPostCloseCorrectionBlockedMessage(selectedSale) || 'This receipt has no remaining sale or tip to cancel.'); return; }
    if (!returnDraft.reason.trim()) { setError('Enter a reason before cancelling the remaining closed-day sale.'); return; }
    if (!/^\d{4,12}$/.test(returnApprovalPin)) { setError('A manager must enter their numeric PIN to approve this correction.'); return; }
    if (busy || pending) return;
    if (!window.confirm(`Post a current-date cancellation for the remaining items and unallocated tip on closed receipt ${String(selectedSale.receipt_number)}? The original receipt and its closed business date will not be changed.`)) return;
    const payload = { sale_id: selectedSale.sale_id, kind: 'void', reason: returnDraft.reason.trim() };
    const operationId = crypto.randomUUID();
    setBusy(true);
    try {
      const approval = await window.api.pos.barLocal.requestApproval('sale.correct_after_close', payload, returnApprovalPin, { operationId });
      if (!approval?.approval_id) throw new Error('Manager approval was not confirmed. Nothing was submitted.');
      setReturnApprovalPin('');
      await runCommand('sale.correct_after_close', { ...payload, approval_id: approval.approval_id }, null, () => {
        setReturnDraft({ lineQuantities: {}, reason: '', disposition: 'restock' });
        setPanelVersion((version) => version + 1);
      }, operationId, true);
    } catch (cause) {
      setReturnApprovalPin('');
      setError(getMessage(cause));
    } finally { setBusy(false); }
  };

  const closeShift = (event) => {
    event.preventDefault(); setError('');
    if (!shift) return;
    if (!MONEY_TWO.test(cashupDraft.counted_cash)) { setError('Counted cash must be a non-negative amount with up to two decimal places.'); return; }
    void runCommand('shift.close', {
      shift_id: shift.shift_id,
      counted_cash: cashupDraft.counted_cash.trim(),
      note: cashupDraft.notes.trim() || undefined
    });
  };

  const submitCashup = (event) => {
    event.preventDefault(); setError('');
    if (!closedShift) { setError('Close the shift before submitting the cash-up.'); return; }
    if (!MONEY_TWO.test(cashupDraft.counted_cash)) { setError('Counted cash must be a non-negative amount with up to two decimal places.'); return; }
    if (cashupDraft.counted_card.trim() && !MONEY_TWO.test(cashupDraft.counted_card)) { setError('Counted card must be a non-negative amount with up to two decimal places.'); return; }
    void runCommand('cashup.submit', {
      shift_id: closedShift.shift_id,
      counted_cash: cashupDraft.counted_cash.trim(),
      counted_card: cashupDraft.counted_card.trim() || undefined,
      notes: cashupDraft.notes.trim() || undefined,
      proof_refs: []
    });
  };

  const submitCashupReview = async (event) => {
    event.preventDefault(); setError(''); setNotice('');
    if (!review || review.status !== 'submitted') { setError('Refresh the cash-up summary; only a submitted cash-up can be reviewed.'); return; }
    if (!canCashup) { setError('Your role cannot review cash-ups.'); return; }
    if (!cashupReviewDraft.reason.trim()) { setError('Enter a reason for the cash-up decision.'); return; }
    if (!/^\d{4,12}$/.test(cashupReviewDraft.pin)) { setError('A different manager must enter their numeric PIN.'); return; }
    if (busy || pending || cashupApprovalBusy) return;
    const payload = { cashup_id: review.cashup_id, decision: cashupReviewDraft.decision, reason: cashupReviewDraft.reason.trim() };
    const operationId = crypto.randomUUID();
    setCashupApprovalBusy(true);
    try {
      const approval = await window.api.pos.barLocal.requestApproval('cashup.review', payload, cashupReviewDraft.pin, { operationId });
      setCashupReviewDraft((draft) => ({ ...draft, pin: '' }));
      await runCommand('cashup.review', { ...payload, approval_id: approval.approval_id }, null, null, operationId);
    } catch (cause) {
      setCashupReviewDraft((draft) => ({ ...draft, pin: '' }));
      setError(getMessage(cause));
    } finally { setCashupApprovalBusy(false); }
  };

  const submitCashupReopen = async (event) => {
    event.preventDefault(); setError(''); setNotice('');
    if (!review || !['approved', 'rejected'].includes(String(review.status))) { setError('Refresh the cash-up summary; only a reviewed cash-up can be reopened.'); return; }
    if (!canCashup) { setError('Your role cannot reopen cash-ups.'); return; }
    if (!MONEY_TWO.test(cashupReopenDraft.counted_cash) || !MONEY_TWO.test(cashupReopenDraft.counted_card)) { setError('Enter valid non-negative cash and card counts with up to two decimal places.'); return; }
    if (!cashupReopenDraft.reason.trim()) { setError('Enter why this reviewed cash-up must be reopened.'); return; }
    if (!/^\d{4,12}$/.test(cashupReopenDraft.pin)) { setError('A different manager must enter their numeric PIN.'); return; }
    if (busy || pending || cashupApprovalBusy) return;
    const payload = {
      cashup_id: review.cashup_id,
      expected_status: review.status,
      counted_cash: cashupReopenDraft.counted_cash.trim(),
      counted_card: cashupReopenDraft.counted_card.trim(),
      notes: cashupReopenDraft.notes.trim() || undefined,
      proof_refs: cashupReopenDraft.proof_ref.trim() ? [cashupReopenDraft.proof_ref.trim()] : [],
      reason: cashupReopenDraft.reason.trim()
    };
    const operationId = crypto.randomUUID();
    setCashupApprovalBusy(true);
    try {
      const approval = await window.api.pos.barLocal.requestApproval('cashup.reopen', payload, cashupReopenDraft.pin, { operationId });
      setCashupReopenDraft((draft) => ({ ...draft, pin: '' }));
      await runCommand('cashup.reopen', { ...payload, approval_id: approval.approval_id }, null, null, operationId);
      setCashupReopenDraft({ counted_cash: '', counted_card: '0.00', notes: '', proof_ref: '', reason: '', pin: '' });
    } catch (cause) {
      setCashupReopenDraft((draft) => ({ ...draft, pin: '' }));
      setError(getMessage(cause));
    } finally { setCashupApprovalBusy(false); }
  };

  const recordDrawerMovement = (event) => {
    event.preventDefault(); setError('');
    const counting = drawerDraft.type === 'count';
    if (!shift) { setError('Open a shift before recording drawer cash or a count.'); return; }
    if (!MONEY_TWO.test(drawerDraft.amount) || Number(drawerDraft.amount) < 0 || (!counting && Number(drawerDraft.amount) === 0)) { setError(counting ? 'Enter counted cash of zero or more with up to two decimal places.' : 'Enter an amount greater than zero with up to two decimal places.'); return; }
    if (!drawerDraft.reason.trim()) { setError(counting ? 'Enter a note for this physical cash count.' : 'Enter the reason for this drawer movement.'); return; }
    void runCommand('drawer.movement', {
      shift_id: shift.shift_id,
      type: drawerDraft.type,
      amount: drawerDraft.amount.trim(),
      reason: drawerDraft.reason.trim()
    });
  };

  const createCashier = (event) => {
    event.preventDefault(); setError('');
    if (!staffDraft.display_name.trim()) { setError('Enter the staff member’s name.'); return; }
    if (!/^\d{4,12}$/.test(staffDraft.pin)) { setError('The staff PIN must contain 4–12 digits.'); return; }
    void runCommand('staff.create', { display_name: staffDraft.display_name.trim(), role: staffDraft.role, pin: staffDraft.pin }, null, () => {
      setStaffDraft({ display_name: '', role: 'cashier', pin: '' });
    });
  };

  const generatePairingCode = async () => {
    if (busy || pending || pairingBusy) return;
    setPairingBusy(true); setError(''); setNotice('');
    try {
      const result = await window.api.pos.barLocal.startPairing({ ttl_seconds: 300 });
      if (result?.ok !== true || typeof result.pairing_code !== 'string' || !Number.isSafeInteger(result.expires_in)) {
        throw new Error('The local authority returned an invalid pairing response. No code was shown.');
      }
      if (typeof result.server_certificate_fingerprint !== 'string' || !result.server_certificate_fingerprint) throw new Error('A secure LAN certificate is required before another till can join. Use the main Bar computer to finish network setup.');
      setPairingCode({ code: result.pairing_code, expiresAt: Date.now() + result.expires_in * 1000, fingerprint: result.server_certificate_fingerprint, addresses: Array.isArray(result.server_addresses) ? result.server_addresses : [] });
      setNotice('A single-use pairing code is ready. Share it only with the till being paired.');
    } catch (cause) { setError(getMessage(cause)); }
    finally { setPairingBusy(false); }
  };

  const signOut = async () => {
    setBusy(true); setError('');
    try { await window.api.pos.barLocal.logout(); setStaff(null); setProducts([]); setCashierPromotions([]); setDiscountPolicy(null); setPromotionCode(''); setDiscountApprovalPin(''); setShift(null); setCart([]); setOpenTabs([]); setSelectedTab(null); setSales([]); setSelectedSale(null); setStock([]); setReport(null); setCashupSummary(null); setClosedShift(null); }
    catch (cause) { setError(getMessage(cause)); }
    finally { setBusy(false); }
  };

  const printReceipt = async (receipt) => {
    const saleId = receipt?.sale_id;
    if (typeof saleId !== 'string') { setError('This receipt has no verified sale ID. Retrieve it again before printing.'); return; }
    setError(''); setNotice('');
    try {
      const result = await window.api.pos.barLocal.printReceipt(saleId);
      if (result?.success !== true) throw new Error(result?.error || 'The configured receipt printer did not accept the receipt.');
      if (String(result.message || '').toLowerCase().includes('browser print')) {
        setLastReceipt(receipt);
        window.setTimeout(() => window.print(), 0);
      } else setNotice(result.message || 'The verified local receipt was sent to the configured printer.');
    } catch (cause) { setError(getMessage(cause)); }
  };

  if (!staff) return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
      <form onSubmit={signIn} className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-8 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">Legacy · local Bar authority</p>
        <h1 className="mt-3 text-2xl font-bold">Local Bar sign in</h1>
        <BarReplacementConnection onConnect={request => window.api.pos.barLocal.reconnectServer(request)} />
        <p className="mt-2 text-sm text-slate-300">Owner and staff sign-ins work offline through the paired Bar service. This till is paired with outlet {authority.outlet_id}.</p>
        {authority?.blocked_reason && <p role="alert" className="mt-4 rounded border border-red-700 bg-red-950 p-3 text-sm text-red-100">{String(authority.blocked_reason.message || 'The local Bar authority is blocked. Trading is paused until it is repaired.')}</p>}
        {pending && <p role="status" className="mt-4 rounded border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-100">Saved operation {pending.operation_id} ({pending.command}) from earlier is unresolved. After signing in, use Check status or Retry same operation before trading. Do not start a new sale.</p>}
        <div className="mt-5 flex gap-2" role="tablist" aria-label="Local Bar sign in type">
          <button type="button" role="tab" aria-selected={loginMode === 'staff'} onClick={() => { setLoginMode('staff'); setError(''); }} className={`flex-1 rounded border p-2 text-sm ${loginMode === 'staff' ? 'border-amber-400 bg-amber-950' : 'border-slate-700'}`}>Staff PIN</button>
          <button type="button" role="tab" aria-selected={loginMode === 'owner'} onClick={() => { setLoginMode('owner'); setError(''); }} className={`flex-1 rounded border p-2 text-sm ${loginMode === 'owner' ? 'border-amber-400 bg-amber-950' : 'border-slate-700'}`}>Owner email</button>
        </div>
        {loginMode === 'staff' ? <>
          <label className="mt-4 block text-sm">Staff ID<input required value={staffId} onChange={(event) => setStaffId(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-3" autoComplete="username" /></label>
          <label className="mt-3 block text-sm">PIN<input required type="password" inputMode="numeric" pattern="[0-9]{4,12}" value={pin} onChange={(event) => setPin(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-3" autoComplete="current-password" /></label>
        </> : <>
          <label className="mt-4 block text-sm">Owner email<input required type="email" maxLength={254} value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-3" autoComplete="username" /></label>
          <label className="mt-3 block text-sm">Password<input required type="password" minLength={12} maxLength={128} value={ownerPassword} onChange={(event) => setOwnerPassword(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-3" autoComplete="current-password" /></label>
        </>}
        {error && <p role="alert" className="mt-4 rounded bg-red-950 p-3 text-sm text-red-200">{error}</p>}
        <button disabled={busy || Boolean(authority?.blocked_reason) || (loginMode === 'owner' && ownerPassword.length < 12)} className="mt-5 w-full rounded bg-amber-500 p-3 font-semibold text-slate-950 disabled:opacity-50">{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );

  const review = cashupSummary?.cashup || null;
  const reportTenders = Array.isArray(report?.by_tender) ? report.by_tender : Array.isArray(report?.tenders) ? report.tenders : [];
  const reportDays = Array.isArray(report?.by_day) ? report.by_day : Array.isArray(report?.days) ? report.days : [];
  const tabTotalCents = selectedTab ? moneyToCents(selectedTab.gross_total) : null;
  const tabTenderEvaluation = evaluateTenders({ totalCents: tabTotalCents ?? 0, rows: tabSettleRows });
  const openTabLines = selectedTab && Array.isArray(selectedTab.lines) ? selectedTab.lines.filter((line) => line.status === 'open') : [];
  const otherOpenTabs = openTabs.filter((tab) => String(tab.tab_id) !== String(selectedTabId));
  const activeStaffRows = staffRows.filter((row) => row.status === 'active');

  return (
    <main className="min-h-screen bg-slate-950 p-5 text-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between border-b border-slate-700 pb-4"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">Bar · local workspace</p><h1 className="mt-1 text-xl font-bold">Legacy local counter</h1><p className="text-sm text-slate-300">{staff.display_name} · Outlet {authority.outlet_id}</p></div><button type="button" disabled={busy || Boolean(pending)} onClick={signOut} className="rounded border border-slate-600 px-4 py-2 text-sm">Sign out</button></header>
      <div className="mx-auto mt-5 max-w-6xl">
        <section aria-label="Local Bar readiness" className={`rounded border p-3 text-sm ${readinessState === 'ready' ? 'border-emerald-700 bg-emerald-950/40 text-emerald-200' : readinessState === 'blocked' || readinessState === 'stale' ? 'border-amber-700 bg-amber-950/40 text-amber-100' : 'border-red-800 bg-red-950/40 text-red-200'}`}>
          <p role="status" aria-live="polite">{describeReadiness(readinessState, readiness)}</p>
          {canManageSettings && readinessState === 'blocked' && <p className="mt-1 text-xs">Manager check: {(readiness?.blockers || []).join(', ') || 'Check server diagnostics in Administration.'}</p>}
          {Number.isFinite(readiness?.checkedAt) && <p className="mt-1 text-xs opacity-80">Last successful authenticated check: {new Date(/** @type {number} */ (/** @type {BarLocalReadinessView} */ (readiness).checkedAt)).toLocaleTimeString()}.</p>}
        </section>
        {catalogueSyncError && <p role="alert" className="mt-2 rounded border border-red-700 bg-red-950/50 p-3 text-sm text-red-100">{catalogueSyncError}</p>}
        <nav className="mt-4 flex flex-wrap gap-2">{panels.map((panel) => <button key={panel.id} type="button" onClick={() => { setActiveTab(panel.id); setError(''); }} className={`rounded border px-4 py-2 text-sm ${activeTab === panel.id ? 'border-amber-400 bg-amber-500 font-semibold text-slate-950' : 'border-slate-700 bg-slate-900 text-slate-200'}`}>{panel.label}</button>)}</nav>

        {activeTab === 'counter' && <div>
          {canManageMenu && <form onSubmit={saveProduct} className="mt-4 rounded-xl border border-slate-700 bg-slate-900 p-4"><h2 className="font-semibold">{menuDraft.productId ? 'Edit local product' : 'Add a local product'}</h2><p className="mt-1 text-xs text-slate-400">Saved by the local authority. Tax multiplier 0.14 means 14%. Stock-tracked items require a separate stock receipt before they can sell.</p><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <label className="text-xs">SKU<input required maxLength={80} value={menuDraft.sku} onChange={(event) => setMenuDraft((draft) => ({ ...draft, sku: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            <label className="text-xs">Name<input required maxLength={200} value={menuDraft.name} onChange={(event) => setMenuDraft((draft) => ({ ...draft, name: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            <label className="text-xs">Category<input maxLength={80} value={menuDraft.category} onChange={(event) => setMenuDraft((draft) => ({ ...draft, category: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            <label className="text-xs">Price<input required inputMode="decimal" value={menuDraft.price} onChange={(event) => setMenuDraft((draft) => ({ ...draft, price: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            <label className="text-xs">Tax multiplier<input required inputMode="decimal" value={menuDraft.taxRate} onChange={(event) => setMenuDraft((draft) => ({ ...draft, taxRate: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
          </div><label className="mt-3 inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={menuDraft.trackStock} onChange={(event) => setMenuDraft((draft) => ({ ...draft, trackStock: event.target.checked }))} />Track stock</label>{menuDraft.productId && <label className="ml-4 inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={menuDraft.active} onChange={(event) => setMenuDraft((draft) => ({ ...draft, active: event.target.checked }))} />Active on menu</label>}<button disabled={busy || Boolean(pending)} className="ml-4 rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">{menuDraft.productId ? 'Save changes' : 'Save product'}</button>{menuDraft.productId && <button type="button" disabled={busy || Boolean(pending)} onClick={() => setMenuDraft({ productId: '', expectedVersion: '', sku: '', name: '', category: '', price: '', taxRate: '0.00', trackStock: true, active: true })} className="ml-2 rounded border border-slate-600 px-4 py-2 text-sm">Cancel edit</button>}</form>}
          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_22rem]">
            <section>
              {!shift ? <form onSubmit={openShift} className="rounded-xl border border-amber-800 bg-amber-950/30 p-5"><h2 className="font-semibold">Open your shift</h2><label className="mt-3 block text-sm">Opening cash float<input value={openingFloat} onChange={(event) => setOpeningFloat(event.target.value)} inputMode="decimal" className="mt-1 block w-48 rounded bg-slate-800 p-2" /></label><button disabled={busy || Boolean(pending) || !canManageTill || !localReady} className="mt-3 rounded bg-amber-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50">Open shift</button>{!localReady && <p className="mt-2 text-xs text-amber-200">Opening is paused until authenticated local readiness passes{readiness?.blockers?.length ? `: ${readiness.blockers.join(', ')}` : '.'}</p>}{!canManageTill && <p className="mt-2 text-xs text-amber-200">Your role cannot open a trading shift.</p>}</form> : <><h2 className="mb-3 font-semibold">Available products</h2><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{products.map((product) => <button key={product.product_id} type="button" disabled={busy || Boolean(pending) || Boolean(catalogueSyncError)} onClick={() => setCart((lines) => { const existing = lines.find((line) => line.product.product_id === product.product_id && (line.modifiers || []).length === 0); return existing ? lines.map((line) => line.cartId === existing.cartId ? { ...line, quantity: line.quantity + 1 } : line) : [...lines, { cartId: crypto.randomUUID(), product, quantity: 1, modifiers: [] }]; })} className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-left hover:border-amber-500"><span className="block font-semibold">{product.name}</span><span className="mt-1 block text-sm text-slate-300">{product.price} · {product.category || 'Bar'}</span></button>)}</div>{products.length === 0 && <p className="rounded border border-amber-800 p-4 text-sm">No available local products. Ask a manager to publish the menu before trading.</p>}</>}
            </section>
            <aside className="h-fit rounded-xl border border-slate-700 bg-slate-900 p-4"><h2 className="font-semibold">Current sale</h2><ul className="mt-3 space-y-3">{cart.map((line) => <li key={line.cartId} className="border-b border-slate-700 pb-3 text-sm"><div className="flex justify-between gap-3"><span>{line.product.name} × {line.quantity}</span><button type="button" disabled={Boolean(pending)} onClick={() => setCart((lines) => lines.filter((item) => item.cartId !== line.cartId))} className="text-amber-300">Remove</button></div>{(Array.isArray(line.product.modifier_groups) ? line.product.modifier_groups : []).map((group) => <fieldset key={group.modifier_group_id || group.group_id} className="mt-2 rounded border border-slate-700 p-2"><legend className="px-1 text-xs text-slate-300">{group.name}{group.required ? ' · required' : ''}</legend>{(Array.isArray(group.options) ? group.options : []).map((option) => { const id = String(option.option_id || option.modifier_option_id); return <label key={id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={(line.modifiers || []).includes(id)} disabled={busy || Boolean(pending)} onChange={(event) => toggleModifier(line.cartId, id, event.target.checked, group)} /><span>{option.name}{Number(option.price_delta) ? ` (+${Number(option.price_delta).toFixed(2)})` : ''}</span></label>; })}</fieldset>)}</li>)}</ul><label className="mt-4 block text-xs">Promotion code (optional)<input maxLength={32} autoComplete="off" value={promotionCode} onChange={(event) => setPromotionCode(event.target.value.toUpperCase())} disabled={busy || Boolean(pending) || !canApplyDiscount} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>{promotionApprovalRequired && <p className="mt-2 text-xs text-amber-200">A different manager must approve the exact sale because this promotion exceeds the local approval threshold.</p>}{promotionApprovalRequired && <label className="mt-3 block text-xs">Different manager PIN<input required type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={discountApprovalPin} onChange={(event) => setDiscountApprovalPin(event.target.value.replace(/\D/g, ""))} disabled={discountApprovalBusy || busy || Boolean(pending)} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>}<div className="mt-4 border-t border-slate-700 pt-3"><p className="flex justify-between font-semibold"><span>Estimated amount</span><span>{total === null ? '—' : formatBarLocalMoney(total)}</span></p>{saleEstimate && discountPolicy && exceedsDiscountMaximum(saleEstimate.promotionDiscountCents, saleEstimate.subtotalCents, discountPolicy.maximum_percent) && <p role="alert" className="mt-2 text-xs text-red-200">This promotion exceeds the configured maximum discount and cannot be applied.</p>}{cart.length > 0 && total === null && !(saleEstimate && discountPolicy && exceedsDiscountMaximum(saleEstimate.promotionDiscountCents, saleEstimate.subtotalCents, discountPolicy.maximum_percent)) && <p role="alert" className="mt-2 text-xs text-amber-200">Check modifier choices and verify that the promotion is active and applies to this sale.</p>}<p className="mt-2 text-xs text-slate-400">Prices and promotion totals are estimates; the local authority rechecks the code, dates, scope, minimum, discount policy, tender evidence and stock atomically before commit.</p>{total !== null && cart.length > 0 && <BarLocalTenderEditor totalCents={saleTotalCents ?? 0} rows={saleTenderRows} onChange={setSaleTenderRows} disabled={busy || Boolean(pending) || Boolean(catalogueSyncError) || discountApprovalBusy || !localReady || !canManageTill || !shift} customers={customers} canUseStoreCredit={canManageCustomers} canUseVoucher={canManageVouchers} />}<button type="button" disabled={busy || Boolean(pending) || Boolean(catalogueSyncError) || discountApprovalBusy || Boolean(saleTenderEvaluation.error) || (promotionApprovalRequired && !/^\d{4,12}$/.test(discountApprovalPin)) || !localReady || !canManageTill || !shift || !cart.length || total === null} onClick={commitSale} className="mt-4 w-full rounded bg-emerald-600 p-3 font-semibold disabled:opacity-40">{promotionApprovalRequired ? 'Approve and commit sale' : 'Commit sale'}</button>{!canManageTill && <p className="mt-2 text-xs text-amber-200">Your role cannot commit sales.</p>}</div></aside>
          </div>
        </div>}

        {activeTab === 'tabs' && <section className="mt-5 grid gap-5 lg:grid-cols-[1fr_24rem]">
          <div>
            <div className="flex items-center justify-between"><h2 className="font-semibold">Open tabs</h2><button type="button" disabled={busy || Boolean(pending)} onClick={() => setPanelVersion((version) => version + 1)} className="rounded border border-slate-600 px-3 py-1 text-xs">Refresh</button></div>
            {openTabs.length === 0 ? <p className="mt-3 rounded border border-slate-700 p-4 text-sm text-slate-300">No open tabs. Open a tab to hold a bar order.</p> : <ul className="mt-3 space-y-2">{openTabs.map((tab) => <li key={tab.tab_id}><button type="button" disabled={busy || Boolean(pending)} onClick={() => selectTab(tab.tab_id)} className={`w-full rounded border p-3 text-left ${selectedTabId === tab.tab_id ? 'border-amber-400 bg-amber-950/30' : 'border-slate-700 bg-slate-900'}`}><span className="flex justify-between gap-3"><span className="font-semibold">{tab.table_label || 'Unlabelled tab'} · v{tab.version}</span><span>{displayMoney(tab.gross_total)}</span></span><span className="mt-1 block text-xs text-slate-400">{tab.owner_name} · {tab.line_count} open line(s)</span></button></li>)}</ul>}
            <form onSubmit={openTab} className="mt-4 rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="font-semibold">Open a new tab</h3><div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-xs">Table label<input maxLength={120} value={tabDraft.table_label} onChange={(event) => setTabDraft((draft) => ({ ...draft, table_label: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Note<input maxLength={1000} value={tabDraft.note} onChange={(event) => setTabDraft((draft) => ({ ...draft, note: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label></div><button disabled={busy || Boolean(pending) || !shift} className="mt-3 rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">Open tab</button></form>
          </div>
          <aside className="h-fit rounded-xl border border-slate-700 bg-slate-900 p-4">
            {!selectedTab ? <p className="text-sm text-slate-300">Select an open tab to add the current cart, settle with split payment, transfer ownership, split selected lines or merge tabs.</p> : <div>
              <h3 className="font-semibold">{selectedTab.table_label || 'Unlabelled tab'}</h3>
              <p className="mt-1 text-xs text-slate-400">Status {selectedTab.status} · version {selectedTab.version} · amount due {displayMoney(selectedTab.gross_total)}</p>
              <ul className="mt-3 space-y-1 text-sm">{openTabLines.map((line) => <li key={line.tab_line_id} className="flex justify-between gap-3"><span>{line.name} × {line.quantity}</span><span>{displayMoney(line.line_total)}</span></li>)}</ul>
              {openTabLines.length === 0 && <p className="mt-2 text-sm text-slate-300">This tab has no open lines.</p>}
              <p className="mt-3 text-xs text-slate-400">Current cart: {cart.length} line(s), estimate {total === null ? '—' : formatBarLocalMoney(total)}.</p>
              <button type="button" disabled={busy || Boolean(pending) || Boolean(catalogueSyncError) || !shift || !cart.length || selectedTab.status !== 'open'} onClick={addCartToTab} className="mt-3 w-full rounded bg-sky-600 p-2 text-sm font-semibold disabled:opacity-40">Add current cart to tab</button>

              {selectedTab.status === 'open' && <>
                <BarLocalTenderEditor totalCents={tabTotalCents ?? 0} rows={tabSettleRows} onChange={setTabSettleRows} disabled={busy || Boolean(pending) || tabActionBusy || !localReady || !shift} customers={customers} canUseStoreCredit={canManageCustomers} canUseVoucher={canManageVouchers} />
                <button type="button" disabled={busy || Boolean(pending) || tabActionBusy || !localReady || !shift || Boolean(tabTenderEvaluation.error) || tabTenderEvaluation.tenders.length === 0} onClick={settleTab} className="mt-1 w-full rounded bg-emerald-600 p-2 text-sm font-semibold disabled:opacity-40">Settle tab with this payment</button>

                <details className="mt-4 rounded border border-slate-700 p-3">
                  <summary className="cursor-pointer text-sm font-semibold">Transfer ownership</summary>
                  <form onSubmit={transferTab} className="mt-2 space-y-2">
                    <label className="block text-xs">New owner<select value={tabTransferDraft.target_staff_id} onChange={(event) => setTabTransferDraft((draft) => ({ ...draft, target_staff_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select active staff</option>{activeStaffRows.map((row) => <option key={row.staff_id} value={row.staff_id}>{row.display_name} · {row.role}</option>)}</select></label>
                    <label className="block text-xs">Reason<input maxLength={300} value={tabTransferDraft.reason} onChange={(event) => setTabTransferDraft((draft) => ({ ...draft, reason: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
                    <label className="block text-xs">Different manager PIN<input type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={tabTransferDraft.pin} onChange={(event) => setTabTransferDraft((draft) => ({ ...draft, pin: event.target.value.replace(/\D/g, '') }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
                    <button disabled={busy || Boolean(pending) || tabActionBusy || !localReady || !shift || !tabTransferDraft.target_staff_id || !/^\d{4,12}$/.test(tabTransferDraft.pin)} className="w-full rounded border border-amber-600 p-2 text-sm font-semibold disabled:opacity-40">Approve and transfer tab</button>
                  </form>
                </details>

                <details className="mt-3 rounded border border-slate-700 p-3">
                  <summary className="cursor-pointer text-sm font-semibold">Split selected lines into a new tab</summary>
                  <form onSubmit={splitTab} className="mt-2 space-y-2">
                    <fieldset>
                      <legend className="text-xs text-slate-400">Open lines to move</legend>
                      <div className="mt-1 space-y-1">{openTabLines.map((line) => <label key={line.tab_line_id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={tabSplitSelection.includes(String(line.tab_line_id))} onChange={() => toggleTabSplitLine(String(line.tab_line_id))} />{line.name} × {line.quantity} — {displayMoney(line.line_total)}</label>)}</div>
                    </fieldset>
                    <label className="block text-xs">New tab owner (optional)<select value={tabSplitDraft.target_owner_staff_id} onChange={(event) => setTabSplitDraft((draft) => ({ ...draft, target_owner_staff_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Keep current owner</option>{activeStaffRows.map((row) => <option key={row.staff_id} value={row.staff_id}>{row.display_name}</option>)}</select></label>
                    <div className="grid gap-2 sm:grid-cols-2"><label className="text-xs">New table label<input maxLength={120} value={tabSplitDraft.table_label} onChange={(event) => setTabSplitDraft((draft) => ({ ...draft, table_label: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Note<input maxLength={1000} value={tabSplitDraft.note} onChange={(event) => setTabSplitDraft((draft) => ({ ...draft, note: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label></div>
                    <label className="block text-xs">Reason<input maxLength={300} value={tabSplitDraft.reason} onChange={(event) => setTabSplitDraft((draft) => ({ ...draft, reason: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
                    <label className="block text-xs">Different manager PIN<input type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={tabSplitDraft.pin} onChange={(event) => setTabSplitDraft((draft) => ({ ...draft, pin: event.target.value.replace(/\D/g, '') }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
                    <button disabled={busy || Boolean(pending) || tabActionBusy || !localReady || !shift || tabSplitSelection.length === 0 || !/^\d{4,12}$/.test(tabSplitDraft.pin)} className="w-full rounded border border-amber-600 p-2 text-sm font-semibold disabled:opacity-40">Approve and split tab</button>
                  </form>
                </details>

                <details className="mt-3 rounded border border-slate-700 p-3">
                  <summary className="cursor-pointer text-sm font-semibold">Merge this tab into another</summary>
                  <form onSubmit={mergeTab} className="mt-2 space-y-2">
                    <label className="block text-xs">Target tab<select value={tabMergeTargetId} onChange={(event) => setTabMergeTargetId(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select another open tab</option>{otherOpenTabs.map((tab) => <option key={tab.tab_id} value={tab.tab_id}>{tab.table_label || 'Unlabelled tab'} — {displayMoney(tab.gross_total)}</option>)}</select></label>
                    <label className="block text-xs">Reason<input maxLength={300} value={tabMergeDraft.reason} onChange={(event) => setTabMergeDraft((draft) => ({ ...draft, reason: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
                    <label className="block text-xs">Different manager PIN<input type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={tabMergeDraft.pin} onChange={(event) => setTabMergeDraft((draft) => ({ ...draft, pin: event.target.value.replace(/\D/g, '') }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
                    <button disabled={busy || Boolean(pending) || tabActionBusy || !localReady || !shift || !tabMergeTargetId || !/^\d{4,12}$/.test(tabMergeDraft.pin)} className="w-full rounded border border-amber-600 p-2 text-sm font-semibold disabled:opacity-40">Approve and merge tab</button>
                  </form>
                </details>
              </>}
              <p className="mt-3 text-xs text-slate-400">The local authority reprices the tab, validates stock, customer credit and voucher liability, and records exact tender evidence. Version conflicts reject the whole operation; refresh and review the tab before retrying.</p>
            </div>}
          </aside>
        </section>}

        {activeTab === 'returns' && <section className="mt-5 grid gap-5 lg:grid-cols-2">
          <div>
            <div className="flex items-center justify-between"><h2 className="font-semibold">Recent sales</h2><button type="button" disabled={busy || Boolean(pending)} onClick={() => setPanelVersion((version) => version + 1)} className="rounded border border-slate-600 px-3 py-1 text-xs">Refresh</button></div>
            {sales.length === 0 ? <p className="mt-3 rounded border border-slate-700 p-4 text-sm text-slate-300">No recent sales are available for return.</p> : <ul className="mt-3 space-y-2">{sales.map((sale) => <li key={sale.sale_id}><button type="button" disabled={busy || Boolean(pending)} onClick={() => selectSale(sale.sale_id)} className={`w-full rounded border p-3 text-left ${selectedSaleId === sale.sale_id ? 'border-amber-400 bg-amber-950/30' : 'border-slate-700 bg-slate-900'}`}><span className="flex justify-between gap-3"><span className="font-semibold">Receipt {sale.receipt_number}</span><span>{displayMoney(sale.total)}</span></span><span className="mt-1 block text-xs text-slate-400">{sale.business_date} · {sale.status} {sale.original_sale_id ? '· return' : ''}</span></button></li>)}</ul>}
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h2 className="font-semibold">{selectedSaleClosed ? 'Correct a closed-day sale' : 'Return sale lines or void a sale'}</h2>
            {!selectedSale ? <p className="mt-3 text-sm text-slate-300">Select a sale to inspect its lines.</p> : <form onSubmit={selectedSaleClosed ? submitPostCloseReturn : submitReturn} className="mt-3">
              <p className="text-xs text-slate-400">Sale {selectedSale.receipt_number} · {selectedSale.business_date} · status {selectedSale.status} · total {displayMoney(selectedSale.total)}</p>
              {selectedSaleClosed && <div className="mt-3 rounded border border-amber-700 bg-amber-950/40 p-3 text-xs text-amber-100">
                <p className="font-semibold">Original receipt {selectedSale.receipt_number} · closed business date {selectedSale.business_date}</p>
                <p className="mt-1">This receipt stays unchanged. A correction posts a current-date compensating record{shift?.business_date ? ` to business date ${shift.business_date}` : ' to the current business date'}, keeps its audit trail, and cannot be edited afterwards.</p>
                <p className="mt-1">Unallocated tip still correctable: {displayMoney(selectedSale.post_close_tip_remaining)}.</p>
              </div>}
              {selectedSaleClosed && postCloseBlockedCopy && <p role="status" className="mt-3 rounded border border-rose-700 bg-rose-950/40 p-3 text-xs text-rose-100">{postCloseBlockedCopy}</p>}
              <button type="button" disabled={busy || Boolean(pending)} onClick={() => { setLastReceipt(selectedSale); void printReceipt(selectedSale); }} className="mt-3 rounded border border-emerald-600 px-3 py-2 text-sm">Print retrieved receipt</button>
              <p className="text-xs text-slate-400">{selectedSaleClosed ? 'Enter quantities for the remaining lines to compensate. Leave other lines blank; the local authority rechecks remaining quantity, drawer, period lock and approval atomically.' : 'Enter quantities for any lines to include them in one atomic return. Leave other lines blank; the local authority checks the remaining returnable quantity.'}</p>
              <div className="mt-3 space-y-2">{(selectedSale.lines || []).filter((line) => Number(line.quantity) > 0).map((line) => <label key={line.sale_line_id} className="grid grid-cols-[1fr_7rem] items-center gap-3 rounded border border-slate-800 p-2 text-xs"><span>{line.name} · sold {line.quantity} · remaining {line.remaining_quantity}{selectedSaleClosed && Number(line.post_close_corrected_quantity) > 0 ? ` · corrected ${line.post_close_corrected_quantity}` : ''} · {displayMoney(line.line_total)}</span><input aria-label={`${selectedSaleClosed ? 'Correction' : 'Return'} quantity for ${line.name}`} inputMode="decimal" value={returnDraft.lineQuantities[String(line.sale_line_id)] ?? ''} onChange={(event) => setReturnDraft((draft) => ({ ...draft, lineQuantities: { ...draft.lineQuantities, [String(line.sale_line_id)]: event.target.value } }))} disabled={Number(line.remaining_quantity) <= 0} className="w-full rounded bg-slate-800 p-2 text-sm disabled:opacity-40" /></label>)}</div>
              <label className="mt-3 block text-sm">Disposition<select value={returnDraft.disposition} onChange={(event) => setReturnDraft((draft) => ({ ...draft, disposition: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="restock">Restock</option><option value="waste">Waste</option></select></label>
              <label className="mt-3 block text-sm">Correction reason<textarea required maxLength={500} value={returnDraft.reason} onChange={(event) => setReturnDraft((draft) => ({ ...draft, reason: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
              <label className="mt-3 block text-sm">Approving manager PIN<input required inputMode="numeric" autoComplete="off" type="password" maxLength={12} value={returnApprovalPin} onChange={(event) => setReturnApprovalPin(event.target.value.replace(/\D/g, ''))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
              <p className="mt-3 rounded border border-amber-700 bg-amber-950/40 p-3 text-xs text-amber-100">{selectedSaleClosed ? 'A different active manager must enter their PIN. The local service verifies correction capability, the closed original shift, your open drawer and the accounting period, then binds a single-use approval to this exact correction. The original receipt and its closed business date are never rewritten.' : 'A different active manager must enter their PIN. The local service verifies correction capability and binds a single-use approval to this exact return or void and operation. Keep the original operation if its result is uncertain.'}</p>
              {selectedSaleClosed ? <>
                <button type="submit" disabled={busy || Boolean(pending) || !canPostCloseReturnBarSaleLines(selectedSale) || !Object.values(returnDraft.lineQuantities).some((value) => String(value).trim()) || !returnDraft.reason.trim() || !/^\d{4,12}$/.test(returnApprovalPin) || !localReady} className="mt-3 w-full rounded bg-emerald-700 p-2 text-sm font-semibold disabled:opacity-40">Approve and post current-date correction</button>
                <button type="button" disabled={busy || Boolean(pending) || !canPostCloseSelectedSale || !returnDraft.reason.trim() || !/^\d{4,12}$/.test(returnApprovalPin) || !localReady} onClick={() => void submitPostCloseVoid()} className="mt-2 w-full rounded border border-rose-700 p-2 text-sm font-semibold text-rose-200 disabled:opacity-40">Approve and cancel remaining closed-day sale / tip</button>
              </> : <>
                <button type="submit" disabled={busy || Boolean(pending) || !canReturnBarSaleLines(selectedSale) || !Object.values(returnDraft.lineQuantities).some((value) => String(value).trim()) || !returnDraft.reason.trim() || !/^\d{4,12}$/.test(returnApprovalPin) || !localReady} className="mt-3 w-full rounded bg-emerald-700 p-2 text-sm font-semibold disabled:opacity-40">Approve and submit line return</button>
                <button type="button" disabled={busy || Boolean(pending) || !canVoidRemainingBarSale(selectedSale) || !returnDraft.reason.trim() || !/^\d{4,12}$/.test(returnApprovalPin) || !localReady} onClick={() => void submitSaleVoid()} className="mt-2 w-full rounded border border-rose-700 p-2 text-sm font-semibold text-rose-200 disabled:opacity-40">Approve and cancel remaining sale / tip</button>
              </>}
              {selectedSaleClosed && selectedSaleCorrections.length > 0 && <div className="mt-4 border-t border-slate-700 pt-3">
                <h3 className="text-sm font-semibold">Corrections posted for this receipt</h3>
                <ol className="mt-2 max-h-56 space-y-2 overflow-y-auto">{selectedSaleCorrections.map((correction) => <li key={String(correction.correction_sale_id)} className="rounded border border-slate-800 bg-slate-950 p-2 text-xs"><div className="flex justify-between gap-3"><span className="font-semibold">{correction.kind === 'void' ? 'Cancellation' : 'Return'} · receipt {correction.correction_receipt_number}</span><span>{displayMoney(correction.total)}</span></div><p className="mt-1 text-slate-400">Posted {correction.business_date} · requested by {correction.requested_by_name} · approved by {correction.approved_by_name}</p><p className="mt-1 text-slate-400">{correction.reason}</p></li>)}</ol>
              </div>}
            </form>}
          </div>
        </section>}

        {activeTab === 'menu' && <section className="mt-5 rounded-xl border border-slate-700 bg-slate-900 p-4">
          <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Local menu availability</h2><p className="mt-1 text-xs text-slate-400">Changes apply to this outlet. Sold-out items cannot be committed in a sale while unavailable.</p></div><button type="button" disabled={busy || Boolean(pending)} onClick={() => setPanelVersion((version) => version + 1)} className="rounded border border-slate-600 px-3 py-1 text-xs">Refresh</button></div>
          <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase tracking-wide text-slate-400"><tr><th className="p-2">Product</th><th className="p-2">SKU</th><th className="p-2">Price</th><th className="p-2">Availability</th><th className="p-2">Action</th></tr></thead><tbody>{menuRows.map((row) => <tr key={String(row.product_id)} className="border-t border-slate-800"><td className="p-2">{String(row.name)}{row.product_active !== true && <span className="ml-2 text-xs text-amber-300">Inactive</span>}</td><td className="p-2 text-slate-400">{String(row.sku)}</td><td className="p-2">{displayMoney(row.price)}</td><td className="p-2">{row.available === true ? 'Available' : 'Sold out'}</td><td className="p-2"><button type="button" disabled={busy || Boolean(pending) || !canManageMenu || !localReady || !Number.isSafeInteger(menuProductVersions[String(row.product_id)])} onClick={() => editProduct(row)} className="mr-2 rounded border border-amber-600 px-3 py-1 text-xs disabled:opacity-40">Edit</button><button type="button" disabled={busy || Boolean(pending) || !canManageMenu || !localReady || row.product_active !== true} onClick={() => void runCommand('catalogue.availability.set', { product_id: row.product_id, available: row.available !== true, expected_version: row.availability_version })} className="rounded border border-slate-600 px-3 py-1 text-xs disabled:opacity-40">{row.available === true ? 'Mark sold out' : 'Make available'}</button></td></tr>)}</tbody></table>{menuRows.length === 0 && <p className="p-3 text-sm text-slate-300">No local menu items are available.</p>}</div>
          <p className="mt-3 text-xs text-slate-400">Each change uses the service’s current availability version and a durable operation ID. If another till changes the item first, refresh and review its current state.</p>
          {canManageMenu && <div className="mt-5 border-t border-slate-700 pt-4"><h3 className="font-semibold">Menu add-ons</h3>{modifierConfig ? <><p className="mt-1 text-xs text-slate-400">Manage business-wide modifiers, recipes and promotion definitions. Service prices and stock effects are revalidated when committing operations.</p><ul className="mt-3 grid gap-2 sm:grid-cols-2">{(Array.isArray(modifierConfig.groups) ? modifierConfig.groups : []).map((group) => <li key={String(group.modifier_group_id)} className="rounded border border-slate-800 p-3 text-sm"><span className="font-medium">{String(group.name)} · {String(group.code)}</span><span className="ml-2 text-xs text-slate-400">{group.active === true ? 'Active' : 'Inactive'} · choose {String(group.min_selections)}–{String(group.max_selections)}</span><ul className="mt-2 space-y-1 text-xs text-slate-300">{(Array.isArray(group.options) ? group.options : []).map((option) => <li key={String(option.modifier_option_id)}>{String(option.name)} · {displayMoney(option.price_delta)}{option.active !== true ? ' · inactive' : ''}</li>)}</ul></li>)}</ul><BarLocalModifierManager config={modifierConfig} busy={busy} blocked={!localReady || Boolean(pending)} onCommand={runCommand} /></> : <p className="mt-2 text-xs text-slate-400">Loading authorized menu configuration…</p>}</div>}
        </section>}

        {activeTab === 'drawer' && <section className="mt-5 max-w-2xl rounded-xl border border-slate-700 bg-slate-900 p-4">
          <h2 className="font-semibold">Drawer movements and cash counts</h2>
          {shift && canCashup && <BarLocalDrawerHandover query={(name,filters)=>window.api.pos.barLocal.query(name,filters)} shift={shift} blocked={busy||Boolean(pending)||tabActionBusy||!canCashup||!localReady} refreshKey={cashupSummary} onApproved={approveAndRunTabCommand}/>}
          {!shift ? <p className="mt-3 text-sm text-amber-100">Open a shift before recording drawer cash or a count. Closed shifts cannot be changed.</p> : <form onSubmit={recordDrawerMovement} className="mt-3">
            <label className="block text-sm">Action<select value={drawerDraft.type} onChange={(event) => setDrawerDraft((draft) => ({ ...draft, type: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="paid_in">Paid in</option><option value="paid_out">Paid out</option><option value="float">Add cash float</option><option value="count">Count till cash</option></select></label>
            <label className="mt-3 block text-sm">{drawerDraft.type === 'count' ? 'Physical cash counted' : 'Amount'}<input required inputMode="decimal" min="0" step="0.01" value={drawerDraft.amount} onChange={(event) => setDrawerDraft((draft) => ({ ...draft, amount: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            <label className="mt-3 block text-sm">{drawerDraft.type === 'count' ? 'Count note' : 'Reason'}<textarea required maxLength={500} value={drawerDraft.reason} onChange={(event) => setDrawerDraft((draft) => ({ ...draft, reason: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            <button disabled={busy || Boolean(pending) || !canCashup || !localReady} className="mt-3 rounded bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-40">{drawerDraft.type === 'count' ? 'Record cash count' : 'Record movement'}</button>
            <p className="mt-2 text-xs text-slate-400">{drawerDraft.type === 'count' ? 'The service locks this shift, records the count, and returns expected cash and variance at that moment. A count does not change expected cash.' : 'The local authority records this against the open shift in its cash ledger.'} If the reply is uncertain, retry the same operation below; do not create another movement.</p>
          </form>}
          {shift && <div className="mt-4 border-t border-slate-700 pt-3"><h3 className="text-sm font-semibold">Current shift drawer record</h3>{cashupSummary?.shift_id === shift.shift_id ? <><p className="mt-1 text-xs text-slate-300">Authority-calculated expected cash: {displayMoney(cashupSummary.expected_cash)}</p><ol className="mt-2 max-h-64 space-y-2 overflow-y-auto">{(Array.isArray(cashupSummary.cash_movements) ? [...cashupSummary.cash_movements] : []).sort((a, b) => Date.parse(String(a.created_at || '')) - Date.parse(String(b.created_at || ''))).map((movement, index) => <li key={`${String(movement.created_at)}-${index}`} className="rounded border border-slate-800 bg-slate-950 p-2 text-xs"><div className="flex justify-between gap-3"><span className="font-semibold">{String(movement.type).replaceAll('_', ' ')}</span><span>{displayMoney(movement.amount)}</span></div><p className="mt-1 text-slate-400">{String(movement.reason)} · {String(movement.created_at)}</p></li>)}</ol>{Array.isArray(cashupSummary.cash_movements) && cashupSummary.cash_movements.length === 0 && <p className="mt-2 text-xs text-slate-400">No paid-in, paid-out or float movements are recorded for this shift.</p>}</> : <p role="status" className="mt-2 text-xs text-amber-200">Complete drawer details are not available yet. Refresh this panel before relying on the movement history.</p>}</div>}
        </section>}

        {activeTab === 'cashup' && <section className="mt-5 grid gap-5 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h2 className="font-semibold">Current shift</h2>
            {shift ? <form onSubmit={closeShift} className="mt-3">
              <p className="text-xs text-slate-400">Shift {shift.shift_id} · business date {shift.business_date} · opening float {displayMoney(shift.opening_float)}</p>
              <label className="mt-3 block text-sm">Counted cash<input required inputMode="decimal" value={cashupDraft.counted_cash} onChange={(event) => setCashupDraft((draft) => ({ ...draft, counted_cash: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
              <label className="mt-3 block text-sm">Notes<textarea maxLength={2000} value={cashupDraft.notes} onChange={(event) => setCashupDraft((draft) => ({ ...draft, notes: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
              <button disabled={busy || Boolean(pending) || !canManageTill} className="mt-3 rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">Close shift</button>
              {!canManageTill && <p className="mt-2 text-xs text-amber-200">Your role cannot close a trading shift.</p>}
              <p className="mt-2 text-xs text-slate-400">Close the shift before submitting its cash-up. The local authority records the expected cash and variance.</p>
            </form> : <div className="mt-3 text-sm text-slate-300">{closedShift ? <p>Shift {closedShift.shift_id} closed. Expected {displayMoney(closedShift.expected_cash)}, counted {displayMoney(closedShift.counted_cash)}, variance {displayMoney(closedShift.variance)}.</p> : <p>No open shift is assigned to this operator. Open a shift from the Counter tab.</p>}</div>}
            {cashupSummary && <div className="mt-4 border-t border-slate-700 pt-3 text-sm"><p>Business date {cashupSummary.business_date} · shift status {cashupSummary.status}</p><p className="mt-1">Expected cash {displayMoney(cashupSummary.expected_cash)} · cash sales {displayMoney(cashupSummary.cash_sales)} · card sales {displayMoney(cashupSummary.card_sales)}</p></div>}
            <div className="mt-4 border-t border-slate-700 pt-3"><h3 className="text-sm font-semibold">Submitted cash-ups awaiting review</h3>{!cashupReportComplete && <p className="mt-1 text-xs text-amber-200">The reporting period contains incomplete cash-up data. Each decision still re-reads one scoped cash-up from the local authority.</p>}<div className="mt-2 space-y-2">{cashupRows.filter((row) => row.cashup_status === 'submitted').map((row) => <button key={String(row.cashup_id)} type="button" disabled={busy || Boolean(pending)} onClick={() => setSelectedCashupShiftId(String(row.shift_id))} className={`w-full rounded border p-2 text-left text-xs ${String(row.shift_id) === selectedCashupShiftId ? 'border-amber-400 bg-amber-950/30' : 'border-slate-700 bg-slate-950'}`}><span className="font-semibold">{String(row.business_date)} · Shift {String(row.shift_id).slice(0, 8)}</span><span className="mt-1 block text-slate-300">Counted {displayMoney(row.counted_cash)} · expected {displayMoney(row.expected_cash)} · variance {displayMoney(row.cash_variance)}</span></button>)}{cashupRows.filter((row) => row.cashup_status === 'submitted').length === 0 && <p className="text-xs text-slate-400">No submitted cash-ups are awaiting review.</p>}</div></div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h2 className="font-semibold">Submit cash-up</h2>
            {!closedShift ? <p className="mt-3 text-sm text-slate-300">Close the shift first. The local authority only accepts a cash-up for a closed shift.</p> : <form onSubmit={submitCashup} className="mt-3">
              <p className="text-xs text-slate-400">Shift {closedShift.shift_id} · expected cash {displayMoney(closedShift.expected_cash)}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="text-xs">Counted cash<input required inputMode="decimal" value={cashupDraft.counted_cash} onChange={(event) => setCashupDraft((draft) => ({ ...draft, counted_cash: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Counted card<input inputMode="decimal" value={cashupDraft.counted_card} onChange={(event) => setCashupDraft((draft) => ({ ...draft, counted_card: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label></div>
              <label className="mt-3 block text-sm">Notes<textarea maxLength={2000} value={cashupDraft.notes} onChange={(event) => setCashupDraft((draft) => ({ ...draft, notes: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
              <button disabled={busy || Boolean(pending) || Boolean(cashupResult)} className="mt-3 rounded bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-50">Submit cash-up for review</button>
              {cashupResult && <p className="mt-2 text-xs text-emerald-200">This shift already has a submitted cash-up. A different manager must review it before any resubmission.</p>}
              <p className="mt-2 text-xs text-slate-400">Variance is computed and recorded by the local authority. A different manager must review the submission.</p>
            </form>}
            {(review || cashupResult) && <div className="mt-4 rounded border border-slate-600 bg-slate-950/60 p-3 text-sm"><p className="font-semibold">Review state</p><p className="mt-1">Status: {review?.status || cashupResult?.status || 'submitted'}</p>{review && <><p>Counted cash {displayMoney(review.counted_cash)} · expected {displayMoney(review.expected_cash)} · variance {displayMoney(review.variance)}</p><p>Counted card {displayMoney(review.counted_card)}</p></>}{review?.notes && <p>Notes: {review.notes}</p>}</div>}
            {review?.status === 'submitted' && <form onSubmit={submitCashupReview} className="mt-4 border-t border-slate-700 pt-3"><h3 className="font-semibold">Review submitted cash-up</h3><label className="mt-2 block text-sm">Decision<select value={cashupReviewDraft.decision} onChange={(event) => setCashupReviewDraft((draft) => ({ ...draft, decision: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2"><option value="approved">Approve</option><option value="rejected">Reject for correction</option></select></label><label className="mt-2 block text-sm">Reason<textarea required maxLength={1000} value={cashupReviewDraft.reason} onChange={(event) => setCashupReviewDraft((draft) => ({ ...draft, reason: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label><label className="mt-2 block text-sm">Different manager PIN<input required type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={cashupReviewDraft.pin} onChange={(event) => setCashupReviewDraft((draft) => ({ ...draft, pin: event.target.value.replace(/\D/g, '') }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label><p className="mt-2 text-xs text-amber-100">The local authority rejects self-review and binds a one-time manager approval to this decision. Rejection requires a reason; refresh after the decision before submitting a new cash-up revision.</p><button type="submit" disabled={busy || Boolean(pending) || cashupApprovalBusy || !canCashup || !localReady || !cashupReviewDraft.reason.trim() || !/^\d{4,12}$/.test(cashupReviewDraft.pin)} className="mt-3 w-full rounded bg-sky-600 p-2 font-semibold disabled:opacity-40">Approve or reject cash-up</button></form>}
            {['approved', 'rejected'].includes(String(review?.status)) && <form onSubmit={submitCashupReopen} className="mt-4 border-t border-slate-700 pt-3"><h3 className="font-semibold">Reopen reviewed cash-up</h3><p className="mt-1 text-xs text-amber-100">This creates a new submitted revision and preserves the reviewed snapshot. Use the current physical recount and supporting reference.</p><div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="text-xs">Recounted cash<input required inputMode="decimal" value={cashupReopenDraft.counted_cash} onChange={(event) => setCashupReopenDraft((draft) => ({ ...draft, counted_cash: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Recounted card<input required inputMode="decimal" value={cashupReopenDraft.counted_card} onChange={(event) => setCashupReopenDraft((draft) => ({ ...draft, counted_card: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label></div><label className="mt-2 block text-sm">Recount notes<textarea maxLength={2000} value={cashupReopenDraft.notes} onChange={(event) => setCashupReopenDraft((draft) => ({ ...draft, notes: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label><label className="mt-2 block text-sm">Supporting reference<input maxLength={200} value={cashupReopenDraft.proof_ref} onChange={(event) => setCashupReopenDraft((draft) => ({ ...draft, proof_ref: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label><label className="mt-2 block text-sm">Reason for reopening<textarea required maxLength={1000} value={cashupReopenDraft.reason} onChange={(event) => setCashupReopenDraft((draft) => ({ ...draft, reason: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label><label className="mt-2 block text-sm">Different manager PIN<input required type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={cashupReopenDraft.pin} onChange={(event) => setCashupReopenDraft((draft) => ({ ...draft, pin: event.target.value.replace(/\D/g, '') }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label><button type="submit" disabled={busy || Boolean(pending) || cashupApprovalBusy || !canCashup || !localReady || !MONEY_TWO.test(cashupReopenDraft.counted_cash) || !MONEY_TWO.test(cashupReopenDraft.counted_card) || !cashupReopenDraft.reason.trim() || !/^\d{4,12}$/.test(cashupReopenDraft.pin)} className="mt-3 w-full rounded bg-amber-600 p-2 font-semibold text-slate-950 disabled:opacity-40">Approve and submit new revision</button></form>}
          </div>
        </section>}

        {activeTab === 'stock' && canInventoryView && <section className="mt-5 rounded-xl border border-slate-700 bg-slate-900 p-4">
          <h2 className="font-semibold">Current lot balances and FEFO status</h2>
          <p className="mt-1 text-xs text-slate-300">Sales consume in-date lots by earliest expiry. Pre-existing stock without a recorded lot remains labelled as unknown provenance. Returned stock is held until its lot and expiry are checked.</p>
          <ul className="mt-3 max-h-72 space-y-2 overflow-auto text-sm">{stockLotBalanceRows.map((row) => <li key={row.lot_id} className={`rounded border p-2 ${row.expiry_status === 'expired' || row.expiry_status === 'quarantined' ? 'border-rose-900' : 'border-slate-700'}`}>
            <span className="font-semibold">{row.name} · {row.lot_code || 'Unknown lot'}</span>
            <span className="mt-1 block text-xs">Received {displayQuantity(row.received_quantity)} · allocated {displayQuantity(row.allocated_quantity)} · remaining {displayQuantity(row.remaining_quantity)}</span>
            <span className="mt-1 block text-xs">Expiry {row.expires_on || 'Not recorded'} · {row.expiry_status} · {row.source_kind}</span>
            <span className="mt-1 block text-xs text-slate-400">{row.provenance}</span>
          </li>)}</ul>
          {stockLotBalanceRows.length === 0 && <p className="mt-2 text-xs text-slate-400">No current stock lots are recorded for this outlet.</p>}
          <h3 className="mt-5 font-semibold">Lot and expiry receipt history</h3>
          <p className="mt-1 text-xs text-slate-300">Receipt history remains available separately from current lot balances.</p>
          <ul className="mt-3 max-h-72 space-y-2 overflow-auto text-sm">{stockLotRows.map((row) => <li key={row.movement_id} className="rounded border border-slate-700 p-2">
            <span className="font-semibold">{row.name} · {row.lot_code || 'No lot code'}</span>
            <span className="mt-1 block text-xs">Received {displayQuantity(row.received_quantity)} · expiry {row.expires_on || 'Not recorded'} · {row.expiry_status}</span>
          </li>)}</ul>
          {stockLotRows.length === 0 && <p className="mt-2 text-xs text-slate-400">No lot or expiry receipts are recorded for this outlet.</p>}
        </section>}
        {activeTab === 'stock' && canInventoryView && (
          <BarLocalOperationsPanel section="stock" onCommand={runCommand} busy={busy} pending={pending}
            localReady={localReady} capabilities={capabilities} staff={staff} shift={shift} stock={stock}
            stockLotRows={stockLotRows} stockLotBalanceRows={stockLotBalanceRows} authority={authority} panelVersion={panelVersion} />
        )}

        {activeTab === 'reports' && <section className="mt-5 rounded-xl border border-slate-700 bg-slate-900 p-4">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Sales summary</h2><button type="button" disabled={busy || Boolean(pending)} onClick={() => setPanelVersion((version) => version + 1)} className="rounded border border-slate-600 px-3 py-1 text-xs">Refresh</button></div>
          {!report ? <p className="mt-3 text-sm text-slate-300">Loading the local sales summary.</p> : <div className="mt-3">
            <p className="text-xs text-slate-400">Business date {report.period?.from || '—'} to {report.period?.to || '—'} · data from the local authority · cloud export disabled</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded border border-slate-700 bg-slate-950/60 p-3"><p className="text-xs text-slate-400">Gross sales</p><p className="text-lg font-semibold">{displayMoney(report.totals?.gross_sales)}</p></div>
              <div className="rounded border border-slate-700 bg-slate-950/60 p-3"><p className="text-xs text-slate-400">Returns</p><p className="text-lg font-semibold">{displayMoney(report.totals?.returns)}</p></div>
              <div className="rounded border border-slate-700 bg-slate-950/60 p-3"><p className="text-xs text-slate-400">Voids</p><p className="text-lg font-semibold">{displayMoney(report.totals?.voids)}</p></div>
              <div className="rounded border border-slate-700 bg-slate-950/60 p-3"><p className="text-xs text-slate-400">Net sales</p><p className="text-lg font-semibold">{displayMoney(report.totals?.net_sales)}</p></div>
              <div className="rounded border border-slate-700 bg-slate-950/60 p-3"><p className="text-xs text-slate-400">Discounts</p><p className="text-lg font-semibold">{displayMoney(report.totals?.discounts)}</p></div>
              <div className="rounded border border-slate-700 bg-slate-950/60 p-3"><p className="text-xs text-slate-400">Tax</p><p className="text-lg font-semibold">{displayMoney(report.totals?.tax)}</p></div>
              <div className="rounded border border-slate-700 bg-slate-950/60 p-3"><p className="text-xs text-slate-400">Tips</p><p className="text-lg font-semibold">{displayMoney(report.totals?.tips)}</p></div>
              <div className="rounded border border-slate-700 bg-slate-950/60 p-3"><p className="text-xs text-slate-400">Sales</p><p className="text-lg font-semibold">{report.totals?.sale_count ?? '—'} · avg {displayMoney(report.totals?.average_sale)}</p></div>
            </div>
            <h3 className="mt-5 font-semibold">Tenders</h3>
            {reportTenders.length === 0 ? <p className="mt-2 text-sm text-slate-300">No tenders recorded for this business date.</p> : <ul className="mt-2 space-y-1 text-sm">{reportTenders.map((tender) => <li key={tender.method} className="flex justify-between gap-3"><span>{tender.method}</span><span>{displayMoney(tender.amount)} · {tender.entry_count ?? tender.entries ?? '—'} entries</span></li>)}</ul>}
            <h3 className="mt-5 font-semibold">By day</h3>
            {reportDays.length === 0 ? <p className="mt-2 text-sm text-slate-300">No sales recorded for this business date.</p> : <ul className="mt-2 space-y-1 text-sm">{reportDays.map((day) => <li key={day.business_date} className="flex justify-between gap-3"><span>{day.business_date}</span><span>gross {displayMoney(day.gross_sales)} · returns {displayMoney(day.returns)} · net {displayMoney(day.net_sales)} · {day.sale_count ?? '—'} sales</span></li>)}</ul>}
          </div>}
        </section>}
        {activeTab === 'reports' && <section className="mt-4 grid gap-4 lg:grid-cols-2">
          <article className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h2 className="font-semibold">Stock report</h2>{!stockReport ? <p className="mt-2 text-sm text-slate-300">Loading the outlet-scoped stock report.</p> : <><p className="mt-1 text-xs text-slate-400">{String(stockReport.period?.from || '—')} to {String(stockReport.period?.to || '—')} · low-stock threshold {String(stockReport.low_stock_threshold ?? '—')}</p>{stockReport.complete !== true && <p role="status" className="mt-2 rounded border border-amber-700 p-2 text-xs text-amber-100">Valuation is incomplete: {Array.isArray(stockReport.unavailable) ? stockReport.unavailable.join(', ') : 'missing cost data'}. Do not rely on the valuation total.</p>}<p className="mt-2 text-sm">Valued stock {displayMoney(stockReport.valuation_totals?.valued_amount)} · low-stock products {Array.isArray(stockReport.low_stock) ? stockReport.low_stock.length : 0} · movements {Array.isArray(stockReport.movements) ? stockReport.movements.length : 0}</p><details className="mt-2"><summary className="cursor-pointer text-xs text-amber-200">Review all low-stock products</summary><ul className="mt-2 max-h-56 space-y-1 overflow-auto text-xs">{(Array.isArray(stockReport.low_stock) ? stockReport.low_stock : []).map((item) => <li key={String(item.product_id)} className="flex justify-between gap-3"><span>{String(item.name)} · {String(item.sku)}</span><span>{displayQuantity(item.quantity)}</span></li>)}</ul>{Array.isArray(stockReport.low_stock) && stockReport.low_stock.length === 0 && <p className="mt-2 text-xs text-slate-400">No tracked products are at or below the threshold.</p>}</details></>}</article>
          <article className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h2 className="font-semibold">Cash-up report</h2><p className="mt-1 text-xs text-slate-400">Period {String(cashupReport?.period?.from || '—')} to {String(cashupReport?.period?.to || '—')} · card settlement is externally unverified</p>{!cashupReport ? <p className="mt-2 text-sm text-slate-300">Loading the cash-up report.</p> : <><p className="mt-1 text-xs text-slate-400">{String(cashupReport.shifts?.length ?? 0)} shift(s) · expected cash {displayMoney(cashupReport.totals?.expected_cash)} · counted {displayMoney(cashupReport.totals?.counted_cash)} · variance {displayMoney(cashupReport.totals?.cash_variance)} · card settlement {String(cashupReport.card_settlement_status || 'unverified_external')}</p>{cashupReport.complete !== true && <p role="status" className="mt-2 rounded border border-amber-700 p-2 text-xs text-amber-100">Cash-up data is incomplete or provider settlement is unverified. Card totals are not represented as externally settled.</p>}<ul className="mt-2 max-h-56 space-y-1 overflow-auto text-xs">{(Array.isArray(cashupReport.shifts) ? cashupReport.shifts : []).map((item) => <li key={String(item.shift_id)} className="flex justify-between gap-3"><span>{String(item.business_date)} · {String(item.cashup_status)} · {String(item.shift_status)}</span><span>cash {displayMoney(item.expected_cash)} / {displayMoney(item.counted_cash)}</span></li>)}</ul></>}</article>
        </section>}
        {activeTab === 'settings' && <section className="mt-5 grid gap-5 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h2 className="font-semibold">Local Bar staff</h2>
            <p className="mt-1 text-xs text-slate-400">New till accounts receive the least-privilege cashier role. Role and capability enforcement remains on the local service.</p>
            <ul className="mt-3 space-y-2">{staffRows.map((row) => <li key={row.staff_id} className="flex justify-between rounded border border-slate-700 p-3 text-sm"><span>{row.display_name} · {row.role}</span><span className={row.status === 'active' ? 'text-emerald-300' : 'text-amber-300'}>{row.status}</span></li>)}</ul>
            {staffRows.length === 0 && <p className="mt-3 text-sm text-slate-300">No staff records were returned.</p>}
            <BarLocalStaffStatus staffRows={staffRows} actor={staff??{}} blocked={busy||Boolean(pending)||tabActionBusy||!localReady} onApproved={approveAndRunTabCommand}/>
            <form onSubmit={createCashier} className="mt-4 border-t border-slate-700 pt-4">
              <h3 className="font-medium">Create a local staff account</h3>
              <label className="mt-2 block text-sm">Display name<input required maxLength={120} value={staffDraft.display_name} onChange={(event) => setStaffDraft((draft) => ({ ...draft, display_name: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
              <label className="mt-2 block text-sm">Role<select value={staffDraft.role} onChange={(event) => setStaffDraft((draft) => ({ ...draft, role: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2"><option value="cashier">Cashier</option>{staff?.role === 'owner' && <><option value="manager">Manager</option><option value="stock">Stock</option><option value="finance">Finance</option></>}</select></label>
              <label className="mt-2 block text-sm">Temporary PIN<input required type="password" inputMode="numeric" pattern="[0-9]{4,12}" autoComplete="new-password" value={staffDraft.pin} onChange={(event) => setStaffDraft((draft) => ({ ...draft, pin: event.target.value.replace(/\D/g, '').slice(0, 12) }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
              <button disabled={busy || Boolean(pending)} className="mt-3 rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">Create staff account</button>
              <p className="mt-2 text-xs text-slate-400">The local service enforces role delegation and capability ceilings. Owner accounts cannot be created here.</p>
            </form>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h2 className="font-semibold">Pair another till</h2>
            <p className="mt-1 text-sm text-slate-300">The local service issues a single-use code bound to this Bar authority. Pairing requires the office server HTTPS address and certificate fingerprint on the new till.</p>
            <button type="button" disabled={busy || Boolean(pending) || pairingBusy} onClick={() => void generatePairingCode()} className="mt-4 rounded bg-sky-600 px-4 py-2 text-sm font-semibold disabled:opacity-50">{pairingBusy ? 'Generating…' : 'Generate 5-minute pairing code'}</button>
            {pairingCode && <div role="status" className="mt-4 rounded border border-sky-700 bg-sky-950/40 p-4"><p className="text-xs uppercase tracking-wide text-sky-200">Single-use pairing code</p><p className="mt-2 font-mono text-3xl tracking-[0.3em]">{pairingCode.code}</p><p className="mt-2 text-xs text-slate-300">This code expires automatically. Share it only with the intended till.</p>{pairingCode.addresses.length ? pairingCode.addresses.map(address => <p key={address} className="mt-2 select-all font-mono text-sm">{address}</p>) : <p className="mt-2 text-amber-200">No private LAN address is available. Connect the main computer to the venue network and set that Windows network to Private.</p>}<p className="mt-2 text-xs">Certificate fingerprint</p><p className="mt-1 select-all break-all font-mono text-xs">{pairingCode.fingerprint}</p></div>}
          </div>
        </section>}{canManageSettings && <BarLocalDiscountPolicy policy={discountPolicy} busy={busy} blocked={Boolean(pending)} onCommand={runCommand} />}
        {activeTab === 'audit' && canManageSettings && <section className="mt-5 rounded-xl border border-slate-700 bg-slate-900 p-4">
          <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Local audit search</h2><p className="mt-1 text-xs text-slate-400">Business and outlet scope are enforced by the local service. Default results cover the latest 30 days.</p></div><button type="button" disabled={auditLoading || busy || Boolean(pending)} onClick={() => void searchAudit(false)} className="rounded border border-slate-600 px-3 py-1 text-xs disabled:opacity-50">Refresh</button></div>
          <form onSubmit={(event) => { event.preventDefault(); setAuditCursor(''); void searchAudit(false); }} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><label className="text-xs">Search audit values<input maxLength={160} value={auditSearch} onChange={(event) => setAuditSearch(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" placeholder="Operation ID, SKU or value" /></label><label className="text-xs">Exact action<input maxLength={120} value={auditAction} onChange={(event) => setAuditAction(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" placeholder="catalogue.upsert" /></label><button disabled={auditLoading || busy || Boolean(pending)} className="self-end rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">Search</button></form>
          <ul className="mt-4 space-y-2">{auditRows.map((row, index) => <li key={`${String(row.id || row.operation_id)}-${index}`} className="rounded border border-slate-800 p-3"><div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-semibold">{String(row.action || 'Audit event')}</span><time className="text-xs text-slate-400">{String(row.created_at || '')}</time></div><p className="mt-1 text-xs text-slate-400">Operation {String(row.operation_id || '—')} · staff {String(row.actor_staff_id || '—')}</p><details className="mt-2"><summary className="cursor-pointer text-xs text-amber-200">Before / after detail</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-950 p-2 text-xs">{JSON.stringify({ before: row.before ?? null, after: row.after ?? null }, null, 2)}</pre></details></li>)}</ul>
          {auditRows.length === 0 && !auditLoading && <p className="mt-3 text-sm text-slate-300">No local audit events matched this search.</p>}
          {auditHasMore && <button type="button" disabled={auditLoading || !auditCursor || busy || Boolean(pending)} onClick={() => void searchAudit(true)} className="mt-3 rounded border border-slate-600 px-4 py-2 text-sm disabled:opacity-50">{auditLoading ? 'Loading…' : 'Load older events'}</button>}
        </section>}
        {((activeTab === 'purchasing' && canInventoryView)
          || (activeTab === 'customers' && canManageCustomers)
          || (activeTab === 'control' && canManageTill)
          || (activeTab === 'workforce' && canManageStaff)
          || (activeTab === 'accounting' && canReadAccounting)) && (
          <BarLocalOperationsPanel section={activeTab} onCommand={runCommand} busy={busy} pending={pending} localReady={localReady} capabilities={capabilities} staff={staff} shift={shift} stock={stock} authority={authority} panelVersion={panelVersion} />
        )}
        {activeTab === 'admin' && canManageSettings && <BarLocalAdminPanel busy={busy} pending={pending} localReady={localReady} canManageBackup={canManageBackup} canExport={capabilities.includes('export.manage')} refreshKey={panelVersion} onCommand={runCommand} />}
        {activeTab === 'support' && canManageSettings && <section className="mt-5 max-w-3xl rounded-xl border border-slate-700 bg-slate-900 p-4">
          <h2 className="font-semibold">Record a local support report</h2><p className="mt-1 text-xs text-slate-400">The report is redacted and stored by this Bar authority. Support delivery is disabled; give your local administrator the subject and time if they need to find it.</p>
          <form onSubmit={createSupportReport} className="mt-3 space-y-3"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs">Category<select value={supportDraft.category} onChange={(event) => setSupportDraft((draft) => ({ ...draft, category: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="operations">Operations</option><option value="access">Access</option><option value="hardware">Hardware</option><option value="data">Data</option><option value="other">Other</option></select></label><label className="text-xs">Severity<select value={supportDraft.severity} onChange={(event) => setSupportDraft((draft) => ({ ...draft, severity: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label></div><label className="block text-xs">Subject<input required maxLength={200} value={supportDraft.subject} onChange={(event) => setSupportDraft((draft) => ({ ...draft, subject: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="block text-xs">What happened?<textarea required maxLength={4000} value={supportDraft.message} onChange={(event) => setSupportDraft((draft) => ({ ...draft, message: event.target.value }))} className="mt-1 min-h-28 w-full rounded bg-slate-800 p-2 text-sm" /></label><button disabled={busy || Boolean(pending)} className="rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">Record on this Bar</button></form>
          <div className="mt-5 border-t border-slate-800 pt-4"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Local report history</h3><button type="button" disabled={supportReportsLoading || busy || Boolean(pending)} onClick={() => void loadSupportReports()} className="rounded border border-slate-600 px-3 py-1 text-xs disabled:opacity-50">{supportReportsLoading ? 'Loading reports…' : 'Refresh reports'}</button></div>{supportReportsError && <p role="alert" className="mt-2 text-xs text-rose-200">{supportReportsError} Refresh the list or ask a settings manager to check local service access.</p>}<ul className="mt-3 space-y-2">{supportReports.map((row) => <li key={String(row.id)} className="rounded border border-slate-800 p-3"><div className="flex flex-wrap justify-between gap-2 text-xs"><span className="font-semibold">{String(row.subject)} · {String(row.severity)}</span><time className="text-slate-400">{String(row.created_at)}</time></div><p className="mt-1 text-xs text-slate-400">{String(row.category)} · {String(row.status)} · delivery {String(row.delivery_status)} · by {String(row.submitted_by_name)}</p><details className="mt-2"><summary className="cursor-pointer text-xs text-amber-200">Report details</summary><p className="mt-2 whitespace-pre-wrap text-xs text-slate-300">{String(row.message)}</p><p className="mt-2 break-all text-[10px] text-slate-500">Checksum {String(row.checksum)}</p></details></li>)}</ul>{supportReports.length === 0 && !supportReportsLoading && !supportReportsError && <p className="mt-2 text-xs text-slate-400">No local support reports have been recorded for this outlet.</p>}</div>
          <p className="mt-3 text-xs text-slate-400">Do not include PINs, passwords, payment details or guest identity documents. The service applies redaction and records a checksum and audit event.</p>
        </section>}
      </div>
      {lastReceipt && <section className="bar-local-receipt mx-auto mt-4 max-w-6xl rounded-xl border border-emerald-700 bg-emerald-950/30 p-4" aria-label="Last committed receipt">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wide text-emerald-200">Committed local receipt</p><h2 className="mt-1 font-semibold">Receipt {lastReceipt.receipt_number || '—'} · {displayMoney(lastReceipt.total)}</h2><p className="mt-1 text-xs text-slate-300">This receipt was confirmed by the local authority. Printing does not submit another sale.</p></div><button type="button" disabled={busy || Boolean(pending)} onClick={() => void printReceipt(lastReceipt)} className="rounded border border-emerald-500 px-4 py-2 text-sm font-semibold">Print receipt</button></div>
        <ul className="mt-3 space-y-1 text-sm">{(Array.isArray(lastReceipt.lines) ? lastReceipt.lines : []).map((line) => <li key={line.sale_line_id} className="flex justify-between gap-3"><span>{line.name} × {line.quantity}{displayModifierNames(line.modifiers) && <small className="block text-xs text-slate-300">{displayModifierNames(line.modifiers)}</small>}</span><span>{displayMoney(line.line_total)}</span></li>)}</ul>
        <style>{`@media print { body * { visibility: hidden !important; } .bar-local-receipt, .bar-local-receipt * { visibility: visible !important; } .bar-local-receipt { position: fixed !important; inset: 0 !important; width: 80mm !important; max-width: 80mm !important; margin: 0 !important; border: 0 !important; background: white !important; color: black !important; } .bar-local-receipt button { display: none !important; } }`}</style>
      </section>}
      {pending && <section className="mx-auto mt-4 max-w-6xl rounded border border-amber-700 bg-amber-950/40 p-4"><p className="text-sm">Saved operation {pending.operation_id} ({pending.command}{pending.state ? ` · ${pending.state}` : ''}{pending.attempts ? ` · attempt ${pending.attempts}` : ''}) may have reached the local service. New operations are paused until it is resolved.</p><p className="mt-1 text-xs text-amber-100">Keep the original sale, tab or correction unchanged. Retry the same operation ID, or check the authority&apos;s record without resubmitting it. Never start a replacement sale for the same basket.</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void runCommand(pending.command, pending.payload, pending)} className="rounded border border-amber-500 px-3 py-2 text-sm">Retry same operation</button><button type="button" disabled={busy} onClick={() => void resolvePending()} className="rounded border border-amber-500 px-3 py-2 text-sm">Check status</button></div></section>}
      {error && <p role="alert" className="mx-auto mt-4 max-w-6xl rounded bg-red-950 p-3 text-sm text-red-200">{error}</p>}{notice && <p role="status" className="mx-auto mt-4 max-w-6xl rounded bg-emerald-950 p-3 text-sm text-emerald-200">{notice}</p>}
    </main>
  );
}
