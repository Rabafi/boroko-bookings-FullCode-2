import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router';
import { ErrorNotice } from '../shared/ErrorNotice';
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
  ShieldCheck,
  LifeBuoy,
  X,
} from 'lucide-react';
import { useAccess, useAuth, useSettings } from '../../app-context';
import { canAccessCapability } from '../../../../shared/accessControl';
import { getCommercialFeatureSet } from '../../../../shared/commercialAccess';
import { isBarOnlyMode } from '../../../../shared/propertyTypes';
import {
  getHposDockItems,
  isBarOnlyBlockedPath,
  isManagerGatedPath,
  requiresManagePinForSearch,
  HPOS_MANAGER_PIN_UNLOCK_TIMEOUT_MS,
} from '../../../../shared/barModeProfile';
import HposNav from './HposNav';
import HposCommandPalette from './HposCommandPalette';

const MANAGE_UNLOCK_STORAGE_KEY = 'hpos-manage-unlock-at';
// Forgot-PIN help requests reuse the lodge support-ticket contract so they
// appear in Command Central with no new server surface. Category, priority
// and source below are the shared identifiers both sides match on.
const PIN_HELP_TITLE_PREFIX = 'Manager PIN help';
const PIN_HELP_CATEGORY = 'Access';
const PIN_HELP_SOURCE = 'hpos_manage_pin';
const PIN_HELP_OPEN_STATUSES = Object.freeze(['open', 'acknowledged', 'in_progress']);

