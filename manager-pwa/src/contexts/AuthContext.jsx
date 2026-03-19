import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import bcrypt from 'bcryptjs'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

const SESSION_KEY = 'boroko_manager_session'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)       // { id, name, email, role, lodge_id }
  const [loading, setLoading] = useState(true)

  // Restore session from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      if (raw) setUser(JSON.parse(raw))
    } catch {}
    setLoading(false)
  }, [])

  const login = async (identifier, password) => {
    const val = identifier.trim().toLowerCase()

    // Try email first, then username
    let data = null
    const { data: byEmail } = await supabase
      .from('users')
      .select('id, name, email, username, role, lodge_id, password_hash')
      .eq('email', val)
      .maybeSingle()

    if (byEmail) {
      data = byEmail
    } else {
      const { data: byUsername } = await supabase
        .from('users')
        .select('id, name, email, username, role, lodge_id, password_hash')
        .eq('username', val)
        .maybeSingle()
      data = byUsername
    }

    if (!data) throw new Error('No account found with that email or username.')
    if (!['admin', 'manager'].includes(data.role)) throw new Error('Access denied. Manager or Admin role required.')

    const ok = await bcrypt.compare(password, data.password_hash)
    if (!ok) throw new Error('Incorrect password.')

    const session = { id: data.id, name: data.name, email: data.email, role: data.role, lodge_id: data.lodge_id }
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    setUser(session)
    return session
  }

  const logout = () => {
    localStorage.removeItem(SESSION_KEY)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
