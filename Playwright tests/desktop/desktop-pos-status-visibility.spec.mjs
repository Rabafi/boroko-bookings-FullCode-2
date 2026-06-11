import { test, expect } from '@playwright/test'
import {
  createTempUserDataDir,
  createDesktopSeed,
  seedDesktopUserData,
  launchDesktopApp,
  writeProfileCacheData
} from './support/desktop-app.mjs'
import { signInDesktop, openPosHistoryPage } from './support/desktop-flows.mjs'

test('desktop POS history shows pending, failed, and needs-attention statuses clearly', async () => {
  const userDataDir = createTempUserDataDir()
  const seed = createDesktopSeed()
  seedDesktopUserData(userDataDir, seed)

  const today = new Date().toISOString()
  writeProfileCacheData(userDataDir, seed.lodgeId, 'outlets', [
    { id: 'outlet-bar', lodge_id: seed.lodgeId, name: 'Bar', type: 'beverage' }
  ])
  writeProfileCacheData(userDataDir, seed.lodgeId, 'pos-orders', [
    {
      id: 'pos-pending-1',
      lodge_id: seed.lodgeId,
      outlet_id: 'outlet-bar',
      walk_in_name: 'Pending Walker',
      payment_method: 'cash',
      total: 45,
      status: 'completed',
      created_at: today,
      _pending_sync: true,
      _sync_state: 'pending',
      _sync_error: '',
      outlets: { name: 'Bar' },
      pos_order_items: [{ id: 'line-1', item_name: 'Soft Drink', quantity: 1, unit_price: 45, subtotal: 45 }]
    },
    {
      id: 'pos-failed-1',
      lodge_id: seed.lodgeId,
      outlet_id: 'outlet-bar',
      walk_in_name: 'Failed Walker',
      payment_method: 'cash',
      total: 90,
      status: 'completed',
      created_at: today,
      _sync_state: 'failed',
      _sync_error: 'This order could not sync after reconnect.',
      outlets: { name: 'Bar' },
      pos_order_items: [{ id: 'line-2', item_name: 'Meal', quantity: 1, unit_price: 90, subtotal: 90 }]
    },
    {
      id: 'pos-attention-1',
      lodge_id: seed.lodgeId,
      outlet_id: 'outlet-bar',
      walk_in_name: 'Review Walker',
      payment_method: 'cash',
      total: 120,
      status: 'completed',
      created_at: today,
      _sync_state: 'manual_review_required',
      _sync_error: 'Manual review is required before this order can sync.',
      outlets: { name: 'Bar' },
      pos_order_items: [{ id: 'line-3', item_name: 'Bottle', quantity: 2, unit_price: 60, subtotal: 120 }]
    }
  ])

  const { app, window: page } = await launchDesktopApp({ userDataDir })

  try {
    await signInDesktop(page, seed)
    await openPosHistoryPage(page)

    await expect(page.getByText('Pending Walker')).toBeVisible()
    await expect(page.getByText('Failed Walker')).toBeVisible()
    await expect(page.getByText('Review Walker')).toBeVisible()
    await expect(page.getByText('Pending Sync')).toBeVisible()
    await expect(page.getByText('Failed Sync')).toBeVisible()
    await expect(page.getByText('Needs Attention')).toBeVisible()

    await page.getByText('Failed Walker').click()
    await expect(page.getByText('This order could not sync after reconnect.')).toBeVisible()

    await page.getByText('Review Walker').click()
    await expect(page.getByText('Manual review is required before this order can sync.')).toBeVisible()
  } finally {
    await app.close().catch(() => {})
  }
})
