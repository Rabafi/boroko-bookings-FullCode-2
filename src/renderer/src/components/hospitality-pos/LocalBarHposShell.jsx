// @ts-check
import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router'
import { APP_FEATURES, buildCapabilitySnapshot } from '../../../../shared/accessControl.js'
import { AccessContext, AuthContext, FeaturesContext, OnlineRequestsContext, ProfilesContext, SettingsContext, UnsavedChangesContext } from '../../app-context.jsx'
import BarLocalWorkspace from './BarLocalWorkspace.jsx'

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
  const onLocalSessionChange = useCallback((next) => setSession(next), [])
  const handleLocalLogout = useCallback(() => { setSession(null); onLogout() }, [onLogout])
  const staff = session?.staff && typeof session.staff === 'object' ? session.staff : null
  const capabilityNames = Array.isArray(staff?.capabilities)
    ? staff.capabilities.filter((name) => typeof name === 'string') : []
  const localUser = useMemo(() => staff ? ({
    id: String(staff.staff_id || ''),
    email: typeof staff.email === 'string' ? staff.email : null,
    name: String(staff.display_name || 'Bar staff'),
    role: String(staff.role || 'cashier'),
    lodge_id: String(session?.business_id || status.business_id || ''),
    capability_overrides: {},
    allowed_outlet_ids: [String(session?.outlet_id || status.active_outlet_id || '')].filter(Boolean),
    localAuthority: true
  }) : null, [staff, session?.business_id, session?.outlet_id, status.business_id, status.active_outlet_id])
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
  const localSettings = useMemo(() => ({
    product_id: 'hospitality-pos',
    business_name: String(status.business_name || status.session?.business_name || 'Bar'),
    property_type: 'bar',
    hospitality_mode: 'bar_only',
    outlet_id: String(session?.outlet_id || status.active_outlet_id || ''),
    outlet_name: String(session?.outlet_name || status.active_outlet_name || 'Bar'),
    currency: String(status.currency || 'BWP')
  }), [status.business_name, status.session?.business_name, status.active_outlet_id, status.active_outlet_name, status.currency, session?.outlet_id, session?.outlet_name])
  const authValue = useMemo(() => ({
    user: localUser,
    login: async () => null,
    logout: async () => {
      await window.api.barLocal.logout()
      handleLocalLogout()
      return null
    }
  }), [localUser, handleLocalLogout])
  const emptyProfiles = useMemo(() => ({ profiles: [], activeProfile: null, loading: false, profilesLoading: false }), [])
  const localFeatures = useMemo(() => Object.fromEntries(APP_FEATURES.map((feature) => [feature, false])), [])
  const emptyUnsaved = useMemo(() => ({ isDirty: false, confirmLeave: null }), [])
  const statusWithSession = useMemo(() => ({ ...status, session }), [status, session])

  return <AuthContext.Provider value={authValue}>
    <ProfilesContext.Provider value={emptyProfiles}>
      <AccessContext.Provider value={localAccess}>
        <FeaturesContext.Provider value={localFeatures}>
          <OnlineRequestsContext.Provider value={{ count: 0, requests: [], refresh: () => {} }}>
            <SettingsContext.Provider value={{ settings: localSettings, setSettings: () => {} }}>
              <UnsavedChangesContext.Provider value={emptyUnsaved}>
                <HashRouter>
                  {!session ? <BarLocalWorkspace
                    status={statusWithSession}
                    onLogout={handleLocalLogout}
                    onSessionChange={onLocalSessionChange}
                    initialLoginNotice={initialLoginNotice}
                  /> : <Suspense fallback={<LocalBarLoading />}>
                    <Routes>
                      <Route element={<HposLayout />}>
                        <Route index element={<Navigate to="/hpos/pos" replace />} />
                        <Route path="hpos" element={<Navigate to="/hpos/pos" replace />} />
                        <Route path="hpos/pos" element={<BarLocalWorkspace status={statusWithSession} onLogout={handleLocalLogout} embeddedShell embeddedPanel="counter" />} />
                        <Route path="hpos/menu" element={<BarLocalWorkspace status={statusWithSession} onLogout={handleLocalLogout} embeddedShell embeddedPanel="menu" />} />
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
