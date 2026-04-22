/**
 * Test: Crash during active sync lock
 *
 * Proves that a stale file-lock left by a crashed process does not block
 * the next launch from recovering and completing the sync correctly, and
 * that no duplicate business effects occur.
 */
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
  readBookings,
  readPayments,
  switchDesktopToOnline,
  restoreBackendSession,
  waitForSyncToSettle,
  syncFromSystemHealth
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

test('desktop recovers stale sync lock after crash and completes sync without duplicates', async () => {
  const userDataDir = createTempUserDataDir()
  const seed = createDesktopSeedFromInstalledProfile()
  seedDesktopUserData(userDataDir, seed)

  const onlineEnv = getRealBackendEnv()
  expect(onlineEnv.SUPABASE_URL).toBeTruthy()
  expect(onlineEnv.SUPABASE_ANON_KEY).toBeTruthy()
  const stay = await findLiveAvailableStay(seed, { minOffsetDays: 36, maxOffsetDays: 160 })

  // ── Phase 1: create offline booking + payment, then crash mid-sync ──────────

  const firstRun = await launchDesktopApp({
    userDataDir,
    extraEnv: { BOROKO_TEST_FORCE_OFFLINE: 'true', ...onlineEnv }
  })
  const { app: firstApp, window: firstPage } = firstRun

  let bookingId
  try {
    await signInDesktop(firstPage, seed)

    const created = await createOfflineBooking(firstPage, seed, {
      customerName: `SyncLockCrash Guest ${Date.now()}`,
      roomId: stay.roomId,
      roomNumber: stay.roomNumber,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      requirePendingSync: true,
      waitForVisibleRow: true
    })
    bookingId = created.booking.id

    await addPaymentToBooking(firstPage, created.booking)

    restoreSeededSessionNonce(userDataDir, seed)
    await restoreBackendSession(firstPage, seed)
    await switchDesktopToOnline(firstPage)

    // Start a sync then immediately kill the process — this leaves the sync
    // lock file in place as if the process died mid-flight.
    firstPage.evaluate(async () => window.api.sync.runNow()).catch(() => {})
    // Small pause to let the lock be acquired, then crash.
    await firstPage.waitForTimeout(600)
  } finally {
    await forceCloseElectronApp(firstApp)
  }

  // ── Phase 2: relaunch — stale lock must be cleared, sync must complete ──────

  const secondRun = await launchDesktopApp({
    userDataDir,
    extraEnv: { BOROKO_TEST_FORCE_OFFLINE: 'false', ...onlineEnv }
  })
  const { app: secondApp, window: secondPage } = secondRun

  try {
    await signInDesktop(secondPage, seed)
    restoreSeededSessionNonce(userDataDir, seed)
    await restoreBackendSession(secondPage, seed)

    // Let the app discover it is online and auto-clear any stale lock.
    await secondPage.waitForTimeout(2000)

    await syncFromSystemHealth(secondPage)
    await waitForSyncToSettle(secondPage, { timeout: 120000 })

    // Booking must be synced — no longer pending.
    await expect
      .poll(
        async () => {
          const bookings = await readBookings(secondPage)
          const current = bookings.find((row) => row.id === bookingId)
          if (!current) return 'missing'
          if (current._pending_sync === true) return 'pending'
          if (!String(current.invoice_number || '').trim()) return 'missing-invoice'
          if (Number(current.amount_paid || 0) <= 0) return 'unpaid'
          return 'synced'
        },
        { timeout: 120000 }
      )
      .toBe('synced')

    const bookings = await readBookings(secondPage)
    const synced = bookings.find((row) => row.id === bookingId)
    expect(synced._pending_sync).not.toBe(true)
    expect(String(synced.invoice_number || '')).not.toBe('')
    expect(Number(synced.amount_paid || 0)).toBeGreaterThan(0)

    // No duplicate payment rows — exactly one positive payment.
    const paymentRows = await readPayments(secondPage, bookingId)
    const positivePayments = paymentRows.filter((p) => Number(p.amount || 0) > 0)
    expect(positivePayments).toHaveLength(1)

    // No residual pending or failed queue items for this booking.
    const syncDetails = await secondPage.evaluate(async () => window.api.sync.getDetails())
    const relatedPending = (syncDetails?.pending || []).filter(
      (item) => getQueuedBookingId(item) === bookingId
    )
    const relatedFailed = (syncDetails?.failed || []).filter(
      (item) => getQueuedBookingId(item) === bookingId
    )
    expect(relatedPending).toHaveLength(0)
    expect(relatedFailed).toHaveLength(0)
  } finally {
    await secondApp.close().catch(() => {})
  }
})
