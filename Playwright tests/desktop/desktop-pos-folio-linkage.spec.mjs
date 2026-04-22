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
  createOnlineBookingViaApi,
  createPosOrderFromSeed,
  waitForPosOrder,
  readBookingCharges
} from './support/desktop-flows.mjs'

test.setTimeout(240000)

test('desktop links a folio POS order to the booking and resulting booking charge', async () => {
  const userDataDir = createTempUserDataDir('boroko-e2e-pos-folio-')
  const seed = createDesktopSeedFromInstalledProfile()
  seedDesktopUserData(userDataDir, seed)

  const onlineEnv = getRealBackendEnv()
  expect(onlineEnv.SUPABASE_URL).toBeTruthy()
  expect(onlineEnv.SUPABASE_ANON_KEY).toBeTruthy()
  const stay = await findLiveAvailableStay(seed, { minOffsetDays: 90, maxOffsetDays: 210 })

  const { app, window: page } = await launchDesktopApp({
    userDataDir,
    extraEnv: { BOROKO_TEST_FORCE_OFFLINE: 'true', ...onlineEnv }
  })

  try {
    await signInDesktop(page, seed)
    restoreSeededSessionNonce(userDataDir, seed)
    await restoreBackendSession(page, seed)
    await switchDesktopToOnline(page)

    const booking = await createOnlineBookingViaApi(page, seed, {
      customerName: `POS Folio Guest ${Date.now()}`,
      roomId: stay.roomId,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      waitForRead: true
    })

    const created = await createPosOrderFromSeed(page, seed, {
      walkInName: null,
      roomId: stay.roomId,
      bookingId: booking.bookingId,
      paymentMethod: 'folio',
      quantity: 2,
      notes: 'Playwright POS folio linkage'
    })

    const folioOrder = await waitForPosOrder(page, created.orderId, {
      timeout: 60000,
      predicate: (order) => (
        String(order?.booking_id || '') === String(booking.bookingId)
        && String(order?.payment_method || '') === 'folio'
      )
    })
    const charges = await readBookingCharges(page, booking.bookingId)
    const matchingCharge = (charges || []).find((charge) => (
      String(charge?.id || '') === String(folioOrder?.folio_charge_id || '')
    ))

    expect(folioOrder).toBeTruthy()
    expect(String(folioOrder.booking_id || '')).toBe(String(booking.bookingId))
    expect(String(folioOrder.payment_method || '')).toBe('folio')
    expect(String(folioOrder.folio_charge_id || '')).not.toBe('')
    expect(matchingCharge).toBeTruthy()
    expect(Number(matchingCharge.amount || 0)).toBe(created.expectedTotal)
  } finally {
    await app.close().catch(() => {})
  }
})
