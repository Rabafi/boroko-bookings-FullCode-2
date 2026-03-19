import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth, useSettings, useFeatures } from '../App'
import {
  LayoutDashboard,
  BedDouble,
  CalendarDays,
  BookOpen,
  BarChart3,
  Users,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Settings,
  Grid3X3,
  Sparkles,
  UserRound,
  Wrench,
  Receipt,
  ShoppingCart,
  Package,
  Boxes,
  ClipboardList,
  Presentation,
  Waves,
  LifeBuoy,
  X,
  Upload,
  Lock,
  Zap,
  CheckCircle2,
  ArrowRight
} from 'lucide-react'

// ── Tier definitions (mirrors AdminCentral) ───────────────────────────────────
const TIERS = ['Starter', 'Standard', 'Pro']
const TIER_COLOR = { Starter: 'gray', Standard: 'blue', Pro: 'purple' }
const TIER_PRICE = { Starter: 'Free / Entry', Standard: 'Mid-tier', Pro: 'Full Suite' }
const TIER_FEATURES = {
  Starter: ['Dashboard', 'Bookings', 'Room Grid', 'Calendar', 'Rooms', 'Housekeeping', 'Guests', 'Maintenance', 'Settings'],
  Standard: ['Everything in Starter', 'Reports & Analytics', 'Expenses Tracking', 'Staff Management', 'Night Audit', 'Conference Rooms', 'Pool / Day Use', 'Import Data'],
  Pro: ['Everything in Standard', 'Point of Sale (POS)', 'Inventory Management', 'Room Supplies Tracker']
}

// ── Nav items per business type ───────────────────────────────────────────────
// tier: if set, item is locked when that feature flag is explicitly false
const ALL_NAV = [
  { to: '/',             label: 'Dashboard',    icon: LayoutDashboard, end: true,  types: ['lodge', 'restaurant'] },
  { to: '/bookings',     label: 'Bookings',     icon: BookOpen,                    types: ['lodge'] },
  { to: '/roomgrid',     label: 'Room Grid',    icon: Grid3X3,                     types: ['lodge'] },
  { to: '/calendar',     label: 'Calendar',     icon: CalendarDays,                types: ['lodge'] },
  { to: '/rooms',        label: 'Rooms',        icon: BedDouble,                   types: ['lodge'] },
  { to: '/housekeeping', label: 'Housekeeping', icon: Sparkles,                    types: ['lodge'] },
  { to: '/guests',       label: 'Guests',       icon: UserRound,                   types: ['lodge'] },
  { to: '/maintenance',  label: 'Maintenance',  icon: Wrench,                      types: ['lodge'] },
  { to: '/expenses',     label: 'Expenses',     icon: Receipt,                     types: ['lodge', 'restaurant'], feature: 'expenses',  tier: 'Standard' },
  { to: '/conference',   label: 'Conference',   icon: Presentation,                types: ['lodge'],               feature: 'conference', tier: 'Standard' },
  { to: '/dayuse',       label: 'Day Use',      icon: Waves,                       types: ['lodge'],               feature: 'pool',       tier: 'Standard' },
  { to: '/audit',        label: 'Night Audit',  icon: ClipboardList,               types: ['lodge', 'restaurant'], feature: 'audit',      tier: 'Standard' },
  { to: '/reports',      label: 'Reports',      icon: BarChart3,                   types: ['lodge', 'restaurant'], feature: 'reports',    tier: 'Standard' },
  { to: '/staff',        label: 'Staff',        icon: Users,                       types: ['lodge', 'restaurant'], feature: 'staff',      tier: 'Standard' },
  { to: '/import',       label: 'Import Data',  icon: Upload,                      types: ['lodge', 'restaurant'], feature: 'import',     tier: 'Standard' },
  { to: '/pos',          label: 'POS',          icon: ShoppingCart,                types: ['lodge', 'restaurant'], feature: 'pos',        tier: 'Pro' },
  { to: '/inventory',    label: 'Inventory',    icon: Package,                     types: ['lodge', 'restaurant'], feature: 'inventory',  tier: 'Pro' },
  { to: '/supplies',     label: 'Room Supplies',icon: Boxes,                       types: ['lodge'],               feature: 'supplies',   tier: 'Pro' },
  { to: '/settings',     label: 'Settings',     icon: Settings,                    types: ['lodge', 'restaurant'] }
]

