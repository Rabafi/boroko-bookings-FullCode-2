/**
 * Lounge WEEKS-OFFLINE stress — in-house Botswapelo Lounge only.
 *
 * Owner-confirmed: Lounge is the in-house build/test account, so real queued
 * writes that later sync to its live database are acceptable. Do NOT retarget
 * this file at a real customer property.
 *
 * GATED: LOUNGE_WEEKS_STRESS=1. SCALE=full (default) for the thousands run;
 * SCALE=small for a fast preflight that validates every payload shape.
 * Credentials env-only: LOUNGE_LOGIN_EMAIL / LOUNGE_LOGIN_PASSWORD.
 * No trace, video, or screenshots (real password typed).
 *
 * Flow:
 *  1. ONLINE once: launch on the LIVE Lounge profile dir, select Lounge,
 *     sign in with real buttons (trusted session for offline boot). Read-only
 *     reads (outlets, menu, users) + reuse/open one shift (single setup op).
 *  2. OFFLINE everything else (app.setTestOfflineMode): 10s users + PINs,
 *     100+ products, thousands of counter sales, tabs + settles, PIN voids,
 *     partial returns, clock-ins, one cash-up, expenses, stock deliveries +
 *     adjustments — all queued with stable idempotency keys.
 *  3. LEAVE QUEUED: never goes back online, never calls sync.runNow. The
 *     operator reopens online later and syncs for real. Queue counts logged.
 *
 * All test rows are prefixed WEEKS <STAMP> for filtering/cleanup.
 * Close the operator POS before running (shared profile dir).
 */
import { test, expect } from '@playwright/test'
import { randomUUID } from 'crypto'
import { launchDesktopApp, setTestOfflineMode } from './support/desktop-app.mjs'

const RUN = process.env.LOUNGE_WEEKS_STRESS === '1'
const FULL = (process.env.SCALE || 'full').toLowerCase() === 'full'
test.setTimeout(FULL ? 10800000 : 1200000)
test.skip(!RUN, 'lounge weeks-offline stress requires LOUNGE_WEEKS_STRESS=1')
test.use({ trace: 'off', video: 'off', screenshot: 'off' })

const LIVE_DESK = 'C:\\Users\\Botswapelo Studios\\AppData\\Roaming\\Tsa Bonno Restaurant & Bar POS Dev Desk'
const LODGE = '45f21c52-a095-4031-a06c-bd1717865ebd'
const OUTLET_BAR_FALLBACK = 'c0b07cea-941b-4561-bcb4-2f01d7d16af6'
const STAFF_PIN = '2468'
const ADMIN_PIN = '1357'
const STAMP = Date.now().toString(36).toUpperCase()
const N = {
  staff: FULL ? 25 : 4,
  products: FULL ? 120 : 6,
  sales: FULL ? 2500 : 20,
  tabs: FULL ? 40 : 2,
  voids: FULL ? 30 : 1,
  returns: FULL ? 15 : 1,
  clockins: FULL ? 20 : 2,
  expenses: FULL ? 30 : 2,
  deliveries: FULL ? 25 : 2,
  adjusts: FULL ? 20 : 1
}

const failures = []
const note = (label, cond, extra = '') => {
  if (!cond) failures.push(`${label} ${extra}`.trim())
  console.log(`[weeks-stress] ${cond ? 'ok' : 'FAIL'} ${label} ${extra}`.trim())
  return cond
}
const api = (page, fn, arg) => page.evaluate(fn, arg)

