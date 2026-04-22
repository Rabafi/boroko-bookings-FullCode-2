import { test, expect } from '@playwright/test'
import {
  createTempUserDataDir,
  createDesktopSeedFromInstalledProfile,
  seedDesktopUserData,
  launchDesktopApp,
  forceCloseElectronApp,
  getRealBackendEnv,
  findLiveAvailableStay,
  restoreSeededSessionNonce
} from './support/desktop-app.mjs'
import {
  signInDesktop,
  createOfflineBooking,
  addPaymentToBooking,
  switchDesktopToOnline,
  syncFromSystemHealth,
  readBookings,
  readPayments,
  restoreBackendSession
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

test('desktop preserves an offline payment across a crash and syncs it successfully after restart', async () => {
  const userDataDir = createTempUserDataDir()
  const seed = createDesktopSeedFromInstalledProfile()
  seedDesktopUserData(userDataDir, seed)

  const onlineEnv = getRealBackendEnv()
  expect(onlineEnv.SUPABASE_URL).toBeTruthy()
  expect(onlineEnv.SUPABASE_ANON_KEY).toBeTruthy()
  const stay = await findLiveAvailableStay(seed, { minOffsetDays: 35, maxOffsetDays: 150 })

  const firstRun = await launchDesktopApp({
    userDataDir,
    extraEnv: {
      BOROKO_TEST_FORCE_OFFLINE: 'true',
      ...onlineEnv
    }
  })

  const { app, window: page } = firstRun

  try {
    await signInDesktop(page, seed)

    const created = await createOfflineBooking(page, seed, {
      customerName: `Crash Payment Guest ${Date.now()}`,
      roomId: stay.roomId,
      roomNumber: stay.roomNumber,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      requirePendingSync: true,
      waitForVisibleRow: true
    })

    await addPaymentToBooking(page, created.booking)

    const beforeCrashBookings = await readBookings(page)
    const beforeCrashBooking = beforeCrashBookings.find((row) => row.id === created.booking.id)
    const beforeCrashSync = await page.evaluate(async () => window.api.sync.getDetails())
    const beforeCrashPaymentQueue = (beforeCrashSync?.pending || []).filter((item) => (
      item?.table === 'update_booking_payment' && getQueuedBookingId(item) === created.booking.id
    ))

    expect(beforeCrashBooking).toBeTruthy()
    expect(beforeCrashBooking._pending_sync).toBe(true)
    expect(beforeCrashBooking._pending_payment).toBe(true)
    expect(beforeCrashPaymentQueue.length).toBeGreaterThan(0)
    await expect(page.getByText('Queued (will sync)')).toBeVisible()

    await forceCloseElectronApp(app)

    const restarted = await launchDesktopApp({
      userDataDir,
      extraEnv: {
        BOROKO_TEST_FORCE_OFFLINE: 'true',
        ...onlineEnv
      }
    })

    const { app: restartedApp, window: restartedPage } = restarted
    try {
      await signInDesktop(restartedPage, seed)
      await restartedPage.getByRole('link', { name: 'Bookings' }).click()
      await expect(restartedPage.getByRole('heading', { name: 'Bookings' })).toBeVisible({ timeout: 30000 })

      const afterRestartBookings = await readBookings(restartedPage)
      const restoredBooking = afterRestartBookings.find((row) => row.id === created.booking.id)
      const afterRestartSync = await restartedPage.evaluate(async () => window.api.sync.getDetails())
      const restoredPaymentQueue = (afterRestartSync?.pending || []).filter((item) => (
        item?.table === 'update_booking_payment' && getQueuedBookingId(item) === created.booking.id
      ))

      expect(restoredBooking).toBeTruthy()
      expect(restoredBooking._pending_sync).toBe(true)
      expect(restoredBooking._pending_payment).toBe(true)
      expect(restoredPaymentQueue.length).toBeGreaterThan(0)
      await expect(restartedPage.getByTestId(`booking-pending-sync-${created.booking.id}`)).toBeVisible()
      await expect(restartedPage.getByText('Queued (will sync)')).toBeVisible()

      restoreSeededSessionNonce(userDataDir, seed)
      await restoreBackendSession(restartedPage, seed)
      await switchDesktopToOnline(restartedPage)
      await syncFromSystemHealth(restartedPage)

      await expect.poll(async () => {
        const bookings = await readBookings(restartedPage)
        const current = bookings.find((row) => row.id === created.booking.id)
        if (!current) return 'missing'
        if (current._pending_sync === true) return 'pending'
        if (Number(current.amount_paid || 0) <= 0) return 'unpaid'
        if (!String(current.invoice_number || '').trim()) return 'missing-invoice'
        return 'synced'
      }, { timeout: 120000 }).toBe('synced')

      const syncedBookings = await readBookings(restartedPage)
      const syncedBooking = syncedBookings.find((row) => row.id === created.booking.id)
      const paymentRows = await readPayments(restartedPage, created.booking.id)
      const positivePayments = paymentRows.filter((payment) => Number(payment.amount || 0) > 0)

      expect(syncedBooking).toBeTruthy()
      expect(syncedBooking._pending_sync).not.toBe(true)
      expect(syncedBooking._pending_payment).not.toBe(true)
      expect(Number(syncedBooking.amount_paid || 0)).toBeGreaterThan(0)
      expect(String(syncedBooking.invoice_number || '')).not.toBe('')
      expect(positivePayments.length).toBeGreaterThan(0)
      await expect(restartedPage.getByTestId(`booking-pending-sync-${created.booking.id}`)).toHaveCount(0)
    } finally {
      await restartedApp.close().catch(() => {})
    }
  } catch (error) {
    await app.close().catch(() => {})
    throw error
  }
})
