import { test, expect } from '@playwright/test'
import {
  createTempUserDataDir,
  createDesktopSeedFromInstalledProfile,
  seedDesktopUserData,
  launchDesktopApp,
  forceCloseElectronApp,
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
  getQueuedPosOrderId
} from './support/desktop-flows.mjs'

test.setTimeout(180000)

test('desktop preserves an offline POS order across a crash and syncs it after restart', async () => {
  const userDataDir = createTempUserDataDir('boroko-e2e-pos-crash-')
  const seed = createDesktopSeedFromInstalledProfile()
  seedDesktopUserData(userDataDir, seed)

  const onlineEnv = getRealBackendEnv()
  expect(onlineEnv.SUPABASE_URL).toBeTruthy()
  expect(onlineEnv.SUPABASE_ANON_KEY).toBeTruthy()

  const firstRun = await launchDesktopApp({
    userDataDir,
    extraEnv: { BOROKO_TEST_FORCE_OFFLINE: 'true', ...onlineEnv }
  })

  try {
    await signInDesktop(firstRun.window, seed)

    const created = await createPosOrderFromSeed(firstRun.window, seed, {
      walkInName: `Crash POS Guest ${Date.now()}`,
      quantity: 2,
      notes: 'Playwright POS crash recovery'
    })

    await waitForPosOrder(firstRun.window, created.orderId, {
      timeout: 30000,
      predicate: (order) => order._pending_sync === true
    })

    await forceCloseElectronApp(firstRun.app)

    const restarted = await launchDesktopApp({
      userDataDir,
      extraEnv: { BOROKO_TEST_FORCE_OFFLINE: 'true', ...onlineEnv }
    })

    try {
      await signInDesktop(restarted.window, seed)

      const restoredOrder = await waitForPosOrder(restarted.window, created.orderId, {
        timeout: 30000,
        predicate: (order) => order._pending_sync === true
      })
      const syncDetails = await restarted.window.evaluate(async () => window.api.sync.getDetails())
      const relatedPending = (syncDetails?.pending || []).filter((item) => getQueuedPosOrderId(item) === created.orderId)

      expect(restoredOrder).toBeTruthy()
      expect(Number(restoredOrder.total || 0)).toBe(created.expectedTotal)
      expect(restoredOrder._pending_sync).toBe(true)
      expect(relatedPending.length).toBeGreaterThan(0)

      restoreSeededSessionNonce(userDataDir, seed)
      await restoreBackendSession(restarted.window, seed)
      await switchDesktopToOnline(restarted.window)
      await syncFromSystemHealth(restarted.window)

      const syncedOrder = await waitForPosOrder(restarted.window, created.orderId, {
        timeout: 120000,
        predicate: (order) => order._pending_sync !== true
      })

      expect(syncedOrder).toBeTruthy()
      expect(syncedOrder._pending_sync).not.toBe(true)
      expect(Number(syncedOrder.total || 0)).toBe(created.expectedTotal)
    } finally {
      await restarted.app.close().catch(() => {})
    }
  } catch (error) {
    await firstRun.app.close().catch(() => {})
    throw error
  }
})
