import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

function readEnvFile(fileName) {
  const envPath = path.join(rootDir, fileName)
  if (!fs.existsSync(envPath)) return {}
  return Object.fromEntries(
    fs.readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=')
        const key = line.slice(0, index).trim()
        const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
        return [key, value]
      })
  )
}

function getActiveLodgeId() {
  const explicit = process.env.BOROKO_DEMO_LODGE_ID
  if (explicit) return explicit

  const appData = process.env.APPDATA
  if (!appData) return null
  const candidateProfilePaths = [
    path.join(appData, 'Tsa Bonno Restaurant & Bar POS Dev Desk', 'profiles.json'),
    // Compatibility path for developer profiles created before the public rename.
    path.join(appData, 'Boroko Restaurant & Bar POS Dev Desk', 'profiles.json')
  ]
  const profilesPath = candidateProfilePaths.find((candidate) => fs.existsSync(candidate))
  if (!profilesPath) return null
  const profiles = JSON.parse(fs.readFileSync(profilesPath, 'utf8'))
  return profiles.active_lodge_id || profiles.profiles?.[0]?.lodge_id || null
}

const env = {
  ...readEnvFile('.env'),
  ...readEnvFile('.env.local'),
  ...process.env
}

const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
const lodgeId = getActiveLodgeId()

if (!supabaseUrl) throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_URL.')
if (!serviceKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY.')
if (!lodgeId) throw new Error('Could not find the active Restaurant POS lodge id.')

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
})

const outletSeed = {
  lodge_id: lodgeId,
  name: 'DEMO - Main Restaurant',
  type: 'food',
  is_active: true,
  sort_order: 10
}

const menuSeed = [
  ['DEMO - Flame Grilled Burger', 'Mains', 95, ['popular'], 12, true],
  ['DEMO - Lemon Herb Chicken', 'Mains', 120, ['gluten-free'], 16, true],
  ['DEMO - Garden Bowl', 'Fresh', 72, ['vegetarian'], 8, false],
  ['DEMO - Crispy Wings', 'Starters', 68, ['popular'], 10, true],
  ['DEMO - Chocolate Brownie', 'Desserts', 55, ['popular'], 6, false],
  ['DEMO - Fresh Orange Juice', 'Drinks', 38, ['fresh'], 3, false],
  ['DEMO - Cappuccino', 'Drinks', 32, ['hot'], 4, true],
  ['DEMO - Still Water', 'Drinks', 18, [], 1, false]
]

const tableSeed = [
  ['DEMO T1', 'Patio', 2],
  ['DEMO T2', 'Patio', 4],
  ['DEMO T3', 'Main Floor', 4],
  ['DEMO T4', 'Main Floor', 6],
  ['DEMO Bar 1', 'Bar', 2],
  ['DEMO Bar 2', 'Bar', 2]
]

const stationSeed = [
  ['demo-hot-line', 'DEMO - Hot Line', 'kitchen', 10],
  ['demo-bar', 'DEMO - Bar Station', 'bar', 20],
  ['demo-prep', 'DEMO - Prep Station', 'prep', 30]
]

const inventorySeed = [
  ['DEMO - Burger Buns', 'Dry Store', 'each', 48, 12, 4.5, 0],
  ['DEMO - Beef Patties', 'Kitchen', 'each', 36, 10, 18, 0],
  ['DEMO - Chicken Fillets', 'Kitchen', 'kg', 14, 5, 64, 0],
  ['DEMO - Garden Greens', 'Fresh Produce', 'kg', 8, 3, 28, 0],
  ['DEMO - Coffee Beans', 'Bar', 'kg', 6, 2, 155, 0],
  ['DEMO - Orange Juice Base', 'Bar', 'litre', 18, 6, 19, 0],
  ['DEMO - Brownie Mix', 'Pastry', 'kg', 7, 2, 42, 0]
]

const customerSeed = [
  ['DEMO - Naledi M.', 'naledi.demo@example.com', '+267 71 000 101', 120, 850, 6, 'Likes patio seating.', true],
  ['DEMO - Thabo K.', 'thabo.demo@example.com', '+267 72 000 202', 40, 310, 3, 'Usually orders takeaway.', false],
  ['DEMO - Corporate Lunch Account', 'lunch.demo@example.com', '+267 73 000 303', 0, 2400, 11, 'Demo account customer for office lunch orders.', true]
]

const supplierSeed = [
  ['DEMO - Fresh Farm Supplies', 'Masego', 'freshfarm.demo@example.com', '+267 74 000 404', 'Gaborone', '7 days', 5, 'Produce and herbs.'],
  ['DEMO - Butcher Block', 'Kabo', 'butcher.demo@example.com', '+267 75 000 505', 'Mogoditshane', '14 days', 4, 'Meat and poultry.'],
  ['DEMO - Barista Depot', 'Neo', 'barista.demo@example.com', '+267 76 000 606', 'CBD', '30 days', 5, 'Coffee and beverage stock.']
]

const shiftSeed = [
  ['DEMO - Amantle', 'cashier', 8, 'active'],
  ['DEMO - Kabelo', 'waiter', 8, 'active'],
  ['DEMO - Boitumelo', 'kitchen', 8, 'active'],
  ['DEMO - Lerato', 'supervisor', 8, 'closed']
]

