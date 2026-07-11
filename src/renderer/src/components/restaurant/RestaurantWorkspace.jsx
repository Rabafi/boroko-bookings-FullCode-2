import { Component, useMemo } from 'react'
import { NavLink, useSearchParams } from 'react-router-dom'
import { useFeatures } from '../../app-context'

import RestaurantTables from './RestaurantTables'
import RestaurantKitchen from './RestaurantKitchen'
import RestaurantMenu from './RestaurantMenu'
import RestaurantRecipes from './RestaurantRecipes'
import RestaurantStock from './RestaurantStock'
import RestaurantPurchasing from './RestaurantPurchasing'
import RestaurantShifts from './RestaurantShifts'
import RestaurantCashDrawer from './RestaurantCashDrawer'
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
import RestaurantPageGuide from './RestaurantPageGuide'

const WORKSPACES = {
  floor: {
    title: 'Floor & Service',
    description: 'Manage tables, reservations, and the waiting list from one front-of-house workspace.',
    tabs: [
      { key: 'tables', label: 'Live Floor', feature: 'pos', Component: RestaurantTables, description: 'See table status, open a table for a waiter, transfer a running tab, or send the operator to POS.', nextStep: 'Open a table, then add items in POS.' },
      { key: 'reservations', label: 'Reservations', feature: 'pos', Component: RestaurantReservations, description: 'Create, confirm, seat, cancel, or mark table reservations as no-shows.', nextStep: 'Use WhatsApp only for assisted customer communication.' }
    ]
  },
  kitchen: {
    title: 'Kitchen',
    description: 'Run live kitchen service and review station timing without leaving the kitchen workspace.',
    tabs: [
      { key: 'live', label: 'Live Tickets', feature: 'pos', Component: RestaurantKitchen, description: 'Move each ticket through preparation, ready, and served without losing its station routing.', nextStep: 'Mark a ticket ready only when the full station work is complete.' },
      { key: 'stations', label: 'Stations', feature: 'pos', Component: RestaurantStations, description: 'Set up the kitchen, bar, prep, and other stations that receive menu items.', nextStep: 'Assign menu items to a station in Menu & Production.' },
      { key: 'analytics', label: 'Analytics', feature: 'reports', Component: RestaurantKitchenAnalytics, description: 'Review ticket timing and bottlenecks by station.', nextStep: 'Use delays to adjust staffing or menu preparation.' }
    ]
  },
  menu: {
    title: 'Menu & Production',
    description: 'Manage what you sell, how it is priced, and how the kitchen produces it.',
    tabs: [
      { key: 'menu', label: 'Menu & Modifiers', feature: 'pos', Component: RestaurantMenu, description: 'Maintain the items cashiers sell and the choices customers can make.', nextStep: 'Keep unavailable items disabled instead of deleting history.' },
      { key: 'combos', label: 'Combos', feature: 'pos', Component: RestaurantCombos, description: 'Bundle items into meal deals with required and optional selections.', nextStep: 'Test a combo in POS before publishing it to staff.' },
      { key: 'recipes', label: 'Recipes & Costing', feature: 'inventory', Component: RestaurantRecipes, description: 'Link sale items to ingredients so stock and margin remain understandable.', nextStep: 'Review variance after stock counts.' },
      { key: 'prep', label: 'Prep Batches', feature: 'inventory', Component: RestaurantPrepBatches, description: 'Record sauces, dough, marinades, and other prep production.', nextStep: 'Post a batch only after actual yield is counted.' },
      { key: 'variance', label: 'Recipe Variance', feature: 'inventory', Component: RestaurantRecipeVariance, description: 'Compare expected ingredient use to stock movement and counts.', nextStep: 'Investigate variance before adjusting stock.' }
    ]
  },
  stock: {
    title: 'Stock & Purchasing',
    description: 'Keep stock counts, suppliers, purchase orders, and reorder suggestions together.',
    tabs: [
      { key: 'stock', label: 'Stock Control', feature: 'inventory', Component: RestaurantStock, description: 'Review current stock and low-stock risk before service is affected.', nextStep: 'Use Purchasing or Lots & Expiry to resolve risks.' },
      { key: 'purchasing', label: 'Purchasing', feature: 'inventory', Component: RestaurantPurchasing },
      { key: 'suggestions', label: 'Suggestions', feature: 'inventory', Component: RestaurantPurchaseSuggestions }
      ,{ key: 'lots', label: 'Lots & Expiry', feature: 'inventory', Component: RestaurantGrowthControls }
    ]
  },
  team: {
    title: 'Team',
    description: 'See the current shift and review staff accountability in one place.',
    tabs: [
      { key: 'shifts', label: 'Shifts', feature: 'staff', Component: RestaurantShifts },
      { key: 'performance', label: 'Performance', feature: 'staff', Component: RestaurantStaffPerformance }
      ,{ key: 'tips', label: 'Tips & Payouts', feature: 'staff', Component: RestaurantGrowthControls }
    ]
  },
  close: {
    title: 'Cash & Close',
    description: 'Open and reconcile the drawer, close the day, and review the owner summary.',
    tabs: [
      { key: 'drawer', label: 'Cash Drawer', feature: 'pos', Component: RestaurantCashDrawer },
      { key: 'daily-close', label: 'Daily Close', feature: 'reports', Component: RestaurantDailyClose },
      { key: 'digest', label: 'Owner Digest', feature: 'reports', Component: RestaurantOwnerDigest }
      ,{ key: 'commercial', label: 'Settlements', feature: 'reports', Component: RestaurantCommercialControl }
    ]
  },
  control: {
    title: 'Control',
    description: 'Keep opening, closing, cleaning, and exception work visible to the right people.',
    tabs: [
      { key: 'checklists', label: 'Checklists', feature: 'pos', Component: RestaurantChecklists },
      { key: 'alerts', label: 'Alerts', feature: 'reports', Component: RestaurantAlerts }
      ,{ key: 'commercial', label: 'Feedback & Deposits', feature: 'pos', Component: RestaurantCommercialControl }
      ,{ key: 'growth', label: 'Gift Cards & Policies', feature: 'pos', Component: RestaurantGrowthControls }
    ]
  }
}

