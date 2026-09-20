/** Bar test-property probe (gated): login as test account, dump post-login state. */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import { createTempUserDataDir, launchDesktopApp } from './support/desktop-app.mjs'

const RUN = process.env.BAR_STRESS_PROBE === '1'
test.setTimeout(300000)
test.skip(!RUN, 'probe requires BAR_STRESS_PROBE=1')
test.use({ trace: 'off', video: 'off', screenshot: 'off' })

const BAR_LODGE = 'b380ba5e-a761-4017-8515-4f1ff31785a7'

test('probe bar test-property login state', async () => {
  const userDataDir = createTempUserDataDir('bar-stress-probe-')
  const { app, window: page } = await launchDesktopApp({
    userDataDir,
    extraEnv: { BOROKO_PRODUCT: 'hospitality-pos', BOROKO_TEST_FORCE_OFFLINE: 'false' }
  })
  try {
    await page.evaluate(() => { window.location.hash = '#/login' })
    await page.waitForTimeout(6000)
    console.log(`[bar-probe] url=${page.url()}`)
    const dump = await page.evaluate(() => ({
      text: document.body.innerText.slice(0, 2000),
      inputs: [...document.querySelectorAll('input')].map((i) => `${i.type}|${i.placeholder || ''}|${i.getAttribute('data-testid') || ''}`),
      buttons: [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 20)
    }))
    console.log(`[bar-probe] screen: ${dump.text.replace(/\n+/g, ' | ')}`)
    console.log(`[bar-probe] inputs: ${JSON.stringify(dump.inputs)}`)
    console.log(`[bar-probe] buttons: ${dump.buttons.join(' || ').slice(0, 600)}`)
    const loginBtn = page.getByRole('button', { name: 'Log in', exact: true })
    if (await loginBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await loginBtn.click()
      await page.waitForTimeout(4000)
      console.log(`[bar-probe] after-login-click url=${page.url()}`)
      const dump2 = await page.evaluate(() => ({
        text: document.body.innerText.slice(0, 2000),
        inputs: [...document.querySelectorAll('input')].map((i) => `${i.type}|${i.placeholder || ''}|${i.getAttribute('data-testid') || ''}`),
        buttons: [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 20)
      }))
      console.log(`[bar-probe] screen2: ${dump2.text.replace(/\n+/g, ' | ')}`)
      console.log(`[bar-probe] inputs2: ${JSON.stringify(dump2.inputs)}`)
    }
    const email = process.env.LOUNGE_LOGIN_EMAIL || ''
    const password = process.env.LOUNGE_LOGIN_PASSWORD || ''
    expect(email && password, 'LOUNGE_LOGIN_EMAIL/PASSWORD env required').toBeTruthy()
    // Testid-based login form (no password value ever logged).
    await page.getByTestId('login-email-input').fill(email, { timeout: 30000 })
    await page.evaluate((pw) => {
      const inputs = [...document.querySelectorAll('input[type="password"]')]
      const last = inputs[inputs.length - 1]
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(last), 'value')?.set
        || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter.call(last, pw)
      last.dispatchEvent(new Event('input', { bubbles: true }))
      last.dispatchEvent(new Event('change', { bubbles: true }))
    }, password)
    await page.getByRole('button', { name: /Sign In/i }).first().click()
    // Login fans out to Supabase Auth + memberships + context + profile
    // bootstrap; poll for the chooser, an error, or the workspace.
    let settled = 'timeout'
    for (let i = 0; i < 30; i += 1) {
      await page.waitForTimeout(3000)
      const t = await page.evaluate(() => document.body.innerText.slice(0, 3000))
      if (/Botswapelo Bar/i.test(t)) { settled = 'chooser'; break }
      if (/not assigned|incorrect|failed|invalid|error|could not/i.test(t) && !/Signing in/i.test(t)) { settled = 'error'; break }
      if (!/Signing in/i.test(t) && /sync|pos|terminal|dashboard/i.test(t)) { settled = 'workspace'; break }
    }
    console.log(`[bar-probe] settled=${settled}`)
    await page.waitForTimeout(2000)
    const text = await page.evaluate(() => document.body.innerText.slice(0, 2500))
    console.log(`[bar-probe] url=${page.url()}`)
    console.log(`[bar-probe] screen: ${text.replace(/\n+/g, ' | ')}`)
    const buttons = await page.evaluate(() => [...document.querySelectorAll('button')]
      .map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 30).join(' || '))
    console.log(`[bar-probe] buttons: ${buttons.slice(0, 800)}`)
    // If a company chooser is showing, select Botswapelo Bar through real IPC.
    if (/Botswapelo Bar/i.test(text)) {
      const barBtn = page.getByRole('button', { name: /Botswapelo Bar/i }).first()
      if (await barBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await barBtn.click()
        await page.waitForTimeout(6000)
        const text2 = await page.evaluate(() => document.body.innerText.slice(0, 2500))
        console.log(`[bar-probe] after-choose: ${text2.replace(/\n+/g, ' | ').slice(0, 1200)}`)
      }
    }
    const active = await page.evaluate(async () => window.api.profiles.getActive())
    console.log(`[bar-probe] active-profile: ${JSON.stringify(active)?.slice(0, 300)}`)
    const session = await page.evaluate(async () => window.api.auth.restoreCurrentSession())
    console.log(`[bar-probe] session: ${session ? `ok ${session.email || session.name} lodge=${session.lodge_id}` : 'NULL'}`)
    void BAR_LODGE
  } finally {
    await app.close().catch(() => {})
  }
})
