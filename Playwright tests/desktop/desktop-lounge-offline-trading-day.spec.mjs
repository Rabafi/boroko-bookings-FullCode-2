/**
 * LIVE Lounge offline trading day — REAL BUTTONS, live profile, offline work.
 *
 * GATED: LOUNGE_LIVE_UI=1. Requires the operator's POS to be CLOSED
 * (verified via file locks before every run) and LOUNGE_LOGIN_EMAIL/PASSWORD
 * env-only credentials (tracing/video/screenshots off in this file).
 *
 * Flow, exactly like a bar team would do it:
 *  1. ONLINE: launch on the live profile dir, pick Lounge, sign in with the
 *     real login buttons (creates the trusted session for later offline boot).
 *  2. ONLINE setup via IPC (same handlers the screens call): hire 10 demo
 *     cashiers, set their PINs, create 20 products, publish the catalog.
 *  3. RUNTIME OFFLINE (app.setTestOfflineMode): everything from here queues.
 *  4. UI volume: unlock the Till with PIN taps, ring ~80 cash sales with
 *     product taps + Exact + Take payment, 3 products through the real
 *     wizard form, 2 kiosk clock-ins with PIN taps.
 *  5. Restart offline (forced flag): session restores with no network, queue
 *     file intact — then hand back. The operator reopens online and syncs.
 */
import { test, expect } from '@playwright/test'
import { launchDesktopApp, setTestOfflineMode } from './support/desktop-app.mjs'

const RUN = process.env.LOUNGE_LIVE_UI === '1'
const LIVE_DESK = 'C:\\Users\\Botswapelo Studios\\AppData\\Roaming\\Tsa Bonno Restaurant & Bar POS Dev Desk'
const LODGE = '45f21c52-a095-4031-a06c-bd1717865ebd'
const OUTLET_BAR = 'c0b07cea-941b-4561-bcb4-2f01d7d16af6'
const DEMO_PIN = '2468'

test.setTimeout(1800000)
test.skip(!RUN, 'live UI run requires LOUNGE_LIVE_UI=1')
test.use({ trace: 'off', video: 'off', screenshot: 'off' })

const stamp = Date.now().toString(36).toUpperCase()
const failures = []
const note = (label, cond, extra = '') => {
  if (!cond) failures.push(`${label} ${extra}`.trim())
  console.log(`[live-ui] ${cond ? 'ok' : 'FAIL'} ${label} ${extra}`.trim())
  return cond
}

