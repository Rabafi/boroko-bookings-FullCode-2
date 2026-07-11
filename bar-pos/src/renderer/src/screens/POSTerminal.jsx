import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Search, X, Plus, Minus, ShoppingCart, Banknote, Check, Percent } from 'lucide-react'

const CURRENCY = 'P'
const fmt = (v) => Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'orange_money', label: 'Orange Money' },
  { value: 'myzaka', label: 'MyZaka' },
  { value: 'smega', label: 'SMEGA' },
  { value: 'bank_transfer', label: 'Ewallet' },
  { value: 'other', label: 'Other' },
]

const DEFAULT_CATEGORIES = ['All', 'Beers', 'Spirits', 'Cocktails', 'Wines', 'Shots', 'Soft Drinks', 'Snacks']

export default function POSTerminal({ user, settings }) {
  const [menuItems, setMenuItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('All')
  const [cart, setCart] = useState([])
  const [paymentMode, setPaymentMode] = useState(false)
  const [selectedPayment, setSelectedPayment] = useState(null)
  const [showPaymentOptions, setShowPaymentOptions] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const searchRef = useRef(null)

  useEffect(() => { loadMenu() }, [])

  async function loadMenu() {
    setLoading(true)
    try {
      const items = await window.barAPI.getMenuItems()
      setMenuItems(items)
    } catch { setMenuItems([]) }
    finally { setLoading(false) }
  }

  const filteredItems = useMemo(() => {
    let items = menuItems.filter(m => m.is_available !== false)
    if (activeCategory !== 'All') items = items.filter(m => m.category === activeCategory)
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(m => (m.name || '').toLowerCase().includes(q))
    }
    return items
  }, [menuItems, activeCategory, search])

  const categories = useMemo(() => {
    const cats = new Set(menuItems.filter(m => m.is_available !== false).map(m => m.category).filter(Boolean))
    return ['All', ...DEFAULT_CATEGORIES.filter(c => c === 'All' || cats.has(c))]
  }, [menuItems])

  const cartTotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + (Number(item.unit_price || 0) * Number(item.quantity || 0)), 0)
  }, [cart])

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0)

  function addToCart(item) {
    setCart(prev => {
      const existing = prev.find(i => i.menu_item_id === item.id)
      if (existing) return prev.map(i => i.menu_item_id === item.id ? { ...i, quantity: i.quantity + 1 } : i)
      return [...prev, { menu_item_id: item.id, inventory_item_id: item.inventory_item_id || null, item_name: item.name, unit_price: Number(item.price || 0), quantity: 1, depletion_qty: Number(item.depletion_qty || 1) }]
    })
  }

  function updateQty(id, delta) {
    setCart(prev => prev.map(i => i.menu_item_id === id ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i))
  }

  function removeItem(id) {
    setCart(prev => prev.filter(i => i.menu_item_id !== id))
  }

  function clearCart() { setCart([]) }

  async function handlePayment(method) {
    if (cart.length === 0) return
    setSelectedPayment(method)
    setShowPaymentOptions(false)

    try {
      const orderData = {
        items: cart.map(i => ({ menu_item_id: i.menu_item_id, inventory_item_id: i.inventory_item_id, item_name: i.item_name, quantity: i.quantity, unit_price: i.unit_price, depletion_qty: i.depletion_qty })),
        payments: [{ method, amount: cartTotal }],
        total: cartTotal,
        service_mode: 'counter',
        outlet_id: settings?.outlet_id || null,
        lodge_id: 'local',
        created_by: user?.id
      }

      await window.barAPI.createOrder(orderData)

      // Adjust stock
      for (const item of cart) {
        if (item.inventory_item_id) {
          await window.barAPI.adjustStock(item.inventory_item_id, -(item.quantity * item.depletion_qty), 'Sale').catch(() => {})
        }
      }

      setSuccessMsg(`${method === 'cash' ? 'Cash' : method.replace(/_/g, ' ')} — P${fmt(cartTotal)}`)
      setCart([])
      setPaymentMode(false)
      setSelectedPayment(null)
      setTimeout(() => setSuccessMsg(''), 3000)
    } catch (err) {
      alert('Payment failed: ' + (err?.message || 'Unknown error'))
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-stone-500">Loading menu...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Left: Menu grid */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header with search */}
        <div className="flex items-center gap-3 p-3 border-b border-stone-800">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search drinks..."
              className="w-full pl-9 pr-3 py-2 text-sm"
            />
          </div>
          <span className="text-xs text-stone-500">{menuItems.length} items</span>
        </div>

        {/* Category tabs */}
        <div className="flex gap-1.5 p-3 pb-0 overflow-x-auto scrollbar-none">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors
                ${activeCategory === cat
                  ? 'bg-brand-700 text-white'
                  : 'bg-stone-800/60 text-stone-400 hover:text-stone-200 hover:bg-stone-700/60'
                }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Menu grid */}
        <div className="flex-1 overflow-y-auto p-3">
          {filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-stone-600 gap-2">
              <BeerIcon className="w-10 h-10 opacity-30" />
              <p className="text-sm">No items in this category</p>
              {!menuItems.length && (
                <button onClick={() => window.location.hash = '#/settings'} className="text-xs text-brand-500 hover:text-brand-400 underline">
                  Add menu items in Settings
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
              {filteredItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => addToCart(item)}
                  className="menu-grid-item"
                >
                  <span className="text-lg leading-none">{item.emoji || '🍺'}</span>
                  <span className="text-xs font-medium text-center leading-tight">{item.name}</span>
                  <span className="text-[11px] font-mono text-brand-400">P{fmt(item.price)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: Cart panel */}
      <div className="w-80 bg-stone-900/50 border-l border-stone-800 flex flex-col shrink-0">
        {/* Cart header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-stone-400" />
            <span className="text-sm font-medium">{cartCount > 0 ? `${cartCount} item${cartCount > 1 ? 's' : ''}` : 'Cart'}</span>
          </div>
          {cart.length > 0 && (
            <button onClick={clearCart} className="text-xs text-stone-500 hover:text-red-400 transition-colors">Clear</button>
          )}
        </div>

        {/* Cart items */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-stone-600 gap-2">
              <ShoppingCart className="w-8 h-8 opacity-30" />
              <p className="text-xs">Tap a drink to start</p>
            </div>
          ) : (
            cart.map(item => (
              <div key={item.menu_item_id} className="flex items-center gap-2 bg-stone-800/40 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-stone-200 truncate">{item.item_name}</div>
                  <div className="text-xs font-mono text-stone-500">P{fmt(item.unit_price)} each</div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => updateQty(item.menu_item_id, -1)} className="w-6 h-6 rounded-md bg-stone-800 hover:bg-stone-700 flex items-center justify-center text-stone-400">
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="w-6 text-center text-sm font-mono">{item.quantity}</span>
                  <button onClick={() => updateQty(item.menu_item_id, 1)} className="w-6 h-6 rounded-md bg-stone-800 hover:bg-stone-700 flex items-center justify-center text-stone-400">
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                <div className="text-sm font-mono text-stone-200 w-16 text-right">P{fmt(item.unit_price * item.quantity)}</div>
                <button onClick={() => removeItem(item.menu_item_id)} className="text-stone-600 hover:text-red-400 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Total & Pay */}
        <div className="border-t border-stone-800 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-stone-400">Total</span>
            <span className="text-2xl font-bold text-stone-100 font-mono">P{fmt(cartTotal)}</span>
          </div>

          {successMsg && (
            <div className="bg-brand-900/30 border border-brand-800/40 rounded-lg px-3 py-2 text-sm text-brand-300 text-center animate-pulse">
              <Check className="w-4 h-4 inline mr-1" />
              {successMsg}
            </div>
          )}

          {!paymentMode ? (
            <button
              onClick={() => { if (cart.length > 0) { setPaymentMode(true); setShowPaymentOptions(true) } }}
              disabled={cart.length === 0}
              className="btn-primary w-full btn-lg text-base"
            >
              <Banknote className="w-5 h-5" />
              Pay P{fmt(cartTotal)}
            </button>
          ) : (
            <div className="space-y-2">
              {showPaymentOptions && (
                <div className="grid grid-cols-2 gap-1.5">
                  {PAYMENT_METHODS.map(m => (
                    <button
                      key={m.value}
                      onClick={() => handlePayment(m.value)}
                      className="btn-secondary text-xs py-2.5"
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => { setPaymentMode(false); setShowPaymentOptions(false) }}
                className="btn-ghost w-full text-xs"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function BeerIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 11h1a3 3 0 0 1 0 6h-1" />
      <path d="M9 12v6" />
      <path d="M13 12v6" />
      <path d="M14 7.5c-1 0-1.44-.5-3-.5s-2 .5-3 .5" />
      <path d="M8 7.5V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3.5" />
    </svg>
  )
}
