/**
 * LIVE Lounge data injection (REAL server records, Playwright + Electron).
 *
 * GATED: only runs with LOUNGE_LIVE_INJECT=1. The default e2e suite skips it
 * so ordinary test runs can never write to the live tenant.
 *
 * Method: copies the live Bar POS profile to a temp dir, launches the REAL
 * hospitality-pos Electron app against the REAL backend as the current live
 * session, and creates records through the app's own IPC handlers
 * (users:create, pos:saveBarProductWithStock, pos:createOrder, pos:saveTab).
 * Every write goes through production validation; failures are collected,
 * never retried blindly.
 *
 * The operator's live POS must be CLOSED while this runs (session safety).
 */
import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { launchDesktopApp } from './support/desktop-app.mjs'

const RUN = process.env.LOUNGE_LIVE_INJECT === '1'
const LIVE_DESK = 'C:\\Users\\Botswapelo Studios\\AppData\\Roaming\\Tsa Bonno Restaurant & Bar POS Dev Desk'
const OUTLET_BAR = 'c0b07cea-941b-4561-bcb4-2f01d7d16af6'
const TILL_A = 'ee54afa6-e265-403f-a0f3-85cde641c39c'
const TILL_B = '08d98088-7fd8-47d6-baf3-deb2ba79a9a5'

test.setTimeout(900000)
test.skip(!RUN, 'live injection requires LOUNGE_LIVE_INJECT=1')
// Credential safety: this run types a real password — no trace, video, or screenshots.
test.use({ trace: 'off', video: 'off', screenshot: 'off' })

const stamp = Date.now().toString(36).toUpperCase()
const failures = []
const ok = (label, cond, extra = '') => {
  if (!cond) failures.push(`${label} ${extra}`.trim())
  return cond
}

function copyLiveProfile() {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'lounge-live-inject-'))
  for (const name of ['profiles.json', 'lodge-id.json']) {
    fs.copyFileSync(path.join(LIVE_DESK, name), path.join(dest, name))
  }
  const srcCache = path.join(LIVE_DESK, 'boroko-cache')
  const dstCache = path.join(dest, 'boroko-cache')
  fs.mkdirSync(dstCache, { recursive: true })
  for (const entry of fs.readdirSync(srcCache, { withFileTypes: true })) {
    if (entry.isDirectory()) continue
    fs.copyFileSync(path.join(srcCache, entry.name), path.join(dstCache, entry.name))
  }
  const srcProf = path.join(srcCache, 'profiles')
  const dstProf = path.join(dstCache, 'profiles')
  fs.mkdirSync(dstProf, { recursive: true })
  for (const prof of fs.readdirSync(srcProf)) {
    if (prof.startsWith('_')) continue
    fs.cpSync(path.join(srcProf, prof), path.join(dstProf, prof), { recursive: true })
  }
  return dest
}

async function launchLiveApp(userDataDir) {
  // Reuse the proven launcher (splash-skipping main-window wait) but run
  // ONLINE against the real backend: this instance must commit for real.
  return launchDesktopApp({
    userDataDir,
    extraEnv: {
      BOROKO_PRODUCT: 'hospitality-pos',
      BOROKO_TEST_FORCE_OFFLINE: 'false'
    }
  })
}

