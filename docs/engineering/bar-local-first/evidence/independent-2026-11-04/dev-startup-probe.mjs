// Isolated headless browser: no user profile, real Electron IPC or external
// network. Reads only the currently running local development server.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
let executable = chromium.executablePath()
if (!fs.existsSync(executable) && process.env.LOCALAPPDATA) {
  const cache = path.join(process.env.LOCALAPPDATA, 'ms-playwright')
  const names = fs.existsSync(cache) ? fs.readdirSync(cache).filter(n => /^chromium_headless_shell-\d+$/.test(n)).sort((a,b) => Number(b.split('-').at(-1))-Number(a.split('-').at(-1))) : []
  for (const name of names) {
    const candidate = path.join(cache, name, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe')
    if (fs.existsSync(candidate)) { executable = candidate; break }
  }
}
if (!fs.existsSync(executable)) throw Error('No installed browser; no download attempted')
const browser = await chromium.launch({ headless: true, executablePath: executable })
const findings = { errors: [], failedRequests: [], failedResponses: [], startup: [], externalBlocked: 0 }
try {
  const page = await browser.newPage()
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (['localhost','127.0.0.1'].includes(url.hostname) && url.port === '5173') return route.continue()
    findings.externalBlocked += 1
    return route.abort()
  })
  await page.addInitScript(() => {
    window.api = {
      auth: { login: async () => { throw Error('Reviewer fixture: real login disabled') } },
      barLocal: {
        getStatus: async () => ({ authority_mode: 'cloud', configured: false, workspace_choice_required: true }),
        getChooserEntry: async () => ({ status: 'none', label: null, origin_profile_id: null }),
        rendererReady: async () => ({ ok: true })
      }
    }
  })
  page.on('pageerror', error => { if (findings.errors.length < 15) findings.errors.push(error.message) })
  page.on('requestfailed', req => { if (findings.failedRequests.length < 25) findings.failedRequests.push({ path: new URL(req.url()).pathname, error: req.failure()?.errorText }) })
  page.on('response', response => { if (response.status() >= 400 && findings.failedResponses.length < 25) findings.failedResponses.push({ status: response.status(), path: new URL(response.url()).pathname }) })
  page.on('console', msg => { if (msg.text().startsWith('[STARTUP]') && findings.startup.length < 15) findings.startup.push(msg.text().slice(0,400)) })
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForFunction(() => !document.querySelector('#root .startup-fallback'), { timeout: 20000 }).catch(() => {})
  findings.fallbackVisible = await page.locator('#root .startup-fallback').count() > 0
  findings.headings = await page.locator('h1').allTextContents()
  console.log(JSON.stringify(findings, null, 2))
} finally { await browser.close() }
