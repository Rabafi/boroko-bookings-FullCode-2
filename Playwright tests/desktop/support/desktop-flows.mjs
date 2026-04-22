import { expect } from '@playwright/test'
import { getRealBackendEnv, setTestOfflineMode } from './desktop-app.mjs'

export function addDays(baseDate, days) {
  const date = new Date(baseDate)
  date.setDate(date.getDate() + days)
  return date
}

export function formatDateInput(date) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Gaborone',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date)
    const year = parts.find((part) => part.type === 'year')?.value || '1970'
    const month = parts.find((part) => part.type === 'month')?.value || '01'
    const day = parts.find((part) => part.type === 'day')?.value || '01'
    return `${year}-${month}-${day}`
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

export function createStayDates(offsetDays = 10) {
  const start = addDays(new Date(), offsetDays)
  const end = addDays(start, 1)
  return {
    checkIn: formatDateInput(start),
    checkOut: formatDateInput(end)
  }
}

export async function selectFirstLodge(page, lodgeName = null) {
  if (lodgeName) {
    await expect(page.getByText(lodgeName, { exact: true })).toBeVisible({ timeout: 30000 })
  }
  const useLodgeButton = page.getByRole('button', { name: 'Use Lodge' }).first()
  await expect(useLodgeButton).toBeVisible({ timeout: 30000 })
  await useLodgeButton.evaluate((button) => button.click())
}

export async function signInDesktop(page, seed) {
  await selectFirstLodge(page, seed.lodgeName)
  await page.evaluate(() => { window.location.hash = '#/login' })
  await page.getByTestId('login-email-input').fill(seed.user.email)
  await page.getByTestId('login-password-input').fill(seed.password)
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('sidebar-sync-panel')).toBeVisible({ timeout: 30000 })
  await expect(page.getByText(seed.user.name)).toBeVisible()
}

export async function ensureSignedInDesktop(page, seed) {
  const alreadySignedIn = await page.getByTestId('sidebar-sync-panel')
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false)
  if (alreadySignedIn) {
    return
  }
  await signInDesktop(page, seed)
}

export async function restoreBackendSession(page, seed, { reload = false } = {}) {
  const sidebarSyncPanel = page.getByTestId('sidebar-sync-panel')
  const alreadySignedIn = await sidebarSyncPanel
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false)

  if (!alreadySignedIn) {
    const useLodgeButton = page.getByRole('button', { name: 'Use Lodge' }).first()
    const onWelcome = await useLodgeButton.isVisible({ timeout: 5000 }).catch(() => false)
    if (onWelcome) {
      await useLodgeButton.click()
    }
  }

  await page.evaluate(({ user, nonce, scope }) => {
    localStorage.setItem('bb_user', JSON.stringify(user))
    localStorage.setItem('bb_session_nonce', nonce)
    localStorage.setItem('bb_user_scope', scope)
  }, {
    user: seed.localStorageUser,
    nonce: seed.sessionNonce,
    scope: seed.lodgeId
  })

  const restored = await page.evaluate(async (nonce) => {
    const restoredUser = await window.api.auth.restoreSession(nonce)
    if (!restoredUser) return false
    await window.api.auth.validateSession?.()
    return true
  }, seed.sessionNonce)
  expect(restored).toBe(true)

  if (reload) {
    await page.reload()
  }

  await expect(sidebarSyncPanel).toBeVisible({ timeout: 60000 })
  await expect(page.getByText(seed.user.name)).toBeVisible()
}

export async function restoreSeededDesktopSession(page, seed) {
  await restoreBackendSession(page, seed, { reload: true })
}

export async function openBookingsPage(page) {
  await page.getByRole('link', { name: 'Bookings' }).click()
  await expect(page.getByRole('heading', { name: 'Bookings' })).toBeVisible({ timeout: 30000 })
}

