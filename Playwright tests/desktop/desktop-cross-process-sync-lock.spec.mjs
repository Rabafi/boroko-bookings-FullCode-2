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
  restoreBackendSession,
  switchDesktopToOnline,
  waitForSyncToSettle
} from './support/desktop-flows.mjs'

test.setTimeout(240000)

function getQueuedBookingId(item) {
  return item?.data?.p_booking_id || item?.data?.payload?.booking_id || item?.data?.payload?.id || item?.data?.p_id || null
}

test('desktop enforces the sync lock across two Electron processes sharing the same profile', async () => {
  const sharedUserDataDir = createTempUserDataDir('boroko-e2e-shared-')
  const seed = createDesktopSeedFromInstalledProfile()
  seedDesktopUserData(sharedUserDataDir, seed)

  const onlineEnv = getRealBackendEnv()
  expect(onlineEnv.SUPABASE_URL).toBeTruthy()
  expect(onlineEnv.SUPABASE_ANON_KEY).toBeTruthy()
  const stay = await findLiveAvailableStay(seed, { minOffsetDays: 64, maxOffsetDays: 210 })

  const primary = await launchDesktopApp({
    userDataDir: sharedUserDataDir,
    extraEnv: { BOROKO_TEST_FORCE_OFFLINE: 'true', ...onlineEnv }
  })

  try {
    await signInDesktop(primary.window, seed)
    const created = await createOfflineBooking(primary.window, seed, {
      customerName: `Cross Process Guest ${Date.now()}`,
      roomId: stay.roomId,
      roomNumber: stay.roomNumber,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      requirePendingSync: true,
      waitForVisibleRow: true
    })
    await addPaymentToBooking(primary.window, created.booking)
    restoreSeededSessionNonce(sharedUserDataDir, seed)

    const secondary = await launchDesktopApp({
      userDataDir: sharedUserDataDir,
      extraEnv: { BOROKO_TEST_FORCE_OFFLINE: 'true', ...onlineEnv }
    })

    try {
      await signInDesktop(secondary.window, seed)
      restoreSeededSessionNonce(sharedUserDataDir, seed)
      await restoreBackendSession(primary.window, seed)
      await restoreBackendSession(secondary.window, seed)
      await switchDesktopToOnline(primary.window)
      await switchDesktopToOnline(secondary.window)

      const [primaryResult, secondaryResult] = await Promise.all([
        primary.window.evaluate(async () => window.api.sync.runNow()),
        secondary.window.evaluate(async () => window.api.sync.runNow())
      ])

      expect(primaryResult?.success).toBe(true)
      expect(secondaryResult?.success).toBe(true)

      await waitForSyncToSettle(primary.window, { timeout: 120000 })
      await waitForSyncToSettle(secondary.window, { timeout: 120000 })

      await expect.poll(async () => {
        const bookings = await readBookings(primary.window)
        const booking = bookings.find((row) => row.id === created.booking.id)
        if (!booking) return 'missing'
        if (booking._pending_sync === true) return 'pending'
        if (!String(booking.invoice_number || '').trim()) return 'missing-invoice'
        if (Number(booking.amount_paid || 0) <= 0) return 'unpaid'
        return 'synced'
      }, { timeout: 120000 }).toBe('synced')

      const bookings = await readBookings(primary.window)
      const syncedRows = bookings.filter((row) => row.id === created.booking.id)
      const payments = await readPayments(primary.window, created.booking.id)
      const syncDetails = await primary.window.evaluate(async () => window.api.sync.getDetails())
      const relatedPending = (syncDetails?.pending || []).filter((item) => getQueuedBookingId(item) === created.booking.id)
      const relatedFailed = (syncDetails?.failed || []).filter((item) => getQueuedBookingId(item) === created.booking.id)

      expect(syncedRows).toHaveLength(1)
      expect(payments.filter((payment) => Number(payment.amount || 0) > 0)).toHaveLength(1)
      expect(relatedPending).toHaveLength(0)
      expect(relatedFailed).toHaveLength(0)
    } finally {
      await secondary.app.close().catch(() => {})
    }
  } finally {
    await primary.app.close().catch(() => {})
  }
})
