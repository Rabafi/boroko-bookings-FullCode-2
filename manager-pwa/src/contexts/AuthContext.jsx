import { createContext, useContext, useState, useEffect } from 'react'
import {
  authenticateManager,
  issueManagerPwaSession,
  isManagerPwaMembershipSelectable,
  listManagerPwaMemberships,
  logoutManagerSession,
  refreshManagerSession,
  validateManagerSession
} from '../lib/api'
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

function buildSessionRecord(row, previous = null) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    lodge_id: row.lodge_id,
    lodge_display_name: row.lodge_display_name || row.lodge_name || 'Your Lodge',
    property_type: row.property_type || previous?.property_type || null,
    product_family: row.product_family || previous?.product_family || null,
    product_family_label: row.product_family_label || previous?.product_family_label || null,
    product_id: row.product_id || previous?.product_id || null,
    commercial_package_key: row.commercial_package_key || previous?.commercial_package_key || null,
    package_label: row.package_label || previous?.package_label || null,
    hospitality_mode: row.hospitality_mode || previous?.hospitality_mode || null,
    effective_features: row.effective_features || previous?.effective_features || null,
    available_memberships: Array.isArray(row.available_memberships)
      ? row.available_memberships
      : (Array.isArray(previous?.available_memberships) ? previous.available_memberships : []),
    pwa_enabled: row.pwa_enabled === true,
    pwa_feature_enabled: row.pwa_feature_enabled !== false,
    plan: row.plan || row.pwa_plan || previous?.plan || 'Starter',
    session_token: row.session_token,
    session_expires_at: row.session_expires_at || null,
    started_at: row.started_at || previous?.started_at || new Date().toISOString(),
    trusted_device: true,
    trusted_until: row.trusted_until || previous?.trusted_until || addDaysIso(new Date().toISOString(), 365)
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pendingMemberships, setPendingMemberships] = useState(null)
  const [availableMemberships, setAvailableMemberships] = useState([])

  const clearAuthSession = () => {
    clearSupabaseSessionToken()
    clearSession()
    setUser(null)
    setPendingMemberships(null)
    setAvailableMemberships([])
  }

  const startSession = (row, previous = null, memberships = null) => {
    const nextMemberships = Array.isArray(memberships)
      ? memberships
      : (Array.isArray(row?.available_memberships)
        ? row.available_memberships
        : (Array.isArray(previous?.available_memberships) ? previous.available_memberships : []))
    const session = buildSessionRecord({ ...row, available_memberships: nextMemberships }, previous)
    if (isSessionExpired(session.session_expires_at) && !isTrustedSessionValid(session)) {
      clearAuthSession()
      throw new Error('Your session has expired. Please sign in again.')
    }
    setSupabaseSessionToken(session.session_token)
    setSession(session)
    setUser(session)
    setPendingMemberships(null)
    setAvailableMemberships(nextMemberships)
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
          // Prefer server product identity when refresh returns it; keep saved otherwise.
          property_type: profile.property_type || saved.property_type || null,
          product_family: profile.product_family || saved.product_family || null,
          product_family_label: profile.product_family_label || saved.product_family_label || null,
          product_id: profile.product_id || saved.product_id || null,
          commercial_package_key: profile.commercial_package_key || saved.commercial_package_key || null,
          package_label: profile.package_label || saved.package_label || null,
          hospitality_mode: profile.hospitality_mode || saved.hospitality_mode || null,
          effective_features: profile.effective_features || saved.effective_features || null,
          trusted_device: true,
          trusted_until: trustedUntil(saved),
          started_at: saved.started_at || profile.started_at || new Date().toISOString()
        } : null

        if (!mergedProfile?.pwa_enabled || (isSessionExpired(mergedProfile.session_expires_at) && !isTrustedSessionValid(mergedProfile))) {
          clearAuthSession()
          setLoading(false)
          return
        }

        let memberships = Array.isArray(saved.available_memberships) ? saved.available_memberships : []
        if (!isOffline()) {
          try {
            const freshMemberships = await listManagerPwaMemberships()
            if (freshMemberships.length > 0) memberships = freshMemberships
          } catch {
            // A valid saved session can still restore when membership listing is temporarily unavailable.
          }
        }
        if (cancelled) return
        startSession(mergedProfile, saved, memberships)
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
          }, user)
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
    const memberships = Array.isArray(result?.memberships) ? result.memberships : []
    if (result?.memberships?.length > 1) {
      // Supabase Auth holds the credential; do not keep the password in React state.
      setAvailableMemberships(memberships)
      setPendingMemberships(memberships)
      return null
    }

    if (!result?.user) {
      throw new Error('Could not open a manager session.')
    }

    return startSession(result.user, null, memberships)
  }

  const selectMembership = async (membership) => {
    if (!membership?.lodge_id) {
      throw new Error('Select a business to continue.')
    }
    if (!isManagerPwaMembershipSelectable(membership)) {
      throw new Error('This business is not currently entitled or enabled for Manager mobile access.')
    }
    const result = await issueManagerPwaSession(membership.lodge_id)
    if (!result?.user) {
      throw new Error('Could not open a manager session for that business.')
    }
    return startSession(result.user, membership, availableMemberships.length ? availableMemberships : [membership])
  }

  const switchMembership = async (membership) => {
    if (!user?.session_token) {
      throw new Error('Your current manager session is unavailable. Please sign in again.')
    }

    const selectedLodgeId = String(membership?.lodge_id || '').trim().toLowerCase()
    const currentLodgeId = String(user.lodge_id || '').trim().toLowerCase()
    if (!selectedLodgeId) throw new Error('Select a business to continue.')
    if (selectedLodgeId === currentLodgeId) return user

    // Re-list while the current token is still active. A stale cached option
    // must never be enough to switch tenants.
    let memberships
    try {
      memberships = await listManagerPwaMemberships()
    } catch {
      throw new Error('Could not refresh your businesses. The current session remains active.')
    }
    const selected = memberships.find((row) => String(row.lodge_id).trim().toLowerCase() === selectedLodgeId)
    if (!selected) throw new Error('That business is no longer available for this account.')
    if (!isManagerPwaMembershipSelectable(selected)) {
      throw new Error('This business is not currently entitled or enabled for Manager mobile access.')
    }

    const previousToken = user.session_token
    const result = await issueManagerPwaSession(selected.lodge_id)
    const nextToken = result?.user?.session_token
    if (!result?.user || !nextToken) {
      throw new Error('The server did not issue a valid mobile app session for that business.')
    }

    try {
      // Keep the current session active until the new session is issued. Only
      // commit the new local tenant after the old server token is revoked.
      await logoutManagerSession(previousToken)
    } catch {
      // Best-effort cleanup prevents an uncommitted second active session.
      await logoutManagerSession(nextToken).catch(() => {})
      throw new Error('Could not safely switch businesses. Your current session remains active.')
    }

    return startSession(result.user, user, memberships)
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

  const cancelMembershipSelection = async () => {
    setPendingMemberships(null)
    setAvailableMemberships([])
    await signOutSupabaseAuth()
    clearSupabaseSessionToken()
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        pendingMemberships,
        pendingLodges: pendingMemberships,
        availableMemberships,
        switchMembership,
        selectMembership,
        selectLodge: selectMembership,
        cancelMembershipSelection
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
