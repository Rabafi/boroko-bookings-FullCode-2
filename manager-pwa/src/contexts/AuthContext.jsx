import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import bcrypt from 'bcryptjs'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

const SESSION_KEY = 'boroko_manager_session'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  // When the same email exists in multiple lodges, hold them here until user picks one
  const [pendingLodges, setPendingLodges] = useState(null) // [{ id, name, email, role, lodge_id }]

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      if (raw) setUser(JSON.parse(raw))
    } catch {}
    setLoading(false)
  }, [])

  // Step 1 — verify credentials; if multiple lodges, return them for picking
  const login = async (identifier, password) => {
    const val = identifier.trim().toLowerCase()

    const { data: rows, error } = await supabase
      .from('users')
      .select('id, name, email, role, lodge_id, password_hash')
      .eq('email', val)

    if (error) throw new Error(`DB error: ${error.message} (${error.code})`)
    if (!rows || rows.length === 0) throw new Error('No account found with that email.')

    // Verify password against first match
    const ok = await bcrypt.compare(password, rows[0].password_hash)
    if (!ok) throw new Error('Incorrect password.')

    // Filter to manager/admin roles only
    const eligible = rows.filter(r => ['admin', 'manager'].includes(r.role))
    if (eligible.length === 0) throw new Error('Access denied. Manager or Admin role required.')

    if (eligible.length === 1) {
      // Single lodge — log straight in
      return _startSession(eligible[0])
    } else {
      // Multiple lodges — fetch lodge names then let user pick
      const lodgeIds = eligible.map(r => r.lodge_id)
      const { data: settings } = await supabase
        .from('settings')
        .select('lodge_id, lodge_name, company_name')
        .in('lodge_id', lodgeIds)

      const nameMap = {}
      if (settings) settings.forEach(s => { nameMap[s.lodge_id] = s.lodge_name || s.company_name || s.lodge_id })

      const withNames = eligible.map(r => ({ ...r, lodge_display_name: nameMap[r.lodge_id] || r.lodge_id }))
      setPendingLodges(withNames)
      return null
    }
  }

  // Step 2 — called after user picks a lodge
  const selectLodge = (lodgeRow) => {
    setPendingLodges(null)
    _startSession(lodgeRow)
  }

  const _startSession = (row) => {
    const session = { id: row.id, name: row.name, email: row.email, role: row.role, lodge_id: row.lodge_id }
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
