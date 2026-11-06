import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { chromium } from 'playwright'
import esbuild from 'esbuild'

const root = process.cwd()
const cache = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : ''
const browserExecutable = process.env.BAR_LOCAL_CHROMIUM_EXECUTABLE_PATH || (() => {
  if (existsSync(chromium.executablePath())) return chromium.executablePath()
  if (!cache || !existsSync(cache)) return ''
  for (const name of readdirSync(cache).filter((entry) => /^chromium_headless_shell-\d+$/.test(entry)).sort((a, b) => Number(b.split('-').at(-1)) - Number(a.split('-').at(-1)))) {
    const candidate = join(cache, name, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe')
    if (existsSync(candidate)) return candidate
  }
  return ''
})()

const entry = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { AccessContext, AuthContext, SettingsContext } from './src/renderer/src/app-context.jsx'
import HposCustomers from './src/renderer/src/components/hospitality-pos/HposCustomers.jsx'

window.__customerFixture = { queries: [], commands: [] }
const scope = { business_id: 'business-1', outlet_id: 'outlet-1', actor_staff_id: 'manager-1', role: 'manager', device_id: 'device-1' }
const bridge = {
  async query(name, filters) {
    window.__customerFixture.queries.push([name, filters])
    return { data: [], complete: true, unavailable: [], pagination: { has_more: false, next_cursor: null }, scope, snapshot_watermark: 3, as_of: '2026-11-05T10:00:00.000Z' }
  },
  async command(request) { window.__customerFixture.commands.push(request); return { outcome: 'committed_local', result: { customer_id: 'customer-1' } } }
}
const rejectCloud = new Proxy({}, { get(_target, name) { throw new Error('Cloud API accessed: ' + String(name)) } })
window.api = { barLocal: bridge, pos: rejectCloud }
const access = { capabilities: { 'customers.manage': true }, effectiveCapabilities: { 'customers.manage': true }, entitlement: { enterprise_addons: [] } }
createRoot(document.getElementById('root')).render(
  <AuthContext.Provider value={{ user: { id: 'manager-1', name: 'Manager One', role: 'manager', localAuthority: true }, logout: async () => {} }}>
    <SettingsContext.Provider value={{ settings: { authority_mode: 'bar_local', hospitality_mode: 'bar_only', currency: 'BWP' }, setSettings() {} }}>
      <AccessContext.Provider value={access}><HposCustomers /></AccessContext.Provider>
    </SettingsContext.Provider>
  </AuthContext.Provider>
)
`

test('rendered original Customers creates a local customer without hosted or unsupported fields', {
  timeout: 60000,
  skip: !browserExecutable && 'No installed Chromium found; this smoke never downloads a browser.'
}, async (t) => {
  const bundle = await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true,
    write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } })
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
  t.after(() => browser.close())
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)) })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('button', { name: 'Add customer' }).click()
  await page.getByLabel('Name').fill('Local Guest')
  await page.getByLabel('Phone').fill('+26770000000')
  await page.getByRole('button', { name: 'Save customer' }).click()
  await page.getByText('Customer account saved in the local Bar database.').waitFor()
  const result = await page.evaluate(() => window.__customerFixture)
  assert.equal(result.commands.length, 1)
  assert.equal(result.commands[0].command, 'customer.create')
  assert.deepEqual(result.commands[0].payload, { name: 'Local Guest', phone: '+26770000000' })
  assert.equal(result.queries.every(([name]) => name === 'customers.list'), true)
  assert.deepEqual(errors, [])
})
