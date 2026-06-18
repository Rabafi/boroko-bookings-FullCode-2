import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Eye, EyeOff, LogIn, Building2, ChevronRight, Mail, Moon, Sun } from 'lucide-react'
import { sendPasswordResetEmail } from '../lib/supabase'
import borokoLogoDark from '../assets/boroko-bookings-logo-dark.png'
import borokoLogoLight from '../assets/boroko-bookings-logo-light.png'

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

export default function Login({ dark, setDark }) {
  const { login, pendingLodges, selectLodge } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
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
      // if pendingLodges is set, the lodge picker renders automatically
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

  const inp = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500'
  const logoSrc = dark ? borokoLogoDark : borokoLogoLight

  // ── Lodge picker (shown when same email exists in multiple lodges) ──
  if (pendingLodges) {
    return (
      <div className="pwa-login-shell relative min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6 py-16">
        <ThemeButton dark={dark} setDark={setDark} />
        <div className="pwa-login-intro mb-8 text-center">
          <div className="pwa-login-logo mx-auto mb-4 flex h-28 w-80 max-w-[88vw] items-center justify-center">
            <img src={logoSrc} alt="Boroko Manager" className="max-h-full max-w-full object-contain" draggable="false" />
          </div>
          <h1 className="text-xl font-bold text-white">Select Your Lodge</h1>
          <p className="text-gray-400 text-sm mt-1">Your account is linked to multiple properties</p>
        </div>

        <div className="w-full max-w-sm space-y-3">
          {pendingLodges.map((lodge) => (
            <button
              key={lodge.id}
              onClick={() => selectLodge(lodge)}
              className="w-full bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 rounded-2xl px-5 py-4 flex items-center gap-4 transition-colors text-left"
            >
              <div className="bg-green-900/40 rounded-xl p-2">
                <Building2 size={20} className="text-green-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium text-sm truncate">{lodge.lodge_display_name}</p>
                <p className="text-gray-400 text-xs capitalize">{lodge.role}</p>
              </div>
              <ChevronRight size={18} className="text-gray-500 flex-shrink-0" />
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── Login form ──
  return (
    <div className="pwa-login-shell relative min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6 py-16">
      <ThemeButton dark={dark} setDark={setDark} />
      <div className="pwa-login-intro mb-8 text-center">
        <div className="pwa-login-logo mx-auto mb-4 flex h-32 w-96 max-w-[88vw] items-center justify-center">
          <img src={logoSrc} alt="Boroko Manager" className="max-h-full max-w-full object-contain" draggable="false" />
        </div>
        <h1 className="text-2xl font-bold text-white">Boroko Manager Mobile App</h1>
        <p className="text-gray-400 text-sm mt-1">Leadership access for lodge managers and admins</p>
      </div>

      <form onSubmit={submit} className="pwa-login-form w-full max-w-sm space-y-4">
        <div>
          <label className="text-xs text-gray-400 block mb-1.5">Email</label>
          <input
            className={inp}
            type="email"
            placeholder="manager@lodge.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
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
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPass(p => !p)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            >
              {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-gray-500">Use your account password. Admins can send a reset link from Staff.</p>
        </div>

        {error && (
          <div className={`${error.includes('Pro plan') ? 'bg-purple-900/40 border-purple-700/50 text-purple-200' : 'bg-red-900/40 border-red-700/50 text-red-300'} border rounded-xl px-4 py-3 text-sm`}>
            {error}
          </div>
        )}

        {notice && (
          <div className="bg-green-900/40 border border-green-700/50 text-green-200 rounded-xl px-4 py-3 text-sm">
            {notice}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-green-700 hover:bg-green-600 active:bg-green-800 text-white py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
        >
          <LogIn size={18} />
          {loading ? 'Signing in…' : 'Sign In'}
        </button>

        <button
          type="button"
          onClick={requestReset}
          disabled={resetLoading}
          className="w-full text-green-400 hover:text-green-300 py-2 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
        >
          <Mail size={15} />
          {resetLoading ? 'Sending reset email...' : 'Forgot password?'}
        </button>
      </form>

      <p className="pwa-login-footer text-gray-600 text-xs mt-8">Boroko Bookings Manager v1.0</p>
    </div>
  )
}
