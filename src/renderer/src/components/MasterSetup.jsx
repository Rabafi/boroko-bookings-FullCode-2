import { useEffect, useState } from 'react'
import { Shield, Eye, EyeOff } from 'lucide-react'

export default function MasterSetup({ onComplete }) {
  const [checking, setChecking] = useState(true)
  const [alreadyExists, setAlreadyExists] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showPw, setShowPw] = useState(false)

  useEffect(() => {
    window.api.admin.exists().then((exists) => {
      setAlreadyExists(exists)
      setChecking(false)
    }).catch(() => setChecking(false))
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (form.password !== form.confirm) { setError('Passwords do not match'); return }
    if (form.password.length < 8) { setError('Password must be at least 8 characters'); return }
    setSaving(true)
    setError('')
    try {
      const res = await window.api.admin.setup(form.name, form.email, form.password)
      if (res?.success) {
        onComplete()
      } else {
        setError(res?.error || 'Setup failed. Please try again.')
      }
    } catch (err) {
      setError(err.message || 'Setup failed.')
    }
    setSaving(false)
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Checking...</p>
      </div>
    )
  }

  if (alreadyExists) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 text-center max-w-md">
          <Shield size={40} className="text-purple-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-white mb-2">Master Admin Already Set Up</h1>
          <p className="text-gray-400 text-sm mb-6">
            A master admin account already exists. Please log in through the regular login page using your master admin credentials.
          </p>
          <button
            onClick={onComplete}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white py-2.5 rounded-lg font-medium transition-colors"
          >
            Go to Login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md overflow-hidden">
        <div className="bg-purple-900 px-8 py-6">
          <div className="flex items-center gap-3 mb-2">
            <Shield size={28} className="text-purple-300" />
            <h1 className="text-xl font-bold text-white">Master Admin Setup</h1>
          </div>
          <p className="text-purple-300 text-sm">
            Create your Command Central account. This is a one-time setup.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-8 py-6 space-y-4">
          {error && (
            <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Your Name *</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder="e.g. Botswapelo"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Admin Email *</label>
            <input
              type="email"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder="your@email.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Password * (min 8 chars)</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 pr-10"
                placeholder="Strong password..."
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
              <button type="button" onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200">
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Confirm Password *</label>
            <input
              type="password"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder="Repeat password..."
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              required
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white py-2.5 rounded-lg font-medium transition-colors mt-2"
          >
            {saving ? 'Creating account...' : '🔐 Create Master Admin Account'}
          </button>

          <p className="text-xs text-gray-500 text-center">
            Keep your credentials private. This account gives full access to all company data.
          </p>
        </form>
      </div>
    </div>
  )
}