test('inject live Lounge trading data through the real app', async () => {
  const userDataDir = copyLiveProfile()
  const { app, window: page } = await launchLiveApp(userDataDir)
  const created = { users: [], products: [], orders: [], tabs: [] }

  try {
    // Restore the copied live session (admin) so writes authenticate.
    const liveUsers = JSON.parse(fs.readFileSync(path.join(userDataDir, 'boroko-cache', 'profiles', '45f21c52-a095-4031-a06c-bd1717865ebd', 'users.json'), 'utf8'))
    const admin = liveUsers.find((u) => u?.role === 'admin' && u?.status === 'active') || liveUsers[0]
    const { restoreSeededDesktopSession } = await import('./support/desktop-flows.mjs')
    void restoreSeededDesktopSession
    // Hospitality-pos boots to the business picker: select the Lounge
    // through the real profiles IPC, then restore the copied live session.
    const selected = await page.evaluate(async (lodgeId) => window.api.profiles.select(lodgeId), '45f21c52-a095-4031-a06c-bd1717865ebd')
    console.log(`[live-inject] profiles.select: ${JSON.stringify(selected)?.slice(0, 200)}`)
    const restoredUser = await page.evaluate(async () => window.api.auth.restoreCurrentSession())
    console.log(`[live-inject] restoreCurrentSession: ${restoredUser ? `ok (${restoredUser.email || restoredUser.name})` : 'NULL'}`)
    if (!restoredUser) {
      // Fall back to a fresh UI login with the one-time env credentials.
      const email = process.env.LOUNGE_LOGIN_EMAIL || ''
      const password = process.env.LOUNGE_LOGIN_PASSWORD || ''
      expect(email && password, 'LOUNGE_LOGIN_EMAIL/PASSWORD env required for fresh login').toBeTruthy()
      await page.evaluate(() => { window.location.hash = '#/login' })
      await page.getByTestId('login-email-input').fill(email)
      await page.getByTestId('login-password-input').fill(password)
      await page.getByTestId('login-submit-button').click()
      await expect(page.getByTestId('sidebar-sync-panel')).toBeVisible({ timeout: 120000 })
    }
    const validated = await page.evaluate(async () => window.api.auth.validateSession?.())
    console.log(`[live-inject] validateSession: ${JSON.stringify(validated)?.slice(0, 200)}`)
    await page.reload()
    await expect(page.getByTestId('sidebar-sync-panel')).toBeVisible({ timeout: 60000 })
    void admin
    // Session check: the team list proves auth against the live backend.
    const team = await page.evaluate(async () => window.api.users.getAll())
    ok('session-team', Array.isArray(team) && team.length >= 2, `team=${Array.isArray(team) ? team.length : typeof team}`)

    // --- 1. Users x10 ---
    for (let i = 1; i <= 10; i += 1) {
      const res = await page.evaluate(async (input) => window.api.users.create(input), {
        name: `Live Stress Tester ${i} ${stamp}`,
        email: `live.stress.t${i}.${stamp}@botswapelo.test`.toLowerCase(),
        role: ['cashier', 'bar', 'waiter'][i % 3],
        allowed_outlet_ids: [OUTLET_BAR]
      })
      if (ok(`user-${i}`, res?.success && res?.id, JSON.stringify(res)?.slice(0, 160))) {
        created.users.push(res.id)
      }
    }

    // --- 2. Products x25 (probe first, fail fast with the real error) ---
    const buildProduct = (i) => ({
      operation_key: `live-stress-product-${stamp}-${i}`,
      menu_item_id: null,
      inventory_item_id: undefined,
      expected_menu_version: null,
      expected_stock_version: null,
      name: `LIVE Stress ${['Burger', 'Fries', 'Stout', 'Lager', 'Cola', 'Juice', 'Wings', 'Pie', 'Cider', 'Tonic', 'Steak', 'Salad', 'Ale', 'Soda', 'Wrap', 'Nuggets', 'Radler', 'Water', 'Curry', 'Rice', 'Porter', 'Lemonade', 'Kebab', 'Cookie', 'Shake'][i]} ${stamp}`,
      category: ['Simple Food', 'Beer', 'Softs'][i % 3],
      price: [35, 30, 28, 25, 20, 32, 45, 22, 27, 18, 60, 25, 32, 10, 28, 33, 24, 12, 40, 15, 34, 26, 30, 8, 18][i],
      barcode: null,
      depletion_qty: 1,
      is_available: true,
      stock_mode: 'create',
      stock_name: `LIVE Stress Stock ${i} ${stamp}`,
      stock_category: ['Simple Food', 'Beer', 'Softs'][i % 3],
      stock_unit: 'each',
      stock_barcode: null,
      outlet_id: OUTLET_BAR,
      opening_stock: 100,
      reorder_level: 10,
      unit_cost: 5,
      selling_price: 0,
      pack6: false,
      pack12: false,
      pack24: false,
      pack6Barcode: null,
      pack12Barcode: null,
      pack24Barcode: null
    })
    const probe = await page.evaluate(async (payload) => window.api.pos.saveBarProductWithStock(payload), buildProduct(0))
    console.log(`[live-inject] product probe: ${JSON.stringify(probe)?.slice(0, 300)}`)
    ok('product-probe', probe?.success, JSON.stringify(probe)?.slice(0, 200))
    if (probe?.success) created.products.push(probe?.menu_item_id || probe?.id || 'probe-0')
    for (let i = 1; i < 25; i += 1) {
      const res = await page.evaluate(async (payload) => window.api.pos.saveBarProductWithStock(payload), buildProduct(i))
      if (ok(`product-${i}`, res?.success, JSON.stringify(res)?.slice(0, 160))) {
        created.products.push(res?.menu_item_id || res?.id || `p-${i}`)
      }
    }

    // --- 3. Catalog publish so the new products are sellable ---
    const pub = await page.evaluate(async (outletId) => window.api.pos.processPendingPublications([outletId]), OUTLET_BAR)
    console.log(`[live-inject] publish: ${JSON.stringify(pub)?.slice(0, 300)}`)

    // --- 4. Read live menu (real ids + server prices) ---
    const menu = await page.evaluate(async () => window.api.pos.getMenuItems())
    const sellable = (Array.isArray(menu) ? menu : []).filter((m) => m?.id && m.is_available !== false)
    ok('menu-readable', sellable.length >= 12, `sellable=${sellable.length}`)
    const priceOf = (m) => Number(m.price ?? m.unit_price ?? 0)

    // --- 5. Orders x150 across both open tills ---
    for (let i = 0; i < 150; i += 1) {
      const item = sellable[i % sellable.length]
      const qty = 1 + (i % 3)
      const total = priceOf(item) * qty
      const res = await page.evaluate(async (payload) => window.api.pos.createOrder(payload), {
        walk_in_name: `LIVE Stress ${stamp} #${i + 1}`,
        outlet_id: OUTLET_BAR,
        shift_id: i % 2 ? TILL_A : TILL_B,
        payment_method: i % 10 < 7 ? 'cash' : 'card',
        notes: 'LIVE stress injection - demo data',
        items: [{ menu_item_id: item.id, item_name: item.name, quantity: qty, unit_price: priceOf(item) }]
      })
      if (ok(`order-${i}`, res?.success && (res?.id || res?.orderId), JSON.stringify(res)?.slice(0, 160))) {
        created.orders.push(res?.id || res?.orderId)
      }
      if ((i + 1) % 25 === 0) console.log(`[live-inject] orders ${i + 1}/150`)
    }

    // --- 6. Tabs x3 ---
    for (let i = 1; i <= 3; i += 1) {
      const res = await page.evaluate(async (payload) => window.api.pos.saveTab(payload), {
        tab_name: `LIVE Stress Tab ${i} ${stamp}`,
        outlet_id: OUTLET_BAR,
        customer_name: 'LIVE Stress Walk-in'
      })
      if (ok(`tab-${i}`, res?.success && (res?.tab?.id || res?.id), JSON.stringify(res)?.slice(0, 160))) {
        created.tabs.push(res?.tab?.id || res?.id)
      }
    }

    console.log(`[live-inject] created users=${created.users.length} products=${created.products.length} orders=${created.orders.length} tabs=${created.tabs.length} failures=${failures.length}`)
    ok('users-count', created.users.length >= 8, `got ${created.users.length}`)
    ok('products-count', created.products.length >= 20, `got ${created.products.length}`)
    ok('orders-count', created.orders.length >= 140, `got ${created.orders.length}`)
    expect(failures, `live injection failures:\n${failures.join('\n')}`).toEqual([])
  } finally {
    await app.close().catch(() => {})
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
})
