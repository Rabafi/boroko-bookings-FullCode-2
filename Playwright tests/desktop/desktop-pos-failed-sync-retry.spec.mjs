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
  ensureSignedInDesktop,
  createPosOrderFromSeed,
  waitForPosOrder,
  openPosHistoryPage,
  restoreBackendSession,
  switchDesktopToOnline
} from './support/desktop-flows.mjs'

test.setTimeout(240000)

test('desktop surfaces POS sync failure clearly and can recover it with retry after backend access is restored', async () => {
  const userDataDir = createTempUserDataDir('boroko-e2e-pos-fail-')
  const seed = createDesktopSeedFromInstalledProfile()
  seedDesktopUserData(userDataDir, seed)

  const onlineEnv = getRealBackendEnv()
  expect(onlineEnv.SUPABASE_URL).toBeTruthy()
  expect(onlineEnv.SUPABASE_ANON_KEY).toBeTruthy()

  const offlineRun = await launchDesktopApp({
    userDataDir,
    extraEnv: { BOROKO_TEST_FORCE_OFFLINE: 'true', ...onlineEnv }
  })

  let created = null
  try {
    await signInDesktop(offlineRun.window, seed)
    created = await createPosOrderFromSeed(offlineRun.window, seed, {
      walkInName: `POS Failure Guest ${Date.now()}`,
      quantity: 1,
      notes: 'Playwright POS failure visibility'
    })
    await waitForPosOrder(offlineRun.window, created.orderId, {
      timeout: 30000,
      predicate: (order) => order._pending_sync === true
    })
  } finally {
    await offlineRun.app.close().catch(() => {})
  }

  const brokenRun = await launchDesktopApp({
    userDataDir,
    extraEnv: {
      BOROKO_TEST_FORCE_OFFLINE: 'true',
      SUPABASE_URL: 'http://127.0.0.1:9',
      SUPABASE_ANON_KEY: 'broken-test-key'
    }
  })

  try {
    await ensureSignedInDesktop(brokenRun.window, seed)
    await switchDesktopToOnline(brokenRun.window)
    await brokenRun.window.evaluate(async () => window.api.sync.runNow())

    let failedItem = null
    await expect.poll(async () => {
      const syncDetails = await brokenRun.window.evaluate(async () => window.api.sync.getDetails())
      failedItem = (syncDetails?.failed || []).find((item) => item?.data?.payload?.id === created.orderId) || null
      return Boolean(failedItem)
    }, { timeout: 120000 }).toBe(true)

    await brokenRun.window.evaluate(async () => window.api.app.setTestOfflineMode(true))

    const failedOrder = await waitForPosOrder(brokenRun.window, created.orderId, {
      timeout: 30000,
      predicate: (order) => String(order?._sync_state || '') === 'failed'
    })

    expect(failedOrder).toBeTruthy()
    expect(failedOrder._pending_sync).toBe(true)
    expect(String(failedOrder._sync_error || '')).not.toBe('')
    expect(failedItem).toBeTruthy()

    await openPosHistoryPage(brokenRun.window)
    await expect(brokenRun.window.getByText(created.walkInName)).toBeVisible({ timeout: 30000 })
    await brokenRun.window.getByText(created.walkInName).click()
    await expect(brokenRun.window.getByText('Failed Sync').first()).toBeVisible()
    await expect(brokenRun.window.getByText('Retry from System Health')).toBeVisible()
  } finally {
    await brokenRun.app.close().catch(() => {})
  }

  const recoveredRun = await launchDesktopApp({
    userDataDir,
    extraEnv: { BOROKO_TEST_FORCE_OFFLINE: 'true', ...onlineEnv }
  })

  try {
    await ensureSignedInDesktop(recoveredRun.window, seed)
    restoreSeededSessionNonce(userDataDir, seed)
    await restoreBackendSession(recoveredRun.window, seed)
    await switchDesktopToOnline(recoveredRun.window)

    await recoveredRun.window.getByRole('link', { name: 'Settings' }).click()
    await recoveredRun.window.getByTestId('settings-tab-system').click()
    await expect(recoveredRun.window.getByRole('button', { name: /Retry Failed Items|Retry All Failed/i })).toBeVisible({ timeout: 30000 })
    await recoveredRun.window.getByRole('button', { name: /Retry Failed Items|Retry All Failed/i }).click()
    await recoveredRun.window.getByRole('button', { name: /Run Sync Now/i }).click()

    const recoveredOrder = await waitForPosOrder(recoveredRun.window, created.orderId, {
      timeout: 120000,
      predicate: (order) => order._pending_sync !== true && String(order?._sync_state || '') !== 'failed'
    })
    const finalDetails = await recoveredRun.window.evaluate(async () => window.api.sync.getDetails())
    const stillFailed = (finalDetails?.failed || []).find((item) => item?.data?.payload?.id === created.orderId)

    expect(recoveredOrder).toBeTruthy()
    expect(recoveredOrder._pending_sync).not.toBe(true)
    expect(String(recoveredOrder._sync_state || '')).not.toBe('failed')
    expect(stillFailed).toBeFalsy()
  } finally {
    await recoveredRun.app.close().catch(() => {})
  }
})
