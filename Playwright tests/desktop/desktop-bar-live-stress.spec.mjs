/**
 * Botswapelo Bar LIVE stress — thousands of real transactions on the licensed
 * TEST property only (Botswapelo Bar, b380ba5e). NEVER the live Lounge.
 *
 * GATED: BAR_STRESS_LIVE=1. SCALE=full for the thousands-run (default: small
 * preflight that validates every payload shape end to end).
 * Credential safety: real password typed — no trace, video, or screenshots.
 *
 * Flow (mirrors a bar trading weeks offline, through the app's own IPC
 * handlers — the same handlers the screens call):
 *  1. ONLINE login + company chooser -> Botswapelo Bar.
 *  2. ONLINE setup: bar-mode settings (server trigger provisions the Bar
 *     outlet), 30 staff + PINs, admin PIN, 120 products, catalog publish,
 *     one open till + one real PIN-tap Till unlock.
 *  3. OFFLINE bulk: 2000 counter sales, 40 tabs + settles, 30 PIN-approved
 *     voids, 15 PIN returns, 30 clock-ins, 1 cash-up, 40 expenses, 20 stock
 *     adjustments — all queued with stable idempotency keys.
 *  4. Restart OFFLINE on the same profile: session restores, queue intact.
 *  5. ONLINE replay via the real sync runner, then server-confirmed
 *     reconciliation (counts + exact pula totals, zero dead letters).
 *  6. ONLINE clock-outs (cash-up guard satisfied).
 *
 * Nothing is ever cleared: failed financial work stays queued for review.
 */
import { test, expect } from '@playwright/test'
import { createTempUserDataDir, launchDesktopApp, setTestOfflineMode } from './support/desktop-app.mjs'

const RUN = process.env.BAR_STRESS_LIVE === '1'
const FULL = (process.env.SCALE || 'small').toLowerCase() === 'full'
test.setTimeout(FULL ? 3600000 : 1200000)
test.skip(!RUN, 'live Bar stress requires BAR_STRESS_LIVE=1')
test.use({ trace: 'off', video: 'off', screenshot: 'off' })

const BAR_LODGE = 'b380ba5e-a761-4017-8515-4f1ff31785a7'
const BAR_NAME = 'Botswapelo Bar'
const STAFF_PIN = '2468'
const ADMIN_PIN = '1357'
const STAMP = Date.now().toString(36).toUpperCase()
const N = {
  staff: FULL ? 30 : 4,
  products: FULL ? 120 : 6,
  sales: FULL ? 2000 : 6,
  tabs: FULL ? 40 : 2,
  voids: FULL ? 30 : 1,
  returns: FULL ? 15 : 1,
  clockins: FULL ? 30 : 2,
  expenses: FULL ? 40 : 2,
  adjusts: FULL ? 20 : 1
}

const failures = []
const note = (label, cond, extra = '') => {
  if (!cond) failures.push(`${label} ${extra}`.trim())
  console.log(`[bar-stress] ${cond ? 'ok' : 'FAIL'} ${label} ${extra}`.trim())
  return cond
}
const api = (page, fn, arg) => page.evaluate(fn, arg)

