import { NavLink } from 'react-router-dom'
import { Home, BedDouble, BookOpen, BarChart3, Bell } from 'lucide-react'
import { useFeatures } from '../contexts/FeaturesContext'

const NAV = [
  { to: '/',         label: 'Home',     icon: Home,     end: true },
  { to: '/rooms',    label: 'Rooms',    icon: BedDouble },
  { to: '/bookings', label: 'Bookings', icon: BookOpen },
  { to: '/reports',  label: 'Reports',  icon: BarChart3, feature: 'reports' },
  { to: '/alerts',   label: 'Alerts',   icon: Bell },
]

export default function BottomNav({ alertCount = 0 }) {
  const { isEnabled } = useFeatures()

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 flex items-center justify-around px-2 pb-safe z-50"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}
    >
      {NAV.map(({ to, label, icon: Icon, end, feature }) => {
        const locked = feature && !isEnabled(feature)
        return (
          <NavLink
            key={to}
            to={locked ? '/upgrade' : to}
            end={end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 py-2 px-3 rounded-xl transition-colors relative ${
                locked
                  ? 'opacity-40'
                  : isActive
                    ? 'text-green-400'
                    : 'text-gray-500 hover:text-gray-300'
              }`
            }
          >
            <div className="relative">
              <Icon size={22} />
              {label === 'Alerts' && alertCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                  {alertCount > 9 ? '9+' : alertCount}
                </span>
              )}
            </div>
            <span className="text-[10px] font-medium">{label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}