export async function openPosPage(page) {
  await page.getByRole('link', { name: 'POS' }).click()
  await expect(page.getByRole('heading', { name: 'Point of Sale' })).toBeVisible({ timeout: 30000 })
}

export async function openQuotationsPage(page) {
  await page.getByRole('link', { name: 'Quotations' }).click()
  await expect(page.getByRole('heading', { name: 'Quotations' })).toBeVisible({ timeout: 30000 })
}

export async function openInvoicesPage(page) {
  await page.getByRole('link', { name: 'Invoices' }).click()
  await expect(page.getByRole('heading', { name: 'Booking Invoices' })).toBeVisible({ timeout: 30000 })
}

export async function openPosHistoryPage(page) {
  await openPosPage(page)
  await page.getByRole('button', { name: 'History' }).click({ force: true })
  await expect(page.getByText(/No orders in this period|Could not load orders/i).or(page.getByRole('columnheader', { name: 'Time' }))).toBeVisible({ timeout: 30000 })
}

export async function createOfflineBooking(page, seed, {
  customerName,
  roomNumber = '101',
  roomId = null,
  checkIn = null,
  checkOut = null,
  offsetDays = 10,
  requirePendingSync = true,
  waitForVisibleRow = true
} = {}) {
  const uniqueCustomer = customerName || `Offline Guest ${Date.now()}`
  const stay = checkIn && checkOut ? { checkIn, checkOut } : createStayDates(offsetDays)
  const selectedRoom = seed.rooms.find((room) => String(room.id) === String(roomId)) || seed.rooms.find((room) => String(room.room_number) === String(roomNumber)) || seed.rooms[0] || null
  const resolvedRoomId = roomId || selectedRoom?.id || null
  const expectedTotal = Number(selectedRoom?.rate_per_night || 0) * 1
  const roomLabel = selectedRoom
    ? `Room ${selectedRoom.room_number} — ${selectedRoom.room_type} (${seed.settings.currency}${selectedRoom.rate_per_night}/night)`
    : `Room ${roomNumber}`

  await openBookingsPage(page)
  await expect(page.getByRole('button', { name: 'New Booking' })).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: 'New Booking' }).click()
  await expect(page.getByRole('heading', { name: 'New Booking' })).toBeVisible({ timeout: 30000 })
  await page.getByTestId('booking-new-guest-name-input').fill(uniqueCustomer)
  await page.getByTestId('booking-new-guest-phone-input').fill('+26770009999')
  const roomSelect = page.getByTestId('booking-room-select')
  let selectableRoomValue = ''
  await expect.poll(async () => {
    selectableRoomValue = await roomSelect.evaluate((element, { fallbackRoomNumber, requestedRoomId }) => {
      const options = Array.from(element.querySelectorAll('option')).map((option) => ({
        value: String(option.value || ''),
        label: String(option.textContent || '')
      }))
      const byId = options.find((option) => option.value === String(requestedRoomId || ''))
      if (byId) return byId.value
      const byRoomNumber = options.find((option) => option.label.includes(`Room ${fallbackRoomNumber}`))
      return byRoomNumber?.value || ''
    }, {
      fallbackRoomNumber: selectedRoom?.room_number || roomNumber,
      requestedRoomId: resolvedRoomId
    })
    return selectableRoomValue !== ''
  }, { timeout: 30000, intervals: [200, 500, 1000] }).toBe(true)
  await roomSelect.selectOption(selectableRoomValue)
  await page.getByTestId('booking-check-in-input').fill(stay.checkIn)
  await page.getByTestId('booking-check-out-input').fill(stay.checkOut)
  // Snapshot the sync queue BEFORE clicking Create so we can detect the new entry.
  // getSyncDetails() reads from local disk — it is not affected by Supabase connectivity.
  const queueBefore = await page.evaluate(async () => {
    const details = await window.api.sync.getDetails()
    return (details?.pending || []).map((item) => item?._queue_id).filter(Boolean)
  })

  await page.getByRole('button', { name: 'Create Booking' }).click()

  // Wait for the modal to close — this is the definitive success signal.
  await expect(page.getByRole('heading', { name: 'New Booking' })).toBeHidden({ timeout: 30000 })

  // After the modal closes, poll the sync queue for a NEW entry whose booking ID we can read.
  // This avoids calling getAll() which queries Supabase first (baked-in VITE_SUPABASE_URL).
  // In the installed-profile flow the real lodge_id returns live Supabase rows and the
  // newly-created offline booking is absent there — but the sync queue is always local.
  let bookingId = null
  await expect.poll(async () => {
    const details = await page.evaluate(async () => window.api.sync.getDetails())
    const pending = details?.pending || []
    const newEntry = pending.find((item) => {
      if (!item?._queue_id) return false
      if (queueBefore.includes(item._queue_id)) return false
      // Only match booking-creation entries — the form first creates a customer which also
      // produces a queue entry (with p_id = customer UUID, not a booking UUID).
      // Matching on table prevents mis-identifying the customer entry as the booking.
      if (item?.table !== 'create_booking') return false
      const id = item?.data?.p_booking_id || item?.data?.payload?.booking_id || null
      if (id) { bookingId = id; return true }
      return false
    })
    return Boolean(newEntry)
  }, { timeout: 30000, intervals: [300, 500, 1000] }).toBe(true)

  // Build a minimal booking object from known inputs.
  // Try getAll() first — if it happens to return the booking (synthetic seed / fast path), use it.
  let booking = null
  if (bookingId) {
    const rows = await page.evaluate(async () => window.api.bookings.getAll())
    booking = rows.find((row) => row?.id === bookingId) || null
  }
  if (!booking) {
    booking = {
      id: bookingId,
      customer_name: uniqueCustomer,
      room_id: resolvedRoomId,
      room_number: selectedRoom?.room_number || roomNumber,
      check_in: stay.checkIn,
      check_out: stay.checkOut,
      total_amount: expectedTotal,
      amount_paid: 0,
      _pending_sync: true
    }
  }

  if (waitForVisibleRow) {
    await expect(page.getByTestId(`booking-row-${booking.id}`)).toBeVisible({ timeout: 30000 })
    if (requirePendingSync) {
      await expect(page.getByTestId(`booking-pending-sync-${booking.id}`)).toBeVisible()
    }
  }
  return { booking, customerName: uniqueCustomer, checkIn: stay.checkIn, checkOut: stay.checkOut }
}

