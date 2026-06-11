import { Link } from 'react-router-dom'
import { Bell, Briefcase, Building2, FileText, MessageCircle, Package, Shield, Users, Wrench } from 'lucide-react'
import { useFeatures } from '../contexts/FeaturesContext'

function SectionCard({ to, title, sub, icon: Icon }) {
  return (
    <Link to={to} className="bg-gray-800 rounded-2xl p-4 flex items-center gap-3 active:scale-[0.98] transition-transform">
      <div className="w-11 h-11 rounded-2xl bg-gray-900 text-green-300 flex items-center justify-center">
        <Icon size={20} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
      </div>
    </Link>
  )
}

export default function More() {
  const { can, isEnabled, features } = useFeatures()
  const pwaEnabled = Object.keys(features).length > 0 && features.pwa === true

  const sections = [
    can('guests.view') && { to: '/guests', title: 'Guests', sub: 'Guest history and stay profile', icon: Users },
    can('staff.view') && isEnabled('staff') && { to: '/staff', title: 'Staff', sub: 'Team visibility and roles', icon: Shield },
    { to: '/alerts', title: 'Alerts', sub: 'Urgent issues and unpaid follow-up', icon: Bell },
    can('reports.view') && isEnabled('reports') && { to: '/reports', title: 'Reports', sub: 'Cash, occupancy, usage, and operating snapshot', icon: FileText },
    can('conference.view') && isEnabled('conference') && { to: '/conference', title: 'Conference', sub: 'Event and venue bookings', icon: Building2 },
    can('pool.view') && isEnabled('pool') && { to: '/day-use', title: 'Day Use', sub: 'Walk-in activity visibility', icon: Briefcase },
    can('inventory.view') && isEnabled('inventory') && { to: '/inventory', title: 'Inventory', sub: 'Low stock and replenishment watch', icon: Package },
    can('maintenance.view') && { to: '/rooms', title: 'Rooms & Maintenance', sub: 'Room status and ticket watch', icon: Wrench },
    pwaEnabled && { to: '/control', title: 'Inbox', sub: 'Chat with front desk', icon: MessageCircle }
  ].filter(Boolean)

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-12 pb-4">
        <h1 className="text-lg font-bold text-white">More</h1>
        <p className="text-xs text-gray-400">People, operations, reports, and support tools</p>
      </div>

      <div className="px-4 py-4 grid grid-cols-1 gap-3">
        {sections.map((section) => (
          <SectionCard key={section.to} {...section} />
        ))}
      </div>
    </div>
  )
}
