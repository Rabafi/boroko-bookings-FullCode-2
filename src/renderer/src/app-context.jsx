import { createContext, useContext } from 'react'

/**
 * Expected signed-in user view shared by auth IPC, session restore and the
 * renderer cache. Persisted JSON is not validated by this declaration.
 * @typedef {{
 *   id: string | null,
 *   email: string | null,
 *   name: string,
 *   role: string | null,
 *   lodge_id: string | null,
 *   isMasterAdmin?: boolean,
 *   status?: string,
 *   capability_overrides: Record<string, unknown>,
 *   allowed_outlet_ids?: string[] | null,
 *   full_name?: string,
 *   pwa_enabled?: boolean,
 *   pwa_disabled_reason?: string | null,
 *   localAuthority?: boolean
 * }} AuthContextUser
 */

/** @typedef {{
 *   user: AuthContextUser | null,
 *   login: (user: AuthContextUser) => Promise<void> | Promise<null>,
 *   logout: () => Promise<null> | void
 * }} AuthContextValue
 */

export const AuthContext = createContext(/** @type {AuthContextValue} */ ({
  user: null,
  login: async () => null,
  logout: async () => null
}))

/**
 * Expected settings-row fields consumed by the renderer. The main settings
 * loader returns a normalized database/cache row, while outlet boot returns a
 * smaller allowlisted projection; this view describes those reads and does
 * not validate either payload.
 * @typedef {{
 *   id?: string | null,
 *   lodge_id?: string | null,
 *   lodge_name?: string | null,
 *   company_name?: string | null,
 *   business_name?: string | null,
 *   property_name?: string | null,
 *   property_type?: string | null,
 *   business_type?: string | null,
 *   hospitality_mode?: string | null,
 *   authority_mode?: string | null,
 *   operating_mode?: string | null,
 *   operating_profile?: Record<string, unknown> | string | null,
 *   currency?: string | null,
 *   address?: string | null,
 *   city?: string | null,
 *   country?: string | null,
 *   phone?: string | null,
 *   contact_phone?: string | null,
 *   contact_name?: string | null,
 *   contact_email?: string | null,
 *   email?: string | null,
 *   website?: string | null,
 *   logo?: string | null,
 *   logo_url?: string | null,
 *   outlet?: unknown,
 *   outlet_id?: string | null,
 *   outlet_name?: string | null,
 *   cash_model?: string | null,
 *   default_outlet_name?: string | null,
 *   vat_enabled?: boolean | null,
 *   vat_rate?: number | null,
 *   vat_number?: string | null,
 *   assistant_enabled?: boolean | null,
 *   commercial_package_key?: string | null,
 *   product_id?: string | null,
 *   subscription_plan?: string | null,
 *   trial_started_at?: string | null,
 *   pool_fee_adult?: number | null,
 *   pool_fee_child?: number | null,
 *   email_host?: string | null,
 *   smtp_host?: string | null,
 *   timezone?: string | null,
 *   manage_general?: boolean | null,
 *   manage_subscription?: boolean | null,
 *   deductions_payable_account_id?: string | null,
 *   inputTaxAccountId?: string | null,
 *   net_payable_account_id?: string | null,
 *   payroll_expense_account_id?: string | null,
 *   tax_payable_account_id?: string | null
 * }} SettingsRowView
 */
/**
 * @typedef {{
 *   settings: SettingsRowView | null,
 *   setSettings: import('react').Dispatch<import('react').SetStateAction<SettingsRowView | null>>
 * }} SettingsContextValue
 */
export const SettingsContext = createContext(/** @type {SettingsContextValue} */ ({
  settings: null,
  setSettings: () => {}
}))

/** Main IPC profile rows and the local-only POS profile use separate producer shapes. */
/** @typedef {import('./types/desktop-api.js').DesktopProfileReadView} DesktopProfileContextReadView */
/** @typedef {{lodge_id: string, lodge_name: string, business_name: string, property_type: 'bar', product_id: 'hospitality-pos', authority_mode: 'bar_local', status: 'ready'}} LocalBarProfileContextView */
/** @typedef {DesktopProfileContextReadView | LocalBarProfileContextView} ProfileContextRow */
/** @typedef {{profiles: ProfileContextRow[], activeProfile: ProfileContextRow|null, loading: boolean, profilesLoading: boolean, reloadProfiles: () => Promise<ProfileContextRow[] | {profiles: ProfileContextRow[], activeProfile: ProfileContextRow|null}>, selectProfile: (lodgeId: string) => Promise<import('./types/desktop-api.js').DesktopProfileSelectionDataReadView | LocalBarProfileContextView | null>, createDraftProfile: () => Promise<DesktopProfileContextReadView|null>, removeDraftProfile: (lodgeId: string) => Promise<import('./types/desktop-api.js').DesktopProfileRemoveDraftResult|null>}} ProfilesContextValue */
export const ProfilesContext = createContext(/** @type {ProfilesContextValue} */ ({
  profiles: [],
  activeProfile: null,
  loading: false,
  profilesLoading: false,
  reloadProfiles: async () => [],
  selectProfile: async () => null,
  createDraftProfile: async () => null,
  removeDraftProfile: async () => null
}))

/** @typedef {Record<string, boolean>} FeatureFlags */
export const FeaturesContext = createContext(/** @type {FeatureFlags} */ ({}))

/**
 * Master-admin routing intentionally renders outside AccessContext. The
 * regular application provider supplies the full capability snapshot, while
 * entitlement remains an unvalidated IPC/cache value.
 * @typedef {import('../../shared/accessControl.js').CapabilitySnapshot & {
 *   entitlement: unknown,
 *   allowedOutletIds: string[] | null,
 *   refreshEntitlement: (options?: {forceFresh?: boolean}) => Promise<unknown>
 * }} AccessContextValue
 */
/** @typedef {Record<string, undefined>} EmptyAccessContext */
export const AccessContext = createContext(/** @type {AccessContextValue | EmptyAccessContext} */ ({}))

/** @typedef {{count: number, requests: import('./types/desktop-api.js').PendingOnlineBookingReadView[], refresh: () => Promise<void>|void}} OnlineRequestsContextValue */
export const OnlineRequestsContext = createContext(/** @type {OnlineRequestsContextValue} */ ({
  count: 0,
  requests: [],
  refresh: () => {}
}))

export const UnsavedChangesContext = createContext({
  isDirty: false,
  confirmLeave: null
})

export function useAuth() {
  return useContext(AuthContext)
}

export function useSettings() {
  return useContext(SettingsContext)
}

export function useProfiles() {
  return useContext(ProfilesContext)
}

export function useFeatures() {
  return useContext(FeaturesContext)
}

export function useAccess() {
  return useContext(AccessContext)
}

export function useOnlineRequests() {
  return useContext(OnlineRequestsContext)
}

export function useUnsavedChanges() {
  return useContext(UnsavedChangesContext)
}
