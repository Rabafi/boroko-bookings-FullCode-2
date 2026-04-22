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
  restoreBackendSession,
  switchDesktopToOnline,
  createPosOrderFromSeed,
  waitForPosOrder,
  openPosHistoryPage
} from './support/desktop-flows.mjs'

test.setTimeout(180000)

test('desktop creates a live POS order and shows it in POS history with the correct total', async () => {
  const userDataDir = createTempUserDataDir('boroko-e2e-pos-live-')
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
    restoreSeededSessionNonce(userDataDir, seed)
    await restoreBackendSession(page, seed)
    await switchDesktopToOnline(page)

    const created = await createPosOrderFromSeed(page, seed, {
      walkInName: `Live POS Guest ${Date.now()}`,
      quantity: 2,
      notes: 'Playwright live POS create'
    })

    const syncedOrder = await waitForPosOrder(page, created.orderId, {
      timeout: 60000,
      predicate: (order) => order._pending_sync !== true && Number(order.total || 0) === created.expectedTotal
    })

    expect(syncedOrder).toBeTruthy()
    expect(Number(syncedOrder.total || 0)).toBe(created.expectedTotal)
    expect(String(syncedOrder.walk_in_name || '')).toBe(created.walkInName)
    expect(syncedOrder._pending_sync).not.toBe(true)

    await openPosHistoryPage(page)
    await expect(page.getByText(created.walkInName)).toBeVisible({ timeout: 30000 })
    await page.getByText(created.walkInName).click()
    await expect(page.getByText(created.menuItem.name, { exact: false })).toBeVisible()
    await expect(page.getByRole('cell', { name: String(created.items[0].quantity), exact: true })).toBeVisible()
    await expect(page.getByText(seed.settings.currency, { exact: false }).first()).toBeVisible()
  } finally {
    await app.close().catch(() => {})
  }
})
