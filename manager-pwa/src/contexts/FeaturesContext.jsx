import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const FeaturesContext = createContext({})
export const useFeatures = () => useContext(FeaturesContext)

export function FeaturesProvider({ children }) {
  const { user } = useAuth()
  const [features, setFeatures] = useState({})

  useEffect(() => {
    if (!user?.lodge_id) { setFeatures({}); return }
    supabase
      .from('lodge_features')
      .select('feature_name, enabled')
      .eq('lodge_id', user.lodge_id)
      .then(({ data }) => {
        if (!data) return
        const map = {}
        data.forEach(r => { map[r.feature_name] = r.enabled })
        setFeatures(map)
      })
  }, [user?.lodge_id])

  // Returns true if feature is enabled (default: true if no flag set)
  const isEnabled = (feature) => {
    if (Object.keys(features).length === 0) return true
    return features[feature] !== false
  }

  return (
    <FeaturesContext.Provider value={{ features, isEnabled }}>
      {children}
    </FeaturesContext.Provider>
  )
}