const checklistSeed = {
  checklist_type: 'daily_opening',
  status: 'pending',
  notes: 'DEMO checklist for opening shift.',
  items: [
    ['DEMO - Sanitise service counters', true, 'Done during setup.'],
    ['DEMO - Count opening float', false, null],
    ['DEMO - Check fridge temperatures', false, null],
    ['DEMO - Confirm delivery platform tablet is online', false, null]
  ]
}

const alertSeed = [
  ['stock_low', 'warning', 'DEMO - Coffee beans are close to reorder level.', 'inventory_item'],
  ['service', 'info', 'DEMO - Patio section reserved for a lunch booking.', 'reservation']
]

const reservationSeed = [
  ['DEMO - Palesa Dinner', '+267 77 000 707', 'palesa.demo@example.com', 4, 1, '19:00', 'confirmed', 'phone', 'Anniversary dinner demo booking.'],
  ['DEMO - Walk-in Birthday Table', '+267 78 000 808', null, 6, 2, '13:30', 'booked', 'walk_in', 'Needs cake service demo note.']
]

const waitlistSeed = [
  ['DEMO - Neo Walk-in', '+267 79 000 909', 2, 15, 'Waiting near bar.'],
  ['DEMO - Mpho Family', '+267 70 000 010', 5, 25, 'Needs table with space for stroller.']
]

const orderSeed = [
  {
    key: 'demo-order-table-cash-001',
    walkInName: 'DEMO - Table T3',
    serviceMode: 'table',
    tableName: 'DEMO T3',
    waiterName: 'DEMO - Kabelo',
    paymentMethod: 'cash',
    items: [
      ['DEMO - Flame Grilled Burger', 2],
      ['DEMO - Fresh Orange Juice', 2]
    ],
    tipTotal: 20,
    notes: 'DEMO - lunch table paid cash.'
  },
  {
    key: 'demo-order-takeaway-card-001',
    walkInName: 'DEMO - Takeaway Guest',
    serviceMode: 'takeaway',
    tableName: null,
    waiterName: 'DEMO - Amantle',
    paymentMethod: 'card',
    items: [
      ['DEMO - Lemon Herb Chicken', 1],
      ['DEMO - Cappuccino', 1],
      ['DEMO - Chocolate Brownie', 1]
    ],
    tipTotal: 0,
    notes: 'DEMO - takeaway card order.'
  },
  {
    key: 'demo-order-delivery-mobile-001',
    walkInName: 'DEMO - Delivery Customer',
    serviceMode: 'delivery',
    tableName: null,
    waiterName: 'DEMO - Boitumelo',
    paymentMethod: 'mobile_money',
    items: [
      ['DEMO - Garden Bowl', 1],
      ['DEMO - Still Water', 2]
    ],
    tipTotal: 10,
    notes: 'DEMO - delivery platform order.'
  }
]

const expenseSeed = [
  ['2026-07-12', 'DEMO - Staff meal ingredients', 'Kitchen', 185, 'Demo restaurant operating expense.'],
  ['2026-07-12', 'DEMO - Delivery platform packaging', 'Packaging', 95, 'Demo packaging expense.'],
  ['2026-07-12', 'DEMO - Emergency ice purchase', 'Bar', 60, 'Demo bar expense.']
]

function tomorrowDate(offset = 1) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return date.toISOString().slice(0, 10)
}

function addDaysIso(offset = 0) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return date.toISOString().slice(0, 10)
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