export async function addPaymentToBooking(page, booking) {
  const menuToggle = page.getByTestId(`booking-menu-toggle-${booking.id}`)
  const menuToggleVisible = await menuToggle.isVisible({ timeout: 5000 }).catch(() => false)
  if (menuToggleVisible) {
    await menuToggle.click()
  }
  const addPaymentButton = page.getByRole('button', { name: /Add Payment/i })
  if (await addPaymentButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await addPaymentButton.click()
  }

  const paymentModalTitle = page.getByRole('heading', { name: 'Record Payment' })
  if (await paymentModalTitle.isVisible().catch(() => false)) {
    await page.getByTestId('booking-payment-status-select').selectOption('paid')
    await page.getByRole('button', { name: 'Save Payment' }).click()
    await expect(paymentModalTitle).toBeHidden({ timeout: 30000 })
    return
  }

  const outstanding = Number(booking.total_amount || 0) + Number(booking.charges_total || 0) - Number(booking.amount_paid || 0)
  const amount = Math.max(0, outstanding)
  await page.evaluate(async ({ bookingId, paymentAmount }) => {
    await window.api.bookings.updatePayment(
      bookingId,
      paymentAmount,
      'cash',
      `e2e-payment-${bookingId}-${Date.now()}`
    )
  }, { bookingId: booking.id, paymentAmount: amount })
}

