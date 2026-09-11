import { useMemo } from 'react'
import { NavLink, Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { BarChart3, ChefHat, ClipboardCheck, CookingPot, PackageSearch, ShoppingCart, UsersRound, WalletCards, LayoutGrid, CalendarClock, Sparkles, BedDouble, TicketCheck, ShieldCheck, ReceiptText, LineChart, FlaskConical } from 'lucide-react'
import { useAccess } from '../app-context'
import { canAccessCapability } from '../../../shared/accessControl'
import RestaurantWorkspace from './restaurant/RestaurantWorkspace'
import RestaurantReservations from './restaurant/RestaurantReservations'
import RestaurantTables from './restaurant/RestaurantTables'
import HposFloorPlan from './hospitality-pos/HposFloorPlan'
import FnbOutletContext from './fnb/FnbOutletContext'
import FnbTodayView from './fnb/FnbTodayView'
import FnbModulePanel from './fnb/FnbModulePanel'
import FnbRoomService from './fnb/FnbRoomService'
import FnbMealPlans from './fnb/FnbMealPlans'
import FnbFoodSafety from './fnb/FnbFoodSafety'
import FnbInvoiceMatching from './fnb/FnbInvoiceMatching'
import FnbDemandPlanning from './fnb/FnbDemandPlanning'
import FnbConsolidatedReport from './fnb/FnbConsolidatedReport'
import { useFnbModules } from '../hooks/useFnbModules'

const WORKSPACES = Object.freeze([
  { id: 'today', label: 'Today', icon: Sparkles, description: 'Only what needs action right now: checks, tickets, reservations, stock, and the delivery queue.', capabilities: ['pos.view'], core: true },
  { id: 'floor', label: 'Tables & service', icon: LayoutGrid, description: 'Manage service areas, open checks, and table reservations.', capabilities: ['pos.manage'], core: true },
  { id: 'kitchen', label: 'Kitchen & bar', icon: ChefHat, description: 'Live tickets, prep stations, and service timing.', capabilities: ['pos.manage', 'reports.view'], core: true },
  { id: 'menu', label: 'Recipes & costing', icon: CookingPot, description: 'Menu, modifiers, recipes, prep, yield, and variance.', capabilities: ['pos.menu_manage', 'inventory.manage'], core: true },
  { id: 'stock', label: 'Stock & purchasing', icon: PackageSearch, description: 'Use Lodge Inventory for stock control and the mature purchasing tools for orders, lots, and reorder suggestions.', capabilities: ['inventory.view', 'pos.manage'], core: true },
  { id: 'team', label: 'Outlet team', icon: UsersRound, description: 'Service shifts, roster, performance, tips, and accountability.', capabilities: ['pos.manage', 'staff.view', 'workforce_scheduling.view'], core: true },
  { id: 'close', workspace: 'finance', label: 'Cash & close', icon: WalletCards, description: 'Cash-up review, settlements, table deposits, and outlet close.', capabilities: ['pos.cashup', 'reports.view'], core: true },
  { id: 'control', label: 'Controls', icon: ClipboardCheck, description: 'Opening, closing, safety, exception, and table-service policy controls.', capabilities: ['pos.manage', 'reports.view'], core: true },
  { id: 'room-service', label: 'Room service', icon: BedDouble, description: 'Deliver food and drinks to rooms with runner tracking and folio references.', capabilities: ['pos.manage'], module: 'room-service' },
  { id: 'meal-plans', label: 'Meal plans', icon: TicketCheck, description: 'Serve included meals and vouchers without double-charging the folio.', capabilities: ['pos.manage'], module: 'meal-plans' },
  { id: 'food-safety', label: 'Food safety', icon: ShieldCheck, description: 'Prove cold-chain and hygiene checks with immutable audit evidence.', capabilities: ['pos.manage'], module: 'food-safety' },
  { id: 'invoice-matching', label: 'Invoice matching', icon: ReceiptText, description: 'Match ordered, received, and invoiced quantities before money leaves.', capabilities: ['inventory.manage'], module: 'invoice-matching' },
  { id: 'demand-planning', label: 'Demand planning', icon: LineChart, description: 'Turn occupancy, events, and history into prep and purchase drafts.', capabilities: ['inventory.view'], module: 'demand-planning' },
  { id: 'fnb-reports', label: 'F&B reports', icon: BarChart3, description: 'One server-confirmed view of sales, costs, and covers.', capabilities: ['reports.view'], module: 'fnb-reports' },
  { id: 'more', label: 'More tools', icon: FlaskConical, description: 'Enable advanced modules. Disabled tools stay visible with one clear action.', capabilities: ['pos.view'], core: true }
])

const QUICK_ACTIONS = Object.freeze([
  { to: '/pos', label: 'New order', icon: ShoppingCart, capability: 'pos.manage', primary: true },
  { to: '/food-beverage/floor', label: 'Live floor', icon: LayoutGrid, capability: 'pos.manage' },
  { to: '/inventory?scope=food-beverage', label: 'Inventory', icon: PackageSearch, capability: 'inventory.view' },
  { to: '/reports?tab=pos', label: 'Reports', icon: BarChart3, capability: 'reports.view' }
])

function isModuleEnabled(preferenceMap, moduleKey) {
  if (!moduleKey) return true
  return preferenceMap?.get?.(moduleKey)?.enabled === true
}

function withOutlet(to, outletId) {
  if (!outletId) return to
  const sep = to.includes('?') ? '&' : '?'
  return `${to}${sep}outlet=${encodeURIComponent(outletId)}`
}

export default function LodgeFoodBeverageHub() {
  const { workspace = 'today' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const access = useAccess()
  const { preferenceMap, loading: modulesLoading, error: modulesError, offline: modulesOffline, updatingKey, setPreference } = useFnbModules()
  const outletId = searchParams.get('outlet') || null
  const floorTab = ['live', 'reservations', 'setup'].includes(searchParams.get('tab')) ? searchParams.get('tab') : 'live'
  const reservationsEnabled = isModuleEnabled(preferenceMap, 'reservations')

  const setOutlet = (next) => {
    const nextParams = new URLSearchParams(searchParams)
    if (next) nextParams.set('outlet', next)
    else nextParams.delete('outlet')
    setSearchParams(nextParams, { replace: true })
  }

  const selected = useMemo(() => WORKSPACES.find((item) => item.id === workspace), [workspace])
  const visibleWorkspaces = useMemo(() => WORKSPACES.filter((item) => (
    item.capabilities.some((capability) => canAccessCapability(access, capability))
    && isModuleEnabled(preferenceMap, item.module)
  )), [access, preferenceMap])
  const visibleQuickActions = useMemo(() => QUICK_ACTIONS.filter((item) => (
    canAccessCapability(access, item.capability)
  )), [access])

  if (!selected) return <Navigate to="/food-beverage/today" replace />
  // While preferences are still loading, a module-gated workspace must not
  // redirect away: the enabled state is still unverified. Hold a loading
  // state so direct links to enabled optional modules survive the first load.
  if (selected.module && modulesLoading) {
    return (
      <div className="restaurant-management-workspace lodge-food-beverage-hub min-h-full bg-slate-50">
        <div className="mx-auto max-w-[1600px] p-6 text-sm text-slate-500">Checking module access…</div>
      </div>
    )
  }
  if (!visibleWorkspaces.some((item) => item.id === selected.id)) {
    // A module-gated workspace that is now disabled (or never entitled) falls
    // back to More tools rather than vanishing; history stays reachable there.
    if (selected.module) return <Navigate to="/food-beverage/more" replace />
    const fallback = visibleWorkspaces[0]
    return fallback ? <Navigate to={`/food-beverage/${fallback.id}`} replace /> : <Navigate to="/pos" replace />
  }

  const SelectedIcon = selected.icon
  const openModuleView = (def) => {
    const target = WORKSPACES.find((w) => w.module === def.key)
    if (target) navigate(`/food-beverage/${target.id}${outletId ? `?outlet=${encodeURIComponent(outletId)}` : ''}`)
    else if (def.workspace === 'floor' || def.key === 'reservations') navigate(`/food-beverage/floor?tab=reservations${outletId ? `&outlet=${encodeURIComponent(outletId)}` : ''}`)
    else if (def.workspace) navigate(`/food-beverage/${def.workspace}`)
  }

  const inventoryLink = withOutlet('/inventory?scope=food-beverage&from=food-beverage', outletId)
  const reportsLink = withOutlet('/reports?tab=pos&from=food-beverage', outletId)
  const expensesLink = withOutlet('/expenses?scope=food-beverage&from=food-beverage', outletId)

  return (
    <div className="restaurant-management-workspace lodge-food-beverage-hub min-h-full bg-slate-50">
      <section className="border-b border-slate-200 bg-white px-4 py-4 md:px-6">
        <div className="mx-auto max-w-[1600px]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Lodge operations</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Food &amp; Beverage</h1>
              <p className="mt-1 text-sm text-slate-600">Sell, serve, produce, restock, and close the outlet from one place.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <FnbOutletContext value={outletId} onChange={setOutlet} />
              <div className="grid grid-cols-2 gap-2 sm:flex" aria-label="Food and beverage quick actions">
                {visibleQuickActions.map((item) => {
                  const Icon = item.icon
                  const to = item.to.startsWith('/inventory') ? inventoryLink : item.to.startsWith('/reports') ? reportsLink : item.to
                  return <NavLink key={item.to} to={to} className={`${item.primary ? 'bb-btn-primary' : 'bb-btn-outline'} inline-flex min-h-11 items-center justify-center gap-2`}><Icon size={16} />{item.label}</NavLink>
                })}
              </div>
            </div>
          </div>
        </div>
      </section>
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur md:px-6">
        <nav className="mx-auto flex max-w-[1600px] gap-1 overflow-x-auto" aria-label="Food and beverage workspaces">
          {visibleWorkspaces.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.id}
                to={`/food-beverage/${item.id}${outletId ? `?outlet=${encodeURIComponent(outletId)}` : ''}`}
                className={({ isActive }) => `inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${isActive ? 'bg-emerald-700 text-white shadow-sm' : 'text-slate-600 hover:bg-emerald-50 hover:text-emerald-800'}`}
              >
                <Icon size={16} />{item.label}
              </NavLink>
            )
          })}
        </nav>
      </div>
      <section className="mx-auto flex max-w-[1600px] items-start gap-3 px-4 pb-1 pt-5 md:px-6">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-800"><SelectedIcon size={19} /></span>
        <div>
          <h2 className="text-lg font-bold text-slate-900">{selected.label}</h2>
          <p className="mt-0.5 max-w-3xl text-sm text-slate-600">{selected.description}</p>
        </div>
      </section>
      {selected.id === 'today' ? (
        <div className="mx-auto grid max-w-[1600px] gap-4 p-4 pt-3 md:p-6 md:pt-3">
          <FnbTodayView outletId={outletId} />
          <FnbModulePanel preferenceMap={preferenceMap} updatingKey={updatingKey} error={modulesError} offline={modulesOffline} onToggle={setPreference} onNavigate={openModuleView} />
        </div>
      ) : selected.id === 'more' ? (
        <div className="mx-auto grid max-w-[1600px] gap-4 p-4 pt-3 md:p-6 md:pt-3">
          <FnbModulePanel preferenceMap={preferenceMap} updatingKey={updatingKey} error={modulesError} offline={modulesOffline} onToggle={setPreference} onNavigate={openModuleView} />
        </div>
      ) : selected.id === 'floor' ? (
        <div className="mx-auto max-w-[1600px] p-4 pt-3 md:p-6 md:pt-3">
          <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm" role="tablist" aria-label="Tables and service views">
            <NavLink to={`?tab=live${outletId ? `&outlet=${encodeURIComponent(outletId)}` : ''}`} role="tab" aria-selected={floorTab === 'live'} className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${floorTab === 'live' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><LayoutGrid size={15} /> Live floor</NavLink>
            {reservationsEnabled ? (
              <NavLink to={`?tab=reservations${outletId ? `&outlet=${encodeURIComponent(outletId)}` : ''}`} role="tab" aria-selected={floorTab === 'reservations'} className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${floorTab === 'reservations' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><CalendarClock size={15} /> Reservations</NavLink>
            ) : (
              <NavLink to="/food-beverage/more" role="tab" aria-selected={false} title="Reservations are off — open More tools to enable them" className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-400 hover:bg-slate-100"><CalendarClock size={15} /> Reservations (off)</NavLink>
            )}
            <NavLink to={`?tab=setup${outletId ? `&outlet=${encodeURIComponent(outletId)}` : ''}`} role="tab" aria-selected={floorTab === 'setup'} className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${floorTab === 'setup' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><ClipboardCheck size={15} /> Table setup</NavLink>
          </div>
          {floorTab === 'live' && <HposFloorPlan posRoute="/pos" reservationsRoute="/food-beverage/floor?tab=reservations" contextLabel="Lodge tables & service areas" />}
          {floorTab === 'reservations' && (reservationsEnabled ? <RestaurantReservations /> : <Navigate to="/food-beverage/more" replace />)}
          {floorTab === 'setup' && <RestaurantTables />}
        </div>
      ) : selected.id === 'room-service' ? (
        <div className="mx-auto max-w-[1600px] p-4 pt-3 md:p-6 md:pt-3"><FnbRoomService outletId={outletId} /></div>
      ) : selected.id === 'meal-plans' ? (
        <div className="mx-auto max-w-[1600px] p-4 pt-3 md:p-6 md:pt-3"><FnbMealPlans outletId={outletId} /></div>
      ) : selected.id === 'food-safety' ? (
        <div className="mx-auto max-w-[1600px] p-4 pt-3 md:p-6 md:pt-3"><FnbFoodSafety outletId={outletId} /></div>
      ) : selected.id === 'invoice-matching' ? (
        <div className="mx-auto max-w-[1600px] p-4 pt-3 md:p-6 md:pt-3"><FnbInvoiceMatching outletId={outletId} /></div>
      ) : selected.id === 'demand-planning' ? (
        <div className="mx-auto max-w-[1600px] p-4 pt-3 md:p-6 md:pt-3"><FnbDemandPlanning outletId={outletId} /></div>
      ) : selected.id === 'fnb-reports' ? (
        <div className="mx-auto max-w-[1600px] p-4 pt-3 md:p-6 md:pt-3"><FnbConsolidatedReport outletId={outletId} /></div>
      ) : <RestaurantWorkspace workspace={selected.workspace || selected.id} context="property-outlet" theme="lodge" compactHeader outletId={outletId} fnbModules={preferenceMap} returnTo={`/food-beverage/${selected.id}${outletId ? `?outlet=${encodeURIComponent(outletId)}` : ''}`} />}
      <div className="mx-auto max-w-[1600px] px-4 pb-6 md:px-6">
        <p className="text-[11px] text-slate-400">
          Canonical records stay in their home workflows:
          {' '}<NavLink className="font-semibold text-emerald-700 hover:underline" to={inventoryLink}>Lodge Inventory</NavLink>
          {' · '}<NavLink className="font-semibold text-emerald-700 hover:underline" to={reportsLink}>Lodge Reports</NavLink>
          {' · '}<NavLink className="font-semibold text-emerald-700 hover:underline" to={expensesLink}>Lodge Expenses</NavLink>
          {' · '}<NavLink className="font-semibold text-emerald-700 hover:underline" to="/pos">Outlet POS</NavLink>.
        </p>
      </div>
    </div>
  )
}
