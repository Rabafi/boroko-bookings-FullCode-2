import { Link } from 'react-router'
import { useState } from 'react'
import {
  Bell,
  Briefcase,
  Building2,
  ClipboardCheck,
  FileText,
  LogOut,
  MessageCircle,
  Moon,
  Package,
  ReceiptText,
  Shield,
  ShoppingCart,
  Sun,
  Users,
  Volume2,
  Vibrate,
  WalletCards,
  Wrench
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useFeatures } from '../contexts/FeaturesContext'
import { getPwaShellConfig, isBarHospitalityMode } from '../lib/productShell'
import { getNotificationSettings, setNotificationSettings } from '../lib/runtime'
import { playTestSound, vibratePulse } from '../lib/notificationSound'

function SectionCard({ to, title, sub, icon: Icon }) {
  return (
    <Link to={to} className="bg-gray-800 rounded-2xl p-3 flex items-center gap-3 active:scale-[0.98] transition-transform">
      <div className="w-10 h-10 rounded-xl bg-gray-900 text-green-300 flex items-center justify-center shrink-0">
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>
      </div>
    </Link>
  )
}

function SectionGroup({ label, children }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-500 mb-2 px-1">{label}</p>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function NotifToggle({ label, description, icon: Icon, enabled, onChange }) {
  return (
    <div className="bg-gray-800 rounded-2xl p-3 flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-gray-900 text-green-300 flex items-center justify-center shrink-0">
        <Icon size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        onClick={onChange}
        className={`shrink-0 w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-green-600' : 'bg-gray-700'}`}
        aria-label={label}
      >
        <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  )
}

