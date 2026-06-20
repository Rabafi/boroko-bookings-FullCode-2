import { NavLink, useLocation } from 'react-router-dom'
import { BedDouble, BookOpen, CreditCard, Home, Menu, MessageCircle } from 'lucide-react'

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/bookings', label: 'Bookings', icon: BookOpen },
  { to: '/rooms', label: 'Rooms', icon: BedDouble },
  { to: '/money', label: 'Money', icon: CreditCard },
  { to: '/control', label: 'Inbox', icon: MessageCircle },
  { to: '/more', label: 'Menu', icon: Menu }
]

export default function BottomNav({ alertCount = 0, inboxUnreadCount = 0, inboxEnabled = true }) {
  const location = useLocation()
  const navItems = NAV.filter((item) => item.to !== '/control' || inboxEnabled)
  const secondaryRoutes = new Set([
    '/more',
    '/alerts',
    '/reports',
    '/quotations',
    '/invoices',
    '/expenses',
    '/audit',
    '/guests',
    '/staff',
    '/conference',
    '/day-use',
    '/inventory',
    '/pos'
  ])

  return (
    <nav
      className={`pwa-bottom-nav fixed bottom-0 left-0 right-0 z-40 mx-auto grid max-w-xl items-center border-t border-white/10 bg-gray-900/92 px-1 ${
        navItems.length === 6 ? 'grid-cols-6' : 'grid-cols-5'
      }`}
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}
      aria-label="Manager navigation"
    >
      {navItems.map(({ to, label, icon: Icon, end }) => {
        const menuActive = to === '/more' && secondaryRoutes.has(location.pathname)
        return (
          <NavLink
            key={to}
            to={to}
            end={end}
            aria-label={label === 'Menu' ? 'Open more pages' : label}
            className={({ isActive }) => {
              const active = isActive || menuActive
              return `relative flex min-w-0 flex-col items-center gap-1 rounded-2xl px-1 py-2 transition-all ${
                active ? 'bg-green-500/14 text-green-200 ring-1 ring-green-400/25 shadow-[0_10px_30px_rgba(34,197,94,0.14)]' : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'
              }`
            }}
          >
            <div className="relative">
              <Icon size={21} />
              {label === 'Inbox' && inboxUnreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                  {inboxUnreadCount > 9 ? '9+' : inboxUnreadCount}
                </span>
              )}
              {label === 'Alerts' && alertCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                  {alertCount > 9 ? '9+' : alertCount}
                </span>
              )}
            </div>
            <span className="max-w-full truncate text-[9px] font-medium min-[380px]:text-[10px]">{label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}
