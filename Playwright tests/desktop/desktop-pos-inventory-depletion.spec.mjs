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
  waitForPosOrder
} from './support/desktop-flows.mjs'

async function pickInventoryBackedMenuItem(page) {
  return page.evaluate(async () => {
    const [menuItems, inventoryItems] = await Promise.all([
      window.api.pos.getMenuItems(),
      window.api.inventory.getItems()
    ])
    const inventoryById = new Map((inventoryItems || []).map((item) => [item.id, item]))
    const candidate = (menuItems || []).find((item) => {
      if (!item?.id || item.is_available === false || !item.inventory_item_id || !item.outlet_id) return false
      const inventoryRow = inventoryById.get(item.inventory_item_id)
      const depletion = Math.max(1, Number(item.depletion_qty || 1))
      return Number(inventoryRow?.current_stock || 0) >= depletion * 2
    })
    if (!candidate) return null
    const inventoryRow = inventoryById.get(candidate.inventory_item_id)
    return {
      menuItem: candidate,
      inventoryItem: inventoryRow,
      beforeStock: Number(inventoryRow?.current_stock || 0),
      depletionQty: Math.max(1, Number(candidate.depletion_qty || 1))
    }
  })
}

test.setTimeout(240000)

test('desktop depletes live inventory correctly after a POS sale and keeps totals stable', async () => {
  const userDataDir = createTempUserDataDir('boroko-e2e-pos-stock-')
  const seed = createDesktopSeedFromInstalledProfile()
  seedDesktopUserData(userDataDir, seed)

  const onlineEnv = getRealBackendEnv()
  expect(onlineEnv.SUPABASE_URL).toBeTruthy()
  expect(onlineEnv.SUPABASE_ANON_KEY).toBeTruthy()

  const { app, window: page } = await launchDesktopApp({
    userDataDir,
    extraEnv: { BOROKO_TEST_FORCE_OFFLINE: 'true', ...onlineEnv }
  })

  let selected = null

  try {
    await signInDesktop(page, seed)
    restoreSeededSessionNonce(userDataDir, seed)
    await restoreBackendSession(page, seed)
    await switchDesktopToOnline(page)

    selected = await pickInventoryBackedMenuItem(page)
    expect(selected).toBeTruthy()

    const quantity = 2
    const unitPrice = Number(selected.menuItem.price || selected.menuItem.unit_price || 0)
    const expectedTotal = Number((quantity * unitPrice).toFixed(2))
    const stockDelta = selected.depletionQty * quantity

    const created = await createPosOrderViaApi(page, {
      walkInName: `POS Stock Guest ${Date.now()}`,
      outletId: selected.menuItem.outlet_id,
      paymentMethod: 'cash',
      notes: 'Playwright POS stock depletion',
      items: [
        {
          menu_item_id: selected.menuItem.id,
          item_name: selected.menuItem.name,
          quantity,
          unit_price: unitPrice
        }
      ]
    })

    expect(created?.success).toBe(true)

    const syncedOrder = await waitForPosOrder(page, created.id, {
      timeout: 60000,
      predicate: (order) => order._pending_sync !== true && Number(order?.total || 0) === expectedTotal
    })

    expect(syncedOrder).toBeTruthy()
    expect(Number(syncedOrder.total || 0)).toBe(expectedTotal)

    const afterInventory = await page.evaluate(async (inventoryItemId) => {
      const items = await window.api.inventory.getItems()
      return (items || []).find((item) => String(item?.id || '') === String(inventoryItemId)) || null
    }, selected.inventoryItem.id)

    expect(afterInventory).toBeTruthy()
    expect(Number(afterInventory.current_stock || 0)).toBe(Number(selected.beforeStock || 0) - stockDelta)
  } finally {
    if (selected?.inventoryItem?.id) {
      const restoreAmount = selected.depletionQty * 2
      await page.evaluate(async ({ inventoryItemId, restoreAmount }) => {
        return window.api.inventory.adjustStock(inventoryItemId, restoreAmount, 'Playwright restore after POS stock test')
      }, {
        inventoryItemId: selected.inventoryItem.id,
        restoreAmount
      }).catch(() => {})
    }
    await app.close().catch(() => {})
  }
})
