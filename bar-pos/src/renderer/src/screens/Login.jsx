import { useState } from 'react'
import { Beer, Eye, EyeOff } from 'lucide-react'

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await onLogin(email, password)
    } catch (err) {
      setError(err?.message || 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-stone-950 p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-2 mb-8">
          <div className="w-14 h-14 rounded-2xl bg-brand-900/50 border border-brand-800/30 flex items-center justify-center">
            <Beer className="w-7 h-7 text-brand-400" />
          </div>
          <h1 className="text-xl font-bold text-stone-100">Bar POS</h1>
          <p className="text-sm text-stone-500">Sign in to start selling</p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4">
          {error && (
            <div className="bg-red-900/30 border border-red-800/40 rounded-lg px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="input-group">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="cashier@bar.local" required autoFocus />
          </div>

          <div className="input-group">
            <label>Password</label>
            <div className="relative">
              <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••" required className="w-full pr-9" />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300" tabIndex={-1}>
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={busy} className="btn-primary w-full btn-lg">
            {busy ? 'Signing in...' : 'Sign in'}
          </button>

          <p className="text-[11px] text-stone-600 text-center">
            Default: admin@bar.local / admin
          </p>
        </form>
      </div>
    </div>
  )
}
