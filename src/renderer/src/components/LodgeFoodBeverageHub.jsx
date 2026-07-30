import { useMemo, useState } from 'react'
import { NavLink, Navigate, useParams } from 'react-router'
import { ChefHat, ClipboardCheck, CookingPot, PackageSearch, UsersRound, WalletCards, LayoutGrid, CalendarClock } from 'lucide-react'
import RestaurantWorkspace from './restaurant/RestaurantWorkspace'
import RestaurantReservations from './restaurant/RestaurantReservations'
import HposFloorPlan from './hospitality-pos/HposFloorPlan'

const WORKSPACES = Object.freeze([
  { id: 'floor', label: 'Tables & service', icon: LayoutGrid, description: 'Create tables, manage areas, open checks, and coordinate reservations.' },
  { id: 'kitchen', label: 'Kitchen & bar', icon: ChefHat, description: 'Live tickets, prep stations, and service timing.' },
  { id: 'menu', label: 'Recipes & costing', icon: CookingPot, description: 'Menu, modifiers, recipes, prep, yield, and variance.' },
  { id: 'stock', label: 'Stock & purchasing', icon: PackageSearch, description: 'Ingredients, suppliers, orders, lots, and reorder suggestions.' },
  { id: 'team', label: 'Outlet team', icon: UsersRound, description: 'Shifts, performance, tips, and service accountability.' },
  { id: 'close', label: 'Cash & close', icon: WalletCards, description: 'Drawer control, outlet close, settlements, and owner digest.' },
  { id: 'control', label: 'Controls', icon: ClipboardCheck, description: 'Opening, closing, safety, exception, and policy controls.' }
])

export default function LodgeFoodBeverageHub() {
  const { workspace = 'kitchen' } = useParams()
  const [floorTab, setFloorTab] = useState('tables')
  const selected = useMemo(() => WORKSPACES.find((item) => item.id === workspace), [workspace])

  if (!selected) return <Navigate to="/food-beverage/kitchen" replace />

  return (
    <div className="min-h-full bg-gradient-to-b from-emerald-50/70 to-slate-50">
      <section className="border-b border-emerald-100 bg-white px-5 py-5 md:px-7">
        <div className="mx-auto max-w-[1600px]">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">Lodge outlet operations</p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Food &amp; Beverage Control</h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">Restaurant-grade kitchen, bar, recipe, stock, staff, and cash controls—connected to the lodge’s existing POS and inventory records.</p>
            </div>
            <NavLink to="/pos" className="bb-btn-primary">Open outlet POS</NavLink>
          </div>
          <nav className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-7" aria-label="Food and beverage workspaces">
            {WORKSPACES.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.id}
                  to={`/food-beverage/${item.id}`}
                  className={({ isActive }) => `rounded-2xl border p-3 transition ${isActive ? 'border-emerald-400 bg-emerald-50 shadow-sm' : 'border-slate-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/40'}`}
                >
                  <span className="flex items-center gap-2 text-sm font-bold text-slate-800"><Icon size={16} className="text-emerald-700" />{item.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">{item.description}</span>
                </NavLink>
              )
            })}
          </nav>
        </div>
      </section>
      {selected.id === 'floor' ? (
        <div className="mx-auto max-w-[1600px] p-4 md:p-6">
          <div className="mb-5 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
            <button type="button" onClick={() => setFloorTab('tables')} className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold ${floorTab === 'tables' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><LayoutGrid size={15} /> Tables &amp; areas</button>
            <button type="button" onClick={() => setFloorTab('reservations')} className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold ${floorTab === 'reservations' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><CalendarClock size={15} /> Table reservations</button>
          </div>
          {floorTab === 'tables'
            ? <HposFloorPlan posRoute="/pos" contextLabel="Lodge tables & service areas" />
            : <RestaurantReservations />}
        </div>
      ) : <RestaurantWorkspace workspace={selected.id} context="property-outlet" theme="lodge" />}
    </div>
  )
}
