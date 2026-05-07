import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useProfiles } from '../app-context'
import borokoLogoLight from '../assets/boroko-bookings-logo-light.png'

export default function Welcome() {
  const navigate = useNavigate()
  const { createDraftProfile } = useProfiles()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const handleCreateBusiness = async () => {
    setError('')
    setCreating(true)
    try {
      await createDraftProfile()
      navigate('/setup')
    } catch (e) {
      setError(e.message || 'Could not create a new lodge on this computer.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(187,247,208,0.24),transparent_24%),radial-gradient(circle_at_top_right,rgba(134,239,172,0.16),transparent_18%),linear-gradient(135deg,#0f3d2c_0%,#166534_50%,#22c55e_100%)] flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-[28px] border border-white/50 bg-white/96 p-10 text-center shadow-[0_30px_90px_rgba(15,23,42,0.28)]">
        <div className="mx-auto mb-4 flex h-24 w-72 items-center justify-center">
          <img src={borokoLogoLight} alt="Boroko Bookings" className="max-h-full max-w-full object-contain" draggable="false" />
        </div>
        <h1 className="mb-2 text-2xl font-bold tracking-[-0.03em] text-slate-900">Boroko Bookings</h1>
        <p className="mb-8 text-sm text-slate-500">Manage your lodge operations from one clear workspace.</p>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Buttons */}
        <div className="flex flex-col gap-3">
          
          <button
            onClick={handleCreateBusiness}
            disabled={creating}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 py-2.5 font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-60"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : null}
            {creating ? 'Preparing Setup...' : 'Create New Business'}
          </button>

          <button
            onClick={() => navigate('/login')}
            className="w-full rounded-lg border border-gray-300 py-2.5 font-semibold text-gray-700 transition-colors hover:bg-gray-50"
          >
            Log In
          </button>

        </div>
      </div>
    </div>
  )
}