test(`lounge weeks offline (${FULL ? 'full' : 'preflight'}), leave queued`, async () => {
  const email = process.env.LOUNGE_LOGIN_EMAIL || ''
  const password = process.env.LOUNGE_LOGIN_PASSWORD || ''
  if (!email || !password) throw new Error('LOUNGE_LOGIN_EMAIL/PASSWORD env required (never hardcode)')
  const run = { me: null, outlet: null, staff: [], sales: [], tabs: [], shift: null, baseMenu: [] }
  let app
  let page

  // --- 1. ONLINE once: live profile + real login ---
  {
    const launched = await launchDesktopApp({
      userDataDir: LIVE_DESK,
      extraEnv: { BOROKO_PRODUCT: 'hospitality-pos', BOROKO_TEST_FORCE_OFFLINE: 'false' }
    })
    app = launched.app
    page = launched.window
    try {
      // Live profile often already holds a trusted session: reuse it, no form.
      await api(page, (id) => window.api.profiles.select(id), LODGE).catch(() => null)
      await page.waitForTimeout(3000)
      let early = await api(page, () => window.api.auth.restoreCurrentSession()).catch(() => null)
      if (early && (early.lodge_id === LODGE || early.lodgeId === LODGE)) {
        run.me = { id: early.id || early.userId, email: early.email }
        console.log(`[weeks-stress] ok session-reuse ${run.me.email}`)
      } else {
        await api(page, () => { window.location.hash = '#/login' })
        await page.waitForTimeout(5000)
        const loginBtn = page.getByRole('button', { name: 'Log in', exact: true })
        if (await loginBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
          await loginBtn.click()
          await page.waitForTimeout(3000)
        }
        // Company chooser (multi-membership): pick Lounge when shown.
        const loungeBtn = page.getByRole('button', { name: /Botswapelo Lounge/i }).first()
        if (await loungeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
          await loungeBtn.click().catch(() => {})
          await page.waitForTimeout(3000)
        }
        // Only fill the form when it is actually shown (not already signed in).
        const emailBox = page.getByTestId('login-email-input')
        if (await emailBox.isVisible({ timeout: 10000 }).catch(() => false)) {
          await emailBox.fill(email, { timeout: 30000 })
          await api(page, (pw) => {
            const inputs = [...document.querySelectorAll('input[type="password"]')]
            const last = inputs[inputs.length - 1]
            if (!last) throw new Error('no password input')
            const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(last), 'value')?.set
              || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
            setter.call(last, pw)
            last.dispatchEvent(new Event('input', { bubbles: true }))
            last.dispatchEvent(new Event('change', { bubbles: true }))
          }, password)
          await page.getByRole('button', { name: /Sign In/i }).first().click()
        } else {
          // Same handler the Sign In screen calls — reliable when the form
          // is hidden behind an existing header session.
          const loginRes = await api(page, (arg) => window.api.auth.login(arg.email, arg.password, arg.lodge), { email, password, lodge: LODGE })
            .catch((e) => ({ success: false, error: String(e?.message || e) }))
          const okLogin = loginRes?.success !== false && (loginRes?.user || loginRes?.success || loginRes?.lodge_id || loginRes?.lodgeId)
          console.log(`[weeks-stress] ipc-login ${okLogin ? 'ok' : `FAIL ${JSON.stringify(loginRes)?.slice(0, 160)}`}`)
        }
      }
      let okSession = !!run.me
      for (let i = 0; i < 40 && !okSession; i += 1) {
        await page.waitForTimeout(3000)
        if (i % 10 === 9) {
          await api(page, (id) => window.api.profiles.select(id), LODGE).catch(() => null)
        }
        const s = await api(page, () => window.api.auth.restoreCurrentSession()).catch(() => null)
        if (s && (s.lodge_id === LODGE || s.lodgeId === LODGE)) { okSession = true; run.me = { id: s.id || s.userId, email: s.email }; break }
        if (i === 2 || i % 13 === 12) {
          const shape = s ? `keys=${Object.keys(s).join(',')} lodge=${s.lodge_id || s.lodgeId || 'none'} email=${s.email || 'none'}` : 'NULL'
          const t = await api(page, () => document.body.innerText.slice(0, 300)).catch(() => '')
          console.log(`[weeks-stress] login wait ${(i + 1) * 3}s: session=${shape} screen=${String(t).replace(/\n+/g, ' | ').slice(0, 160)}`)
        }
      }
      if (!note('login-lounge', okSession, run.me ? run.me.email : '')) throw new Error('could not sign in to Lounge')
    } catch (e) {
      await app.close().catch(() => {})
      throw e
    }
  }

  try {
    // --- ONLINE reads + one shift (single setup exception to offline-only) ---
    const outlets = await api(page, () => window.api.outlets.getAll()).catch(() => [])
    run.outlet = (Array.isArray(outlets) ? outlets : []).find((o) => o?.id && String(o.type || '').toLowerCase() === 'beverage')?.id
      || OUTLET_BAR_FALLBACK
    note('bar-outlet', !!run.outlet, run.outlet)
    const menu = await api(page, () => window.api.pos.getMenuItems()).catch(() => [])
    run.baseMenu = (Array.isArray(menu) ? menu : []).filter((m) => m?.id && m.is_available !== false && Number(m.price ?? m.unit_price ?? 0) > 0)
    console.log(`[weeks-stress] base sellable=${run.baseMenu.length}`)
    await api(page, () => window.api.users.getAll()).catch(() => null)

    // --- ONLINE identity setup (documented exception to offline-only) ---
    // Staff rows must exist server-side or every later Till/shift replay
    // dead-letters on FKs (see 51-op preflight analysis). All trading volume
    // below stays offline. Names/addresses are STRESS-prefixed test data.
    for (let i = 1; i <= N.staff; i += 1) {
      const res = await api(page, (arg) => window.api.users.create(arg), {
        name: `WEEKS Crew ${i} ${STAMP}`,
        email: `weeks.crew.${i}.${STAMP}@botswapelo.test`.toLowerCase(),
        password: `Stress123!${i}${STAMP}`,
        role: ['cashier', 'bar', 'waiter'][i % 3],
        allowed_outlet_ids: [run.outlet],
        pin: STAFF_PIN
      }).catch((e) => ({ success: false, error: String(e?.message || e) }))
      if (note(`hire-${i}`, res?.success !== false && (res?.id || res === true || res?.success), JSON.stringify(res)?.slice(0, 100))) {
        run.staff.push({ id: res?.id || `weeks-staff-${i}`, name: `WEEKS Crew ${i} ${STAMP}` })
      }
      if (i % 10 === 0) console.log(`[weeks-stress] hired ${i}/${N.staff}`)
    }
    if (!run.staff.length) throw new Error('no staff created online; cannot anchor offline sales')
    // Admin PIN on self (online, immediate) for offline void/return approval.
    await api(page, (arg) => window.api.users.update(arg.id, { pin: arg.pin }), { id: run.me.id, pin: ADMIN_PIN }).catch(() => null)
    // Open shift online as the selling operator + online Till unlock (server
    // proof; offline re-unlocks later only refresh the window session).
    let operatorId = run.staff[0].id
    {
      const opened = await api(page, (arg) => window.api.pos.openShift(arg), {
        outlet_id: run.outlet, cashier_id: operatorId, opening_float: 500
      }).catch((e) => ({ success: false, error: String(e?.message || e) }))
      if (note('till-open-online', opened?.success && (opened?.shift?.id || opened?.id), JSON.stringify(opened)?.slice(0, 140))) {
        run.shift = opened.shift?.id || opened.id
      } else {
        // Fall back to reusing the outlet's current open shift.
        const cur = await api(page, (arg) => window.api.pos.getCurrentShift(arg.outlet, arg.cashier), { outlet: run.outlet, cashier: operatorId }).catch(() => null)
        run.shift = cur?.id || cur?.shift?.id || run.shift
        note('till-reuse-online', !!run.shift, String(run.shift || '').slice(0, 8))
      }
    }
    if (!run.shift) throw new Error('no open shift (needed as offline sales anchor)')
    // Online unlock requires started attendance: clock the operator in first.
    {
      const ci = await api(page, (arg) => window.api.pos.clockInStaffWithAttendancePin(arg), {
        staff_user_id: operatorId, pin: STAFF_PIN, role: 'cashier'
      }).catch((e) => ({ success: false, error: String(e?.message || e) }))
      if (!note('clockin-operator-online', ci?.success !== false, JSON.stringify(ci)?.slice(0, 140))) throw new Error('operator clock-in failed')
    }
    {
      const un = await api(page, (arg) => window.api.pos.activateSharedTillOperator(arg), {
        staff_id: operatorId, outlet_id: run.outlet, pin: STAFF_PIN
      }).catch((e) => ({ success: false, error: String(e?.message || e) }))
      if (!note('till-unlock-online', un?.success !== false, JSON.stringify(un)?.slice(0, 140))) throw new Error('online till unlock failed')
      if (un?.shift?.id) run.shift = un.shift.id
      console.log(`[weeks-stress] sales anchor shift ${String(run.shift).slice(0, 8)} operator ${run.staff[0].name}`)
    }
    await api(page, () => window.api.users.getAll()).catch(() => null) // refresh offline PIN cache (fresh PIN hashes)

    // --- 2. OFFLINE: everything below queues ---
    await setTestOfflineMode(page, true)
    const status = await api(page, () => window.api.sync.getStatus()).catch(() => null)
    if (!note('offline', status?.isOnline === false, JSON.stringify(status)?.slice(0, 100))) throw new Error('could not go offline')
    const queueBefore = await api(page, async () => (await window.api.sync.getDetails())?.pending?.length || 0).catch(() => 0)

    // 100+ products offline (queued catalog snapshots behind product replay).
    // selling_price mirrors price: the server rejects zero for Bar/Kitchen
    // stock items (see 51-op preflight dead-letter analysis).
    const cats = ['Beer', 'Softs', 'Simple Food']
    const prices = [25, 30, 28, 22, 20, 32, 45, 18, 60, 24, 33, 26]
    for (let i = 0; i < N.products; i += 1) {
      const res = await api(page, (arg) => window.api.pos.saveBarProductWithStock(arg), {
        operation_key: `weeks-lounge-product-${STAMP}-${i}`,
        menu_item_id: null,
        name: `WEEKS ${cats[i % 3]} ${i} ${STAMP}`,
        category: cats[i % 3],
        price: prices[i % prices.length],
        barcode: null,
        depletion_qty: 1,
        is_available: true,
        stock_mode: 'create',
        stock_name: `WEEKS Stock ${i} ${STAMP}`,
        stock_category: cats[i % 3],
        stock_unit: 'each',
        stock_barcode: null,
        outlet_id: run.outlet,
        opening_stock: 5000,
        reorder_level: 10,
        unit_cost: 5,
        selling_price: prices[i % prices.length],
        pack6: false, pack12: false, pack24: false,
        pack6Barcode: null, pack12Barcode: null, pack24Barcode: null
      }).catch((e) => ({ success: false, error: String(e?.message || e) }))
      note(`product-${i}`, res?.success !== false, JSON.stringify(res)?.slice(0, 120))
      if ((i + 1) % 30 === 0) console.log(`[weeks-stress] products ${i + 1}/${N.products}`)
    }

    // Session refresh: the Till session is per-window with an inactivity
    // lease. The shift was opened+unlocked online above (server proof); this
    // offline re-activate hits the already-open guard (no duplicate queued)
    // and refreshes the window session for the long offline volume run.
    {
      const un = await api(page, (arg) => window.api.pos.activateSharedTillOperator(arg), {
        staff_id: operatorId, outlet_id: run.outlet, pin: STAFF_PIN
      }).catch((e) => ({ success: false, error: String(e?.message || e) }))
      note('till-session-refresh', un?.success !== false, JSON.stringify(un)?.slice(0, 140))
    }

    // Sellable = pre-existing menu + offline provisional rows (local cache reread).
    const menuOff = await api(page, () => window.api.pos.getMenuItems()).catch(() => [])
    const offSellable = (Array.isArray(menuOff) ? menuOff : []).filter((m) => m?.id && Number(m.price ?? m.unit_price ?? 0) > 0)
    const seen = new Set()
    const sellable = [...offSellable, ...run.baseMenu].filter((m) => {
      if (!m?.id || seen.has(m.id)) return false
      seen.add(m.id)
      return true
    })
    if (!note('menu-offline', sellable.length >= 4, `sellable=${sellable.length} base=${run.baseMenu.length}`)) {
      throw new Error('no sellable menu offline')
    }

    // Thousands of counter sales offline.
    for (let i = 0; i < N.sales; i += 1) {
      const item = sellable[i % sellable.length]
      const qty = 1 + (i % 3)
      const price = Number(item.price ?? item.unit_price ?? 0)
      const res = await api(page, (arg) => window.api.pos.createOrder(arg), {
        outlet_id: run.outlet,
        shift_id: run.shift,
        cashier_id: operatorId,
        waiter_id: operatorId,
        walk_in_name: `WEEKS ${STAMP} #${i + 1}`,
        payment_method: i % 10 < 7 ? 'cash' : 'card',
        items: [{ menu_item_id: item.id, item_name: item.name, quantity: qty, unit_price: price }]
      }).catch((e) => ({ success: false, error: String(e?.message || e) }))
      if (note(`sale-${i}`, res?.success && res?.id, res?.success ? '' : JSON.stringify(res)?.slice(0, 140))) {
        run.sales.push({ id: res.id, total: price * qty, method: i % 10 < 7 ? 'cash' : 'card', item })
      }
      if ((i + 1) % 500 === 0) console.log(`[weeks-stress] queued sales ${i + 1}/${N.sales}`)
      // Refresh the per-window Till session before the inactivity lease can
      // lapse mid-run (offline re-activate hits already-open, queues nothing).
      if ((i + 1) % 400 === 0) {
        await api(page, (arg) => window.api.pos.activateSharedTillOperator(arg), {
          staff_id: operatorId, outlet_id: run.outlet, pin: STAFF_PIN
        }).catch(() => null)
      }
    }

    // Tabs + settles offline.
    for (let i = 0; i < N.tabs; i += 1) {
      const tabRes = await api(page, (arg) => window.api.pos.saveTab(arg), {
        tab_name: `WEEKS Tab ${i} ${STAMP}`, outlet_id: run.outlet, customer_name: 'WEEKS Walk-in'
      }).catch((e) => ({ success: false, error: String(e?.message || e) }))
      const tabId = tabRes?.tab?.id || tabRes?.id
      if (note(`tab-${i}`, tabRes?.success !== false && tabId, JSON.stringify(tabRes)?.slice(0, 120))) {
        run.tabs.push(tabId)
        const item = sellable[i % sellable.length]
        const price = Number(item.price ?? item.unit_price ?? 0)
        const settle = await api(page, (arg) => window.api.pos.createOrder(arg), {
          outlet_id: run.outlet, shift_id: run.shift, tab_id: tabId, tab_name: `WEEKS Tab ${i} ${STAMP}`,
          service_mode: 'tab', payment_method: 'cash', cashier_id: operatorId, waiter_id: operatorId,
          items: [{ menu_item_id: item.id, item_name: item.name, quantity: 2, unit_price: price }]
        }).catch((e) => ({ success: false, error: String(e?.message || e) }))
        if (note(`settle-${i}`, settle?.success && settle?.id, JSON.stringify(settle)?.slice(0, 140))) {
          run.sales.push({ id: settle.id, total: price * 2, method: 'cash', item, tab: true })
        }
      }
    }

    // Admin PIN for voids/returns: set on self offline (queued), best effort.
    await api(page, (arg) => window.api.users.update(arg.id, { pin: arg.pin }), { id: run.me.id, pin: ADMIN_PIN }).catch(() => null)

    const voidTargets = run.sales.filter((_, i) => i % Math.max(1, Math.floor(run.sales.length / Math.max(1, N.voids))) === 0).slice(0, N.voids)
    for (const v of voidTargets) {
      const res = await api(page, (arg) => window.api.pos.approveVoidWithPin(arg), {
        order_id: v.id, pin: ADMIN_PIN, reason: 'WEEKS over-ring',
        cashier_user_id: run.staff[0]?.id || run.me.id, outlet_id: run.outlet
      }).catch((e) => ({ success: false, error: String(e?.message || e) }))
      note(`void-${String(v.id).slice(0, 8)}`, res?.success !== false, JSON.stringify(res)?.slice(0, 140))
      if (res?.success !== false) v.voided = true
    }
    const returnTargets = run.sales.filter((s) => !s.voided).filter((_, i) => i % Math.max(1, Math.floor(run.sales.length / Math.max(1, N.returns))) === 0).slice(0, N.returns)
    for (const r of returnTargets) {
      const res = await api(page, (arg) => window.api.pos.createPartialReturnWithPin(arg), {
        order_id: r.id, pin: ADMIN_PIN, reason: 'WEEKS spill',
        lines: [{ menu_item_id: r.item.id, quantity: 1 }],
        outlet_id: run.outlet, cashier_user_id: run.staff[0]?.id || run.me.id
      }).catch((e) => ({ success: false, error: String(e?.message || e) }))
      note(`return-${String(r.id).slice(0, 8)}`, res?.success !== false, JSON.stringify(res)?.slice(0, 160))
      if (res?.success !== false) r.returned = Math.min(r.total, Number(r.item.price ?? r.item.unit_price ?? 0))
    }

    for (let i = 0; i < Math.min(N.clockins, run.staff.length); i += 1) {
      const s = run.staff[i]
      const res = await api(page, (arg) => window.api.pos.clockInStaffWithAttendancePin(arg), {
        staff_user_id: s.id, pin: STAFF_PIN, role: 'cashier'
      }).catch((e) => ({ success: false, error: String(e?.message || e) }))
      note(`clockin-${i}`, res?.success !== false, JSON.stringify(res)?.slice(0, 140))
    }
    const cashup = await api(page, (arg) => window.api.pos.submitCashupWithAttendancePin(arg), {
      shift_id: run.shift, pin: STAFF_PIN, counted_by_method: { cash: 0 }, notes: `WEEKS ${STAMP}`
    }).catch((e) => ({ success: false, error: String(e?.message || e) }))
    note('cashup', cashup?.success !== false, JSON.stringify(cashup)?.slice(0, 160))

    const today = new Date().toISOString().slice(0, 10)
    for (let i = 0; i < N.expenses; i += 1) {
      const res = await api(page, (arg) => window.api.expenses.create(arg), {
        date: today, category: 'Supplies', description: `WEEKS expense ${i} ${STAMP}`,
        amount: 50 + i, outlet_id: run.outlet
      }).catch((e) => ({ success: false, error: String(e?.message || e) }))
      // Lounge plan gates expenses: record as skip, not failure.
      const gated = /subscription plan/i.test(JSON.stringify(res))
      if (gated && i === 0) console.log('[weeks-stress] expenses plan-gated on Lounge; recording skips')
      note(`expense-${i}`, res?.success !== false || gated, gated ? 'plan-gate-skip' : JSON.stringify(res)?.slice(0, 120))
    }

    // Stock receiving + adjustments offline (queued deliveries).
    // Operation ids must be UUIDs: the server casts p_operation_id to uuid
    // (see 51-op preflight dead-letter analysis). Stable queue identity comes
    // from the queue layer, not these strings.
    const stock = await api(page, () => window.api.inventory.getItems()).catch(() => [])
    const stockIds = (Array.isArray(stock) ? stock : []).filter((s) => s?.id).slice(0, 5).map((s) => s.id)
    for (let i = 0; i < N.deliveries; i += 1) {
      if (!stockIds.length) { note('delivery-no-stock', false, 'no inventory items'); break }
      const lines = stockIds.slice(0, 3).map((id, k) => ({ item_id: id, quantity: 10 + i + k }))
      const res = await api(page, (arg) => window.api.inventory.postBarSimpleDelivery(arg), {
        outlet_id: run.outlet, operation_id: randomUUID(),
        lines, notes: `WEEKS delivery ${i} ${STAMP}`
      }).catch((e) => ({ success: false, error: String(e?.message || e) }))
      note(`delivery-${i}`, res?.success !== false, JSON.stringify(res)?.slice(0, 140))
    }
    for (let i = 0; i < N.adjusts; i += 1) {
      if (!stockIds.length) { note('adjust-no-stock', false, 'no inventory items'); break }
      const res = await api(page, (arg) => window.api.inventory.adjustStock(arg.id, arg.delta, arg.notes, arg.pin, arg.key), {
        id: stockIds[0], delta: 5, notes: `WEEKS count ${i} ${STAMP}`, pin: ADMIN_PIN, key: randomUUID()
      }).catch((e) => ({ success: false, error: String(e?.message || e) }))
      note(`adjust-${i}`, res?.success !== false, JSON.stringify(res)?.slice(0, 140))
    }

    // --- 3. LEAVE QUEUED: verify growth, stay offline, hand back ---
    const queueAfter = await api(page, async () => (await window.api.sync.getDetails())?.pending?.length || 0).catch(() => 0)
    note('queue-grew', queueAfter - queueBefore >= N.sales, `before=${queueBefore} after=${queueAfter}`)
    const stillOff = await api(page, () => window.api.sync.getStatus()).catch(() => null)
    note('still-offline', stillOff?.isOnline === false, JSON.stringify(stillOff)?.slice(0, 100))
    console.log(`[weeks-stress] LEAVE QUEUED: stamp=WEEKS ${STAMP} staff=${run.staff.length} sales=${run.sales.length} tabs=${run.tabs.length} queueBefore=${queueBefore} queueAfter=${queueAfter}`)
    console.log(`[weeks-stress] To sync later: reopen the Lounge app online and run System Health sync. To clean up: filter WEEKS ${STAMP}.`)
    expect(failures, `weeks stress failures:\n${failures.join('\n')}`).toEqual([])
  } finally {
    await app.close().catch(() => {})
  }
})
