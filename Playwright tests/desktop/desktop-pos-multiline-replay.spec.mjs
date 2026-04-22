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
  createPosOrderViaApi,
  waitForPosOrder,
  syncFromSystemHealth,
  openPosHistoryPage
} from './support/desktop-flows.mjs'

async function pickMultiLineOrder(page) {
  return page.evaluate(async () => {
    const [menuItems, inventoryItems] = await Promise.all([
      window.api.pos.getMenuItems(),
      window.api.inventory.getItems()
    ])
    const inventoryById = new Map((inventoryItems || []).map((item) => [item.id, item]))
    const grouped = new Map()
    for (const item of menuItems || []) {
      if (!item?.id || item.is_available === false || !item.outlet_id) continue
      if (item.inventory_item_id) {
        const inventoryRow = inventoryById.get(item.inventory_item_id)
        const depletion = Math.max(1, Number(item.depletion_qty || 1))
        if (Number(inventoryRow?.current_stock || 0) < depletion) continue
      }
      const key = String(item.outlet_id)
      const bucket = grouped.get(key) || []
      bucket.push(item)
      grouped.set(key, bucket)
    }
    const outletGroup = [...grouped.values()].find((items) => items.length >= 2)
    if (!outletGroup) return null
    const first = outletGroup[0]
    const second = outletGroup[1]
    const lines = [
      {
        menu_item_id: first.id,
        item_name: first.name,
        quantity: 2,
        unit_price: Number(first.price || first.unit_price || 0)
      },
      {
        menu_item_id: second.id,
        item_name: second.name,
        quantity: 1,
        unit_price: Number(second.price || second.unit_price || 0)
      }
    ]
    return {
      outletId: first.outlet_id,
      items: lines,
      expectedTotal: Number(lines.reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.unit_price || 0)), 0).toFixed(2))
    }
  })
}

test.setTimeout(240000)

test('desktop preserves multi-line POS totals and line items across offline replay', async () => {
  const userDataDir = createTempUserDataDir('boroko-e2e-pos-multiline-')
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

    const selection = await pickMultiLineOrder(page)
    expect(selection).toBeTruthy()

    const walkInName = `POS Multi Guest ${Date.now()}`
    const created = await createPosOrderViaApi(page, {
      walkInName,
      outletId: selection.outletId,
      paymentMethod: 'cash',
      notes: 'Playwright POS multi-line replay',
      items: selection.items
    })

    expect(created?.success).toBe(true)

    const offlineOrder = await waitForPosOrder(page, created.id, {
      timeout: 30000,
      predicate: (order) => (
        order._pending_sync === true
        && Array.isArray(order?.pos_order_items)
        && order.pos_order_items.length === selection.items.length
      )
    })

    expect(Number(offlineOrder.total || 0)).toBe(selection.expectedTotal)
    expect(offlineOrder.pos_order_items).toHaveLength(selection.items.length)
    expect(Number(offlineOrder.pos_order_items[0]?.subtotal || 0)).toBe(Number((selection.items[0].quantity * selection.items[0].unit_price).toFixed(2)))
    expect(Number(offlineOrder.pos_order_items[1]?.subtotal || 0)).toBe(Number((selection.items[1].quantity * selection.items[1].unit_price).toFixed(2)))

    restoreSeededSessionNonce(userDataDir, seed)
    await restoreBackendSession(page, seed)
    await switchDesktopToOnline(page)
    await syncFromSystemHealth(page)

    const syncedOrder = await waitForPosOrder(page, created.id, {
      timeout: 120000,
      predicate: (order) => (
        order._pending_sync !== true
        && Array.isArray(order?.pos_order_items)
        && order.pos_order_items.length === selection.items.length
        && Number(order?.total || 0) === selection.expectedTotal
      )
    })

    expect(Number(syncedOrder.total || 0)).toBe(selection.expectedTotal)
    expect(syncedOrder.pos_order_items).toHaveLength(selection.items.length)
    expect(String(syncedOrder.walk_in_name || '')).toBe(walkInName)

    await openPosHistoryPage(page)
    await expect(page.getByText(walkInName)).toBeVisible({ timeout: 30000 })
    await page.getByText(walkInName).click()
    await expect(page.getByRole('cell', { name: selection.items[0].item_name, exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: selection.items[1].item_name, exact: true })).toBeVisible()
  } finally {
    await app.close().catch(() => {})
  }
})
