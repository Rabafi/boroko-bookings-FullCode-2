import { useCallback, useEffect, useMemo, useState, useContext } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import {
  LogOut,
  Search,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Lock,
  Sparkles
} from 'lucide-react'
import { useAuth, useSettings, useAccess, useFeatures, UnsavedChangesContext } from '../../app-context'
import { productLogoLight } from '../../assets/productLogos'
import CommandPalette from '../CommandPalette'
import OfflineNotice from '../shared/OfflineNotice'
import {
  HOTEL_STANDALONE,
  HOTEL_NAV_GROUPS,
  HOTEL_MORE_ITEMS,
  getHotelPageMeta,
  getHotelSearchItems,
  getHotelEffectiveAddons,
  annotateHotelNavItem,
  pathMatchesHotelItem
} from './hotelNav'
import './hotelTheme.css'
import { PRODUCT_BRANDS } from '../../../../shared/brandIdentity'

const HOTEL_BRAND_NAME = PRODUCT_BRANDS.hotel.name

function initials(name = '', email = '') {
  const source = String(name || email || 'H').trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

function NavLinkButton({ item, active, collapsed, onClick }) {
  const Icon = item.icon
  const locked = item.isLocked === true
  return (
    <button
      type="button"
      className={`ht-nav-link${active ? ' is-active' : ''}${locked ? ' is-locked' : ''}`}
      onClick={onClick}
      title={collapsed ? `${item.label}${locked ? ' (add-on)' : ''}` : (locked ? (item.pitch || 'Available as an add-on') : undefined)}
    >
      {Icon ? <Icon size={17} /> : null}
      {!collapsed && (
        <>
          <span className="ht-nav-label">{item.label}</span>
          {locked ? (
            <span className="ht-nav-lock" aria-label="Locked add-on">
              <Lock size={11} />
              <em>{item.lockBadge || 'Add-on'}</em>
            </span>
          ) : null}
        </>
      )}
      {collapsed && locked ? <Lock size={11} className="ht-nav-lock-dot" /> : null}
    </button>
  )
}

export default function HotelLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const { settings } = useSettings()
  const access = useAccess()
  const features = useFeatures()
  const navGuard = useContext(UnsavedChangesContext)

  const [collapsed, setCollapsed] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(true)
  const [syncStatus, setSyncStatus] = useState({
    pending: 0,
    failed: 0,
    syncInProgress: false,
    isOnline: true,
    financialFailedCount: 0
  })

  const lockContext = useMemo(() => {
    const entitlement = access?.entitlement || {}
    const addons = getHotelEffectiveAddons(entitlement)
    // Prefer live feature map from context; fall back to entitlement snapshot
    const featureMap = (features && Object.keys(features).length > 0)
      ? features
      : (entitlement.effective_features || {})
    return { features: featureMap, addons }
  }, [access?.entitlement, features])

  const primaryGroups = useMemo(() => (
    HOTEL_NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.map((item) => annotateHotelNavItem(item, lockContext))
    }))
  ), [lockContext])

  const moreItems = useMemo(() => {
    const assistantEnabled = settings?.assistant_enabled === true
    return HOTEL_MORE_ITEMS
      .filter((item) => assistantEnabled || item.to !== '/ai')
      .map((item) => annotateHotelNavItem(item, lockContext))
  }, [lockContext, settings?.assistant_enabled])

  const lockedMoreCount = useMemo(
    () => moreItems.filter((item) => item.isLocked).length,
    [moreItems]
  )

  useEffect(() => {
    const root = document.documentElement
    root.dataset.product = 'hotel'
    document.title = HOTEL_BRAND_NAME
    return () => {
      if (root.dataset.product === 'hotel') delete root.dataset.product
    }
  }, [])

  useEffect(() => {
    let active = true
    const poll = async () => {
      try {
        const status = await window.api?.sync?.getStatus?.()
        if (active && status) setSyncStatus((prev) => ({ ...prev, ...status }))
      } catch {
        // best effort
      }
    }
    poll()
    const interval = setInterval(poll, 20_000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Keep More open when user lands on a More route
  useEffect(() => {
    const onMore = moreItems.some((item) => pathMatchesHotelItem(location.pathname + location.search, item)
      || pathMatchesHotelItem(location.pathname, item))
    if (onMore) setMoreOpen(true)
  }, [location.pathname, location.search, moreItems])

  const propertyName = settings?.lodge_name || settings?.company_name || 'Hotel property'
  const pageMeta = useMemo(() => getHotelPageMeta(location.pathname), [location.pathname])
  const searchableItems = useMemo(
    () => getHotelSearchItems({ includeLocked: true, ...lockContext }),
    [lockContext]
  )

  const go = useCallback((to) => {
    if (!to) return
    const run = () => navigate(to)
    if (to !== location.pathname && navGuard?.current?.isDirty) {
      navGuard.current.confirmLeave(run)
      return
    }
    run()
  }, [location.pathname, navGuard, navigate])

  const handlePaletteSelect = (item) => {
    if (!item?.to) return
    setPaletteOpen(false)
    go(item.to)
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const failed = Number(syncStatus.failed || 0)
  const financialFailed = Number(syncStatus.financialFailedCount || 0)
  const pending = Number(syncStatus.pending || 0)
  const syncTone = financialFailed > 0 || failed > 0
    ? 'danger'
    : syncStatus.isOnline === false
      ? 'offline'
      : pending > 0 || syncStatus.syncInProgress
        ? 'warn'
        : 'ok'
  const syncLabel = financialFailed > 0
    ? `${financialFailed} critical`
    : failed > 0
      ? `${failed} need review`
      : syncStatus.isOnline === false
        ? 'Offline'
        : syncStatus.syncInProgress
          ? 'Syncing'
          : pending > 0
            ? `${pending} pending`
            : 'Synced'

  return (
    <div className="ht-shell">
      <aside className={`ht-sidebar${collapsed ? ' is-collapsed' : ''}`}>
        <div className="ht-sidebar-glow" aria-hidden />
        <div className="ht-sidebar-head">
          <div className="ht-sidebar-brand-row">
            {!collapsed && (
              <div className="ht-sidebar-brand">
                <img src={productLogoLight} alt={HOTEL_BRAND_NAME} className="h-16 w-48 max-w-full object-contain object-left" draggable="false" />
                <p className="ht-sidebar-title">Operations</p>
              </div>
            )}
            <button
              type="button"
              className="ht-collapse-btn"
              onClick={() => setCollapsed((v) => !v)}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          </div>
          {!collapsed && (
            <div className="ht-workspace-card">
              <p className="label">Property</p>
              <p className="name">{propertyName}</p>
              <p className="sub">Hotel operations · {access?.roleLabel || user?.role || 'Staff'}</p>
            </div>
          )}
        </div>

        <nav className="ht-sidebar-nav" aria-label="Hotel navigation">
          {HOTEL_STANDALONE.map((item) => {
            const annotated = annotateHotelNavItem(item, lockContext)
            const active = pathMatchesHotelItem(location.pathname, annotated)
            return (
              <NavLinkButton
                key={item.id || item.to}
                item={annotated}
                active={active}
                collapsed={collapsed}
                onClick={() => go(item.to)}
              />
            )
          })}

          {primaryGroups.map((group) => (
            <div key={group.name} className="ht-nav-group">
              <div className="ht-nav-group-label">
                <span>{group.name}</span>
              </div>
              {group.items.map((item) => {
                const active = pathMatchesHotelItem(location.pathname + location.search, item)
                  || pathMatchesHotelItem(location.pathname, item)
                return (
                  <NavLinkButton
                    key={item.to}
                    item={item}
                    active={active}
                    collapsed={collapsed}
                    onClick={() => go(item.to)}
                  />
                )
              })}
            </div>
          ))}

          {/* More — secondary tools + locked add-ons for discovery / upsell */}
          <div className="ht-nav-group ht-nav-more">
            <button
              type="button"
              className={`ht-nav-more-toggle${moreOpen ? ' is-open' : ''}`}
              onClick={() => setMoreOpen((v) => !v)}
              title={collapsed ? 'More' : undefined}
              aria-expanded={moreOpen}
            >
              <Sparkles size={17} />
              {!collapsed && (
                <>
                  <span className="ht-nav-label">More</span>
                  {lockedMoreCount > 0 ? (
                    <span className="ht-nav-more-count" title="Available add-ons">
                      {lockedMoreCount} add-on{lockedMoreCount === 1 ? '' : 's'}
                    </span>
                  ) : null}
                  <ChevronDown size={14} className={`ht-nav-more-chevron${moreOpen ? ' is-open' : ''}`} />
                </>
              )}
            </button>

            {(moreOpen || collapsed) && (
              <div className="ht-nav-more-list">
                {!collapsed && lockedMoreCount > 0 ? (
                  <p className="ht-nav-more-hint">
                    Locked items are add-ons you can request — open one to learn more.
                  </p>
                ) : null}
                {moreItems.map((item) => {
                  const active = pathMatchesHotelItem(location.pathname + location.search, item)
                    || pathMatchesHotelItem(location.pathname, item)
                  return (
                    <NavLinkButton
                      key={item.to}
                      item={item}
                      active={active}
                      collapsed={collapsed}
                      onClick={() => go(item.to)}
                    />
                  )
                })}
              </div>
            )}
          </div>
        </nav>

        <div className="ht-sidebar-foot">
          <button
            type="button"
            className={`ht-nav-link${location.pathname.startsWith('/settings') ? ' is-active' : ''}`}
            onClick={() => go('/settings')}
            title={collapsed ? 'Settings' : undefined}
          >
            <Settings size={17} />
            {!collapsed && <span>Settings</span>}
          </button>
          <button
            type="button"
            className="ht-nav-link"
            onClick={handleLogout}
            title={collapsed ? 'Sign out' : undefined}
          >
            <LogOut size={17} />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      <div className="ht-main-col">
        <header className="ht-topbar">
          <div className="ht-page-head">
            <p className="ht-page-kicker">{pageMeta.kicker}</p>
            <h1 className="ht-page-title">{pageMeta.title}</h1>
            {!collapsed && pageMeta.sub ? (
              <p className="ht-page-sub">{pageMeta.sub}</p>
            ) : null}
          </div>

          <div className="ht-top-actions">
            <span className={`ht-chip ${syncTone}`}>{syncLabel}</span>
            <button type="button" className="ht-icon-btn" title="Search (Ctrl+K)" onClick={() => setPaletteOpen(true)}>
              <Search size={16} />
            </button>
            <button type="button" className="ht-text-btn primary" onClick={() => go('/bookings')}>
              New reservation
            </button>
            <div className="ht-avatar" title={user?.name || user?.email || 'User'}>
              {initials(user?.name, user?.email)}
            </div>
          </div>
        </header>

        <div className="ht-workspace">
          <main className="ht-main">
            <OfflineNotice />
            <Outlet />
          </main>
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={searchableItems}
        onSelect={handlePaletteSelect}
        currentPath={location.pathname}
      />
    </div>
  )
}
