import { createContext, useContext, useState, useEffect } from 'react'
import { authenticateManager, logoutManagerSession, validateManagerSession } from '../lib/api'
import { clearSession, getSession, setSession } from '../lib/runtime'
import { clearSupabaseSessionToken, setSupabaseSessionToken } from '../lib/supabase'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

function isSessionExpired(expiresAt) {
  if (!expiresAt) return false
  const timestamp = new Date(expiresAt).getTime()
  return Number.isFinite(timestamp) && timestamp <= Date.now()
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pendingLodges, setPendingLodges] = useState(null)
  const [pendingCredentials, setPendingCredentials] = useState(null)

  const clearAuthSession = () => {
    clearSupabaseSessionToken()
    clearSession()
    setUser(null)
    setPendingLodges(null)
    setPendingCredentials(null)
  }

  const startSession = (row) => {
    const session = {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      lodge_id: row.lodge_id,
      lodge_display_name: row.lodge_display_name || row.lodge_name || 'Your Lodge',
      session_token: row.session_token,
      session_expires_at: row.session_expires_at || null,
      started_at: row.started_at || getSession()?.started_at || new Date().toISOString()
    }
    if (isSessionExpired(session.session_expires_at)) {
      clearAuthSession()
      throw new Error('Your session has expired. Please sign in again.')
    }
    setSupabaseSessionToken(session.session_token)
    setSession(session)
    setUser(session)
    return session
  }

  useEffect(() => {
    let cancelled = false

    async function restoreSavedSession() {
      const saved = getSession()
      if (!saved) {
        setLoading(false)
        return
      }

      try {
        if (!saved?.session_token) {
          clearAuthSession()
          setLoading(false)
          return
        }

        if (isSessionExpired(saved.session_expires_at)) {
          clearAuthSession()
          setLoading(false)
          return
        }

        setSupabaseSessionToken(saved.session_token)
        const profile = await validateManagerSession(saved.session_token)
        if (cancelled) return

        if (!profile?.pwa_enabled || isSessionExpired(profile.session_expires_at)) {
          clearAuthSession()
          setLoading(false)
          return
        }

        startSession(profile)
      } catch {
        clearAuthSession()
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    restoreSavedSession()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!user?.session_expires_at) return undefined

    const expiresInMs = new Date(user.session_expires_at).getTime() - Date.now()
    if (!Number.isFinite(expiresInMs)) return undefined

    if (expiresInMs <= 0) {
      clearAuthSession()
      return undefined
    }

    const timer = window.setTimeout(() => {
      clearAuthSession()
    }, expiresInMs + 250)

    return () => {
      window.clearTimeout(timer)
    }
  }, [user?.session_expires_at])

  const login = async (identifier, password) => {
    const result = await authenticateManager(identifier, password)
    if (result?.lodges?.length > 1) {
      setPendingLodges(result.lodges)
      setPendingCredentials({ identifier, password })
      return null
    }

    setPendingCredentials(null)
    return startSession(result.user)
  }

  const selectLodge = async (lodgeRow) => {
    if (!pendingCredentials?.identifier || !pendingCredentials?.password) {
      throw new Error('Your lodge selection expired. Please sign in again.')
    }
    const result = await authenticateManager(
      pendingCredentials.identifier,
      pendingCredentials.password,
      lodgeRow?.lodge_id
    )
    setPendingLodges(null)
    setPendingCredentials(null)
    return startSession(result.user)
  }

  const logout = async () => {
    const saved = getSession()
    try {
      if (saved?.session_token) {
        await logoutManagerSession(saved.session_token)
      }
    } catch {
      // Local cleanup still needs to happen.
    }
    clearAuthSession()
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, pendingLodges, selectLodge }}>
      {children}
    </AuthContext.Provider>
  )
}
