import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Building2, ChevronRight, Eye, EyeOff, Hotel, LogIn, UtensilsCrossed, Moon, Sun } from 'lucide-react'
import { sendPasswordResetEmail } from '../lib/supabase'
import { getPwaShellConfig } from '../lib/productShell'
import { PRODUCT_FAMILY_IDS, resolveProductFamily } from '@shared/productIdentity'
import tsaBonnoLogoColor from '../assets/tsa-bonno-hospitalityos-logo-color.png'
import tsaBonnoLogoLight from '../assets/tsa-bonno-hospitalityos-logo-light.png'

function ThemeButton({ dark, setDark }) {
  return (
    <button
      type="button"
      onClick={() => setDark((value) => !value)}
      className="absolute right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] z-10 rounded-full border border-gray-700 bg-gray-800 p-2.5 text-gray-300 shadow-lg transition-colors hover:bg-gray-700 hover:text-white"
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  )
}

function ProductIcon({ productFamily }) {
  const family = resolveProductFamily(productFamily)
  if (family === PRODUCT_FAMILY_IDS.HOTEL) return <Hotel size={20} className="text-amber-300" />
  if (family === PRODUCT_FAMILY_IDS.HOSPITALITY_POS) return <UtensilsCrossed size={20} className="text-orange-300" />
  return <Building2 size={20} className="text-green-400" />
}

function productBadgeClass(productFamily) {
  const family = resolveProductFamily(productFamily)
  if (family === PRODUCT_FAMILY_IDS.HOTEL) return 'bg-amber-950/50 text-amber-200 border-amber-800/60'
  if (family === PRODUCT_FAMILY_IDS.HOSPITALITY_POS) return 'bg-orange-950/50 text-orange-200 border-orange-800/60'
  return 'bg-green-950/50 text-green-200 border-green-800/60'
}

function productIconBg(productFamily) {
  const family = resolveProductFamily(productFamily)
  if (family === PRODUCT_FAMILY_IDS.HOTEL) return 'bg-amber-950/40'
  if (family === PRODUCT_FAMILY_IDS.HOSPITALITY_POS) return 'bg-orange-950/40'
  return 'bg-green-900/40'
}

