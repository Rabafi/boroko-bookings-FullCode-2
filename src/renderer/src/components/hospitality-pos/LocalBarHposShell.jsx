// @ts-check
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router'
import { APP_FEATURES, buildCapabilitySnapshot } from '../../../../shared/accessControl.js'
import { AccessContext, AuthContext, FeaturesContext, OnlineRequestsContext, ProfilesContext, SettingsContext, UnsavedChangesContext } from '../../app-context.jsx'
import BarLocalWorkspace from './BarLocalWorkspace.jsx'
import Login from '../Login.jsx'
import BarLocalNativeMenu from './BarLocalNativeMenu.jsx'

const HposLayout = lazy(() => import('./HposLayout.jsx'))

function LocalBarLoading() {
  return <div className="p-8 text-sm text-slate-600" role="status">Loading Bar workspace…</div>
}

function LocalBarRouteUnavailable() {
  return <section className="m-6 rounded-2xl border border-amber-300 bg-amber-50 p-6 text-amber-950" role="status">
    <h1 className="text-lg font-bold">This screen is not available in local Bar mode</h1>
    <p className="mt-2 text-sm">Choose Sell, Menu, Stock, Open tabs, Cash &amp; close, Sales, or System health. This action has not been sent anywhere.</p>
    <a className="mt-4 inline-flex rounded bg-amber-700 px-4 py-2 font-semibold text-white" href="#/hpos/pos">Go to Sell</a>
  </section>
}

