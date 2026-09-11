import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { createPortal } from 'react-dom'
import {
  Bell, Wifi, WifiOff, Clock, User, ChevronDown,
  RefreshCw, Plus, LogOut, Settings, ShieldCheck, Database, Search, Rows3,
  BookOpen, ExternalLink, Download, Loader2, X
} from 'lucide-react'
import { isBarOnlyMode } from '../../../../shared/propertyTypes'
import { getUiVocabulary } from '../../../../shared/uiVocabulary'
import { productLogoColor } from '../../assets/productLogos'

function SyncIndicator({ syncStatus, onOpenHealth }) {
  const isOnline = syncStatus?.isOnline !== false
  const pending = syncStatus?.pending || 0
  const failed = syncStatus?.failed || 0
  const syncInProgress = syncStatus?.syncInProgress
  const needsAttention = !isOnline || pending > 0 || failed > 0

  return (
    <button
      type="button"
      onClick={onOpenHealth}
      title="Open System Health"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        borderRadius: '999px',
        background: needsAttention
          ? (failed > 0 || !isOnline ? 'rgba(239, 68, 68, 0.1)' : 'rgba(245, 158, 11, 0.12)')
          : 'rgba(73, 122, 139, 0.1)',
        border: `1px solid ${needsAttention
          ? (failed > 0 || !isOnline ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.25)')
          : 'rgba(73, 122, 139, 0.2)'}`,
        fontSize: '11px',
        fontWeight: 600,
        color: needsAttention
          ? (failed > 0 || !isOnline ? '#b84a38' : '#c95635')
          : '#356676',
        cursor: 'pointer'
      }}
    >
      {syncInProgress ? (
        <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />
      ) : isOnline ? (
        <Wifi size={12} />
      ) : (
        <WifiOff size={12} />
      )}
      <span>
        {isOnline
          ? (failed > 0 ? `${failed} failed` : pending > 0 ? `${pending} pending` : 'Online')
          : 'Offline'}
      </span>
    </button>
  )
}

function LiveClock() {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      color: '#7b7a70',
      fontSize: '12px',
      fontWeight: 500,
      fontVariantNumeric: 'tabular-nums'
    }}>
      <Clock size={13} />
      <span>{time.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · {time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
    </div>
  )
}

function TrialStatusIndicator({ trialStatus, onOpenSubscription }) {
  if (trialStatus?.status !== 'trial') return null
  const daysLeft = Number(trialStatus?.daysLeft ?? trialStatus?.days_left)
  if (!Number.isInteger(daysLeft) || daysLeft < 1) return null

  const urgent = daysLeft <= 3
  const label = daysLeft === 1 ? 'Last trial day' : `${daysLeft} trial days left`
  return (
    <button
      type="button"
      onClick={onOpenSubscription}
      title="Open subscription details"
      aria-label={`${label}. Open subscription details.`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        borderRadius: '999px',
        background: urgent ? 'rgba(245, 158, 11, 0.12)' : 'rgba(37, 99, 235, 0.10)',
        border: `1px solid ${urgent ? 'rgba(245, 158, 11, 0.30)' : 'rgba(37, 99, 235, 0.22)'}`,
        color: urgent ? '#a16207' : '#1d4ed8',
        fontSize: '11px',
        fontWeight: 700,
        cursor: 'pointer',
        fontVariantNumeric: 'tabular-nums'
      }}
    >
      <Clock size={13} aria-hidden="true" />
      <span>{label}</span>
    </button>
  )
}

