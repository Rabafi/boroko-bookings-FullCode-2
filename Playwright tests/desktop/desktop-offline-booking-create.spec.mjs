import { test, expect } from '@playwright/test'
import {
  createTempUserDataDir,
  createDesktopSeed,
  seedDesktopUserData,
  launchDesktopApp
} from './support/desktop-app.mjs'
import {
  restoreSeededDesktopSession,
  createOfflineBooking,
  readBookings
} from './support/desktop-flows.mjs'

test('desktop creates an offline booking and marks it pending sync', async () => {
  const userDataDir = createTempUserDataDir()
  const seed = createDesktopSeed()
  seedDesktopUserData(userDataDir, seed)

  const { app, window: page } = await launchDesktopApp({ userDataDir })

  try {
    await restoreSeededDesktopSession(page, seed)
    const { booking } = await createOfflineBooking(page, seed, { offsetDays: 10 })
    const bookings = await readBookings(page)
    const created = bookings.find((row) => row.id === booking.id)

    expect(created).toBeTruthy()
    expect(created._pending_sync).toBe(true)
    await expect(page.getByTestId(`booking-pending-sync-${booking.id}`)).toBeVisible()
  } finally {
    await app.close()
  }
})