async function ensureOutlet() {
  const { data: existing, error: findError } = await supabase
    .from('outlets')
    .select('id')
    .eq('lodge_id', lodgeId)
    .eq('name', outletSeed.name)
    .maybeSingle()
  if (findError) throw findError
  if (existing?.id) {
    const { error } = await supabase
      .from('outlets')
      .update({ type: outletSeed.type, is_active: true, sort_order: outletSeed.sort_order })
      .eq('id', existing.id)
    if (error) throw error
    return existing.id
  }

  const { data, error } = await supabase
    .from('outlets')
    .insert(outletSeed)
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

async function ensureMenuItems(outletId) {
  const touched = []
  for (const [name, category, price, dietaryFlags, prepTimeMinutes, isPopular] of menuSeed) {
    const row = {
      lodge_id: lodgeId,
      outlet_id: outletId,
      name,
      category,
      price,
      is_available: true,
      dietary_flags: dietaryFlags,
      prep_time_minutes: prepTimeMinutes,
      is_popular: isPopular,
      auto_from_inventory: false,
      template_kind: 'standard'
    }
    const { data: existing, error: findError } = await supabase
      .from('pos_menu_items')
      .select('id')
      .eq('lodge_id', lodgeId)
      .eq('outlet_id', outletId)
      .eq('name', name)
      .maybeSingle()
    if (findError) throw findError

    if (existing?.id) {
      const { error } = await supabase.from('pos_menu_items').update(row).eq('id', existing.id)
      if (error) throw error
      touched.push(name)
      continue
    }

    const { error } = await supabase.from('pos_menu_items').insert(row)
    if (error) throw error
    touched.push(name)
  }
  return touched
}

async function ensureTables(outletId) {
  const touched = []
  for (const [name, area, seats] of tableSeed) {
    const row = {
      lodge_id: lodgeId,
      outlet_id: outletId,
      name,
      area,
      seats,
      active: true,
      updated_at: new Date().toISOString()
    }
    const { data: existing, error: findError } = await supabase
      .from('pos_tables')
      .select('id')
      .eq('lodge_id', lodgeId)
      .eq('outlet_id', outletId)
      .eq('name', name)
      .maybeSingle()
    if (findError) throw findError

    if (existing?.id) {
      const { error } = await supabase.from('pos_tables').update(row).eq('id', existing.id)
      if (error) throw error
      touched.push(name)
      continue
    }

    const { error } = await supabase.from('pos_tables').insert(row)
    if (error) throw error
    touched.push(name)
  }
  return touched
}

async function ensureStations(outletId) {
  const stations = {}
  for (const [stationKey, name, stationType, sortOrder] of stationSeed) {
    const row = {
      lodge_id: lodgeId,
      outlet_id: outletId,
      station_key: stationKey,
      name,
      station_type: stationType,
      enabled: true,
      sort_order: sortOrder,
      updated_at: new Date().toISOString()
    }
    const { data: existing, error: findError } = await supabase
      .from('pos_kitchen_stations')
      .select('id')
      .eq('lodge_id', lodgeId)
      .eq('outlet_id', outletId)
      .eq('station_key', stationKey)
      .maybeSingle()
    if (findError) throw findError

    if (existing?.id) {
      const { error } = await supabase.from('pos_kitchen_stations').update(row).eq('id', existing.id)
      if (error) throw error
      stations[stationType] = existing.id
      continue
    }

    const { data, error } = await supabase.from('pos_kitchen_stations').insert(row).select('id').single()
    if (error) throw error
    stations[stationType] = data.id
  }
  return stations
}

async function assignMenuStations(outletId, stations) {
  const rules = [
    { categories: ['Drinks'], stationId: stations.bar },
    { categories: ['Fresh'], stationId: stations.prep },
    { categories: ['Mains', 'Starters', 'Desserts'], stationId: stations.kitchen }
  ]
  for (const rule of rules) {
    if (!rule.stationId) continue
    const { error } = await supabase
      .from('pos_menu_items')
      .update({ kitchen_station_id: rule.stationId })
      .eq('lodge_id', lodgeId)
      .eq('outlet_id', outletId)
      .in('category', rule.categories)
      .like('name', 'DEMO -%')
    if (error) throw error
  }
}

async function ensureInventory(outletId) {
  const items = {}
  for (const [name, category, unit, currentStock, reorderLevel, latestUnitCost, sellingPrice] of inventorySeed) {
    const row = {
      lodge_id: lodgeId,
      outlet_id: outletId,
      name,
      category,
      unit,
      current_stock: currentStock,
      reorder_level: reorderLevel,
      latest_unit_cost: latestUnitCost,
      selling_price: sellingPrice
    }
    const { data: existing, error: findError } = await supabase
      .from('inventory_items')
      .select('id')
      .eq('lodge_id', lodgeId)
      .eq('outlet_id', outletId)
      .eq('name', name)
      .maybeSingle()
    if (findError) throw findError

    if (existing?.id) {
      const { error } = await supabase.from('inventory_items').update(row).eq('id', existing.id)
      if (error) throw error
      items[name] = existing.id
      continue
    }

    const { data, error } = await supabase.from('inventory_items').insert(row).select('id').single()
    if (error) throw error
    items[name] = data.id
  }
  return items
}

async function getActorId() {
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('lodge_id', lodgeId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data?.id || null
}

async function ensureCustomers() {
  const customers = {}
  for (const [name, email, phone, loyaltyPoints, totalSpent, visitCount, notes, marketingOptIn] of customerSeed) {
    const row = {
      lodge_id: lodgeId,
      name,
      email,
      phone,
      loyalty_points: loyaltyPoints,
      total_spent: totalSpent,
      visit_count: visitCount,
      notes,
      marketing_opt_in: marketingOptIn,
      updated_at: new Date().toISOString()
    }
    const { data: existing, error: findError } = await supabase
      .from('restaurant_customers')
      .select('id')
      .eq('lodge_id', lodgeId)
      .eq('name', name)
      .maybeSingle()
    if (findError) throw findError

    if (existing?.id) {
      const { error } = await supabase.from('restaurant_customers').update(row).eq('id', existing.id)
      if (error) throw error
      customers[name] = existing.id
      continue
    }

    const { data, error } = await supabase.from('restaurant_customers').insert(row).select('id').single()
    if (error) throw error
    customers[name] = data.id
  }
  return customers
}

async function ensurePosShift(outletId, actorId) {
  const { data: existing, error: findError } = await supabase
    .from('pos_shifts')
    .select('id')
    .eq('lodge_id', lodgeId)
    .eq('outlet_id', outletId)
    .eq('status', 'open')
    .like('notes', 'DEMO%')
    .maybeSingle()
  if (findError) throw findError
  if (existing?.id) return existing.id

  const { data, error } = await supabase
    .from('pos_shifts')
    .insert({
      lodge_id: lodgeId,
      outlet_id: outletId,
      cashier_id: actorId,
      cashier_name: 'DEMO - Cashier',
      opening_float: 500,
      status: 'open',
      opened_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      notes: 'DEMO POS shift for seeded restaurant sales.'
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

async function ensureSuppliers() {
  const suppliers = {}
  for (const [name, contactPerson, email, phone, address, paymentTerms, rating, notes] of supplierSeed) {
    const row = {
      lodge_id: lodgeId,
      name,
      contact_person: contactPerson,
      email,
      phone,
      address,
      payment_terms: paymentTerms,
      rating,
      notes,
      status: 'active',
      updated_at: new Date().toISOString()
    }
    const { data: existing, error: findError } = await supabase
      .from('restaurant_suppliers')
      .select('id')
      .eq('lodge_id', lodgeId)
      .eq('name', name)
      .maybeSingle()
    if (findError) throw findError

    if (existing?.id) {
      const { error } = await supabase.from('restaurant_suppliers').update(row).eq('id', existing.id)
      if (error) throw error
      suppliers[name] = existing.id
      continue
    }

    const { data, error } = await supabase.from('restaurant_suppliers').insert(row).select('id').single()
    if (error) throw error
    suppliers[name] = data.id
  }
  return suppliers
}

async function ensureShifts() {
  for (const [staffName, role, expectedHours, status] of shiftSeed) {
    const active = status === 'active'
    const clockIn = new Date(Date.now() - (active ? 2 : 7) * 60 * 60 * 1000).toISOString()
    const row = {
      lodge_id: lodgeId,
      staff_name: staffName,
      role,
      expected_hours: expectedHours,
      clock_in: clockIn,
      clock_out: active ? null : new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      notes: active ? 'DEMO active restaurant shift.' : 'DEMO completed opening support shift.',
      status
    }
    const { data: existing, error: findError } = await supabase
      .from('restaurant_shifts')
      .select('id')
      .eq('lodge_id', lodgeId)
      .eq('staff_name', staffName)
      .maybeSingle()
    if (findError) throw findError

    const query = existing?.id
      ? supabase.from('restaurant_shifts').update(row).eq('id', existing.id)
      : supabase.from('restaurant_shifts').insert(row)
    const { error } = await query
    if (error) throw error
  }
}

async function ensureChecklist() {
  const { data: existing, error: findError } = await supabase
    .from('restaurant_checklists')
    .select('id')
    .eq('lodge_id', lodgeId)
    .eq('checklist_type', checklistSeed.checklist_type)
    .eq('notes', checklistSeed.notes)
    .maybeSingle()
  if (findError) throw findError

  const row = {
    lodge_id: lodgeId,
    checklist_type: checklistSeed.checklist_type,
    status: checklistSeed.status,
    notes: checklistSeed.notes,
    checklist_date: new Date().toISOString()
  }
  let checklistId = existing?.id
  if (checklistId) {
    const { error } = await supabase.from('restaurant_checklists').update(row).eq('id', checklistId)
    if (error) throw error
  } else {
    const { data, error } = await supabase.from('restaurant_checklists').insert(row).select('id').single()
    if (error) throw error
    checklistId = data.id
  }

  for (const [itemLabel, isCompleted, notes] of checklistSeed.items) {
    const { data: item, error: itemFindError } = await supabase
      .from('restaurant_checklist_items')
      .select('id')
      .eq('checklist_id', checklistId)
      .eq('item_label', itemLabel)
      .maybeSingle()
    if (itemFindError) throw itemFindError
    const itemRow = { checklist_id: checklistId, item_label: itemLabel, is_completed: isCompleted, notes }
    const query = item?.id
      ? supabase.from('restaurant_checklist_items').update(itemRow).eq('id', item.id)
      : supabase.from('restaurant_checklist_items').insert(itemRow)
    const { error } = await query
    if (error) throw error
  }
}

async function ensureAlerts(entityIds = {}) {
  for (const [alertType, severity, message, entityType] of alertSeed) {
    const { data: existing, error: findError } = await supabase
      .from('restaurant_alerts')
      .select('id')
      .eq('lodge_id', lodgeId)
      .eq('message', message)
      .maybeSingle()
    if (findError) throw findError
    const row = {
      lodge_id: lodgeId,
      alert_type: alertType,
      severity,
      message,
      entity_type: entityType,
      entity_id: entityType === 'inventory_item' ? entityIds.inventoryItemId || null : entityIds.reservationId || null,
      is_resolved: false
    }
    const query = existing?.id
      ? supabase.from('restaurant_alerts').update(row).eq('id', existing.id)
      : supabase.from('restaurant_alerts').insert(row)
    const { error } = await query
    if (error) throw error
  }
}

async function ensureReservations(outletId, customers, tables) {
  const reservations = {}
  const tableIds = Object.values(tables)
  for (const [name, phone, email, partySize, dayOffset, time, status, source, notes] of reservationSeed) {
    const { data: existing, error: findError } = await supabase
      .from('restaurant_reservations')
      .select('id')
      .eq('lodge_id', lodgeId)
      .eq('customer_name', name)
      .maybeSingle()
    if (findError) throw findError
    const row = {
      lodge_id: lodgeId,
      outlet_id: outletId,
      customer_id: customers['DEMO - Naledi M.'] || null,
      customer_name: name,
      customer_phone: phone,
      customer_email: email,
      party_size: partySize,
      reservation_date: tomorrowDate(dayOffset),
      reservation_time: time,
      duration_minutes: 90,
      preferred_table_id: tableIds[0] || null,
      assigned_table_id: null,
      status,
      source,
      notes,
      updated_at: new Date().toISOString()
    }
    if (existing?.id) {
      const { error } = await supabase.from('restaurant_reservations').update(row).eq('id', existing.id)
      if (error) throw error
      reservations[name] = existing.id
      continue
    }
    const { data, error } = await supabase.from('restaurant_reservations').insert(row).select('id').single()
    if (error) throw error
    reservations[name] = data.id
  }
  return reservations
}

async function ensureWaitlist(outletId, customers) {
  for (const [customerName, customerPhone, partySize, quotedWaitMinutes, notes] of waitlistSeed) {
    const { data: existing, error: findError } = await supabase
      .from('restaurant_waitlist_entries')
      .select('id')
      .eq('lodge_id', lodgeId)
      .eq('customer_name', customerName)
      .maybeSingle()
    if (findError) throw findError
    const row = {
      lodge_id: lodgeId,
      outlet_id: outletId,
      customer_id: customers['DEMO - Thabo K.'] || null,
      customer_name: customerName,
      customer_phone: customerPhone,
      party_size: partySize,
      quoted_wait_minutes: quotedWaitMinutes,
      status: 'waiting',
      notes,
      updated_at: new Date().toISOString()
    }
    const query = existing?.id
      ? supabase.from('restaurant_waitlist_entries').update(row).eq('id', existing.id)
      : supabase.from('restaurant_waitlist_entries').insert(row)
    const { error } = await query
    if (error) throw error
  }
}

async function ensureRecipesAndPrep(outletId, inventoryItems) {
  const { data: burger, error: burgerError } = await supabase
    .from('pos_menu_items')
    .select('id')
    .eq('lodge_id', lodgeId)
    .eq('outlet_id', outletId)
    .eq('name', 'DEMO - Flame Grilled Burger')
    .maybeSingle()
  if (burgerError) throw burgerError
  if (burger?.id && inventoryItems['DEMO - Beef Patties'] && inventoryItems['DEMO - Burger Buns']) {
    const recipeRow = {
      lodge_id: lodgeId,
      menu_item_id: burger.id,
      name: 'DEMO - Burger Build',
      version: 1,
      serving_size: 1,
      active: true,
      updated_at: new Date().toISOString()
    }
    const { data: existing, error: findError } = await supabase
      .from('restaurant_recipes')
      .select('id')
      .eq('lodge_id', lodgeId)
      .eq('name', recipeRow.name)
      .maybeSingle()
    if (findError) throw findError
    let recipeId = existing?.id
    if (recipeId) {
      const { error } = await supabase.from('restaurant_recipes').update(recipeRow).eq('id', recipeId)
      if (error) throw error
    } else {
      const { data, error } = await supabase.from('restaurant_recipes').insert(recipeRow).select('id').single()
      if (error) throw error
      recipeId = data.id
    }
    const ingredients = [
      [inventoryItems['DEMO - Beef Patties'], 1, 'each', 0],
      [inventoryItems['DEMO - Burger Buns'], 1, 'each', 1],
      [inventoryItems['DEMO - Garden Greens'], 0.08, 'kg', 2]
    ]
    for (const [inventoryItemId, quantity, unit, sortOrder] of ingredients) {
      if (!inventoryItemId) continue
      const { data: existingIngredient, error: ingredientFindError } = await supabase
        .from('restaurant_recipe_ingredients')
        .select('id')
        .eq('lodge_id', lodgeId)
        .eq('recipe_id', recipeId)
        .eq('inventory_item_id', inventoryItemId)
        .maybeSingle()
      if (ingredientFindError) throw ingredientFindError
      const ingredientRow = {
        lodge_id: lodgeId,
        recipe_id: recipeId,
        inventory_item_id: inventoryItemId,
        quantity,
        unit,
        waste_percent: 0,
        sort_order: sortOrder,
        updated_at: new Date().toISOString()
      }
      const query = existingIngredient?.id
        ? supabase.from('restaurant_recipe_ingredients').update(ingredientRow).eq('id', existingIngredient.id)
        : supabase.from('restaurant_recipe_ingredients').insert(ingredientRow)
      const { error } = await query
      if (error) throw error
    }
  }

  const producedItemId = inventoryItems['DEMO - Brownie Mix']
  if (!producedItemId) return
  const prepRow = {
    lodge_id: lodgeId,
    name: 'DEMO - Brownie Tray Prep',
    produced_inventory_item_id: producedItemId,
    default_yield_quantity: 12,
    yield_unit: 'portion',
    active: true,
    updated_at: new Date().toISOString()
  }
  const { data: existingPrep, error: prepFindError } = await supabase
    .from('restaurant_prep_items')
    .select('id')
    .eq('lodge_id', lodgeId)
    .eq('name', prepRow.name)
    .maybeSingle()
  if (prepFindError) throw prepFindError
  let prepItemId = existingPrep?.id
  if (prepItemId) {
    const { error } = await supabase.from('restaurant_prep_items').update(prepRow).eq('id', prepItemId)
    if (error) throw error
  } else {
    const { data, error } = await supabase.from('restaurant_prep_items').insert(prepRow).select('id').single()
    if (error) throw error
    prepItemId = data.id
  }

  const batchRow = {
    lodge_id: lodgeId,
    outlet_id: outletId,
    prep_item_id: prepItemId,
    batch_code: 'DEMO-BROWNIE-TRAY',
    produced_inventory_item_id: producedItemId,
    planned_yield_quantity: 12,
    actual_yield_quantity: 0,
    unit: 'portion',
    status: 'draft',
    notes: 'DEMO prep batch ready to post.',
    idempotency_key: 'demo-brownie-tray-prep'
  }
  const { data: existingBatch, error: batchFindError } = await supabase
    .from('restaurant_prep_batches')
    .select('id')
    .eq('lodge_id', lodgeId)
    .eq('idempotency_key', batchRow.idempotency_key)
    .maybeSingle()
  if (batchFindError) throw batchFindError
  const query = existingBatch?.id
    ? supabase.from('restaurant_prep_batches').update(batchRow).eq('id', existingBatch.id)
    : supabase.from('restaurant_prep_batches').insert(batchRow)
  const { error } = await query
  if (error) throw error
}

async function publishCatalog(outletId) {
  const { data: result, error } = await supabase.rpc('publish_pos_catalog_snapshot', {
    p_lodge_id: lodgeId,
    p_outlet_id: outletId
  })
  if (error) throw error
  if (result?.success === false) throw new Error(result.error || 'Could not publish POS catalog snapshot')

  const { data, error: snapshotError } = await supabase
    .from('pos_catalog_snapshots')
    .select('id, payload, vat_enabled, vat_rate')
    .eq('lodge_id', lodgeId)
    .eq('outlet_id', outletId)
    .is('retired_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  if (snapshotError) throw snapshotError
  return data
}

function calculateOrderTotal(snapshot, order) {
  const catalogItems = new Map((snapshot.payload?.items || []).map((item) => [item.name, item]))
  const gross = order.items.reduce((sum, [name, quantity]) => {
    const item = catalogItems.get(name)
    if (!item) throw new Error(`Catalog item not found: ${name}`)
    return sum + Number(item.price || 0) * quantity
  }, 0)
  const tax = snapshot.vat_enabled && Number(snapshot.vat_rate || 0) > 0
    ? roundMoney(gross * Number(snapshot.vat_rate || 0) / 100)
    : 0
  return roundMoney(gross + tax + Number(order.tipTotal || 0))
}

async function ensureSalesAndPayments(outletId, snapshot, shiftId) {
  const catalogItems = new Map((snapshot.payload?.items || []).map((item) => [item.name, item]))
  const orderIds = {}

  for (const order of orderSeed) {
    const { data: existing, error: findError } = await supabase
      .from('pos_orders')
      .select('id,total')
      .eq('lodge_id', lodgeId)
      .eq('create_idempotency_key', order.key)
      .maybeSingle()
    if (findError) throw findError
    if (existing?.id) {
      orderIds[order.key] = existing.id
      continue
    }

    const total = calculateOrderTotal(snapshot, order)
    const paymentBreakdown = [{ method: order.paymentMethod, amount: total }]
    const payload = {
      id: crypto.randomUUID(),
      lodge_id: lodgeId,
      outlet_id: outletId,
      catalog_snapshot_id: snapshot.id,
      shift_id: shiftId,
      create_idempotency_key: order.key,
      client_created_at: new Date().toISOString(),
      source_device_id: 'demo-seed',
      payment_method: order.paymentMethod,
      payment_breakdown: paymentBreakdown,
      service_mode: order.serviceMode,
      table_name: order.tableName,
      waiter_name: order.waiterName,
      walk_in_name: order.walkInName,
      tip_total: order.tipTotal,
      notes: order.notes,
      items: order.items.map(([name, quantity]) => {
        const item = catalogItems.get(name)
        if (!item) throw new Error(`Catalog item not found: ${name}`)
        return {
          menu_item_id: item.id,
          quantity,
          item_notes: name.includes('Burger') ? 'DEMO - no onions' : null
        }
      })
    }

    const { data: result, error } = await supabase.rpc('create_pos_order_v3', { payload })
    if (error) throw error
    if (result?.success === false) throw new Error(result.error || 'Could not create demo POS order')
    orderIds[order.key] = result.order_id || payload.id
  }

  return orderIds
}

async function ensureDeliveryRecord(orderIds, customers) {
  const orderId = orderIds['demo-order-delivery-mobile-001']
  if (!orderId) return
  const { data: existing, error: findError } = await supabase
    .from('restaurant_deliveries')
    .select('id')
    .eq('lodge_id', lodgeId)
    .eq('order_id', orderId)
    .maybeSingle()
  if (findError) throw findError
  const row = {
    lodge_id: lodgeId,
    order_id: orderId,
    customer_id: customers['DEMO - Thabo K.'] || null,
    platform: 'DEMO - Phone Delivery',
    platform_commission: 12,
    platform_order_id: 'DEMO-DEL-001',
    delivery_fee: 25,
    driver_name: 'DEMO - Rider One',
    status: 'pending',
    updated_at: new Date().toISOString()
  }
  const query = existing?.id
    ? supabase.from('restaurant_deliveries').update(row).eq('id', existing.id)
    : supabase.from('restaurant_deliveries').insert(row)
  const { error } = await query
  if (error) throw error
}

async function ensureVouchersAndLedgers(customers) {
  const customerId = customers['DEMO - Naledi M.'] || null
  const voucherRow = {
    lodge_id: lodgeId,
    code: 'DEMO-GIFT-100',
    initial_value: 100,
    remaining_value: 65,
    customer_id: customerId,
    expires_at: `${addDaysIso(90)}T00:00:00.000Z`,
    status: 'active',
    updated_at: new Date().toISOString()
  }
  const { data: voucher, error: voucherFindError } = await supabase
    .from('restaurant_vouchers')
    .select('id')
    .eq('lodge_id', lodgeId)
    .eq('code', voucherRow.code)
    .maybeSingle()
  if (voucherFindError) throw voucherFindError
  const voucherQuery = voucher?.id
    ? supabase.from('restaurant_vouchers').update(voucherRow).eq('id', voucher.id)
    : supabase.from('restaurant_vouchers').insert(voucherRow)
  const { error: voucherError } = await voucherQuery
  if (voucherError) throw voucherError

  if (!customerId) return
  const ledgers = [
    ['restaurant_loyalty_ledger', { lodge_id: lodgeId, customer_id: customerId, points: 35, reason: 'earn', description: 'DEMO - loyalty opening balance.' }, 'description'],
    ['restaurant_account_ledger', { lodge_id: lodgeId, customer_id: customerId, amount: 145, reason: 'charge', description: 'DEMO - customer account lunch charge.' }, 'description']
  ]
  for (const [table, row, uniqueField] of ledgers) {
    const { data: existing, error: findError } = await supabase
      .from(table)
      .select('id')
      .eq('lodge_id', lodgeId)
      .eq('customer_id', customerId)
      .eq(uniqueField, row[uniqueField])
      .maybeSingle()
    if (findError) throw findError
    if (existing?.id) continue
    const { error } = await supabase.from(table).insert(row)
    if (error) throw error
  }
}

async function ensureCashDrawer(actorId) {
  const { data: existing, error: findError } = await supabase
    .from('restaurant_cash_drawer_sessions')
    .select('id')
    .eq('lodge_id', lodgeId)
    .eq('notes', 'DEMO - open drawer for seeded sales.')
    .maybeSingle()
  if (findError) throw findError
  const row = {
    lodge_id: lodgeId,
    opening_float: 500,
    card_total: 207,
    mobile_total: 118,
    voucher_total: 0,
    expected_total: 826,
    declared_total: 826,
    notes: 'DEMO - open drawer for seeded sales.',
    status: 'open',
    opened_by: actorId,
    opened_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
  }
  const query = existing?.id
    ? supabase.from('restaurant_cash_drawer_sessions').update(row).eq('id', existing.id)
    : supabase.from('restaurant_cash_drawer_sessions').insert(row)
  const { error } = await query
  if (error) throw error
}

async function ensureExpenses(outletId) {
  for (const [date, description, category, amount, notes] of expenseSeed) {
    const { data: existing, error: findError } = await supabase
      .from('expenses')
      .select('id')
      .eq('lodge_id', lodgeId)
      .eq('description', description)
      .maybeSingle()
    if (findError) throw findError
    const row = { lodge_id: lodgeId, outlet_id: outletId, date, description, category, amount, notes }
    const query = existing?.id
      ? supabase.from('expenses').update(row).eq('id', existing.id)
      : supabase.from('expenses').insert(row)
    const { error } = await query
    if (error) throw error
  }
}

async function ensurePurchaseOrders(suppliers, inventoryItems) {
  const supplierId = suppliers['DEMO - Fresh Farm Supplies'] || Object.values(suppliers)[0]
  if (!supplierId) return
  const { data: existing, error: findError } = await supabase
    .from('restaurant_purchase_orders')
    .select('id')
    .eq('lodge_id', lodgeId)
    .eq('notes', 'DEMO - weekly produce replenishment purchase order.')
    .maybeSingle()
  if (findError) throw findError
  const poRow = {
    lodge_id: lodgeId,
    supplier_id: supplierId,
    order_date: new Date().toISOString(),
    expected_delivery: `${addDaysIso(2)}T09:00:00.000Z`,
    status: 'approved',
    total: 620,
    notes: 'DEMO - weekly produce replenishment purchase order.'
  }
  let poId = existing?.id
  if (poId) {
    const { error } = await supabase.from('restaurant_purchase_orders').update(poRow).eq('id', poId)
    if (error) throw error
  } else {
    const { data, error } = await supabase.from('restaurant_purchase_orders').insert(poRow).select('id').single()
    if (error) throw error
    poId = data.id
  }
  const lines = [
    [inventoryItems['DEMO - Garden Greens'], 'DEMO - Garden greens restock', 10, 28],
    [inventoryItems['DEMO - Orange Juice Base'], 'DEMO - Juice base restock', 20, 17]
  ]
  for (const [inventoryItemId, description, quantity, unitCost] of lines) {
    const { data: existingLine, error: lineFindError } = await supabase
      .from('restaurant_purchase_order_items')
      .select('id')
      .eq('purchase_order_id', poId)
      .eq('description', description)
      .maybeSingle()
    if (lineFindError) throw lineFindError
    const row = {
      purchase_order_id: poId,
      inventory_item_id: inventoryItemId || null,
      description,
      quantity,
      unit_cost: unitCost,
      total: roundMoney(quantity * unitCost)
    }
    const query = existingLine?.id
      ? supabase.from('restaurant_purchase_order_items').update(row).eq('id', existingLine.id)
      : supabase.from('restaurant_purchase_order_items').insert(row)
    const { error } = await query
    if (error) throw error
  }
}

const outletId = await ensureOutlet()
const stations = await ensureStations(outletId)
const menuItems = await ensureMenuItems(outletId)
await assignMenuStations(outletId, stations)
const tableNames = await ensureTables(outletId)
const { data: tableRows, error: tableRowsError } = await supabase
  .from('pos_tables')
  .select('id,name')
  .eq('lodge_id', lodgeId)
  .eq('outlet_id', outletId)
  .like('name', 'DEMO%')
if (tableRowsError) throw tableRowsError
const tableMap = Object.fromEntries((tableRows || []).map((table) => [table.name, table.id]))
const inventoryItems = await ensureInventory(outletId)
const customers = await ensureCustomers()
const suppliers = await ensureSuppliers()
await ensureShifts()
await ensureChecklist()
const reservations = await ensureReservations(outletId, customers, tableMap)
await ensureWaitlist(outletId, customers)
await ensureRecipesAndPrep(outletId, inventoryItems)
await ensureAlerts({
  inventoryItemId: inventoryItems['DEMO - Coffee Beans'] || null,
  reservationId: reservations['DEMO - Palesa Dinner'] || null
})
const actorId = await getActorId()
const shiftId = await ensurePosShift(outletId, actorId)
const snapshot = await publishCatalog(outletId)
const orderIds = await ensureSalesAndPayments(outletId, snapshot, shiftId)
await ensureDeliveryRecord(orderIds, customers)
await ensureVouchersAndLedgers(customers)
if (actorId) await ensureCashDrawer(actorId)
await ensureExpenses(outletId)
await ensurePurchaseOrders(suppliers, inventoryItems)
const { count: menuCount, error: menuCountError } = await supabase
  .from('pos_menu_items')
  .select('id', { count: 'exact', head: true })
  .eq('lodge_id', lodgeId)
  .eq('outlet_id', outletId)
  .like('name', 'DEMO -%')
if (menuCountError) throw menuCountError

const { count: tableCount, error: tableCountError } = await supabase
  .from('pos_tables')
  .select('id', { count: 'exact', head: true })
  .eq('lodge_id', lodgeId)
  .eq('outlet_id', outletId)
  .like('name', 'DEMO%')
if (tableCountError) throw tableCountError

async function countDemo(table, field = 'name', pattern = 'DEMO%') {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('lodge_id', lodgeId)
    .like(field, pattern)
  if (error) throw error
  return count
}

console.log(`Seeded restaurant demo data for lodge ${lodgeId}.`)
console.log(`Outlet: ${outletSeed.name}`)
console.log(`Menu items touched: ${menuItems.length}; verified: ${menuCount}`)
console.log(`Tables touched: ${tableNames.length}; verified: ${tableCount}`)
console.log(`Kitchen stations: ${await countDemo('pos_kitchen_stations')}`)
console.log(`Inventory items: ${await countDemo('inventory_items')}`)
console.log(`Customers: ${await countDemo('restaurant_customers')}`)
console.log(`Suppliers: ${await countDemo('restaurant_suppliers')}`)
console.log(`Team shifts: ${await countDemo('restaurant_shifts', 'staff_name')}`)
console.log(`Reservations: ${await countDemo('restaurant_reservations', 'customer_name')}`)
console.log(`Waitlist entries: ${await countDemo('restaurant_waitlist_entries', 'customer_name')}`)
console.log(`Recipes: ${await countDemo('restaurant_recipes')}`)
console.log(`Prep items: ${await countDemo('restaurant_prep_items')}`)
console.log(`Alerts: ${await countDemo('restaurant_alerts', 'message')}`)
console.log(`POS sales/orders: ${await countDemo('pos_orders', 'create_idempotency_key', 'demo-order-%')}`)
console.log(`Delivery records: ${await countDemo('restaurant_deliveries', 'platform', 'DEMO%')}`)
console.log(`Gift vouchers: ${await countDemo('restaurant_vouchers', 'code', 'DEMO%')}`)
console.log(`Expenses: ${await countDemo('expenses', 'description')}`)
console.log(`Purchase orders: ${await countDemo('restaurant_purchase_orders', 'notes')}`)
