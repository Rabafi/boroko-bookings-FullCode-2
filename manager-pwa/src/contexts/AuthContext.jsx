import { createContext, useContext, useState, useEffect } from 'react'
import { authenticateManager, logoutManagerSession, refreshManagerSession, validateManagerSession } from '../lib/api'
import { clearSession, getSession, setSession } from '../lib/runtime'
import { clearSupabaseSessionToken, setSupabaseSessionToken, signOutSupabaseAuth } from '../lib/supabase'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

function isSessionExpired(expiresAt) {
  if (!expiresAt) return false
  const timestamp = new Date(expiresAt).getTime()
  return Number.isFinite(timestamp) && timestamp <= Date.now()
}

function addDaysIso(value, days) {
  const base = value ? new Date(value).getTime() : Date.now()
  const timestamp = Number.isFinite(base) ? base : Date.now()
  return new Date(timestamp + days * 86400000).toISOString()
}

function trustedUntil(session) {
  if (!session?.trusted_device) return null
  const explicit = session.trusted_until ? new Date(session.trusted_until).getTime() : NaN
  if (Number.isFinite(explicit) && explicit > Date.now()) return session.trusted_until
  return addDaysIso(session.started_at || session.session_expires_at || new Date().toISOString(), 365)
}

function isTrustedSessionValid(session) {
  const until = trustedUntil(session)
  if (!until) return false
  return !isSessionExpired(until)
}

function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false
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
      pwa_enabled: row.pwa_enabled === true,
      pwa_feature_enabled: row.pwa_feature_enabled !== false,
      plan: row.plan || row.pwa_plan || 'Starter',
      session_token: row.session_token,
      session_expires_at: row.session_expires_at || null,
      started_at: row.started_at || getSession()?.started_at || new Date().toISOString(),
      trusted_device: true,
      trusted_until: row.trusted_until || getSession()?.trusted_until || addDaysIso(new Date().toISOString(), 365)
    }
    if (isSessionExpired(session.session_expires_at) && !isTrustedSessionValid(session)) {
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

        const trusted = isTrustedSessionValid(saved)
        if (isSessionExpired(saved.session_expires_at) && !trusted) {
          clearAuthSession()
          setLoading(false)
          return
        }

        setSupabaseSessionToken(saved.session_token)
        let profile = null
        try {
          profile = await refreshManagerSession(saved.session_token)
          if (!profile) profile = await validateManagerSession(saved.session_token)
        } catch (error) {
          if (!trusted && !isOffline()) throw error
          profile = trusted ? saved : null
        }
        if (cancelled) return

        if (!profile && trusted) profile = saved

        const mergedProfile = profile ? {
          ...saved,
          ...profile,
          trusted_device: true,
          trusted_until: trustedUntil(saved),
          started_at: saved.started_at || profile.started_at || new Date().toISOString()
        } : null

        if (!mergedProfile?.pwa_enabled || (isSessionExpired(mergedProfile.session_expires_at) && !isTrustedSessionValid(mergedProfile))) {
          clearAuthSession()
          setLoading(false)
          return
        }

        startSession(mergedProfile)
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
    if (isTrustedSessionValid(user)) return undefined

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

  useEffect(() => {
    if (!user?.session_token || !isTrustedSessionValid(user)) return undefined

    const refresh = async () => {
      try {
        const profile = await refreshManagerSession(user.session_token)
        if (profile?.session_token) {
          startSession({
            ...user,
            ...profile,
            trusted_device: true,
            trusted_until: trustedUntil(user)
          })
        }
      } catch {
        // The saved trusted session remains usable locally; retry next time.
      }
    }

    const expiryTime = user.session_expires_at ? new Date(user.session_expires_at).getTime() : NaN
    const refreshInMs = Number.isFinite(expiryTime)
      ? Math.max(60_000, expiryTime - Date.now() - 300_000)
      : 24 * 60 * 60 * 1000
    const timer = window.setTimeout(refresh, refreshInMs)
    return () => window.clearTimeout(timer)
  }, [user?.session_token, user?.session_expires_at, user?.trusted_until])

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
    await signOutSupabaseAuth()
    clearAuthSession()
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, pendingLodges, selectLodge }}>
      {children}
    </AuthContext.Provider>
  )
}
