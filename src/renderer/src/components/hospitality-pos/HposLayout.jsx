import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router';
import {
  Grid3X3,
  UtensilsCrossed,
  ChefHat,
  BookOpen,
  Package,
  MoreHorizontal,
  WalletCards,
  ClipboardList,
  Clock3,
  LogIn,
  ChevronLeft,
  ChevronRight,
  BarChart3,
} from 'lucide-react';
import { useAccess, useAuth, useSettings } from '../../app-context';
import { canAccessCapability } from '../../../../shared/accessControl';
import { getCommercialFeatureSet } from '../../../../shared/commercialAccess';
import { isBarOnlyMode } from '../../../../shared/propertyTypes';
import {
  getHposDockItems,
  isBarOnlyBlockedPath,
} from '../../../../shared/barModeProfile';
import HposNav from './HposNav';
import HposCommandPalette from './HposCommandPalette';

const POS_ROUTE_PREFIXES = ['/pos', '/hpos/pos', '/hpos/cash'];
const TILL_ROUTE_PREFIXES = ['/pos', '/hpos/pos'];
// Search is an action index, not just a copy of the navigation rail.  Operators
// often know the job they need to do (for example, take a deposit) rather than
// the management workspace which contains it.
const HPOS_SEARCH_ACTIONS = [
  { route: '/hpos/pos', label: 'Start a sale', group: 'Daily service', keywords: 'till sell order payment cash card mobile money receipt', capability: 'pos.view' },
  { route: '/hpos/checks', label: 'Open tabs', group: 'Daily service', keywords: 'open check table tab resume payment', capability: 'pos.view' },
  { route: '/hpos/my-shift', label: 'My shift', group: 'Team', keywords: 'waiter server start shift clock in guest feedback', capability: 'pos.view' },
  { route: '/hpos/sale-correction', label: 'Request sale correction', group: 'Daily service', keywords: 'void wrong item cancellation prepared food stock damage manager pin', capability: 'pos.view' },
  { route: '/hpos/service', label: 'Reservations & waitlist', group: 'Daily service', keywords: 'walk in guest arrival waiting seat table no show', capability: 'pos.service', restaurantOnly: true },
  { route: '/hpos/my-cashup', label: 'My cash-up', group: 'Money & finance', keywords: 'waiter cash handover tips submit', capability: 'pos.cashup' },
  { route: '/hpos/attendance', label: 'Clock in or out', group: 'Team', keywords: 'pin kiosk attendance staff', capability: 'pos.manage' },
  { route: '/hpos/shared-cashup', label: 'Staff cash-up', group: 'Money & finance', keywords: 'waiter cash handover manager pin review', capability: 'pos.manage' },
  { route: '/hpos/cash', label: 'Cash drawer and close', group: 'Money & finance', keywords: 'float drawer variance end of day close', capability: 'pos.cashup' },
  { route: '/restaurant/finance-close', label: 'Finance & close', group: 'Money & finance', keywords: 'cashup sales payments settlement deposits expenses tips payouts end of day', capability: 'reports.view' },
  { route: '/restaurant/finance-close?tab=daily-close', label: 'Daily close', group: 'Money & finance', keywords: 'end of day close blockers approval', capability: 'reports.view' },
  { route: '/restaurant/finance-close?tab=owner-review', label: 'Owner review', group: 'Money & finance', keywords: 'owner daily summary financial report digest export', capability: 'reports.view' },
  { route: '/restaurant/finance-close?tab=settlements', label: 'Settlement reconciliation', group: 'Money & finance', keywords: 'card terminal mobile money bank voucher batch variance', capability: 'reports.view' },
  { route: '/restaurant/finance-close?tab=customer-funds', label: 'Reservation deposits', group: 'Money & finance', keywords: 'deposit hold reservation payment financial customer advance', capability: 'pos.manage', restaurantOnly: true },
  { route: '/restaurant/finance-close?tab=customer-funds', label: 'Gift cards', group: 'Money & finance', keywords: 'gift card voucher stored value customer liability', capability: 'pos.manage', restaurantOnly: true },
  { route: '/restaurant/control-workspace?tab=checklists', label: 'Operational checklists', group: 'Controls', keywords: 'opening closing cleaning safety routine', capability: 'pos.manage' },
  { route: '/restaurant/control-workspace?tab=alerts', label: 'Operational alerts', group: 'Controls', keywords: 'exception low medium high severity resolve', capability: 'reports.view' },
  { route: '/restaurant/control-workspace?tab=feedback', label: 'Customer feedback', group: 'Controls', keywords: 'guest complaint rating follow up review', capability: 'pos.manage' },
  { route: '/restaurant/control-workspace?tab=policies', label: 'Guest policies', group: 'Controls', keywords: 'cancellation no show reservation policy', capability: 'pos.manage' },
  { route: '/restaurant/floor-workspace?tab=reservations', label: 'Reservation management', group: 'Service management', keywords: 'book table guest party future cancellation policy', capability: 'pos.manage', restaurantOnly: true },
  { route: '/hpos/floor', label: 'Floor plan', group: 'Service management', keywords: 'tables seating occupied available', capability: 'pos.view', restaurantOnly: true },
  { route: '/hpos/kitchen', label: 'Kitchen tickets', group: 'Service management', keywords: 'kitchen order prep ready station', capability: 'pos.view', restaurantOnly: true },
  { route: '/restaurant/kitchen-workspace?tab=stations', label: 'Kitchen stations', group: 'Service management', keywords: 'kitchen prep station assignment', capability: 'pos.manage', restaurantOnly: true },
  { route: '/hpos/menu', label: 'Menu and availability', group: 'Menu & stock', keywords: 'product price 86 sold out available modifier', capability: 'pos.menu_manage' },
  { route: '/restaurant/menu-production?tab=recipes', label: 'Recipes and costing', group: 'Menu & stock', keywords: 'cocktail ingredients drink cost prepared portions', capability: 'pos.menu_manage', restaurantOnly: true, barFeature: 'recipes' },
  { route: '/restaurant/menu-production?tab=combos', label: 'Combos and modifiers', group: 'Menu & stock', keywords: 'combo modifier option bundle', capability: 'pos.menu_manage', restaurantOnly: true },
  { route: '/restaurant/menu-production?tab=prep', label: 'Prep batches', group: 'Menu & stock', keywords: 'cocktail mix garnish prepared portion batch production', capability: 'pos.menu_manage', restaurantOnly: true, barFeature: 'prep' },
  { route: '/hpos/stock', label: 'Service stock', group: 'Menu & stock', keywords: 'low stock availability count', capability: 'inventory.view' },
  { route: '/hpos/reports', label: 'Sales report', group: 'Money & finance', keywords: 'sales payments tenders receipts voids top products', capability: 'reports.view', barOnly: true },
  { route: '/restaurant/inventory', label: 'Inventory control', group: 'Menu & stock', keywords: 'stocktake adjustment movement catalogue reorder', capability: 'inventory.view' },
  { route: '/restaurant/inventory?tab=purchasing', label: 'Purchasing', group: 'Menu & stock', keywords: 'supplier purchase order receive goods', capability: 'inventory.view' },
  { route: '/restaurant/inventory?tab=suggestions', label: 'Purchase suggestions', group: 'Menu & stock', keywords: 'reorder low stock supplier draft po', capability: 'inventory.view' },
  { route: '/restaurant/inventory?tab=lots', label: 'Lots and expiry', group: 'Menu & stock', keywords: 'batch expiry write off expired', capability: 'inventory.view' },
  { route: '/hpos/team', label: 'Team management', group: 'Team', keywords: 'staff role pin shifts suspension audit', capability: 'staff.view' },
  { route: '/restaurant/team-workspace?tab=performance', label: 'Staff performance', group: 'Team', keywords: 'waiter server sales coaching performance', capability: 'staff.view' },
  { route: '/restaurant/team-workspace?tab=roster', label: 'Weekly bar roster', group: 'Team', keywords: 'cashier bartender supervisor schedule rota', capability: 'staff.view' },
  { route: '/restaurant/finance-close?tab=tips', label: 'Tips and payouts', group: 'Money & finance', keywords: 'tip pool cash card stripe payout approval', capability: 'staff.view' },
  { route: '/staff', label: 'Staff accounts and PINs', group: 'Team', keywords: 'create staff role pin suspend reactivate', capability: 'staff.manage' },
  { route: '/hpos/customers', label: 'Customers and loyalty', group: 'Customer', keywords: 'guest account loyalty history', capability: 'pos.view' },
  { route: '/hpos/growth-tools', label: 'Bar vouchers', group: 'Customer', keywords: 'voucher gift card stored value promotion', capability: 'pos.manage' },
  { route: '/hpos/expenses', label: 'Bar expenses', group: 'Money & finance', keywords: 'cost spend expense receipt supplier', capability: 'expenses.view' },
  { route: '/restaurant/chart-of-accounts', label: 'Chart of accounts', group: 'Accounting', keywords: 'accounts finance setup', capability: 'accounting.read' },
  { route: '/restaurant/general-ledger', label: 'General ledger', group: 'Accounting', keywords: 'journal ledger posting', capability: 'accounting.read' },
  { route: '/restaurant/accounts-payable', label: 'Supplier bills', group: 'Accounting', keywords: 'payables supplier invoice payment', capability: 'accounting.read' },
  { route: '/restaurant/bank-reconciliation', label: 'Bank reconciliation', group: 'Accounting', keywords: 'bank match statement reconciliation', capability: 'accounting.read' },
  { route: '/restaurant/tax-returns', label: 'Tax working papers', group: 'Accounting', keywords: 'tax vat return evidence', capability: 'accounting.read' },
  { route: '/restaurant/budgets', label: 'Budgets', group: 'Accounting', keywords: 'budget plan revenue cost', capability: 'accounting.read' },
  { route: '/restaurant/balance-sheet', label: 'Financial statements', group: 'Accounting', keywords: 'balance sheet cash flow trial balance', capability: 'accounting.read' },
  { route: '/restaurant/payroll', label: 'Payroll', group: 'Accounting', keywords: 'wages payslip employee pay', capability: 'accounting.payroll_view' },
  { route: '/hpos/business-control', label: 'Business overview', group: 'Management', keywords: 'labour promotions margin pour waste guest flow', capability: 'pos.manage' },
  { route: '/restaurant/outlet-control', label: 'Outlet control', group: 'Management', keywords: 'multiple outlets restaurant bar transfer stock outlet contribution', capability: 'pos.manage' },
  { route: '/restaurant/finance-close?tab=sales', label: 'Sales and payment reports', group: 'Money & finance', keywords: 'sales payments margin export pdf excel', capability: 'reports.view' },
  { route: '/restaurant/finance-close?tab=expenses', label: 'Expenses', group: 'Money & finance', keywords: 'cost spend expense receipt', capability: 'expenses.view' },
  { route: '/data-management', label: 'Data, import and backup', group: 'Management', keywords: 'export backup restore import spreadsheet', capability: 'data.import' },
  { route: '/settings', label: 'Settings and devices', group: 'Management', keywords: 'printer cash drawer terminal integration business settings', capability: 'settings.view' },
  { route: '/hpos/system-health', label: 'System health', group: 'Management', keywords: 'sync diagnostics failed queue support', capability: 'settings.view' },
];
const ICON_BY_KEY = {
  sell: Grid3X3,
  floor: UtensilsCrossed,
  kitchen: ChefHat,
  menu: BookOpen,
  stock: Package,
  cash: WalletCards,
  checks: ClipboardList,
  shift: Clock3,
  mycashup: WalletCards,
  attendance: LogIn,
  reports: BarChart3,
};