function HposBarGuidesPanel({ settings, onClose }) {
  const [manifest, setManifest] = useState(null)
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(null)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const result = await window.api?.barGuides?.getManifest?.()
        if (!active) return
        setManifest(result?.success ? result : null)
        if (!result?.success) {
          setStatus({ tone: 'error', text: result?.error || 'The guides are unavailable in this app build.' })
        }
      } catch (error) {
        if (active) setStatus({ tone: 'error', text: error?.message || 'The guides are unavailable in this app build.' })
      }
    }
    load()
    return () => { active = false }
  }, [])

  const runGuideAction = async (documentId, action) => {
    setBusy(action + ':' + documentId)
    setStatus(null)
    try {
      const result = await window.api?.barGuides?.[action]?.(documentId)
      if (result?.success) {
        setStatus({
          tone: 'success',
          text: action === 'save' ? 'Guide saved successfully.' : 'Guide opened in your PDF viewer.'
        })
      } else if (!result?.canceled) {
        setStatus({ tone: 'error', text: result?.error || 'The guide action could not be completed. Try Save PDF.' })
      }
    } catch (error) {
      setStatus({ tone: 'error', text: error?.message || 'The guide action could not be completed. Try Save PDF.' })
    } finally {
      setBusy(null)
    }
  }

  const documents = manifest?.documents || []
  return (
    <div
      className="hpos-guides-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
        background: 'rgba(31, 24, 28, .42)',
        backdropFilter: 'blur(8px)'
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="hpos-guides-title"
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          width: 'min(620px, 100%)',
          maxHeight: 'min(720px, calc(100vh - 48px))',
          overflowY: 'auto',
          padding: '24px',
          border: '1px solid rgba(255,255,255,.72)',
          borderRadius: '22px',
          background: '#fffdf8',
          boxShadow: '0 28px 90px rgba(31,24,28,.28)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
          <div>
            <p className="hpos-eyebrow">Offline reference</p>
            <h2 id="hpos-guides-title" style={{ margin: '4px 0 6px', color: '#2f2830', fontSize: '24px', letterSpacing: '-.03em' }}>Help &amp; guides</h2>
            <p style={{ margin: 0, color: '#756a70', fontSize: '12px', lineHeight: 1.55 }}>These guides are included with your app and are available offline.</p>
            {manifest?.appVersion && <p style={{ margin: '8px 0 0', color: '#968a90', fontSize: '10px', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>App {manifest.appVersion} · reviewed {manifest.reviewDate}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close Help & guides" title="Close" style={{ display: 'grid', placeItems: 'center', width: '36px', height: '36px', flexShrink: 0, border: '1px solid #ded3d8', borderRadius: '11px', background: '#fff', color: '#6b5f66', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'grid', gap: '10px', marginTop: '20px' }}>
          {documents.map((document) => (
            <article key={document.id} style={{ padding: '14px', border: '1px solid #e5dce0', borderRadius: '16px', background: '#fbf7f2' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                <div>
                  <h3 style={{ margin: 0, color: '#342b31', fontSize: '14px' }}>{document.label}</h3>
                  {document.revision && <p style={{ margin: '4px 0 0', color: '#968a90', fontSize: '10px' }}>Revision {document.revision}</p>}
                </div>
                <BookOpen size={16} color="#39705d" aria-hidden="true" />
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <button type="button" onClick={() => runGuideAction(document.id, 'open')} disabled={busy !== null} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '7px', flex: 1, minHeight: '40px', border: 0, borderRadius: '11px', background: '#39705d', color: '#fff', fontSize: '12px', fontWeight: 800, cursor: 'pointer' }}>
                  {busy === 'open:' + document.id ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
                  Open {document.id === 'bar-manual' ? 'manual' : 'quick-start'}
                </button>
                <button type="button" onClick={() => runGuideAction(document.id, 'save')} disabled={busy !== null} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '7px', flex: 1, minHeight: '40px', border: '1px solid #cfc2c8', borderRadius: '11px', background: '#fff', color: '#4b4047', fontSize: '12px', fontWeight: 800, cursor: 'pointer' }}>
                  {busy === 'save:' + document.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  Save PDF
                </button>
              </div>
            </article>
          ))}
          {!manifest && !status && <p style={{ margin: 0, color: '#756a70', fontSize: '12px' }}>Loading guide information…</p>}
        </div>
        {status && <p role="status" style={{ margin: '16px 0 0', padding: '11px 12px', border: '1px solid ' + (status.tone === 'error' ? '#e1aaa0' : '#b7d9c9'), borderRadius: '12px', background: status.tone === 'error' ? '#fff0eb' : '#edf8f2', color: status.tone === 'error' ? '#a94430' : '#39705d', fontSize: '12px', lineHeight: 1.45 }}>{status.text}</p>}
      </section>
    </div>
  )
}
export default function HposNav({ settings, user, syncStatus, trialStatus, isPosRoute, onClockIn, onLogout, onNotifications, onSearch, density, onDensityChange, barOnly: barOnlyProp }) {
  const navigate = useNavigate()
  const [showProfile, setShowProfile] = useState(false)
  const [showGuides, setShowGuides] = useState(false)

  const barOnly = barOnlyProp ?? isBarOnlyMode(settings)
  const vocab = getUiVocabulary({ settings, propertyType: settings?.property_type || settings?.business_type })
  const workspaceName = settings?.lodge_name || settings?.company_name || vocab.nameFallback
  const workspaceType = barOnly ? 'Bar' : 'Restaurant & Bar'
  const activeOutlet = settings?.outlet_name || settings?.default_outlet_name || settings?.outlet?.name
  const goTo = (route) => {
    setShowProfile(false)
    navigate(route)
  }

  return (
    <header className="hpos-topbar" style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: '62px',
      padding: '0 24px',
      background: 'rgba(255,253,248,.94)',
      borderBottom: '1px solid rgba(55,70,57,.13)',
      boxShadow: '0 7px 24px rgba(47,58,47,.07)',
      backdropFilter: 'blur(16px)',
      flexShrink: 0,
      zIndex: 100
    }}>
      {/* Business identity comes first: operators should always know whose service they are running. */}
      <div className="hpos-topbar-brand">
        <img className="hpos-topbar-product-logo" src={productLogoColor} alt="Tsa Bonno Restaurant & Bar OS" draggable="false" />
        <div className="hpos-topbar-divider" aria-hidden="true" />
        <div className="hpos-topbar-workspace" title={workspaceName}>
          <strong>{workspaceName}</strong>
          <span>{workspaceType}{activeOutlet ? ` · ${activeOutlet}` : ''}</span>
        </div>
      </div>

      {/* Center: Quick Actions */}
      {!isPosRoute && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={onClockIn}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 12px',
              borderRadius: '8px',
              border: '1px solid rgba(245, 158, 11, 0.2)',
              background: 'rgba(245, 158, 11, 0.08)',
              color: '#c95635',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 120ms ease'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(245, 158, 11, 0.15)'
              e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.3)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(245, 158, 11, 0.08)'
              e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.2)'
            }}
          >
            <Plus size={13} />
            <span>New Order</span>
          </button>
        </div>
      )}

      {/* Right: Status + Search + Profile */}
      <div className="hpos-topbar-utilities">
        <button type="button" className="hpos-command-trigger" onClick={onSearch} aria-label={`Search ${barOnly ? 'bar' : 'restaurant'} workspaces and actions`}><Search size={15}/><span>Search anything…</span><kbd>Ctrl K</kbd></button>
        <LiveClock />

        <TrialStatusIndicator
          trialStatus={trialStatus}
          onOpenSubscription={() => goTo('/settings?tab=license')}
        />

        <SyncIndicator
          syncStatus={syncStatus}
          onOpenHealth={() => goTo('/hpos/system-health')}
        />

        {/* Do not show a permanent alert marker: it would become background noise. */}
        <button onClick={onNotifications} title="Open operational control" aria-label="Open operational control" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '32px',
          height: '32px',
          borderRadius: '8px',
          border: '1px solid rgba(55,70,57,.14)',
          background: 'transparent',
          color: '#7b7a70',
          cursor: 'pointer',
          position: 'relative',
          transition: 'all 120ms ease'
        }}>
          <Bell size={15} />
        </button>

        {/* Profile */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowProfile(!showProfile)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 8px 4px 4px',
              borderRadius: '8px',
              border: '1px solid rgba(55,70,57,.14)',
              background: showProfile ? 'rgba(201,86,53,.08)' : 'transparent',
              color: '#24362c',
              cursor: 'pointer',
              transition: 'all 120ms ease'
            }}
          >
            <div style={{
              width: '26px',
              height: '26px',
              borderRadius: '7px',
              background: 'linear-gradient(135deg, #7b4a61, #3b2733)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '11px',
              fontWeight: 700,
              color: '#fff'
            }}>
              {user?.name?.charAt(0)?.toUpperCase() || 'U'}
            </div>
            <span className="hpos-profile-identity"><b>{user?.name?.split(' ')[0] || 'User'}</b><small>{user?.role || 'Team member'}</small></span>
            <ChevronDown size={12} style={{ color: '#7b7a70' }} />
          </button>

          {showProfile && (
            <>
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 998 }}
                onClick={() => setShowProfile(false)}
              />
              <div style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '6px',
                width: '180px',
                background: '#fffdf8',
                border: '1px solid rgba(55,70,57,.16)',
                borderRadius: '10px',
                boxShadow: '0 18px 48px rgba(47,58,47,.22)',
                zIndex: 999,
                overflow: 'hidden'
              }}>
                <div style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid rgba(55,70,57,.10)'
                }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#24362c' }}>
                    {user?.name || 'User'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#7b7a70', marginTop: '2px' }}>
                    {user?.email || ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onDensityChange}
                  style={{display:'flex',alignItems:'center',gap:'8px',width:'100%',padding:'9px 14px',border:'none',background:'transparent',color:'#24362c',fontSize:'12px',fontWeight:600,cursor:'pointer',textAlign:'left'}}
                ><Rows3 size={14}/>{density === 'touch' ? 'Use compact density' : 'Use touch density'}</button>
                {barOnly && (
                  <button
                    type="button"
                    onClick={() => { setShowProfile(false); setShowGuides(true) }}
                    aria-haspopup="dialog"
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                      padding: '9px 14px', border: 'none', background: 'transparent',
                      color: '#24362c', fontSize: '12px', fontWeight: 700, cursor: 'pointer', textAlign: 'left'
                    }}
                  >
                    <BookOpen size={14} />
                    Help &amp; guides
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => goTo('/settings')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                    padding: '9px 14px', border: 'none', background: 'transparent',
                    color: '#24362c', fontSize: '12px', fontWeight: 600, cursor: 'pointer', textAlign: 'left'
                  }}
                >
                  <Settings size={14} />
                  Settings
                </button>
                <button
                  type="button"
                  onClick={() => goTo('/hpos/system-health')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                    padding: '9px 14px', border: 'none', background: 'transparent',
                    color: '#24362c', fontSize: '12px', fontWeight: 600, cursor: 'pointer', textAlign: 'left'
                  }}
                >
                  <ShieldCheck size={14} />
                  System Health
                </button>
                <button
                  type="button"
                  onClick={() => goTo('/settings?tab=license')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                    padding: '9px 14px', border: 'none', background: 'transparent',
                    color: '#24362c', fontSize: '12px', fontWeight: 600, cursor: 'pointer', textAlign: 'left'
                  }}
                >
                  <Settings size={14} />
                  Subscription
                </button>
                <button
                  type="button"
                  onClick={() => goTo('/data-management')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                    padding: '9px 14px', border: 'none', background: 'transparent',
                    color: '#24362c', fontSize: '12px', fontWeight: 600, cursor: 'pointer', textAlign: 'left'
                  }}
                >
                  <Database size={14} />
                  Data & backup
                </button>
                <div style={{ height: 1, background: 'rgba(55,70,57,.10)' }} />
                <button onClick={() => onLogout?.()} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '9px 14px',
                  border: 'none',
                  background: 'transparent',
                  color: '#b84a38',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left'
                }}>
                  <LogOut size={14} />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {showGuides && <HposBarGuidesPanel settings={settings} onClose={() => setShowGuides(false)} />}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </header>
  )
}
