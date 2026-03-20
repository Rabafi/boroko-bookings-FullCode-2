import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  BedDouble,
  CalendarCheck,
  CalendarX,
  DollarSign,
  TrendingUp,
  Users,
  ArrowRight,
  AlertTriangle,
  Lock,
  BookOpen,
  BarChart3,
  Receipt,
  ClipboardList,
  Presentation,
  Waves,
  ShoppingCart,
  Package,
  Boxes
} from 'lucide-react'
import { StatusBadge } from './shared/StatusBadge'
import { useSettings, useFeatures } from '../App'

const SHORTCUTS = [
  { label: 'Bookings',      to: '/bookings',   icon: BookOpen },
  { label: 'Expenses',      to: '/expenses',   icon: Receipt,       feature: 'expenses',   tier: 'Standard' },
  { label: 'Reports',       to: '/reports',    icon: BarChart3,     feature: 'reports',    tier: 'Standard' },
  { label: 'Night Audit',   to: '/audit',      icon: ClipboardList, feature: 'audit',      tier: 'Standard' },
  { label: 'Conference',    to: '/conference', icon: Presentation,  feature: 'conference', tier: 'Standard' },
  { label: 'Day Use',       to: '/dayuse',     icon: Waves,         feature: 'pool',       tier: 'Standard' },
  { label: 'Staff',         to: '/staff',      icon: Users,         feature: 'staff',      tier: 'Standard' },
  { label: 'POS',           to: '/pos',        icon: ShoppingCart,  feature: 'pos',        tier: 'Pro' },
  { label: 'Inventory',     to: '/inventory',  icon: Package,       feature: 'inventory',  tier: 'Pro' },
  { label: 'Room Supplies', to: '/supplies',   icon: Boxes,         feature: 'supplies',   tier: 'Pro' },
]

function formatWhatsAppPhone(phone) {
  if (!phone) return ''
  let p = phone.replace(/\D/g, '')
  if (p.startsWith('00')) p = p.slice(2)
  if (!p.startsWith('267') && p.length <= 8) p = '267' + p
  return p
}