export async function waitForSyncToSettle(page, { timeout = 120000 } = {}) {
  await expect.poll(async () => {
    return page.evaluate(async () => {
      const status = await window.api.sync.getStatus()
      return {
        pending: Number(status?.pending || 0),
        failed: Number(status?.failed || 0),
        isOnline: status?.isOnline === true,
        syncInProgress: status?.syncInProgress === true
      }
    })
  }, { timeout }).toMatchObject({
    pending: 0,
    syncInProgress: false
  })
}

export async function switchDesktopToOnline(page) {
  const result = await setTestOfflineMode(page, false)
  expect(result.success).toBe(true)
  await expect.poll(async () => {
    return page.evaluate(async () => {
      const status = await window.api.sync.getStatus()
      return status?.isOnline
    })
  }, { timeout: 30000 }).toBe(true)
}

export async function syncFromSystemHealth(page) {
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByTestId('settings-tab-system').click()
  await page.getByRole('button', { name: /Run Sync Now/i }).click()
  await waitForSyncToSettle(page)
}

export async function readBookings(page) {
  return page.evaluate(async () => window.api.bookings.getAll())
}

export async function readPayments(page, bookingId) {
  return page.evaluate(async (id) => window.api.bookings.getPayments(id), bookingId)
}

export async function readPosOrders(page, {
  startDate = '2000-01-01',
  endDate = '2099-12-31'
} = {}) {
  return page.evaluate(async ({ startDate: start, endDate: end }) => {
    return window.api.pos.getOrders(start, end)
  }, { startDate, endDate })
}

export async function readBookingCharges(page, bookingId) {
  return page.evaluate(async (id) => window.api.charges.getByBooking(id), bookingId)
}

export function getQueuedPosOrderId(item) {
  return (
    item?.data?.payload?.id
    || item?.data?.id
    || item?.data?.order_id
    || null
  )
}

export function buildPosOrderItems(seed, {
  outletId = null,
  quantity = 1,
  menuItem = null
} = {}) {
  const menuItems = Array.isArray(seed?.posMenuItems) ? seed.posMenuItems : []
  const inventoryById = new Map((Array.isArray(seed?.inventoryItems) ? seed.inventoryItems : []).map((item) => [item.id, item]))
  const selectedMenuItem = menuItem || menuItems.find((item) => {
    if (!item?.id || item.is_available === false) return false
    if (outletId && item.outlet_id && String(item.outlet_id) !== String(outletId)) return false
    if (!item.inventory_item_id) return true
    return Number(inventoryById.get(item.inventory_item_id)?.current_stock || 0) > 0
  })

  if (!selectedMenuItem) {
    throw new Error('No usable POS menu item is available in the current seed')
  }

  const unitPrice = Number(selectedMenuItem.price || selectedMenuItem.unit_price || 0)
  return {
    menuItem: selectedMenuItem,
    items: [
      {
        menu_item_id: selectedMenuItem.id,
        item_name: selectedMenuItem.name || 'POS Test Item',
        quantity,
        unit_price: unitPrice
      }
    ],
    expectedTotal: Number((quantity * unitPrice).toFixed(2))
  }
}

export async function waitForPosOrder(page, orderId, {
  timeout = 30000,
  predicate = null
} = {}) {
  let matchedOrder = null
  await expect.poll(async () => {
    const orders = await readPosOrders(page)
    matchedOrder = orders.find((row) => String(row?.id) === String(orderId)) || null
    if (!matchedOrder) return false
    if (typeof predicate !== 'function') return true
    return predicate(matchedOrder)
  }, { timeout }).toBe(true)
  return matchedOrder
}

