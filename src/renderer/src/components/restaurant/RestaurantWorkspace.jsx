import { Component, useMemo } from 'react'
import { NavLink, useSearchParams } from 'react-router'
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  ChefHat,
  ClipboardCheck,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  UtensilsCrossed,
  UsersRound,
  WalletCards
} from 'lucide-react'
import { useAccess, useFeatures, useSettings } from '../../app-context'
import { canAccessCapability } from '../../../../shared/accessControl'
import { isBarOnlyMode } from '../../../../shared/propertyTypes'
import {
  getVisibleWorkspaceTabs,
  resolveWorkspaceTab,
  sanitizeOutletScope
} from '../../../../shared/workspaceTabAccess'

import RestaurantTables from './RestaurantTables'
import RestaurantKitchen from './RestaurantKitchen'
import HposMenu from '../hospitality-pos/HposMenu'
import RestaurantRecipes from './RestaurantRecipes'
import RestaurantStock from './RestaurantStock'
import RestaurantPurchasing from './RestaurantPurchasing'
import RestaurantShifts from './RestaurantShifts'
import RestaurantDailyClose from './RestaurantDailyClose'
import RestaurantCustomers from './RestaurantCustomers'
import RestaurantChecklists from './RestaurantChecklists'
import RestaurantAlerts from './RestaurantAlerts'
import RestaurantOwnerDigest from './RestaurantOwnerDigest'
import RestaurantReservations from './RestaurantReservations'
import RestaurantCombos from './RestaurantCombos'
import RestaurantRecipeVariance from './RestaurantRecipeVariance'
import RestaurantStaffPerformance from './RestaurantStaffPerformance'
import RestaurantPrepBatches from './RestaurantPrepBatches'
import RestaurantKitchenAnalytics from './RestaurantKitchenAnalytics'
import RestaurantPurchaseSuggestions from './RestaurantPurchaseSuggestions'
import RestaurantStations from './RestaurantStations'
import RestaurantCommercialControl from './RestaurantCommercialControl'
import RestaurantGrowthControls from './RestaurantGrowthControls'
import BarWorkforceSchedule from './BarWorkforceSchedule'
import RestaurantInventoryLots from './RestaurantInventoryLots'
import RestaurantPageGuide from './RestaurantPageGuide'
import RestaurantFinanceOverview from './RestaurantFinanceOverview'
import HposCashClose from '../hospitality-pos/HposCashClose'
import HposReports from '../hospitality-pos/HposReports'
import HposExpenses from '../hospitality-pos/HposExpenses'

const RestaurantSettlementControl = () => <RestaurantCommercialControl section="settlements" />
const RestaurantFeedbackControl = () => <RestaurantCommercialControl section="feedback" />
const RestaurantCustomerFunds = () => <><RestaurantCommercialControl section="deposits" /><RestaurantGrowthControls tabKey="customer-funds" /></>

// The lodge F&B route reuses the restaurant operations primitives, but it must
// keep a single canonical owner for shared records. These adapters are passed
// through to child components so future lodge-aware primitives can use the same
// route, noun, and theme contract without forking the restaurant components.
const CONTEXT_ADAPTERS = Object.freeze({
  restaurant: Object.freeze({
    id: 'restaurant',
    mode: 'restaurant',
    routePrefix: '/restaurant',
    noun: 'restaurant',
    pluralNoun: 'restaurant',
    theme: 'restaurant',
    embedded: false,
    canonicalRoutes: Object.freeze({ pos: '/hpos/pos', inventory: '/hpos/stock', reports: '/hpos/reports', expenses: '/hpos/expenses' })
  }),
  'property-outlet': Object.freeze({
    id: 'property-outlet',
    mode: 'lodge',
    routePrefix: '/food-beverage',
    noun: 'property outlet',
    pluralNoun: 'property food & beverage',
    theme: 'lodge',
    embedded: true,
    canonicalRoutes: Object.freeze({ pos: '/pos', inventory: '/inventory?scope=food-beverage', reports: '/reports?tab=pos', expenses: '/expenses?scope=food-beverage' })
  })
})

