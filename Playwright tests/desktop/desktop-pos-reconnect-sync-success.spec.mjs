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
  readPosOrders,
  getQueuedPosOrderId
} from './support/desktop-flows.mjs'

test.setTimeout(180000)

test('desktop replays an offline POS order successfully after reconnect without creating duplicates', async () => {
  const userDataDir = createTempUserDataDir('boroko-e2e-pos-reconnect-')
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
      walkInName: `Reconnect POS Guest ${Date.now()}`,
      quantity: 2,
      notes: 'Playwright reconnect POS sync'
    })

    await waitForPosOrder(page, created.orderId, {
      timeout: 30000,
      predicate: (order) => order._pending_sync === true
    })

    restoreSeededSessionNonce(userDataDir, seed)
    await restoreBackendSession(page, seed)
    await switchDesktopToOnline(page)
    await syncFromSystemHealth(page)

    const syncedOrder = await waitForPosOrder(page, created.orderId, {
      timeout: 120000,
      predicate: (order) => order._pending_sync !== true && Number(order.total || 0) === created.expectedTotal
    })
    const orders = await readPosOrders(page)
    const matchingById = orders.filter((order) => String(order?.id) === String(created.orderId))
    const matchingByName = orders.filter((order) => String(order?.walk_in_name || '') === created.walkInName)
    const syncDetails = await page.evaluate(async () => window.api.sync.getDetails())
    const relatedPending = (syncDetails?.pending || []).filter((item) => getQueuedPosOrderId(item) === created.orderId)
    const relatedFailed = (syncDetails?.failed || []).filter((item) => getQueuedPosOrderId(item) === created.orderId)

    expect(syncedOrder).toBeTruthy()
    expect(Number(syncedOrder.total || 0)).toBe(created.expectedTotal)
    expect(syncedOrder._pending_sync).not.toBe(true)
    expect(matchingById).toHaveLength(1)
    expect(matchingByName).toHaveLength(1)
    expect(relatedPending).toHaveLength(0)
    expect(relatedFailed).toHaveLength(0)
  } finally {
    await app.close().catch(() => {})
  }
})
