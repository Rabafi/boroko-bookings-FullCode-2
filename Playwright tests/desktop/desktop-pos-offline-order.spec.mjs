import { test, expect } from '@playwright/test'
import {
  createTempUserDataDir,
  createDesktopSeedFromInstalledProfile,
  seedDesktopUserData,
  launchDesktopApp
} from './support/desktop-app.mjs'
import {
  restoreSeededDesktopSession,
  createPosOrderFromSeed,
  waitForPosOrder,
  openPosHistoryPage,
  getQueuedPosOrderId
} from './support/desktop-flows.mjs'

test.setTimeout(120000)

test('desktop stores an offline POS order locally and marks it as pending sync', async () => {
  const userDataDir = createTempUserDataDir('boroko-e2e-pos-offline-')
  const seed = createDesktopSeedFromInstalledProfile()
  seedDesktopUserData(userDataDir, seed)

  const { app, window: page } = await launchDesktopApp({ userDataDir })

  try {
    await restoreSeededDesktopSession(page, seed)

    const created = await createPosOrderFromSeed(page, seed, {
      walkInName: `Offline POS Guest ${Date.now()}`,
      quantity: 2,
      notes: 'Playwright offline POS create'
    })

    const offlineOrder = await waitForPosOrder(page, created.orderId, {
      timeout: 30000,
      predicate: (order) => order._pending_sync === true && String(order._sync_state || '') === 'pending'
    })
    const syncDetails = await page.evaluate(async () => window.api.sync.getDetails())
    const pendingItems = (syncDetails?.pending || []).filter((item) => getQueuedPosOrderId(item) === created.orderId)

    expect(offlineOrder).toBeTruthy()
    expect(Number(offlineOrder.total || 0)).toBe(created.expectedTotal)
    expect(offlineOrder._pending_sync).toBe(true)
    expect(String(offlineOrder._sync_state || '')).toBe('pending')
    expect(pendingItems.length).toBeGreaterThan(0)

    await openPosHistoryPage(page)
    await expect(page.getByText(created.walkInName)).toBeVisible({ timeout: 30000 })
    await expect(page.getByText('Pending Sync')).toBeVisible()
    await expect(page.getByText('Failed Sync')).toHaveCount(0)
  } finally {
    await app.close().catch(() => {})
  }
})
