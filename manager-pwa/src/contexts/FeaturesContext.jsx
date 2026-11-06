import { createContext, useContext, useState, useEffect } from 'react'
import { useAuth } from './AuthContext'
import { buildAccessSnapshot, getRoleMeta, storeAccessSnapshot } from '../lib/access'
import { getEntitlement } from '../lib/api'

/** @typedef {Record<string, unknown>} FeatureFlagsExpectedView */
/**
 * Expected entitlement properties consumed by Manager UI. RPC and persisted
 * cache values remain unvalidated; this view describes existing producer and
 * consumer expectations only.
 * @typedef {{success?: unknown, status?: unknown, expired?: unknown, lodge_id?: unknown, entitlement_unverified?: unknown, effective_features?: FeatureFlagsExpectedView, plan?: unknown, lodge_name?: unknown}} FeaturesEntitlementExpectedView
 */
/**
 * Exact value produced by FeaturesProvider. The existing empty-object React
 * default remains unchanged; all maintained `useFeatures` call sites are
 * descendants of FeaturesProvider under AuthenticatedShell in App.jsx.
 * @typedef {{features: FeatureFlagsExpectedView, entitlement: FeaturesEntitlementExpectedView|null, access: ReturnType<typeof buildAccessSnapshot>|null, loading: boolean, can: (capability: string) => boolean, isEnabled: (feature: string) => boolean, roleMeta: ReturnType<typeof getRoleMeta>}} FeaturesContextValue
 */
const FeaturesContext = createContext(/** @type {FeaturesContextValue} */ ({}))
/** @returns {FeaturesContextValue} */
export const useFeatures = () => useContext(FeaturesContext)

/** @param {{children: import('react').ReactNode}} props */
export function FeaturesProvider({ children }) {
  const { user } = useAuth()
  const [features, setFeatures] = useState(/** @type {FeatureFlagsExpectedView} */ ({}))
  const [entitlement, setEntitlement] = useState(/** @type {FeaturesEntitlementExpectedView|null} */ (null))
  const [access, setAccess] = useState(/** @type {ReturnType<typeof buildAccessSnapshot>|null} */ (null))
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!user?.lodge_id) {
        setFeatures({})
        setEntitlement(null)
        setAccess(null)
        setLoading(false)
        return
      }

      setLoading(true)
      // Prefer live entitlement RPC.  Session feature hints are not an
      // entitlement proof and are only used when the RPC/cache is verified.
      // The API value can come from an unvalidated RPC response or persisted
      // cache. Assert only the existing UI view; this does not validate it.
      const nextEntitlement = /** @type {FeaturesEntitlementExpectedView|null} */ (
        await getEntitlement(user.lodge_id).catch(() => null)
      )
      if (cancelled) return

      const verifiedEntitlement = nextEntitlement && nextEntitlement.success !== false && nextEntitlement.entitlement_unverified !== true
      const nextFeatures = verifiedEntitlement && nextEntitlement?.effective_features && typeof nextEntitlement.effective_features === 'object'
        ? /** @type {FeatureFlagsExpectedView} */ (nextEntitlement.effective_features)
        : {}
      const nextAccess = buildAccessSnapshot(user, nextFeatures)

      setEntitlement(nextEntitlement || {
        success: false,
        status: 'unverified',
        entitlement_unverified: true,
        effective_features: /** @type {FeatureFlagsExpectedView} */ ({})
      })
      setFeatures(nextFeatures)
      setAccess(nextAccess)
      storeAccessSnapshot(user.lodge_id, nextAccess)
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [user?.lodge_id, user?.role, user?.capability_overrides, user?.effective_features, user?.plan, user?.product_id, user?.commercial_package_key, user?.pwa_plan])

  /** @param {string} feature */
  const isEnabled = (feature) => {
    // Missing entitlement data is not an implicit allow.
    return features[feature] === true
  }

  /** @param {string} capability */
  const can = (capability) => access?.capabilities?.[capability] === true

  return (
    <FeaturesContext.Provider
      value={{
        features,
        entitlement,
        access,
        loading,
        can,
        isEnabled,
        roleMeta: getRoleMeta(user?.role)
      }}
    >
      {children}
    </FeaturesContext.Provider>
  )
}
