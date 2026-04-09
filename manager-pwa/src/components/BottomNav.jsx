import { NavLink } from 'react-router-dom'
import { BedDouble, Briefcase, BookOpen, Home, Menu } from 'lucide-react'

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/bookings', label: 'Bookings', icon: BookOpen },
  { to: '/rooms', label: 'Rooms', icon: BedDouble },
  { to: '/money', label: 'Money', icon: Briefcase },
  { to: '/more', label: 'More', icon: Menu }
]

export default function BottomNav({ alertCount = 0 }) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 flex items-center justify-around px-2 pb-safe z-50"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}
    >
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex flex-col items-center gap-0.5 py-2 px-3 rounded-xl transition-colors relative ${
              isActive ? 'text-green-400' : 'text-gray-500 hover:text-gray-300'
            }`
          }
        >
          <div className="relative">
            <Icon size={22} />
            {label === 'More' && alertCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {alertCount > 9 ? '9+' : alertCount}
              </span>
            )}
          </div>
          <span className="text-[10px] font-medium">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
