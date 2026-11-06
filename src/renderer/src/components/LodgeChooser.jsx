import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Building2, Loader2, Plus, Trash2 } from 'lucide-react'
import { useProfiles } from '../app-context'
import { productLogoLight } from '../assets/productLogos'
import { getProductDefinition, getRuntimeProductId } from '../../../shared/productIdentity'
import { HOTEL_CHROME } from './hotel/hotelChrome'
import { ErrorNotice } from './shared/ErrorNotice'
import { projectBarChooserProfiles } from '../../../shared/barLocalChooser'

const BUILD_PRODUCT = getProductDefinition(getRuntimeProductId())
const IS_LODGE = BUILD_PRODUCT.id === 'lodge-camp'
const IS_HOTEL = BUILD_PRODUCT.id === 'hotel'
const IS_HPOS = BUILD_PRODUCT.id === 'hospitality-pos'
const BUSINESS_NOUN = BUILD_PRODUCT.businessNoun
const BUSINESS_NOUN_TITLE = BUILD_PRODUCT.businessNounTitle
const BUSINESS_NOUN_PLURAL = BUILD_PRODUCT.businessNounPlural

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
  const [localBarEntry, setLocalBarEntry] = useState({ status: 'loading', label: null, origin_profile_id: null })

  useEffect(() => {
    if (!IS_HPOS) return
    let cancelled = false
    Promise.resolve(window.api?.barLocal?.getChooserEntry?.()).then((entry) => {
      if (cancelled) return
      const status = ['none', 'draft', 'ready', 'recovery'].includes(entry?.status) ? entry.status : 'recovery'
      setLocalBarEntry({
        status,
        label: typeof entry?.label === 'string' && entry.label.trim() ? entry.label.trim() : status === 'none' ? null : 'Saved Bar setup',
        origin_profile_id: typeof entry?.origin_profile_id === 'string' ? entry.origin_profile_id : null
      })
    }).catch(() => {
      if (!cancelled) setLocalBarEntry({ status: 'recovery', label: 'Saved Bar setup', origin_profile_id: null })
    })
    return () => { cancelled = true }
  }, [])

  const selectSavedLocalBar = async () => {
    setWorkingId('local-bar')
    setError('')
    try {
      const result = await window.api?.barLocal?.selectLocalBarWorkspace?.()
      if (result?.restart_required !== true || result?.workspace !== 'local_bar') throw new Error('The saved Bar could not be selected. Your existing setup is preserved.')
    } catch (e) { setError(e?.message || 'Could not select the saved local Bar. Do not create another business; contact support.') }
    finally { setWorkingId('') }
  }

  const linkDraftToLocalBar = async (profile) => {
    if (!window.confirm(`Show “${localBarEntry.label}” and this draft as one Bar entry? The saved draft data will be kept.`)) return
    setWorkingId(`link:${profile.lodge_id}`)
    setError('')
    try {
      const linked = await window.api?.barLocal?.linkChooserDraft?.({ profile_id: profile.lodge_id })
      if (!linked || !['draft', 'ready', 'recovery'].includes(linked.status)) throw new Error('The Bar profile link could not be confirmed. Both saved records were kept.')
      setLocalBarEntry(linked)
    } catch (e) {
      setError(e?.message || 'Could not link this saved draft. Both saved records were kept.')
    } finally { setWorkingId('') }
  }

  const sortedProfiles = useMemo(() => {
    return [...profiles].sort((a, b) => {
      if (a.active) return -1
      if (b.active) return 1
      if (a.status !== b.status) return a.status === 'ready' ? -1 : 1
      return String(b.last_used_at || '').localeCompare(String(a.last_used_at || ''))
    })
  }, [profiles])

  const projectedProfiles = useMemo(
    () => projectBarChooserProfiles(sortedProfiles, localBarEntry).profiles,
    [sortedProfiles, localBarEntry]
  )
  const hasLocalBarEntry = IS_HPOS && ['draft', 'ready', 'recovery'].includes(localBarEntry.status)
  const hasChooserEntries = projectedProfiles.length > 0 || hasLocalBarEntry

  const handleUseProfile = async (profile) => {
    setError('')
    setWorkingId(profile.lodge_id)
    try {
      await selectProfile(profile.lodge_id)
      navigate(profile.status === 'draft' ? '/setup' : '/login')
    } catch (e) {
      setError(e.message || (IS_LODGE
        ? 'Could not switch to that property on this computer.'
        : `Could not switch to that ${BUSINESS_NOUN} on this computer.`))
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
      setError(e.message || (IS_LODGE
        ? 'Could not create a new property on this computer.'
        : `Could not create a new ${BUSINESS_NOUN} on this computer.`))
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
        throw new Error(result?.error || (IS_LODGE
          ? 'Could not remove this draft property.'
          : `Could not remove this draft ${BUSINESS_NOUN}.`))
      }
    } catch (e) {
      setError(e.message || (IS_LODGE
        ? 'Could not remove this draft property.'
        : `Could not remove this draft ${BUSINESS_NOUN}.`))
    } finally {
      setWorkingId('')
    }
  }

  // ── Live Lodge UI (frozen) ────────────────────────────────────────────────
  if (IS_LODGE) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-900 via-green-800 to-green-700 flex items-center justify-center px-6 py-10">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden">
          <div className="bg-green-700 px-8 py-6 text-white">
            <div className="mb-4 flex h-24 w-80 max-w-full items-center">
              <img src={productLogoLight} alt={BUILD_PRODUCT.brandName} className="max-h-full max-w-full object-contain" draggable="false" />
            </div>
            <h1 className="text-2xl font-bold">Choose a Property on This Computer</h1>
            <p className="text-green-200 text-sm mt-1">
              Each property keeps its own local cache, offline access, and setup state on this PC.
            </p>
          </div>

          <div className="px-8 py-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
              <div>
                <p className="text-sm font-medium text-gray-700">Local property profiles</p>
                <p className="text-xs text-gray-500">
                  Select a property to sign in, continue setup, or create a new business.
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
                  Add New Property
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="inline-flex items-center justify-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold px-4 py-2.5 rounded-lg transition-colors"
                >
                  Sign In
                </button>
              </div>
            </div>

            {error && (
              <ErrorNotice className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </ErrorNotice>
            )}

            {profilesLoading ? (
              <div className="py-12 text-center text-gray-500 text-sm">Loading local lodge profiles...</div>
            ) : sortedProfiles.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center">
                <div className="mx-auto mb-3 w-14 h-14 rounded-2xl bg-green-100 text-green-700 flex items-center justify-center">
                  <Building2 size={24} />
                </div>
                <h2 className="text-lg font-semibold text-gray-800">No properties on this computer yet</h2>
                <p className="text-sm text-gray-500 mt-2">
                  Create your first business to start setup, or sign in to Command Central if you are a Tsa Bonno admin.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {sortedProfiles.map((profile) => {
                  const isActive = activeProfile?.lodge_id === profile.lodge_id
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
                              {profile.label || 'Untitled property'}
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
                            ? 'Continue setup for this new property profile.'
                            : 'Sign in to this property with its own local cache and offline access.'}
                        </p>
                        <button
                          type="button"
                          onClick={() => handleUseProfile(profile)}
                          disabled={Boolean(workingId)}
                          className="inline-flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-semibold px-4 py-2 rounded-lg transition-colors ml-3 flex-shrink-0"
                        >
                          {workingId === profile.lodge_id ? <Loader2 size={16} className="animate-spin" /> : null}
                          {profile.status === 'draft' ? 'Continue Setup' : 'Use Property'}
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

  // ── Hotel / Restaurant product shells ─────────────────────────────────────
  const shellClass = IS_HOTEL
    ? `${HOTEL_CHROME.shell} flex items-center justify-center px-6 py-10`
    : 'min-h-screen bg-gradient-to-br from-[#6f8061] via-[#d08a64] to-[#f1dfc6] flex items-center justify-center px-6 py-10'
  const headerClass = IS_HOTEL
    ? HOTEL_CHROME.header
    : 'bg-gradient-to-r from-[#6f8061] via-[#c95635] to-[#a83c26] px-8 py-6 text-white'
  const subtitleClass = IS_HOTEL ? HOTEL_CHROME.subtitle : 'text-orange-100 text-sm mt-1'
  const primaryBtn = IS_HOTEL
    ? HOTEL_CHROME.primaryBtn
    : 'inline-flex items-center justify-center gap-2 bg-[#c95635] hover:bg-[#a83c26] disabled:opacity-60 text-white font-semibold px-4 py-2.5 rounded-lg transition-colors'
  const useBtn = IS_HOTEL
    ? HOTEL_CHROME.useBtn
    : 'inline-flex items-center justify-center gap-2 bg-[#c95635] hover:bg-[#a83c26] disabled:opacity-60 text-white font-semibold px-4 py-2 rounded-lg transition-colors ml-3 flex-shrink-0'
  const activeCard = IS_HOTEL
    ? HOTEL_CHROME.selectOn
    : 'border-orange-400 bg-orange-50 shadow-sm'
  const idleCard = IS_HOTEL
    ? HOTEL_CHROME.selectOff
    : 'border-gray-200 hover:border-orange-300 hover:shadow-sm bg-white'
  const readyBadge = IS_HOTEL ? HOTEL_CHROME.badge : 'bg-orange-100 text-orange-700'
  const brandMark = IS_HOTEL ? 'BH' : 'P'
  const brandLabel = BUILD_PRODUCT.brandName
  const brandSub = IS_HOTEL ? HOTEL_CHROME.chooserSub : 'Restaurant & bar profiles on this PC'
  const brandTrack = IS_HOTEL ? HOTEL_CHROME.brandLabel : 'text-orange-100'
  const brandSubText = IS_HOTEL ? HOTEL_CHROME.brandSub : 'text-orange-50/80'
  const emptyIcon = IS_HOTEL ? HOTEL_CHROME.badge : 'bg-orange-100 text-orange-700'

  return (
    <div className={shellClass}>
      <div className={IS_HOTEL ? HOTEL_CHROME.cardWide : 'bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden'}>
        <div className={headerClass}>
          <div className="mb-4 flex items-center gap-3">
            <span className={IS_HOTEL
              ? HOTEL_CHROME.mark
              : 'grid h-12 w-12 place-items-center rounded-2xl bg-white/15 text-lg font-bold text-white tracking-[0.12em]'
            }>{brandMark}</span>
            <div>
              <p className={IS_HOTEL ? brandTrack : `text-[11px] font-bold uppercase tracking-[0.2em] ${brandTrack}`}>{brandLabel}</p>
              <p className={brandSubText}>{brandSub}</p>
            </div>
          </div>
          <h1 className={`text-2xl font-bold ${IS_HOTEL ? HOTEL_CHROME.ink : ''}`}>{BUILD_PRODUCT.chooserTitle}</h1>
          <p className={subtitleClass}>
            Each {BUSINESS_NOUN} keeps its own local cache, offline access, and setup state on this PC.
          </p>
        </div>

        <div className="px-8 py-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
            <div>
              <p className="text-sm font-medium text-gray-700">Local {BUSINESS_NOUN} profiles</p>
              <p className="text-xs text-gray-500">
                Select a {BUSINESS_NOUN} to sign in, continue setup, or create a new business.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={handleCreateDraft}
                disabled={profilesLoading || workingId === 'create'}
                className={primaryBtn}
              >
                {workingId === 'create' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                Add New {BUSINESS_NOUN_TITLE}
              </button>
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="inline-flex items-center justify-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold px-4 py-2.5 rounded-lg transition-colors"
              >
                Sign In
              </button>
            </div>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {profilesLoading || (IS_HPOS && localBarEntry.status === 'loading') ? (
            <div className="py-12 text-center text-gray-500 text-sm">Loading local {BUSINESS_NOUN} profiles...</div>
          ) : !hasChooserEntries ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center">
              <div className={`mx-auto mb-3 w-14 h-14 rounded-2xl flex items-center justify-center ${emptyIcon}`}>
                <Building2 size={24} />
              </div>
              <h2 className="text-lg font-semibold text-gray-800">No {BUSINESS_NOUN_PLURAL} on this computer yet</h2>
              <p className="text-sm text-gray-500 mt-2">
                Create your first {BUSINESS_NOUN} to start setup, or sign in to Command Central if you are a Tsa Bonno admin.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {hasLocalBarEntry && <article className={`rounded-2xl border p-5 ${localBarEntry.status === 'ready' ? activeCard : 'border-amber-300 bg-amber-50'}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-semibold text-gray-800 truncate">{localBarEntry.label}</h2>
                  {localBarEntry.status === 'ready' && <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${readyBadge}`}>Ready</span>}
                  {localBarEntry.status === 'draft' && <span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-amber-100 text-amber-800">Draft Setup</span>}
                  {localBarEntry.status === 'recovery' && <span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-amber-100 text-amber-800">Saved setup</span>}
                </div>
                <div className="mt-5 flex items-center justify-between gap-3">
                  <p className="text-sm text-gray-600">{localBarEntry.status === 'ready' ? 'Your local Bar is set up on this computer.' : localBarEntry.status === 'draft' ? 'Continue the saved setup for this Bar.' : 'Open this saved setup to check or continue it.'}</p>
                  <button type="button" onClick={() => void selectSavedLocalBar()} disabled={Boolean(workingId)} className={`${useBtn} ml-0`}>
                    {workingId === 'local-bar' ? <Loader2 size={16} className="animate-spin" /> : null}
                    {workingId === 'local-bar' ? 'Switching to Bar…' : localBarEntry.status === 'ready' ? 'Open Bar' : localBarEntry.status === 'draft' ? 'Continue setup' : 'Open Bar'}
                  </button>
                </div>
              </article>}
              {projectedProfiles.map((profile) => {
                const isActive = activeProfile?.lodge_id === profile.lodge_id
                return (
                  <div
                    key={profile.lodge_id}
                    className={`text-left rounded-2xl border p-5 transition-all ${
                      isActive ? activeCard : idleCard
                    } ${workingId ? 'opacity-70' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-lg font-semibold text-gray-800 truncate">
                            {profile.label || `Untitled ${BUSINESS_NOUN_TITLE}`}
                          </h2>
                          <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${
                            profile.status === 'draft'
                              ? 'bg-amber-100 text-amber-800'
                              : readyBadge
                          }`}>
                            {formatProfileStatus(profile.status)}
                          </span>
                          {isActive && (
                            <span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-slate-100 text-slate-700">
                              Active
                            </span>
                          )}
                        </div>
                        {!IS_HPOS && <p className="text-xs text-gray-500 mt-3 break-all">{profile.lodge_id}</p>}
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
                          ? `Continue setup for this new ${BUSINESS_NOUN} profile.`
                          : `Sign in to this ${BUSINESS_NOUN} with its own local cache and offline access.`}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleUseProfile(profile)}
                        disabled={Boolean(workingId)}
                        className={useBtn}
                      >
                        {workingId === profile.lodge_id ? <Loader2 size={16} className="animate-spin" /> : null}
                        {profile.status === 'draft' ? 'Continue Setup' : `Use ${BUSINESS_NOUN_TITLE}`}
                      </button>
                    </div>
                    {IS_HPOS && profile.status === 'draft' && hasLocalBarEntry && !localBarEntry.origin_profile_id && (
                      <button
                        type="button"
                        onClick={() => void linkDraftToLocalBar(profile)}
                        disabled={Boolean(workingId)}
                        className="mt-4 text-sm font-semibold text-[#7a2e1c] underline underline-offset-2 disabled:opacity-60"
                      >
                        This is the same Bar
                      </button>
                    )}
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
