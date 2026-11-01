import { useEffect, useRef, useState } from 'react';
import BarLocalFinanceWorkspace from '../../../../../src/renderer/src/components/hospitality-pos/BarLocalFinanceWorkspace.jsx';
import BarLocalLoyaltyAdjustment from '../../../../../src/renderer/src/components/hospitality-pos/BarLocalLoyaltyAdjustment.jsx';
import BarLocalTipActions from '../../../../../src/renderer/src/components/hospitality-pos/BarLocalTipActions.jsx';

const QUANTITY_SIX = /^\d+(?:\.\d{1,6})?$/;
const SIGNED_QUANTITY_SIX = /^-\d+(?:\.\d{1,6})?$/;
const MONEY_TWO = /^\d+(?:\.\d{1,2})?$/;
const COST_FOUR = /^\d+(?:\.\d{1,4})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const UUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONTH_VALUE = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const TIME_VALUE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const PIN_VALUE = /^\d{4,12}$/;

/** @typedef {{movement_id: string, name: string, sku?: string, lot_code?: string | null, received_quantity: string | number, expires_on?: string | null, expiry_status: string, supplier_reference?: string | null}} BarLocalOperationsStockLotRowView */
/** @typedef {{lot_id:string,product_id:string,name:string,sku?:string,lot_code?:string|null,expires_on?:string|null,remaining_quantity:string|number,sale_eligible:boolean,version:number,expiry_status:string}} BarLocalOperationsStockLotBalanceView */
/** Expected service/query views used by this panel; these declarations do not validate IPC or query data. */
/** @typedef {{supplier_id: string | number, name: string, version: string | number, active?: boolean, contact_name?: string | null, phone?: string | null, email?: string | null, address?: string | null, notes?: string | null}} SupplierView */
/** @typedef {{purchase_order_line_id: string | number, name_snapshot: string, quantity_ordered: string | number, quantity_received: string | number, quantity_remaining: string | number, unit_cost: string | number}} PurchaseOrderLineView */
/** @typedef {{purchase_order_id: string | number, po_number: string, supplier_name: string, total: string | number, status: string, ordered_on: string, line_count: string | number, version: string | number}} PurchaseOrderView */
/** @typedef {{purchase_order_id: string | number, po_number: string, supplier: {name: string}, total: string | number, status: string, version: string | number, lines: PurchaseOrderLineView[]}} SelectedPurchaseOrderView */
/** @typedef {{customer_id: string | number, name: string, outstanding: string | number, credit_limit: string | number, status: string, phone?: string | null, email?: string | null}} CustomerView */
/** @typedef {{voucher_id: string | number, code: string, status: string, balance: string | number, initial_amount: string | number}} VoucherView */
/** @typedef {{type?: string, status?: string, points_balance?: string | number, redemption_value?: string | number}} LoyaltyResultView */
/** @typedef {{result?: LoyaltyResultView}} LoyaltyCommandResultView */
/** @typedef {{points_balance: string | number, status: string}} LoyaltyBalanceView */
/** @typedef {{template_key: string, name: string}} ChecklistTemplateView */
/** @typedef {{item_id: string | number, label: string, required?: boolean, completed?: boolean, note: string | null}} ChecklistItemView */
/** @typedef {{checklist_id: string | number, template_name: string, status: string, version: string | number, items: ChecklistItemView[]}} ChecklistView */
/** @typedef {{id: string | number, severity: string, category: string, status: string, description: string, version: string | number}} IncidentView */
/** @typedef {{staff_id: string | number, display_name: string, role: string, status: string}} WorkforceStaffView */
/** @typedef {{shift_id: string | number, staff_id: string | number, display_name: string, work_date: string, starts_at: string, ends_at: string, status: string, version: string | number, scheduled_minutes: string | number, break_minutes?: string | number, role_label?: string | null, notes?: string | null}} RosterView */
/** @typedef {{attendance_id: string | number, display_name: string, clocked_in_at: string, minutes_worked: string | number, status: string}} AttendanceView */
/** @typedef {{account_code: string, name: string, type: string, active?: boolean}} AccountingAccountView */
/** @typedef {{expense_id: string | number, expense_date: string, category: string, amount: string | number, status: string, version: string | number}} ExpenseView */
/** @typedef {{account_code: string, name: string, type: string, debit: string | number, credit: string | number, balance: string | number}} TrialBalanceView */
/** @typedef {{product_id: string, name: string, sku: string, quantity?: string | number, track_stock?: boolean}} StockProductView */
/** @typedef {{product_id: string, quantity: string, unit_cost: string, tax_rate: string}} PurchaseOrderDraftLine */
/** @typedef {{quantity: string, unit_cost: string, lot_code: string, expires_on: string}} PurchaseOrderReceiveLineDraft */
/** @typedef {{account_code: string, debit: string, credit: string, description: string}} JournalDraftLine */
/** @typedef {{mode: 'receive' | 'adjust' | 'stocktake' | 'waste' | 'transfer', product_id: string, quantity: string, unit_cost: string, supplier_ref: string, lot_code: string, expires_on: string, delta: string, counted_quantity: string, reason: string, to_outlet_id: string, pin: string}} StockMovementDraft */

/** @typedef {{section: string, onCommand: (command: string, payload: object, arg3: null, afterCommit?: (result: LoyaltyCommandResultView) => void, operationId?: string) => unknown, busy: boolean, pending: unknown, localReady: boolean, capabilities: string[], staff: unknown, shift: {business_date?: string, shift_id?: string | number} | null, stock: StockProductView[], stockLotRows?: BarLocalOperationsStockLotRowView[], stockLotBalanceRows?: BarLocalOperationsStockLotBalanceView[], authority: {business_id: string, outlet_id: string}, panelVersion: number}} BarLocalOperationsPanelProps */

/** @param {unknown} cause */
function getMessage(cause) {
  return cause && typeof cause.message === 'string' ? cause.message : 'The local Bar operation could not be completed.';
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** @param {unknown} value */
function displayValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/** @param {unknown} value */
function displayMoney(value) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : String(value);
}

/** @param {unknown} value */
function displayQuantity(value) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString(undefined, { maximumFractionDigits: 6 }) : String(value);
}

/** @param {{title: string, children: import('react').ReactNode, description?: string}} props */
function Panel({ title, children, description }) {
  return (
    <section className="rounded-xl border border-slate-700 bg-slate-900 p-4">
      <h2 className="font-semibold">{title}</h2>
      {description && <p className="mt-1 text-xs text-slate-400">{description}</p>}
      {children}
    </section>
  );
}

/** @param {{label: string, children: import('react').ReactNode}} props */
function Field({ label, children }) {
  return <label className="block text-xs">{label}{children}</label>;
}

/** @param {import('react').InputHTMLAttributes<HTMLInputElement>} props */
function TextInput(props) {
  return <input {...props} className={`mt-1 w-full rounded bg-slate-800 p-2 text-sm ${props.className || ''}`} />;
}

/** @param {{children: import('react').ReactNode}} props */
function ErrorText({ children }) {
  return children ? <p role="alert" className="mt-3 rounded border border-red-700 bg-red-950/50 p-2 text-xs text-red-100">{children}</p> : null;
}

