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
      // Prefer live entitlement RPC; seed from server membership/session features when present.
      const nextEntitlement = await getEntitlement(user.lodge_id).catch(() => null)
      if (cancelled) return

      const sessionFeatures = user?.effective_features && typeof user.effective_features === 'object'
        ? user.effective_features
        : {}
      const nextFeatures = nextEntitlement?.effective_features || sessionFeatures || {}
      const nextAccess = buildAccessSnapshot(user, nextFeatures)

      setEntitlement(nextEntitlement || {
        plan: user?.plan || user?.pwa_plan || 'Starter',
        product_id: user?.product_id || null,
        commercial_package_key: user?.commercial_package_key || null,
        effective_features: sessionFeatures
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
    if (Object.keys(features).length === 0) return true
    return features[feature] !== false
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
