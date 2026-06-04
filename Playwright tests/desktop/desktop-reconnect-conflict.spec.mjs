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
  readBookings,
  switchDesktopToOnline,
  createOnlineBookingViaApi
} from './support/desktop-flows.mjs'

test.setTimeout(240000)

function getQueuedBookingId(item) {
  return (
    item?.data?.p_booking_id
    || item?.data?.payload?.booking_id
    || item?.data?.payload?.id
    || item?.data?.p_id
    || null
  )
}

test('desktop keeps local state intact and surfaces a clear sync failure when a room conflicts on reconnect', async () => {
  const userDataDir = createTempUserDataDir()
  const serverUserDataDir = createTempUserDataDir()
  const seed = createDesktopSeedFromInstalledProfile()
  seedDesktopUserData(userDataDir, seed)
  seedDesktopUserData(serverUserDataDir, seed)

  const onlineEnv = getRealBackendEnv()
  expect(onlineEnv.SUPABASE_URL).toBeTruthy()
  expect(onlineEnv.SUPABASE_ANON_KEY).toBeTruthy()
  const stay = await findLiveAvailableStay(seed, { minOffsetDays: 33, maxOffsetDays: 150 })

  const offlineRun = await launchDesktopApp({
    userDataDir,
    extraEnv: {
      BOROKO_TEST_FORCE_OFFLINE: 'true',
      ...onlineEnv
    }
  })
  const serverRun = await launchDesktopApp({
    userDataDir: serverUserDataDir,
    extraEnv: {
      BOROKO_TEST_FORCE_OFFLINE: 'false',
      ...onlineEnv
    }
  })

  const { app: offlineApp, window: offlinePage } = offlineRun
  const { app: serverApp, window: serverPage } = serverRun
  let conflictingBookingId = null

  try {
    await signInDesktop(offlinePage, seed)

    const created = await createOfflineBooking(offlinePage, seed, {
      customerName: `Conflict Guest ${Date.now()}`,
      roomId: stay.roomId,
      roomNumber: stay.roomNumber,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      requirePendingSync: true,
      waitForVisibleRow: true
    })

    const serverRestored = await serverPage.evaluate(async ({ user, scope }) => {
      localStorage.setItem('bb_user', JSON.stringify(user))
      localStorage.setItem('bb_user_scope', scope)
      const restoredUser = await window.api.auth.restoreCurrentSession()
      if (!restoredUser) return false
      await window.api.auth.validateSession?.()
      return true
    }, {
      user: seed.localStorageUser,
      scope: seed.lodgeId
    })
    expect(serverRestored).toBe(true)
    await switchDesktopToOnline(serverPage)

    const conflicting = await createOnlineBookingViaApi(serverPage, seed, {
      customerName: `Server Conflict Guest ${Date.now()}`,
      roomId: stay.roomId,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      waitForRead: true
    })
    conflictingBookingId = conflicting.bookingId
    expect(conflicting.bookingId).toBeTruthy()
    await serverApp.close().catch(() => {})

    restoreSeededSessionNonce(userDataDir, seed)
    const restored = await offlinePage.evaluate(async ({ user, scope }) => {
      localStorage.setItem('bb_user', JSON.stringify(user))
      localStorage.setItem('bb_user_scope', scope)
      const restoredUser = await window.api.auth.restoreCurrentSession()
      if (!restoredUser) return false
      await window.api.auth.validateSession?.()
      return true
    }, {
      user: seed.localStorageUser,
      scope: seed.lodgeId
    })
    expect(restored).toBe(true)
    await switchDesktopToOnline(offlinePage)

    await offlinePage.getByRole('link', { name: 'Settings' }).click()
    await offlinePage.getByTestId('settings-tab-system').click()
    await offlinePage.getByRole('button', { name: /Run Sync Now/i }).click()

    await expect.poll(async () => {
      const bookings = await readBookings(offlinePage)
      const current = bookings.find((row) => row.id === created.booking.id)
      return current?._sync_state || null
    }, { timeout: 120000 }).toBe('sync_failed')

    const failedDetails = await offlinePage.evaluate(async () => window.api.sync.getDetails())
    const relatedFailed = (failedDetails?.failed || []).find((item) => getQueuedBookingId(item) === created.booking.id) || null
    expect(relatedFailed).toBeTruthy()
    expect(String(relatedFailed.lastError || '')).toMatch(/already booked|overlapping|conflict/i)

    const localBookings = await readBookings(offlinePage)
    const localMatch = localBookings.filter((row) => row.id === created.booking.id)
    expect(localMatch).toHaveLength(1)
    expect(localMatch[0]._pending_sync).toBe(true)
    expect(String(localMatch[0]._sync_state || '')).toBe('sync_failed')
    expect(String(localMatch[0].invoice_number || '')).toBe('')

    const failedCard = offlinePage.getByTestId('system-health-failed-item').filter({
      hasText: String(relatedFailed._queue_id || '')
    })
    await expect(failedCard).toBeVisible({ timeout: 30000 })
    await expect(failedCard).toContainText(/already booked|overlapping|conflict/i)
    await offlinePage.getByRole('link', { name: 'Bookings' }).click()
    await expect(offlinePage.getByTestId(`booking-row-${created.booking.id}`)).toBeVisible({ timeout: 30000 })
    await expect(offlinePage.getByTestId(`booking-sync-failed-${created.booking.id}`)).toBeVisible()
  } finally {
    if (conflictingBookingId) {
      await serverPage.evaluate(async (bookingId) => {
        try {
          await window.api.bookings.updateStatus(bookingId, 'cancelled')
        } catch {
          // Best-effort cleanup only.
        }
      }, conflictingBookingId).catch(() => {})
    }
    await serverApp.close().catch(() => {})
    await offlineApp.close().catch(() => {})
  }
})