function isOpenPinHelpTicket(ticket) {
  if (!ticket) return false;
  if (!PIN_HELP_OPEN_STATUSES.includes(String(ticket.status || '').toLowerCase())) return false;
  if (String(ticket.title || '').startsWith(PIN_HELP_TITLE_PREFIX)) return true;
  return Array.isArray(ticket.messages) && ticket.messages.some((message) => message?.metadata?.source === PIN_HELP_SOURCE);
}

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
  { route: '/hpos/shift-close', label: 'Staff shift close', group: 'Team', keywords: 'pin kiosk attendance staff clock in out cash handover review', capability: 'pos.manage' },
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
    access?.entitlement,
    access?.entitlement?.lodge_id || null
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
  // Manager PIN gate for the Manage workspace (Stock, Cash & close, Sales and
  // the hub itself). Unlock is session-scoped with a timeout: the manager
  // enters their own PIN at the Manage button, and every gated route — hub or
  // deep link — requires the same unlock. Verification is server-enforced
  // (staff.manage capability) via pos:verifyManagerPin; this state only
  // remembers a successful verification timestamp, never the PIN.
  const [manageUnlockAt, setManageUnlockAt] = useState(() => Number(sessionStorage.getItem(MANAGE_UNLOCK_STORAGE_KEY) || 0));
  const [managePinOpen, setManagePinOpen] = useState(false);
  const [managePin, setManagePin] = useState('');
  const [managePinError, setManagePinError] = useState('');
  const [managePinBusy, setManagePinBusy] = useState(false);
  const [pendingManageRoute, setPendingManageRoute] = useState(null);
  // Forgot-PIN help: files a support ticket Command Central already shows,
  // then polls the lodge inbox for the reply. The ticket — never the PIN —
  // is the recovery trail, so a manager locked out of Manage can still ask
  // for help from this dialog.
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpNote, setHelpNote] = useState('');
  const [helpBusy, setHelpBusy] = useState(false);
  const [helpError, setHelpError] = useState('');
  const [helpTicketId, setHelpTicketId] = useState(null);
  const [helpReply, setHelpReply] = useState(null);
  const [checkingReply, setCheckingReply] = useState(false);
  const isManageUnlocked = Number(manageUnlockAt) > 0 && (Date.now() - Number(manageUnlockAt) < HPOS_MANAGER_PIN_UNLOCK_TIMEOUT_MS);
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
    // Open Tabs owns the fresh tab rows on /hpos/checks (mount + 15s quiet
    // poll + visibility refetch). A second layout-level getTabs(active) on the
    // same cadence doubles the financial-truth RPC cost exactly when the tab
    // list is largest, so the layout skips its tabs fetch there and keeps the
    // last-known badge count. Kitchen tickets still poll (bar-only
    // short-circuits to []), and leaving the page repolls immediately via the
    // pathname dependency below.
    const onChecksPage =
      location.pathname === '/hpos/checks' ||
      location.pathname.startsWith('/hpos/checks/');
    let active = true;
    const poll = async () => {
      if (document.visibilityState === 'hidden') return;
      const [tabsResult, ticketsResult] = await Promise.allSettled([
        onChecksPage
          ? Promise.resolve(null)
          : window.api?.pos?.getTabs?.({ status: 'active' }) || [],
        barOnly
          ? Promise.resolve([])
          : window.api?.pos?.getTickets?.({ status: 'active' }) || [],
      ]);
      if (!active) return;
      const tickets =
        ticketsResult.status === 'fulfilled' &&
        Array.isArray(ticketsResult.value)
          ? ticketsResult.value
          : [];
      if (onChecksPage) {
        setLiveCounts((previous) => ({ ...previous, kitchen: tickets.length }));
        return;
      }
      const tabs =
        tabsResult.status === 'fulfilled' && Array.isArray(tabsResult.value)
          ? tabsResult.value
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
  }, [barOnly, location.pathname]);

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
      const shiftClose = { route: '/hpos/shift-close', label: 'Staff shift close', iconKey: 'attendance' };
      const visible = getHposDockItems(barOnly).filter((item) => {
        if (item.capability && !canAccessCapability(access, item.capability))
          return false;
        if (role === 'cashier') return ['sell', 'checks', 'floor'].includes(item.iconKey);
        // Stock, Cash & close and Sales moved under Manage (manager PIN-gated);
        // the rail keeps Sell, tabs/floor, kitchen and products/menu only.
        return true;
      });
      const till = visible.filter((item) => item.iconKey === 'sell');
      const service = visible.filter((item) => ['checks', 'floor'].includes(item.iconKey));
      const operations = visible.filter((item) => ['kitchen', 'menu'].includes(item.iconKey));
      if (role === 'cashier') return [...till, ...service, serviceShift, serviceCashup];
      if (role === 'supervisor') return [...till, ...service, shiftClose, serviceShift, serviceCashup, ...operations];
      if (['manager', 'admin', 'super_admin'].includes(role)) return [...till, ...service, shiftClose, ...operations];
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
  const isGatedManageRoute = isManagerGatedPath(currentPath);

  const requestManageAccess = useCallback((route) => {
    if (Number(manageUnlockAt) > 0 && (Date.now() - Number(manageUnlockAt) < HPOS_MANAGER_PIN_UNLOCK_TIMEOUT_MS)) {
      navigate(route);
      return;
    }
    setPendingManageRoute(route);
    setManagePin('');
    setManagePinError('');
    setManagePinOpen(true);
  }, [manageUnlockAt, navigate]);

  const closeManagePin = useCallback(() => {
    setManagePinOpen(false);
    setManagePin('');
    setManagePinError('');
    setManagePinBusy(false);
    setPendingManageRoute(null);
    setHelpOpen(false);
    setHelpNote('');
    setHelpBusy(false);
    setHelpError('');
    setHelpTicketId(null);
    setHelpReply(null);
    setCheckingReply(false);
  }, []);

  const confirmManagePin = useCallback(async () => {
    const pin = String(managePin || '').trim();
    if (!pin) {
      setManagePinError('Enter your manager PIN to open Manage.');
      return;
    }
    if (!user?.id) {
      setManagePinError('Your staff session could not be verified. Sign out and back in, then try again.');
      return;
    }
    setManagePinBusy(true);
    setManagePinError('');
    try {
      // Main-process code (IPC handler + capability) only loads on a full
      // relaunch. Without it every PIN would fail identically, so say so
      // instead of reporting a correct PIN as incorrect.
      if (typeof window.api?.pos?.verifyManagerPin !== 'function') {
        setManagePinError('This app build cannot check the manager PIN yet. Close and reopen the app fully (not just refresh), then try again.');
        return;
      }
      const result = await window.api.pos.verifyManagerPin({ staff_id: user.id, pin });
      if (result?.success) {
        const unlockedAt = Date.now();
        setManageUnlockAt(unlockedAt);
        try { sessionStorage.setItem(MANAGE_UNLOCK_STORAGE_KEY, String(unlockedAt)); } catch {}
        const destination = pendingManageRoute || '/hpos/manage';
        closeManagePin();
        navigate(destination);
      } else {
        setManagePinError(result?.error || 'Invalid PIN or unauthorized staff member');
      }
    } catch (error) {
      setManagePinError(error?.message || 'The manager PIN could not be checked. Reconnect and try again.');
    } finally {
      setManagePinBusy(false);
    }
  }, [managePin, user, pendingManageRoute, closeManagePin, navigate]);

  // Expire the Manage unlock on its timeout so the next visit re-prompts.
  useEffect(() => {
    if (!manageUnlockAt) return undefined;
    const remaining = HPOS_MANAGER_PIN_UNLOCK_TIMEOUT_MS - (Date.now() - Number(manageUnlockAt));
    if (remaining <= 0) {
      setManageUnlockAt(0);
      try { sessionStorage.removeItem(MANAGE_UNLOCK_STORAGE_KEY); } catch {}
      return undefined;
    }
    const timer = setTimeout(() => {
      setManageUnlockAt(0);
      try { sessionStorage.removeItem(MANAGE_UNLOCK_STORAGE_KEY); } catch {}
    }, remaining);
    return () => clearTimeout(timer);
  }, [manageUnlockAt]);

  // Clear the unlock when the signed-in staff member changes.
  const prevUserIdRef = useRef(user?.id);
  useEffect(() => {
    if (prevUserIdRef.current !== user?.id) {
      prevUserIdRef.current = user?.id;
      setManageUnlockAt(0);
      try { sessionStorage.removeItem(MANAGE_UNLOCK_STORAGE_KEY); } catch {}
      setManagePinOpen(false);
      setManagePin('');
      setManagePinError('');
      setPendingManageRoute(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const findOpenPinHelpTicket = useCallback(async () => {
    const rows = await window.api?.requests?.getAll?.(100);
    const list = Array.isArray(rows) ? rows : [];
    return list.find(isOpenPinHelpTicket) || null;
  }, []);

  // File (or reuse) a PIN-help support ticket. Reuses the open one so double
  // taps and retries can never spam support with duplicates. Never accepts a
  // PIN in the note — the ticket carries identity and contact detail only.
  const requestPinHelp = useCallback(async () => {
    const note = String(helpNote || '').trim();
    if (/^\d{4,6}$/.test(note.replace(/[\s-]/g, ''))) {
      setHelpError('Never type your PIN here. Describe what happened instead, or leave the note blank.');
      return;
    }
    if (note.length > 500) {
      setHelpError('Keep the note under 500 characters.');
      return;
    }
    setHelpBusy(true);
    setHelpError('');
    try {
      const existing = await findOpenPinHelpTicket().catch(() => null);
      if (existing?.id) {
        setHelpTicketId(existing.id);
        setHelpError('');
        return;
      }
      if (typeof window.api?.admin?.createSupportTicket !== 'function') {
        throw new Error('This app build cannot send help requests. Relaunch the app fully and try again.');
      }
      const who = user?.name || user?.email || 'Bar manager';
      const result = await window.api.admin.createSupportTicket({
        title: `${PIN_HELP_TITLE_PREFIX} — ${who}`,
        description: `A manager on the Bar terminal cannot unlock Manage with their PIN and requests help resetting access.${note ? ` Manager note: ${note}` : ' No note was left.'}`,
        category: PIN_HELP_CATEGORY,
        priority: 'High',
        source: PIN_HELP_SOURCE,
      });
      if (result?.success === false || !result?.id) {
        throw new Error(result?.error || 'The help request was not confirmed. Connect to the internet and try again.');
      }
      setHelpTicketId(result.id);
      setHelpError('');
    } catch (error) {
      setHelpError(error?.message || 'The help request could not be sent. Connect to the internet and try again.');
    } finally {
      setHelpBusy(false);
    }
  }, [helpNote, user, findOpenPinHelpTicket]);

  // Read back the latest Command Central reply on the PIN-help ticket so the
  // loop closes on this terminal. Best-effort read receipt afterwards.
  const checkPinHelpReply = useCallback(async () => {
    setCheckingReply(true);
    setHelpError('');
    try {
      const rows = await window.api?.requests?.getAll?.(100);
      const list = Array.isArray(rows) ? rows : [];
      const ticket = (helpTicketId && list.find((entry) => entry?.id === helpTicketId))
        || list.find(isOpenPinHelpTicket)
        || null;
      if (!ticket) {
        setHelpReply(null);
        setHelpError('No open help request was found. Send one first, then check again.');
        return;
      }
      setHelpTicketId(ticket.id);
      const reply = [...(Array.isArray(ticket.messages) ? ticket.messages : [])]
        .filter((message) => String(message?.sender_type || '') === 'command_central')
        .sort((left, right) => String(left?.created_at || '').localeCompare(String(right?.created_at || '')))
        .pop() || null;
      if (!reply?.body) {
        setHelpReply(null);
        setHelpError('No reply yet. Support was notified — check again shortly.');
        return;
      }
      setHelpReply({ body: reply.body, at: reply.created_at || null });
      try { await window.api?.requests?.markRead?.(ticket.id, 'manager', reply.id || null); } catch {}
    } catch (error) {
      setHelpError(error?.message || 'Replies could not be loaded. Connect to the internet and try again.');
    } finally {
      setCheckingReply(false);
    }
  }, [helpTicketId]);

  // Deep links, search and history can land on a gated route without using
  // the Manage button. Prompt for the same unlock instead of redirecting, and
  // keep the page content locked until verification succeeds.
  useEffect(() => {
    if (isGatedManageRoute && !isManageUnlocked && !managePinOpen) {
      setPendingManageRoute(currentPath + (location.search || ''));
      setManagePin('');
      setManagePinError('');
      setManagePinOpen(true);
    }
  }, [isGatedManageRoute, isManageUnlocked, managePinOpen, currentPath, location.search]);

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
          route: barOnly ? '/hpos/expenses' : '/restaurant/finance-close?tab=expenses',
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
        trialStatus={access?.entitlement}
        barOnly={barOnly}
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
              onClick={() => requestManageAccess('/hpos/manage')}
              title="Manage (manager PIN required)"
              aria-haspopup="dialog"
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
          // Only the live Till keeps a locked viewport (overflow hidden with its
          // own internal scroll areas). Review pages such as /hpos/cash must keep
          // the default scrollable main, otherwise long cash-up queues and the
          // manager decision form below the fold can never be reached.
          className={`hpos-app-main ${isTillRoute ? 'is-pos' : ''}`}
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
          {isRoot ? <Navigate to="/hpos/pos" replace /> : (isGatedManageRoute && !isManageUnlocked ? (
            <section className="hpos-manage-locked" aria-label="Manage locked" style={{ display: 'grid', placeItems: 'center', gap: '10px', maxWidth: '520px', margin: '48px auto', padding: '32px', textAlign: 'center', border: '1px solid rgba(55,70,57,.14)', borderRadius: '22px', background: '#fffdf8' }}>
              <span style={{ display: 'grid', placeItems: 'center', width: '52px', height: '52px', borderRadius: '16px', background: 'rgba(57,112,93,.12)', color: '#39705d' }}><ShieldCheck size={28} /></span>
              <p className="hpos-eyebrow">Manager access</p>
              <h2 style={{ margin: 0, color: '#2f2830' }}>Enter your manager PIN to continue</h2>
              <p style={{ margin: 0, color: '#756a70', fontSize: '12px', lineHeight: 1.55 }}>Stock, Cash &amp; close, Sales and the Manage workspace need a fresh manager PIN. Works offline — your PIN is checked by the server when online and by this device&apos;s trusted check when offline, and never stored.</p>
              <button type="button" onClick={() => requestManageAccess(currentPath + (location.search || ''))} style={{ minHeight: '44px', padding: '0 22px', border: 0, borderRadius: '11px', background: '#39705d', color: '#fff', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>Unlock with manager PIN</button>
            </section>
          ) : <Outlet />)}
        </main>
      </div>
      <HposCommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        commands={commands}
        onSelect={(command) => {
          setCommandOpen(false);
          // Global search must never bypass the Manage hub gate: any page
          // listed under Manage requires the same manager PIN unlock as the
          // Manage button, even when it is not page-level gated itself.
          if (requiresManagePinForSearch(command.route)) requestManageAccess(command.route);
          else navigate(command.route);
        }}
      />
      {managePinOpen && (
        <div
          className="hpos-manage-pin-backdrop"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget && !managePinBusy) closeManagePin(); }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1200,
            display: 'grid',
            placeItems: 'center',
            padding: '24px',
            background: 'rgba(31, 24, 28, .42)',
            backdropFilter: 'blur(8px)'
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="hpos-manage-pin-title"
            onMouseDown={(event) => event.stopPropagation()}
            style={{
              width: 'min(420px, 100%)',
              padding: '24px',
              border: '1px solid rgba(255,255,255,.72)',
              borderRadius: '22px',
              background: '#fffdf8',
              boxShadow: '0 28px 90px rgba(31,24,28,.28)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
              <div>
                <p className="hpos-eyebrow">Manager access</p>
                <h2 id="hpos-manage-pin-title" style={{ margin: '4px 0 6px', color: '#2f2830', fontSize: '22px', letterSpacing: '-.03em' }}>Enter manager PIN</h2>
                <p style={{ margin: 0, color: '#756a70', fontSize: '12px', lineHeight: 1.55 }}>
                  {user?.name ? `${user.name}, enter` : 'Enter'} your manager PIN to open {pendingManageRoute && pendingManageRoute !== '/hpos/manage' ? 'this Manage workspace' : 'Manage'}. Unlocked for {Math.round(HPOS_MANAGER_PIN_UNLOCK_TIMEOUT_MS / 60000)} minutes on this device.
                </p>
              </div>
              <button type="button" onClick={closeManagePin} disabled={managePinBusy} aria-label="Close manager PIN prompt" title="Close" style={{ display: 'grid', placeItems: 'center', width: '36px', height: '36px', flexShrink: 0, border: '1px solid #ded3d8', borderRadius: '11px', background: '#fff', color: '#6b5f66', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>
            <form
              onSubmit={(event) => { event.preventDefault(); if (!managePinBusy) confirmManagePin(); }}
              style={{ display: 'grid', gap: '12px', marginTop: '18px' }}
            >
              <label style={{ display: 'grid', gap: '6px', color: '#4b4047', fontSize: '12px', fontWeight: 700 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}><ShieldCheck size={15} /> Manager PIN</span>
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  autoFocus
                  value={managePin}
                  onChange={(event) => setManagePin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  disabled={managePinBusy}
                  placeholder="Enter PIN"
                  style={{ minHeight: '44px', padding: '0 14px', border: '1px solid #cfc2c8', borderRadius: '11px', fontSize: '16px', letterSpacing: '.2em' }}
                />
              </label>
              {managePinError && <ErrorNotice style={{ margin: 0, padding: '11px 12px', border: '1px solid #e1aaa0', borderRadius: '12px', background: '#fff0eb', color: '#a94430', fontSize: '12px', lineHeight: 1.45 }}>{managePinError}</ErrorNotice>}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" onClick={closeManagePin} disabled={managePinBusy} style={{ flex: 1, minHeight: '44px', border: '1px solid #cfc2c8', borderRadius: '11px', background: '#fff', color: '#4b4047', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button type="submit" disabled={managePinBusy || !managePin} style={{ flex: 1, minHeight: '44px', border: 0, borderRadius: '11px', background: '#39705d', color: '#fff', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>
                  {managePinBusy ? 'Checking…' : 'Unlock Manage'}
                </button>
              </div>
              <small style={{ color: '#968a90', fontSize: '11px', lineHeight: 1.5 }}>Only managers and admins can unlock. Supervisors and cashiers cannot open Manage, even with a correct PIN.</small>
            </form>
            {!helpOpen ? (
              <button
                type="button"
                onClick={() => { setHelpOpen(true); setHelpError(''); }}
                disabled={managePinBusy}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', marginTop: '14px', padding: 0, border: 0, background: 'transparent', color: '#39705d', fontSize: '12px', fontWeight: 800, cursor: 'pointer' }}
              >
                <LifeBuoy size={14} /> Forgot PIN? Get help
              </button>
            ) : (
              <div className="hpos-manage-pin-help" style={{ display: 'grid', gap: '10px', marginTop: '16px', padding: '14px', border: '1px solid #e5dce0', borderRadius: '14px', background: '#fbf7f2' }}>
                <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '7px', color: '#342b31', fontSize: '13px', fontWeight: 800 }}><LifeBuoy size={15} /> Get help with your PIN</p>
                <p style={{ margin: 0, color: '#756a70', fontSize: '12px', lineHeight: 1.55 }}>
                  This sends a help request to support with your name — it appears in Command Central, and the reply comes back here via Check for reply.
                  Never type your PIN anywhere on this screen.
                </p>
                {syncStatus?.isOnline === false && (
                  <p role="status" style={{ margin: 0, padding: '9px 11px', border: '1px solid rgba(245, 158, 11, .35)', borderRadius: '10px', background: 'rgba(245, 158, 11, .10)', color: '#92600a', fontSize: '12px' }}>
                    You appear offline. Help requests need a connection — reconnect first.
                  </p>
                )}
                {!helpTicketId && (
                  <label style={{ display: 'grid', gap: '6px', color: '#4b4047', fontSize: '12px', fontWeight: 700 }}>
                    <span>How can support reach you? (optional)</span>
                    <textarea
                      value={helpNote}
                      onChange={(event) => setHelpNote(event.target.value.slice(0, 500))}
                      disabled={helpBusy}
                      rows={2}
                      placeholder="e.g. Call the bar on 71 000 000"
                      style={{ padding: '10px 12px', border: '1px solid #cfc2c8', borderRadius: '11px', fontSize: '13px', fontFamily: 'inherit', resize: 'vertical' }}
                    />
                  </label>
                )}
                {helpError && <ErrorNotice style={{ margin: 0, padding: '11px 12px', border: '1px solid #e1aaa0', borderRadius: '12px', background: '#fff0eb', color: '#a94430', fontSize: '12px', lineHeight: 1.45 }}>{helpError}</ErrorNotice>}
                {helpTicketId && (
                  <p role="status" style={{ margin: 0, padding: '9px 11px', border: '1px solid #b7d9c9', borderRadius: '10px', background: '#edf8f2', color: '#39705d', fontSize: '12px' }}>
                    Request sent · ref {String(helpTicketId).slice(0, 8).toUpperCase()}
                  </p>
                )}
                {helpReply && (
                  <div style={{ padding: '11px 12px', border: '1px solid #b7d9c9', borderRadius: '12px', background: '#fff' }}>
                    <p style={{ margin: '0 0 4px', color: '#39705d', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em' }}>Support reply</p>
                    <p style={{ margin: 0, color: '#342b31', fontSize: '13px', lineHeight: 1.55 }}>{helpReply.body}</p>
                    {helpReply.at && <p style={{ margin: '6px 0 0', color: '#968a90', fontSize: '11px' }}>{new Date(helpReply.at).toLocaleString('en-GB')}</p>}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '8px' }}>
                  {!helpTicketId && (
                    <button type="button" onClick={requestPinHelp} disabled={helpBusy} style={{ flex: 1, minHeight: '44px', border: 0, borderRadius: '11px', background: '#39705d', color: '#fff', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>
                      {helpBusy ? 'Sending…' : 'Request help'}
                    </button>
                  )}
                  {helpTicketId && (
                    <button type="button" onClick={checkPinHelpReply} disabled={checkingReply || helpBusy} style={{ flex: 1, minHeight: '44px', border: 0, borderRadius: '11px', background: '#39705d', color: '#fff', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>
                      {checkingReply ? 'Checking…' : 'Check for reply'}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => { setHelpOpen(false); setHelpError(''); }}
                  disabled={helpBusy || checkingReply}
                  style={{ padding: 0, border: 0, background: 'transparent', color: '#756a70', fontSize: '12px', fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}
                >
                  Back to entering PIN
                </button>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
