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
  openBookingsPage,
  readBookings,
  createOnlineBookingViaApi
} from './support/desktop-flows.mjs'

test.setTimeout(180000)

test('desktop picks up a booking created online from another desktop instance', async () => {
  const observerUserDataDir = createTempUserDataDir('boroko-e2e-observer-')
  const actorUserDataDir = createTempUserDataDir('boroko-e2e-actor-')
  const seed = createDesktopSeedFromInstalledProfile()
  seedDesktopUserData(observerUserDataDir, seed)
  seedDesktopUserData(actorUserDataDir, seed)

  const onlineEnv = getRealBackendEnv()
  expect(onlineEnv.SUPABASE_URL).toBeTruthy()
  expect(onlineEnv.SUPABASE_ANON_KEY).toBeTruthy()
  const stay = await findLiveAvailableStay(seed, { minOffsetDays: 46, maxOffsetDays: 170 })

  const observer = await launchDesktopApp({
    userDataDir: observerUserDataDir,
    extraEnv: { BOROKO_TEST_FORCE_OFFLINE: 'true', ...onlineEnv }
  })
  const actor = await launchDesktopApp({
    userDataDir: actorUserDataDir,
    extraEnv: { BOROKO_TEST_FORCE_OFFLINE: 'true', ...onlineEnv }
  })

  try {
    await signInDesktop(observer.window, seed)
    await signInDesktop(actor.window, seed)
    restoreSeededSessionNonce(observerUserDataDir, seed)
    restoreSeededSessionNonce(actorUserDataDir, seed)
    await restoreBackendSession(observer.window, seed)
    await restoreBackendSession(actor.window, seed)
    await switchDesktopToOnline(observer.window)
    await switchDesktopToOnline(actor.window)

    const created = await createOnlineBookingViaApi(actor.window, seed, {
      customerName: `External Intake Guest ${Date.now()}`,
      roomId: stay.roomId,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      waitForRead: true
    })

    await expect.poll(async () => {
      const bookings = await readBookings(observer.window)
      const booking = bookings.find((row) => row?.id === created.bookingId)
      if (!booking) return 'missing'
      if (booking._pending_sync === true) return 'pending'
      if (!String(booking.invoice_number || '').trim()) return 'missing-invoice'
      return 'ready'
    }, { timeout: 120000 }).toBe('ready')

    await openBookingsPage(observer.window)
    await expect(observer.window.getByTestId(`booking-row-${created.bookingId}`)).toBeVisible({ timeout: 30000 })
    await expect(observer.window.getByTestId(`booking-pending-sync-${created.bookingId}`)).toBeHidden()
  } finally {
    await actor.app.close().catch(() => {})
    await observer.app.close().catch(() => {})
  }
})
