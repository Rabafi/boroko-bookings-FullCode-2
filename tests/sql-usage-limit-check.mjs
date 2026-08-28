import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const TEST_LODGE_ID = process.env.SQL_USAGE_TEST_LODGE_ID || process.env.TEST_LODGE_ID || ''

function skip(message) {
  console.log(`sql-usage-limit-check: skipped - ${message}`)
  process.exitCode = 0
}

function monthWindow(date = new Date()) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0))
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0))
  return { start, end }
}

async function run() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !TEST_LODGE_ID) {
    skip('set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SQL_USAGE_TEST_LODGE_ID to run against a disposable Starter lodge')
    return
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  const { data: planName, error: planError } = await supabase.rpc('get_lodge_usage_plan', {
    p_lodge_id: TEST_LODGE_ID
  })
  if (planError) throw planError
  if (String(planName || '').trim() !== 'Starter') {
    skip(`lodge ${TEST_LODGE_ID} is not on Starter (current plan: ${planName || 'unknown'})`)
    return
  }

  const { data: rooms, error: roomsError } = await supabase
    .from('rooms')
    .select('id, room_number, rate_per_night')
    .eq('lodge_id', TEST_LODGE_ID)
    .order('created_at', { ascending: true })
  if (roomsError) throw roomsError
  if (!Array.isArray(rooms) || rooms.length < 4) {
    skip('need at least four rooms in the test lodge so the harness can create 122 non-overlapping bookings in one month')
    return
  }

  const { data: customerRows, error: customerError } = await supabase
    .from('customers')
    .select('id')
    .eq('lodge_id', TEST_LODGE_ID)
    .limit(1)
  if (customerError) throw customerError

  let customerId = customerRows?.[0]?.id || null
  let createdCustomerId = null
  if (!customerId) {
    customerId = randomUUID()
    createdCustomerId = customerId
    const { data: customerResult, error: createCustomerError } = await supabase.rpc('create_customer', {
      payload: {
        id: customerId,
        lodge_id: TEST_LODGE_ID,
        name: `SQL Usage Test ${customerId.slice(0, 8)}`,
        email: `sql-usage-${customerId.slice(0, 8)}@example.invalid`,
        phone: '',
        id_number: '',
        nationality: ''
      }
    })
    if (createCustomerError) throw createCustomerError
    if (!customerResult?.success) throw new Error(customerResult?.error || 'Could not create test customer')
  }

  const targetMonth = new Date(Date.UTC(2099, 0, 15, 12, 0, 0))
  const creationMonth = new Date(Date.UTC(2099, 1, 15, 12, 0, 0))
  const targetMonthWindow = monthWindow(targetMonth)
  const creationMonthWindow = monthWindow(creationMonth)

  const [{ count: targetCount }, { count: creationTargetCount }] = await Promise.all([
    supabase.from('bookings').select('id', { count: 'exact', head: true })
      .eq('lodge_id', TEST_LODGE_ID)
      .in('status', ['confirmed', 'checked_in', 'checked_out'])
      .eq('is_exclusive_event', false)
      .gte('check_in', targetMonthWindow.start.toISOString().slice(0, 10))
      .lt('check_in', targetMonthWindow.end.toISOString().slice(0, 10)),
    supabase.from('bookings').select('id', { count: 'exact', head: true })
      .eq('lodge_id', TEST_LODGE_ID)
      .in('status', ['confirmed', 'checked_in', 'checked_out'])
      .eq('is_exclusive_event', false)
      .gte('check_in', creationMonthWindow.start.toISOString().slice(0, 10))
      .lt('check_in', creationMonthWindow.end.toISOString().slice(0, 10))
  ])

  if (Number(targetCount || 0) !== 0 || Number(creationTargetCount || 0) !== 0) {
    skip('the disposable test lodge already has bookings in the test months; choose a cleaner lodge before running this script')
    return
  }

  const targetBookingIds = []
  const creationBookingIds = []

  function pickSlot(index, monthDate) {
    const room = rooms[index % rooms.length]
    const dateOffset = Math.floor(index / rooms.length)
    const checkInDate = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1 + dateOffset, 12, 0, 0))
    const checkOutDate = new Date(checkInDate.getTime() + 86400000)
    return {
      room,
      checkInDate,
      checkOutDate,
      totalAmount: Number(room.rate_per_night || 0)
    }
  }

  async function createBookingFor(slot, bookingId) {
    const { data, error } = await supabase.rpc('create_booking', {
      p_lodge_id: TEST_LODGE_ID,
      p_customer_id: customerId,
      p_room_id: slot.room.id,
      p_check_in: slot.checkInDate.toISOString().slice(0, 10),
      p_check_out: slot.checkOutDate.toISOString().slice(0, 10),
      p_adults: 1,
      p_children: 0,
      p_total_amount: slot.totalAmount,
      p_invoice_number: null,
      p_notes: 'SQL usage limit harness',
      p_created_by: null,
      p_deposit_amount: 0,
      p_booking_id: bookingId,
      p_idempotency_key: `sql-usage:${bookingId}`,
      p_deposit_method: null
    })
    if (error) throw error
    if (!data?.success) throw new Error(data?.error || 'Booking insert failed')
    return data.booking_id || bookingId
  }

  async function deleteBookingArtifacts(bookingIds) {
    if (!bookingIds.length) return
    const { error: invoiceDeleteError } = await supabase.from('invoices').delete().in('booking_id', bookingIds)
    if (invoiceDeleteError) throw invoiceDeleteError
    const { error: bookingDeleteError } = await supabase.from('bookings').delete().in('id', bookingIds)
    if (bookingDeleteError) throw bookingDeleteError
  }

  try {
    // Starter target-month limit: 120 base + 2 grace bookings.
    for (let i = 0; i < 122; i += 1) {
      const bookingId = randomUUID()
      const createdBookingId = await createBookingFor(pickSlot(i, targetMonth), bookingId)
      targetBookingIds.push(createdBookingId)
    }

    const { count: shiftedTargetCount } = await supabase.from('bookings').select('id', { count: 'exact', head: true })
      .eq('lodge_id', TEST_LODGE_ID)
      .in('status', ['confirmed', 'checked_in', 'checked_out'])
      .eq('is_exclusive_event', false)
      .gte('check_in', targetMonthWindow.start.toISOString().slice(0, 10))
      .lt('check_in', targetMonthWindow.end.toISOString().slice(0, 10))
    assert.equal(Number(shiftedTargetCount || 0), 122)

    const targetFailureId = randomUUID()
    const targetFailureSlot = pickSlot(122, targetMonth)
    const { data: targetFailureResult, error: targetFailureError } = await supabase.rpc('create_booking', {
      p_lodge_id: TEST_LODGE_ID,
      p_customer_id: customerId,
      p_room_id: targetFailureSlot.room.id,
      p_check_in: targetFailureSlot.checkInDate.toISOString().slice(0, 10),
      p_check_out: targetFailureSlot.checkOutDate.toISOString().slice(0, 10),
      p_adults: 1,
      p_children: 0,
      p_total_amount: targetFailureSlot.totalAmount,
      p_invoice_number: null,
      p_notes: 'SQL usage limit harness',
      p_created_by: null,
      p_deposit_amount: 0,
      p_booking_id: targetFailureId,
      p_idempotency_key: `sql-usage:${targetFailureId}`,
      p_deposit_method: null
    })
    if (targetFailureError) throw targetFailureError
    assert.equal(targetFailureResult?.success, false)
    assert.match(String(targetFailureResult?.error || ''), /selected check-in month/i)

    // Creation month is informational: after creating 122 rows now, another
    // booking for a different check-in month must still succeed.
    const creationBookingId = randomUUID()
    const createdBookingId = await createBookingFor(pickSlot(0, creationMonth), creationBookingId)
    creationBookingIds.push(createdBookingId)

    await deleteBookingArtifacts(creationBookingIds)
    creationBookingIds.length = 0

    console.log('sql-usage-limit-check: ok')
  } finally {
    await deleteBookingArtifacts(targetBookingIds).catch(() => {})
    await deleteBookingArtifacts(creationBookingIds).catch(() => {})
    if (createdCustomerId) {
      await supabase.from('customers').delete().eq('id', createdCustomerId).eq('lodge_id', TEST_LODGE_ID).catch(() => {})
    }
  }
}

run().catch((error) => {
  console.error('sql-usage-limit-check: failed')
  console.error(error)
  process.exitCode = 1
})
