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
  createOfflineBooking,
  addPaymentToBooking,
  readBookings,
  readPayments,
  switchDesktopToOnline,
  restoreBackendSession,
  waitForSyncToSettle
} from './support/desktop-flows.mjs'

test.setTimeout(180000)

function getQueuedBookingId(item) {
  return (
    item?.data?.p_booking_id
    || item?.data?.payload?.booking_id
    || item?.data?.payload?.id
    || item?.data?.p_id
    || null
  )
}

test('desktop prevents duplicate sync effects when sync is triggered twice at the same time', async () => {
  const userDataDir = createTempUserDataDir()
  const seed = createDesktopSeedFromInstalledProfile()
  seedDesktopUserData(userDataDir, seed)

  const onlineEnv = getRealBackendEnv()
  expect(onlineEnv.SUPABASE_URL).toBeTruthy()
  expect(onlineEnv.SUPABASE_ANON_KEY).toBeTruthy()
  const stay = await findLiveAvailableStay(seed, { minOffsetDays: 34, maxOffsetDays: 150 })

  const { app, window: page } = await launchDesktopApp({
    userDataDir,
    extraEnv: {
      BOROKO_TEST_FORCE_OFFLINE: 'true',
      ...onlineEnv
    }
  })

  try {
    await signInDesktop(page, seed)

    const created = await createOfflineBooking(page, seed, {
      customerName: `Sync Lock Guest ${Date.now()}`,
      roomId: stay.roomId,
      roomNumber: stay.roomNumber,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      requirePendingSync: true,
      waitForVisibleRow: true
    })

    await addPaymentToBooking(page, created.booking)

    restoreSeededSessionNonce(userDataDir, seed)
    await restoreBackendSession(page, seed)
    await switchDesktopToOnline(page)

    const syncResults = await page.evaluate(async () => Promise.all([
      window.api.sync.runNow(),
      window.api.sync.runNow()
    ]))
    expect(syncResults.every((result) => result?.success === true)).toBe(true)

    await waitForSyncToSettle(page, { timeout: 120000 })

    await expect.poll(async () => {
      const bookings = await readBookings(page)
      const current = bookings.find((row) => row.id === created.booking.id)
      if (!current) return 'missing'
      if (current._pending_sync === true) return 'pending'
      if (!String(current.invoice_number || '').trim()) return 'missing-invoice'
      if (Number(current.amount_paid || 0) <= 0) return 'unpaid'
      return 'synced'
    }, { timeout: 120000 }).toBe('synced')

    const bookings = await readBookings(page)
    const matching = bookings.filter((row) => row.id === created.booking.id)
    const syncedBooking = matching[0]
    const paymentRows = await readPayments(page, created.booking.id)
    const syncDetails = await page.evaluate(async () => window.api.sync.getDetails())
    const relatedPending = (syncDetails?.pending || []).filter((item) => getQueuedBookingId(item) === created.booking.id)
    const relatedFailed = (syncDetails?.failed || []).filter((item) => getQueuedBookingId(item) === created.booking.id)
    const positivePayments = paymentRows.filter((payment) => Number(payment.amount || 0) > 0)

    expect(matching).toHaveLength(1)
    expect(syncedBooking._pending_sync).not.toBe(true)
    expect(String(syncedBooking.invoice_number || '')).not.toBe('')
    expect(Number(syncedBooking.amount_paid || 0)).toBeGreaterThan(0)
    expect(positivePayments).toHaveLength(1)
    expect(relatedPending).toHaveLength(0)
    expect(relatedFailed).toHaveLength(0)
  } finally {
    await app.close().catch(() => {})
  }
})