export default function Login({ dark, setDark }) {
  const { login, pendingMemberships, selectMembership, cancelMembershipSelection } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selectLoadingId, setSelectLoadingId] = useState(null)
  const [resetLoading, setResetLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setNotice('')
    setLoading(true)
    try {
      await login(email, password)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const requestReset = async () => {
    const targetEmail = email.trim().toLowerCase()
    setError('')
    setNotice('')
    if (!targetEmail) {
      setError('Enter your email address first.')
      return
    }
    setResetLoading(true)
    try {
      await sendPasswordResetEmail(targetEmail)
      setNotice(`Password reset email sent to ${targetEmail}.`)
    } catch (err) {
      setError(err.message || 'Could not send password reset email.')
    } finally {
      setResetLoading(false)
    }
  }

  const chooseMembership = async (membership) => {
    setError('')
    setSelectLoadingId(membership.lodge_id)
    try {
      await selectMembership(membership)
    } catch (err) {
      setError(err.message || 'Could not open that business.')
    } finally {
      setSelectLoadingId(null)
    }
  }

  const inp = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500'
  const logoSrc = dark ? tsaBonnoLogoLight : tsaBonnoLogoColor

  // Membership chooser — password is not held in React state for this step.
  if (pendingMemberships?.length) {
    return (
      <div className="pwa-login-shell relative min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6 py-16">
        <ThemeButton dark={dark} setDark={setDark} />
        <div className="pwa-login-intro mb-8 text-center">
          <div className="pwa-login-logo mx-auto mb-4 flex h-28 w-80 max-w-[88vw] items-center justify-center">
            <img src={logoSrc} alt="Tsa Bonno HospitalityOS Manager" className="max-h-full max-w-full object-contain" draggable="false" />
          </div>
          <h1 className="text-xl font-bold text-white">Select your business</h1>
          <p className="text-gray-400 text-sm mt-1">
            Your account is linked to multiple businesses. Choose which one to open.
          </p>
        </div>

        <div className="w-full max-w-sm space-y-3">
          {pendingMemberships.map((membership) => {
            const family = resolveProductFamily(membership.product_family || membership.property_type)
            const shell = getPwaShellConfig(family)
            const label = membership.product_family_label || shell.productFamilyLabel
            const packageLabel = membership.package_label || membership.plan || membership.pwa_plan
            const busy = selectLoadingId === membership.lodge_id
            const selectable = membership.pwa_enabled === true && membership.pwa_feature_enabled === true
            const status = membership.pwa_feature_enabled !== true
              ? 'Manager app not entitled for this plan'
              : membership.pwa_enabled !== true
                ? 'Manager mobile access off'
                : 'Open business'
            return (
              <button
                key={membership.lodge_id}
                type="button"
                disabled={Boolean(selectLoadingId) || !selectable}
                onClick={() => chooseMembership(membership)}
                className="w-full bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 rounded-2xl px-5 py-4 flex items-center gap-4 transition-colors text-left disabled:opacity-60"
              >
                <div className={`rounded-xl p-2 ${productIconBg(family)}`}>
                  <ProductIcon productFamily={family} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium text-sm truncate">{membership.lodge_display_name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${productBadgeClass(family)}`}>
                      {label}
                    </span>
                    <span className="text-gray-400 text-xs capitalize">{membership.role}</span>
                    {packageLabel ? <span className="text-gray-500 text-xs">· {packageLabel}</span> : null}
                  </div>
                  <p className={`mt-1 text-[11px] ${selectable ? 'text-blue-300' : 'text-amber-300'}`}>{status}</p>
                </div>
                <ChevronRight size={18} className={`text-gray-500 flex-shrink-0 ${busy ? 'animate-pulse' : ''}`} />
              </button>
            )
          })}
        </div>

        {error ? (
          <p className="mt-4 w-full max-w-sm rounded-xl border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">{error}</p>
        ) : null}

        <button
          type="button"
          onClick={() => cancelMembershipSelection?.()}
          className="mt-6 text-sm text-gray-400 hover:text-white"
        >
          Use a different account
        </button>
      </div>
    )
  }

  return (
    <div className="pwa-login-shell relative min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6 py-16">
      <ThemeButton dark={dark} setDark={setDark} />
      <div className="pwa-login-intro mb-8 text-center">
        <div className="pwa-login-logo mx-auto mb-4 flex h-32 w-96 max-w-[88vw] items-center justify-center">
          <img src={logoSrc} alt="Tsa Bonno HospitalityOS Manager" className="max-h-full max-w-full object-contain" draggable="false" />
        </div>
        <h1 className="text-2xl font-bold text-white">Tsa Bonno HospitalityOS Manager</h1>
        <p className="text-gray-400 text-sm mt-1">
          One mobile app for Lodge &amp; Camp, Hotel, and Restaurant &amp; Bar
        </p>
      </div>

      <form onSubmit={submit} className="pwa-login-form w-full max-w-sm space-y-4">
        <div>
          <label className="text-xs text-gray-400 block mb-1.5">Email</label>
          <input
            className={inp}
            type="email"
            placeholder="manager@business.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1.5">Password</label>
          <div className="relative">
            <input
              className={`${inp} pr-11`}
              type={showPass ? 'text' : 'password'}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPass((p) => !p)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            >
              {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-gray-500">Use your account password. Admins can send a reset link from Staff.</p>
        </div>

        {error ? (
          <p className="rounded-xl border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">{error}</p>
        ) : null}
        {notice ? (
          <p className="rounded-xl border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">{notice}</p>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 rounded-2xl bg-green-600 hover:bg-green-500 disabled:opacity-70 py-3 text-sm font-semibold text-white transition-colors"
        >
          <LogIn size={18} />
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

        <button
          type="button"
          onClick={requestReset}
          disabled={resetLoading}
          className="w-full text-center text-xs text-gray-400 hover:text-white disabled:opacity-60"
        >
          {resetLoading ? 'Sending reset email…' : 'Forgot password?'}
        </button>
      </form>
    </div>
  )
}
