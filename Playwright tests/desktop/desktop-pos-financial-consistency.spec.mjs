import { test, expect } from '@playwright/test'
import {
  createTempUserDataDir,
  createDesktopSeedFromInstalledProfile,
  seedDesktopUserData,
  launchDesktopApp,
  getRealBackendEnv,
  restoreSeededSessionNonce
} from './support/desktop-app.mjs'
import {
  signInDesktop,
  createPosOrderFromSeed,
  waitForPosOrder,
  restoreBackendSession,
  switchDesktopToOnline,
  syncFromSystemHealth,
  openPosHistoryPage
} from './support/desktop-flows.mjs'

test.setTimeout(180000)

test('desktop keeps POS subtotal and total values consistent before and after sync', async () => {
  const userDataDir = createTempUserDataDir('boroko-e2e-pos-finance-')
  const seed = createDesktopSeedFromInstalledProfile()
  seedDesktopUserData(userDataDir, seed)

  const onlineEnv = getRealBackendEnv()
  expect(onlineEnv.SUPABASE_URL).toBeTruthy()
  expect(onlineEnv.SUPABASE_ANON_KEY).toBeTruthy()

  const { app, window: page } = await launchDesktopApp({
    userDataDir,
    extraEnv: { BOROKO_TEST_FORCE_OFFLINE: 'true', ...onlineEnv }
  })

  try {
    await signInDesktop(page, seed)

    const created = await createPosOrderFromSeed(page, seed, {
      walkInName: `POS Finance Guest ${Date.now()}`,
      quantity: 3,
      notes: 'Playwright POS totals check'
    })
    const expectedSubtotal = Number((created.items[0].quantity * created.items[0].unit_price).toFixed(2))

    const offlineOrder = await waitForPosOrder(page, created.orderId, {
      timeout: 30000,
      predicate: (order) => order._pending_sync === true
    })

    expect(Number(offlineOrder.total || 0)).toBe(created.expectedTotal)
    expect(Number(offlineOrder.pos_order_items?.[0]?.subtotal || 0)).toBe(expectedSubtotal)
    expect(Number(offlineOrder.pos_order_items?.[0]?.unit_price || 0)).toBe(Number(created.items[0].unit_price))
    expect(Number(offlineOrder.pos_order_items?.[0]?.quantity || 0)).toBe(created.items[0].quantity)

    restoreSeededSessionNonce(userDataDir, seed)
    await restoreBackendSession(page, seed)
    await switchDesktopToOnline(page)
    await syncFromSystemHealth(page)

    const syncedOrder = await waitForPosOrder(page, created.orderId, {
      timeout: 120000,
      predicate: (order) => order._pending_sync !== true
    })

    expect(Number(syncedOrder.total || 0)).toBe(created.expectedTotal)
    expect(Number(syncedOrder.pos_order_items?.[0]?.subtotal || 0)).toBe(expectedSubtotal)
    expect(Number(syncedOrder.pos_order_items?.[0]?.unit_price || 0)).toBe(Number(created.items[0].unit_price))
    expect(Number(syncedOrder.pos_order_items?.[0]?.quantity || 0)).toBe(created.items[0].quantity)

    await openPosHistoryPage(page)
    await expect(page.getByText(created.walkInName)).toBeVisible({ timeout: 30000 })
    await page.getByText(created.walkInName).click()
    await expect(page.getByText(created.menuItem.name, { exact: false })).toBeVisible()
    await expect(page.getByRole('cell', { name: String(created.items[0].quantity), exact: true })).toBeVisible()
  } finally {
    await app.close().catch(() => {})
  }
})