// ── Support Ticket Modal ──────────────────────────────────────────────────────
function SupportModal({ onClose, settings }) {
  const [form, setForm] = useState({ title: '', description: '', category: 'General', priority: 'Normal' })
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async (e) => {
    e.preventDefault(); setSaving(true)
    await window.api.admin.createSupportTicket({
      lodge_id: settings?.lodge_id,
      lodge_name: settings?.lodge_name || settings?.company_name,
      ...form
    }).catch(() => {})
    setSaving(false); setDone(true)
    setTimeout(onClose, 1500)
  }

  const inp = "w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-start bg-black/40 p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-5 w-80" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white text-sm flex items-center gap-2"><LifeBuoy size={15} className="text-green-400" /> Submit Support Ticket</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
        </div>
        {done ? (
          <p className="text-green-400 text-sm text-center py-4">✓ Ticket submitted! We'll be in touch.</p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Title *</label>
              <input className={inp} placeholder="Briefly describe the issue" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Category</label>
                <select className={inp} value={form.category} onChange={e => setForm({...form, category: e.target.value})}>
                  {['General', 'Bug', 'Billing', 'Feature Request'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Priority</label>
                <select className={inp} value={form.priority} onChange={e => setForm({...form, priority: e.target.value})}>
                  {['Low', 'Normal', 'High', 'Urgent'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Description *</label>
              <textarea className={`${inp} h-20 resize-none`} placeholder="Describe the issue in detail…" value={form.description} onChange={e => setForm({...form, description: e.target.value})} required />
            </div>
            <button type="submit" disabled={saving} className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-60">
              {saving ? 'Submitting…' : 'Submit Ticket'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

// ── Upgrade Request Modal ─────────────────────────────────────────────────────
function UpgradeModal({ lockedItem, onClose, settings }) {
  const [selectedTier, setSelectedTier] = useState(lockedItem?.tier || 'Standard')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async () => {
    setSaving(true)
    const lodge_name = settings?.lodge_name || settings?.company_name || 'Unknown Lodge'
    await window.api.admin.createSupportTicket({
      lodge_id: settings?.lodge_id,
      lodge_name,
      title: `Upgrade Request — ${selectedTier} Plan`,
      description: `${lodge_name} is requesting an upgrade to the ${selectedTier} plan.\n\nThey tried to access: ${lockedItem?.label || 'a locked feature'}.\n\nPlease contact this client to arrange the upgrade.`,
      category: 'Upgrade Request',
      priority: 'High'
    }).catch(() => {})
    setSaving(false)
    setDone(true)
    setTimeout(onClose, 2000)
  }

  const tierBorder = { Starter: 'border-gray-500', Standard: 'border-blue-500', Pro: 'border-purple-500' }
  const tierBg    = { Starter: 'bg-gray-800',      Standard: 'bg-blue-900/40',  Pro: 'bg-purple-900/40' }
  const tierBadge = { Starter: 'bg-gray-700 text-gray-300', Standard: 'bg-blue-700 text-blue-100', Pro: 'bg-purple-700 text-purple-100' }
  const tierBtn   = { Starter: 'bg-gray-600 hover:bg-gray-500', Standard: 'bg-blue-600 hover:bg-blue-500', Pro: 'bg-purple-600 hover:bg-purple-500' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Lock size={18} className="text-yellow-400" />
            <h3 className="font-bold text-white text-base">Unlock {lockedItem?.label}</h3>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={18} /></button>
        </div>
        <p className="text-gray-400 text-xs mb-5">
          This feature requires a higher subscription plan. Choose a plan below and request an upgrade — we'll reach out to get you set up.
        </p>

        {done ? (
          <div className="text-center py-6">
            <CheckCircle2 size={40} className="text-green-400 mx-auto mb-3" />
            <p className="text-green-400 font-semibold">Upgrade request sent!</p>
            <p className="text-gray-400 text-sm mt-1">We'll contact you shortly to arrange the upgrade.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 mb-5">
              {TIERS.map(tier => (
                <button
                  key={tier}
                  onClick={() => setSelectedTier(tier)}
                  className={`rounded-xl border-2 p-3 text-left transition-all ${
                    selectedTier === tier
                      ? `${tierBorder[tier]} ${tierBg[tier]}`
                      : 'border-gray-700 bg-gray-800/50 opacity-70'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${tierBadge[tier]}`}>{tier}</span>
                    {selectedTier === tier && <CheckCircle2 size={13} className="text-green-400" />}
                  </div>
                  <p className="text-xs text-gray-300 mb-2">{TIER_PRICE[tier]}</p>
                  <ul className="space-y-1">
                    {TIER_FEATURES[tier].map(f => (
                      <li key={f} className="flex items-start gap-1 text-xs text-gray-300">
                        <Zap size={10} className="mt-0.5 flex-shrink-0 text-yellow-400" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </button>
              ))}
            </div>

            <button
              onClick={submit}
              disabled={saving}
              className={`w-full ${tierBtn[selectedTier]} text-white py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors`}
            >
              {saving ? 'Sending request…' : (
                <><ArrowRight size={15} /> Request Upgrade to {selectedTier}</>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const { settings } = useSettings()
  const features = useFeatures()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [upgradeItem, setUpgradeItem] = useState(null) // { label, tier } of locked item clicked

  const bizType = settings?.business_type || 'lodge'

  // Separate active items from locked items
  const { activeItems, lockedItems } = ALL_NAV.reduce(
    (acc, item) => {
      if (!item.types.includes(bizType)) return acc
      const isLocked = item.feature && Object.keys(features).length > 0 && features[item.feature] === false
      if (isLocked) {
        acc.lockedItems.push(item)
      } else {
        acc.activeItems.push(item)
      }
      return acc
    },
    { activeItems: [], lockedItems: [] }
  )

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const BIZ_EMOJI = { lodge: '🏕️', restaurant: '🍽️' }
  const BIZ_LABEL = { lodge: 'Lodge Manager', restaurant: 'Restaurant Manager' }

  const tierDot = { Standard: 'bg-blue-400', Pro: 'bg-purple-400' }

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      {/* Sidebar */}
      <div
        className={`${
          collapsed ? 'w-14' : 'w-56'
        } bg-green-900 text-white flex flex-col flex-shrink-0 transition-all duration-200`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-3 py-4 border-b border-green-800">
          {!collapsed && (
            <div>
              <span className="font-bold text-white">{BIZ_EMOJI[bizType] || '🏢'} Boroko</span>
              <p className="text-xs text-green-300 mt-0.5">{BIZ_LABEL[bizType] || 'Business Manager'}</p>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1.5 hover:bg-green-800 rounded-lg transition-colors ml-auto"
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        {/* Nav — scrollable area */}
        <nav className="flex-1 py-3 px-2 overflow-y-auto flex flex-col">
          {/* Active nav items */}
          <div className="space-y-0.5">
            {activeItems.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-green-600 text-white'
                      : 'text-green-200 hover:bg-green-800 hover:text-white'
                  }`
                }
                title={collapsed ? label : undefined}
              >
                <Icon size={17} className="flex-shrink-0" />
                {!collapsed && <span className="text-sm font-medium">{label}</span>}
              </NavLink>
            ))}
          </div>

          {/* Locked items — shown greyed out at bottom of nav */}
          {lockedItems.length > 0 && (
            <div className="mt-3 pt-3 border-t border-green-800/60 space-y-0.5">
              {!collapsed && (
                <p className="text-xs text-green-600 px-3 pb-1 font-medium tracking-wide uppercase">
                  Upgrade to unlock
                </p>
              )}
              {lockedItems.map(({ label, icon: Icon, tier }) => (
                <button
                  key={label}
                  onClick={() => setUpgradeItem({ label, tier })}
                  title={collapsed ? `${label} — ${tier} plan required` : undefined}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg w-full text-left opacity-40 hover:opacity-60 transition-opacity cursor-pointer group"
                >
                  <Icon size={17} className="flex-shrink-0 text-green-400" />
                  {!collapsed && (
                    <span className="text-sm font-medium text-green-300 flex-1">{label}</span>
                  )}
                  {!collapsed && tier && (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      tier === 'Pro' ? 'bg-purple-800 text-purple-200' : 'bg-blue-800 text-blue-200'
                    }`}>
                      {tier}
                    </span>
                  )}
                  <Lock size={12} className={`flex-shrink-0 ${collapsed ? 'text-green-400' : 'text-green-500'}`} />
                </button>
              ))}
            </div>
          )}
        </nav>

        {/* User + Logout */}
        <div className="border-t border-green-800 p-3">
          {!collapsed && (
            <div className="mb-2 px-1">
              <p className="text-xs text-green-400">Signed in as</p>
              <p className="text-sm font-medium text-white truncate">{user?.name}</p>
              <span className="text-xs text-green-300 capitalize bg-green-800 px-2 py-0.5 rounded-full">
                {user?.role}
              </span>
            </div>
          )}
          {/* Help / Support Ticket */}
          <button
            onClick={() => setShowHelp(true)}
            className="flex items-center gap-2 text-green-300 hover:text-white hover:bg-green-800 px-3 py-2 rounded-lg w-full transition-colors mb-1"
            title={collapsed ? 'Support' : undefined}
          >
            <LifeBuoy size={16} />
            {!collapsed && <span className="text-sm">Help / Support</span>}
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-green-300 hover:text-white hover:bg-green-800 px-3 py-2 rounded-lg w-full transition-colors"
            title={collapsed ? 'Sign out' : undefined}
          >
            <LogOut size={16} />
            {!collapsed && <span className="text-sm">Sign out</span>}
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>

      {/* Support ticket modal */}
      {showHelp && <SupportModal onClose={() => setShowHelp(false)} settings={settings} />}

      {/* Upgrade request modal */}
      {upgradeItem && (
        <UpgradeModal
          lockedItem={upgradeItem}
          onClose={() => setUpgradeItem(null)}
          settings={settings}
        />
      )}
    </div>
  )
}
