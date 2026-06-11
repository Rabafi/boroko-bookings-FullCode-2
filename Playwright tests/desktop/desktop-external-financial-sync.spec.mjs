/**
 * Test: External online financial changes flow back into desktop
 *
 * Scenario:
 *   - Observer desktop is online but idle (no local payment pending).
 *   - A second desktop instance (acting as "server actor") records a payment
 *     against the same booking via the normal IPC → Supabase RPC path.
 *   - Observer desktop then refreshes its data.
 *   - Verify observer reflects the externally-recorded payment exactly,
 *     treats it as server-backed truth (not as a local pending item), and
 *     shows the correct amount_paid / balance.
 *
 * This proves desktop can absorb external financial truth without mistaking
 * it for a local pending sync item.
 */
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
  readBookings,
  readPayments,
  createOnlineBookingViaApi
} from './support/desktop-flows.mjs'

test.setTimeout(240000)

test('observer desktop reflects a payment recorded externally by a second actor', async () => {
  const observerDataDir = createTempUserDataDir()
  const actorDataDir = createTempUserDataDir()
  const seed = createDesktopSeedFromInstalledProfile()
  seedDesktopUserData(observerDataDir, seed)
  seedDesktopUserData(actorDataDir, seed)

  const onlineEnv = getRealBackendEnv()
  expect(onlineEnv.SUPABASE_URL).toBeTruthy()
  expect(onlineEnv.SUPABASE_ANON_KEY).toBeTruthy()
  const stay = await findLiveAvailableStay(seed, { minOffsetDays: 62, maxOffsetDays: 210 })

  // ── Launch both instances ────────────────────────────────────────────────────

  const observerRun = await launchDesktopApp({
    userDataDir: observerDataDir,
    extraEnv: { BOROKO_TEST_FORCE_OFFLINE: 'false', ...onlineEnv }
  })
  const actorRun = await launchDesktopApp({
    userDataDir: actorDataDir,
    extraEnv: { BOROKO_TEST_FORCE_OFFLINE: 'false', ...onlineEnv }
  })

  const { app: observerApp, window: observerPage } = observerRun
  const { app: actorApp, window: actorPage } = actorRun

  try {
    // Sign in both instances.
    await Promise.all([
      signInDesktop(observerPage, seed),
      signInDesktop(actorPage, seed)
    ])
    restoreSeededSessionNonce(observerDataDir, seed)
    restoreSeededSessionNonce(actorDataDir, seed)
    await Promise.all([
      restoreBackendSession(observerPage, seed),
      restoreBackendSession(actorPage, seed)
    ])
    await Promise.all([
      switchDesktopToOnline(observerPage),
      switchDesktopToOnline(actorPage)
    ])

    // ── Actor creates a booking (online, direct to Supabase) ─────────────────

    const room = seed.rooms.find((r) => String(r.id) === String(stay.roomId))
    const nights = Math.max(
      1,
      Math.ceil((new Date(stay.checkOut) - new Date(stay.checkIn)) / 86400000)
    )
    const totalAmount = Number(room?.rate_per_night || 0) * nights
    const customerName = `External Pay Observer ${Date.now()}`

    const { bookingId, totalAmount: confirmedTotal } = await createOnlineBookingViaApi(
      actorPage,
      seed,
      {
        customerName,
        roomId: stay.roomId,
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        waitForRead: true
      }
    )

    // Confirm observer can also see the booking (both are online).
    await expect
      .poll(
        async () => {
          const bookings = await readBookings(observerPage)
          return bookings.some((row) => row?.id === bookingId)
        },
        { timeout: 60000 }
      )
      .toBe(true)

    const paymentAmount = Math.max(1, Math.floor(confirmedTotal / 2))
    const idempotencyKey = `test:ext-pay:${bookingId}:${Date.now()}`

    // ── Actor records a payment via RPC ──────────────────────────────────────

    const payResult = await actorPage.evaluate(
      async ({ bookingId, paymentAmount, idempotencyKey }) => {
        return window.api.bookings.updatePayment(bookingId, paymentAmount, 'cash', idempotencyKey)
      },
      { bookingId, paymentAmount, idempotencyKey }
    )
    if (!payResult?.success) {
      throw new Error(`Actor payment failed: ${JSON.stringify(payResult)}`)
    }

    // ── Observer refreshes and must see the externally-recorded payment ──────

    // Trigger a data refresh on the observer (re-fetch bookings from server).
    await observerPage.evaluate(async () => {
      if (window.api?.sync?.runNow) await window.api.sync.runNow()
    })

    await expect
      .poll(
        async () => {
          const bookings = await readBookings(observerPage)
          const current = bookings.find((row) => row?.id === bookingId)
          if (!current) return 'missing'
          if (Number(current.amount_paid || 0) >= paymentAmount) return 'paid'
          return `unpaid:${current.amount_paid}`
        },
        { timeout: 60000 }
      )
      .toBe('paid')

    const bookings = await readBookings(observerPage)
    const observedBooking = bookings.find((row) => row?.id === bookingId)
    expect(observedBooking).toBeTruthy()

    // amount_paid must equal what actor paid.
    expect(Number(observedBooking.amount_paid)).toBe(paymentAmount)

    // payment_status must be 'partial' (deposit < total).
    expect(observedBooking.payment_status).toBe('partial')

    // Observer must NOT treat this as a local pending sync item.
    expect(observedBooking._pending_sync).not.toBe(true)

    // Payment row must be visible on observer via server read.
    const observerPayments = await readPayments(observerPage, bookingId)
    const matchingPayment = observerPayments.find((p) => Number(p.amount) === paymentAmount)
    expect(matchingPayment).toBeTruthy()
  } finally {
    await Promise.all([
      observerApp.close().catch(() => {}),
      actorApp.close().catch(() => {})
    ])
  }
})
