import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  BookOpen,
  Boxes,
  Users,
  UserRound,
  ClipboardCheck,
  BarChart3,
  ReceiptText,
  Monitor,
  Building2,
  Settings,
  ShieldCheck,
  Database,
  CreditCard,
  FileText,
  Wine,
  ChefHat,
  ArrowUpRight,
  LayoutDashboard,
  ClipboardList,
  CheckCircle2,
  Landmark,
  BookCopy,
  Wallet,
  CircleDollarSign,
  FileSpreadsheet,
  PiggyBank,
  Scale,
  Coins,
} from 'lucide-react';
import { useAccess, useSettings } from '../../app-context';
import { canAccessCapability } from '../../../../shared/accessControl';
import { isCommercialFeatureIncluded } from '../../../../shared/commercialAccess';
import { BAR_POS_ADDON_CATALOG } from '../../../../shared/commercialEntitlements';
import { formatCommercialMoney } from '../../../../shared/commercialPackages';
import { BAR_BASE_SETUP_STAGE_KEYS, getHposMoreItems } from '../../../../shared/barModeProfile';
import { isBarOnlyMode } from '../../../../shared/propertyTypes';

const GROUPS = [
  {
    id: 'run',
    label: 'Run service',
    routes: [
      '/restaurant/floor-workspace',
      '/restaurant/kitchen-workspace',
      '/restaurant/menu-production',
      '/restaurant/inventory',
      '/restaurant/menu-production',
      '/restaurant/team-workspace',
      '/hpos/menu',
      '/hpos/stock',
      '/hpos/team',
      '/hpos/customers',
      '/hpos/growth-tools',
    ],
  },
  {
    id: 'oversight',
    label: 'Money & oversight',
    routes: [
      '/restaurant/finance-close',
      '/hpos/cash',
      '/hpos/reports',
      '/hpos/expenses',
      '/hpos/business-control',
      '/restaurant/outlet-control',
      '/hpos/system-health?tab=audit',
    ],
  },
  {
    id: 'accounting',
    label: 'Restaurant Accounting',
    routes: [
      '/restaurant/chart-of-accounts',
      '/restaurant/general-ledger',
      '/restaurant/accounts-payable',
      '/restaurant/bank-reconciliation',
      '/restaurant/tax-returns',
      '/restaurant/budgets',
      '/restaurant/balance-sheet',
      '/restaurant/payroll',
    ],
  },
  {
    id: 'controls',
    label: 'Standards & guest care',
    routes: [
      '/restaurant/control-workspace',
      '/hpos/control',
    ],
  },
  {
    id: 'admin',
    label: 'Administration & systems',
    routes: [
      '/staff',
      '/pos/customer-display',
      '/pos/bar-display',
      '/settings',
      '/hpos/system-health',
      '/settings?tab=license',
      '/data-management',
    ],
  },
];

