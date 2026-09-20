/** Session restore probe (gated): select -> reload -> restore on a live copy. */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { launchDesktopApp } from './support/desktop-app.mjs'

const RUN = process.env.LOUNGE_PROBE === '1'
test.setTimeout(180000)
test.skip(!RUN, 'probe requires LOUNGE_PROBE=1')
test.use({ trace: 'off', video: 'off', screenshot: 'off' })

const LIVE_DESK = 'C:\\Users\\Botswapelo Studios\\AppData\\Roaming\\Tsa Bonno Restaurant & Bar POS Dev Desk'
const LODGE = '45f21c52-a095-4031-a06c-bd1717865ebd'

function copyLiveProfile() {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'lounge-probe-'))
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

test('probe session restore order', async () => {
  const userDataDir = copyLiveProfile()
  const { app, window: page } = await launchDesktopApp({
    userDataDir,
    extraEnv: { BOROKO_PRODUCT: 'hospitality-pos', BOROKO_TEST_FORCE_OFFLINE: 'true', BOROKO_AUTH_TRACE: '1' }
  })
  const authLines = []
  try {
    const proc = typeof app.process === 'function' ? app.process() : null
    proc?.stdout?.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.includes('AUTH')) authLines.push(line.slice(0, 300))
      }
    })
  } catch { /* best effort */ }
  try {
    const active1 = await page.evaluate(async () => window.api.profiles.getActive())
    console.log(`[probe] active-before-select: ${JSON.stringify(active1)?.slice(0, 200)}`)
    const selected = await page.evaluate(async (id) => window.api.profiles.select(id), LODGE)
    console.log(`[probe] select ok: ${selected?.success}`)
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    const active2 = await page.evaluate(async () => window.api.profiles.getActive())
    console.log(`[probe] active-after-reload: ${JSON.stringify(active2)?.slice(0, 200)}`)
    const restored = await page.evaluate(async () => window.api.auth.restoreCurrentSession())
    console.log(`[probe] restore: ${restored ? `ok ${restored.email} ${restored.role}` : 'NULL'}`)
    await new Promise((r) => setTimeout(r, 1500))
    console.log(`[probe] auth-trace:\n${authLines.slice(-12).join('\n') || '(no AUTH lines captured)'}`)
    expect(restored).toBeTruthy()
  } finally {
    await app.close().catch(() => {})
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
})
