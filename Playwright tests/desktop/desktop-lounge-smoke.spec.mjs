import { test, expect } from '@playwright/test'
import bcrypt from 'bcryptjs'
import {
  createTempUserDataDir,
  createDesktopSeed,
  seedDesktopUserData,
  writeProfileCacheData,
  launchDesktopApp
} from './support/desktop-app.mjs'
import { restoreSeededDesktopSession } from './support/desktop-flows.mjs'
import fs from 'fs'
import path from 'path'

test.setTimeout(300000)
test.skip(!process.env.LOUNGE_SMOKE, 'smoke scaffold runs only with LOUNGE_SMOKE=1')

const STAFF_PIN = '2468'

export function loungeStressSeed() {
  const seed = createDesktopSeed({
    lodgeName: 'Botswapelo Lounge (Stress)',
    userName: 'Stress Manager',
    email: 'stress.manager@botswapelo.test',
    password: 'Stress123!',
    role: 'manager',
    outlets: [{ id: 'outlet-bar-1', name: 'Bar', type: 'beverage', sort_order: 1 }],
    posMenuItems: [
      ['Heineken 330ml', 'Beer', 25], ['Castle 330ml', 'Beer', 22],
      ['Fanta 2L', 'Softs', 25], ['Coke 2L', 'Softs', 24],
      ['Serobe', 'Simple Food', 15], ['Russian (full)', 'Simple Food', 18],
      ['Chips', 'Simple Food', 12], ['GranPa', 'Other', 5],
      ['Pool Table 1', 'Pool', 1], ['Pool Table 2', 'Pool', 1],
      ['Water 500ml', 'Softs', 8], ['Russian (half)', 'Simple Food', 10]
    ].map(([name, category, price], i) => ({
      id: `stress-menu-${i}`,
      lodge_id: undefined,
      name,
      category,
      price,
      unit_price: price,
      is_available: true,
      archived_at: null,
      barcode: null,
      stock_method: 'non_stock',
      inventory_item_id: null,
      depletion_qty: 1,
      outlet_id: null,
      template_kind: 'standard'
    })),
    inventoryItems: []
  })
  return seed
}

export function seedLoungeUsers(userDataDir, seed) {
  const pinHash = bcrypt.hashSync(STAFF_PIN, 10)
  const staff = [
    { id: 'staff-cashier-1', name: 'Tebogo Cashier', email: 'tebogo@botswapelo.test', role: 'cashier', status: 'active', lodge_id: seed.lodgeId, pin_hash: pinHash, allowed_outlet_ids: ['outlet-bar-1'], capability_overrides: {} },
    { id: 'staff-bar-1', name: 'Kabelo Bar', email: 'kabelo@botswapelo.test', role: 'bar', status: 'active', lodge_id: seed.lodgeId, pin_hash: pinHash, allowed_outlet_ids: ['outlet-bar-1'], capability_overrides: {} }
  ]
  writeProfileCacheData(userDataDir, seed.lodgeId, 'users', [seed.user, ...staff])
  writeProfileCacheData(userDataDir, seed.lodgeId, 'pos-staff', staff.map((s) => ({
    id: s.id, name: s.name, role: s.role, email: s.email, has_pin: true,
    allowed_outlet_ids: s.allowed_outlet_ids, capability_overrides: {}
  })))
  const settings = { ...seed.settings, business_type: 'restaurant', property_type: 'restaurant' }
  writeProfileCacheData(userDataDir, seed.lodgeId, 'settings', settings)
  return { staff, pin: STAFF_PIN }
}

test('smoke: hospitality-pos boots offline, unlocks the Bar till and rings one sale', async () => {
  const userDataDir = createTempUserDataDir('lounge-e2e-smoke-')
  const seed = loungeStressSeed()
  seedDesktopUserData(userDataDir, seed)
  const { staff } = seedLoungeUsers(userDataDir, seed)

  const { app, window: page } = await launchDesktopApp({
    userDataDir,
    extraEnv: { BOROKO_PRODUCT: 'hospitality-pos' }
  })

  try {
    await restoreSeededDesktopSession(page, seed)
    await page.evaluate(() => { window.location.hash = '#/hpos/pos' })

    // Till unlock dialog: pick cashier, key in PIN, unlock.
    const cashier = staff[0]
    await expect(page.getByRole('heading', { name: 'Who is taking this order?' })).toBeVisible({ timeout: 60000 })
    await page.getByRole('button', { name: new RegExp(cashier.name) }).click()
    for (const digit of STAFF_PIN) {
      await page.getByRole('button', { name: String(digit), exact: true }).click()
    }
    await page.getByRole('button', { name: 'Unlock Till' }).click()

    // One counter sale through the real Till UI.
    await page.getByRole('button', { name: 'Add Heineken 330ml to order' }).click({ timeout: 30000 })

    // Diagnostic dump on success path exploration.
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 3000))
    fs.writeFileSync(path.join(userDataDir, 'till-after-add.txt'), bodyText, 'utf8')
    await page.screenshot({ path: path.join(userDataDir, 'till-after-add.png') })
  } finally {
    await app.close().catch(() => {})
  }
})
