import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useProfiles } from '../App'

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
    <div className="min-h-screen bg-gradient-to-br from-green-900 via-green-800 to-green-700 flex items-center justify-center px-6">
      
      <div className="bg-white rounded-2xl shadow-2xl p-10 w-full max-w-md text-center">
        
        {/* Logo / Icon */}
        <div className="text-5xl mb-4">🏕️</div>

        {/* Title */}
        <h1 className="text-2xl font-bold text-gray-800 mb-2">
          Boroko Bookings
        </h1>

        {/* Subtitle */}
        <p className="text-gray-500 text-sm mb-8">
          Manage your lodge operations effortlessly
        </p>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Buttons */}
        <div className="flex flex-col gap-3">
          
          {/* Create Business */}
          <button
            onClick={handleCreateBusiness}
            disabled={creating}
            className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition-colors inline-flex items-center justify-center gap-2"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : null}
            {creating ? 'Preparing Setup...' : 'Create New Business'}
          </button>

          {/* Login */}
          <button
            onClick={() => navigate('/login')}
            className="w-full border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold py-2.5 rounded-lg transition-colors"
          >
            Log In
          </button>

        </div>

        {/* Footer */}
        <p className="text-xs text-gray-400 mt-6">
          © {new Date().getFullYear()} Boroko Bookings
        </p>

      </div>
    </div>
  )
}
