import { test, expect } from '@playwright/test'
import {
  createTempUserDataDir,
  createDesktopSeedFromInstalledProfile,
  seedDesktopUserData,
  launchDesktopApp,
  forceCloseElectronApp,
  getRealBackendEnv,
  findLiveAvailableStay
} from './support/desktop-app.mjs'
import {
  signInDesktop,
  createOfflineBooking,
  switchDesktopToOnline,
  syncFromSystemHealth,
  readBookings
} from './support/desktop-flows.mjs'

test.setTimeout(120000)

test('desktop keeps offline bookings after a crash and can sync them after restart', async () => {
  const userDataDir = createTempUserDataDir()
  const seed = createDesktopSeedFromInstalledProfile()
  seedDesktopUserData(userDataDir, seed)

  const onlineEnv = getRealBackendEnv()
  expect(onlineEnv.SUPABASE_URL).toBeTruthy()
  expect(onlineEnv.SUPABASE_ANON_KEY).toBeTruthy()
  const stay = await findLiveAvailableStay(seed, { minOffsetDays: 31, maxOffsetDays: 120 })

  const firstRun = await launchDesktopApp({
    userDataDir,
    extraEnv: {
      BOROKO_TEST_FORCE_OFFLINE: 'true'
    }
  })

  const { app, window: page } = firstRun

  try {
    await signInDesktop(page, seed)
    await expect(page.getByTestId('sidebar-sync-panel')).toBeVisible({ timeout: 30000 })
    const { booking } = await createOfflineBooking(page, seed, {
      customerName: `Crash Guest ${Date.now()}`,
      roomId: stay.roomId,
      roomNumber: stay.roomNumber,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      requirePendingSync: false,
      waitForVisibleRow: false
    })
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
      await expect(restartedPage.getByTestId('sidebar-sync-panel')).toBeVisible({ timeout: 30000 })
      await restartedPage.getByRole('link', { name: 'Bookings' }).click()
      await expect(restartedPage.getByRole('heading', { name: 'Bookings' })).toBeVisible({ timeout: 30000 })

      const bookingsAfterRestart = await readBookings(restartedPage)
      const restored = bookingsAfterRestart.find((row) => row.id === booking.id)

      expect(restored).toBeTruthy()
      expect(restored._pending_sync).toBe(true)
      await expect(restartedPage.getByTestId(`booking-pending-sync-${booking.id}`)).toBeVisible()

      await switchDesktopToOnline(restartedPage)
      await syncFromSystemHealth(restartedPage)
      await expect.poll(async () => {
        const status = await restartedPage.evaluate(async () => window.api.sync.getStatus())
        return status?.pending
      }, { timeout: 120000 }).toBe(0)

      await restartedPage.getByRole('link', { name: 'Bookings' }).click()
      await expect(restartedPage.getByTestId(`booking-pending-sync-${booking.id}`)).toHaveCount(0)
      const bookingsAfterSync = await readBookings(restartedPage)
      const synced = bookingsAfterSync.find((row) => row.id === booking.id)
      expect(synced).toBeTruthy()
      expect(String(synced.invoice_number || '')).not.toBe('')
    } finally {
      await restartedApp.close().catch(() => {})
    }
  } catch (error) {
    await app.close().catch(() => {})
    throw error
  }
})
