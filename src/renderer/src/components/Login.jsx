import { useState, useRef } from 'react'
import { Eye, EyeOff, X } from 'lucide-react'
import { useAuth } from '../App'

const EMAILS_KEY = 'bb_saved_emails'
const MAX_SAVED = 5

function getSavedEmails() {
  try { return JSON.parse(localStorage.getItem(EMAILS_KEY) || '[]') } catch { return [] }
}
function saveEmail(email) {
  const list = [email, ...getSavedEmails().filter(e => e !== email)].slice(0, MAX_SAVED)
  localStorage.setItem(EMAILS_KEY, JSON.stringify(list))
}
function removeEmail(email) {
  const list = getSavedEmails().filter(e => e !== email)
  localStorage.setItem(EMAILS_KEY, JSON.stringify(list))
}
function initials(email) {
  return email.split('@')[0].slice(0, 2).toUpperCase()
}

export default function Login({ onSignUp }) {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [savedEmails, setSavedEmails] = useState(getSavedEmails)
  const passwordRef = useRef(null)

  const selectSavedEmail = (saved) => {
    setEmail(saved)
    setPassword('')
    setError('')
    setTimeout(() => passwordRef.current?.focus(), 0)
  }

  const removeSaved = (e, saved) => {
    e.stopPropagation()
    removeEmail(saved)
    setSavedEmails(getSavedEmails())
    if (email === saved) setEmail('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const user = await window.api.auth.login(email, password)
      if (user) {
        saveEmail(email.trim().toLowerCase())
        login(user)
      } else {
        setError('Invalid email or password.')
      }
    } catch {
      setError('Login failed. Please try again.')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-900 via-green-700 to-green-500 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🏕️</div>
          <h1 className="text-2xl font-bold text-gray-800">Boroko Lodge</h1>
          <p className="text-gray-500 text-sm mt-1">Booking Management System</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
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
                    className={`flex items-center gap-1.5 pl-1.5 pr-2 py-1 rounded-full border text-xs transition-colors ${
                      email === saved
                        ? 'bg-green-50 border-green-400 text-green-800'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-green-300 hover:bg-green-50'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-green-600 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                      {initials(saved)}
                    </span>
                    <span className="max-w-[140px] truncate">{saved}</span>
                    <span
                      role="button"
                      tabIndex={-1}
                      onClick={(e) => removeSaved(e, saved)}
                      className="text-gray-400 hover:text-red-500 transition-colors ml-0.5"
                    >
                      <X size={11} />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <div className="relative">
              <input
                ref={passwordRef}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 pr-11 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-2.5 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-600 text-white py-2.5 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition-colors mt-2"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {onSignUp && (
          <div className="text-center mt-6">
            <p className="text-sm text-gray-500">
              New to Boroko?{' '}
              <button
                onClick={onSignUp}
                className="text-green-600 font-semibold hover:text-green-700 hover:underline"
              >
                Get Started →
              </button>
            </p>
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-3">
          Use the email and password you created during setup
        </p>
      </div>
    </div>
  )
}
