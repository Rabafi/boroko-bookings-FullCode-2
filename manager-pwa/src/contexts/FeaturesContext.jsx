import { createContext, useContext, useState, useEffect } from 'react'
import { useAuth } from './AuthContext'
import { buildAccessSnapshot, getRoleMeta, storeAccessSnapshot } from '../lib/access'
import { getEntitlement } from '../lib/api'

const FeaturesContext = createContext({})
export const useFeatures = () => useContext(FeaturesContext)

export function FeaturesProvider({ children }) {
  const { user } = useAuth()
  const [features, setFeatures] = useState({})
  const [entitlement, setEntitlement] = useState(null)
  const [access, setAccess] = useState(null)
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
      const nextEntitlement = await getEntitlement(user.lodge_id).catch(() => null)
      if (cancelled) return

      const verifiedEntitlement = nextEntitlement && nextEntitlement.success !== false && nextEntitlement.entitlement_unverified !== true
      const nextFeatures = verifiedEntitlement && nextEntitlement?.effective_features && typeof nextEntitlement.effective_features === 'object'
        ? nextEntitlement.effective_features
        : {}
      const nextAccess = buildAccessSnapshot(user, nextFeatures)

      setEntitlement(nextEntitlement || {
        success: false,
        status: 'unverified',
        entitlement_unverified: true,
        effective_features: {}
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

  const isEnabled = (feature) => {
    // Missing entitlement data is not an implicit allow.
    return features[feature] === true
  }

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