/** @param {{status: Record<string, unknown>, onLogout: () => void, initialLoginNotice?: string}} props */
export default function LocalBarHposShell({ status, onLogout, initialLoginNotice = '' }) {
  const [session, setSession] = useState(status.session ?? null)
  const [bootstrap, setBootstrap] = useState(null)
  const [bootstrapError, setBootstrapError] = useState('')
  const handleLocalLogout = useCallback(() => { setSession(null); onLogout() }, [onLogout])
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
    return {
      ...base,
      capabilities,
      effectiveCapabilities: capabilities,
      capabilityOverrides: {},
      entitlement: { product_id: 'hospitality-pos', enterprise_addons: [] },
      allowedOutletIds: localUser?.allowed_outlet_ids || [],
      refreshEntitlement: async () => null
    }
  }, [localUser, capabilityNames.join('|')])
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
    currency: String(business.currency || status.currency || 'BWP'),
    timezone: String(business.timezone || '')
  }), [businessId, business.name, business.currency, business.timezone, status.business_name, status.active_outlet_id, status.active_outlet_name, status.currency, outlet.id, outlet.name, session?.outlet_id])
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
  const statusWithSession = useMemo(() => ({ ...status, session }), [status, session])

  return <AuthContext.Provider value={authValue}>
    <ProfilesContext.Provider value={localProfiles}>
      <AccessContext.Provider value={localAccess}>
        <FeaturesContext.Provider value={localFeatures}>
          <OnlineRequestsContext.Provider value={{ count: 0, requests: [], refresh: () => {} }}>
            <SettingsContext.Provider value={{ settings: localSettings, setSettings: () => {} }}>
              <UnsavedChangesContext.Provider value={emptyUnsaved}>
                <HashRouter>
                  {!session ? <div className="min-h-screen bg-slate-50">
                    {initialLoginNotice && <div role="status" className="mx-auto max-w-xl px-4 pt-5 text-sm text-emerald-800">{initialLoginNotice}</div>}
                    <Login />
                  </div> : <Suspense fallback={<LocalBarLoading />}>
                    <Routes>
                      <Route element={<HposLayout />}>
                        <Route index element={<Navigate to="/hpos/pos" replace />} />
                        <Route path="hpos" element={<Navigate to="/hpos/pos" replace />} />
                        <Route path="hpos/pos" element={<BarLocalWorkspace status={statusWithSession} onLogout={handleLocalLogout} embeddedShell embeddedPanel="counter" />} />
                        <Route path="hpos/menu" element={<BarLocalNativeMenu />} />
                        <Route path="hpos/stock" element={<BarLocalWorkspace status={statusWithSession} onLogout={handleLocalLogout} embeddedShell embeddedPanel="stock" />} />
                        <Route path="hpos/checks" element={<BarLocalWorkspace status={statusWithSession} onLogout={handleLocalLogout} embeddedShell embeddedPanel="tabs" />} />
                        <Route path="hpos/cash" element={<BarLocalWorkspace status={statusWithSession} onLogout={handleLocalLogout} embeddedShell embeddedPanel="drawer" />} />
                        <Route path="hpos/shared-cashup" element={<BarLocalWorkspace status={statusWithSession} onLogout={handleLocalLogout} embeddedShell embeddedPanel="cashup" />} />
                        <Route path="hpos/my-cashup" element={<BarLocalWorkspace status={statusWithSession} onLogout={handleLocalLogout} embeddedShell embeddedPanel="cashup" />} />
                        <Route path="hpos/shift-close" element={<BarLocalWorkspace status={statusWithSession} onLogout={handleLocalLogout} embeddedShell embeddedPanel="cashup" />} />
                        <Route path="hpos/my-shift" element={<BarLocalWorkspace status={statusWithSession} onLogout={handleLocalLogout} embeddedShell embeddedPanel="operations" embeddedOperationsTab="workforce" />} />
                        <Route path="hpos/attendance" element={<BarLocalWorkspace status={statusWithSession} onLogout={handleLocalLogout} embeddedShell embeddedPanel="operations" embeddedOperationsTab="workforce" />} />
                        <Route path="hpos/team" element={<BarLocalWorkspace status={statusWithSession} onLogout={handleLocalLogout} embeddedShell embeddedPanel="operations" embeddedOperationsTab="workforce" />} />
                        <Route path="hpos/my-sales" element={<BarLocalWorkspace status={statusWithSession} onLogout={handleLocalLogout} embeddedShell embeddedPanel="reports" />} />
                        <Route path="hpos/sale-correction" element={<BarLocalWorkspace status={statusWithSession} onLogout={handleLocalLogout} embeddedShell embeddedPanel="returns" />} />
                        <Route path="hpos/reports" element={<BarLocalWorkspace status={statusWithSession} onLogout={handleLocalLogout} embeddedShell embeddedPanel="reports" />} />
                        <Route path="hpos/expenses" element={<BarLocalWorkspace status={statusWithSession} onLogout={handleLocalLogout} embeddedShell embeddedPanel="operations" embeddedOperationsTab="accounting" />} />
                        <Route path="hpos/customers" element={<BarLocalWorkspace status={statusWithSession} onLogout={handleLocalLogout} embeddedShell embeddedPanel="operations" embeddedOperationsTab="customers" />} />
                        <Route path="hpos/growth-tools" element={<BarLocalWorkspace status={statusWithSession} onLogout={handleLocalLogout} embeddedShell embeddedPanel="operations" embeddedOperationsTab="customers" />} />
                        <Route path="hpos/control" element={<BarLocalWorkspace status={statusWithSession} onLogout={handleLocalLogout} embeddedShell embeddedPanel="operations" embeddedOperationsTab="control" />} />
                        <Route path="hpos/business-control" element={<BarLocalWorkspace status={statusWithSession} onLogout={handleLocalLogout} embeddedShell embeddedPanel="reports" />} />
                        <Route path="hpos/manage" element={<BarLocalWorkspace status={statusWithSession} onLogout={handleLocalLogout} embeddedShell embeddedPanel="operations" />} />
                        <Route path="hpos/system-health" element={<BarLocalWorkspace status={statusWithSession} onLogout={handleLocalLogout} embeddedShell embeddedPanel="admin" />} />
                        <Route path="hpos/setup-readiness" element={<BarLocalWorkspace status={statusWithSession} onLogout={handleLocalLogout} embeddedShell embeddedPanel="admin" />} />
                        <Route path="settings" element={<BarLocalWorkspace status={statusWithSession} onLogout={handleLocalLogout} embeddedShell embeddedPanel="settings" />} />
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
