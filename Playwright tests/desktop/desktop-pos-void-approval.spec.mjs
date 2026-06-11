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

test.setTimeout(240000)

test('desktop can void a POS order through the manager approval PIN flow and keeps a visible approval trail', async () => {
  const userDataDir = createTempUserDataDir('boroko-e2e-pos-void-approval-')
  const seed = createDesktopSeedFromInstalledProfile()
  seedDesktopUserData(userDataDir, seed)

  const onlineEnv = getRealBackendEnv()
  expect(onlineEnv.SUPABASE_URL).toBeTruthy()
  expect(onlineEnv.SUPABASE_ANON_KEY).toBeTruthy()

  const { app, window: page } = await launchDesktopApp({
    userDataDir,
    extraEnv: { BOROKO_TEST_FORCE_OFFLINE: 'true', ...onlineEnv }
  })

  let approverUserId = null

  try {
    await signInDesktop(page, seed)
    restoreSeededSessionNonce(userDataDir, seed)
    await restoreBackendSession(page, seed)
    await switchDesktopToOnline(page)

    const created = await createPosOrderFromSeed(page, seed, {
      walkInName: `POS Void Guest ${Date.now()}`,
      quantity: 1,
      notes: 'Playwright POS void approval'
    })

    await waitForPosOrder(page, created.orderId, {
      timeout: 60000,
      predicate: (order) => order._pending_sync !== true && String(order?.status || '') === 'completed'
    })

    const approverEmail = `pw-pos-approver-${Date.now()}@example.com`
    const approverCreateResult = await page.evaluate(async ({ email, outletId }) => {
      return window.api.users.create({
        name: 'Playwright POS Supervisor',
        email,
        password: 'Password123!',
        role: 'supervisor',
        allowed_outlet_ids: outletId ? [outletId] : []
      })
    }, {
      email: approverEmail,
      outletId: created.outlet?.id || null
    })

    expect(approverCreateResult?.success).toBe(true)
    approverUserId = approverCreateResult?.id || null
    expect(approverUserId).toBeTruthy()

    await expect.poll(async () => {
      const users = await page.evaluate(async () => window.api.users.getAll())
      return (users || []).some((user) => String(user?.id || '') === String(approverUserId))
    }, { timeout: 30000 }).toBe(true)

    const approverPinUpdate = await page.evaluate(async ({ id, outletId }) => {
      return window.api.users.update(id, {
        pin: '4242',
        allowed_outlet_ids: outletId ? [outletId] : []
      })
    }, {
      id: approverUserId,
      outletId: created.outlet?.id || null
    })

    expect(approverPinUpdate?.success).toBe(true)

    const badPin = await page.evaluate(async ({ orderId, cashierUserId, outletId }) => {
      return window.api.pos.approveVoidWithPin({
        order_id: orderId,
        pin: '9999',
        reason: 'Invalid test attempt',
        cashier_user_id: cashierUserId,
        outlet_id: outletId
      })
    }, {
      orderId: created.orderId,
      cashierUserId: seed.user.id,
      outletId: created.outlet?.id || null
    })

    expect(badPin?.success).toBe(false)
    expect(String(badPin?.error || '')).toMatch(/invalid pin|unauthorized approver/i)

    const approved = await page.evaluate(async ({ orderId, cashierUserId, outletId }) => {
      return window.api.pos.approveVoidWithPin({
        order_id: orderId,
        pin: '4242',
        reason: 'Playwright approval flow',
        cashier_user_id: cashierUserId,
        outlet_id: outletId
      })
    }, {
      orderId: created.orderId,
      cashierUserId: seed.user.id,
      outletId: created.outlet?.id || null
    })

    expect(approved, JSON.stringify(approved)).toMatchObject({ success: true })

    const voidedOrder = await waitForPosOrder(page, created.orderId, {
      timeout: 60000,
      predicate: (order) => String(order?.status || '') === 'voided'
    })

    expect(voidedOrder).toBeTruthy()
    expect(String(voidedOrder.status || '')).toBe('voided')

    const voidHistory = await page.evaluate(async () => {
      return window.api.pos.getVoidHistory('2000-01-01', '2099-12-31')
    })
    const matchingVoid = (voidHistory || []).find((entry) => String(entry?.order_id || '') === String(created.orderId))

    expect(matchingVoid).toBeTruthy()
    expect(String(matchingVoid?.reason || '')).toContain('Playwright approval flow')

    await openPosHistoryPage(page)
    await expect(page.getByText(created.walkInName)).toBeVisible({ timeout: 30000 })
    await page.getByText(created.walkInName).click()
    await expect(page.getByText('Void record')).toBeVisible()
    await expect(page.getByText('Playwright approval flow')).toBeVisible()
  } finally {
    if (approverUserId) {
      await page.evaluate(async (id) => window.api.users.delete(id), approverUserId).catch(() => {})
    }
    await app.close().catch(() => {})
  }
})