export default function More() {
  const { logout, user } = useAuth()
  const { can, features, isEnabled } = useFeatures()
  const shell = getPwaShellConfig(user?.product_family)
  const isRestaurant = shell.restaurantModules === true
  const barOnly = isRestaurant && isBarHospitalityMode(user?.hospitality_mode)
  const isAccommodation = shell.accommodationModules === true
  const isHotel = shell.productFamily === 'hotel'
  const isLodge = shell.productFamily === 'lodge-camp'
  const isDark = document.documentElement.classList.contains('dark-mode')
  const [notifPrefs, setNotifPrefs] = useState(() => getNotificationSettings())

  const updateNotifPref = (key) => {
    const next = { ...notifPrefs, [key]: !notifPrefs[key] }
    setNotifPrefs(next)
    setNotificationSettings(next)
    if (key === 'sound' && next.sound) playTestSound({ sound: true })
    if (key === 'vibration' && next.vibration) vibratePulse('reply', { vibration: true })
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-2 pb-3">
        <h1 className="text-lg font-bold text-white">Menu</h1>
        <p className="text-xs text-gray-400">
          {shell.productFamilyLabel}
          {user?.package_label ? ` · ${user.package_label}` : ''}
          {' · '}all manager pages in one place
        </p>
      </div>

      <div className="px-4 py-3 space-y-5">
        <SectionGroup label="Operations">
          <SectionCard to="/alerts" title="Alerts" sub="Urgent issues and follow-up" icon={Bell} />
          {isHotel && <SectionCard to="/hotel-dashboard" title="Front Desk" sub="Arrivals, departures, in-house stays, and rooms" icon={Building2} />}
          {isHotel && can('checkin.manage') && <SectionCard to="/checkin-workflow" title="Check-in / Out" sub="Guided hotel arrival and departure workflow" icon={ClipboardCheck} />}
          {isHotel && can('night_audit.checks') && <SectionCard to="/night-audit-enterprise" title="Night Audit" sub="Live close checks and hotel exceptions" icon={Shield} />}
          {isHotel && can('folios.view') && <SectionCard to="/folios" title="Folios" sub="Guest and company balances" icon={WalletCards} />}
          {isHotel && (can('rate_plans.view') || can('corporate_accounts.view')) && <SectionCard to="/hotel-revenue" title="Rates & Corporate" sub="Rate-plan and company-account visibility" icon={Briefcase} />}
          {isLodge && <SectionCard to="/calendar" title="Planning" sub="Upcoming stays and room demand" icon={ClipboardCheck} />}
          {isLodge && <SectionCard to="/roomgrid" title="Room Board" sub="Live room availability and occupancy" icon={Building2} />}
          {isLodge && can('invoices.view') && <SectionCard to="/prepayments" title="Prepayments" sub="Customer-credit balances and liability" icon={WalletCards} />}
          {isAccommodation && <SectionCard to="/housekeeping" title="Housekeeping" sub="Room readiness and cleaning watch" icon={Wrench} />}
          {isAccommodation && can('maintenance.view') && <SectionCard to="/maintenance" title="Maintenance" sub="Tickets and new requests" icon={Wrench} />}
          {can('pos.reports') && isEnabled('pos') && <SectionCard to="/pos" title={isRestaurant ? 'Sales' : 'POS Sales'} sub="Live sales and transaction history" icon={ShoppingCart} />}
          {isRestaurant && (!barOnly || features?.owner_mobile_view === true) && <SectionCard to="/restaurant-owner" title={barOnly ? 'Bar Owner View' : 'Owner View'} sub={barOnly ? "Today's bar overview" : "Today's restaurant overview"} icon={Briefcase} />}
          {isRestaurant && <SectionCard to="/restaurant/service" title={barOnly ? 'Open Tabs' : 'Service Watch'} sub={barOnly ? 'Open bar tabs and live settlement flow' : 'Open tables, tabs, and live service flow'} icon={ShoppingCart} />}
          {isRestaurant && !barOnly && <SectionCard to="/restaurant/floor" title="Floor & Service" sub="Live table readiness and service status" icon={Building2} />}
          {isRestaurant && !barOnly && <SectionCard to="/restaurant/kitchen-workspace" title="Kitchen" sub="Live prep tickets and ticket status" icon={Package} />}
          {isRestaurant && <SectionCard to="/restaurant/menu-production" title={barOnly ? 'Bar Products' : 'Menu & Products'} sub="Live POS catalogue and availability" icon={Package} />}
          {isRestaurant && <SectionCard to="/restaurant/cash-close" title="Cash & Close" sub="Sales, returns, cash, and close readiness" icon={WalletCards} />}
          {isAccommodation && can('conference.view') && isEnabled('conference') && <SectionCard to="/conference" title="Events & Venues" sub="Event and venue bookings" icon={Building2} />}
          {isAccommodation && can('pool.view') && isEnabled('pool') && <SectionCard to="/day-use" title="Day Use" sub="Walk-in activity visibility" icon={Briefcase} />}
          {can('inventory.view') && isEnabled('inventory') && <SectionCard to="/inventory" title={barOnly ? 'Bar Stock' : isRestaurant ? 'Stock' : 'Inventory'} sub="Low stock and replenishment watch" icon={Package} />}
          {isAccommodation && can('supplies.view') && isEnabled('supplies') && <SectionCard to="/supplies" title="Room Supplies" sub="Store and in-room consumables" icon={Package} />}
        </SectionGroup>

        <SectionGroup label="Finance and reporting">
          {can('reports.view') && isEnabled('reports') && (
            <SectionCard
              to="/reports"
              title="Reports"
              sub={isRestaurant ? 'Sales, expenses, and operating snapshot' : 'Cash, occupancy, usage, and operating snapshot'}
              icon={FileText}
            />
          )}
          {isAccommodation && can('quotations.view') && <SectionCard to="/quotations" title="Quotations" sub="Review quotes and conversion status" icon={ClipboardCheck} />}
          {isAccommodation && can('invoices.view') && <SectionCard to="/invoices" title="Invoices" sub="Guest invoices, paid amounts, and balances" icon={ReceiptText} />}
          {can('expenses.view') && <SectionCard to="/expenses" title="Expenses" sub="Operating spend and maintenance costs" icon={WalletCards} />}
          {can('audit.view') && !barOnly && <SectionCard to="/audit" title="Financial Audit" sub="Payment activity and validation signals" icon={Shield} />}
        </SectionGroup>

        <SectionGroup label={isRestaurant ? 'People' : 'People and property'}>
          {isAccommodation && can('guests.view') && <SectionCard to="/guests" title="Guests" sub="Guest history and stay profile" icon={Users} />}
          {can('staff.view') && isEnabled('staff') && <SectionCard to="/staff" title="Staff" sub="Team visibility and roles" icon={Shield} />}
          {isAccommodation && can('maintenance.view') && <SectionCard to="/rooms" title="Rooms & Maintenance" sub="Room status and ticket watch" icon={Wrench} />}
          {isAccommodation && can('bookings.view') && <SectionCard to="/bookings" title={shell.productFamily === 'hotel' ? 'Stays' : 'Bookings'} sub="Stay and booking visibility" icon={ClipboardCheck} />}
        </SectionGroup>

        <SectionGroup label="Preferences">
          <div className="bg-gray-800 rounded-2xl p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gray-900 text-green-300 flex items-center justify-center shrink-0">
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">Appearance</p>
              <p className="text-[11px] text-gray-400 mt-0.5">{isDark ? 'Dark mode' : 'Light mode'}</p>
            </div>
            <button
              onClick={() => {
                const next = !isDark
                document.documentElement.classList.toggle('light-mode', !next)
                document.documentElement.classList.toggle('dark-mode', next)
                document.documentElement.style.colorScheme = next ? 'dark' : 'light'
                try { localStorage.setItem('boroko_pwa_theme', next ? 'dark' : 'light') } catch (_e) { /* ignore */ }
                window.location.reload()
              }}
              className="shrink-0 p-2 rounded-lg bg-gray-900 text-gray-400 hover:text-white"
              aria-label="Toggle theme"
            >
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
          <NotifToggle
            label="Sound"
            description="Play a short beep on new alerts"
            icon={Volume2}
            enabled={notifPrefs.sound}
            onChange={() => updateNotifPref('sound')}
          />
          <NotifToggle
            label="Vibration"
            description="Pulse on new alerts and replies"
            icon={Vibrate}
            enabled={notifPrefs.vibration}
            onChange={() => updateNotifPref('vibration')}
          />
          <NotifToggle
            label="Urgent alerts only"
            description="Only sound/vibrate on critical items"
            icon={Bell}
            enabled={notifPrefs.urgentOnly}
            onChange={() => updateNotifPref('urgentOnly')}
          />
          <NotifToggle
            label="Front-desk replies"
            description="Get notified when front desk responds"
            icon={MessageCircle}
            enabled={notifPrefs.frontDeskReplies}
            onChange={() => updateNotifPref('frontDeskReplies')}
          />
          <button
            onClick={logout}
            className="w-full bg-gray-800 rounded-2xl p-3 flex items-center gap-3 active:scale-[0.98] transition-transform"
          >
            <div className="w-10 h-10 rounded-xl bg-red-900/50 text-red-400 flex items-center justify-center shrink-0">
              <LogOut size={18} />
            </div>
            <div className="min-w-0 text-left">
              <p className="text-sm font-semibold text-white">Sign out</p>
              <p className="text-[11px] text-gray-400 mt-0.5">End this session</p>
            </div>
          </button>
        </SectionGroup>
      </div>
    </div>
  )
}
