import { test, expect } from '@playwright/test'
import {
  createTempUserDataDir,
  createDesktopSeed,
  seedDesktopUserData,
  launchDesktopApp
} from './support/desktop-app.mjs'
import {
  ensureSignedInDesktop,
  createOfflineBooking,
  addPaymentToBooking,
  readBookings
} from './support/desktop-flows.mjs'

test('desktop records an offline payment on an offline booking', async () => {
  const userDataDir = createTempUserDataDir()
  const seed = createDesktopSeed()
  seedDesktopUserData(userDataDir, seed)

  const { app, window: page } = await launchDesktopApp({ userDataDir })

  try {
    await ensureSignedInDesktop(page, seed)
    const { booking } = await createOfflineBooking(page, seed, { offsetDays: 11 })
    await addPaymentToBooking(page, booking)

    const bookings = await readBookings(page)
    const updated = bookings.find((row) => row.id === booking.id)

    expect(updated).toBeTruthy()
    expect(updated._pending_sync).toBe(true)
    expect(updated._pending_payment).toBe(true)
    await expect(page.getByTestId(`booking-pending-sync-${booking.id}`)).toBeVisible()
    await expect(page.getByText('Queued (will sync)')).toBeVisible()

    const syncDetails = await page.evaluate(async () => window.api.sync.getDetails())
    expect(syncDetails.pending.some((item) => item?.table === 'update_booking_payment' && item?.data?.p_booking_id === booking.id)).toBe(true)
  } finally {
    await app.close()
  }
})