export async function createPosOrderFromSeed(page, seed, {
  walkInName = `POS Guest ${Date.now()}`,
  outletId = null,
  paymentMethod = 'cash',
  notes = 'Playwright POS order',
  quantity = 1,
  menuItem = null,
  roomId = null,
  bookingId = null
} = {}) {
  const outlet = outletId
    ? (Array.isArray(seed?.outlets) ? seed.outlets.find((entry) => String(entry?.id) === String(outletId)) : null)
    : (Array.isArray(seed?.outlets) ? seed.outlets.find((entry) => entry?.id) : null)

  if (!outlet?.id) {
    throw new Error('No POS outlet is available in the current seed')
  }

  const builtItems = buildPosOrderItems(seed, {
    outletId: outlet.id,
    quantity,
    menuItem
  })

  const result = await createPosOrderViaApi(page, {
    walkInName,
    roomId,
    bookingId,
    outletId: outlet.id,
    paymentMethod,
    notes,
    items: builtItems.items
  })

  const orderId = result?.id || result?.orderId || null
  if (!result?.success || !orderId) {
    throw new Error(result?.error || 'POS order creation did not return an order ID')
  }

  return {
    result,
    orderId,
    outlet,
    menuItem: builtItems.menuItem,
    items: builtItems.items,
    expectedTotal: builtItems.expectedTotal,
    walkInName,
    paymentMethod,
    notes
  }
}

export async function createPosOrderViaApi(page, {
  walkInName = null,
  roomId = null,
  bookingId = null,
  outletId,
  paymentMethod = 'cash',
  notes = null,
  items
}) {
  if (!outletId) {
    throw new Error('outletId is required to create a POS order')
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one POS item is required')
  }

  return page.evaluate(async (payload) => {
    return window.api.pos.createOrder(payload)
  }, {
    walk_in_name: walkInName,
    room_id: roomId,
    booking_id: bookingId,
    outlet_id: outletId,
    payment_method: paymentMethod,
    notes,
    items
  })
}

export async function createOnlineBookingViaApi(page, seed, {
  customerName,
  phone = '+26770009998',
  roomId,
  checkIn,
  checkOut,
  adults = 1,
  children = 0,
  notes = 'Playwright online booking seed',
  waitForRead = true
} = {}) {
  const room = seed.rooms.find((entry) => String(entry?.id) === String(roomId))
  if (!roomId || !checkIn || !checkOut || !room) {
    throw new Error('roomId, checkIn, and checkOut are required to create an online booking')
  }

  const nights = Math.max(1, Math.ceil((new Date(checkOut) - new Date(checkIn)) / 86400000))
  const totalAmount = Number(room.rate_per_night || 0) * nights
  const payload = {
    customerName: customerName || `Server Guest ${Date.now()}`,
    phone,
    roomId,
    checkIn,
    checkOut,
    adults,
    children,
    totalAmount,
    notes
  }

  const result = await page.evaluate(async (input) => {
    const customerResult = await window.api.customers.create({
      name: input.customerName,
      phone: input.phone,
      email: ''
    })
    if (!customerResult?.success || !customerResult?.id) {
      throw new Error(customerResult?.error || 'Could not create online customer')
    }
    const bookingResult = await window.api.bookings.create({
      customer_id: customerResult.id,
      room_id: input.roomId,
      check_in: input.checkIn,
      check_out: input.checkOut,
      adults: input.adults,
      children: input.children,
      total_amount: input.totalAmount,
      notes: input.notes
    })
    if (!bookingResult?.success || !bookingResult?.id) {
      throw new Error(bookingResult?.error || 'Could not create online booking')
    }
    return { customerId: customerResult.id, bookingId: bookingResult.id }
  }, payload)

  let booking = null
  if (waitForRead) {
    await expect.poll(async () => {
      const bookings = await readBookings(page)
      return bookings.some((row) => row?.id === result.bookingId)
    }, { timeout: 30000 }).toBe(true)
    const bookings = await readBookings(page)
    booking = bookings.find((row) => row?.id === result.bookingId) || null
  }

  return {
    customerId: result.customerId,
    bookingId: result.bookingId,
    booking,
    totalAmount,
    customerName: payload.customerName
  }
}

export function getLiveBackendEnvForTests() {
  const env = getRealBackendEnv()
  return {
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY
  }
}
