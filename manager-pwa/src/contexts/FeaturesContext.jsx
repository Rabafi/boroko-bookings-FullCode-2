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
      const nextEntitlement = await getEntitlement(user.lodge_id).catch(() => null)
      if (cancelled) return

      const nextFeatures = nextEntitlement?.effective_features || {}
      const nextAccess = buildAccessSnapshot(user, nextFeatures)

      setEntitlement(nextEntitlement)
      setFeatures(nextFeatures)
      setAccess(nextAccess)
      storeAccessSnapshot(user.lodge_id, nextAccess)
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [user?.lodge_id, user?.role])

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
