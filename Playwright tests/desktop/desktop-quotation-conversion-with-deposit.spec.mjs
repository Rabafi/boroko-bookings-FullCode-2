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
  readBookings,
  readPayments
} from './support/desktop-flows.mjs'

test.setTimeout(180000)

test('desktop converts a quotation into a booking with a non-zero deposit and records the payment correctly', async () => {
  const userDataDir = createTempUserDataDir()
  const seed = createDesktopSeedFromInstalledProfile()
  seedDesktopUserData(userDataDir, seed)

  const onlineEnv = getRealBackendEnv()
  expect(onlineEnv.SUPABASE_URL).toBeTruthy()
  expect(onlineEnv.SUPABASE_ANON_KEY).toBeTruthy()
  const stay = await findLiveAvailableStay(seed, { minOffsetDays: 60, maxOffsetDays: 200 })

  const roomRate = Number(
    seed.rooms.find((room) => String(room.id) === String(stay.roomId))?.rate_per_night || 0
  )
  // Use half the room rate as deposit so it is always < total_amount (partial payment).
  const depositAmount = Math.max(1, Math.floor(roomRate / 2))

  const { app, window: page } = await launchDesktopApp({
    userDataDir,
    extraEnv: { BOROKO_TEST_FORCE_OFFLINE: 'true', ...onlineEnv }
  })

  try {
    await signInDesktop(page, seed)
    restoreSeededSessionNonce(userDataDir, seed)
    await restoreBackendSession(page, seed)
    await switchDesktopToOnline(page)

    const customerName = `Deposit Quotation Guest ${Date.now()}`

    const quotation = await page.evaluate(
      async ({ customerName, roomId, checkIn, checkOut, totalAmount }) => {
        const customerResult = await window.api.customers.create({
          name: customerName,
          phone: '+26770004444',
          email: ''
        })
        if (!customerResult?.success || !customerResult?.id) {
          throw new Error(customerResult?.error || 'Could not create customer')
        }

        const quotationResult = await window.api.quotations.create({
          customer_id: customerResult.id,
          customer_name: customerName,
          customer_phone: '+26770004444',
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
          notes: 'Playwright deposit conversion test'
        })
        if (!quotationResult?.success || !quotationResult?.id) {
          throw new Error(quotationResult?.error || 'Could not create quotation')
        }

        const quotations = await window.api.quotations.getAll()
        const created = quotations.find((row) => row?.id === quotationResult.id)
        if (!created) throw new Error('Created quotation not readable')

        const updateResult = await window.api.quotations.update(created.id, {
          ...created,
          status: 'sent'
        })
        if (!updateResult?.success) {
          throw new Error(updateResult?.error || 'Could not mark quotation as sent')
        }

        return { quotationId: created.id }
      },
      {
        customerName,
        roomId: stay.roomId,
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        totalAmount: roomRate
      }
    )

    await openQuotationsPage(page)
    await expect(page.locator('tr').filter({ hasText: customerName }).first()).toBeVisible({
      timeout: 30000
    })

    // Convert with a non-zero deposit — this previously failed with overload ambiguity.
    const convertResult = await page.evaluate(
      async ({ quotationId, depositAmount }) => {
        return window.api.quotations.convert(quotationId, depositAmount, 'cash')
      },
      { quotationId: quotation.quotationId, depositAmount }
    )

    if (!convertResult?.success) {
      throw new Error(`Quotation convert with deposit failed: ${JSON.stringify(convertResult)}`)
    }

    // Poll until quotation is marked converted.
    await expect
      .poll(
        async () => {
          const quotations = await page.evaluate(async () => window.api.quotations.getAll())
          const updated = quotations.find((row) => row?.id === quotation.quotationId)
          return updated?.status ?? 'missing'
        },
        { timeout: 120000 }
      )
      .toBe('converted')

    const quotations = await page.evaluate(async () => window.api.quotations.getAll())
    const converted = quotations.find((row) => row?.id === quotation.quotationId)
    expect(converted?.converted_booking_id).toBeTruthy()

    const bookings = await readBookings(page)
    const booking = bookings.find((row) => row?.id === converted.converted_booking_id)
    expect(booking).toBeTruthy()
    expect(String(booking.invoice_number || '')).not.toBe('')

    const invoices = await page.evaluate(async () => window.api.invoices.getBookingInvoices())
    const invoice = invoices.find((row) => row?.booking_id === booking.id)
    expect(invoice?.booking_id).toBe(booking.id)

    // Payment row must exist and reflect the deposit.
    const paymentRows = await readPayments(page, booking.id)
    const depositPayments = paymentRows.filter(
      (p) => p.type === 'deposit' && Number(p.amount) === depositAmount
    )
    expect(depositPayments).toHaveLength(1)

    // amount_paid on booking must equal deposit; balance = total - deposit.
    expect(Number(booking.amount_paid)).toBe(depositAmount)
    expect(booking.payment_status).toBe('partial')

    // Reload and confirm UI shows converted status.
    await page.reload()
    await openQuotationsPage(page)
    await expect(
      page.locator('tr').filter({ hasText: customerName }).getByText(/converted/i)
    ).toBeVisible({ timeout: 30000 })
  } finally {
    await app.close().catch(() => {})
  }
})
