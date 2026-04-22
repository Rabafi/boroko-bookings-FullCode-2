import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, Loader2, Plus, Trash2 } from 'lucide-react'
import { useProfiles } from '../app-context'

function formatProfileStatus(status) {
  return status === 'draft' ? 'Draft Setup' : 'Ready'
}

export default function LodgeChooser() {
  const navigate = useNavigate()
  const {
    profiles,
    activeProfile,
    profilesLoading,
    selectProfile,
    createDraftProfile,
    removeDraftProfile
  } = useProfiles()

  const [workingId, setWorkingId] = useState('')
  const [error, setError] = useState('')

  const sortedProfiles = useMemo(() => {
    return [...profiles].sort((a, b) => {
      if (a.active) return -1
      if (b.active) return 1
      if (a.status !== b.status) return a.status === 'ready' ? -1 : 1
      return String(b.last_used_at || '').localeCompare(String(a.last_used_at || ''))
    })
  }, [profiles])

  const handleUseProfile = async (profile) => {
    setError('')
    setWorkingId(profile.lodge_id)
    try {
      await selectProfile(profile.lodge_id)
      navigate(profile.status === 'draft' ? '/setup' : '/login')
    } catch (e) {
      setError(e.message || 'Could not switch to that lodge on this computer.')
    } finally {
      setWorkingId('')
    }
  }

  const handleCreateDraft = async () => {
    setError('')
    setWorkingId('create')
    try {
      await createDraftProfile()
      navigate('/setup')
    } catch (e) {
      setError(e.message || 'Could not create a new lodge on this computer.')
    } finally {
      setWorkingId('')
    }
  }

  const handleRemoveDraft = async (event, lodgeId) => {
    event.stopPropagation()
    setError('')
    setWorkingId(`remove:${lodgeId}`)
    try {
      const result = await removeDraftProfile(lodgeId)
      if (!result?.success) {
        throw new Error(result?.error || 'Could not remove this draft lodge.')
      }
    } catch (e) {
      setError(e.message || 'Could not remove this draft lodge.')
    } finally {
      setWorkingId('')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-900 via-green-800 to-green-700 flex items-center justify-center px-6 py-10">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden">
        <div className="bg-green-700 px-8 py-6 text-white">
          <div className="text-3xl mb-2">🏕️</div>
          <h1 className="text-2xl font-bold">Choose a Lodge on This Computer</h1>
          <p className="text-green-200 text-sm mt-1">
            Each lodge keeps its own local cache, offline access, and setup state on this PC.
          </p>
        </div>

        <div className="px-8 py-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
            <div>
              <p className="text-sm font-medium text-gray-700">Local lodge profiles</p>
              <p className="text-xs text-gray-500">
                Select a lodge to sign in, continue setup, or create a new business.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={handleCreateDraft}
                disabled={profilesLoading || workingId === 'create'}
                className="inline-flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-semibold px-4 py-2.5 rounded-lg transition-colors"
              >
                {workingId === 'create' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                Add New Lodge
              </button>
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="inline-flex items-center justify-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold px-4 py-2.5 rounded-lg transition-colors"
              >
                Command Central Sign In
              </button>
            </div>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {profilesLoading ? (
            <div className="py-12 text-center text-gray-500 text-sm">Loading local lodge profiles...</div>
          ) : sortedProfiles.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center">
              <div className="mx-auto mb-3 w-14 h-14 rounded-2xl bg-green-100 text-green-700 flex items-center justify-center">
                <Building2 size={24} />
              </div>
              <h2 className="text-lg font-semibold text-gray-800">No lodges on this computer yet</h2>
              <p className="text-sm text-gray-500 mt-2">
                Create your first business to start setup, or sign in to Command Central if you are a Boroko admin.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sortedProfiles.map((profile) => {
                const isActive = activeProfile?.lodge_id === profile.lodge_id
                const isBusy = workingId === profile.lodge_id || workingId === `remove:${profile.lodge_id}`
                return (
                  <div
                    key={profile.lodge_id}
                    className={`text-left rounded-2xl border p-5 transition-all ${
                      isActive
                        ? 'border-green-500 bg-green-50 shadow-sm'
                        : 'border-gray-200 hover:border-green-300 hover:shadow-sm bg-white'
                    } ${workingId ? 'opacity-70' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-lg font-semibold text-gray-800 truncate">
                            {profile.label || 'Untitled Lodge'}
                          </h2>
                          <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${
                            profile.status === 'draft'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-green-100 text-green-700'
                          }`}>
                            {formatProfileStatus(profile.status)}
                          </span>
                          {isActive && (
                            <span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-slate-100 text-slate-700">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-3 break-all">{profile.lodge_id}</p>
                        <p className="text-xs text-gray-400 mt-2">
                          Last used {profile.last_used_at ? new Date(profile.last_used_at).toLocaleString() : 'just now'}
                        </p>
                      </div>

                      {profile.status === 'draft' && (
                        <button
                          type="button"
                          onClick={(event) => handleRemoveDraft(event, profile.lodge_id)}
                          disabled={Boolean(workingId)}
                          className="inline-flex items-center justify-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50 px-2.5 py-2 transition-colors disabled:opacity-60"
                          title="Remove draft"
                        >
                          {workingId === `remove:${profile.lodge_id}` ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <Trash2 size={15} />
                          )}
                        </button>
                      )}
                    </div>

                    <div className="mt-5 flex items-center justify-between">
                      <p className="text-sm text-gray-600">
                        {profile.status === 'draft'
                          ? 'Continue setup for this new lodge profile.'
                          : 'Sign in to this lodge with its own local cache and offline access.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleUseProfile(profile)}
                        disabled={Boolean(workingId)}
                        className="inline-flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-semibold px-4 py-2 rounded-lg transition-colors ml-3 flex-shrink-0"
                      >
                        {workingId === profile.lodge_id ? <Loader2 size={16} className="animate-spin" /> : null}
                        {profile.status === 'draft' ? 'Continue Setup' : 'Use Lodge'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
