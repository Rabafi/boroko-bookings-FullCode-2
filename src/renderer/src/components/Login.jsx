import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Eye, EyeOff, Loader2, RefreshCw, X } from 'lucide-react'
import { useAuth, useProfiles } from '../App'

const EMAILS_KEY_PREFIX = 'bb_saved_emails'
const MAX_SAVED = 5

function getEmailStorageKey(profileLodgeId) {
  return profileLodgeId ? `${EMAILS_KEY_PREFIX}_${profileLodgeId}` : `${EMAILS_KEY_PREFIX}_global`
}

function getSavedEmails(storageKey) {
  try { return JSON.parse(localStorage.getItem(storageKey) || '[]') } catch { return [] }
}

function saveEmail(storageKey, email) {
  const list = [email, ...getSavedEmails(storageKey).filter((entry) => entry !== email)].slice(0, MAX_SAVED)
  localStorage.setItem(storageKey, JSON.stringify(list))
}

function removeSavedEmail(storageKey, email) {
  const list = getSavedEmails(storageKey).filter((entry) => entry !== email)
  localStorage.setItem(storageKey, JSON.stringify(list))
}

function initials(email) {
  return email.split('@')[0].slice(0, 2).toUpperCase()
}

export default function Login() {
  const { login } = useAuth()
  const { activeProfile, profiles, createDraftProfile } = useProfiles()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [loading, setLoading] = useState(false)
  const [savedEmails, setSavedEmails] = useState([])
  const [authStatus, setAuthStatus] = useState({
    online: true,
    hasOfflineAccess: false,
    message: 'Checking sign-in status...'
  })
  const [diagnostics, setDiagnostics] = useState(null)
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [expectedLodgeId, setExpectedLodgeId] = useState('')
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const [recoveryError, setRecoveryError] = useState('')
  const [recoverySuccess, setRecoverySuccess] = useState('')
  const [creatingLodge, setCreatingLodge] = useState(false)
  const passwordRef = useRef(null)

  const emailStorageKey = getEmailStorageKey(activeProfile?.lodge_id)
  const hasProfiles = profiles.length > 0
  const hasReadyProfile = activeProfile?.status === 'ready'
  const hasDraftProfile = activeProfile?.status === 'draft'

  const loadDiagnostics = async (expected = '') => {
    setRecoveryLoading(true)
    setRecoveryError('')
    try {
      const data = await window.api.settings.getDiagnostics(expected)
      setDiagnostics(data)
      return data
    } catch (e) {
      setRecoveryError(e.message || 'Could not load lodge diagnostics.')
      return null
    } finally {
      setRecoveryLoading(false)
    }
  }

  useEffect(() => {
    setSavedEmails(getSavedEmails(emailStorageKey))
  }, [emailStorageKey])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const status = await window.api.auth.getStatus(email)
        if (!cancelled) setAuthStatus(status)
      } catch {
        if (!cancelled) {
          setAuthStatus({
            online: false,
            hasOfflineAccess: false,
            message: 'Could not read sign-in status right now.'
          })
        }
      }
    }, 150)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [email, activeProfile?.lodge_id])

  useEffect(() => {
    loadDiagnostics()
  }, [activeProfile?.lodge_id])

  const selectSavedEmail = (saved) => {
    setEmail(saved)
    setPassword('')
    setError('')
    setWarning('')
    setTimeout(() => passwordRef.current?.focus(), 0)
  }

  const handleRemoveSaved = (event, saved) => {
    event.stopPropagation()
    removeSavedEmail(emailStorageKey, saved)
    setSavedEmails(getSavedEmails(emailStorageKey))
    if (email === saved) setEmail('')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setWarning('')
    setLoading(true)
    try {
      console.log('[AUTH DEBUG][RENDERER INPUT]', {
        email,
        normalizedEmail: email?.trim()?.toLowerCase(),
        passwordLength: typeof password === 'string' ? password.length : null,
        hasPassword: typeof password === 'string' ? password.length > 0 : false
      })
      console.log('[AUTH TRACE] renderer submit', {
        email,
        normalizedEmail: email?.trim()?.toLowerCase(),
        passwordLength: typeof password === 'string' ? password.length : null,
        hasPassword: typeof password === 'string' ? password.length > 0 : false
      })
      const res = await window.api.auth.login(email, password)
      console.log('[AUTH DEBUG][RENDERER RESPONSE]', res)
      console.log('[AUTH TRACE] renderer login response', res)
      if (res?.ok && res.user) {
        saveEmail(emailStorageKey, email.trim().toLowerCase())
        setSavedEmails(getSavedEmails(emailStorageKey))
        if (res.warning) setWarning(res.warning)
        login(res.user, res.nonce)
      } else if (res?.code === 'backend_auth_schema_outdated') {
        const nextError = res?.error || 'Sign-in failed.'
        console.log('[AUTH TRACE] renderer final displayed error', { error: nextError, code: res?.code || null })
        setError(nextError)
      } else {
        const nextError = res?.error || 'Sign-in failed.'
        console.log('[AUTH TRACE] renderer final displayed error', { error: nextError, code: res?.code || null })
        setError(nextError)
      }
    } catch (e) {
      const nextError = 'Login failed. Please try again.'
      console.log('[AUTH TRACE] renderer final displayed error', { error: nextError, code: e?.code || null, message: e?.message || null })
      setError(nextError)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateBusiness = async () => {
    setError('')
    setWarning('')
    setCreatingLodge(true)
    try {
      await createDraftProfile()
      navigate('/setup')
    } catch (e) {
      setError(e.message || 'Could not create a new lodge profile on this computer.')
    } finally {
      setCreatingLodge(false)
    }
  }

  const handleCheckDevice = async () => {
    setRecoverySuccess('')
    await loadDiagnostics(expectedLodgeId)
  }

  const handleRelinkDevice = async () => {
    if (!expectedLodgeId.trim()) {
      setRecoveryError('Enter the correct lodge ID first.')
      return
    }

    setRecoveryLoading(true)
    setRecoveryError('')
    setRecoverySuccess('')
    try {
      const res = await window.api.settings.relinkLodge(expectedLodgeId.trim())
      if (!res?.success) {
        setRecoveryError(res?.error || 'Could not relink this lodge profile.')
        return
      }
      setRecoverySuccess('This lodge profile is now linked to the new lodge ID. Try signing in again while online.')
      setExpectedLodgeId(res.lodge_id || expectedLodgeId.trim())
      await Promise.all([
        loadDiagnostics(res.lodge_id || expectedLodgeId.trim()),
        window.api.auth.getStatus(email).then(setAuthStatus).catch(() => {})
      ])
    } catch (e) {
      setRecoveryError(e.message || 'Could not relink this lodge profile.')
    } finally {
      setRecoveryLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,rgba(187,247,208,0.28),transparent_24%),radial-gradient(circle_at_top_right,rgba(167,243,208,0.22),transparent_18%),linear-gradient(135deg,#0f3d2c_0%,#166534_55%,#22c55e_100%)] p-4">
      <div className="w-full max-w-md rounded-[28px] border border-white/60 bg-white/95 p-8 shadow-[0_30px_90px_rgba(15,23,42,0.28)] backdrop-blur">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[22px] border border-emerald-200 bg-emerald-50 text-4xl shadow-sm">🏕️</div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700/70">Desktop Operations</p>
          <h1 className="mt-2 text-2xl font-bold tracking-[-0.03em] text-slate-900">Boroko Bookings</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to continue front-desk and back-office work with this lodge.</p>
        </div>

        {activeProfile ? (
          <div className={`mb-4 rounded-2xl border px-4 py-3 ${
            hasDraftProfile ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'
          }`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Selected Lodge</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">{activeProfile.label || 'Untitled Lodge'}</p>
                <p className="mt-1 break-all text-[11px] text-slate-500">{activeProfile.lodge_id}</p>
              </div>
              {hasProfiles && (
                <button
                  type="button"
                  onClick={() => navigate('/choose-lodge')}
                  className="rounded-full border border-transparent px-2 py-1 text-xs font-semibold text-emerald-700 transition-colors hover:border-emerald-200 hover:bg-white/80 hover:text-emerald-800"
                >
                  Switch Lodge
                </button>
              )}
            </div>
            {hasDraftProfile && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-white/70 px-3 py-2 text-xs text-amber-800">
                This lodge is still being set up. Finish setup before staff sign-in. Command Central sign-in still works below.
              </div>
            )}
          </div>
        ) : (
          <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            No lodge is selected on this computer yet. Staff sign-in needs a selected lodge profile. Command Central sign-in still works.
          </div>
        )}

        <div className={`mb-5 rounded-2xl border px-4 py-3 text-sm ${
          authStatus.online
            ? authStatus.hasOfflineAccess
              ? 'bg-green-50 border-green-200 text-green-700'
              : 'bg-amber-50 border-amber-200 text-amber-700'
            : 'bg-slate-100 border-slate-300 text-slate-700'
        }`}>
          {authStatus.message}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              autoComplete="email"
              required
            />
            {savedEmails.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {savedEmails.map((saved) => (
                  <button
                    key={saved}
                    type="button"
                    onClick={() => selectSavedEmail(saved)}
                    className={`flex items-center gap-1.5 rounded-full border py-1 pl-1.5 pr-2 text-xs transition-colors ${
                      email === saved
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-emerald-300 hover:bg-emerald-50'
                    }`}
                  >
                    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">
                      {initials(saved)}
                    </span>
                    <span className="max-w-[140px] truncate">{saved}</span>
                    <span
                      role="button"
                      tabIndex={-1}
                      onClick={(e) => handleRemoveSaved(e, saved)}
                      className="ml-0.5 text-slate-400 transition-colors hover:text-red-500"
                    >
                      <X size={11} />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
            <div className="relative">
              <input
                ref={passwordRef}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input pr-11"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-600"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">
              {error}
            </div>
          )}

          {warning && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
              {warning}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary mt-2 w-full justify-center"
          >
            {loading ? 'Signing in…' : hasReadyProfile ? 'Sign In' : 'Sign In / Command Central'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-slate-500">
            {hasProfiles ? 'Need another lodge on this computer?' : 'New to Boroko?'}{' '}
            <button
              type="button"
              onClick={handleCreateBusiness}
              disabled={creatingLodge}
              className="font-semibold text-emerald-600 hover:text-emerald-700 hover:underline disabled:opacity-60"
            >
              {creatingLodge ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 size={14} className="animate-spin" />
                  Preparing…
                </span>
              ) : (
                hasProfiles ? 'Add New Lodge →' : 'Get Started →'
              )}
            </button>
          </p>
        </div>

        <p className="mt-3 text-center text-xs text-slate-400">
          Use the email and password created for the selected lodge. If a staff member still cannot sign in, a manager can reset access from Staff.
        </p>

        <div className="mt-5 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={() => setRecoveryOpen((value) => !value)}
            className="flex w-full items-center justify-between text-sm font-medium text-slate-600 hover:text-slate-800"
          >
            <span>Device Repair</span>
            <span>{recoveryOpen ? 'Hide' : 'Show'}</span>
          </button>

          {recoveryOpen && (
            <div className="mt-3 space-y-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
              <div className="flex items-start gap-2 text-amber-800 text-sm">
                <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                <p>
                  Use this only if the selected lodge profile on this computer was linked to the wrong lodge ID. You can confirm the correct lodge ID from Command Central or Boroko support.
                </p>
              </div>

              <div className="rounded-xl border border-amber-100 bg-white px-3 py-2">
                <p className="mb-1 text-xs text-slate-500">Selected local lodge ID</p>
                <code className="break-all text-xs text-slate-700">
                  {diagnostics?.current_lodge_id || 'Loading...'}
                </code>
              </div>

              <div className="rounded-xl border border-amber-100 bg-white px-3 py-2">
                <p className="mb-1 text-xs text-slate-500">Unsynced offline changes</p>
                <p className="text-sm font-medium text-slate-700">{diagnostics?.unsynced_operations ?? '—'}</p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Correct lodge ID</label>
                <input
                  className="input text-sm font-mono"
                  value={expectedLodgeId}
                  onChange={(e) => setExpectedLodgeId(e.target.value)}
                  placeholder="Paste the lodge ID from Command Central"
                />
              </div>

              {diagnostics?.expected_lodge_id && (
                <div className={`rounded-lg px-3 py-2 text-xs ${
                  diagnostics.expected_matches_current
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : diagnostics.expected_lodge_exists_remotely
                      ? 'bg-amber-50 text-amber-800 border border-amber-200'
                      : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {diagnostics.expected_matches_current
                    ? 'This lodge profile is already linked to that lodge ID.'
                    : diagnostics.expected_lodge_exists_remotely
                      ? 'That lodge ID exists and can be used to relink this lodge profile.'
                      : 'That lodge ID could not be found.'}
                </div>
              )}

              {recoveryError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {recoveryError}
                </div>
              )}

              {recoverySuccess && (
                <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                  {recoverySuccess}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCheckDevice}
                  disabled={recoveryLoading}
                  className="btn-secondary flex-1 justify-center border-amber-200 text-amber-800 hover:bg-amber-100 disabled:opacity-60"
                >
                  <RefreshCw size={14} className={recoveryLoading ? 'animate-spin' : ''} />
                  Check ID
                </button>
                <button
                  type="button"
                  onClick={handleRelinkDevice}
                  disabled={recoveryLoading || !expectedLodgeId.trim() || diagnostics?.unsynced_operations > 0}
                  className="flex-1 rounded-xl bg-amber-600 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
                >
                  Relink Lodge
                </button>
              </div>

              {diagnostics?.unsynced_operations > 0 && (
                <p className="text-xs text-red-600">
                  Relinking is blocked because this lodge profile still has unsynced offline changes that could be lost or attached to the wrong lodge.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="mt-5 text-center">
          <button
            type="button"
            onClick={() => navigate(hasProfiles ? '/choose-lodge' : '/welcome')}
            className="text-xs text-slate-400 underline hover:text-slate-600"
          >
            {hasProfiles ? '← Back to Lodge Chooser' : '← Back to Welcome'}
          </button>
        </div>
      </div>
    </div>
  )
}
