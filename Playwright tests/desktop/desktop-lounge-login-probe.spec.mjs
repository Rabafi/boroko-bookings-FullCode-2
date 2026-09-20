/** Live login probe via real UI buttons (gated). */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { launchDesktopApp } from './support/desktop-app.mjs'

const RUN = process.env.LOUNGE_PROBE === '1'
test.setTimeout(300000)
test.skip(!RUN, 'probe requires LOUNGE_PROBE=1')
test.use({ trace: 'off', video: 'off', screenshot: 'off' })

const LIVE_DESK = 'C:\\Users\\Botswapelo Studios\\AppData\\Roaming\\Tsa Bonno Restaurant & Bar POS Dev Desk'
const LODGE = '45f21c52-a095-4031-a06c-bd1717865ebd'

function copyLiveProfile() {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'lounge-login-probe-'))
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

test('probe live login via UI', async () => {
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
        if (/auth|login|signin|session/i.test(line)) authLines.push(line.slice(0, 500))
      }
    })
  } catch { /* best effort */ }
  try {
    await page.evaluate(async (id) => window.api.profiles.select(id), LODGE)
    await page.evaluate(() => { window.location.hash = '#/login' })
    await page.getByTestId('login-email-input').fill(process.env.LOUNGE_LOGIN_EMAIL || '')
    await page.getByTestId('login-password-input').fill(process.env.LOUNGE_LOGIN_PASSWORD || '')
    await page.getByTestId('login-submit-button').click()
    const sidebar = await page.getByTestId('sidebar-sync-panel')
      .waitFor({ state: 'visible', timeout: 90000 })
      .then(() => true)
      .catch(() => false)
    console.log(`[probe] sidebar-visible: ${sidebar}`)
    const text = await page.evaluate(() => document.body.innerText.slice(0, 1500))
    console.log(`[probe] screen-text:\n${text}`)
    await new Promise((r) => setTimeout(r, 1000))
    console.log(`[probe] auth-lines:\n${authLines.slice(-20).join('\n') || '(none)'}`)
    expect(sidebar).toBe(true)
  } finally {
    await app.close().catch(() => {})
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
})