const LODGE_CANONICAL_TABS = Object.freeze({
  'stock:stock': {
    title: 'Lodge inventory',
    description: 'Use the lodge Inventory workspace for stock items, adjustments, stocktakes, and movement history.',
    routeKey: 'inventory',
    action: 'Open lodge Inventory'
  },
  'finance:overview': {
    title: 'Lodge reports & finance',
    description: 'Use the canonical lodge reports for server-confirmed POS sales, costs, and financial evidence.',
    routeKey: 'reports',
    action: 'Open lodge Reports'
  },
  'finance:cashups': {
    title: 'Canonical POS cash-up',
    description: 'Cash-up and drawer reconciliation remain in the canonical POS workflow with its existing operator controls.',
    routeKey: 'pos',
    action: 'Open outlet POS'
  },
  'finance:sales': {
    title: 'Lodge POS sales report',
    description: 'Receipt, tender, void, and sales evidence is owned by the lodge Reports workspace.',
    routeKey: 'reports',
    action: 'Open POS sales report'
  },
  'finance:expenses': {
    title: 'Lodge expenses',
    description: 'Operating expenses are recorded and reviewed in the canonical lodge Expenses workspace.',
    routeKey: 'expenses',
    action: 'Open lodge Expenses'
  }
})

const LODGE_TAB_CAPABILITIES = Object.freeze({
  'stock:stock': ['inventory.view'],
  'stock:purchasing': ['inventory.manage'],
  'stock:suggestions': ['inventory.view'],
  'stock:lots': ['inventory.manage'],
  'team:shifts': ['pos.manage'],
  'team:roster': ['staff.view', 'workforce_scheduling.view'],
  'team:performance': ['reports.view', 'staff.view'],
  'team:tips': ['staff.view'],
  'finance:overview': ['reports.view'],
  'finance:cashups': ['pos.cashup'],
  'finance:sales': ['reports.view'],
  'finance:settlements': ['reports.view'],
  'finance:customer-funds': ['pos.manage'],
  'finance:expenses': ['expenses.view'],
  'finance:tips': ['staff.view'],
  'finance:daily-close': ['reports.view'],
  'finance:owner-review': ['reports.view'],
  'control:checklists': ['pos.manage'],
  'control:alerts': ['reports.view'],
  'control:feedback': ['pos.manage'],
  'control:policies': ['pos.manage']
})

// Progressive activation: which lodge tab needs which optional F&B module.
// Core tabs have no entry and always render (capability-filtered). A tab with
// a module entry renders only while that module is enabled; disabling hides
// navigation and stops new work while retained history stays in the canonical
// workflow. This map never grants entitlement — RPCs enforce independently.
const LODGE_TAB_MODULES = Object.freeze({
  'menu:recipes': 'recipes',
  'menu:prep': 'recipes',
  'menu:variance': 'recipes',
  'stock:purchasing': 'purchasing',
  'stock:suggestions': 'purchasing',
  'stock:lots': 'purchasing',
  'team:roster': 'team',
  'team:performance': 'team',
  'team:tips': 'team',
  'finance:tips': 'team',
  'finance:settlements': 'settlement',
  'finance:customer-funds': 'settlement'
})

function withQuery(route, outletId, returnTo) {
  if (!route) return route
  const params = []
  if (outletId) params.push(`outlet=${encodeURIComponent(outletId)}`)
  if (returnTo) params.push(`from=${encodeURIComponent(returnTo)}`)
  if (params.length === 0) return route
  const sep = route.includes('?') ? '&' : '?'
  return `${route}${sep}${params.join('&')}`
}

function LodgeCanonicalBridge({ adapter, bridge, outletId, returnTo }) {
  const base = adapter.canonicalRoutes[bridge.routeKey]
  const route = withQuery(base, outletId, returnTo)
  return (
    <section className="rounded-[24px] border border-emerald-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-emerald-700">One source of truth</p>
      <h2 className="mt-2 text-xl font-black text-slate-900">{bridge.title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{bridge.description}</p>
      <NavLink to={route} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800">
        {bridge.action}<ArrowRight size={16} />
      </NavLink>
    </section>
  )
}

function LodgeModuleOffBridge({ moduleKey, returnTo }) {
  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-slate-500">Advanced module off</p>
      <h2 className="mt-2 text-xl font-black text-slate-900">This tool is currently off</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">An administrator can enable it inside Food &amp; Beverage → More tools. Existing records and audit history are kept and stay readable in their canonical workflow.</p>
      <NavLink to={returnTo || '/food-beverage/more'} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700">
        Open More tools<ArrowRight size={16} />
      </NavLink>
    </section>
  )
}

