import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Eye, EyeOff, Loader2, Mail, RefreshCw, X } from 'lucide-react'
import { useAuth, useProfiles } from '../app-context'
import borokoLogoLight from '../assets/boroko-bookings-logo-light.png'

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
  const [resetLoading, setResetLoading] = useState(false)
  const [resetMessage, setResetMessage] = useState('')
  const [savedEmails, setSavedEmails] = useState([])
  const [authStatus, setAuthStatus] = useState({
    online: true,
    hasOfflineAccess: false,
    hasTrustedSession: false,
    message: 'Checking sign-in status...'
  })
  const [diagnostics, setDiagnostics] = useState(null)
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [expectedLodgeId, setExpectedLodgeId] = useState('')
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const [recoveryError, setRecoveryError] = useState('')
  const [recoverySuccess, setRecoverySuccess] = useState('')
  const [updateStatus, setUpdateStatus] = useState({ checking: false, available: false, version: '', error: '' })
  const [creatingLodge, setCreatingLodge] = useState(false)
  const passwordRef = useRef(null)
  const loginInFlightRef = useRef(false)

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
            hasTrustedSession: false,
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
    if (loading || loginInFlightRef.current) return
    loginInFlightRef.current = true
    setError('')
    setWarning('')
    setResetMessage('')

    let latestStatus = authStatus
    try {
      latestStatus = await window.api.auth.getStatus(email)
      setAuthStatus(latestStatus)
    } catch {
      // Fall back to the status already shown in the UI.
    }

    if (!latestStatus?.online && (latestStatus?.hasTrustedSession || authStatus.hasTrustedSession)) {
      await handleOpenSavedSession()
      return
    }

    setLoading(true)
    try {
      const res = await window.api.auth.login(email, password)
      if (res?.ok && res.user) {
        saveEmail(emailStorageKey, email.trim().toLowerCase())
        setSavedEmails(getSavedEmails(emailStorageKey))
        if (res.warning) setWarning(res.warning)
        await login(res.user, res.nonce)
      } else if (res?.code === 'backend_auth_schema_outdated') {
        const nextError = res?.error || 'Sign-in failed.'
        setError(nextError)
      } else {
        const nextError = res?.error || 'Sign-in failed.'
        setError(nextError)
      }
    } catch (e) {
      const nextError = 'Login failed. Please try again.'
      setError(nextError)
    } finally {
      loginInFlightRef.current = false
      setLoading(false)
    }
  }

  const handleForgotPassword = async () => {
    const targetEmail = email.trim().toLowerCase()
    setError('')
    setWarning('')
    setResetMessage('')
    if (!targetEmail) {
      setError('Enter your email address first, then request a password reset.')
      return
    }
    setResetLoading(true)
    try {
      const result = await window.api.auth.sendPasswordReset(targetEmail)
      if (result?.success === false) {
        setError(result.error || 'Could not send password reset email.')
        return
      }
      setResetMessage(`Password reset email sent to ${targetEmail}.`)
    } catch (e) {
      setError(e.message || 'Could not send password reset email.')
    } finally {
      setResetLoading(false)
    }
  }

  const handleOpenSavedSession = async () => {
    setError('')
    setWarning('')
    setResetMessage('')
    const targetEmail = email.trim().toLowerCase()
    if (!targetEmail) {
      setError('Enter the staff email for the saved offline session.')
      return
    }
    if (!password) {
      setError('Enter this user password to open the saved offline session.')
      return
    }
    setLoading(true)
    try {
      const saved = await window.api.auth.restoreSavedSession?.(targetEmail, password)
      if (!saved?.user) {
        setError(saved?.error || 'The saved trusted session could not be opened. Connect to the internet and sign in again.')
        return
      }
      await login(saved.user, saved.nonce || '')
    } catch (e) {
      setError(e.message || 'Could not open the saved trusted session.')
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

  const handleCheckUpdates = async () => {
    if (!navigator.onLine) {
      setUpdateStatus({ checking: false, available: false, version: '', error: 'Internet connection required to check for updates.' })
      return
    }
    setUpdateStatus({ checking: true, available: false, version: '', error: '' })
    try {
      const res = await window.api.updates.check()
      if (res.success) {
        setUpdateStatus({
          checking: false,
          available: res.updateAvailable,
          version: res.latestVersion || (res.dev ? 'Dev' : ''),
          error: ''
        })
      } else {
        const msg = res.error?.includes('net::') ? 'Connection error. Check your internet and try again.' : (res.error || 'Check failed')
        setUpdateStatus({ checking: false, available: false, version: '', error: msg })
      }
    } catch (e) {
      setUpdateStatus({ checking: false, available: false, version: '', error: e.message })
    }
  }

  const handleInstallUpdate = () => {
    window.api.updates.install()
  }


  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,rgba(187,247,208,0.28),transparent_24%),radial-gradient(circle_at_top_right,rgba(167,243,208,0.22),transparent_18%),linear-gradient(135deg,#0f3d2c_0%,#166534_55%,#22c55e_100%)] p-4">
      <div className="w-full max-w-md rounded-[28px] border border-white/60 bg-white/95 p-8 shadow-[0_30px_90px_rgba(15,23,42,0.28)] backdrop-blur">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-20 w-64 items-center justify-center">
            <img src={borokoLogoLight} alt="Boroko Bookings" className="max-h-full max-w-full object-contain" draggable="false" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700/70">Desktop Operations</p>
          <h1 className="mt-2 text-2xl font-bold tracking-[-0.03em] text-slate-900">Boroko Bookings</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to continue front-desk and back-office work with this lodge.</p>
        </div>

        {activeProfile ? (
          <div
            className={`mb-4 rounded-2xl border px-4 py-3 ${
            hasDraftProfile ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'
          }`}
            data-testid="selected-lodge-panel"
          >
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

        <div
          className={`mb-5 rounded-2xl border px-4 py-3 text-sm ${
          authStatus.online
            ? authStatus.hasOfflineAccess
              ? 'bg-green-50 border-green-200 text-green-700'
              : 'bg-amber-50 border-amber-200 text-amber-700'
            : 'bg-slate-100 border-slate-300 text-slate-700'
        }`}
          data-testid="login-auth-status"
        >
          {authStatus.message}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="login-email-input"
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
                data-testid="login-password-input"
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

          {resetMessage && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">
              {resetMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            data-testid="login-submit-button"
            className="btn-primary mt-2 w-full justify-center"
          >
            {loading
              ? 'Signing in…'
              : !authStatus.online && authStatus.hasTrustedSession
              ? 'Open Saved Session'
              : hasReadyProfile
              ? 'Sign In'
              : 'Sign In / Command Central'}
          </button>
        </form>

        {!authStatus.online && authStatus.hasTrustedSession && (
          <button
            type="button"
            onClick={handleOpenSavedSession}
            disabled={loading}
            className="mt-3 w-full rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:opacity-60"
          >
            Open Saved Session
          </button>
        )}

        <button
          type="button"
          onClick={handleForgotPassword}
          disabled={resetLoading}
          className="mt-3 flex w-full items-center justify-center gap-2 text-sm font-semibold text-emerald-700 transition-colors hover:text-emerald-800 disabled:opacity-60"
        >
          {resetLoading ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
          {resetLoading ? 'Sending reset email...' : 'Forgot password?'}
        </button>

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
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleCheckUpdates}
              disabled={updateStatus.checking}
              className="text-sm font-medium text-slate-600 hover:text-slate-800 flex items-center gap-2"
            >
              <RefreshCw size={14} className={updateStatus.checking ? 'animate-spin' : ''} />
              {updateStatus.checking ? 'Checking for updates...' : 'Update Software'}
            </button>
            <span className="text-[10px] text-slate-400 font-mono">v{diagnostics?.app_version || '...'}</span>
          </div>

          {updateStatus.error && (
            <div className="mt-3 rounded-xl bg-red-50 border border-red-100 p-3 text-xs text-red-700">
              {updateStatus.error}
            </div>
          )}

          {updateStatus.available && (
            <div className="mt-3 rounded-xl bg-blue-50 border border-blue-200 p-4">
              <p className="text-sm font-bold text-blue-900">New version available!</p>
              <p className="text-xs text-blue-700 mt-1">Version {updateStatus.version} is ready to be installed.</p>
              <button
                onClick={handleInstallUpdate}
                className="mt-3 w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
              >
                Install & Restart Now
              </button>
            </div>
          )}

          {!updateStatus.checking && !updateStatus.available && !updateStatus.error && updateStatus.version === '' && (
             <p className="mt-2 text-[10px] text-slate-400">
               Auto-updates run in the background. Use the button above to manually check if you're missing a version.
             </p>
          )}
          
          {updateStatus.version && !updateStatus.available && !updateStatus.error && (
            <div className="mt-3 rounded-xl bg-green-50 border border-green-200 p-3 text-xs text-green-700">
              ✓ You are running the latest version.
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
