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
  readPosOrders,
  getQueuedPosOrderId
} from './support/desktop-flows.mjs'

test.setTimeout(240000)

test('desktop enforces POS sync safety across two Electron processes sharing one profile', async () => {
  const sharedUserDataDir = createTempUserDataDir('boroko-e2e-pos-shared-')
  const seed = createDesktopSeedFromInstalledProfile()
  seedDesktopUserData(sharedUserDataDir, seed)

  const onlineEnv = getRealBackendEnv()
  expect(onlineEnv.SUPABASE_URL).toBeTruthy()
  expect(onlineEnv.SUPABASE_ANON_KEY).toBeTruthy()

  const primary = await launchDesktopApp({
    userDataDir: sharedUserDataDir,
    extraEnv: { BOROKO_TEST_FORCE_OFFLINE: 'true', ...onlineEnv }
  })

  try {
    await signInDesktop(primary.window, seed)
    const created = await createPosOrderFromSeed(primary.window, seed, {
      walkInName: `POS Shared Guest ${Date.now()}`,
      quantity: 2,
      notes: 'Playwright POS cross-process sync'
    })

    await waitForPosOrder(primary.window, created.orderId, {
      timeout: 30000,
      predicate: (order) => order._pending_sync === true
    })

    restoreSeededSessionNonce(sharedUserDataDir, seed)

    const secondary = await launchDesktopApp({
      userDataDir: sharedUserDataDir,
      extraEnv: { BOROKO_TEST_FORCE_OFFLINE: 'true', ...onlineEnv }
    })

    try {
      await signInDesktop(secondary.window, seed)
      restoreSeededSessionNonce(sharedUserDataDir, seed)
      await restoreBackendSession(primary.window, seed)
      await restoreBackendSession(secondary.window, seed)
      await switchDesktopToOnline(primary.window)
      await switchDesktopToOnline(secondary.window)

      const [primaryResult, secondaryResult] = await Promise.all([
        primary.window.evaluate(async () => window.api.sync.runNow()),
        secondary.window.evaluate(async () => window.api.sync.runNow())
      ])

      expect(primaryResult?.success).toBe(true)
      expect(secondaryResult?.success).toBe(true)

      const syncedOrder = await waitForPosOrder(primary.window, created.orderId, {
        timeout: 120000,
        predicate: (order) => order._pending_sync !== true
      })
      const orders = await readPosOrders(primary.window)
      const matchingById = orders.filter((order) => String(order?.id) === String(created.orderId))
      const matchingByName = orders.filter((order) => String(order?.walk_in_name || '') === created.walkInName)
      const syncDetails = await primary.window.evaluate(async () => window.api.sync.getDetails())
      const relatedPending = (syncDetails?.pending || []).filter((item) => getQueuedPosOrderId(item) === created.orderId)
      const relatedFailed = (syncDetails?.failed || []).filter((item) => getQueuedPosOrderId(item) === created.orderId)

      expect(syncedOrder).toBeTruthy()
      expect(matchingById).toHaveLength(1)
      expect(matchingByName).toHaveLength(1)
      expect(relatedPending).toHaveLength(0)
      expect(relatedFailed).toHaveLength(0)
    } finally {
      await secondary.app.close().catch(() => {})
    }
  } finally {
    await primary.app.close().catch(() => {})
  }
})
