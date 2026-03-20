import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

const SESSION_KEY = 'boroko_manager_session'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  // When the same email exists in multiple lodges, hold them here until user picks one
  const [pendingLodges, setPendingLodges] = useState(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      if (raw) setUser(JSON.parse(raw))
    } catch {}
    setLoading(false)
  }, [])

  // Step 1 — verify credentials server-side via Postgres RPC.
  // The password hash never leaves the database.
  const login = async (identifier, password) => {
    const email = identifier.trim().toLowerCase()

    const { data, error } = await supabase.rpc('authenticate_manager', {
      p_email: email,
      p_password: password
    })

    if (error) throw new Error('Login failed. Please try again.')
    if (data?.error) throw new Error(data.error)

    const lodges = data?.lodges
    if (!lodges || lodges.length === 0) {
      throw new Error('Access denied. Manager or Admin role required.')
    }

    if (lodges.length === 1) {
      return _startSession(lodges[0])
    }

    // Multiple lodges — let the user pick (same UX as before)
    setPendingLodges(lodges)
    return null
  }

  // Step 2 — called after user picks a lodge from the picker
  const selectLodge = (lodgeRow) => {
    setPendingLodges(null)
    _startSession(lodgeRow)
  }

  const _startSession = (row) => {
    const session = {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      lodge_id: row.lodge_id
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    setUser(session)
    return session
  }

  const logout = () => {
    localStorage.removeItem(SESSION_KEY)
    setUser(null)
    setPendingLodges(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, pendingLodges, selectLodge }}>
      {children}
    </AuthContext.Provider>
  )
}
