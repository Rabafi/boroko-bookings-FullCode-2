import { test, expect } from '@playwright/test'
import {
  createTempUserDataDir,
  createDesktopSeedFromInstalledProfile,
  seedDesktopUserData,
  launchDesktopApp,
  getRealBackendEnv,
  findLiveAvailableStay,
  restoreSeededSessionNonce
} from './support/desktop-app.mjs'
import {
  signInDesktop,
  restoreBackendSession,
  switchDesktopToOnline,
  openQuotationsPage,
  readBookings
} from './support/desktop-flows.mjs'

test.setTimeout(180000)

test('desktop converts an online quotation into a booking with invoice linkage', async () => {
  const userDataDir = createTempUserDataDir()
  const seed = createDesktopSeedFromInstalledProfile()
  seedDesktopUserData(userDataDir, seed)

  const onlineEnv = getRealBackendEnv()
  expect(onlineEnv.SUPABASE_URL).toBeTruthy()
  expect(onlineEnv.SUPABASE_ANON_KEY).toBeTruthy()
  const stay = await findLiveAvailableStay(seed, { minOffsetDays: 58, maxOffsetDays: 190 })

  const { app, window: page } = await launchDesktopApp({
    userDataDir,
    extraEnv: { BOROKO_TEST_FORCE_OFFLINE: 'true', ...onlineEnv }
  })

  try {
    await signInDesktop(page, seed)
    restoreSeededSessionNonce(userDataDir, seed)
    await restoreBackendSession(page, seed)
    await switchDesktopToOnline(page)

    const customerName = `Quotation Guest ${Date.now()}`
    const quotation = await page.evaluate(async ({ customerName, roomId, checkIn, checkOut, totalAmount }) => {
      const customerResult = await window.api.customers.create({
        name: customerName,
        phone: '+26770003333',
        email: ''
      })
      if (!customerResult?.success || !customerResult?.id) {
        throw new Error(customerResult?.error || 'Could not create quotation customer')
      }

      const quotationResult = await window.api.quotations.create({
        customer_id: customerResult.id,
        customer_name: customerName,
        customer_phone: '+26770003333',
        room_id: roomId,
        check_in: checkIn,
        check_out: checkOut,
        adults: 1,
        children: 0,
        subtotal: totalAmount,
        tax_amount: 0,
        total_amount: totalAmount,
        currency: 'P',
        valid_until: checkIn,
        notes: 'Playwright quotation conversion test'
      })
      if (!quotationResult?.success || !quotationResult?.id) {
        throw new Error(quotationResult?.error || 'Could not create quotation')
      }

      const quotations = await window.api.quotations.getAll()
      const created = quotations.find((row) => row?.id === quotationResult.id)
      if (!created) throw new Error('Created quotation was not readable')

      const updateResult = await window.api.quotations.update(created.id, { ...created, status: 'sent' })
      if (!updateResult?.success) {
        throw new Error(updateResult?.error || 'Could not mark quotation as sent')
      }

      return { quotationId: created.id }
    }, {
      customerName,
      roomId: stay.roomId,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      totalAmount: Number(seed.rooms.find((room) => String(room.id) === String(stay.roomId))?.rate_per_night || 0)
    })

    await openQuotationsPage(page)
    const quotationRow = page.locator('tr').filter({ hasText: customerName }).first()
    await expect(quotationRow).toBeVisible({ timeout: 30000 })
    const convertResult = await page.evaluate(async ({ quotationId }) => {
      return window.api.quotations.convert(quotationId, 0, 'cash')
    }, { quotationId: quotation.quotationId })
    if (!convertResult?.success) {
      throw new Error(`Quotation convert failed: ${JSON.stringify(convertResult)}`)
    }

    await expect.poll(async () => {
      const quotations = await page.evaluate(async () => window.api.quotations.getAll())
      const updated = quotations.find((row) => row?.id === quotation.quotationId)
      if (!updated) return { status: 'missing', bookingId: null }
      return {
        status: updated.status,
        bookingId: updated.converted_booking_id || null
      }
    }, { timeout: 120000 }).toMatchObject({
      status: 'converted'
    })

    const quotations = await page.evaluate(async () => window.api.quotations.getAll())
    const converted = quotations.find((row) => row?.id === quotation.quotationId)
    const bookings = await readBookings(page)
    const booking = bookings.find((row) => row?.id === converted?.converted_booking_id)
    const invoices = await page.evaluate(async () => window.api.invoices.getBookingInvoices())
    const invoice = invoices.find((row) => row?.booking_id === booking?.id)

    expect(converted?.converted_booking_id).toBeTruthy()
    expect(booking).toBeTruthy()
    expect(String(booking.invoice_number || '')).not.toBe('')
    expect(invoice?.booking_id).toBe(booking.id)
    await page.reload()
    await openQuotationsPage(page)
    await expect(page.locator('tr').filter({ hasText: customerName }).getByText(/converted/i)).toBeVisible({ timeout: 30000 })
  } finally {
    await app.close().catch(() => {})
  }
})
