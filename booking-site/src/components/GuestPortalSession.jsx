import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { rpc } from '../lib/publicApi.js'

const GuestPortalContext = createContext(null)

export function useGuestPortal() {
  const ctx = useContext(GuestPortalContext)
  if (!ctx) throw new Error('useGuestPortal must be used inside GuestPortalProvider')
  return ctx
}

export default function GuestPortalProvider({ children }) {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')

  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const validate = useCallback(async (t) => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: rpcErr } = await rpc('validate_guest_portal_session', { p_token: t })
      if (rpcErr) {
        setError(rpcErr.message || 'Could not validate session.')
        return
      }
      if (!data || data.success === false) {
        setError(data?.error || 'Invalid or expired session.')
        return
      }
      setSession({ token: t, ...data })
    } catch (e) {
      setError(e.message || 'Network error.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (token) {
      validate(token)
    } else {
      setLoading(false)
      setError('No session token provided.')
    }
  }, [token, validate])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--line)] border-t-[var(--brand)]" />
          <p className="text-sm text-[var(--muted)]">Validating your session…</p>
        </div>
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4">
        <div className="surface-card max-w-md rounded-[32px] p-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
            <svg className="h-8 w-8 text-[var(--danger)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="font-display text-2xl text-[var(--text)]">Session Error</h1>
          <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
            {error || 'Your guest portal session could not be validated.'}
          </p>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
            Please check your link or contact the property
          </p>
          <a
            href="/"
            className="mt-6 inline-flex rounded-full border border-[var(--line)] bg-white px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)] transition-colors hover:border-[var(--line-strong)]"
          >
            Return to booking site
          </a>
        </div>
      </div>
    )
  }

  return (
    <GuestPortalContext.Provider value={session}>
      {children}
    </GuestPortalContext.Provider>
  )
}