function LodgeWorkspaceGuide({ description, nextStep }) {
  return (
    <aside className="mb-4 flex flex-col gap-2 rounded-xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-sm text-slate-700 sm:flex-row sm:items-center sm:justify-between">
      <p className="leading-5">{description}</p>
      {nextStep && <p className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-emerald-800"><ArrowRight size={14} />{nextStep}</p>}
    </aside>
  )
}

const WORKSPACES = {
  floor: {
    title: 'Floor & Service',
    description: 'Manage tables, reservations, and the waiting list from one front-of-house workspace.',
    tabs: [
      { key: 'tables', label: 'Live Floor', feature: 'pos', capability: 'pos.service', Component: RestaurantTables, description: 'See table status, open a table for a waiter, transfer a running tab, or send the operator to POS.', nextStep: 'Open a table, then add items in POS.' },
      { key: 'reservations', label: 'Reservations', feature: 'pos', capability: 'pos.service', Component: RestaurantReservations, description: 'Create, confirm, seat, cancel, or mark table reservations as no-shows.', nextStep: 'Use WhatsApp only for assisted customer communication.' }
    ]
  },
  kitchen: {
    title: 'Kitchen',
    description: 'Run live kitchen service and review station timing without leaving the kitchen workspace.',
    tabs: [
      { key: 'live', label: 'Live Tickets', feature: 'pos', capability: 'pos.view', Component: RestaurantKitchen, description: 'Move each ticket through preparation, ready, and served without losing its station routing.', nextStep: 'Mark a ticket ready only when the full station work is complete.' },
      { key: 'stations', label: 'Stations', feature: 'pos', capability: 'pos.menu_manage', Component: RestaurantStations, description: 'Set up the kitchen, bar, prep, and other stations that receive menu items.', nextStep: 'Assign menu items to a station in Menu & Production.' },
      { key: 'analytics', label: 'Analytics', feature: 'reports', capability: 'reports.view', Component: RestaurantKitchenAnalytics, description: 'Review ticket timing and bottlenecks by station.', nextStep: 'Use delays to adjust staffing or menu preparation.' }
    ]
  },
  menu: {
    title: 'Menu & Production',
    description: 'Manage what you sell, how it is priced, and how the kitchen produces it.',
    tabs: [
      { key: 'menu', label: 'Menu & Modifiers', feature: 'pos', capability: 'pos.menu_manage', Component: HposMenu, description: 'Maintain the items cashiers sell and the choices customers can make.', nextStep: 'Keep unavailable items disabled instead of deleting history.' },
      { key: 'combos', label: 'Combos', feature: 'pos', capability: 'pos.menu_manage', Component: RestaurantCombos, description: 'Bundle items into meal deals with required and optional selections.', nextStep: 'Test a combo in POS before publishing it to staff.' },
      { key: 'recipes', label: 'Recipes & Costing', feature: 'inventory', capability: 'inventory.view', Component: RestaurantRecipes, description: 'Link sale items to ingredients so stock and margin remain understandable.', nextStep: 'Review variance after stock counts.' },
      { key: 'prep', label: 'Prep Batches', feature: 'inventory', capability: 'inventory.manage', Component: RestaurantPrepBatches, description: 'Record sauces, dough, marinades, and other prep production.', nextStep: 'Post a batch only after actual yield is counted.' },
      { key: 'variance', label: 'Recipe Variance', feature: 'inventory', capability: 'inventory.view', Component: RestaurantRecipeVariance, description: 'Compare expected ingredient use to stock movement and counts.', nextStep: 'Investigate variance before adjusting stock.' }
    ]
  },
  stock: {
    title: 'Stock & Purchasing',
    description: 'Keep stock counts, suppliers, purchase orders, and reorder suggestions together.',
    tabs: [
      { key: 'stock', label: 'Stock Control', feature: 'inventory', Component: RestaurantStock, description: 'Review current stock and low-stock risk before service is affected.', nextStep: 'Use Purchasing or Lots & Expiry to resolve risks.' },
      { key: 'purchasing', label: 'Purchasing', feature: 'inventory', Component: RestaurantPurchasing },
      { key: 'suggestions', label: 'Suggestions', feature: 'inventory', Component: RestaurantPurchaseSuggestions }
      ,{ key: 'lots', label: 'Lots & Expiry', feature: 'inventory', Component: RestaurantInventoryLots }
    ]
  },
  team: {
    title: 'Team',
    description: 'See the current shift and review staff accountability in one place.',
    tabs: [
      { key: 'shifts', label: 'Shifts', feature: 'staff', Component: RestaurantShifts },
      { key: 'roster', label: 'Roster', feature: 'staff', Component: BarWorkforceSchedule, description: 'Build the weekly cashier, bartender and supervisor roster.', nextStep: 'Check cover before publishing shifts to the team.' },
      { key: 'performance', label: 'Performance', feature: 'staff', Component: RestaurantStaffPerformance },
      { key: 'tips', label: 'Tips & Payouts', feature: 'staff', Component: RestaurantGrowthControls, description: 'Pay only earned, available tip balances using a traceable method.', nextStep: 'Confirm the available balance before recording a payout.' }
    ]
  },
  finance: {
    title: 'Finance & Close',
    description: 'Reconcile every payment, customer liability, payout, expense and day close from one controlled workspace.',
    tabs: [
      { key: 'overview', label: 'Overview', feature: 'reports', Component: RestaurantFinanceOverview },
      { key: 'cashups', label: 'Cash-ups & Drawers', feature: 'pos', Component: HposCashClose },
      { key: 'sales', label: 'Sales & Payments', feature: 'reports', Component: HposReports },
      { key: 'settlements', label: 'Settlements', feature: 'reports', Component: RestaurantSettlementControl },
      { key: 'customer-funds', label: 'Customer Funds', feature: 'pos', Component: RestaurantCustomerFunds },
      { key: 'expenses', label: 'Expenses', feature: 'expenses', Component: HposExpenses },
      { key: 'tips', label: 'Tips & Payouts', feature: 'staff', Component: RestaurantGrowthControls },
      { key: 'daily-close', label: 'Daily Close', feature: 'reports', Component: RestaurantDailyClose },
      { key: 'owner-review', label: 'Owner Review & Digest', feature: 'reports', Component: RestaurantOwnerDigest }
    ]
  },
  control: {
    title: 'Control',
    description: 'Keep opening, closing, cleaning, and exception work visible to the right people.',
    tabs: [
      { key: 'checklists', label: 'Checklists', feature: 'pos', Component: RestaurantChecklists },
      { key: 'alerts', label: 'Alerts', feature: 'reports', Component: RestaurantAlerts },
      { key: 'feedback', label: 'Customer Feedback', feature: 'pos', Component: RestaurantFeedbackControl },
      { key: 'policies', label: 'Guest Policies', feature: 'pos', Component: RestaurantGrowthControls }
    ]
  }
}

const WORKSPACE_PRESENTATION = {
  floor: {
    eyebrow: 'Front-of-house operations',
    summary: 'Keep tables, reservations and waiting guests moving through one service view.',
    status: 'Live service',
    Icon: UtensilsCrossed
  },
  kitchen: {
    eyebrow: 'Production operations',
    summary: 'Coordinate active tickets, station ownership and service-time performance.',
    status: 'Kitchen flow',
    Icon: ChefHat
  },
  menu: {
    eyebrow: 'Menu engineering',
    summary: 'Control what the team sells, how every item is produced and what it costs.',
    status: 'Menu control',
    Icon: ClipboardCheck
  },
  stock: {
    eyebrow: 'Restaurant inventory operations',
    title: 'Stock, purchasing & control',
    summary: 'Keep stock available, purchase intelligently, track expiry and protect margin.',
    status: 'Stock health',
    Icon: Boxes
  },
  team: {
    eyebrow: 'People & accountability',
    summary: 'Plan the shift, see who is accountable and coach from operational evidence.',
    status: 'Team control',
    Icon: UsersRound
  },
  finance: {
    eyebrow: 'Financial close operations',
    summary: 'Keep sales, cash, customer money, expenses, payouts and end-of-day evidence financially true.',
    status: 'Financial control',
    Icon: WalletCards
  },
  control: {
    eyebrow: 'Standards & exceptions',
    summary: 'Keep routines, alerts, customer commitments and policy controls visible.',
    status: 'Operational control',
    Icon: ShieldCheck
  }
}

function FeatureGate({ feature, context = 'restaurant', children }) {
  const features = useFeatures()
  if (Object.keys(features || {}).length > 0 && features[feature] === false) {
    return (
      <div className="relative flex min-h-[420px] flex-col items-center justify-center overflow-hidden rounded-[28px] border border-[#d9c7bc] bg-[radial-gradient(circle_at_top,#fff8ef_0%,#f2e7df_62%,#eadbd3_100%)] p-8 text-center shadow-[0_18px_45px_rgba(71,42,52,.12)]">
        <div className="absolute -right-14 -top-20 h-56 w-56 rounded-full bg-[#b86743]/10" aria-hidden="true" />
        <div className="relative grid h-14 w-14 place-items-center rounded-2xl bg-[#34242d] text-[#f0a35c] shadow-lg"><LockKeyhole size={25} /></div>
        <h2 className="relative mt-5 text-xl font-black tracking-tight text-[#30212a]">This operation is not enabled</h2>
        <p className="relative mt-2 max-w-md text-sm leading-6 text-[#765f68]">This workspace is outside the current {context === 'property-outlet' ? 'Lodge' : 'Restaurant & Bar'} package. No operational data has been changed.</p>
      </div>
    )
  }
  return children
}

const TAB_GUIDANCE = {
  purchasing: ['Purchasing', 'Create suppliers and purchase orders, then approve and receive stock exactly once.', 'Receive goods only after they physically arrive.'],
  suggestions: ['Purchase Suggestions', 'Turn low-stock signals into draft purchase orders for supplier review.', 'Check quantities and supplier prices before creating a PO.'],
  lots: ['Lots & Expiry', 'Register batch codes and expiry dates for received stock.', 'Use the near-expiry list before ordering more stock.'],
  shifts: ['Shifts', 'Track who is working and which operator is accountable for a shift.', 'Clock out staff only after their work is handed over.'],
  performance: ['Staff Performance', 'Compare service, sales, and exception signals by staff member.', 'Use trends for coaching, not assumptions.'],
  tips: ['Tips & Payouts', 'Record approved tip-pool payouts with a traceable payment method.', 'Confirm the pool before paying out.'],
  cashups: ['Cash-ups & Drawers', 'Review staff cash-ups and reconcile the physical drawer from the authoritative service screen.', 'Resolve variances before day close.'],
  sales: ['Sales & Payments', 'Review receipts, tenders, voids, discounts and payment exceptions.', 'Investigate exceptions before closing the period.'],
  settlements: ['Settlements', 'Compare the server-derived POS expectation with the provider settlement.', 'Keep the provider reference and investigate variance.'],
  'customer-funds': ['Customer Funds', 'Keep reservation deposits and stored-value gift cards visible as customer liabilities.', 'Never record a deposit as a normal POS sale.'],
  expenses: ['Expenses', 'Record operating costs with their date and evidence.', 'Review expenses before owner close.'],
  'daily-close': ['Daily Close', 'Check open tables, tickets, shifts, cash, and alerts before closing the day.', 'Resolve every blocker before close.'],
  'owner-review': ['Owner Review & Digest', 'Create a concise operational and financial owner digest.', 'Review exceptions as well as sales.'],
  checklists: ['Checklists', 'Run opening, closing, cleaning, and safety routines consistently.', 'Complete items only after the task is done.'],
  alerts: ['Alerts', 'Review cash, stock, and operational exceptions needing attention.', 'Resolve an alert only after the underlying issue is handled.'],
  feedback: ['Customer Feedback', 'Capture factual guest feedback and keep manager follow-up visible.', 'Resolve the guest issue before marking it complete.'],
  policies: ['Guest Policies', 'Set cancellation and no-show rules used by the service team.', 'Use policies consistently when handling cancellations.']
}

class RestaurantWorkspaceErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidUpdate(previous) { if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }) }
  render() {
    if (!this.state.error) return this.props.children
    return <div className="relative min-h-[320px] overflow-hidden rounded-[28px] border border-[#e6b7a7] bg-[linear-gradient(145deg,#fff8f3,#f8e5dd)] p-8 text-center shadow-[0_18px_45px_rgba(119,48,42,.12)]">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#8f3f36] text-white shadow-lg"><AlertTriangle size={25} /></div>
      <h2 className="mt-5 text-xl font-black tracking-tight text-[#5e2928]">This workspace could not load</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#87544e]">This view cannot confirm the outcome of a recent action. Check the original receipt or operation in Sales or System Health before retrying a payment or stock change. If the view keeps failing, create a support bundle from System Health.</p>
      <button onClick={() => this.setState({ error: null })} className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#34242d] px-5 text-sm font-extrabold text-white shadow-md transition hover:-translate-y-0.5 hover:bg-[#49313d] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#d88b50]/30"><RefreshCw size={16} />Try again</button>
    </div>
  }
}