export default function HposLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const access = useAccess();
  const { settings } = useSettings();
  const barOnly = isBarOnlyMode(settings);
  const barFeatures = useMemo(() => [...getCommercialFeatureSet(
    access?.entitlement?.product_id || 'hospitality-pos',
    access?.entitlement?.commercial_package_key,
    access?.entitlement?.enterprise_addons || [],
  )], [access?.entitlement]);
  const { user, logout } = useAuth();
  const [syncStatus, setSyncStatus] = useState({
    pending: 0,
    failed: 0,
    syncInProgress: false,
    isOnline: true,
    lastSuccessfulSyncAt: null,
  });
  const [liveCounts, setLiveCounts] = useState({ checks: 0, kitchen: 0 });
  const [commandOpen, setCommandOpen] = useState(false);
  const [historyAvailability, setHistoryAvailability] = useState({
    canGoBack: false,
    canGoForward: false,
  });
  const [density, setDensity] = useState(
    () => localStorage.getItem('hpos-density') || 'touch',
  );

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.product = 'hospitality-pos';
    root.dataset.hposDensity = density;
    localStorage.setItem('hpos-density', density);
    return () => {
      delete root.dataset.product;
      delete root.dataset.hposDensity;
    };
  }, [density]);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      if (document.visibilityState === 'hidden') return;
      const [tabsResult, ticketsResult] = await Promise.allSettled([
        window.api?.pos?.getTabs?.({ status: 'active' }) || [],
        barOnly
          ? Promise.resolve([])
          : window.api?.pos?.getTickets?.({ status: 'active' }) || [],
      ]);
      if (!active) return;
      const tabs =
        tabsResult.status === 'fulfilled' && Array.isArray(tabsResult.value)
          ? tabsResult.value
          : [];
      const tickets =
        ticketsResult.status === 'fulfilled' &&
        Array.isArray(ticketsResult.value)
          ? ticketsResult.value
          : [];
      setLiveCounts({
        checks: tabs.filter(
          (row) =>
            !['closed', 'paid', 'cancelled', 'voided'].includes(
              String(row.status || '').toLowerCase(),
            ),
        ).length,
        kitchen: tickets.length,
      });
    };
    poll();
    const interval = setInterval(poll, 15000);
    const handleVisible = () => {
      if (document.visibilityState === 'visible') poll();
    };
    document.addEventListener('visibilitychange', handleVisible);
    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisible);
    };
  }, [barOnly]);

  // Electron can retain stale hit-test rectangles after a route is lazy-loaded.
  // Force a settled layout on navigation instead of requiring a manual resize.
  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        document.body.getBoundingClientRect();
        window.dispatchEvent(new Event('resize'));
      });
    });
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); };
  }, [location.pathname]);

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const status = await window.api?.sync?.getStatus?.();
        if (active && status)
          setSyncStatus((previous) => ({ ...previous, ...status }));
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 15000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const role = String(access?.role || user?.role || '').toLowerCase();
  const dockItems = useMemo(
    () => {
      const serviceShift = { route: '/hpos/my-shift', label: 'My Shift', iconKey: 'shift' };
      const serviceCashup = { route: '/hpos/my-cashup', label: 'My Cash-up', iconKey: 'mycashup' };
      const attendanceKiosk = { route: '/hpos/attendance', label: 'Clock in/out', iconKey: 'attendance' };
      const sharedCashup = { route: '/hpos/shared-cashup', label: 'Staff cash-up', iconKey: 'mycashup' };
      const visible = getHposDockItems(barOnly).filter((item) => {
        if (item.capability && !canAccessCapability(access, item.capability))
          return false;
        if (role === 'cashier') return ['sell', 'checks', 'floor'].includes(item.iconKey);
        if (role === 'supervisor') return !['stock'].includes(item.iconKey);
        return true;
      });
      const till = visible.filter((item) => item.iconKey === 'sell');
      const service = visible.filter((item) => ['checks', 'floor'].includes(item.iconKey));
      const operations = visible.filter((item) => ['kitchen', 'menu', 'stock', 'cash', 'reports'].includes(item.iconKey));
      if (role === 'cashier') return [...till, ...service, serviceShift, serviceCashup];
      if (role === 'supervisor') return [...till, ...service, attendanceKiosk, sharedCashup, serviceShift, serviceCashup, ...operations];
      if (['manager', 'admin', 'super_admin'].includes(role)) return [...till, ...service, attendanceKiosk, sharedCashup, ...operations];
      return visible;
    },
    [access, barOnly, role],
  );
  const currentPath = location.pathname;
  const isPosRoute = POS_ROUTE_PREFIXES.some((prefix) =>
    currentPath.startsWith(prefix),
  );
  const isTillRoute = TILL_ROUTE_PREFIXES.some((prefix) =>
    currentPath.startsWith(prefix),
  );
  const isRoot = currentPath === '/' || currentPath === '';

  useEffect(() => {
    const historyIndex = Number(window.history.state?.idx);
    if (!Number.isInteger(historyIndex) || historyIndex < 0) {
      setHistoryAvailability({
        canGoBack: window.history.length > 1,
        canGoForward: false,
      });
      return;
    }

    const storageKey = 'hpos-history-max-index';
    const savedMaxIndex = Number(sessionStorage.getItem(storageKey));
    const knownMaxIndex = Number.isInteger(savedMaxIndex)
      ? savedMaxIndex
      : historyIndex;
    // A new route after Back replaces the browser's forward branch.
    const maxIndex =
      navigationType === 'PUSH'
        ? historyIndex
        : Math.max(knownMaxIndex, historyIndex);
    sessionStorage.setItem(storageKey, String(maxIndex));
    setHistoryAvailability({
      canGoBack: historyIndex > 0,
      canGoForward: historyIndex < maxIndex,
    });
  }, [location.key, navigationType]);

  useEffect(() => {
    if (barOnly && isBarOnlyBlockedPath(currentPath, barFeatures))
      navigate('/hpos/pos', { replace: true });
  }, [barFeatures, barOnly, currentPath, navigate]);

  const startOrder = useCallback(() => navigate('/hpos/pos'), [navigate]);
  const searchActions = useMemo(
    () =>
      HPOS_SEARCH_ACTIONS.filter(
        (action) =>
          (!action.restaurantOnly || !barOnly || (action.barFeature && barFeatures.includes(action.barFeature))) &&
          (!action.barOnly || barOnly) &&
          (!barOnly || !isBarOnlyBlockedPath(action.route, barFeatures)) &&
          canAccessCapability(access, action.capability),
      ),
    [access, barFeatures, barOnly],
  );
  const commands = useMemo(
    () =>
      [
        ...dockItems.map((item) => ({
          ...item,
          group: 'Workspace',
          badge:
            item.iconKey === 'checks'
              ? liveCounts.checks
              : item.iconKey === 'kitchen'
                ? liveCounts.kitchen
                : null,
        })),
        ...searchActions,
        canAccessCapability(access, 'reports.view') && {
          route: barOnly ? '/hpos/reports' : '/restaurant/finance-close?tab=sales',
          label: barOnly
            ? 'Bar sales & control reports'
            : 'Sales & service reports',
          group: 'Money',
          keywords: 'export excel pdf performance',
        },
        canAccessCapability(access, 'expenses.view') && {
          route: '/restaurant/finance-close?tab=expenses',
          label: 'Record or review expenses',
          group: 'Money',
          keywords: 'spend cost export',
        },
        canAccessCapability(access, 'data.import') && {
          route: '/data-management',
          label: 'Data, imports & backups',
          group: 'Business',
          keywords: 'template excel backup',
        },
        !['cashier', 'supervisor'].includes(role) && {
          route: '/hpos/manage',
          label: 'Manage workspace',
          group: 'Business',
        },
      ].filter(Boolean),
    [access, barOnly, dockItems, liveCounts, role, searchActions],
  );

  return (
    <div className="hpos-app-shell">
      <a className="hpos-skip-link" href="#hpos-main">
        Skip to main workspace
      </a>
      <HposNav
        settings={settings}
        user={user}
        syncStatus={syncStatus}
        isPosRoute={isPosRoute}
        onClockIn={startOrder}
        onLogout={logout}
        onNotifications={() => navigate('/hpos/control')}
        onSearch={() => setCommandOpen(true)}
        density={density}
        onDensityChange={() =>
          setDensity((value) => (value === 'touch' ? 'compact' : 'touch'))
        }
      />

      <div className="hpos-workspace-body">
        <nav
          className="hpos-primary-rail"
          aria-label={
            barOnly
              ? 'Bar workspace navigation'
              : 'Restaurant workspace navigation'
          }
        >
          {dockItems.map((item) => {
            const Icon = ICON_BY_KEY[item.iconKey] || Grid3X3;
            const active =
              currentPath === item.route ||
              currentPath.startsWith(`${item.route}/`);
            const badge =
              item.iconKey === 'checks'
                ? liveCounts.checks
                : item.iconKey === 'kitchen'
                  ? liveCounts.kitchen
                  : 0;
            return (
              <button
                key={item.route}
                type="button"
                className={active ? 'is-active' : ''}
                aria-current={active ? 'page' : undefined}
                onClick={() => navigate(item.route)}
                title={item.label}
              >
                <span className="hpos-rail-icon">
                  <Icon size={19} strokeWidth={active ? 2.4 : 1.8} />
                </span>
                <span>{item.label}</span>
                {badge > 0 && (
                  <span
                    className="hpos-rail-badge"
                    aria-label={`${badge} active`}
                  >
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </button>
            );
          })}
          <span className="hpos-rail-spacer" />
          {!['cashier', 'supervisor'].includes(role) && (
            <button
              type="button"
              className={`hpos-manage-trigger ${currentPath === '/hpos/manage' ? 'is-active' : ''}`}
              onClick={() => navigate('/hpos/manage')}
              title="Manage"
            >
              <span className="hpos-rail-icon">
                <MoreHorizontal size={20} />
              </span>
              <span>Manage</span>
            </button>
          )}
        </nav>

        <main
          id="hpos-main"
          tabIndex="-1"
          className={`hpos-app-main ${isPosRoute ? 'is-pos' : ''}`}
        >
          {!isTillRoute && (
            <nav className="hpos-history-nav" aria-label="Page history">
              <button
                type="button"
                aria-label="Go to the previous page"
                disabled={!historyAvailability.canGoBack}
                onClick={() => window.history.back()}
                title="Back"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                aria-label="Go to the next page"
                disabled={!historyAvailability.canGoForward}
                onClick={() => window.history.forward()}
                title="Forward"
              >
                <ChevronRight size={18} />
              </button>
            </nav>
          )}
          {isRoot ? <Navigate to="/hpos/pos" replace /> : <Outlet />}
        </main>
      </div>
      <HposCommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        commands={commands}
        onSelect={(command) => {
          setCommandOpen(false);
          navigate(command.route);
        }}
      />
    </div>
  );
}