test(`bar live stress (${FULL ? 'full' : 'preflight'}) on the test property`, async () => {
  const userDataDir = createTempUserDataDir('bar-stress-live-')
  const run = { outlet: null, staff: [], menu: [], sales: [], tabs: [], shift: null, queueOffline: 0 }
  let app
  let page

  // --- 1. ONLINE login + choose Botswapelo Bar ---
  {
    const launched = await launchDesktopApp({
      userDataDir,
      extraEnv: { BOROKO_PRODUCT: 'hospitality-pos', BOROKO_TEST_FORCE_OFFLINE: 'false' }
    })
    app = launched.app
    page = launched.window
    try {
      await api(page, () => { window.location.hash = '#/login' })
      await page.waitForTimeout(5000)
      const loginBtn = page.getByRole('button', { name: 'Log in', exact: true })
      if (await loginBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await loginBtn.click()
        await page.waitForTimeout(3000)
      }
      await page.getByTestId('login-email-input').fill(process.env.LOUNGE_LOGIN_EMAIL || '', { timeout: 30000 })
      await api(page, (pw) => {
        const inputs = [...document.querySelectorAll('input[type="password"]')]
        const last = inputs[inputs.length - 1]
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(last), 'value')?.set
          || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter.call(last, pw)
        last.dispatchEvent(new Event('input', { bubbles: true }))
        last.dispatchEvent(new Event('change', { bubbles: true }))
      }, process.env.LOUNGE_LOGIN_PASSWORD || '')
      await page.getByRole('button', { name: /Sign In/i }).first().click()
      // Company chooser (3 memberships): pick the TEST bar, never Lounge.
      // First-time profile bootstrap downloads the whole catalogue, so poll
      // patiently; nudge via profiles.select if the chooser stalls.
      let okSession = false
      let clickedChooser = false
      for (let i = 0; i < 120; i += 1) {
        await page.waitForTimeout(3000)
        const barBtn = page.getByRole('button', { name: /Botswapelo Bar/i }).first()
        if (!clickedChooser && await barBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await barBtn.click().catch(() => {})
          clickedChooser = true
        }
        if (clickedChooser && i % 10 === 9) {
          await api(page, (id) => window.api.profiles.select(id), BAR_LODGE).catch(() => null)
        }
        const s = await api(page, () => window.api.auth.restoreCurrentSession()).catch(() => null)
        if (s && s.lodge_id === BAR_LODGE) { okSession = true; run.me = { id: s.id, email: s.email }; break }
        if (i % 20 === 19) {
          const t = await api(page, () => document.body.innerText.slice(0, 400)).catch(() => '')
          console.log(`[bar-stress] login wait ${(i + 1) * 3}s: ${String(t).replace(/\n+/g, ' | ').slice(0, 200)}`)
        }
      }
      if (!note('login-bar', okSession)) throw new Error('could not sign in to Botswapelo Bar')
    } catch (e) {
      await app.close().catch(() => {})
      throw e
    }
  }

  try {
    // --- 2. ONLINE setup ---
    const settings = await api(page, () => window.api.settings.get())
    if (settings?.property_type !== 'restaurant') {
      const saved = await api(page, () => window.api.settings.save({
        lodge_name: BAR_NAME, company_name: BAR_NAME, business_type: 'restaurant',
        property_type: 'restaurant', currency: 'P', phone: '+26770000000'
      }))
      note('settings-save', saved?.success !== false, JSON.stringify(saved)?.slice(0, 120))
      const prof = await api(page, () => window.api.settings.updateOperatingProfile({ hospitality_mode: 'bar_only' }))
      note('bar-mode', prof?.success !== false, JSON.stringify(prof)?.slice(0, 120))
    } else {
      console.log('[bar-stress] ok settings-exist')
    }
    let outlet = null
    for (let i = 0; i < 10; i += 1) {
      const outlets = await api(page, () => window.api.outlets.getAll())
      outlet = (Array.isArray(outlets) ? outlets : []).find((o) => o?.id && String(o.type || '').toLowerCase() === 'beverage') || null
      if (outlet) break
      await page.waitForTimeout(3000)
    }
    if (!note('bar-outlet', !!outlet, outlet ? outlet.id : '')) throw new Error('no Bar outlet provisioned')
    run.outlet = outlet.id

    const pinSet = await api(page, (arg) => window.api.users.update(arg.id, { pin: arg.pin }), { id: run.me.id, pin: ADMIN_PIN })
    note('admin-pin', pinSet?.success !== false, JSON.stringify(pinSet)?.slice(0, 100))

    for (let i = 1; i <= N.staff; i += 1) {
      const res = await api(page, (arg) => window.api.users.create(arg), {
        name: `STRESS Crew ${i} ${STAMP}`,
        email: `stress.crew.${i}.${STAMP}@botswapelo.test`.toLowerCase(),
        role: ['cashier', 'bar', 'waiter'][i % 3],
        allowed_outlet_ids: [run.outlet]
      })
      if (note(`hire-${i}`, res?.success && res?.id, JSON.stringify(res)?.slice(0, 100))) {
        run.staff.push({ id: res.id, name: `STRESS Crew ${i} ${STAMP}` })
        const pinRes = await api(page, (arg) => window.api.users.update(arg.id, { pin: arg.pin }), { id: res.id, pin: STAFF_PIN })
        note(`crew-pin-${i}`, pinRes?.success !== false)
      }
      if (i % 10 === 0) console.log(`[bar-stress] hired ${i}/${N.staff}`)
    }
    await api(page, () => window.api.users.getAll()).catch(() => null) // refresh offline PIN cache

    const cats = ['Beer', 'Softs', 'Simple Food']
    const priceList = [25, 30, 28, 22, 20, 32, 45, 18, 60, 24, 33, 26]
    for (let i = 0; i < N.products; i += 1) {
      const res = await api(page, (arg) => window.api.pos.saveBarProductWithStock(arg), {
        operation_key: `stress-product-${STAMP}-${i}`,
        menu_item_id: null,
        name: `STRESS ${cats[i % 3]} ${i} ${STAMP}`,
        category: cats[i % 3],
        price: priceList[i % priceList.length],
        barcode: null,
        depletion_qty: 1,
        is_available: true,
        stock_mode: 'create',
        stock_name: `STRESS Stock ${i} ${STAMP}`,
        stock_category: cats[i % 3],
        stock_unit: 'each',
        stock_barcode: null,
        outlet_id: run.outlet,
        opening_stock: 5000,
        reorder_level: 10,
        unit_cost: 5,
        selling_price: 0,
        pack6: false, pack12: false, pack24: false,
        pack6Barcode: null, pack12Barcode: null, pack24Barcode: null
      })
      note(`product-${i}`, res?.success, JSON.stringify(res)?.slice(0, 120))
      if (i % 20 === 0) console.log(`[bar-stress] products ${i}/${N.products}`)
    }
    const pub = await api(page, (outletId) => window.api.pos.processPendingPublications([outletId]), run.outlet)
    console.log(`[bar-stress] publish: ${JSON.stringify(pub)?.slice(0, 200)}`)
    const menu = await api(page, () => window.api.pos.getMenuItems())
    run.menu = (Array.isArray(menu) ? menu : []).filter((m) => m?.id && m.is_available !== false && Number(m.price ?? m.unit_price ?? 0) > 0)
    if (!note('menu', run.menu.length >= Math.max(4, N.products - 2), `sellable=${run.menu.length}`)) throw new Error('menu not sellable')

    const opened = await api(page, (arg) => window.api.pos.openShift(arg), {
      outlet_id: run.outlet, cashier_id: run.staff[0]?.id || run.me.id, opening_float: 500
    })
    if (!note('till-open', opened?.success && opened?.shift?.id, JSON.stringify(opened)?.slice(0, 140))) throw new Error('till did not open')
    run.shift = opened.shift.id

    // One real Till unlock through the screen (PIN taps), the trust root for offline tabs.
    await api(page, () => { window.location.hash = '#/hpos/pos' })
    const unlockHeading = page.getByRole('heading', { name: 'Who is taking this order?' })
    if (await unlockHeading.isVisible({ timeout: 60000 }).catch(() => false)) {
      await page.getByRole('button', { name: new RegExp(run.staff[0].name) }).click()
      for (const digit of STAFF_PIN) {
        await page.getByRole('button', { name: String(digit), exact: true }).click()
      }
      await page.getByRole('button', { name: 'Unlock Till' }).click()
      note('till-unlock-ui', await unlockHeading.isHidden({ timeout: 60000 }).catch(() => false))
    } else {
      console.log('[bar-stress] till unlock dialog did not appear; continuing with open shift')
    }

    // --- 3. OFFLINE bulk ---
    const off = await setTestOfflineMode(page, true)
    const status = await api(page, () => window.api.sync.getStatus())
    if (!note('offline', status?.isOnline === false, JSON.stringify(status)?.slice(0, 100))) throw new Error('could not go offline')
    const queueBefore = await api(page, async () => (await window.api.sync.getDetails())?.pending?.length || 0)

    for (let i = 0; i < N.sales; i += 1) {
      const item = run.menu[i % run.menu.length]
      const qty = 1 + (i % 3)
      const price = Number(item.price ?? item.unit_price ?? 0)
      const res = await api(page, (arg) => window.api.pos.createOrder(arg), {
        outlet_id: run.outlet,
        shift_id: run.shift,
        walk_in_name: `STRESS ${STAMP} #${i + 1}`,
        payment_method: i % 10 < 7 ? 'cash' : 'card',
        items: [{ menu_item_id: item.id, item_name: item.name, quantity: qty, unit_price: price }]
      })
      if (note(`sale-${i}`, res?.success && res?.id, (res?.success ? '' : JSON.stringify(res)?.slice(0, 140)))) {
        run.sales.push({ id: res.id, total: price * qty, method: i % 10 < 7 ? 'cash' : 'card', item })
      }
      if ((i + 1) % 500 === 0) console.log(`[bar-stress] queued sales ${i + 1}/${N.sales}`)
    }

    for (let i = 0; i < N.tabs; i += 1) {
      const tabRes = await api(page, (arg) => window.api.pos.saveTab(arg), {
        tab_name: `STRESS Tab ${i} ${STAMP}`, outlet_id: run.outlet, customer_name: 'STRESS Walk-in'
      })
      const tabId = tabRes?.tab?.id || tabRes?.id
      if (note(`tab-${i}`, tabRes?.success && tabId, JSON.stringify(tabRes)?.slice(0, 120))) {
        run.tabs.push(tabId)
        const item = run.menu[i % run.menu.length]
        const price = Number(item.price ?? item.unit_price ?? 0)
        const settle = await api(page, (arg) => window.api.pos.createOrder(arg), {
          outlet_id: run.outlet, shift_id: run.shift, tab_id: tabId, tab_name: `STRESS Tab ${i} ${STAMP}`,
          service_mode: 'tab', payment_method: 'cash',
          items: [{ menu_item_id: item.id, item_name: item.name, quantity: 2, unit_price: price }]
        })
        if (note(`settle-${i}`, settle?.success && settle?.id, JSON.stringify(settle)?.slice(0, 140))) {
          run.sales.push({ id: settle.id, total: price * 2, method: 'cash', item, tab: true })
        }
      }
    }

    const voidTargets = run.sales.filter((_, i) => i % Math.max(1, Math.floor(run.sales.length / N.voids)) === 0).slice(0, N.voids)
    for (const v of voidTargets) {
      const res = await api(page, (arg) => window.api.pos.approveVoidWithPin(arg), {
        order_id: v.id, pin: ADMIN_PIN, reason: 'STRESS over-ring',
        cashier_user_id: run.staff[0]?.id || run.me.id, outlet_id: run.outlet
      })
      note(`void-${v.id.slice(0, 8)}`, res?.success !== false, JSON.stringify(res)?.slice(0, 140))
      if (res?.success !== false) v.voided = true
    }
    const returnTargets = run.sales.filter((s) => !s.voided).filter((_, i) => i % Math.max(1, Math.floor(run.sales.length / N.returns)) === 0).slice(0, N.returns)
    for (const r of returnTargets) {
      const res = await api(page, (arg) => window.api.pos.createPartialReturnWithPin(arg), {
        order_id: r.id, pin: ADMIN_PIN, reason: 'STRESS spill',
        lines: [{ menu_item_id: r.item.id, quantity: 1 }],
        outlet_id: run.outlet, cashier_user_id: run.staff[0]?.id || run.me.id
      })
      note(`return-${r.id.slice(0, 8)}`, res?.success !== false, JSON.stringify(res)?.slice(0, 160))
      if (res?.success !== false) r.returned = Math.min(r.total, Number(r.item.price ?? r.item.unit_price ?? 0))
    }

    for (let i = 1; i <= N.clockins && i < run.staff.length; i += 1) {
      const s = run.staff[i]
      const res = await api(page, (arg) => window.api.pos.clockInStaffWithAttendancePin(arg), {
        staff_user_id: s.id, pin: STAFF_PIN, role: 'cashier'
      })
      note(`clockin-${i}`, res?.success !== false, JSON.stringify(res)?.slice(0, 140))
    }
    const cashup = await api(page, (arg) => window.api.pos.submitCashupWithAttendancePin(arg), {
      shift_id: run.shift, pin: STAFF_PIN, counted_by_method: { cash: 0 }, notes: `STRESS ${STAMP}`
    })
    note('cashup', cashup?.success !== false, JSON.stringify(cashup)?.slice(0, 160))

    const today = new Date().toISOString().slice(0, 10)
    for (let i = 0; i < N.expenses; i += 1) {
      const res = await api(page, (arg) => window.api.expenses.create(arg), {
        date: today, category: 'Supplies', description: `STRESS expense ${i} ${STAMP}`,
        amount: 50 + i, outlet_id: run.outlet
      })
      note(`expense-${i}`, res?.success, JSON.stringify(res)?.slice(0, 120))
    }
    const stock = await api(page, () => window.api.inventory.getItems()).catch(() => [])
    const stockItem = (Array.isArray(stock) ? stock : []).find((s) => s?.id)
    for (let i = 0; i < N.adjusts; i += 1) {
      if (!stockItem) { note('adjust-no-stock', false, 'no inventory items'); break }
      const res = await api(page, (arg) => window.api.inventory.adjustStock(arg.id, arg.delta, arg.notes, arg.pin, arg.key), {
        id: stockItem.id, delta: 5, notes: `STRESS count ${i} ${STAMP}`, pin: ADMIN_PIN, key: `stress-adjust-${STAMP}-${i}`
      })
      note(`adjust-${i}`, res?.success !== false, JSON.stringify(res)?.slice(0, 140))
    }

    const queueAfter = await api(page, async () => (await window.api.sync.getDetails())?.pending?.length || 0)
    run.queueOffline = queueAfter
    note('queue-grew', queueAfter - queueBefore >= N.sales, `before=${queueBefore} after=${queueAfter}`)
    console.log(`[bar-stress] offline bulk done: sales=${run.sales.length} tabs=${run.tabs.length}`)

    // --- 4. Restart OFFLINE: session + queue must survive ---
    await app.close().catch(() => {})
    const relaunched = await launchDesktopApp({
      userDataDir,
      extraEnv: { BOROKO_PRODUCT: 'hospitality-pos', BOROKO_TEST_FORCE_OFFLINE: 'true' }
    })
    app = relaunched.app
    page = relaunched.window
    const restored = await api(page, () => window.api.auth.restoreCurrentSession()).catch(() => null)
    note('restart-session', restored?.lodge_id === BAR_LODGE, restored ? restored.email : 'NULL')
    const queueReloaded = await api(page, async () => (await window.api.sync.getDetails())?.pending?.length || 0)
    note('restart-queue', queueReloaded === run.queueOffline, `reloaded=${queueReloaded} expected=${run.queueOffline}`)

    // --- 5. ONLINE replay + server reconciliation ---
    const back = await setTestOfflineMode(page, false)
    console.log(`[bar-stress] back online: ${JSON.stringify(back)?.slice(0, 80)}`)
    await api(page, () => window.api.sync.runNow()).catch(() => null)
    const deadline = Date.now() + (FULL ? 2400000 : 300000)
    let st = null
    for (;;) {
      await page.waitForTimeout(10000)
      st = await api(page, () => window.api.sync.getStatus()).catch(() => null)
      if (st?.pending === 0 && st?.syncInProgress === false) break
      if (Date.now() > deadline) break
      console.log(`[bar-stress] replay pending=${st?.pending} failed=${st?.failed}`)
    }
    note('replay-drained', st?.pending === 0, JSON.stringify(st)?.slice(0, 160))
    const details = await api(page, () => window.api.sync.getDetails()).catch(() => null)
    const failed = details?.failed || []
    note('no-dead-letters', failed.length === 0, failed.length ? JSON.stringify(failed.slice(0, 3)).slice(0, 500) : '')

    const orders = await api(page, (arg) => window.api.pos.getOrders(arg.from, arg.to), { from: '2020-01-01', to: '2099-12-31' })
    const mine = (Array.isArray(orders) ? orders : []).filter((o) => String(o?.walk_in_name || '').startsWith(`STRESS ${STAMP}`))
    // Tab settles carry tab_name instead of walk_in_name; count them separately.
    const tabSettles = (Array.isArray(orders) ? orders : []).filter((o) => String(o?.tab_name || '').startsWith(`STRESS Tab`) && String(o?.tab_name || '').includes(STAMP))
    note('server-count', mine.length >= run.sales.filter((s) => !s.tab).length, `server=${mine.length} queued=${run.sales.length} tabSettles=${tabSettles.length}`)

    let expectCash = 0
    let expectCard = 0
    for (const s of run.sales.filter((s) => !s.tab)) {
      if (s.voided) continue
      const net = s.total - (s.returned || 0)
      if (s.method === 'cash') expectCash += net
      else expectCard += net
    }
    let serverCash = 0
    let serverCard = 0
    for (const o of mine) {
      if (String(o?.status || '').toLowerCase() === 'voided') continue
      const t = Number(o?.total ?? o?.total_amount ?? 0)
      if (String(o?.payment_method || 'cash').toLowerCase() === 'card') serverCard += t
      else serverCash += t
    }
    // Returns post as separate reversal records; compare tender totals loosely (±return movements).
    console.log(`[bar-stress] money expect cash=${expectCash} card=${expectCard} | server cash=${serverCash} card=${serverCard}`)
    note('money-cash', Math.abs(serverCash - expectCash) < 1, `diff=${serverCash - expectCash}`)
    note('money-card', Math.abs(serverCard - expectCard) < 1, `diff=${serverCard - expectCard}`)

    // --- 6. Clock-outs online (cash-up submitted, guard satisfied) ---
    for (let i = 1; i <= N.clockins && i < run.staff.length; i += 1) {
      const s = run.staff[i]
      const att = await api(page, (arg) => window.api.pos.getStaffOpenShift(arg), s.id).catch(() => null)
      void att
      const out = await api(page, (arg) => window.api.pos.clockOutStaffWithAttendancePin(arg), {
        staff_user_id: s.id, pin: STAFF_PIN
      }).catch((e) => ({ success: false, error: String(e?.message || e) }))
      console.log(`[bar-stress] clockout-${i} ${out?.success !== false ? 'ok' : `FAIL ${JSON.stringify(out)?.slice(0, 120)}`}`)
    }

    console.log(`[bar-stress] done: staff=${run.staff.length} sales=${run.sales.length} tabs=${run.tabs.length} failures=${failures.length}`)
    expect(failures, `bar stress failures:\n${failures.join('\n')}`).toEqual([])
  } finally {
    await app.close().catch(() => {})
  }
})
