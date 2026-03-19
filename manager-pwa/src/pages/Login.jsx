import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Eye, EyeOff, LogIn, Building2, ChevronRight } from 'lucide-react'

export default function Login() {
  const { login, pendingLodges, selectLodge } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError('')
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

  const inp = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500'

  // ── Lodge picker (shown when same email exists in multiple lodges) ──
  if (pendingLodges) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6">
        <div className="mb-8 text-center">
          <div className="text-5xl mb-3">🏕️</div>
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
                <p className="text-white font-medium text-sm truncate">{lodge.lodge_id}</p>
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
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6">
      <div className="mb-8 text-center">
        <div className="text-5xl mb-3">🏕️</div>
        <h1 className="text-2xl font-bold text-white">Boroko Manager</h1>
        <p className="text-gray-400 text-sm mt-1">Lodge Management Dashboard</p>
      </div>

      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
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
        </div>

        {error && (
          <div className="bg-red-900/40 border border-red-700/50 rounded-xl px-4 py-3 text-red-300 text-sm">
            {error}
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
      </form>

      <p className="text-gray-600 text-xs mt-8">Boroko Bookings Manager v1.0</p>
    </div>
  )
}
