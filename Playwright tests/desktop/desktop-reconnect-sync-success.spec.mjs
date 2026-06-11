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
  switchDesktopToOnline
} from './support/desktop-flows.mjs'

test.setTimeout(180000)

test('desktop reconnects online and syncs offline booking and payment without duplicates', async () => {
  const userDataDir = createTempUserDataDir()
  const seed = createDesktopSeedFromInstalledProfile()
  seedDesktopUserData(userDataDir, seed)

  const onlineEnv = getRealBackendEnv()
  expect(onlineEnv.SUPABASE_URL).toBeTruthy()
  expect(onlineEnv.SUPABASE_ANON_KEY).toBeTruthy()
  const stay = await findLiveAvailableStay(seed, { minOffsetDays: 30, maxOffsetDays: 120 })

  const { app, window: page } = await launchDesktopApp({
    userDataDir,
    extraEnv: {
      BOROKO_TEST_FORCE_OFFLINE: 'true'
    }
  })

  try {
    await signInDesktop(page, seed)
    await expect(page.getByTestId('sidebar-sync-panel')).toBeVisible({ timeout: 30000 })

    const created = await createOfflineBooking(page, seed, {
      customerName: `Reconnect Guest ${Date.now()}`,
      roomId: stay.roomId,
      roomNumber: stay.roomNumber,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      requirePendingSync: true,
      waitForVisibleRow: true
    })

    await addPaymentToBooking(page, created.booking)

    const localBookings = await readBookings(page)
    const localMatch = localBookings.filter((row) => row.id === created.booking.id)
    expect(localMatch).toHaveLength(1)
    expect(localMatch[0]._pending_sync).toBe(true)
    expect(localMatch[0]._pending_payment).toBe(true)
    expect(Number(localMatch[0].amount_paid || 0)).toBeGreaterThanOrEqual(0)

    const localPaymentsBeforeSync = await readPayments(page, created.booking.id)
    expect(localPaymentsBeforeSync).toEqual([])

    restoreSeededSessionNonce(userDataDir, seed)

    const restored = await page.evaluate(async ({ user, scope }) => {
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

    await switchDesktopToOnline(page)
    await page.getByRole('link', { name: 'Settings' }).click()
    await page.getByTestId('settings-tab-system').click()
    await page.getByRole('button', { name: /Run Sync Now/i }).click()

    await expect.poll(async () => {
      const status = await page.evaluate(async () => window.api.sync.getStatus())
      return status?.syncInProgress === true ? 'busy' : 'idle'
    }, { timeout: 120000 }).toBe('idle')

    await page.getByRole('link', { name: 'Bookings' }).click()
    await expect(page.getByRole('heading', { name: 'Bookings' })).toBeVisible({ timeout: 30000 })

    await expect.poll(async () => {
      const bookings = await readBookings(page)
      const rows = bookings.filter((row) => row.id === created.booking.id)
      if (rows.length !== 1) return 'duplicate-or-missing'
      const current = rows[0]
      return current?._pending_sync === true
        ? 'pending'
        : (String(current?.invoice_number || '').trim() ? 'synced' : 'missing-invoice')
    }, { timeout: 120000 }).toBe('synced')

    await expect.poll(async () => {
      const bookings = await readBookings(page)
      const current = bookings.find((row) => row.id === created.booking.id)
      return Number(current?.amount_paid || 0)
    }, { timeout: 120000 }).toBeGreaterThan(0)

    const bookings = await readBookings(page)
    const matching = bookings.filter((row) => row.id === created.booking.id)
    const paymentRows = await readPayments(page, created.booking.id)

    expect(matching).toHaveLength(1)
    expect(matching[0]._pending_sync).not.toBe(true)
    expect(String(matching[0].invoice_number || '')).not.toBe('')
    expect(String(matching[0].invoice_number || '').toUpperCase()).not.toContain('PENDING')
    expect(Number(matching[0].amount_paid || 0)).toBeGreaterThan(0)
    expect(paymentRows.length).toBeGreaterThan(0)
    expect(paymentRows.some((payment) => Number(payment.amount || 0) > 0)).toBe(true)
    expect(bookings.filter((row) => row.id === created.booking.id)).toHaveLength(1)
  } finally {
    await app.close().catch(() => {})
  }
})
