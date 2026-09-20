/**
 * One-shot Lounge publication sweep (gated, operator-requested recovery).
 *
 * LOUNGE_PUBLISH_SWEEP=1. Credentials env-only. No trace/video/screenshots.
 * Does exactly what the Products "Retry this save" button does for pending
 * publications: processPendingPublications([Bar outlet]), then verifies the
 * GranPa request flipped to published. No sales, users, products, or sync.
 */
import { test, expect } from '@playwright/test'
import { launchDesktopApp } from './support/desktop-app.mjs'

const RUN = process.env.LOUNGE_PUBLISH_SWEEP === '1'
test.setTimeout(600000)
test.skip(!RUN, 'requires LOUNGE_PUBLISH_SWEEP=1')
test.use({ trace: 'off', video: 'off', screenshot: 'off' })

const LIVE_DESK = 'C:\\Users\\Botswapelo Studios\\AppData\\Roaming\\Tsa Bonno Restaurant & Bar POS Dev Desk'
const LODGE = '45f21c52-a095-4031-a06c-bd1717865ebd'
const OUTLET_BAR = 'c0b07cea-941b-4561-bcb4-2f01d7d16af6'

const api = (page, fn, arg) => page.evaluate(fn, arg)

test('publish pending Bar catalog (GranPa recovery)', async () => {
  const email = process.env.LOUNGE_LOGIN_EMAIL || ''
  const password = process.env.LOUNGE_LOGIN_PASSWORD || ''
  if (!email || !password) throw new Error('LOUNGE_LOGIN_EMAIL/PASSWORD env required')
  const { app, window: page } = await launchDesktopApp({
    userDataDir: LIVE_DESK,
    extraEnv: { BOROKO_PRODUCT: 'hospitality-pos', BOROKO_TEST_FORCE_OFFLINE: 'false' }
  })
  try {
    await api(page, (id) => window.api.profiles.select(id), LODGE).catch(() => null)
    await page.waitForTimeout(3000)
    let s = await api(page, () => window.api.auth.restoreCurrentSession()).catch(() => null)
    if (!(s && (s.lodge_id === LODGE || s.lodgeId === LODGE))) {
      const loginRes = await api(page, (arg) => window.api.auth.login(arg.email, arg.password, arg.lodge), { email, password, lodge: LODGE })
        .catch((e) => ({ success: false, error: String(e?.message || e) }))
      console.log(`[sweep] ipc-login ${JSON.stringify(loginRes)?.slice(0, 120)}`)
      for (let i = 0; i < 20; i += 1) {
        await page.waitForTimeout(3000)
        s = await api(page, () => window.api.auth.restoreCurrentSession()).catch(() => null)
        if (s && (s.lodge_id === LODGE || s.lodgeId === LODGE)) break
      }
    }
    console.log(`[sweep] session ${s ? s.email : 'NULL'}`)
    expect(s && (s.lodge_id === LODGE || s.lodgeId === LODGE)).toBe(true)

    const before = await api(page, () => window.api.pos.getProductRequestStatus()).catch((e) => ({ error: String(e?.message || e) }))
    const pendingBefore = (before?.requests || []).filter((r) => r?.publication && r.publication !== 'published')
    console.log(`[sweep] pending publications before=${pendingBefore.length}: ${pendingBefore.map((r) => `${r.name}:${r.publication}`).join(' | ').slice(0, 400)}`)

    const sweep = await api(page, (outlet) => window.api.pos.processPendingPublications([outlet]), OUTLET_BAR)
      .catch((e) => ({ success: false, error: String(e?.message || e) }))
    console.log(`[sweep] result ${JSON.stringify(sweep)?.slice(0, 500)}`)

    const after = await api(page, () => window.api.pos.getProductRequestStatus()).catch((e) => ({ error: String(e?.message || e) }))
    const pendingAfter = (after?.requests || []).filter((r) => r?.publication && r.publication !== 'published')
    console.log(`[sweep] pending publications after=${pendingAfter.length}: ${pendingAfter.map((r) => `${r.name}:${r.publication}`).join(' | ').slice(0, 400)}`)
    const granpa = (after?.requests || []).find((r) => String(r?.name || '').toLowerCase().includes('granpa'))
    console.log(`[sweep] granpa request ${granpa ? `${granpa.state}/${granpa.publication}` : 'not-listed (published, retired from list)'}`)

    const menu = await api(page, () => window.api.pos.getMenuItems()).catch(() => [])
    const granpaMenu = (Array.isArray(menu) ? menu : []).find((m) => String(m?.name || '').toLowerCase() === 'granpa')
    console.log(`[sweep] till menu granpa ${granpaMenu ? `present id=${granpaMenu.id} price=${granpaMenu.price ?? granpaMenu.unit_price}` : 'ABSENT'}`)
    expect(pendingAfter.length).toEqual(0)
  } finally {
    await app.close().catch(() => {})
  }
})