const META = {
  '/restaurant/floor-workspace': [
    BookOpen,
    'Tables, reservations and waiting-list flow in one workspace.',
  ],
  '/restaurant/kitchen-workspace': [ChefHat, 'Live tickets, station setup and kitchen timing in one workspace.'],
  '/restaurant/menu-production': [
    BookOpen,
    'Menu items, modifiers, combos, recipes, prep batches and variance.',
  ],
  '/restaurant/inventory': [
    Boxes,
    'Stock control, purchasing, suggestions and expiry in one workspace.',
  ],
  '/restaurant/team-workspace': [Users, 'Shifts, staff performance and tip payouts in one workspace.'],
  '/restaurant/finance-close': [ReceiptText, 'Cash-ups, sales, settlements, customer funds, expenses, tips and day close.'],
  '/restaurant/control-workspace': [ClipboardCheck, 'Checklists, alerts, guest feedback and service policies.'],
  '/staff': [Users, 'Add, reactivate and set access for the staff accounts available to shifts.'],
  '/restaurant/chart-of-accounts': [FileSpreadsheet, 'Configure lodge-scoped accounts and post dated opening journals.'],
  '/restaurant/general-ledger': [BookOpen, 'Review immutable journals, reversals and event-level POS posting.'],
  '/restaurant/accounts-payable': [Wallet, 'Capture, approve, accrue and pay supplier bills safely.'],
  '/restaurant/bank-reconciliation': [Scale, 'Import statement evidence, approve matches and lock reconciled periods.'],
  '/restaurant/tax-returns': [FileSpreadsheet, 'Prepare, review and record external tax filing evidence.'],
  '/restaurant/budgets': [PiggyBank, 'Maintain an atomic monthly revenue and expense matrix.'],
  '/restaurant/balance-sheet': [Scale, 'Review ledger-derived financial statements and cash flow.'],
  '/restaurant/payroll': [Coins, 'Run private, versioned, maker-checker payroll without claiming payment.'],
  '/hpos/customers': [
    UserRound,
    'Customer accounts, loyalty and service history.',
  ],
  '/hpos/growth-tools': [CreditCard, 'Issue controlled bar vouchers and keep the stored-value liability in the existing POS flow.'],
  '/hpos/business-control': [
    BarChart3,
    'Cross-business owner signals, bar control, labour, promotions and guest flow.',
  ],
  '/restaurant/outlet-control': [
    Building2,
    'Compare authorised outlets, transfer stock, and review outlet contribution.',
  ],
  '/pos/customer-display': [
    Monitor,
    'Open the customer-facing order and total display.',
  ],
  '/pos/bar-display': [Wine, 'Open the live bar preparation board.'],
  '/hpos/control': [ClipboardCheck, 'Run opening, closing, safety and service controls.'],
  '/settings': [Settings, 'Restaurant identity, preferences and integrations.'],
  '/hpos/system-health': [
    ShieldCheck,
    'Sync status, failed work and restaurant/bar diagnostics.',
  ],
  '/settings?tab=license': [
    CreditCard,
    'Package, subscription and feature access.',
  ],
  '/data-management': [Database, 'Import, export and protected data tools.'],
};

const BAR_META = {
  '/hpos/menu': [
    BookOpen,
    'Maintain drinks, bar products, pack sizes, prices and availability.',
  ],
  '/hpos/stock': [
    Boxes,
    'Create bar stock, receive simple deliveries, count bottles and act on shortages.',
  ],
  '/hpos/cash': [ReceiptText, 'Open, count and reconcile the cash drawer and staff handovers.'],
  '/hpos/reports': [BarChart3, 'Review sales, tenders, tabs, discounts, voids and receipt history.'],
  '/staff': [Users, 'Add cashiers, bartenders and managers, assign PINs, outlets and the least access needed.'],
  '/hpos/team': [Users, 'Clock cashiers and bartenders in and keep live shift accountability visible.'],
  '/hpos/system-health?tab=audit': [ShieldCheck, 'Review recent bar sales, cash, stock and staff-access events.'],
  '/restaurant/inventory': [Boxes, 'Run suppliers, purchasing, reorder suggestions, lots, expiry and advanced stock control.'],
  '/restaurant/menu-production': [BookOpen, 'Cost cocktails and prepared portions, record prep and investigate ingredient variance.'],
  '/restaurant/team-workspace': [Users, 'Plan the bar workforce and review attendance and performance evidence.'],
  '/restaurant/chart-of-accounts': [FileSpreadsheet, 'Open the controlled accounting workspace for this bar.'],
  '/restaurant/general-ledger': [BookOpen, 'Review posted journals and the bar ledger without changing history.'],
  '/restaurant/accounts-payable': [Wallet, 'Capture, approve and settle bar supplier bills through controlled steps.'],
  '/restaurant/bank-reconciliation': [Scale, 'Match bar bank activity to recorded money and close reconciled periods.'],
  '/restaurant/tax-returns': [FileSpreadsheet, 'Prepare and retain tax working-paper evidence for the bar.'],
  '/restaurant/budgets': [PiggyBank, 'Plan monthly bar revenue and operating costs.'],
  '/restaurant/balance-sheet': [Scale, 'Review ledger-derived bar financial statements and cash flow.'],
  '/restaurant/payroll': [Coins, 'Prepare private payroll through maker-checker controls.'],
  '/hpos/expenses': [Wallet, 'Capture bar operating expenses and retain their supporting evidence.'],
  '/restaurant/outlet-control': [Building2, 'Compare bar outlets and transfer accountable stock custody.'],
  '/hpos/business-control': [BarChart3, 'Review growth, promotions, drink margin, labour and owner exception signals.'],
  '/hpos/customers': [
    UserRound,
    'Manage customer tabs, loyalty and visit history.',
  ],
  '/hpos/control': [
    ClipboardCheck,
    'Run opening, closing, safety and cash-control checklists.',
  ],
  '/multi-outlet-pos': [
    Building2,
    'Compare sales and controls across authorised bar outlets.',
  ],
  '/settings': [
    Settings,
    'Bar identity, sales preferences, devices and integrations.',
  ],
  '/hpos/system-health': [
    ShieldCheck,
    'Sync status, failed work and bar POS diagnostics.',
  ],
};