/** @param {BarLocalOperationsPanelProps} props */
export default function BarLocalOperationsPanel({ section, onCommand, busy, pending, localReady, capabilities, staff, shift, stock, stockLotRows = /** @type {BarLocalOperationsStockLotRowView[]} */ ([]), stockLotBalanceRows = /** @type {BarLocalOperationsStockLotBalanceView[]} */ ([]), authority, panelVersion }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [notice, setNotice] = useState('');

  /** @type {[SupplierView[], import('react').Dispatch<import('react').SetStateAction<SupplierView[]>>]} */
  const [suppliers, setSuppliers] = useState([]);
  /** @type {[PurchaseOrderView[], import('react').Dispatch<import('react').SetStateAction<PurchaseOrderView[]>>]} */
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  /** @type {[StockMovementDraft, import('react').Dispatch<import('react').SetStateAction<StockMovementDraft>>]} */
  const [stockForm, setStockForm] = useState({ mode: 'receive', product_id: '', quantity: '', unit_cost: '', supplier_ref: '', lot_code: '', expires_on: '', delta: '', counted_quantity: '', reason: '', to_outlet_id: '', lot_id: '', pin: '' });
  const [lotReleaseDraft, setLotReleaseDraft] = useState({ lot_id: '', verified_lot_code: '', verified_expires_on: '', no_expiry_confirmed: false, reason: '', pin: '' });
  const [selectedPoId, setSelectedPoId] = useState('');
  /** @type {[SelectedPurchaseOrderView | null, import('react').Dispatch<import('react').SetStateAction<SelectedPurchaseOrderView | null>>]} */
  const [selectedPo, setSelectedPo] = useState(null);
  const [supplierDraft, setSupplierDraft] = useState({ name: '', contact_name: '', phone: '', email: '', address: '', notes: '', active: true });
  /** @type {[{supplier_id: string, expected_supplier_version: string, expected_on: string, notes: string, lines: PurchaseOrderDraftLine[]}, import('react').Dispatch<import('react').SetStateAction<{supplier_id: string, expected_supplier_version: string, expected_on: string, notes: string, lines: PurchaseOrderDraftLine[]}>>]} */
  const [poDraft, setPoDraft] = useState({ supplier_id: '', expected_supplier_version: '', expected_on: '', notes: '', lines: [{ product_id: '', quantity: '', unit_cost: '', tax_rate: '' }] });
  const [poApprovalPin, setPoApprovalPin] = useState('');
  /** @type {[{supplier_reference: string, notes: string, received_on: string, lines: Record<string, PurchaseOrderReceiveLineDraft>}, import('react').Dispatch<import('react').SetStateAction<{supplier_reference: string, notes: string, received_on: string, lines: Record<string, PurchaseOrderReceiveLineDraft>}>>]} */
  const [receiveDraft, setReceiveDraft] = useState({ supplier_reference: '', notes: '', received_on: '', lines: {} });
  const [cancelDraft, setCancelDraft] = useState({ reason: '', pin: '' });

  /** @type {[CustomerView[], import('react').Dispatch<import('react').SetStateAction<CustomerView[]>>]} */
  const [customers, setCustomers] = useState([]);
  /** @type {[VoucherView[], import('react').Dispatch<import('react').SetStateAction<VoucherView[]>>]} */
  const [vouchers, setVouchers] = useState([]);
  const [customerDraft, setCustomerDraft] = useState({ name: '', phone: '', email: '', credit_limit: '0.00' });
  const [creditDraft, setCreditDraft] = useState({ customer_id: '', amount: '', method: 'cash', reference: '' });
  const [voucherDraft, setVoucherDraft] = useState({ customer_id: '', amount: '', code: '', expires_on: '', pin: '' });
  const [loyaltyDraft, setLoyaltyDraft] = useState({ customer_id: '', sale_id: '', points: '', reference: '' });
  /** @type {[LoyaltyResultView | null, import('react').Dispatch<import('react').SetStateAction<LoyaltyResultView | null>>]} */
  const [loyaltyResult, setLoyaltyResult] = useState(null);
  /** @type {[LoyaltyBalanceView | null, import('react').Dispatch<import('react').SetStateAction<LoyaltyBalanceView | null>>]} */
  const [loyaltyBalance, setLoyaltyBalance] = useState(null);
  const [loyaltyBalanceAsOf, setLoyaltyBalanceAsOf] = useState('');
  const [loyaltyBalanceError, setLoyaltyBalanceError] = useState('');
  const [loyaltyBalanceLoading, setLoyaltyBalanceLoading] = useState(false);
  const loyaltyBalanceRequest = useRef(0);

  /** @type {[ChecklistTemplateView[], import('react').Dispatch<import('react').SetStateAction<ChecklistTemplateView[]>>]} */
  const [templates, setTemplates] = useState([]);
  /** @type {[ChecklistView[], import('react').Dispatch<import('react').SetStateAction<ChecklistView[]>>]} */
  const [checklists, setChecklists] = useState([]);
  /** @type {[IncidentView[], import('react').Dispatch<import('react').SetStateAction<IncidentView[]>>]} */
  const [incidents, setIncidents] = useState([]);
  const [checklistDraft, setChecklistDraft] = useState({ template_key: '' });
  const [incidentDraft, setIncidentDraft] = useState({ category: 'operations', severity: 'medium', description: '', immediate_action: '' });
  const [selectedIncidentId, setSelectedIncidentId] = useState('');
  const [incidentResolution, setIncidentResolution] = useState('');

  /** @type {[WorkforceStaffView[], import('react').Dispatch<import('react').SetStateAction<WorkforceStaffView[]>>]} */
  const [staffRows, setStaffRows] = useState([]);
  /** @type {[RosterView[], import('react').Dispatch<import('react').SetStateAction<RosterView[]>>]} */
  const [roster, setRoster] = useState([]);
  /** @type {[AttendanceView[], import('react').Dispatch<import('react').SetStateAction<AttendanceView[]>>]} */
  const [attendanceCurrent, setAttendanceCurrent] = useState([]);
  /** @type {[AttendanceView[], import('react').Dispatch<import('react').SetStateAction<AttendanceView[]>>]} */
  const [attendanceRows, setAttendanceRows] = useState([]);
  const [rosterDraft, setRosterDraft] = useState({ shift_id: '', staff_id: '', expected_version: '', work_date: today(), starts_at: '09:00', ends_at: '17:00', break_minutes: '0', role_label: '', notes: '' });
  const [clockInDraft, setClockInDraft] = useState({ staff_id: '', workforce_shift_id: '', note: '' });
  const [clockOutDraft, setClockOutDraft] = useState({ attendance_id: '', note: '' });
  const [cancelShiftDraft, setCancelShiftDraft] = useState({ shift_id: '', expected_version: '', reason: '' });

  /** @type {[AccountingAccountView[], import('react').Dispatch<import('react').SetStateAction<AccountingAccountView[]>>]} */
  const [accounts, setAccounts] = useState([]);
  /** @type {[ExpenseView[], import('react').Dispatch<import('react').SetStateAction<ExpenseView[]>>]} */
  const [expenses, setExpenses] = useState([]);
  /** @type {[TrialBalanceView[], import('react').Dispatch<import('react').SetStateAction<TrialBalanceView[]>>]} */
  const [trialBalance, setTrialBalance] = useState([]);
  const [expenseDraft, setExpenseDraft] = useState({ expense_date: today(), category: '', description: '', amount: '', expense_account_code: '', payment_account_code: '', reference: '' });
  const [voidExpenseDraft, setVoidExpenseDraft] = useState({ expense_id: '', expected_version: '', reason: '', pin: '' });
  const [journalDraft, setJournalDraft] = useState({ entry_date: today(), memo: '', source_type: 'manual_adjustment', lines: [{ account_code: '', debit: '', credit: '', description: '' }, { account_code: '', debit: '', credit: '', description: '' }] });
  const [periodDraft, setPeriodDraft] = useState({ period: today().slice(0, 7), pin: '' });

  const blocked = busy || Boolean(pending) || !localReady;
  const businessDate = shift?.business_date || today();
  /** @param {string} capability */
  const can = (capability) => Array.isArray(capabilities) && capabilities.includes(capability);
  const canManageInventory = can('inventory.manage');
  const canManageAccounting = can('accounting.manage');
  const selectedStockProduct = (Array.isArray(stock) ? stock : []).find((item) => String(item.product_id) === stockForm.product_id);

  /** @param {string} name @param {Record<string, unknown>} [filters] */
  const query = async (name, filters = {}) => {
    const result = await window.api.pos.barLocal.query(name, filters);
    if (!result || result.complete !== true || !Array.isArray(result.data)
      || (Array.isArray(result.unavailable) && result.unavailable.length)
      || result.scope?.business_id !== authority.business_id || result.scope?.outlet_id !== authority.outlet_id) {
      throw new Error(`The local ${name} result is incomplete or outside this outlet. Refresh before relying on it.`);
    }
    return result.data;
  };

  /** @param {string} command @param {object} payload @param {(result: LoyaltyCommandResultView) => void} [afterCommit] */
  const run = (command, payload, afterCommit) => {
    setError('');
    setNotice('');
    return onCommand(command, payload, null, afterCommit);
  };

  /** @param {string} customerId */
  const refreshLoyaltyBalance = async (customerId) => {
    const requestId = ++loyaltyBalanceRequest.current;
    if (!customerId) {
      setLoyaltyBalance(null); setLoyaltyBalanceAsOf(''); setLoyaltyBalanceError('');
      setLoyaltyBalanceLoading(false);
      return;
    }
    setLoyaltyBalanceLoading(true); setLoyaltyBalanceError('');
    try {
      const result = await window.api.pos.barLocal.query('loyalty.account.get', { customer_id: customerId });
      if (!result || result.complete !== true || result.scope?.business_id !== authority.business_id
        || result.scope?.outlet_id !== authority.outlet_id
        || (Array.isArray(result.unavailable) && result.unavailable.length)) {
        throw new Error('The local loyalty balance is incomplete or outside this outlet.');
      }
      if (requestId !== loyaltyBalanceRequest.current) return;
      setLoyaltyBalance(result.data && typeof result.data === 'object' ? result.data : null);
      setLoyaltyBalanceAsOf(String(result.as_of || ''));
    } catch (cause) {
      if (requestId !== loyaltyBalanceRequest.current) return;
      setLoyaltyBalance(null); setLoyaltyBalanceAsOf(''); setLoyaltyBalanceError(getMessage(cause));
    } finally {
      if (requestId === loyaltyBalanceRequest.current) setLoyaltyBalanceLoading(false);
    }
  };

  /** @param {string} command @param {object} payload @param {string} pin @param {(result: LoyaltyCommandResultView) => void} [afterCommit] */
  const approveAndRun = async (command, payload, pin, afterCommit) => {
    if (blocked || approvalBusy) return;
    if (!PIN_VALUE.test(String(pin || ''))) {
      setError('A different authorised manager must enter a valid numeric PIN.');
      return;
    }
    const operationId = crypto.randomUUID();
    setApprovalBusy(true);
    setError('');
    setNotice('');
    try {
      const approval = await window.api.pos.barLocal.requestApproval(command, payload, pin, { operationId });
      if (!approval?.approval_id) throw new Error('Manager approval was not confirmed. No operation was submitted.');
      return await onCommand(command, { ...payload, approval_id: approval.approval_id }, null, afterCommit, operationId);
    } catch (cause) {
      setError(getMessage(cause));
    } finally {
      setApprovalBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        if (section === 'purchasing') {
          const [supplierRows, poRows] = await Promise.all([
            query('suppliers.list', { limit: 200 }),
            query('purchase_orders.list', { limit: 100 })
          ]);
          if (!cancelled) { setSuppliers(supplierRows); setPurchaseOrders(poRows); }
        } else if (section === 'customers') {
          const [customerRows, voucherRows] = await Promise.all([
            query('customers.list', { limit: 200 }),
            can('vouchers.manage') ? query('vouchers.list', { limit: 200 }) : Promise.resolve([])
          ]);
          if (!cancelled) { setCustomers(customerRows); setVouchers(voucherRows); }
        } else if (section === 'control') {
          const [templateRows, checklistRows, incidentRows] = await Promise.all([
            query('control.templates.list', {}),
            query('control.checklists.list', { from: businessDate, to: businessDate, limit: 100 }),
            query('control.incidents.list', { from: businessDate, to: businessDate, limit: 100 })
          ]);
          if (!cancelled) { setTemplates(templateRows); setChecklists(checklistRows); setIncidents(incidentRows); }
        } else if (section === 'workforce') {
          const [staffList, rosterRows, currentRows, attendanceList] = await Promise.all([
            query('staff.list', { include_suspended: true }),
            query('workforce.roster', { from: businessDate, to: businessDate, limit: 200 }),
            query('workforce.attendance.current', {}),
            query('workforce.attendance.list', { from: businessDate, to: businessDate, limit: 200 })
          ]);
          if (!cancelled) {
            setStaffRows(staffList); setRoster(rosterRows); setAttendanceCurrent(currentRows); setAttendanceRows(attendanceList);
          }
        } else if (section === 'accounting') {
          const [accountRows, expenseRows, balanceRows] = await Promise.all([
            query('accounting.accounts.list', { limit: 500 }),
            query('expenses.list', { limit: 100 }),
            query('accounting.trial_balance', {})
          ]);
          if (!cancelled) { setAccounts(accountRows); setExpenses(expenseRows); setTrialBalance(balanceRows); }
        }
      } catch (cause) {
        if (!cancelled) setError(getMessage(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [section, panelVersion, authority.business_id, authority.outlet_id, businessDate]);

  useEffect(() => {
    let cancelled = false;
    if (section !== 'purchasing' || !selectedPoId) { setSelectedPo(null); return undefined; }
    void query('purchase_order.get', { purchase_order_id: selectedPoId }).then((data) => {
      if (!cancelled) {
        setSelectedPo(data);
        setReceiveDraft({
          supplier_reference: '',
          notes: '',
          received_on: today(),
          lines: Object.fromEntries((Array.isArray(data.lines) ? data.lines : []).map((line) => [String(line.purchase_order_line_id), {
            quantity: Number(line.quantity_remaining) > 0 ? String(line.quantity_remaining) : '',
            unit_cost: String(line.unit_cost ?? ''),
            lot_code: '',
            expires_on: ''
          }]))
        });
      }
    }).catch((cause) => { if (!cancelled) setError(getMessage(cause)); });
    return () => { cancelled = true; };
  }, [section, selectedPoId, panelVersion]);

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  const createSupplier = (event) => {
    event.preventDefault();
    if (!supplierDraft.name.trim()) { setError('Enter a supplier name.'); return; }
    const payload = {
      name: supplierDraft.name.trim(), active: supplierDraft.active,
      ...(supplierDraft.contact_name.trim() ? { contact_name: supplierDraft.contact_name.trim() } : {}),
      ...(supplierDraft.phone.trim() ? { phone: supplierDraft.phone.trim() } : {}),
      ...(supplierDraft.email.trim() ? { email: supplierDraft.email.trim() } : {}),
      ...(supplierDraft.address.trim() ? { address: supplierDraft.address.trim() } : {}),
      ...(supplierDraft.notes.trim() ? { notes: supplierDraft.notes.trim() } : {})
    };
    void run('supplier.upsert', payload, () => setSupplierDraft({ name: '', contact_name: '', phone: '', email: '', address: '', notes: '', active: true }));
  };

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  const createPurchaseOrder = (event) => {
    event.preventDefault();
    if (!poDraft.supplier_id) { setError('Select a supplier.'); return; }
    const lines = poDraft.lines.map((line) => ({
      product_id: line.product_id,
      quantity: String(line.quantity || '').trim(),
      unit_cost: String(line.unit_cost || '').trim(),
      ...(String(line.tax_rate || '').trim() ? { tax_rate: String(line.tax_rate).trim() } : {})
    })).filter((line) => line.product_id || line.quantity || line.unit_cost);
    if (lines.length === 0) { setError('Add at least one purchase-order line.'); return; }
    for (const line of lines) {
      if (!line.product_id) { setError('Select a product on every purchase-order line.'); return; }
      if (!QUANTITY_SIX.test(line.quantity) || Number(line.quantity) <= 0) { setError('Purchase quantities must be greater than zero with up to six decimals.'); return; }
      if (!MONEY_TWO.test(line.unit_cost)) { setError('Unit costs must be non-negative amounts with up to two decimals.'); return; }
    }
    if (new Set(lines.map((line) => line.product_id)).size !== lines.length) { setError('A product can appear only once on a purchase order.'); return; }
    const supplier = suppliers.find((item) => String(item.supplier_id) === poDraft.supplier_id);
    const payload = {
      supplier_id: poDraft.supplier_id,
      lines,
      ...(supplier && Number.isSafeInteger(Number(supplier.version)) ? { expected_supplier_version: Number(supplier.version) } : {}),
      ...(poDraft.expected_on ? { expected_on: poDraft.expected_on } : {}),
      ...(poDraft.notes.trim() ? { notes: poDraft.notes.trim() } : {})
    };
    void approveAndRun('purchase_order.create', payload, poApprovalPin, () => {
      setPoApprovalPin('');
      setPoDraft({ supplier_id: '', expected_supplier_version: '', expected_on: '', notes: '', lines: [{ product_id: '', quantity: '', unit_cost: '', tax_rate: '' }] });
    });
  };

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  const receivePurchaseOrder = (event) => {
    event.preventDefault();
    if (!selectedPo) return;
    const lines = (Array.isArray(selectedPo.lines) ? selectedPo.lines : []).map((line) => {
      const draft = receiveDraft.lines[String(line.purchase_order_line_id)] || {};
      return {
        purchase_order_line_id: String(line.purchase_order_line_id),
        quantity: String(draft.quantity || '').trim(),
        ...(String(draft.unit_cost || '').trim() ? { unit_cost: String(draft.unit_cost).trim() } : {}),
        ...(String(draft.lot_code || '').trim() ? { lot_code: String(draft.lot_code).trim() } : {}),
        ...(draft.expires_on ? { expires_on: draft.expires_on } : {})
      };
    }).filter((line) => line.quantity);
    if (lines.length === 0) { setError('Enter a received quantity for at least one purchase-order line.'); return; }
    for (const line of lines) {
      const source = selectedPo.lines.find((item) => String(item.purchase_order_line_id) === line.purchase_order_line_id);
      if (!QUANTITY_SIX.test(line.quantity) || Number(line.quantity) <= 0) { setError('Received quantities must be greater than zero with up to six decimals.'); return; }
      if (Number(line.quantity) > Number(source.quantity_remaining)) { setError(`Received quantity for ${String(source.name_snapshot)} cannot exceed the remaining quantity.`); return; }
    }
    void run('purchase_order.receive', {
      purchase_order_id: selectedPo.purchase_order_id,
      expected_version: selectedPo.version,
      lines,
      ...(receiveDraft.supplier_reference.trim() ? { supplier_reference: receiveDraft.supplier_reference.trim() } : {}),
      ...(receiveDraft.notes.trim() ? { notes: receiveDraft.notes.trim() } : {}),
      ...(receiveDraft.received_on ? { received_on: receiveDraft.received_on } : {})
    }, () => {
      setSelectedPoId('');
      setSelectedPo(null);
    });
  };

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  const cancelPurchaseOrder = (event) => {
    event.preventDefault();
    if (!selectedPo) return;
    if (!cancelDraft.reason.trim()) { setError('Enter why this purchase order is being cancelled.'); return; }
    void approveAndRun('purchase_order.cancel', {
      purchase_order_id: selectedPo.purchase_order_id,
      expected_version: selectedPo.version,
      reason: cancelDraft.reason.trim()
    }, cancelDraft.pin, () => {
      setCancelDraft({ reason: '', pin: '' });
      setSelectedPoId('');
      setSelectedPo(null);
    });
  };

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  const createCustomer = (event) => {
    event.preventDefault();
    if (!customerDraft.name.trim()) { setError('Enter a customer name.'); return; }
    if (!MONEY_TWO.test(customerDraft.credit_limit)) { setError('Credit limit must be a non-negative amount with up to two decimals.'); return; }
    void run('customer.create', {
      name: customerDraft.name.trim(),
      credit_limit: customerDraft.credit_limit.trim(),
      ...(customerDraft.phone.trim() ? { phone: customerDraft.phone.trim() } : {}),
      ...(customerDraft.email.trim() ? { email: customerDraft.email.trim() } : {})
    }, () => setCustomerDraft({ name: '', phone: '', email: '', credit_limit: '0.00' }));
  };

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  const recordCreditPayment = (event) => {
    event.preventDefault();
    if (!shift) { setError('Open a trading shift before recording a credit payment.'); return; }
    if (!creditDraft.customer_id) { setError('Select a customer.'); return; }
    if (!MONEY_TWO.test(creditDraft.amount) || Number(creditDraft.amount) <= 0) { setError('Enter a payment greater than zero with up to two decimals.'); return; }
    void run('customer.credit.payment', {
      customer_id: creditDraft.customer_id,
      amount: creditDraft.amount.trim(),
      method: creditDraft.method,
      shift_id: shift.shift_id,
      ...(creditDraft.reference.trim() ? { reference: creditDraft.reference.trim() } : {})
    }, () => setCreditDraft((draft) => ({ ...draft, amount: '', reference: '' })));
  };

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  const issueVoucher = (event) => {
    event.preventDefault();
    if (!MONEY_TWO.test(voucherDraft.amount) || Number(voucherDraft.amount) <= 0) { setError('Enter a voucher amount greater than zero with up to two decimals.'); return; }
    void approveAndRun('voucher.issue', {
      amount: voucherDraft.amount.trim(),
      ...(voucherDraft.customer_id ? { customer_id: voucherDraft.customer_id } : {}),
      ...(voucherDraft.code.trim() ? { code: voucherDraft.code.trim().toUpperCase() } : {}),
      ...(voucherDraft.expires_on ? { expires_on: voucherDraft.expires_on } : {})
    }, voucherDraft.pin, () => setVoucherDraft({ customer_id: '', amount: '', code: '', expires_on: '', pin: '' }));
  };

  /** @param {string} customerId */
  const enrolLoyalty = (customerId) => {
    if (!customerId) { setError('Select a customer before enrolling them.'); return; }
    void run('loyalty.account.enrol', { customer_id: customerId }, (result) => {
      setLoyaltyResult(result?.result || null);
      setLoyaltyDraft((draft) => ({ ...draft, customer_id: customerId }));
      void refreshLoyaltyBalance(customerId);
    });
  };

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  const earnLoyalty = (event) => {
    event.preventDefault();
    if (!loyaltyDraft.customer_id) { setError('Select a customer for this loyalty earning.'); return; }
    if (!UUID_VALUE.test(loyaltyDraft.sale_id)) { setError('Enter the UUID of a committed local sale.'); return; }
    void run('loyalty.points.earn', { customer_id: loyaltyDraft.customer_id, sale_id: loyaltyDraft.sale_id }, (result) => {
      setLoyaltyResult(result?.result || null);
      setLoyaltyDraft((draft) => ({ ...draft, sale_id: '' }));
      void refreshLoyaltyBalance(loyaltyDraft.customer_id);
    });
  };

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  const redeemLoyalty = (event) => {
    event.preventDefault();
    if (!loyaltyDraft.customer_id) { setError('Select a customer before redeeming points.'); return; }
    if (!/^\d+$/.test(loyaltyDraft.points) || Number(loyaltyDraft.points) <= 0) { setError('Enter a whole number of loyalty points greater than zero.'); return; }
    if (!loyaltyDraft.reference.trim()) { setError('Enter a reason or reference for this points redemption.'); return; }
    void run('loyalty.points.redeem', {
      customer_id: loyaltyDraft.customer_id,
      points: Number(loyaltyDraft.points),
      reference: loyaltyDraft.reference.trim()
    }, (result) => {
      setLoyaltyResult(result?.result || null);
      setLoyaltyDraft((draft) => ({ ...draft, points: '', reference: '' }));
      void refreshLoyaltyBalance(loyaltyDraft.customer_id);
    });
  };

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  const startChecklist = (event) => {
    event.preventDefault();
    if (!checklistDraft.template_key) { setError('Select a checklist template.'); return; }
    void run('control.checklist.start', {
      template_key: checklistDraft.template_key,
      ...(shift?.shift_id ? { shift_id: shift.shift_id } : {})
    }, () => setChecklistDraft({ template_key: '' }));
  };

  /** @param {ChecklistView} checklist @param {ChecklistItemView} item @param {boolean} completed */
  const setChecklistItem = (checklist, item, completed) => {
    void run('control.checklist.item.set', {
      checklist_id: checklist.checklist_id,
      item_id: item.item_id,
      completed,
      expected_version: checklist.version,
      ...(item.note ? { note: item.note } : {})
    });
  };

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  const logIncident = (event) => {
    event.preventDefault();
    if (!incidentDraft.category.trim() || !incidentDraft.description.trim()) { setError('Enter an incident category and description.'); return; }
    void run('control.incident.log', {
      category: incidentDraft.category.trim(),
      severity: incidentDraft.severity,
      description: incidentDraft.description.trim(),
      ...(incidentDraft.immediate_action.trim() ? { immediate_action: incidentDraft.immediate_action.trim() } : {})
    }, () => setIncidentDraft({ category: 'operations', severity: 'medium', description: '', immediate_action: '' }));
  };

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  const resolveIncident = (event) => {
    event.preventDefault();
    const incident = incidents.find((item) => String(item.id) === selectedIncidentId);
    if (!incident) { setError('Select an open incident.'); return; }
    if (!incidentResolution.trim()) { setError('Enter the resolution evidence.'); return; }
    void run('control.incident.resolve', {
      incident_id: incident.id,
      expected_version: incident.version,
      resolution: incidentResolution.trim()
    }, () => { setSelectedIncidentId(''); setIncidentResolution(''); });
  };

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  const saveRosterShift = (event) => {
    event.preventDefault();
    if (!rosterDraft.staff_id) { setError('Select a staff member for the roster shift.'); return; }
    if (!TIME_VALUE.test(rosterDraft.starts_at) || !TIME_VALUE.test(rosterDraft.ends_at)) { setError('Enter valid start and end times.'); return; }
    if (rosterDraft.starts_at === rosterDraft.ends_at) { setError('Start and end times must differ.'); return; }
    const payload = {
      staff_id: rosterDraft.staff_id,
      work_date: rosterDraft.work_date,
      starts_at: rosterDraft.starts_at,
      ends_at: rosterDraft.ends_at,
      break_minutes: Number(rosterDraft.break_minutes || 0),
      ...(rosterDraft.role_label.trim() ? { role_label: rosterDraft.role_label.trim() } : {}),
      ...(rosterDraft.notes.trim() ? { notes: rosterDraft.notes.trim() } : {}),
      ...(rosterDraft.shift_id ? { shift_id: rosterDraft.shift_id, expected_version: Number(rosterDraft.expected_version) } : {})
    };
    void run('workforce.shift.schedule', payload, () => setRosterDraft({ shift_id: '', staff_id: '', expected_version: '', work_date: businessDate, starts_at: '09:00', ends_at: '17:00', break_minutes: '0', role_label: '', notes: '' }));
  };

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  const clockIn = (event) => {
    event.preventDefault();
    if (!clockInDraft.staff_id) { setError('Select the staff member clocking in.'); return; }
    void run('workforce.clock.in', {
      staff_id: clockInDraft.staff_id,
      ...(clockInDraft.workforce_shift_id ? { workforce_shift_id: clockInDraft.workforce_shift_id } : {}),
      ...(shift?.shift_id ? { trading_shift_id: shift.shift_id } : {}),
      ...(clockInDraft.note.trim() ? { note: clockInDraft.note.trim() } : {})
    }, () => setClockInDraft({ staff_id: '', workforce_shift_id: '', note: '' }));
  };

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  const clockOut = (event) => {
    event.preventDefault();
    if (!clockOutDraft.attendance_id) { setError('Select an open attendance period.'); return; }
    void run('workforce.clock.out', {
      attendance_id: clockOutDraft.attendance_id,
      ...(clockOutDraft.note.trim() ? { note: clockOutDraft.note.trim() } : {})
    }, () => setClockOutDraft({ attendance_id: '', note: '' }));
  };

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  const cancelRosterShift = (event) => {
    event.preventDefault();
    if (!cancelShiftDraft.shift_id) { setError('Select a roster shift to cancel.'); return; }
    if (!cancelShiftDraft.reason.trim()) { setError('Enter why this roster shift is being cancelled.'); return; }
    void run('workforce.shift.cancel', {
      shift_id: cancelShiftDraft.shift_id,
      expected_version: Number(cancelShiftDraft.expected_version),
      reason: cancelShiftDraft.reason.trim()
    }, () => setCancelShiftDraft({ shift_id: '', expected_version: '', reason: '' }));
  };

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  const createExpense = (event) => {
    event.preventDefault();
    if (!expenseDraft.category.trim() || !expenseDraft.description.trim()) { setError('Enter an expense category and description.'); return; }
    if (!MONEY_TWO.test(expenseDraft.amount) || Number(expenseDraft.amount) <= 0) { setError('Enter an expense amount greater than zero with up to two decimals.'); return; }
    if (!expenseDraft.expense_account_code || !expenseDraft.payment_account_code) { setError('Select both the expense and payment accounts.'); return; }
    void run('expense.create', {
      expense_date: expenseDraft.expense_date,
      category: expenseDraft.category.trim(),
      description: expenseDraft.description.trim(),
      amount: expenseDraft.amount.trim(),
      expense_account_code: expenseDraft.expense_account_code,
      payment_account_code: expenseDraft.payment_account_code,
      ...(expenseDraft.reference.trim() ? { reference: expenseDraft.reference.trim() } : {})
    }, () => setExpenseDraft((draft) => ({ ...draft, category: '', description: '', amount: '', reference: '' })));
  };

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  const voidExpense = (event) => {
    event.preventDefault();
    if (!voidExpenseDraft.expense_id) { setError('Select a posted expense to void.'); return; }
    if (!voidExpenseDraft.reason.trim()) { setError('Enter the void reason.'); return; }
    void approveAndRun('expense.void', {
      expense_id: voidExpenseDraft.expense_id,
      expected_version: Number(voidExpenseDraft.expected_version),
      reason: voidExpenseDraft.reason.trim()
    }, voidExpenseDraft.pin, () => setVoidExpenseDraft({ expense_id: '', expected_version: '', reason: '', pin: '' }));
  };

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  const postJournal = (event) => {
    event.preventDefault();
    if (!journalDraft.memo.trim()) { setError('Enter a journal memo.'); return; }
    if (!journalDraft.source_type.trim()) { setError('Enter a journal source type.'); return; }
    const lines = journalDraft.lines.map((line) => ({
      account_code: line.account_code,
      debit: String(line.debit || '').trim() || '0.00',
      credit: String(line.credit || '').trim() || '0.00',
      ...(line.description.trim() ? { description: line.description.trim() } : {})
    })).filter((line) => line.account_code || line.debit !== '0.00' || line.credit !== '0.00');
    if (lines.length < 2) { setError('A journal needs at least two lines.'); return; }
    const debitTotal = lines.reduce((sum, line) => sum + Number(line.debit), 0);
    const creditTotal = lines.reduce((sum, line) => sum + Number(line.credit), 0);
    if (Math.abs(debitTotal - creditTotal) > 0.0001) { setError('Journal debit and credit totals must balance before posting.'); return; }
    if (lines.some((line) => !line.account_code || !MONEY_TWO.test(line.debit) || !MONEY_TWO.test(line.credit))) { setError('Every journal line needs an account and valid debit or credit amounts.'); return; }
    void run('accounting.journal.post', {
      entry_date: journalDraft.entry_date,
      memo: journalDraft.memo.trim(),
      source_type: journalDraft.source_type.trim(),
      lines
    }, () => setJournalDraft({ entry_date: today(), memo: '', source_type: 'manual_adjustment', lines: [{ account_code: '', debit: '', credit: '', description: '' }, { account_code: '', debit: '', credit: '', description: '' }] }));
  };

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  const closePeriod = (event) => {
    event.preventDefault();
    if (!MONTH_VALUE.test(periodDraft.period)) { setError('Enter the accounting period as YYYY-MM.'); return; }
    void approveAndRun('accounting.period.close', { period: periodDraft.period }, periodDraft.pin, () => setPeriodDraft((draft) => ({ ...draft, pin: '' })));
  };

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  const submitStockMovement = (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    const product = (Array.isArray(stock) ? stock : []).find((item) => String(item.product_id) === stockForm.product_id);
    if (!product) { setError('Select the product for this stock movement.'); return; }
    if (!canManageInventory) { setError('Inventory management permission is required to change stock.'); return; }
    if (stockForm.mode === 'receive') {
      if (!QUANTITY_SIX.test(stockForm.quantity) || Number(stockForm.quantity) <= 0) { setError('Receive quantity must be greater than zero with up to six decimals.'); return; }
      if (stockForm.unit_cost.trim() && !COST_FOUR.test(stockForm.unit_cost)) { setError('Unit cost must be a non-negative amount with up to four decimals.'); return; }
      if (stockForm.expires_on && !DATE_ONLY.test(stockForm.expires_on)) { setError('Expiry must be a YYYY-MM-DD date.'); return; }
      void run('stock.receive', {
        product_id: product.product_id,
        quantity: stockForm.quantity.trim(),
        ...(stockForm.unit_cost.trim() ? { unit_cost: stockForm.unit_cost.trim() } : {}),
        ...(stockForm.supplier_ref.trim() ? { supplier_ref: stockForm.supplier_ref.trim() } : {}),
        ...(stockForm.lot_code.trim() ? { lot_code: stockForm.lot_code.trim() } : {}),
        ...(stockForm.expires_on ? { expires_on: stockForm.expires_on } : {})
      }, () => setStockForm((draft) => ({ ...draft, quantity: '', unit_cost: '', supplier_ref: '', lot_code: '', expires_on: '' })));
      return;
    }
    if (stockForm.mode === 'adjust') {
      if (!SIGNED_QUANTITY_SIX.test(stockForm.delta.trim()) || Number(stockForm.delta) >= 0) { setError('Adjustment delta must be negative with up to six decimals. Use receive for increases.'); return; }
      if (!stockForm.reason.trim()) { setError('Enter why this stock is being adjusted.'); return; }
      if (!PIN_VALUE.test(stockForm.pin)) { setError('A different manager must enter a valid PIN to approve the stock adjustment.'); return; }
      void approveAndRun('stock.adjust', {
        product_id: product.product_id,
        delta: stockForm.delta.trim(),
        reason: stockForm.reason.trim()
      }, stockForm.pin, () => setStockForm((draft) => ({ ...draft, delta: '', reason: '', pin: '' })));
      return;
    }
    if (stockForm.mode === 'stocktake') {
      if (!QUANTITY_SIX.test(stockForm.counted_quantity) || Number(stockForm.counted_quantity) < 0) { setError('Counted quantity must be zero or greater with up to six decimals.'); return; }
      void run('stock.stocktake', {
        product_id: product.product_id,
        counted_quantity: stockForm.counted_quantity.trim(),
        ...(stockForm.reason.trim() ? { reason: stockForm.reason.trim() } : {})
      }, () => setStockForm((draft) => ({ ...draft, counted_quantity: '', reason: '' })));
      return;
    }
    if (stockForm.mode === 'waste') {
      if (!QUANTITY_SIX.test(stockForm.quantity) || Number(stockForm.quantity) <= 0) { setError('Waste quantity must be greater than zero with up to six decimals.'); return; }
      const lot = stockLotBalanceRows.find((row) => row.lot_id === stockForm.lot_id && row.product_id === product.product_id && Number(row.remaining_quantity) > 0);
      if (!lot) { setError('Select the exact lot being discarded.'); return; }
      if (Number(stockForm.quantity) > Number(lot.remaining_quantity)) { setError('Waste cannot exceed the selected lot balance. Refresh the lots and retry.'); return; }
      if (!stockForm.reason.trim()) { setError('Enter why this stock was wasted.'); return; }
      if (!PIN_VALUE.test(stockForm.pin)) { setError('A different manager must enter a valid PIN to approve the stock waste.'); return; }
      void approveAndRun('stock.lot.waste', {
        lot_id: lot.lot_id,
        product_id: product.product_id,
        expected_version: lot.version,
        quantity: stockForm.quantity.trim(),
        reason: stockForm.reason.trim()
      }, stockForm.pin, () => setStockForm((draft) => ({ ...draft, lot_id: '', quantity: '', reason: '', pin: '' })));
      return;
    }
    if (stockForm.mode === 'transfer') {
      if (!UUID_VALUE.test(stockForm.to_outlet_id.trim())) { setError('Enter the destination outlet UUID issued for this Bar authority.'); return; }
      if (!QUANTITY_SIX.test(stockForm.quantity) || Number(stockForm.quantity) <= 0) { setError('Transfer quantity must be greater than zero with up to six decimals.'); return; }
      if (!stockForm.reason.trim()) { setError('Enter why this stock is being transferred.'); return; }
      void run('stock.transfer', {
        product_id: product.product_id,
        to_outlet_id: stockForm.to_outlet_id.trim(),
        quantity: stockForm.quantity.trim(),
        reason: stockForm.reason.trim()
      }, () => setStockForm((draft) => ({ ...draft, quantity: '', reason: '', to_outlet_id: '' })));
    }
  };

  const submitLotRelease = (event) => {
    event.preventDefault(); setError(''); setNotice('');
    const lot = stockLotBalanceRows.find((row) => row.lot_id === lotReleaseDraft.lot_id && row.sale_eligible === false && Number(row.remaining_quantity) > 0);
    if (!lot) { setError('Select a quarantined return lot to inspect.'); return; }
    if (!lotReleaseDraft.verified_lot_code.trim()) { setError('Enter the lot code confirmed from the product packaging.'); return; }
    if (!DATE_ONLY.test(lotReleaseDraft.verified_expires_on) && !lotReleaseDraft.no_expiry_confirmed) { setError('Enter a verified expiry date or confirm that the item has no expiry.'); return; }
    if (lotReleaseDraft.verified_expires_on && lotReleaseDraft.no_expiry_confirmed) { setError('Choose either an expiry date or no-expiry confirmation, not both.'); return; }
    if (!lotReleaseDraft.reason.trim()) { setError('Record the physical inspection result and reason.'); return; }
    if (!PIN_VALUE.test(lotReleaseDraft.pin)) { setError('A different manager must approve the release.'); return; }
    void approveAndRun('stock.lot.release', {
      lot_id: lot.lot_id, expected_version: lot.version, verified_lot_code: lotReleaseDraft.verified_lot_code.trim(),
      verified_expires_on: lotReleaseDraft.verified_expires_on || null, no_expiry_confirmed: lotReleaseDraft.no_expiry_confirmed,
      reason: lotReleaseDraft.reason.trim()
    }, lotReleaseDraft.pin, () => setLotReleaseDraft({ lot_id: '', verified_lot_code: '', verified_expires_on: '', no_expiry_confirmed: false, reason: '', pin: '' }));
  };

  /** @param {number} index @param {keyof PurchaseOrderDraftLine} field @param {string} value */
  const updatePoLine = (index, field, value) => setPoDraft((draft) => ({
    ...draft,
    lines: draft.lines.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line)
  }));

  /** @param {number} index @param {keyof JournalDraftLine} field @param {string} value */
  const updateJournalLine = (index, field, value) => setJournalDraft((draft) => ({
    ...draft,
    lines: draft.lines.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line)
  }));

  const selectedSupplier = suppliers.find((item) => String(item.supplier_id) === poDraft.supplier_id);
  const activeAccounts = accounts.filter((account) => account.active !== false);

  return (
    <div className="mt-5 space-y-4">
      {error && <p role="alert" className="rounded border border-red-700 bg-red-950/50 p-3 text-sm text-red-100">{error}</p>}
      {notice && <p role="status" className="rounded border border-emerald-700 bg-emerald-950/40 p-3 text-sm text-emerald-100">{notice}</p>}
      {!localReady && <p role="status" className="rounded border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-100">Authenticated readiness is not current. Operational mutations are paused.</p>}
      {loading && <p className="text-xs text-slate-400">Loading local operational data…</p>}

      {section === 'stock' && <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Panel title="Stock balances" description="Quantities are derived from the local stock movement ledger.">
          <div className="mt-3 overflow-x-auto rounded border border-slate-700"><table className="w-full text-left text-sm"><thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-400"><tr><th className="p-3">Product</th><th className="p-3">SKU</th><th className="p-3">On hand</th><th className="p-3">Tracked</th></tr></thead><tbody>{(Array.isArray(stock) ? stock : []).map((product) => <tr key={String(product.product_id)} className="border-t border-slate-800"><td className="p-3">{String(product.name)}</td><td className="p-3 text-slate-400">{String(product.sku)}</td><td className="p-3">{displayMoney(product.quantity)}</td><td className="p-3">{product.track_stock ? 'Yes' : 'No'}</td></tr>)}</tbody></table>{(Array.isArray(stock) ? stock : []).length === 0 && !loading && <p className="p-4 text-sm text-slate-300">No local stock products are published.</p>}</div>
          <p className="mt-2 text-xs text-slate-400">Adjustments and waste require a different manager approval. Every movement is authoritative and audited by the local service.</p>
        </Panel>
        <Panel title="Stock movement" description="Record receipts, negative adjustments, counts, waste or outlet transfers.">
          {canManageInventory ? <form onSubmit={submitStockMovement} className="mt-3 space-y-2">
            <Field label="Movement"><select value={stockForm.mode} onChange={(event) => setStockForm((draft) => ({ ...draft, mode: event.target.value, pin: '', reason: '' }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="receive">Receive stock</option><option value="adjust">Negative adjustment (approval)</option><option value="stocktake">Stocktake count</option><option value="waste">Record waste (approval)</option><option value="transfer">Transfer to another outlet</option></select></Field>
            <Field label="Product"><select required value={stockForm.product_id} onChange={(event) => setStockForm((draft) => ({ ...draft, product_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select a product</option>{(Array.isArray(stock) ? stock : []).map((product) => <option key={String(product.product_id)} value={String(product.product_id)}>{String(product.name)} ({String(product.sku)}) · {displayMoney(product.quantity)}</option>)}</select></Field>

            {stockForm.mode === 'stocktake' ? (
              <Field label="Counted quantity"><TextInput required inputMode="decimal" value={stockForm.counted_quantity} onChange={(event) => setStockForm((draft) => ({ ...draft, counted_quantity: event.target.value }))} /></Field>
            ) : stockForm.mode === 'adjust' ? (
              <Field label="Adjustment delta (negative)"><TextInput required inputMode="decimal" placeholder="-1.00" value={stockForm.delta} onChange={(event) => setStockForm((draft) => ({ ...draft, delta: event.target.value }))} /></Field>
            ) : (
              <Field label="Quantity"><TextInput required inputMode="decimal" value={stockForm.quantity} onChange={(event) => setStockForm((draft) => ({ ...draft, quantity: event.target.value }))} /></Field>
            )}
            {stockForm.mode === 'waste' && <Field label="Lot to discard"><select required value={stockForm.lot_id} onChange={(event) => setStockForm((draft) => ({ ...draft, lot_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select the exact lot</option>{stockLotBalanceRows.filter((row) => row.product_id === selectedStockProduct?.product_id && Number(row.remaining_quantity) > 0).map((row) => <option key={row.lot_id} value={row.lot_id}>{row.lot_code || 'Unknown lot'} · {displayQuantity(row.remaining_quantity)} remaining · {row.expiry_status}</option>)}</select></Field>}

            {stockForm.mode === 'receive' && <>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Unit cost (optional)"><TextInput inputMode="decimal" value={stockForm.unit_cost} onChange={(event) => setStockForm((draft) => ({ ...draft, unit_cost: event.target.value }))} /></Field>
                <Field label="Expires on (optional)"><TextInput type="date" value={stockForm.expires_on} onChange={(event) => setStockForm((draft) => ({ ...draft, expires_on: event.target.value }))} /></Field>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Supplier reference"><TextInput maxLength={160} value={stockForm.supplier_ref} onChange={(event) => setStockForm((draft) => ({ ...draft, supplier_ref: event.target.value }))} /></Field>
                <Field label="Lot code"><TextInput maxLength={120} value={stockForm.lot_code} onChange={(event) => setStockForm((draft) => ({ ...draft, lot_code: event.target.value }))} /></Field>
              </div>
            </>}

            {stockForm.mode === 'transfer' && <Field label="Destination outlet UUID"><TextInput required maxLength={36} value={stockForm.to_outlet_id} onChange={(event) => setStockForm((draft) => ({ ...draft, to_outlet_id: event.target.value }))} /></Field>}

            <Field label={stockForm.mode === 'stocktake' ? 'Reason (optional)' : 'Reason'}>{stockForm.mode === 'receive' ? <TextInput maxLength={500} value={stockForm.reason} onChange={(event) => setStockForm((draft) => ({ ...draft, reason: event.target.value }))} /> : <textarea required={stockForm.mode !== 'stocktake'} maxLength={500} value={stockForm.reason} onChange={(event) => setStockForm((draft) => ({ ...draft, reason: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" />}</Field>

            {(stockForm.mode === 'adjust' || stockForm.mode === 'waste') && <Field label="Different manager PIN"><TextInput required type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={stockForm.pin} onChange={(event) => setStockForm((draft) => ({ ...draft, pin: event.target.value.replace(/\D/g, '') }))} /></Field>}

            <button type="submit" disabled={blocked || approvalBusy || (Array.isArray(stock) ? stock : []).length === 0 || !stockForm.product_id || ((stockForm.mode === 'adjust' || stockForm.mode === 'waste') && !PIN_VALUE.test(stockForm.pin))} className="w-full rounded bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-40">{stockForm.mode === 'adjust' ? 'Approve and adjust stock' : stockForm.mode === 'waste' ? 'Approve and record waste' : stockForm.mode === 'stocktake' ? 'Commit stocktake' : stockForm.mode === 'transfer' ? 'Transfer stock' : 'Receive stock'}</button>
            <p className="text-xs text-slate-400">Stocktake reconciles to the exact counted quantity. Adjustments must be negative; use receive for increases. Transfer requires an outlet UUID on this local authority.</p>
          </form> : <p className="mt-3 text-xs text-slate-400">Inventory management permission is required to change stock.</p>}
        </Panel>
        <div className="lg:col-span-2"><Panel title="Lot and expiry receipts" description="Historical receipt records. Current remaining quantities and FEFO allocation are shown separately above.">
          <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase tracking-wide text-slate-400"><tr><th className="p-2">Product</th><th className="p-2">Lot</th><th className="p-2">Received</th><th className="p-2">Expiry</th><th className="p-2">Status</th><th className="p-2">Reference</th></tr></thead><tbody>{(/** @type {BarLocalOperationsStockLotRowView[]} */ (Array.isArray(stockLotRows) ? stockLotRows : [])).map((row) => <tr key={String(row.movement_id)} className="border-t border-slate-800"><td className="p-2">{String(row.name)} · {String(row.sku)}</td><td className="p-2">{displayValue(row.lot_code)}</td><td className="p-2">{displayValue(row.received_quantity)}</td><td className="p-2">{displayValue(row.expires_on)}</td><td className={`p-2 ${row.expiry_status === 'expired' ? 'text-rose-300' : row.expiry_status === 'expiring_soon' ? 'text-amber-200' : 'text-emerald-300'}`}>{displayValue(row.expiry_status)}</td><td className="p-2">{displayValue(row.supplier_reference)}</td></tr>)}</tbody></table>{(/** @type {BarLocalOperationsStockLotRowView[]} */ (stockLotRows)).length === 0 && <p className="p-3 text-sm text-slate-300">No lot-coded or expiry-dated receipts were found for this outlet.</p>}</div>
        </Panel></div>
        {canManageInventory && stockLotBalanceRows.some((row) => row.sale_eligible === false && Number(row.remaining_quantity) > 0) && <div className="lg:col-span-2"><Panel title="Inspect and release a quarantined return" description="Physically inspect the product and packaging. The local authority blocks release of expired stock; leave expiry blank only when the inspected item has no expiry date.">
          <form onSubmit={submitLotRelease} className="mt-3 space-y-3"><div className="grid gap-3 sm:grid-cols-2"><Field label="Quarantined lot"><select required value={lotReleaseDraft.lot_id} onChange={(event) => setLotReleaseDraft((draft) => ({ ...draft, lot_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select return lot</option>{stockLotBalanceRows.filter((row) => row.sale_eligible === false && Number(row.remaining_quantity) > 0).map((row) => <option key={row.lot_id} value={row.lot_id}>{row.name} · {row.lot_code || 'unknown lot'} · {displayQuantity(row.remaining_quantity)} remaining</option>)}</select></Field><Field label="Verified lot code"><TextInput required maxLength={120} value={lotReleaseDraft.verified_lot_code} onChange={(event) => setLotReleaseDraft((draft) => ({ ...draft, verified_lot_code: event.target.value }))} /></Field><Field label="Verified expiry date (blank only if none)"><TextInput type="date" value={lotReleaseDraft.verified_expires_on} onChange={(event) => setLotReleaseDraft((draft) => ({ ...draft, verified_expires_on: event.target.value }))} /></Field><Field label="Different manager PIN"><TextInput required type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={lotReleaseDraft.pin} onChange={(event) => setLotReleaseDraft((draft) => ({ ...draft, pin: event.target.value.replace(/\D/g, '') }))} /></Field></div><Field label="Inspection result and reason"><textarea required maxLength={500} value={lotReleaseDraft.reason} onChange={(event) => setLotReleaseDraft((draft) => ({ ...draft, reason: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></Field><label className="inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={lotReleaseDraft.no_expiry_confirmed} onChange={(event) => setLotReleaseDraft((draft) => ({ ...draft, no_expiry_confirmed: event.target.checked }))} />I verified the item has no expiry date</label><button disabled={blocked || approvalBusy} className="rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">Approve and release inspected lot</button></form>
        </Panel></div>}
      </div>}

      {section === 'purchasing' && <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Suppliers" description="Suppliers are local to this Bar authority.">
          <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto text-sm">{(Array.isArray(suppliers) ? suppliers : []).map((supplier) => <li key={String(supplier.supplier_id)} className="rounded border border-slate-700 bg-slate-950/60 p-2"><div className="flex justify-between gap-2"><span className="font-semibold">{String(supplier.name)}</span><span className="text-xs text-slate-400">v{String(supplier.version)} · {supplier.active === false ? 'inactive' : 'active'}</span></div><p className="mt-1 text-xs text-slate-400">{displayValue(supplier.contact_name)} · {displayValue(supplier.phone)} · {displayValue(supplier.email)}</p></li>)}</ul>
          {suppliers.length === 0 && !loading && <p className="mt-2 text-sm text-slate-300">No suppliers are recorded.</p>}
          {canManageInventory ? <form onSubmit={createSupplier} className="mt-4 border-t border-slate-700 pt-4">
            <h3 className="font-medium">Add supplier</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Field label="Name"><TextInput required maxLength={160} value={supplierDraft.name} onChange={(event) => setSupplierDraft((draft) => ({ ...draft, name: event.target.value }))} /></Field>
              <Field label="Contact"><TextInput maxLength={160} value={supplierDraft.contact_name} onChange={(event) => setSupplierDraft((draft) => ({ ...draft, contact_name: event.target.value }))} /></Field>
              <Field label="Phone"><TextInput maxLength={40} value={supplierDraft.phone} onChange={(event) => setSupplierDraft((draft) => ({ ...draft, phone: event.target.value }))} /></Field>
              <Field label="Email"><TextInput maxLength={200} value={supplierDraft.email} onChange={(event) => setSupplierDraft((draft) => ({ ...draft, email: event.target.value }))} /></Field>
            </div>
            <Field label="Address"><TextInput maxLength={500} value={supplierDraft.address} onChange={(event) => setSupplierDraft((draft) => ({ ...draft, address: event.target.value }))} /></Field>
            <Field label="Notes"><textarea maxLength={2000} value={supplierDraft.notes} onChange={(event) => setSupplierDraft((draft) => ({ ...draft, notes: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></Field>
            <button type="submit" disabled={blocked} className="mt-3 rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">Save supplier</button>
          </form> : <p className="mt-4 border-t border-slate-700 pt-4 text-xs text-slate-400">Your role can view suppliers. Inventory management permission is required to change them.</p>}
        </Panel>
        <Panel title="Purchase orders" description="Create, cancel and receive approved purchase orders. All movements are revalidated by the local authority.">
          <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto text-sm">{purchaseOrders.map((order) => <li key={String(order.purchase_order_id)}><button type="button" disabled={blocked} onClick={() => setSelectedPoId(String(order.purchase_order_id))} className={`w-full rounded border p-2 text-left ${selectedPoId === String(order.purchase_order_id) ? 'border-amber-400 bg-amber-950/30' : 'border-slate-700 bg-slate-950/60'}`}><span className="flex justify-between gap-2"><span className="font-semibold">{String(order.po_number)} · {String(order.supplier_name)}</span><span>{displayMoney(order.total)}</span></span><span className="mt-1 block text-xs text-slate-400">{String(order.status)} · ordered {String(order.ordered_on)} · {String(order.line_count)} line(s)</span></button></li>)}</ul>
          {purchaseOrders.length === 0 && !loading && <p className="mt-2 text-sm text-slate-300">No purchase orders are recorded for this outlet.</p>}
          {canManageInventory ? <form onSubmit={createPurchaseOrder} className="mt-4 border-t border-slate-700 pt-4">
            <h3 className="font-medium">Create purchase order</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Field label="Supplier"><select required value={poDraft.supplier_id} onChange={(event) => setPoDraft((draft) => ({ ...draft, supplier_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select supplier</option>{suppliers.filter((supplier) => supplier.active !== false).map((supplier) => <option key={String(supplier.supplier_id)} value={String(supplier.supplier_id)}>{String(supplier.name)}</option>)}</select></Field>
              <Field label="Expected on"><TextInput type="date" value={poDraft.expected_on} onChange={(event) => setPoDraft((draft) => ({ ...draft, expected_on: event.target.value }))} /></Field>
            </div>
            {selectedSupplier && <p className="mt-2 text-xs text-slate-400">Supplier version {String(selectedSupplier.version)} will be used for stale-write protection.</p>}
            <div className="mt-3 space-y-2">{poDraft.lines.map((line, index) => <div key={index} className="grid gap-2 rounded border border-slate-800 p-2 sm:grid-cols-[1.4fr_0.8fr_0.8fr_0.7fr_auto]">
              <Field label="Product"><select value={line.product_id} onChange={(event) => updatePoLine(index, 'product_id', event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select product</option>{stock.map((product) => <option key={String(product.product_id)} value={String(product.product_id)}>{String(product.name)}</option>)}</select></Field>
              <Field label="Quantity"><TextInput inputMode="decimal" value={line.quantity} onChange={(event) => updatePoLine(index, 'quantity', event.target.value)} /></Field>
              <Field label="Unit cost"><TextInput inputMode="decimal" value={line.unit_cost} onChange={(event) => updatePoLine(index, 'unit_cost', event.target.value)} /></Field>
              <Field label="Tax rate"><TextInput inputMode="decimal" value={line.tax_rate} onChange={(event) => updatePoLine(index, 'tax_rate', event.target.value)} /></Field>
              <button type="button" disabled={poDraft.lines.length === 1} onClick={() => setPoDraft((draft) => ({ ...draft, lines: draft.lines.filter((_item, lineIndex) => lineIndex !== index) }))} className="self-end rounded border border-rose-700 px-2 py-2 text-xs text-rose-200 disabled:opacity-30">Remove</button>
            </div>)}</div>
            <button type="button" onClick={() => setPoDraft((draft) => ({ ...draft, lines: [...draft.lines, { product_id: '', quantity: '', unit_cost: '', tax_rate: '' }] }))} className="mt-2 rounded border border-slate-600 px-3 py-1 text-xs">Add line</button>
            <Field label="Notes"><textarea maxLength={2000} value={poDraft.notes} onChange={(event) => setPoDraft((draft) => ({ ...draft, notes: event.target.value }))} className="mt-2 w-full rounded bg-slate-800 p-2 text-sm" /></Field>
            <Field label="Approving manager PIN"><TextInput required type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={poApprovalPin} onChange={(event) => setPoApprovalPin(event.target.value.replace(/\D/g, ''))} /></Field>
            <button type="submit" disabled={blocked || approvalBusy || !PIN_VALUE.test(poApprovalPin)} className="mt-3 rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">{approvalBusy ? 'Approving…' : 'Approve and create order'}</button>
          </form> : <p className="mt-4 border-t border-slate-700 pt-4 text-xs text-slate-400">Inventory management permission is required to create purchase orders.</p>}
        </Panel>
        {selectedPo && <Panel title={`Purchase order ${String(selectedPo.po_number)}`}>
          <p className="mt-1 text-sm">Supplier {String(selectedPo.supplier?.name)} · status {String(selectedPo.status)} · version {String(selectedPo.version)} · total {displayMoney(selectedPo.total)}</p>
          <ul className="mt-3 space-y-1 text-xs">{(selectedPo.lines || []).map((line) => <li key={String(line.purchase_order_line_id)} className="flex justify-between gap-2"><span>{String(line.name_snapshot)} · ordered {String(line.quantity_ordered)} · received {String(line.quantity_received)} · remaining {String(line.quantity_remaining)}</span><span>{displayMoney(line.unit_cost)}</span></li>)}</ul>
          {selectedPo.status !== 'cancelled' && canManageInventory && <form onSubmit={receivePurchaseOrder} className="mt-4 border-t border-slate-700 pt-4">
            <h3 className="font-medium">Receive stock</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2"><Field label="Supplier reference"><TextInput maxLength={160} value={receiveDraft.supplier_reference} onChange={(event) => setReceiveDraft((draft) => ({ ...draft, supplier_reference: event.target.value }))} /></Field><Field label="Received on"><TextInput type="date" value={receiveDraft.received_on} onChange={(event) => setReceiveDraft((draft) => ({ ...draft, received_on: event.target.value }))} /></Field></div>
            <div className="mt-3 space-y-2">{(selectedPo.lines || []).filter((line) => Number(line.quantity_remaining) > 0).map((line) => { const id = String(line.purchase_order_line_id); const draft = receiveDraft.lines[id] || {}; return <div key={id} className="grid gap-2 rounded border border-slate-800 p-2 sm:grid-cols-[1.3fr_0.7fr_0.7fr_0.7fr_0.8fr]"><p className="self-end text-xs">{String(line.name_snapshot)} · remaining {String(line.quantity_remaining)}</p><Field label="Quantity"><TextInput inputMode="decimal" value={draft.quantity || ''} onChange={(event) => setReceiveDraft((current) => ({ ...current, lines: { ...current.lines, [id]: { ...draft, quantity: event.target.value } } }))} /></Field><Field label="Unit cost"><TextInput inputMode="decimal" value={draft.unit_cost || ''} onChange={(event) => setReceiveDraft((current) => ({ ...current, lines: { ...current.lines, [id]: { ...draft, unit_cost: event.target.value } } }))} /></Field><Field label="Lot"><TextInput maxLength={120} value={draft.lot_code || ''} onChange={(event) => setReceiveDraft((current) => ({ ...current, lines: { ...current.lines, [id]: { ...draft, lot_code: event.target.value } } }))} /></Field><Field label="Expires"><TextInput type="date" value={draft.expires_on || ''} onChange={(event) => setReceiveDraft((current) => ({ ...current, lines: { ...current.lines, [id]: { ...draft, expires_on: event.target.value } } }))} /></Field></div>; })}</div>
            <Field label="Notes"><textarea maxLength={2000} value={receiveDraft.notes} onChange={(event) => setReceiveDraft((draft) => ({ ...draft, notes: event.target.value }))} className="mt-2 w-full rounded bg-slate-800 p-2 text-sm" /></Field>
            <button type="submit" disabled={blocked || Number(selectedPo.version) < 1} className="mt-3 rounded bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-40">Receive selected quantities</button>
          </form>}
          {selectedPo.status !== 'cancelled' && canManageInventory && <form onSubmit={cancelPurchaseOrder} className="mt-4 border-t border-slate-700 pt-4">
            <h3 className="font-medium">Cancel purchase order</h3>
            <Field label="Reason"><textarea required maxLength={1000} value={cancelDraft.reason} onChange={(event) => setCancelDraft((draft) => ({ ...draft, reason: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></Field>
            <Field label="Approving manager PIN"><TextInput required type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={cancelDraft.pin} onChange={(event) => setCancelDraft((draft) => ({ ...draft, pin: event.target.value.replace(/\D/g, '') }))} /></Field>
            <button type="submit" disabled={blocked || approvalBusy || !cancelDraft.reason.trim() || !PIN_VALUE.test(cancelDraft.pin)} className="mt-2 rounded border border-rose-700 px-4 py-2 text-sm text-rose-100 disabled:opacity-40">Approve and cancel</button>
          </form>}
        </Panel>}
      </div>}

      {section === 'customers' && <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Customer accounts" description="Credit balances are derived from the local credit ledger.">
          <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto text-sm">{customers.map((customer) => <li key={String(customer.customer_id)} className="rounded border border-slate-700 bg-slate-950/60 p-2"><div className="flex justify-between gap-2"><span className="font-semibold">{String(customer.name)}</span><span>{displayMoney(customer.outstanding)}</span></div><p className="mt-1 text-xs text-slate-400">Limit {displayMoney(customer.credit_limit)} · {displayValue(customer.phone)} · {String(customer.status)}</p></li>)}</ul>
          {customers.length === 0 && !loading && <p className="mt-2 text-sm text-slate-300">No customer accounts are recorded.</p>}
          <form onSubmit={createCustomer} className="mt-4 border-t border-slate-700 pt-4">
            <h3 className="font-medium">Create customer</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2"><Field label="Name"><TextInput required maxLength={160} value={customerDraft.name} onChange={(event) => setCustomerDraft((draft) => ({ ...draft, name: event.target.value }))} /></Field><Field label="Phone"><TextInput maxLength={40} value={customerDraft.phone} onChange={(event) => setCustomerDraft((draft) => ({ ...draft, phone: event.target.value }))} /></Field><Field label="Email"><TextInput maxLength={200} value={customerDraft.email} onChange={(event) => setCustomerDraft((draft) => ({ ...draft, email: event.target.value }))} /></Field><Field label="Credit limit"><TextInput required inputMode="decimal" value={customerDraft.credit_limit} onChange={(event) => setCustomerDraft((draft) => ({ ...draft, credit_limit: event.target.value }))} /></Field></div>
            <button type="submit" disabled={blocked} className="mt-3 rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">Save customer</button>
          </form>
        </Panel>
        <Panel title="Credit payments">
          {!shift && <p className="mt-2 text-sm text-amber-100">Open a trading shift before recording a credit payment.</p>}
          <form onSubmit={recordCreditPayment} className="mt-3 space-y-2">
            <Field label="Customer"><select required value={creditDraft.customer_id} onChange={(event) => setCreditDraft((draft) => ({ ...draft, customer_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select customer</option>{customers.map((customer) => <option key={String(customer.customer_id)} value={String(customer.customer_id)}>{String(customer.name)} · owes {displayMoney(customer.outstanding)}</option>)}</select></Field>
            <div className="grid gap-2 sm:grid-cols-2"><Field label="Amount"><TextInput required inputMode="decimal" value={creditDraft.amount} onChange={(event) => setCreditDraft((draft) => ({ ...draft, amount: event.target.value }))} /></Field><Field label="Method"><select value={creditDraft.method} onChange={(event) => setCreditDraft((draft) => ({ ...draft, method: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="cash">Cash</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option></select></Field></div>
            <Field label="Reference"><TextInput maxLength={120} value={creditDraft.reference} onChange={(event) => setCreditDraft((draft) => ({ ...draft, reference: event.target.value }))} /></Field>
            <button type="submit" disabled={blocked || !shift || !creditDraft.customer_id} className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-40">Record credit payment</button>
          </form>
        </Panel>
        {can('vouchers.manage') && <Panel title="Vouchers" description="Voucher issuance creates a local liability and requires manager approval.">
          <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-xs">{vouchers.map((voucher) => <li key={String(voucher.voucher_id)} className="flex justify-between gap-2"><span>{String(voucher.code)} · {String(voucher.status)}</span><span>{displayMoney(voucher.balance)} / {displayMoney(voucher.initial_amount)}</span></li>)}</ul>
          <form onSubmit={issueVoucher} className="mt-3 border-t border-slate-700 pt-3">
            <div className="grid gap-2 sm:grid-cols-2"><Field label="Amount"><TextInput required inputMode="decimal" value={voucherDraft.amount} onChange={(event) => setVoucherDraft((draft) => ({ ...draft, amount: event.target.value }))} /></Field><Field label="Code (optional)"><TextInput maxLength={60} value={voucherDraft.code} onChange={(event) => setVoucherDraft((draft) => ({ ...draft, code: event.target.value.toUpperCase() }))} /></Field></div>
            <div className="grid gap-2 sm:grid-cols-2"><Field label="Customer (optional)"><select value={voucherDraft.customer_id} onChange={(event) => setVoucherDraft((draft) => ({ ...draft, customer_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">No customer</option>{customers.map((customer) => <option key={String(customer.customer_id)} value={String(customer.customer_id)}>{String(customer.name)}</option>)}</select></Field><Field label="Expires on"><TextInput type="date" value={voucherDraft.expires_on} onChange={(event) => setVoucherDraft((draft) => ({ ...draft, expires_on: event.target.value }))} /></Field></div>
            <Field label="Approving manager PIN"><TextInput required type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={voucherDraft.pin} onChange={(event) => setVoucherDraft((draft) => ({ ...draft, pin: event.target.value.replace(/\D/g, '') }))} /></Field>
            <button type="submit" disabled={blocked || approvalBusy || !PIN_VALUE.test(voucherDraft.pin)} className="mt-2 rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">Approve and issue voucher</button>
          </form>
        </Panel>}
        {can('customers.manage') && <Panel title="Loyalty points" description="The local authority validates enrollment, the sale/customer link, programme rules and available balance. A points redemption records a loyalty liability event; it does not discount or pay a sale.">
          <Field label="Customer"><select required value={loyaltyDraft.customer_id} onChange={(event) => { const id = event.target.value; setLoyaltyDraft((draft) => ({ ...draft, customer_id: id })); void refreshLoyaltyBalance(id); }} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select customer</option>{customers.map((customer) => <option key={String(customer.customer_id)} value={String(customer.customer_id)}>{String(customer.name)}</option>)}</select></Field>
          {loyaltyBalanceLoading && <p role="status" className="mt-2 text-xs text-slate-300">Checking the local loyalty balance…</p>}
          {loyaltyBalanceError && <p role="alert" className="mt-2 text-xs text-amber-200">{loyaltyBalanceError}</p>}
          {loyaltyDraft.customer_id && !loyaltyBalanceLoading && !loyaltyBalanceError && <p role="status" className="mt-2 rounded border border-slate-700 bg-slate-950 p-2 text-xs">{loyaltyBalance ? `${displayValue(loyaltyBalance.points_balance)} points · ${displayValue(loyaltyBalance.status)} · checked ${loyaltyBalanceAsOf || 'time unavailable'}` : 'This customer is not enrolled in the local loyalty programme.'}</p>}
          <button type="button" disabled={blocked || !loyaltyDraft.customer_id} onClick={() => enrolLoyalty(loyaltyDraft.customer_id)} className="mt-2 rounded border border-slate-600 px-3 py-2 text-xs disabled:opacity-40">Enroll customer</button>
          <form onSubmit={earnLoyalty} className="mt-3 space-y-2 border-t border-slate-700 pt-3"><Field label="Committed local sale UUID"><TextInput required maxLength={36} value={loyaltyDraft.sale_id} onChange={(event) => setLoyaltyDraft((draft) => ({ ...draft, sale_id: event.target.value.trim() }))} /></Field><button type="submit" disabled={blocked || !loyaltyDraft.customer_id || !UUID_VALUE.test(loyaltyDraft.sale_id)} className="rounded bg-emerald-700 px-3 py-2 text-xs font-semibold disabled:opacity-40">Earn points from sale</button></form>
          <form onSubmit={redeemLoyalty} className="mt-3 space-y-2 border-t border-slate-700 pt-3"><div className="grid gap-2 sm:grid-cols-2"><Field label="Points"><TextInput required inputMode="numeric" pattern="[0-9]+" value={loyaltyDraft.points} onChange={(event) => setLoyaltyDraft((draft) => ({ ...draft, points: event.target.value.replace(/\D/g, '') }))} /></Field><Field label="Reason or reference"><TextInput required maxLength={160} value={loyaltyDraft.reference} onChange={(event) => setLoyaltyDraft((draft) => ({ ...draft, reference: event.target.value }))} /></Field></div><button type="submit" disabled={blocked || !loyaltyDraft.customer_id || !/^\d+$/.test(loyaltyDraft.points) || !loyaltyDraft.reference.trim()} className="rounded bg-amber-600 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-40">Redeem points</button></form>
          {loyaltyResult && <p role="status" className="mt-3 rounded border border-emerald-800 bg-emerald-950/40 p-2 text-xs">Authority result: {String(loyaltyResult.type || loyaltyResult.status || 'loyalty operation recorded')} · balance {displayValue(loyaltyResult.points_balance)} points{loyaltyResult.redemption_value != null ? ` · redemption value ${displayMoney(loyaltyResult.redemption_value)}` : ''}</p>}
          <p className="mt-2 text-xs text-slate-400">This is a current service read, not a promise that redemption will be accepted. The local authority rechecks balance and programme rules when the operation commits. If it refuses, refresh and resolve the customer’s record with an authorised manager.</p>
        </Panel>}
      </div>}

      {section === 'control' && <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Checklists" description={`Showing ${businessDate}. Required items must be completed before the closure process can accept the checklist.`}>
          <form onSubmit={startChecklist} className="mt-3 flex flex-wrap items-end gap-2"><Field label="Template"><select required value={checklistDraft.template_key} onChange={(event) => setChecklistDraft({ template_key: event.target.value })} className="mt-1 rounded bg-slate-800 p-2 text-sm"><option value="">Select template</option>{templates.map((template) => <option key={String(template.template_key)} value={String(template.template_key)}>{String(template.name)}</option>)}</select></Field><button type="submit" disabled={blocked || !checklistDraft.template_key} className="rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">Start checklist</button></form>
          <div className="mt-4 space-y-3">{checklists.map((checklist) => <div key={String(checklist.checklist_id)} className="rounded border border-slate-700 bg-slate-950/60 p-3"><div className="flex justify-between gap-2 text-sm"><span className="font-semibold">{String(checklist.template_name)} · {String(checklist.status)}</span><span className="text-xs text-slate-400">v{String(checklist.version)}</span></div><ul className="mt-2 space-y-1 text-xs">{(checklist.items || []).map((item) => <li key={String(item.item_id)} className="flex items-center justify-between gap-2"><label className="flex items-center gap-2"><input type="checkbox" checked={item.completed === true} disabled={blocked || checklist.status === 'completed'} onChange={(event) => setChecklistItem(checklist, item, event.target.checked)} /><span>{String(item.label)}{item.required ? ' · required' : ''}</span></label><span className="text-slate-400">{item.completed ? 'done' : 'open'}</span></li>)}</ul></div>)}</div>
          {checklists.length === 0 && !loading && <p className="mt-3 text-sm text-slate-300">No checklists have been started for this business date.</p>}
        </Panel>
        <Panel title="Operational incidents" description="Record immediate action and resolution evidence against each incident.">
          <form onSubmit={logIncident} className="mt-3 space-y-2">
            <div className="grid gap-2 sm:grid-cols-2"><Field label="Category"><TextInput required maxLength={80} value={incidentDraft.category} onChange={(event) => setIncidentDraft((draft) => ({ ...draft, category: event.target.value }))} /></Field><Field label="Severity"><select value={incidentDraft.severity} onChange={(event) => setIncidentDraft((draft) => ({ ...draft, severity: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></Field></div>
            <Field label="Description"><textarea required maxLength={2000} value={incidentDraft.description} onChange={(event) => setIncidentDraft((draft) => ({ ...draft, description: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></Field>
            <Field label="Immediate action"><textarea maxLength={1000} value={incidentDraft.immediate_action} onChange={(event) => setIncidentDraft((draft) => ({ ...draft, immediate_action: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></Field>
            <button type="submit" disabled={blocked} className="rounded bg-rose-700 px-4 py-2 text-sm font-semibold disabled:opacity-40">Log incident</button>
          </form>
          <ul className="mt-4 max-h-56 space-y-2 overflow-y-auto text-xs">{incidents.map((incident) => <li key={String(incident.id)}><button type="button" disabled={blocked || incident.status === 'resolved'} onClick={() => setSelectedIncidentId(String(incident.id))} className={`w-full rounded border p-2 text-left ${selectedIncidentId === String(incident.id) ? 'border-amber-400 bg-amber-950/30' : 'border-slate-700 bg-slate-950/60'}`}><span className="flex justify-between gap-2"><span className="font-semibold">{String(incident.severity)} · {String(incident.category)}</span><span>{String(incident.status)}</span></span><span className="mt-1 block text-slate-300">{String(incident.description)}</span></button></li>)}</ul>
          {selectedIncidentId && <form onSubmit={resolveIncident} className="mt-3 border-t border-slate-700 pt-3"><Field label="Resolution evidence"><textarea required maxLength={2000} value={incidentResolution} onChange={(event) => setIncidentResolution(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></Field><button type="submit" disabled={blocked || !incidentResolution.trim()} className="mt-2 rounded bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-40">Resolve incident</button></form>}
        </Panel>
      </div>}

      {section === 'workforce' && <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Roster" description={`Showing ${businessDate}. Roster edits use the current shift version.`}>
          <form onSubmit={saveRosterShift} className="mt-3 space-y-2">
            <div className="grid gap-2 sm:grid-cols-2"><Field label="Staff"><select required value={rosterDraft.staff_id} onChange={(event) => setRosterDraft((draft) => ({ ...draft, staff_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select staff</option>{staffRows.map((row) => <option key={String(row.staff_id)} value={String(row.staff_id)}>{String(row.display_name)} · {String(row.role)} · {String(row.status)}</option>)}</select></Field><Field label="Work date"><TextInput required type="date" value={rosterDraft.work_date} onChange={(event) => setRosterDraft((draft) => ({ ...draft, work_date: event.target.value }))} /></Field><Field label="Starts"><TextInput required type="time" value={rosterDraft.starts_at} onChange={(event) => setRosterDraft((draft) => ({ ...draft, starts_at: event.target.value }))} /></Field><Field label="Ends"><TextInput required type="time" value={rosterDraft.ends_at} onChange={(event) => setRosterDraft((draft) => ({ ...draft, ends_at: event.target.value }))} /></Field><Field label="Break minutes"><TextInput required inputMode="numeric" value={rosterDraft.break_minutes} onChange={(event) => setRosterDraft((draft) => ({ ...draft, break_minutes: event.target.value.replace(/\D/g, '') }))} /></Field><Field label="Role label"><TextInput maxLength={80} value={rosterDraft.role_label} onChange={(event) => setRosterDraft((draft) => ({ ...draft, role_label: event.target.value }))} /></Field></div>
            <Field label="Notes"><TextInput maxLength={500} value={rosterDraft.notes} onChange={(event) => setRosterDraft((draft) => ({ ...draft, notes: event.target.value }))} /></Field>
            <div className="flex gap-2"><button type="submit" disabled={blocked} className="rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">{rosterDraft.shift_id ? 'Save roster changes' : 'Schedule shift'}</button>{rosterDraft.shift_id && <button type="button" onClick={() => setRosterDraft({ shift_id: '', staff_id: '', expected_version: '', work_date: businessDate, starts_at: '09:00', ends_at: '17:00', break_minutes: '0', role_label: '', notes: '' })} className="rounded border border-slate-600 px-3 py-2 text-sm">Cancel edit</button>}</div>
          </form>
          <ul className="mt-4 max-h-56 space-y-2 overflow-y-auto text-xs">{roster.map((item) => <li key={String(item.shift_id)} className="flex items-center justify-between gap-2 rounded border border-slate-700 bg-slate-950/60 p-2"><div><p className="font-semibold">{String(item.display_name)} · {String(item.starts_at)}–{String(item.ends_at)}</p><p className="mt-1 text-slate-400">{String(item.work_date)} · {String(item.status)} · v{String(item.version)} · {String(item.scheduled_minutes)} min</p></div><button type="button" disabled={blocked} onClick={() => setRosterDraft({ shift_id: String(item.shift_id), staff_id: String(item.staff_id), expected_version: String(item.version), work_date: String(item.work_date), starts_at: String(item.starts_at), ends_at: String(item.ends_at), break_minutes: String(item.break_minutes || 0), role_label: item.role_label ? String(item.role_label) : '', notes: item.notes ? String(item.notes) : '' })} className="rounded border border-slate-600 px-2 py-1">Edit</button></li>)}</ul>
          <form onSubmit={cancelRosterShift} className="mt-3 border-t border-slate-700 pt-3">
            <Field label="Cancel roster shift"><select required value={cancelShiftDraft.shift_id} onChange={(event) => { const row = roster.find((item) => String(item.shift_id) === event.target.value); setCancelShiftDraft({ shift_id: event.target.value, expected_version: row ? String(row.version) : '', reason: cancelShiftDraft.reason }); }} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select shift</option>{roster.filter((item) => item.status !== 'cancelled').map((item) => <option key={String(item.shift_id)} value={String(item.shift_id)}>{String(item.work_date)} · {String(item.display_name)} · {String(item.starts_at)}</option>)}</select></Field>
            <Field label="Reason"><TextInput required maxLength={500} value={cancelShiftDraft.reason} onChange={(event) => setCancelShiftDraft((draft) => ({ ...draft, reason: event.target.value }))} /></Field>
            <button type="submit" disabled={blocked || !cancelShiftDraft.shift_id || !cancelShiftDraft.reason.trim()} className="mt-2 rounded border border-rose-700 px-4 py-2 text-sm text-rose-100 disabled:opacity-40">Cancel shift</button>
          </form>
        </Panel>
        <Panel title="Attendance" description="One open attendance period is allowed per staff member.">
          <form onSubmit={clockIn} className="mt-3 space-y-2">
            <Field label="Staff clocking in"><select required value={clockInDraft.staff_id} onChange={(event) => setClockInDraft((draft) => ({ ...draft, staff_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select staff</option>{staffRows.filter((row) => row.status === 'active').map((row) => <option key={String(row.staff_id)} value={String(row.staff_id)}>{String(row.display_name)} · {String(row.role)}</option>)}</select></Field>
            <Field label="Roster shift (optional)"><select value={clockInDraft.workforce_shift_id} onChange={(event) => setClockInDraft((draft) => ({ ...draft, workforce_shift_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">No roster shift</option>{roster.filter((item) => item.status !== 'cancelled').map((item) => <option key={String(item.shift_id)} value={String(item.shift_id)}>{String(item.work_date)} · {String(item.display_name)} · {String(item.starts_at)}</option>)}</select></Field>
            <Field label="Note"><TextInput maxLength={500} value={clockInDraft.note} onChange={(event) => setClockInDraft((draft) => ({ ...draft, note: event.target.value }))} /></Field>
            <button type="submit" disabled={blocked || !clockInDraft.staff_id} className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-40">Clock in</button>
          </form>
          <div className="mt-4 border-t border-slate-700 pt-3">
            <h3 className="font-medium">Open attendance</h3>
            <ul className="mt-2 space-y-2 text-xs">{attendanceCurrent.map((item) => <li key={String(item.attendance_id)} className="rounded border border-slate-700 bg-slate-950/60 p-2"><p className="font-semibold">{String(item.display_name)} · since {String(item.clocked_in_at)} · {String(item.minutes_worked)} min</p><button type="button" disabled={blocked} onClick={() => setClockOutDraft((draft) => ({ ...draft, attendance_id: String(item.attendance_id) }))} className="mt-2 rounded border border-slate-600 px-2 py-1">Select for clock-out</button></li>)}</ul>
            {attendanceCurrent.length === 0 && <p className="mt-2 text-xs text-slate-400">No attendance periods are open.</p>}
          </div>
          <form onSubmit={clockOut} className="mt-3 border-t border-slate-700 pt-3">
            <Field label="Attendance to close"><select required value={clockOutDraft.attendance_id} onChange={(event) => setClockOutDraft((draft) => ({ ...draft, attendance_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select open attendance</option>{attendanceCurrent.map((item) => <option key={String(item.attendance_id)} value={String(item.attendance_id)}>{String(item.display_name)} · {String(item.clocked_in_at)}</option>)}</select></Field>
            <Field label="Clock-out note"><TextInput maxLength={500} value={clockOutDraft.note} onChange={(event) => setClockOutDraft((draft) => ({ ...draft, note: event.target.value }))} /></Field>
            <button type="submit" disabled={blocked || !clockOutDraft.attendance_id} className="mt-2 rounded border border-slate-600 px-4 py-2 text-sm disabled:opacity-40">Clock out</button>
          </form>
          <div className="mt-4 border-t border-slate-700 pt-3">
            <h3 className="font-medium">Completed attendance today</h3>
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs">{attendanceRows.filter((item) => item.status !== 'open').map((item) => <li key={String(item.attendance_id)} className="flex justify-between gap-2"><span>{String(item.display_name)} · {String(item.clocked_in_at)}</span><span>{String(item.minutes_worked)} min</span></li>)}</ul>
          </div>
        </Panel>
      </div>}

      {section === 'accounting' && <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Trial balance" description="Active accounts only. Values are derived from posted local journal lines.">
          <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-slate-400"><tr><th className="p-2">Account</th><th className="p-2">Type</th><th className="p-2">Debit</th><th className="p-2">Credit</th><th className="p-2">Balance</th></tr></thead><tbody>{trialBalance.map((row) => <tr key={String(row.account_code)} className="border-t border-slate-800"><td className="p-2">{String(row.account_code)} · {String(row.name)}</td><td className="p-2 text-slate-400">{String(row.type)}</td><td className="p-2">{displayMoney(row.debit)}</td><td className="p-2">{displayMoney(row.credit)}</td><td className="p-2">{displayMoney(row.balance)}</td></tr>)}</tbody></table>{trialBalance.length === 0 && !loading && <p className="mt-2 text-sm text-slate-300">No active accounting accounts are configured.</p>}</div>
        </Panel>
        <Panel title="Expenses" description="Expenses post balanced journals. Voids require accounting approval.">
          {canManageAccounting ? <form onSubmit={createExpense} className="mt-3 space-y-2">
            <div className="grid gap-2 sm:grid-cols-2"><Field label="Date"><TextInput required type="date" value={expenseDraft.expense_date} onChange={(event) => setExpenseDraft((draft) => ({ ...draft, expense_date: event.target.value }))} /></Field><Field label="Category"><TextInput required maxLength={80} value={expenseDraft.category} onChange={(event) => setExpenseDraft((draft) => ({ ...draft, category: event.target.value }))} /></Field><Field label="Amount"><TextInput required inputMode="decimal" value={expenseDraft.amount} onChange={(event) => setExpenseDraft((draft) => ({ ...draft, amount: event.target.value }))} /></Field><Field label="Reference"><TextInput maxLength={120} value={expenseDraft.reference} onChange={(event) => setExpenseDraft((draft) => ({ ...draft, reference: event.target.value }))} /></Field><Field label="Expense account"><select required value={expenseDraft.expense_account_code} onChange={(event) => setExpenseDraft((draft) => ({ ...draft, expense_account_code: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select account</option>{activeAccounts.filter((account) => account.type === 'expense').map((account) => <option key={String(account.account_code)} value={String(account.account_code)}>{String(account.account_code)} · {String(account.name)}</option>)}</select></Field><Field label="Payment account"><select required value={expenseDraft.payment_account_code} onChange={(event) => setExpenseDraft((draft) => ({ ...draft, payment_account_code: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select account</option>{activeAccounts.filter((account) => account.type === 'asset' || account.type === 'liability').map((account) => <option key={String(account.account_code)} value={String(account.account_code)}>{String(account.account_code)} · {String(account.name)}</option>)}</select></Field></div>
            <Field label="Description"><textarea required maxLength={500} value={expenseDraft.description} onChange={(event) => setExpenseDraft((draft) => ({ ...draft, description: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></Field>
            <button type="submit" disabled={blocked} className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-40">Post expense</button>
          </form> : <p className="mt-3 text-xs text-slate-400">Accounting management permission is required to post expenses.</p>}
          <ul className="mt-4 max-h-44 space-y-1 overflow-y-auto text-xs">{expenses.map((expense) => <li key={String(expense.expense_id)}><button type="button" disabled={blocked || !canManageAccounting || expense.status !== 'posted'} onClick={() => setVoidExpenseDraft({ expense_id: String(expense.expense_id), expected_version: String(expense.version), reason: '', pin: '' })} className={`w-full rounded border p-2 text-left ${voidExpenseDraft.expense_id === String(expense.expense_id) ? 'border-amber-400 bg-amber-950/30' : 'border-slate-700 bg-slate-950/60'}`}><span className="flex justify-between gap-2"><span>{String(expense.expense_date)} · {String(expense.category)}</span><span>{displayMoney(expense.amount)} · {String(expense.status)}</span></span></button></li>)}</ul>
          {voidExpenseDraft.expense_id && <form onSubmit={voidExpense} className="mt-3 border-t border-slate-700 pt-3"><Field label="Void reason"><textarea required maxLength={500} value={voidExpenseDraft.reason} onChange={(event) => setVoidExpenseDraft((draft) => ({ ...draft, reason: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></Field><Field label="Approving manager PIN"><TextInput required type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={voidExpenseDraft.pin} onChange={(event) => setVoidExpenseDraft((draft) => ({ ...draft, pin: event.target.value.replace(/\D/g, '') }))} /></Field><button type="submit" disabled={blocked || approvalBusy || !PIN_VALUE.test(voidExpenseDraft.pin) || !voidExpenseDraft.reason.trim()} className="mt-2 rounded border border-rose-700 px-4 py-2 text-sm text-rose-100 disabled:opacity-40">Approve and void expense</button></form>}
        </Panel>
        <Panel title="Manual journal" description="Debits and credits must balance. Posted journals are immutable.">
          {canManageAccounting ? <form onSubmit={postJournal} className="mt-3 space-y-2">
            <div className="grid gap-2 sm:grid-cols-2"><Field label="Entry date"><TextInput required type="date" value={journalDraft.entry_date} onChange={(event) => setJournalDraft((draft) => ({ ...draft, entry_date: event.target.value }))} /></Field><Field label="Source type"><TextInput required maxLength={60} value={journalDraft.source_type} onChange={(event) => setJournalDraft((draft) => ({ ...draft, source_type: event.target.value }))} /></Field></div>
            <Field label="Memo"><TextInput required maxLength={1000} value={journalDraft.memo} onChange={(event) => setJournalDraft((draft) => ({ ...draft, memo: event.target.value }))} /></Field>
            <div className="space-y-2">{journalDraft.lines.map((line, index) => <div key={index} className="grid gap-2 rounded border border-slate-800 p-2 sm:grid-cols-[1.3fr_0.7fr_0.7fr_1fr_auto]"><Field label="Account"><select value={line.account_code} onChange={(event) => updateJournalLine(index, 'account_code', event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select account</option>{activeAccounts.map((account) => <option key={String(account.account_code)} value={String(account.account_code)}>{String(account.account_code)} · {String(account.name)}</option>)}</select></Field><Field label="Debit"><TextInput inputMode="decimal" value={line.debit} onChange={(event) => updateJournalLine(index, 'debit', event.target.value)} /></Field><Field label="Credit"><TextInput inputMode="decimal" value={line.credit} onChange={(event) => updateJournalLine(index, 'credit', event.target.value)} /></Field><Field label="Description"><TextInput maxLength={500} value={line.description} onChange={(event) => updateJournalLine(index, 'description', event.target.value)} /></Field></div>)}</div>
            <button type="button" onClick={() => setJournalDraft((draft) => ({ ...draft, lines: [...draft.lines, { account_code: '', debit: '', credit: '', description: '' }] }))} className="rounded border border-slate-600 px-3 py-1 text-xs">Add journal line</button>
            <button type="submit" disabled={blocked} className="rounded bg-sky-600 px-4 py-2 text-sm font-semibold disabled:opacity-40">Post balanced journal</button>
          </form> : <p className="mt-3 text-xs text-slate-400">Accounting management permission is required to post journals.</p>}
        </Panel>
        <Panel title="Period close" description="Closing a period requires a distinct accounting approver.">
          {canManageAccounting ? <form onSubmit={closePeriod} className="mt-3 space-y-2">
            <Field label="Accounting period"><TextInput required placeholder="YYYY-MM" maxLength={7} value={periodDraft.period} onChange={(event) => setPeriodDraft((draft) => ({ ...draft, period: event.target.value }))} /></Field>
            <Field label="Approving manager PIN"><TextInput required type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={periodDraft.pin} onChange={(event) => setPeriodDraft((draft) => ({ ...draft, pin: event.target.value.replace(/\D/g, '') }))} /></Field>
            <button type="submit" disabled={blocked || approvalBusy || !MONTH_VALUE.test(periodDraft.period) || !PIN_VALUE.test(periodDraft.pin)} className="rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">Approve and close period</button>
          </form> : <p className="mt-3 text-xs text-slate-400">Accounting management permission is required to close a period.</p>}
        </Panel>
      </div>}
      {section === 'accounting' && canManageAccounting && <BarLocalFinanceWorkspace
        query={(name,filters)=>window.api.pos.barLocal.query(name,filters)}
        onRun={(command,payload,pin)=>pin?approveAndRun(command,payload,pin):run(command,payload)}
        blocked={blocked || approvalBusy} refreshKey={panelVersion} />}
      {section === 'customers' && canManageAccounting && <BarLocalLoyaltyAdjustment customers={customers}
        blocked={blocked||approvalBusy} onApproved={approveAndRun} onCommitted={()=>refreshLoyaltyBalance(loyaltyDraft.customer_id)}/>}
      {section === 'workforce' && can('pos.cashup') && <BarLocalTipActions
        query={(name,filters)=>window.api.pos.barLocal.query(name,filters)} staffRows={staffRows} shift={shift}
        blocked={blocked||approvalBusy} canReadSales={can('pos.reports')}
        onRun={(command,payload,pin)=>pin?approveAndRun(command,payload,pin):run(command,payload)} refreshKey={panelVersion}/>}
    </div>
  );
}