export default function Dashboard() {
  const { settings } = useSettings()
  const features = useFeatures()
  const navigate = useNavigate()
  const currency = settings?.currency || 'P'

  const [stats, setStats] = useState(null)
  const [recentBookings, setRecentBookings] = useState([])
  const [upcoming, setUpcoming] = useState({ today: [], tomorrow: [], dayAfter: [] })
  const [forecast, setForecast] = useState([])
  const [lowStock, setLowStock] = useState([])

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    const [s, bookings, up, fc, ls] = await Promise.all([
      window.api.dashboard.stats(),
      window.api.bookings.getAll(),
      window.api.notifications.upcoming(),
      window.api.dashboard.forecast(30).catch(() => []),
      window.api.inventory.getLowStock().catch(() => [])
    ])
    setStats(s)

    // Collapse exclusive event room-rows into one entry per event group
    const regularBookings = bookings.filter(b => !b.is_exclusive_event)
    const eventRows       = bookings.filter(b => b.is_exclusive_event)
    const eventGroupMap   = {}
    eventRows.forEach(b => {
      const match   = b.notes?.match(/\[GROUP:([^\]]+)\]/)
      const groupId = match?.[1] || b.check_in
      if (!eventGroupMap[groupId]) {
        const nights = Math.ceil((new Date(b.check_out) - new Date(b.check_in)) / 86400000)
        eventGroupMap[groupId] = { ...b, room_count: 0, total_amount: (b.event_daily_rate || 0) * nights, _event_group: true }
      }
      eventGroupMap[groupId].room_count++
    })
    const combined = [...regularBookings, ...Object.values(eventGroupMap)]
      .sort((a, b_) => new Date(b_.check_in) - new Date(a.check_in))
    setRecentBookings(combined.slice(0, 6))
    setUpcoming(up || { today: [], tomorrow: [], dayAfter: [] })
    setForecast(fc || [])
    setLowStock(ls || [])
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  const allUpcoming = [
    ...(upcoming.today || []).map((b) => ({ ...b, _label: 'Today' })),
    ...(upcoming.tomorrow || []).map((b) => ({ ...b, _label: 'Tomorrow' })),
    ...(upcoming.dayAfter || []).map((b) => ({ ...b, _label: 'Day After' }))
  ]

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-0.5">{today}</p>
      </div>

      {/* Quick Access */}
      <div className="mb-8">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Quick Access</h2>
        <div className="grid grid-cols-5 lg:grid-cols-10 gap-2">
          {SHORTCUTS.map(({ label, to, icon: Icon, feature, tier }) => {
            const isLocked = feature && Object.keys(features).length > 0 && features[feature] === false
            const tierColor = tier === 'Pro' ? 'text-purple-500' : 'text-blue-500'
            return (
              <button
                key={to}
                onClick={() => navigate(to)}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all text-center relative ${
                  isLocked
                    ? 'bg-gray-50 border-gray-200 opacity-50 hover:opacity-70'
                    : 'bg-white border-gray-200 hover:border-green-400 hover:bg-green-50 hover:shadow-sm'
                }`}
              >
                <Icon size={20} className={isLocked ? 'text-gray-400' : 'text-gray-600'} />
                <span className="text-[11px] font-medium text-gray-600 leading-tight">{label}</span>
                {isLocked && (
                  <Lock size={10} className={`absolute top-1.5 right-1.5 ${tierColor}`} />
                )}
                {isLocked && tier && (
                  <span className={`text-[9px] font-bold ${tierColor}`}>{tier}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Stats Grid */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          <StatCard
            icon={BedDouble}
            label="Total Rooms"
            value={stats.total_rooms}
            color="bg-blue-50 text-blue-600"
          />
          <StatCard
            icon={Users}
            label="Occupied Today"
            value={stats.occupied_today}
            color="bg-green-50 text-green-600"
          />
          <StatCard
            icon={CalendarCheck}
            label="Check-ins Today"
            value={stats.checkins_today}
            color="bg-teal-50 text-teal-600"
          />
          <StatCard
            icon={CalendarX}
            label="Check-outs Today"
            value={stats.checkouts_today}
            color="bg-orange-50 text-orange-600"
          />
          <StatCard
            icon={DollarSign}
            label="Revenue This Month"
            value={`${currency} ${Number(stats.revenue_month || 0).toFixed(2)}`}
            color="bg-purple-50 text-purple-600"
          />
          <StatCard
            icon={TrendingUp}
            label="Upcoming Bookings"
            value={stats.upcoming_bookings}
            color="bg-rose-50 text-rose-600"
          />
        </div>
      )}

      {/* 30-Day Occupancy Forecast */}
      {forecast.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
          <h2 className="font-semibold text-gray-700 mb-4">30-Day Occupancy Forecast</h2>
          <div className="flex items-end gap-1 h-20 overflow-x-auto pb-1">
            {forecast.map((day) => {
              const pct = day.total > 0 ? (day.occupied / day.total) * 100 : 0
              const barH = Math.max(4, Math.round(pct * 0.72)) // max 72px
              const color =
                pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-400' : 'bg-gray-300'
              const label = new Date(day.date).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short'
              })
              return (
                <div
                  key={day.date}
                  className="flex flex-col items-center gap-1 shrink-0 group relative"
                  style={{ width: '28px' }}
                >
                  {/* Tooltip */}
                  <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                    <div className="bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                      {label}: {day.occupied}/{day.total} ({Math.round(pct)}%)
                    </div>
                  </div>
                  <div
                    className={`w-5 rounded-sm ${color} transition-all`}
                    style={{ height: `${barH}px` }}
                  />
                  {(day.date.endsWith('-01') || day.date === forecast[0]?.date || day.date === forecast[6]?.date || day.date === forecast[13]?.date || day.date === forecast[20]?.date || day.date === forecast[27]?.date) && (
                    <span className="text-[9px] text-gray-400 rotate-45 origin-left">
                      {new Date(day.date).getDate()}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-green-500 inline-block" /> ≥80%</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-yellow-400 inline-block" /> ≥50%</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-gray-300 inline-block" /> &lt;50%</span>
          </div>
        </div>
      )}

      {/* Low Stock Alert */}
      {lowStock.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-amber-800 text-sm">
              {lowStock.length} item{lowStock.length > 1 ? 's' : ''} low on stock
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              {lowStock.slice(0, 6).map((item) => (
                <span key={item.id} className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                  {item.name} — {item.current_stock} {item.unit} left
                </span>
              ))}
              {lowStock.length > 6 && (
                <span className="text-xs text-amber-600">+{lowStock.length - 6} more</span>
              )}
            </div>
          </div>
          <Link to="/inventory" className="shrink-0 text-xs font-medium text-amber-700 hover:text-amber-900 underline">
            View Inventory
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Recent Bookings — 3 cols */}
        <div className="xl:col-span-3 bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-700">Recent Bookings</h2>
            <Link
              to="/bookings"
              className="text-sm text-green-600 hover:text-green-700 flex items-center gap-1"
            >
              View all <ArrowRight size={14} />
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-5 py-3 text-left">#</th>
                  <th className="px-5 py-3 text-left">Guest</th>
                  <th className="px-5 py-3 text-left">Room</th>
                  <th className="px-5 py-3 text-left">Check In</th>
                  <th className="px-5 py-3 text-left">Status</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {recentBookings.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-mono text-xs font-semibold text-gray-400">{b._event_group ? '—' : (b.booking_number || '—')}</td>
                    <td className="px-5 py-3 font-medium text-gray-800">
                      <div className="flex items-center gap-1.5">
                        {b.customer_name}
                        {b._event_group && (
                          <span className="text-[9px] font-bold bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded flex-shrink-0">EVENT</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-gray-600">{b._event_group ? `${b.room_count} rooms` : `Room ${b.room_number}`}</td>
                    <td className="px-5 py-3 text-gray-600">{b.check_in}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={b.status} />
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-gray-800">
                      {currency} {Number(b.total_amount || 0).toFixed(2)}
                    </td>
                  </tr>
                ))}
                {recentBookings.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-gray-400">
                      No bookings yet. Create your first booking to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Upcoming Check-ins — 2 cols */}
        <div className="xl:col-span-2 bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-700">Upcoming Check-ins</h2>
            <span className="text-xs text-gray-400">{allUpcoming.length} arrivals</span>
          </div>
          <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
            {allUpcoming.length === 0 && (
              <p className="px-5 py-10 text-center text-sm text-gray-400">
                No arrivals in the next 3 days.
              </p>
            )}
            {allUpcoming.map((b) => (
              <div key={b.id} className="px-5 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm text-gray-800 truncate">{b.customer_name}</p>
                      <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded font-medium ${
                        b._label === 'Today'
                          ? 'bg-green-100 text-green-700'
                          : b._label === 'Tomorrow'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {b._label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Room {b.room_number} · {b.adults}A{b.children > 0 ? ` ${b.children}C` : ''} · {b.check_in} → {b.check_out}
                    </p>
                  </div>
                </div>
                {/* Action buttons */}
                <div className="flex gap-2 mt-2">
                  {b.customer_phone && (
                    <button
                      onClick={() => {
                        const phone = formatWhatsAppPhone(b.customer_phone)
                        const lodge = settings?.lodge_name || 'the Lodge'
                        const msg = [
                          `Dear ${b.customer_name},`,
                          '',
                          `This is a reminder of your upcoming check-in at *${lodge}*.`,
                          '',
                          `🛏️  Room ${b.room_number}`,
                          `📅  Check-in: ${b.check_in}`,
                          `📅  Check-out: ${b.check_out}`,
                          '',
                          `We look forward to welcoming you!`,
                          settings?.phone ? `📞 ${settings.phone}` : ''
                        ].filter(Boolean).join('\n')
                        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank')
                      }}
                      className="text-xs px-2 py-1 bg-green-50 text-green-700 hover:bg-green-100 rounded transition-colors"
                    >
                      💬 WhatsApp
                    </button>
                  )}
                  {b.customer_email && (
                    <button
                      onClick={() => {
                        const lodge = settings?.lodge_name || 'the Lodge'
                        const subject = `Check-in Reminder — ${lodge}`
                        const msg = [
                          `Dear ${b.customer_name},`,
                          '',
                          `This is a reminder of your upcoming check-in at ${lodge}.`,
                          '',
                          `Room: ${b.room_number}`,
                          `Check-in: ${b.check_in}`,
                          `Check-out: ${b.check_out}`,
                          '',
                          `We look forward to welcoming you!`,
                          settings?.phone ? `Phone: ${settings.phone}` : ''
                        ].filter(Boolean).join('\n')
                        window.api.shell.openExternal(
                          `mailto:${b.customer_email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(msg)}`
                        )
                      }}
                      className="text-xs px-2 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded transition-colors"
                    >
                      ✉️ Email
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm">
      <div className={`w-10 h-10 rounded-lg ${color} flex items-center justify-center mb-3`}>
        <Icon size={20} />
      </div>
      <p className="text-2xl font-bold text-gray-800">{value}</p>
      <p className="text-sm text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}