const BAR_ADDON_VALUE = Object.freeze({
  bar_stock_purchasing_pro: Object.freeze({
    eyebrow: 'Buying & stock cost',
    summary: 'Keep suppliers, purchase orders, controlled deliveries, stock valuation and margin controls together.',
  }),
  bar_accounting_workforce: Object.freeze({
    eyebrow: 'Financial position',
    summary: 'Record supplier finance and operating costs, then use controlled accounting, bank, tax, budget and profit-and-loss workspaces.',
  }),
  bar_growth_multi_outlet: Object.freeze({
    eyebrow: 'Growth',
    summary: 'Add customer accounts, loyalty, promotions, vouchers, owner insight and accountable multi-outlet controls.',
  }),
});

function addonKey(value) {
  if (typeof value === 'string') return value;
  return value?.addon_key || value?.addonKey || value?.key || '';
}

function isAllowed(access, capability) {
  if (!capability) return true;
  return canAccessCapability(access, capability);
}

export default function HposManageHub() {
  const navigate = useNavigate();
  const access = useAccess();
  const { settings } = useSettings();
  const barOnly = isBarOnlyMode(settings);
  const canManagePos = canAccessCapability(access, 'pos.manage');
  const [dailyOpening, setDailyOpening] = useState(null);
  const [dailyLoading, setDailyLoading] = useState(canManagePos);
  const [setupComplete, setSetupComplete] = useState(false);
  const [setupSummary, setSetupSummary] = useState({ completed: 0, total: 0 });
  const [setupReadStatus, setSetupReadStatus] = useState(null);
  const activeAddonKeys = useMemo(
    () => new Set((Array.isArray(access?.entitlement?.enterprise_addons) ? access.entitlement.enterprise_addons : []).map(addonKey).filter(Boolean)),
    [access?.entitlement?.enterprise_addons],
  );
  const barAddonSummary = useMemo(
    () => BAR_POS_ADDON_CATALOG.map((addon) => ({
      ...addon,
      ...BAR_ADDON_VALUE[addon.addonKey],
      enabled: activeAddonKeys.has(addon.addonKey),
    })),
    [activeAddonKeys],
  );
  const items = useMemo(
    () =>
      getHposMoreItems(barOnly).filter((item) => {
        if (!isAllowed(access, item.capability)) return false;
        if (!barOnly || !item.feature) return true;
        return isCommercialFeatureIncluded(
          access?.entitlement?.product_id || 'hospitality-pos',
          access?.entitlement?.commercial_package_key,
          item.feature,
          access?.entitlement?.enterprise_addons || [],
        );
      }),
    [access, barOnly],
  );

  const groups = GROUPS.map((group) => ({
    ...group,
    items: group.routes
      .map((route) => items.find((item) => item.route === route))
      .filter(Boolean),
  })).filter((group) => group.items.length);

  const loadDailyOpening = useCallback(async () => {
    if (!canManagePos) return;
    setDailyLoading(true);
    try {
      const [rows, progress, hardware] = await Promise.all([
        barOnly ? Promise.resolve([]) : window.api?.pos?.getChecklists?.() || [],
        (async () => {
          const readWithStatus = window.api?.pos?.getSetupProgressWithReadStatus;
          if (typeof readWithStatus === 'function') return readWithStatus();
          const legacyRows = await window.api?.pos?.getSetupProgress?.();
          return {
            source: 'legacy',
            complete: false,
            online: null,
            rows: Array.isArray(legacyRows) ? legacyRows : [],
            error: 'This desktop build cannot verify setup evidence freshness. Update the POS and reconnect before relying on readiness.'
          };
        })(),
        barOnly ? window.api?.pos?.getHardwareSettings?.() || {} : Promise.resolve(null),
      ]);
      const today = new Date().toLocaleDateString('en-CA');
      const opening = (Array.isArray(rows) ? rows : []).find((row) =>
        String(row.checklist_type || row.type || '') === 'daily_opening' &&
        new Date(row.checklist_date || row.created_at || 0).toLocaleDateString('en-CA') === today,
      ) || null;
      setDailyOpening(opening);
      const status = progress && typeof progress === 'object' && !Array.isArray(progress)
        ? { source: 'unavailable', complete: false, online: null, rows: [], error: 'Setup evidence could not be verified.', ...progress }
        : { source: 'legacy', complete: false, online: null, rows: Array.isArray(progress) ? progress : [], error: 'Setup evidence freshness could not be verified.' };
      setSetupReadStatus(status);
      const stages = Array.isArray(status.rows) ? status.rows : [];
      const requiredKeys = barOnly ? BAR_BASE_SETUP_STAGE_KEYS : stages.map((stage) => stage?.stage_key).filter(Boolean);
      const hardwareVerified = hardware?.hardware_last_test_success === true && Boolean(hardware?.hardware_last_test_at);
      const completedCount = requiredKeys.filter((key) => {
        if (barOnly && key === 'receipt_hardware') return hardwareVerified;
        return stages.find((stage) => stage?.stage_key === key)?.detected === true;
      }).length;
      setSetupSummary({ completed: completedCount, total: requiredKeys.length });
      setSetupComplete(status.complete === true && requiredKeys.length > 0 && completedCount === requiredKeys.length);
    } catch (loadError) {
      setDailyOpening(null);
      setSetupReadStatus({ source: 'unavailable', complete: false, online: null, rows: [], error: loadError?.message || 'Setup evidence could not be verified.' });
      setSetupSummary({ completed: 0, total: barOnly ? BAR_BASE_SETUP_STAGE_KEYS.length : 0 });
      setSetupComplete(false);
    }
    finally { setDailyLoading(false); }
  }, [barOnly, canManagePos]);

  useEffect(() => { loadDailyOpening(); }, [loadDailyOpening]);

  return (
    <div className="hpos-manage-hub">
      <header className="hpos-manage-heading">
        <div>
          <p>Manager workspace</p>
          <h1>Run the {barOnly ? 'bar' : 'restaurant'} beyond the till</h1>
          <span>Open the right control desk quickly. Tools remain filtered by your role and package.</span>
        </div>
        <div className="hpos-manage-heading-stat"><LayoutDashboard size={20} /><span><strong>{items.length}</strong> available workspaces</span></div>
      </header>

      {canManagePos && !dailyLoading && (setupComplete ? (
        <section className="hpos-manage-readiness is-ready" aria-label="Setup completion">
          <span><CheckCircle2 size={20} /></span>
          <div><strong>{barOnly ? 'Bar setup readiness complete' : 'Restaurant setup readiness complete'}</strong><small>{setupSummary.completed} of {setupSummary.total || '—'} evidence stages detected. The readiness board can be reopened from the setup route if a manager needs to review the proof.</small></div>
        </section>
      ) : (
        <button type="button" className="hpos-manage-setup-link" onClick={() => navigate('/hpos/setup-readiness')}><ClipboardCheck size={18} /><span><strong>{setupReadStatus?.complete === true ? (barOnly ? 'Bar setup readiness' : 'Restaurant setup readiness') : 'Setup readiness unavailable'}</strong><small>{setupReadStatus?.complete === true ? `${setupSummary.completed} of ${setupSummary.total || '—'} evidence stages complete. ${barOnly ? 'Finish the focused staff, product, stock, payment and cash-control checks before the first live sale.' : 'Track the evidence-based launch controls that remain before a financially safe go-live.'}` : `${setupReadStatus?.error || 'Authoritative setup evidence is not available.'} Reconnect and refresh before relying on readiness.`}</small></span><ArrowUpRight size={17} /></button>
      ))}

      {canManagePos && !barOnly && !dailyLoading && (
        <section className={`hpos-manage-readiness ${dailyOpening?.status === 'completed' ? 'is-ready' : ''}`}>
          <span>{dailyOpening?.status === 'completed' ? <CheckCircle2 size={20} /> : <ClipboardList size={20} />}</span>
          <div><strong>{dailyOpening?.status === 'completed' ? 'Today’s opening checklist is complete' : dailyOpening ? 'Today’s opening checklist needs attention' : 'Today’s opening checklist has not been started'}</strong><small>{dailyOpening?.status === 'completed' ? 'Daily service readiness is recorded for this venue.' : 'Open the control board before service starts to create or finish the opening routine.'}</small></div>
          <button type="button" onClick={() => navigate('/hpos/control')}>{dailyOpening?.status === 'completed' ? 'Review' : 'Open checks'}</button>
        </section>
      )}

      {barOnly && canManagePos && (
        <section className="hpos-bar-package-guide" aria-labelledby="bar-package-guide-title">
          <div className="hpos-bar-package-guide__heading">
            <div>
              <p>Plan your next control</p>
              <h2 id="bar-package-guide-title">Turn sales and stock into a fuller financial picture</h2>
              <span>Bar POS records sales, simple deliveries and physical counts. It does not create supplier bills, purchase history, cost-of-sales reporting or a profit-and-loss statement on its own.</span>
            </div>
            <button type="button" className="hpos-bar-package-guide__review" onClick={() => navigate('/settings?tab=license')}>
              Review package <ArrowUpRight size={16} />
            </button>
          </div>

          <div className="hpos-bar-package-guide__path">
            <CheckCircle2 size={17} />
            <span><strong>To see purchases and P&amp;L:</strong> choose <strong>Stock &amp; Purchasing Pro</strong> and <strong>Accounting &amp; Workforce</strong> together. Package changes remain governed; reviewing this page does not change access.</span>
          </div>

          <div className="hpos-bar-package-guide__cards">
            {barAddonSummary.map((addon) => (
              <article key={addon.addonKey} className={addon.enabled ? 'is-enabled' : ''}>
                <div className="hpos-bar-package-guide__card-topline">
                  <span>{addon.eyebrow}</span>
                  <em>{addon.enabled ? 'Enabled' : 'Optional add-on'}</em>
                </div>
                <h3>{addon.displayName}</h3>
                <p>{addon.summary}</p>
                <strong>{formatCommercialMoney(addon.annualPriceBwp)}/year</strong>
              </article>
            ))}
          </div>
        </section>
      )}

      {groups.map((group) => (
        <section key={group.id} className="hpos-manage-group">
          <h2>{barOnly ? ({ run: 'Bar setup', oversight: 'Money & sales', accounting: 'Accounting & payroll', controls: 'Bar standards', admin: 'Devices & administration' }[group.id] || group.label) : group.label}</h2>
          <div className="hpos-manage-grid">
            {group.items.map((item) => {
              const [Icon = Settings, description = 'Open this workspace.'] =
                (barOnly ? BAR_META[item.route] : null) ||
                META[item.route] ||
                [];
              return (
                <button
                  key={item.route}
                  type="button"
                  onClick={() => navigate(item.route)}
                >
                  <span className="hpos-manage-icon">
                    <Icon size={20} />
                  </span>
                  <span>
                    <strong>{item.label}</strong>
                    <small>{description}</small>
                  </span>
                  <ArrowUpRight className="hpos-manage-arrow" size={17} />
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {items.length === 0 && (
        <div className="hpos-manage-empty">
          Your role does not include manager workspaces.
        </div>
      )}
    </div>
  );
}
