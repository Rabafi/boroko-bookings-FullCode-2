import { useState } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'
import { updateSupabasePassword } from '../lib/supabase'

function leaveRecoveryMode() {
  sessionStorage.removeItem('boroko_password_recovery')
}

function returnToSignIn() {
  leaveRecoveryMode()
  window.history.replaceState(null, '', '/')
  window.location.reload()
}

export default function ResetPassword() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Password confirmation does not match.')
      return
    }

    setLoading(true)
    try {
      await updateSupabasePassword(password)
      leaveRecoveryMode()
      setSuccess('Password updated. You can return to Boroko Bookings desktop or the manager app and sign in with the new password.')
      setPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(err.message || 'Could not update password. Open the reset link again and try once more.')
    } finally {
      setLoading(false)
    }
  }

  const inputClass = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500'

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-green-900/40 text-green-300">
            <Lock size={24} />
          </div>
          <h1 className="text-2xl font-bold text-white">Reset Boroko Password</h1>
          <p className="text-gray-400 text-sm mt-1">This updates your Boroko sign-in password for desktop and any manager access you are allowed to use.</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1.5">New Password</label>
            <div className="relative">
              <input
                className={`${inputClass} pr-11`}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-400 block mb-1.5">Confirm Password</label>
            <input
              className={inputClass}
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          {error && (
            <div className="bg-red-900/40 border border-red-700/50 text-red-300 rounded-xl px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-900/40 border border-green-700/50 text-green-200 rounded-xl px-4 py-3 text-sm">
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-700 hover:bg-green-600 active:bg-green-800 text-white py-3.5 rounded-xl font-semibold transition-colors disabled:opacity-60"
          >
            {loading ? 'Updating...' : 'Update Password'}
          </button>

          <button
            type="button"
            onClick={returnToSignIn}
            className="block w-full text-center text-sm font-semibold text-green-400 hover:text-green-300"
          >
            Back to Boroko sign in
          </button>
        </form>
      </div>
    </div>
  )
}