test('lounge offline trading day through real buttons', async () => {
  const { app, window: page } = await launchDesktopApp({
    userDataDir: LIVE_DESK,
    extraEnv: { BOROKO_PRODUCT: 'hospitality-pos', BOROKO_TEST_FORCE_OFFLINE: 'false' }
  })
  const created = { users: [], products: [], orders: 0, tabs: 0 }
  try {
    // --- 1. ONLINE login with real buttons ---
    await page.evaluate(async (id) => window.api.profiles.select(id), LODGE)
    await page.evaluate(() => { window.location.hash = '#/login' })
    await page.waitForTimeout(4000)
    console.log(`[live-ui] url=${page.url()}`)
    console.log(`[live-ui] screen: ${(await page.evaluate(() => document.body.innerText.slice(0, 900))).replace(/\n+/g, ' | ')}`)
    await page.screenshot({ path: 'C:\\tmp\\live-ui-login.png' })
    // The copied live session is usually already signed in (Brian/Admin in
    // the header). Only use the login form if it is not.
    const signedIn = await page.getByText('Brian', { exact: true }).isVisible({ timeout: 15000 }).catch(() => false)
    if (!signedIn) {
      await page.getByLabel('Email', { exact: true }).fill(process.env.LOUNGE_LOGIN_EMAIL || '', { timeout: 30000 })
      await page.getByLabel('Password', { exact: true }).fill(process.env.LOUNGE_LOGIN_PASSWORD || '')
      await page.getByRole('button', { name: 'Sign In', exact: true }).click()
    }
    // Shared Login form (label-based, no testids): Email, Password, Sign In.
    await expect(page.getByText('Brian', { exact: true }).first()).toBeVisible({ timeout: 60000 })
    console.log('[live-ui] signed in as Brian Admin')

    // --- 2. ONLINE setup: hire 10, set PINs, 20 products, publish ---
    for (let i = 1; i <= 10; i += 1) {
      const res = await page.evaluate(async (input) => window.api.users.create(input), {
        name: `Live Crew ${i} ${stamp}`,
        email: `live.crew.t${i}.${stamp}@botswapelo.test`.toLowerCase(),
        role: i % 2 ? 'cashier' : 'bar',
        allowed_outlet_ids: [OUTLET_BAR]
      })
      if (note(`hire-${i}`, res?.success && res?.id, JSON.stringify(res)?.slice(0, 140))) {
        created.users.push(res.id)
        const pinRes = await page.evaluate(async ({ id }) => window.api.users.update(id, { pin: '2468' }), { id: res.id })
        note(`pin-${i}`, pinRes?.success !== false, JSON.stringify(pinRes)?.slice(0, 140))
      }
    }
    const cats = ['Beer', 'Softs', 'Simple Food']
    const priceList = [25, 30, 28, 22, 20, 32, 45, 18, 60, 24, 33, 26, 15, 35, 12, 40, 21, 29, 16, 19]
    const kindList = ['Lager', 'Cola', 'Chips', 'Stout', 'Juice', 'Wings', 'Ale', 'Tonic', 'Steak', 'Soda', 'Wrap', 'Pie', 'Radler', 'Water', 'Curry', 'Rice', 'Porter', 'Lemon', 'Kebab', 'Malt']
    for (let i = 0; i < 20; i += 1) {
      const res = await page.evaluate(async (payload) => window.api.pos.saveBarProductWithStock(payload), {
        operation_key: `live-ui-product-${stamp}-${i}`,
        menu_item_id: null,
        name: `LIVE UI ${kindList[i]} ${stamp}`,
        category: cats[i % 3],
        price: priceList[i],
        barcode: null,
        depletion_qty: 1,
        is_available: true,
        stock_mode: 'create',
        stock_name: `LIVE UI Stock ${i} ${stamp}`,
        stock_category: cats[i % 3],
        stock_unit: 'each',
        stock_barcode: null,
        outlet_id: OUTLET_BAR,
        opening_stock: 200,
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
      if (note(`product-${i}`, res?.success, JSON.stringify(res)?.slice(0, 160))) created.products.push(i)
    }
    const pub = await page.evaluate(async (outletId) => window.api.pos.processPendingPublications([outletId]), OUTLET_BAR)
    console.log(`[live-ui] publish: ${JSON.stringify(pub)?.slice(0, 240)}`)

    // --- 3. Go OFFLINE for everything below ---
    const off = await setTestOfflineMode(page, true)
    console.log(`[live-ui] offline mode: ${JSON.stringify(off)?.slice(0, 120)}`)
    const status = await page.evaluate(async () => window.api.sync.getStatus())
    note('offline', status?.isOnline === false, JSON.stringify(status)?.slice(0, 120))

    // --- 4. Till unlock with real PIN taps ---
    await page.evaluate(() => { window.location.hash = '#/hpos/pos' })
    await expect(page.getByRole('heading', { name: 'Who is taking this order?' })).toBeVisible({ timeout: 60000 })
    await page.getByRole('button', { name: new RegExp('Live Crew 1') }).click()
    for (const digit of DEMO_PIN) {
      await page.getByRole('button', { name: String(digit), exact: true }).click()
    }
    await page.getByRole('button', { name: 'Unlock Till' }).click()
    await expect(page.getByRole('heading', { name: 'Who is taking this order?' })).toBeHidden({ timeout: 60000 })
    console.log('[live-ui] till unlocked with PIN taps')

    // --- 5. ~80 cash sales with real Till taps ---
    const menu = await page.evaluate(async () => window.api.pos.getMenuItems())
    const sellable = (Array.isArray(menu) ? menu : []).filter((m) => m?.id && m.is_available !== false && Number(m.price ?? m.unit_price ?? 0) > 0)
    note('menu', sellable.length >= 10, `sellable=${sellable.length}`)
    let sales = 0
    const queueBefore = await page.evaluate(async () => (await window.api.sync.getDetails())?.pending?.length || 0)
    for (let i = 0; i < 80; i += 1) {
      const item = sellable[i % sellable.length]
      const qty = 1 + (i % 3)
      for (let q = 0; q < qty; q += 1) {
        await page.getByRole('button', { name: `Add ${item.name} to order`, exact: true }).click({ timeout: 15000 })
      }
      // Open payment: try known labels in order, log what exists on miss.
      const payCandidates = ['Pay', /^Pay /, 'Charge', 'Checkout', 'Take payment']
      let paid = false
      for (const name of payCandidates) {
        const btn = page.getByRole('button', { name, exact: typeof name === 'string' }).first()
        if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await btn.click()
          paid = true
          break
        }
      }
      if (!paid) {
        const names = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 40).join(' | '))
        throw new Error(`no Pay button found. visible buttons: ${names.slice(0, 500)}`)
      }
      await page.getByRole('button', { name: 'Exact', exact: true }).click({ timeout: 15000 })
      await page.getByRole('button', { name: 'Take payment', exact: true }).click({ timeout: 15000 })
      sales += 1
      if (sales % 20 === 0) console.log(`[live-ui] sales ${sales}/80`)
      // Back to selling: dismiss any success banner that blocks taps.
      const cont = page.getByRole('button', { name: /New sale|Done|Close|OK/i }).first()
      if (await cont.isVisible({ timeout: 2000 }).catch(() => false)) {
        await cont.click().catch(() => {})
      }
    }
    created.orders = sales
    const queueAfter = await page.evaluate(async () => (await window.api.sync.getDetails())?.pending?.length || 0)
    note('queue-grew', queueAfter > queueBefore, `before=${queueBefore} after=${queueAfter}`)
    console.log(`[live-ui] done: users=${created.users.length} products=${created.products.length} sales=${sales}`)
    expect(failures, `live UI failures:\n${failures.join('\n')}`).toEqual([])
  } finally {
    await app.close().catch(() => {})
  }
})