function WorkspaceTabDenied({ reason, feature, context = 'restaurant' }) {
  const commercial = reason === 'commercial'
  return (
    <div className="relative flex min-h-[420px] flex-col items-center justify-center overflow-hidden rounded-[28px] border border-[#e6c3b3] bg-[linear-gradient(145deg,#fff8f3,#f8e5dd)] p-8 text-center shadow-[0_18px_45px_rgba(119,48,42,.12)]" data-testid="workspace-tab-denied" data-lock-reason={commercial ? 'commercial' : 'role'}>
      <div className="relative grid h-14 w-14 place-items-center rounded-2xl bg-[#34242d] text-[#f0a35c] shadow-lg"><LockKeyhole size={25} /></div>
      <h2 className="relative mt-5 text-xl font-black tracking-tight text-[#30212a]">{commercial ? 'This operation is not enabled' : 'Role permission required'}</h2>
      <p className="relative mt-2 max-w-md text-sm leading-6 text-[#765f68]">
        {commercial
          ? `This view is outside the current ${context === 'property-outlet' ? 'Lodge' : 'Restaurant & Bar'} package. No operational data has been changed.`
          : 'Your current role does not include this view. A package upgrade will not change role permissions; ask a manager or administrator to update your access.'}
      </p>
    </div>
  )
}