function FeatureGate({ feature, children }) {
  const features = useFeatures()
  if (Object.keys(features || {}).length > 0 && features[feature] === false) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center p-8 text-center">
        <div className="mb-3 text-4xl">🔒</div>
        <h2 className="text-xl font-bold text-slate-800">Feature unavailable</h2>
        <p className="mt-2 max-w-sm text-sm text-slate-500">This workspace tab is not included in the current restaurant plan.</p>
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
  drawer: ['Cash Drawer', 'Open a float, review expected cash, and close the drawer with a count.', 'Resolve any variance before end-of-day close.'],
  'daily-close': ['Daily Close', 'Check open tables, tickets, shifts, cash, and alerts before closing the day.', 'Resolve every blocker before close.'],
  digest: ['Owner Digest', 'Create a concise operational summary for the restaurant owner.', 'Review exceptions as well as sales.'],
  commercial: ['Commercial Control', 'Reconcile settlements, hold deposits, and record customer feedback.', 'Keep external settlement evidence with its reference.'],
  checklists: ['Checklists', 'Run opening, closing, cleaning, and safety routines consistently.', 'Complete items only after the task is done.'],
  alerts: ['Alerts', 'Review cash, stock, and operational exceptions needing attention.', 'Resolve an alert only after the underlying issue is handled.'],
  growth: ['Gift Cards & Policies', 'Issue stored value and set reservation policy without leaving restaurant mode.', 'Use policies consistently when handling cancellations.']
}

class RestaurantWorkspaceErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidUpdate(previous) { if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }) }
  render() {
    if (!this.state.error) return this.props.children
    return <div className="min-h-[320px] rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
      <h2 className="text-lg font-bold text-red-900">This restaurant workspace could not load</h2>
      <p className="mt-2 text-sm text-red-700">No sale or stock change was made. Try the workspace again; if it repeats, use the support bundle.</p>
      <button onClick={() => this.setState({ error: null })} className="bb-btn-outline mt-5">Try again</button>
    </div>
  }
}

export default function RestaurantWorkspace({ workspace }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const definition = WORKSPACES[workspace]
  const requestedTab = searchParams.get('tab')
  const activeTab = useMemo(
    () => definition?.tabs.find((tab) => tab.key === requestedTab) || definition?.tabs[0],
    [definition, requestedTab]
  )

  if (!definition || !activeTab) return null
  const ActiveComponent = activeTab.Component
  const fallbackGuide = TAB_GUIDANCE[activeTab.key] || [activeTab.label, definition.description, null]

  return (
    <div className="min-h-full bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-[1600px]">
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Restaurant workspace</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{definition.title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">{definition.description}</p>
        </div>
        <div className="mb-5 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          {definition.tabs.map((tab) => (
            <NavLink
              key={tab.key}
              to={{ search: `?tab=${tab.key}` }}
              onClick={() => setSearchParams({ tab: tab.key })}
              className={({ isActive }) => `rounded-xl px-3 py-2 text-sm font-semibold transition ${
                (isActive || tab.key === activeTab.key) ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
        <FeatureGate feature={activeTab.feature}>
          <RestaurantWorkspaceErrorBoundary resetKey={`${workspace}:${activeTab.key}`}>
            <RestaurantPageGuide title={activeTab.label} description={activeTab.description || fallbackGuide[1]} nextStep={activeTab.nextStep || fallbackGuide[2]} help="This guide explains the purpose of the current tab. Actions that change money, stock, or a live order are recorded against the restaurant." />
            <ActiveComponent workspace={workspace} tabKey={activeTab.key} />
          </RestaurantWorkspaceErrorBoundary>
        </FeatureGate>
      </div>
    </div>
  )
}

export { WORKSPACES }
