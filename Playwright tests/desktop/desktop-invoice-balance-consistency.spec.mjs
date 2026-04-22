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
  openInvoicesPage,
  readBookings,
  createOnlineBookingViaApi
} from './support/desktop-flows.mjs'

test.setTimeout(180000)

function fmtMoney(currency, value) {
  return `${currency} ${Number(value || 0).toFixed(2)}`
}

test('desktop keeps invoice total, amount paid, balance, and invoice number consistent', async () => {
  const userDataDir = createTempUserDataDir()
  const seed = createDesktopSeedFromInstalledProfile()
  seedDesktopUserData(userDataDir, seed)

  const onlineEnv = getRealBackendEnv()
  expect(onlineEnv.SUPABASE_URL).toBeTruthy()
  expect(onlineEnv.SUPABASE_ANON_KEY).toBeTruthy()
  const stay = await findLiveAvailableStay(seed, { minOffsetDays: 52, maxOffsetDays: 180 })

  const { app, window: page } = await launchDesktopApp({
    userDataDir,
    extraEnv: { BOROKO_TEST_FORCE_OFFLINE: 'true', ...onlineEnv }
  })

  try {
    await signInDesktop(page, seed)
    restoreSeededSessionNonce(userDataDir, seed)
    await restoreBackendSession(page, seed)
    await switchDesktopToOnline(page)

    const created = await createOnlineBookingViaApi(page, seed, {
      customerName: `Invoice Guest ${Date.now()}`,
      roomId: stay.roomId,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      waitForRead: true
    })
    const paymentAmount = Number((created.totalAmount / 2).toFixed(2))

    const paymentResult = await page.evaluate(async ({ bookingId, amount }) => {
      return window.api.bookings.updatePayment(
        bookingId,
        amount,
        'cash',
        `invoice-consistency-${bookingId}-${Date.now()}`
      )
    }, { bookingId: created.bookingId, amount: paymentAmount })
    expect(paymentResult?.success).toBe(true)

    await expect.poll(async () => {
      const bookings = await readBookings(page)
      const booking = bookings.find((row) => row?.id === created.bookingId)
      if (!booking) return { amountPaid: 0, invoiceNumber: '' }
      return {
        amountPaid: Number(booking.amount_paid || 0),
        invoiceNumber: String(booking.invoice_number || '')
      }
    }, { timeout: 120000 }).toMatchObject({
      amountPaid: paymentAmount
    })

    const invoices = await page.evaluate(async () => window.api.invoices.getBookingInvoices())
    const invoice = invoices.find((row) => row?.booking_id === created.bookingId)
    expect(invoice).toBeTruthy()
    expect(Number(invoice.total_amount || 0)).toBe(created.totalAmount)
    expect(Number(invoice.amount_paid || 0)).toBe(paymentAmount)
    expect(Number(invoice.balance_due || 0)).toBe(Number((created.totalAmount - paymentAmount).toFixed(2)))
    expect(String(invoice.invoice_number || '')).not.toBe('')

    await openInvoicesPage(page)
    await page.getByText(invoice.invoice_number).click()
    await expect(page.getByRole('heading', { name: `Invoice ${invoice.invoice_number}` })).toBeVisible({ timeout: 30000 })
    await expect(page.getByText(fmtMoney(seed.settings.currency || 'P', invoice.total_amount)).first()).toBeVisible()
    await expect(page.getByText(`Paid ${fmtMoney(seed.settings.currency || 'P', invoice.amount_paid)}`).first()).toBeVisible()
    await expect(page.getByText(`Balance ${fmtMoney(seed.settings.currency || 'P', invoice.balance_due)}`).first()).toBeVisible()
  } finally {
    await app.close().catch(() => {})
  }
})