export default function RestaurantWorkspace({ workspace, defaultTab = null, context = 'restaurant', theme = 'restaurant', compactHeader = false, outletId = null, fnbModules = null, returnTo = null }) {
  const [searchParams] = useSearchParams()
  const { settings } = useSettings()
  const access = useAccess()
  const features = useFeatures()
  const barOnly = isBarOnlyMode(settings)
  const isPropertyOutlet = context === 'property-outlet'
  const adapter = CONTEXT_ADAPTERS[context] || CONTEXT_ADAPTERS.restaurant
  // Retain validated outlet scope even when the parent route passes no prop:
  // the URL query is the fallback source, sanitized before use. Server
  // contracts remain the final scope authority.
  const effectiveOutletId = outletId || sanitizeOutletScope(searchParams.get('outlet'))
  const baseDefinition = WORKSPACES[workspace]
  const tabAccessContext = { access, features: features || {} }
  const definition = useMemo(() => {
    if (!baseDefinition) return baseDefinition
    let nextDefinition = baseDefinition
    const allowedTabs = {
      menu: new Set(['menu', 'recipes', 'prep', 'variance']),
      stock: new Set(['stock', 'purchasing', 'suggestions', 'lots']),
      team: new Set(['shifts', 'roster', 'performance', 'tips'])
    }[workspace]
    if (barOnly && allowedTabs) nextDefinition = { ...nextDefinition, tabs: nextDefinition.tabs.filter((tab) => allowedTabs.has(tab.key)) }
    if (!isPropertyOutlet) {
      // Standalone Bar applies the shared per-tab commercial + capability
      // filter to the SAME list used for navigation and direct ?tab=
      // selection. Standalone restaurant mode keeps its existing
      // feature-gate behavior so current operator access is unchanged.
      // candidateTabs preserves the pre-filter list so a denied ?tab=
      // renders an explicit denial instead of silently switching.
      if (barOnly) {
        return {
          ...nextDefinition,
          candidateTabs: nextDefinition.tabs,
          tabs: getVisibleWorkspaceTabs(workspace, nextDefinition.tabs, tabAccessContext)
        }
      }
      return nextDefinition
    }

    const tabs = nextDefinition.tabs
      .filter((tab) => {
        const capabilities = LODGE_TAB_CAPABILITIES[`${workspace}:${tab.key}`] || (tab.capability ? [tab.capability] : [])
        if (!(capabilities.length === 0 || capabilities.some((capability) => canAccessCapability(access, capability)))) return false
        // Progressive activation: hide module-gated tabs while the module is off.
        // No data is deleted; the canonical workflow keeps retained history.
        const requiredModule = LODGE_TAB_MODULES[`${workspace}:${tab.key}`]
        if (requiredModule && fnbModules && fnbModules.get?.(requiredModule)?.enabled !== true) return false
        return true
      })
      .map((tab) => {
        const bridge = LODGE_CANONICAL_TABS[`${workspace}:${tab.key}`]
        if (!bridge) return tab
        return { ...tab, Component: () => <LodgeCanonicalBridge adapter={adapter} bridge={bridge} outletId={outletId} returnTo={returnTo} />, description: bridge.description, nextStep: bridge.action, isCanonicalBridge: true }
      })
    return { ...nextDefinition, tabs }
  }, [access, features, adapter, barOnly, baseDefinition, fnbModules, isPropertyOutlet, outletId, returnTo, workspace])
  const requestedTab = searchParams.get('tab')
  // Standalone Bar resolves against the same filtered list shown in
  // navigation; a denied ?tab= renders an explicit denial, never the child.
  const { tab: activeTab, denied: deniedTab } = useMemo(() => {
    if (!isPropertyOutlet && barOnly && definition) {
      const candidates = definition.candidateTabs || definition.tabs
      return resolveWorkspaceTab(workspace, candidates, requestedTab, defaultTab, tabAccessContext)
    }
    const fallback = definition?.tabs.find((tab) => tab.key === requestedTab) || definition?.tabs.find((tab) => tab.key === defaultTab) || definition?.tabs[0]
    return { tab: fallback || null, denied: null }
  },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [definition, requestedTab, defaultTab, isPropertyOutlet, barOnly, workspace, access, features]
  )

  if (!definition) return null
  // A denied ?tab= still renders the full shell (header + visible-tab nav)
  // with an explicit denial as content. Only zero visible views with no
  // denied request renders the standalone access state.
  if (!activeTab && !deniedTab) {
    if (!isPropertyOutlet && barOnly) {
      // No accessible views: explicit access state instead of a blank page
      // or a lodge module bridge that does not apply here.
      return (
        <div className="restaurant-management-workspace min-h-full bg-transparent px-4 pb-6 pt-3 md:px-6">
          <div className="mx-auto max-w-[1600px]">
            <WorkspaceTabDenied reason={deniedTab?.reason || 'capability'} feature={deniedTab?.tab?.feature} context={context} />
          </div>
        </div>
      )
    }
    return (
      <div className="restaurant-management-workspace min-h-full bg-transparent px-4 pb-6 pt-3 md:px-6">
        <div className="mx-auto max-w-[1600px]">
          <LodgeModuleOffBridge moduleKey={null} returnTo={returnTo} />
        </div>
      </div>
    )
  }
  // deniedTab carries the requested (but not allowed) tab so direct ?tab=
  // tampering renders an explicit denial. viewTab is never null here: the
  // !activeTab branch above already returned, except when a denial exists.
  const viewTab = activeTab || deniedTab?.tab || null
  const ActiveComponent = viewTab?.Component || (() => null)
  const displayTab = viewTab
  const fallbackGuide = TAB_GUIDANCE[displayTab?.key] || [displayTab?.label, definition.description, null]
  const isLodgeTheme = theme === 'lodge'
  const isInventoryWorkspace = workspace === 'stock'
  const basePresentation = WORKSPACE_PRESENTATION[workspace] || WORKSPACE_PRESENTATION.control
  const presentation = barOnly ? {
    ...basePresentation,
    ...(workspace === 'stock' ? {
      eyebrow: 'Bar stock operations',
      title: 'Stock & Purchasing Pro',
      summary: 'Control drink stock, suppliers, deliveries, expiry, transfers and purchasing without adding restaurant complexity.',
      status: 'Bar stock health'
    } : workspace === 'menu' ? {
      eyebrow: 'Bar product costing',
      title: 'Products, recipes & margin',
      summary: 'Cost cocktails and prepared portions, record prep, and investigate ingredient variance.',
      status: 'Bar product control'
    } : workspace === 'team' ? {
      eyebrow: 'Bar workforce operations',
      title: 'Workforce & performance',
      summary: 'Plan cashier and bartender shifts, review attendance, and coach from accountable operating evidence.',
      status: 'Bar workforce'
    } : {})
  } : basePresentation
  const WorkspaceIcon = presentation.Icon
  const contextLabel = isPropertyOutlet ? 'Property food & beverage' : presentation.eyebrow
  const recordNoun = isPropertyOutlet ? 'property outlet' : barOnly ? 'bar' : 'restaurant'
  const shellClass = isLodgeTheme
    ? 'restaurant-management-workspace min-h-full bg-transparent px-4 pb-6 pt-3 md:px-6'
    : 'restaurant-management-workspace min-h-full bg-[radial-gradient(circle_at_top_left,rgba(224,153,93,.13),transparent_30%),linear-gradient(145deg,#f6eee8_0%,#efe4de_55%,#f4ebe6_100%)] p-4 md:p-6'
  const heroClass = isLodgeTheme
    ? 'relative mb-4 overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,#123d38_0%,#17675b_58%,#1f8a70_100%)] px-5 py-6 text-white shadow-[0_20px_44px_rgba(18,77,66,.24)] md:px-7 md:py-7'
    : 'relative mb-4 overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,#261b23_0%,#4b2e38_58%,#764335_100%)] px-5 py-6 text-white shadow-[0_20px_44px_rgba(64,35,46,.24)] md:px-7 md:py-7'
  const iconClass = isLodgeTheme
    ? 'grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/10 text-[#9de3c3] shadow-inner'
    : 'grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/10 text-[#f0a35c] shadow-inner'
  const statusDotClass = isLodgeTheme
    ? 'h-2 w-2 rounded-full bg-[#8ee1ba] shadow-[0_0_0_4px_rgba(142,225,186,.12)]'
    : 'h-2 w-2 rounded-full bg-[#eda25f] shadow-[0_0_0_4px_rgba(237,162,95,.12)]'
  const tabShellClass = isLodgeTheme
    ? 'mb-4 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm'
    : 'mb-5 overflow-x-auto rounded-[20px] border border-[#49303a] bg-[#30212a] p-2 shadow-[0_12px_28px_rgba(58,33,44,.18)]'
  const activeTabClass = isLodgeTheme
    ? 'bg-slate-900 text-white shadow-sm'
    : 'bg-[#e8994e] text-[#2a1c23] shadow-[0_8px_18px_rgba(18,10,14,.2)]'

  return (
    <div className={shellClass}>
      <div className="mx-auto max-w-[1600px]">
        {!compactHeader && <header className={heroClass}>
          <div className="absolute -right-16 -top-24 h-64 w-64 rounded-full border border-white/5 bg-white/5" aria-hidden="true" />
          <div className="absolute bottom-0 right-16 h-24 w-40 bg-[radial-gradient(circle,rgba(236,162,95,.18),transparent_68%)]" aria-hidden="true" />
          <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <div className={iconClass}><WorkspaceIcon size={24} /></div>
              <div className="min-w-0">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-white/60">{contextLabel}</p>
                <h1 className="mt-1 text-2xl font-black tracking-[-0.025em] text-white md:text-3xl">{presentation.title || definition.title}</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-white/70">{presentation.summary || definition.description}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 self-start rounded-2xl border border-white/10 bg-black/10 px-3 py-2 text-xs font-bold text-white/70 md:self-auto">
              <span className={statusDotClass} aria-hidden="true" />
              {presentation.status}
              <span className="text-white/30">•</span>
              {definition.tabs.length} {definition.tabs.length === 1 ? 'view' : 'views'}
            </div>
          </div>
        </header>}
        <nav aria-label={`${definition.title} views`} className={tabShellClass}>
          <div role="tablist" className="flex min-w-max gap-2">
          {definition.tabs.map((tab) => (
            <NavLink
              key={tab.key}
              to={{ search: `?tab=${tab.key}${effectiveOutletId ? `&outlet=${encodeURIComponent(effectiveOutletId)}` : ''}` }}
              role="tab"
              aria-selected={viewTab ? tab.key === viewTab.key : false}
              className={`inline-flex min-h-10 items-center rounded-lg px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-4 ${isLodgeTheme ? 'focus-visible:ring-emerald-200' : 'focus-visible:ring-[#e8994e]/25'} ${viewTab && tab.key === viewTab.key ? activeTabClass : isLodgeTheme ? 'text-slate-600 hover:bg-slate-100 hover:text-slate-900' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
            >
              {tab.label}
            </NavLink>
          ))}
          </div>
        </nav>
        <FeatureGate feature={viewTab?.feature} context={context}>
          <RestaurantWorkspaceErrorBoundary resetKey={`${workspace}:${viewTab?.key}`}>
            {deniedTab
              ? <WorkspaceTabDenied reason={deniedTab.reason} feature={deniedTab.tab?.feature} context={context} />
              : (isPropertyOutlet && !activeTab.isCanonicalBridge
              ? <LodgeWorkspaceGuide description={activeTab.description || fallbackGuide[1]} nextStep={activeTab.nextStep || fallbackGuide[2]} />
              : !isInventoryWorkspace && <RestaurantPageGuide title={viewTab?.label} description={viewTab?.description || fallbackGuide[1]} nextStep={viewTab?.nextStep || fallbackGuide[2]} help={`This guide explains the purpose of the current tab. Actions that change money, stock, or a live order are recorded against the ${recordNoun}.`} />)}
            {!deniedTab && <ActiveComponent workspace={workspace} tabKey={viewTab?.key} contextAdapter={adapter} recipeRoute={isPropertyOutlet ? '/food-beverage/menu' : '/restaurant/menu-production'} outletId={effectiveOutletId} returnTo={returnTo} />}
          </RestaurantWorkspaceErrorBoundary>
        </FeatureGate>
      </div>
    </div>
  )
}

export { WORKSPACES, WORKSPACE_PRESENTATION }
