import { useCallback, useEffect, useState } from 'react'
import { Search, Star, Ban, Eye, ThumbsUp, ThumbsDown, Crown, StickyNote } from 'lucide-react'
import { Modal } from './shared/Modal'
import { ConfirmDialog } from './shared/ConfirmDialog'
import { useAccess } from '../app-context'
import { canAccessCapability } from '../../../shared/accessControl'

const VIP_LEVELS = ['standard', 'silver', 'gold', 'platinum']
const CONSENT_TYPES = ['marketing', 'communication', 'data_processing']

function formatCurrency(amount, currency = 'BWP') {
  return `${currency} ${Number(amount || 0).toLocaleString('en', { minimumFractionDigits: 2 })}`
}

function VipBadge({ level }) {
  const colors = { platinum: 'bg-purple-100 text-purple-700', gold: 'bg-amber-100 text-amber-700', silver: 'bg-slate-100 text-slate-600', standard: 'bg-slate-50 text-slate-400' }
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${colors[level] || colors.standard}`}>{level}</span>
}

export default function GuestCRM() {
  const access = useAccess()
  const canManage = canAccessCapability(access, 'guest_crm.manage')
  const canVip = canAccessCapability(access, 'guest_crm.vip')
  const canBlacklist = canAccessCapability(access, 'guest_crm.blacklist')

  const [searchQuery, setSearchQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [selectedProfile, setSelectedProfile] = useState(null)
  const [profileData, setProfileData] = useState(null)
  const [stayHistory, setStayHistory] = useState([])
  const [notes, setNotes] = useState([])
  const [notesError, setNotesError] = useState('')
  const [loadingProfile, setLoadingProfile] = useState(false)

  const [showVipModal, setShowVipModal] = useState(false)
  const [vipLevel, setVipLevel] = useState('standard')

  const [showPreferenceModal, setShowPreferenceModal] = useState(false)
  const [prefKey, setPrefKey] = useState('')
  const [prefValue, setPrefValue] = useState('')

  const [showBlacklistModal, setShowBlacklistModal] = useState(false)
  const [blacklistReason, setBlacklistReason] = useState('')
  const [confirmDialog, setConfirmDialog] = useState(null)

  const [showNoteModal, setShowNoteModal] = useState(false)
  const [noteText, setNoteText] = useState('')

  const [vipList, setVipList] = useState([])
  const [showVipList, setShowVipList] = useState(false)
  const [loadingVipList, setLoadingVipList] = useState(false)

  useEffect(() => {
    if (!success) return
    const timer = setTimeout(() => setSuccess(''), 3000)
    return () => clearTimeout(timer)
  }, [success])

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return
    setLoading(true)
    setError('')
    try {
      const data = await window.api.guestCRM.search(searchQuery)
      setResults(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err?.message || 'Search failed')
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [searchQuery])

  const loadProfile = async (customerId) => {
    setLoadingProfile(true)
    setError('')
    setNotesError('')
    try {
      const [profile, history] = await Promise.all([
        window.api.guestCRM.getProfile(customerId),
        window.api.guestCRM.getStayHistory(customerId)
      ])
      setProfileData(profile)
      setStayHistory(Array.isArray(history) ? history : [])
      setNotes(Array.isArray(profile?.notes) ? profile.notes : [])
      if (profile?.notesError) setNotesError(profile.notesError)
      setSelectedProfile(customerId)
    } catch (err) {
      setError(err?.message || 'Failed to load profile')
      setProfileData(null)
    } finally {
      setLoadingProfile(false)
    }
  }

  const handleSetVip = async () => {
    if (!selectedProfile) return
    if (!canVip) {
      setError('You do not have permission to set VIP levels.')
      return
    }
    try {
      await window.api.guestCRM.setVipLevel(selectedProfile, vipLevel)
      setShowVipModal(false)
      setSuccess('VIP level updated.')
      loadProfile(selectedProfile)
    } catch (err) {
      setError(err?.message || 'Failed to set VIP level')
    }
  }

  const handleAddPreference = async () => {
    if (!selectedProfile || !prefKey.trim()) return
    if (!canManage) {
      setError('You do not have permission to manage CRM preferences.')
      return
    }
    try {
      await window.api.guestCRM.addPreference(selectedProfile, prefKey.trim(), prefValue)
      setShowPreferenceModal(false)
      setPrefKey('')
      setPrefValue('')
      setSuccess('Preference added.')
      loadProfile(selectedProfile)
    } catch (err) {
      setError(err?.message || 'Failed to add preference')
    }
  }

  const handleSetBlacklist = async (blacklisted) => {
    if (!selectedProfile) return
    if (!canBlacklist) {
      setError('You do not have permission to manage the blacklist.')
      return
    }
    if (blacklisted && !blacklistReason.trim()) {
      setError('A reason is required when blacklisting a guest.')
      return
    }
    try {
      await window.api.guestCRM.setBlacklist(selectedProfile, blacklisted, blacklistReason)
      setShowBlacklistModal(false)
      setBlacklistReason('')
      setSuccess(blacklisted ? 'Guest blacklisted.' : 'Blacklist removed.')
      loadProfile(selectedProfile)
    } catch (err) {
      setError(err?.message || 'Failed to update blacklist')
    }
  }

  const handleRecordConsent = async (consentType, granted) => {
    if (!selectedProfile) return
    if (!canManage) {
      setError('You do not have permission to record consent.')
      return
    }
    try {
      await window.api.guestCRM.recordConsent(selectedProfile, consentType, granted)
      setSuccess(`Consent (${consentType}) recorded.`)
      loadProfile(selectedProfile)
    } catch (err) {
      setError(err?.message || 'Failed to record consent')
    }
  }

  const handleAddNote = async () => {
    if (!selectedProfile || !noteText.trim()) return
    if (!canManage) {
      setError('You do not have permission to add CRM notes.')
      return
    }
    try {
      await window.api.guestCRM.addNote(selectedProfile, noteText.trim(), 'staff')
      setShowNoteModal(false)
      setNoteText('')
      setSuccess('Note added.')
      loadProfile(selectedProfile)
    } catch (err) {
      setError(err?.message || 'Failed to add note')
    }
  }

  const loadVipList = async () => {
    setLoadingVipList(true)
    setError('')
    try {
      const data = await window.api.guestCRM.getVipList()
      setVipList(Array.isArray(data) ? data : [])
      setShowVipList(true)
    } catch (err) {
      setError(err?.message || 'Failed to load VIP list')
      setVipList([])
    } finally {
      setLoadingVipList(false)
    }
  }

  return (
    <div className="bb-page space-y-5">
      <div className="bb-page-header">
        <div>
          <p className="bb-section-kicker">ENTERPRISE</p>
          <h1 className="bb-page-header-title">Guest CRM</h1>
          <p className="bb-page-header-subtitle">Guest profiles, VIP management, preferences, notes, stay history, and consent</p>
        </div>
        <button onClick={loadVipList} className="btn-primary"><Crown size={15} /> VIP List</button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{success}</div>}

      <section className="bb-card p-5">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input w-full pl-9" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search guests by name, email, or phone..." onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }} />
          </div>
          <button onClick={handleSearch} disabled={loading} className="btn-primary"><Search size={15} /> Search</button>
        </div>
      </section>

      <div className={`grid grid-cols-1 gap-5 ${selectedProfile ? 'lg:grid-cols-[1fr_360px]' : ''}`}>
        <div className="space-y-4">
          {results.length > 0 && (
            <section className="bb-card p-5">
              <h2 className="text-sm font-bold text-slate-900">Search Results ({results.length})</h2>
              <div className="mt-3 space-y-2">
                {results.map((r) => (
                  <div key={r.customer_id} className={`flex cursor-pointer items-center justify-between rounded-xl border p-4 transition-colors hover:bg-slate-50 ${selectedProfile === r.customer_id ? 'border-slate-900 bg-slate-50' : 'border-slate-200'}`} onClick={() => loadProfile(r.customer_id)}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{r.name}</span>
                        <VipBadge level={r.vip_level} />
                        {r.blacklisted && <Ban size={14} className="text-red-500" />}
                        {r.watchlisted && <Eye size={14} className="text-amber-500" />}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{r.email} {r.phone ? `| ${r.phone}` : ''}</p>
                      <p className="text-xs text-slate-400">Stays: {r.stay_count} | LTV: {formatCurrency(r.lifetime_value)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {selectedProfile && profileData && (
            <>
              {loadingProfile && <p className="text-sm text-slate-500">Loading profile...</p>}

              {!loadingProfile && profileData?.profile && (
                <>
                  <section className="bb-card p-5">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-bold text-slate-900">CRM Profile</h2>
                      <div className="flex gap-1">
                        {canVip && (
                          <button onClick={() => { setVipLevel(profileData.profile?.vip_level || 'standard'); setShowVipModal(true) }} className="btn-ghost p-2" title="Set VIP level"><Crown size={15} /></button>
                        )}
                        {canManage && (
                          <>
                            <button onClick={() => setShowPreferenceModal(true)} className="btn-ghost p-2" title="Add preference"><Star size={15} /></button>
                            <button onClick={() => setShowNoteModal(true)} className="btn-ghost p-2" title="Add note"><StickyNote size={15} /></button>
                          </>
                        )}
                        {canBlacklist && (
                          <button onClick={() => setShowBlacklistModal(true)} className="btn-ghost p-2" title="Blacklist"><Ban size={15} /></button>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-700">VIP:</span>
                        <VipBadge level={profileData.profile?.vip_level || 'standard'} />
                      </div>
                      <p><span className="font-semibold text-slate-700">Stays:</span> {profileData.profile?.stay_count || 0}</p>
                      <p><span className="font-semibold text-slate-700">Lifetime Value:</span> {formatCurrency(profileData.profile?.lifetime_value)}</p>
                      {profileData.profile?.blacklisted && <p className="flex items-center gap-1 text-red-600"><Ban size={14} /> Blacklisted: {profileData.profile?.blacklist_reason || 'No reason'}</p>}
                      {profileData.profile?.watchlisted && <p className="flex items-center gap-1 text-amber-600"><Eye size={14} /> Watchlisted: {profileData.profile?.watchlist_reason || 'No reason'}</p>}
                    </div>
                  </section>

                  {profileData.profile?.preferences && Object.keys(profileData.profile.preferences).length > 0 && (
                    <section className="bb-card p-5">
                      <h2 className="text-sm font-bold text-slate-900">Preferences</h2>
                      <div className="mt-3 space-y-1">
                        {Object.entries(profileData.profile.preferences).map(([key, value]) => (
                          <div key={key} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                            <span className="font-semibold text-slate-600">{key}:</span>
                            <span className="text-slate-800">{String(value)}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  <section className="bb-card p-5">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-bold text-slate-900">Staff Notes</h2>
                      {canManage && (
                        <button onClick={() => setShowNoteModal(true)} className="btn-ghost text-xs">Add note</button>
                      )}
                    </div>
                    {notesError && (
                      <p className="mt-2 text-xs text-amber-700">{notesError}</p>
                    )}
                    <div className="mt-3 space-y-2">
                      {notes.length === 0 && !notesError && <p className="text-sm text-slate-500">No notes yet.</p>}
                      {notes.map((n) => (
                        <div key={n.id || n.created_at} className="rounded-xl border border-slate-200 p-3 text-sm">
                          <p className="text-slate-800">{n.payload?.text || n.text || n.note || JSON.stringify(n.payload || {})}</p>
                          <p className="mt-1 text-xs text-slate-400">
                            {n.note_type || 'note'} · {n.created_at ? new Date(n.created_at).toLocaleString() : ''}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>

                  {stayHistory.length > 0 && (
                    <section className="bb-card p-5">
                      <h2 className="text-sm font-bold text-slate-900">Stay History ({stayHistory.length})</h2>
                      <div className="mt-3 space-y-2">
                        {stayHistory.map((stay) => (
                          <div key={stay.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-slate-900">{stay.check_in} → {stay.check_out}</span>
                              <span className="text-slate-600">{stay.room_type || 'N/A'}</span>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">Amount: {formatCurrency(stay.total_amount)} | Paid: {formatCurrency(stay.paid_amount)}</p>
                            {stay.notes && <p className="mt-1 text-xs text-slate-400">{stay.notes}</p>}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  <section className="bb-card p-5">
                    <h2 className="text-sm font-bold text-slate-900">Consent Log</h2>
                    <div className="mt-3 space-y-2">
                      {(!profileData.consents || profileData.consents.length === 0) && <p className="text-sm text-slate-500">No consent records.</p>}
                      {Array.isArray(profileData.consents) && profileData.consents.map((c) => (
                        <div key={c.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                          <span className="text-slate-700">{c.consent_type}</span>
                          <span className={`flex items-center gap-1 font-semibold ${c.granted ? 'text-emerald-600' : 'text-red-600'}`}>
                            {c.granted ? <ThumbsUp size={14} /> : <ThumbsDown size={14} />}
                            {c.granted ? 'Granted' : 'Denied'}
                          </span>
                        </div>
                      ))}
                      {canManage && (
                        <div className="mt-3">
                          <p className="text-xs font-semibold text-slate-600 mb-2">Record new consent:</p>
                          <div className="flex flex-wrap gap-2">
                            {CONSENT_TYPES.map((type) => (
                              <div key={type} className="flex gap-1">
                                <button onClick={() => handleRecordConsent(type, true)} className="rounded-lg border border-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">{type} +</button>
                                <button onClick={() => handleRecordConsent(type, false)} className="rounded-lg border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">{type} -</button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </section>
                </>
              )}

              {!loadingProfile && profileData && !profileData.profile && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  No CRM profile found for this guest yet. {canManage ? 'VIP, preferences, or notes actions will create one.' : 'Ask a manager to create a CRM profile.'}
                </div>
              )}
            </>
          )}
        </div>

        {selectedProfile && profileData?.customer && (
          <aside className="space-y-4">
            <section className="bb-card p-5">
              <h2 className="text-sm font-bold text-slate-900">Customer</h2>
              <div className="mt-3 space-y-2 text-sm">
                <p><span className="font-semibold text-slate-700">Name:</span> {profileData.customer.name}</p>
                <p><span className="font-semibold text-slate-700">Email:</span> {profileData.customer.email}</p>
                <p><span className="font-semibold text-slate-700">Phone:</span> {profileData.customer.phone || 'N/A'}</p>
              </div>
            </section>
          </aside>
        )}
      </div>

      {showVipModal && (
        <Modal title="Set VIP Level" onClose={() => setShowVipModal(false)}>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-slate-600">VIP Level</label>
              <select value={vipLevel} onChange={(e) => setVipLevel(e.target.value)} className="input w-full">
                {VIP_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowVipModal(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleSetVip} className="btn-primary">Save</button>
            </div>
          </div>
        </Modal>
      )}

      {showPreferenceModal && (
        <Modal title="Add Preference" onClose={() => setShowPreferenceModal(false)}>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-slate-600">Key</label>
              <input className="input w-full" value={prefKey} onChange={(e) => setPrefKey(e.target.value)} placeholder="e.g. pillow_type, floor_preference" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Value</label>
              <input className="input w-full" value={prefValue} onChange={(e) => setPrefValue(e.target.value)} placeholder="e.g. feather, high_floor" />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowPreferenceModal(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleAddPreference} className="btn-primary">Add</button>
            </div>
          </div>
        </Modal>
      )}

      {showNoteModal && (
        <Modal title="Add Staff Note" onClose={() => setShowNoteModal(false)}>
          <div className="space-y-3">
            <textarea className="input w-full" rows={4} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Operational note for staff..." />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNoteModal(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleAddNote} className="btn-primary" disabled={!noteText.trim()}>Save note</button>
            </div>
          </div>
        </Modal>
      )}

      {showBlacklistModal && (
        <Modal title="Blacklist Management" onClose={() => setShowBlacklistModal(false)}>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-slate-600">Reason (required for blacklisting)</label>
              <textarea className="input w-full" rows={3} value={blacklistReason} onChange={(e) => setBlacklistReason(e.target.value)} placeholder="Reason for blacklisting..." />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowBlacklistModal(false)} className="btn-secondary">Cancel</button>
              <button onClick={() => handleSetBlacklist(true)} className="btn-danger">Blacklist</button>
              <button onClick={() => handleSetBlacklist(false)} className="btn-primary">Remove Blacklist</button>
            </div>
          </div>
        </Modal>
      )}

      {showVipList && (
        <Modal title="VIP List" onClose={() => setShowVipList(false)}>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {loadingVipList && <p className="text-sm text-slate-500">Loading...</p>}
            {!loadingVipList && vipList.length === 0 && <p className="text-sm text-slate-500">No VIP guests.</p>}
            {vipList.map((v) => (
              <div key={v.customer_id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{v.name}</span>
                    <VipBadge level={v.vip_level} />
                  </div>
                  <p className="text-xs text-slate-500">{v.email} | Stays: {v.stay_count} | LTV: {formatCurrency(v.lifetime_value)}</p>
                </div>
                <button onClick={() => { setShowVipList(false); loadProfile(v.customer_id) }} className="btn-ghost p-2"><Eye size={15} /></button>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {confirmDialog && <ConfirmDialog {...confirmDialog} />}
    </div>
  )
}
