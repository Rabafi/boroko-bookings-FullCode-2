import { NavLink } from 'react-router-dom'
import { BedDouble, BookOpen, CreditCard, Home, MessageCircle } from 'lucide-react'

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/bookings', label: 'Bookings', icon: BookOpen },
  { to: '/rooms', label: 'Rooms', icon: BedDouble },
  { to: '/money', label: 'Money', icon: CreditCard },
  { to: '/control', label: 'Inbox', icon: MessageCircle }
]

export default function BottomNav({ notificationCount = 0 }) {
  return (
    <nav
      className="pwa-bottom-nav fixed bottom-0 left-0 right-0 z-40 mx-auto flex max-w-xl items-center justify-around border-t border-white/10 bg-gray-900/92 px-2"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}
      aria-label="Manager navigation"
    >
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `relative flex min-w-[62px] flex-col items-center gap-1 rounded-2xl px-3 py-2 transition-all ${
              isActive ? 'bg-green-500/14 text-green-200 ring-1 ring-green-400/25 shadow-[0_10px_30px_rgba(34,197,94,0.14)]' : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'
            }`
          }
        >
          <div className="relative">
            <Icon size={22} />
            {label === 'Inbox' && notificationCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {notificationCount > 9 ? '9+' : notificationCount}
              </span>
            )}
          </div>
          <span className="text-[10px] font-medium">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
