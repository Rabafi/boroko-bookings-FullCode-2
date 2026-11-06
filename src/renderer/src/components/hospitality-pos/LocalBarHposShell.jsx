// @ts-check
import { lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router'
import { APP_FEATURES, buildCapabilitySnapshot } from '../../../../shared/accessControl.js'
import { BAR_POS_ADDON_CATALOG } from '../../../../shared/commercialEntitlements.js'
import { AccessContext, AuthContext, FeaturesContext, OnlineRequestsContext, ProfilesContext, SettingsContext, UnsavedChangesContext } from '../../app-context.jsx'
import Login from '../Login.jsx'

const HposLayout = lazy(() => import('./HposLayout.jsx'))
const HposManageHub = lazy(() => import('./HposManageHub.jsx'))
const HposMenu = lazy(() => import('./HposMenu.jsx'))
const HposStock = lazy(() => import('./HposStock.jsx'))
const HposTerminal = lazy(() => import('./HposTerminal.jsx'))
const HposOpenChecks = lazy(() => import('./HposOpenChecks.jsx'))
const HposCashClose = lazy(() => import('./HposCashClose.jsx'))
const HposMyCashup = lazy(() => import('./HposMyCashup.jsx'))
const HposSharedShiftClose = lazy(() => import('./HposSharedShiftClose.jsx'))
const HposTeam = lazy(() => import('./HposTeam.jsx'))
const HposMyShift = lazy(() => import('./HposMyShift.jsx'))
const HposMySales = lazy(() => import('./HposMySales.jsx'))
const HposReports = lazy(() => import('./HposReports.jsx'))
const HposExpenses = lazy(() => import('./HposExpenses.jsx'))
const HposCustomers = lazy(() => import('./HposCustomers.jsx'))
const HposControl = lazy(() => import('./HposControl.jsx'))
const HposSystemHealth = lazy(() => import('./HposSystemHealth.jsx'))
const HposSetupReadiness = lazy(() => import('./HposSetupReadiness.jsx'))
const Settings = lazy(() => import('../Settings.jsx'))
const Staff = lazy(() => import('../Staff.jsx'))
const RestaurantChartOfAccounts = lazy(() => import('../restaurant-accounting/RestaurantChartOfAccounts.jsx'))
const RestaurantGeneralLedger = lazy(() => import('../restaurant-accounting/RestaurantGeneralLedger.jsx'))
const RestaurantAccountsPayable = lazy(() => import('../restaurant-accounting/RestaurantAccountsPayable.jsx'))
const RestaurantBankReconciliation = lazy(() => import('../restaurant-accounting/RestaurantBankReconciliation.jsx'))
const RestaurantWorkspace = lazy(() => import('../restaurant/RestaurantWorkspace.jsx'))
const RestaurantInventoryLots = lazy(() => import('../restaurant/RestaurantInventoryLots.jsx'))
const RestaurantPurchasing = lazy(() => import('../restaurant/RestaurantPurchasing.jsx'))
const RestaurantPurchaseSuggestions = lazy(() => import('../restaurant/RestaurantPurchaseSuggestions.jsx'))

/** @param {{addonKey: string, children: import('react').ReactNode}} props */
function LocalBarAddonGate({ addonKey, children }) {
  const access = useContext(AccessContext)
  const enabled = Array.isArray(access?.entitlement?.enterprise_addons)
    && access.entitlement.enterprise_addons.includes(addonKey)
  if (enabled) return children
  return <section className="m-6 max-w-3xl rounded-xl border border-amber-300 bg-amber-50 p-6 text-amber-950" role="status">
    <h1 className="text-lg font-bold">This add-on is not enabled for this Bar</h1>
    <p className="mt-2 text-sm">The local Bar database does not report the required add-on grant. Contact your administrator to review the saved Bar entitlement.</p>
    <a className="mt-4 inline-flex rounded bg-amber-700 px-4 py-2 font-semibold text-white" href="#/hpos/manage">Open Manage</a>
  </section>
}

function LocalBarLoading() {
  return <div className="p-8 text-sm text-slate-600" role="status">Loading Bar workspace…</div>
}

function LocalBarRouteUnavailable({ area = 'This screen' }) {
  return <section className="m-6 rounded-2xl border border-amber-300 bg-amber-50 p-6 text-amber-950" role="status">
    <h1 className="text-lg font-bold">{area} is not available in local Bar mode yet</h1>
    <p className="mt-2 text-sm">This screen has no verified local database workflow yet. Its hosted data/actions are disabled here, and no request was sent. The original cloud Restaurant screen remains unchanged.</p>
    <a className="mt-4 inline-flex rounded bg-amber-700 px-4 py-2 font-semibold text-white" href="#/hpos/pos">Go to Sell</a>
  </section>
}

/** @param {{status: Record<string, unknown>, onLogout: () => void, initialLoginNotice?: string}} props */
export default function LocalBarHposShell({ status, onLogout, initialLoginNotice = '' }) {
  const [session, setSession] = useState(status.session ?? null)
  const [postSetupNoticePending, setPostSetupNoticePending] = useState(status.post_setup_notice_pending === true)
  const [bootstrap, setBootstrap] = useState(null)
  const [bootstrapError, setBootstrapError] = useState('')
  const handleLocalLogout = useCallback(() => { setSession(null); onLogout() }, [onLogout])
  const refreshLocalBootstrap = useCallback(async () => {
    const result = await window.api.barLocal.query('bootstrap', {})
    if (!result || result.complete !== true || !result.data || typeof result.data !== 'object') {
      throw new Error('The local Bar service returned incomplete business and entitlement details.')
    }
    setBootstrap(result.data)
    setBootstrapError('')
    return result.data
  }, [])
  useEffect(() => {
    let active = true
    setBootstrap(null)
    setBootstrapError('')
    if (!session?.staff?.staff_id || !Array.isArray(session.staff.capabilities) || !session.staff.capabilities.includes('pos.view')) return () => { active = false }
    window.api.barLocal.query('bootstrap', {}).then((result) => {
      if (active) setBootstrap(result?.data || null)
    }).catch((error) => {
      if (active) setBootstrapError(error?.message || 'Local Bar business details are unavailable.')
    })
    return () => { active = false }
  }, [session?.staff?.staff_id, session?.staff?.capabilities])
  const staff = session?.staff && typeof session.staff === 'object' ? session.staff : null
  const capabilityNames = Array.isArray(staff?.capabilities)
    ? staff.capabilities.filter((name) => typeof name === 'string') : []
  const localUser = useMemo(() => staff ? ({
    id: String(staff.staff_id || ''),
    email: typeof staff.email === 'string' ? staff.email : null,
    name: String(staff.display_name || 'Bar staff'),
    role: String(staff.role || 'cashier'),
    lodge_id: String(bootstrap?.scope?.business_id || status.business_id || ''),
    capability_overrides: {},
    allowed_outlet_ids: [String(session?.outlet_id || status.active_outlet_id || '')].filter(Boolean),
    localAuthority: true
  }) : null, [staff, session?.business_id, session?.outlet_id, status.business_id, status.active_outlet_id, bootstrap?.scope?.business_id])
  const localAccess = useMemo(() => {
    const base = buildCapabilitySnapshot({ role: localUser?.role || 'cashier', productId: 'hospitality-pos' })
    const capabilities = Object.fromEntries(Object.keys(base.capabilities).map((name) => [name, capabilityNames.includes(name)]))
    const features = bootstrap?.authority?.entitlement_features
    const enabled = new Set(Array.isArray(features) ? features.filter((entry) => typeof entry === 'string') : [])
    if (features && !Array.isArray(features) && typeof features === 'object') {
      for (const [feature, active] of Object.entries(features)) if (active === true) enabled.add(feature)
    }
    const addonGranted = (addon) => enabled.has(addon.addonKey)
      || (addon.includedFeatures.length > 0 && addon.includedFeatures.every((feature) => enabled.has(feature)))
    const enterpriseAddons = BAR_POS_ADDON_CATALOG
      .filter(addonGranted)
      .filter((addon) => addon.requiredAddonKeys.every((key) => {
        const dependency = BAR_POS_ADDON_CATALOG.find((candidate) => candidate.addonKey === key)
        return dependency ? addonGranted(dependency) : false
      }))
      .map((addon) => addon.addonKey)
    return {
      ...base,
      capabilities,
      effectiveCapabilities: capabilities,
      capabilityOverrides: {},
      entitlement: { product_id: 'hospitality-pos', commercial_package_key: 'bar_pos', enterprise_addons: enterpriseAddons },
      allowedOutletIds: localUser?.allowed_outlet_ids || [],
      refreshEntitlement: refreshLocalBootstrap
    }
  }, [localUser, capabilityNames.join('|'), bootstrap?.authority?.entitlement_features, refreshLocalBootstrap])
  const business = bootstrap?.business || {}
  const outlet = bootstrap?.outlet || {}
  const businessId = String(business.id || bootstrap?.scope?.business_id || status.business_id || '')
  const localSettings = useMemo(() => ({
    product_id: 'hospitality-pos',
    authority_mode: 'bar_local',
    can_switch_business: status.workspace_isolation === 'dedicated_bar' || status.can_switch_workspace === true,
    id: businessId,
    lodge_id: businessId,
    business_name: String(business.name || status.business_name || 'Bar'),
    property_type: 'bar',
    hospitality_mode: 'bar_only',
    outlet_id: String(outlet.id || session?.outlet_id || status.active_outlet_id || ''),
    outlet_name: String(outlet.name || status.active_outlet_name || 'Bar'),
    cash_model: String(bootstrap?.settings?.cash_model?.value || 'personal'),
    currency: String(business.currency || status.currency || 'BWP'),
    timezone: String(business.timezone || '')
  }), [businessId, business.name, business.currency, business.timezone, status.business_name, status.active_outlet_id, status.active_outlet_name, status.currency, outlet.id, outlet.name, session?.outlet_id, bootstrap?.settings?.cash_model?.value])
  const authValue = useMemo(() => ({
    user: localUser,
    login: async (result) => {
      const nextSession = result?.session
      if (!nextSession?.staff || !nextSession?.outlet_id) {
        throw new Error('The local Bar service returned an incomplete staff session. Sign-in was not completed.')
      }
      setSession(nextSession)
      return nextSession.staff
    },
    logout: async () => {
      await window.api.barLocal.logout()
      handleLocalLogout()
      return null
    }
  }), [localUser, handleLocalLogout])
  const localProfile = useMemo(() => businessId ? ({
    lodge_id: businessId,
    lodge_name: String(business.name || status.business_name || 'Bar'),
    business_name: String(business.name || status.business_name || 'Bar'),
    property_type: 'bar',
    product_id: 'hospitality-pos',
    authority_mode: 'bar_local',
    status: 'ready'
  }) : null, [businessId, business.name, status.business_name])
  const localProfiles = useMemo(() => ({
    profiles: localProfile ? [localProfile] : [],
    activeProfile: localProfile,
    loading: Boolean(session && !bootstrap && !bootstrapError),
    profilesLoading: Boolean(session && !bootstrap && !bootstrapError),
    reloadProfiles: async () => localProfile ? [localProfile] : [],
    selectProfile: async (profileId) => String(profileId) === businessId ? localProfile : null,
    createDraftProfile: async () => { throw new Error('Create or switch businesses from the Hospitality POS business chooser.') },
    removeDraftProfile: async () => null
  }), [localProfile, session, bootstrap, bootstrapError, businessId])
  const localFeatures = useMemo(() => {
    const features = bootstrap?.authority?.entitlement_features
    const enabled = new Set(Array.isArray(features) ? features.filter((entry) => typeof entry === 'string') : [])
    const featureMap = Object.fromEntries(APP_FEATURES.map((feature) => [feature, enabled.has(feature)]))
    if (features && !Array.isArray(features) && typeof features === 'object') {
      for (const feature of APP_FEATURES) featureMap[feature] = features[feature] === true
    }
    return featureMap
  }, [bootstrap?.authority?.entitlement_features])
  const emptyUnsaved = useMemo(() => ({ isDirty: false, confirmLeave: null }), [])
  const ownerSignInNotice = initialLoginNotice || (postSetupNoticePending
    ? 'Your Bar is ready. Sign in with the owner email and password you chose during setup.'
    : '')

  return <AuthContext.Provider value={authValue}>
    <ProfilesContext.Provider value={localProfiles}>
      <AccessContext.Provider value={localAccess}>
        <FeaturesContext.Provider value={localFeatures}>
          <OnlineRequestsContext.Provider value={{ count: 0, requests: [], refresh: () => {} }}>
            <SettingsContext.Provider value={{ settings: localSettings, setSettings: () => {} }}>
              <UnsavedChangesContext.Provider value={emptyUnsaved}>
                <HashRouter>
                  {!session ? <div className="min-h-screen bg-slate-50">
                    <Login
                      initialLoginNotice={ownerSignInNotice}
                      initialStaffId={status.training === true ? String(status.setup_owner_staff_id || '') : ''}
                      consumeLocalSetupNotice={postSetupNoticePending}
                      onLocalSetupNoticeConsumed={() => setPostSetupNoticePending(false)}
                    />
                  </div> : <Suspense fallback={<LocalBarLoading />}>
                    <Routes>
                      <Route element={<HposLayout />}>
                        <Route index element={<Navigate to="/hpos/pos" replace />} />
                        <Route path="hpos" element={<Navigate to="/hpos/pos" replace />} />
                        <Route path="hpos/pos" element={<HposTerminal />} />
                        <Route path="hpos/" element={<HposTerminal />} />
                        <Route path="hpos/floor" element={<LocalBarRouteUnavailable area="Floor & tables" />} />
                        <Route path="hpos/service" element={<LocalBarRouteUnavailable area="Reservations & waitlist" />} />
                        <Route path="hpos/kitchen" element={<LocalBarRouteUnavailable area="Kitchen display" />} />
                        <Route path="hpos/menu" element={<HposMenu />} />
                        <Route path="hpos/stock" element={<HposStock />} />
                        <Route path="hpos/checks" element={<HposOpenChecks />} />
                        <Route path="hpos/cash" element={<HposCashClose />} />
                        <Route path="hpos/shared-cashup" element={<HposSharedShiftClose />} />
                        <Route path="hpos/my-cashup" element={<HposMyCashup />} />
                        <Route path="hpos/shift-close" element={<HposSharedShiftClose />} />
                        <Route path="hpos/my-shift" element={<HposMyShift localAuthority />} />
                        <Route path="hpos/attendance" element={<Navigate to="/hpos/shift-close" replace />} />
                        <Route path="hpos/team" element={<HposTeam />} />
                        <Route path="hpos/my-sales" element={<HposMySales />} />
                        <Route path="pos/customer-display" element={<LocalBarRouteUnavailable area="Customer display" />} />
                        <Route path="pos/bar-display" element={<LocalBarRouteUnavailable area="Bar display" />} />
                        <Route path="hpos/sale-correction" element={<HposReports correctionMode />} />
                        <Route path="hpos/reports" element={<HposReports />} />
                        <Route path="hpos/expenses" element={<HposExpenses />} />
                        <Route path="hpos/customers" element={<HposCustomers />} />
                        <Route path="hpos/growth-tools" element={<LocalBarAddonGate addonKey="bar_growth_multi_outlet"><LocalBarRouteUnavailable area="Growth tools" /></LocalBarAddonGate>} />
                        <Route path="hpos/control" element={<HposControl />} />
                        <Route path="hpos/business-control" element={<LocalBarRouteUnavailable area="Business Control" />} />
                        <Route path="hpos/manage" element={<HposManageHub />} />
                        <Route path="hpos/system-health" element={<HposSystemHealth />} />
                        <Route path="hpos/setup-readiness" element={<HposSetupReadiness />} />
                        <Route path="staff" element={<Staff />} />
                        <Route path="restaurant/inventory" element={<LocalBarAddonGate addonKey="bar_stock_purchasing_pro"><RestaurantWorkspace workspace="stock" defaultTab="stock" enabledTabs={['stock', 'purchasing', 'suggestions']} /></LocalBarAddonGate>} />
                        <Route path="restaurant/stock-purchasing" element={<Navigate to="/restaurant/inventory" replace />} />
                        <Route path="restaurant/stock" element={<Navigate to="/hpos/stock" replace />} />
                        <Route path="restaurant/floor" element={<Navigate to="/hpos/floor" replace />} />
                        <Route path="restaurant/floor-workspace" element={<LocalBarRouteUnavailable area="Floor & tables" />} />
                        <Route path="restaurant/kitchen-workspace" element={<LocalBarRouteUnavailable area="Kitchen workspace" />} />
                        <Route path="restaurant/kitchen" element={<Navigate to="/hpos/kitchen" replace />} />
                        <Route path="restaurant/menu" element={<Navigate to="/hpos/menu" replace />} />
                        <Route path="restaurant/menu-production" element={<LocalBarAddonGate addonKey="bar_stock_purchasing_pro"><LocalBarRouteUnavailable area="Stock Pro" /></LocalBarAddonGate>} />
                        <Route path="restaurant/recipes" element={<LocalBarAddonGate addonKey="bar_stock_purchasing_pro"><LocalBarRouteUnavailable area="Stock Pro" /></LocalBarAddonGate>} />
                        <Route path="restaurant/combos" element={<LocalBarAddonGate addonKey="bar_stock_purchasing_pro"><LocalBarRouteUnavailable area="Stock Pro" /></LocalBarAddonGate>} />
                        <Route path="restaurant/recipe-variance" element={<LocalBarAddonGate addonKey="bar_stock_purchasing_pro"><LocalBarRouteUnavailable area="Stock Pro" /></LocalBarAddonGate>} />
                        <Route path="restaurant/prep-batches" element={<LocalBarAddonGate addonKey="bar_stock_purchasing_pro"><LocalBarRouteUnavailable area="Stock Pro" /></LocalBarAddonGate>} />
                        <Route path="restaurant/purchasing" element={<LocalBarAddonGate addonKey="bar_stock_purchasing_pro"><RestaurantPurchasing /></LocalBarAddonGate>} />
                        <Route path="restaurant/lots-expiry" element={<LocalBarAddonGate addonKey="bar_stock_purchasing_pro"><RestaurantInventoryLots /></LocalBarAddonGate>} />
                        <Route path="restaurant/purchase-suggestions" element={<LocalBarAddonGate addonKey="bar_stock_purchasing_pro"><RestaurantPurchaseSuggestions /></LocalBarAddonGate>} />
                        <Route path="restaurant/team" element={<Navigate to="/restaurant/team-workspace" replace />} />
                        <Route path="restaurant/team-workspace" element={<LocalBarAddonGate addonKey="bar_accounting_workforce"><LocalBarRouteUnavailable area="Accounting & Workforce" /></LocalBarAddonGate>} />
                        <Route path="restaurant/shifts" element={<Navigate to="/hpos/team" replace />} />
                        <Route path="restaurant/cash-drawer" element={<Navigate to="/hpos/cash" replace />} />
                        <Route path="restaurant/daily-close" element={<Navigate to="/restaurant/finance-close?tab=daily-close" replace />} />
                        <Route path="restaurant/staff-performance" element={<LocalBarAddonGate addonKey="bar_accounting_workforce"><LocalBarRouteUnavailable area="Accounting & Workforce" /></LocalBarAddonGate>} />
                        <Route path="restaurant/control" element={<Navigate to="/restaurant/control-workspace" replace />} />
                        <Route path="restaurant/control-workspace" element={<LocalBarRouteUnavailable area="Control workspace" />} />
                        <Route path="restaurant/tables" element={<Navigate to="/hpos/floor" replace />} />
                        <Route path="restaurant/reservations" element={<LocalBarRouteUnavailable area="Reservations" />} />
                        <Route path="restaurant/stations" element={<LocalBarRouteUnavailable area="Kitchen stations" />} />
                        <Route path="restaurant/kitchen-analytics" element={<LocalBarRouteUnavailable area="Kitchen analytics" />} />
                        <Route path="restaurant/checklists" element={<Navigate to="/hpos/control" replace />} />
                        <Route path="restaurant/alerts" element={<Navigate to="/hpos/control" replace />} />
                        <Route path="restaurant/customers" element={<Navigate to="/hpos/customers" replace />} />
                        <Route path="restaurant/owner-digest" element={<Navigate to="/restaurant/finance-close?tab=owner-review" replace />} />
                        <Route path="restaurant/chart-of-accounts" element={<LocalBarAddonGate addonKey="bar_accounting_workforce"><RestaurantChartOfAccounts /></LocalBarAddonGate>} />
                        <Route path="restaurant/general-ledger" element={<LocalBarAddonGate addonKey="bar_accounting_workforce"><RestaurantGeneralLedger /></LocalBarAddonGate>} />
                        <Route path="restaurant/accounts-payable" element={<LocalBarAddonGate addonKey="bar_accounting_workforce"><RestaurantAccountsPayable /></LocalBarAddonGate>} />
                        <Route path="restaurant/bank-reconciliation" element={<LocalBarAddonGate addonKey="bar_accounting_workforce"><RestaurantBankReconciliation /></LocalBarAddonGate>} />
                        <Route path="restaurant/tax-returns" element={<LocalBarAddonGate addonKey="bar_accounting_workforce"><LocalBarRouteUnavailable area="Accounting Pro" /></LocalBarAddonGate>} />
                        <Route path="restaurant/budgets" element={<LocalBarAddonGate addonKey="bar_accounting_workforce"><LocalBarRouteUnavailable area="Accounting Pro" /></LocalBarAddonGate>} />
                        <Route path="restaurant/balance-sheet" element={<LocalBarAddonGate addonKey="bar_accounting_workforce"><LocalBarRouteUnavailable area="Accounting Pro" /></LocalBarAddonGate>} />
                        <Route path="restaurant/payroll" element={<LocalBarAddonGate addonKey="bar_accounting_workforce"><LocalBarRouteUnavailable area="Accounting Pro" /></LocalBarAddonGate>} />
                        <Route path="restaurant/tips" element={<Navigate to="/restaurant/finance-close?tab=tips" replace />} />
                        <Route path="restaurant/settlements" element={<Navigate to="/restaurant/finance-close?tab=settlements" replace />} />
                        <Route path="restaurant/feedback-deposits" element={<Navigate to="/restaurant/finance-close?tab=customer-funds" replace />} />
                        <Route path="restaurant/gift-cards-policies" element={<Navigate to="/restaurant/finance-close?tab=customer-funds" replace />} />
                        <Route path="restaurant/outlet-control" element={<LocalBarAddonGate addonKey="bar_growth_multi_outlet"><LocalBarRouteUnavailable area="Multi-outlet control" /></LocalBarAddonGate>} />
                        <Route path="multi-outlet-pos" element={<Navigate to="/restaurant/outlet-control" replace />} />
                        <Route path="restaurant/finance-close" element={<LocalBarAddonGate addonKey="bar_accounting_workforce"><LocalBarRouteUnavailable area="Finance & close" /></LocalBarAddonGate>} />
                        <Route path="restaurant/cash-close" element={<Navigate to="/restaurant/finance-close?tab=cashups" replace />} />
                        <Route path="restaurant/accounting-setup" element={<LocalBarAddonGate addonKey="bar_accounting_workforce"><LocalBarRouteUnavailable area="Accounting Pro" /></LocalBarAddonGate>} />
                        <Route path="data-management" element={<Navigate to="/hpos/manage" replace />} />
                        <Route path="settings" element={<Settings />} />
                        <Route path="*" element={<LocalBarRouteUnavailable />} />
                      </Route>
                    </Routes>
                  </Suspense>}
                </HashRouter>
              </UnsavedChangesContext.Provider>
            </SettingsContext.Provider>
          </OnlineRequestsContext.Provider>
        </FeaturesContext.Provider>
      </AccessContext.Provider>
    </ProfilesContext.Provider>
  </AuthContext.Provider>
}
