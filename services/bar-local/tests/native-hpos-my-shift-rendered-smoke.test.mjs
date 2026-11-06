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
import HposMyShift from './src/renderer/src/components/hospitality-pos/HposMyShift.jsx'

window.__shiftFixture = { opened: false, calls: [] }
const scope = { business_id: 'business-1', outlet_id: 'outlet-1', actor_staff_id: 'cashier-1', role: 'cashier', device_id: 'device-1' }
const bridge = {
  async getOpenIntents() { return [] },
  async query(name, filters) {
    window.__shiftFixture.calls.push(['query', name, filters])
    if (name !== 'cashup.mine') throw new Error('Unexpected query ' + name)
    return { complete: true, unavailable: [], pagination: { has_more: false, next_cursor: null }, scope,
      snapshot_watermark: window.__shiftFixture.opened ? 2 : 1, as_of: '2026-11-05T10:00:00.000Z', data: {
        shift: window.__shiftFixture.opened ? { id: 'shift-1', staff_id: 'cashier-1', status: 'open', version: 1,
          opening_float: '25.50', opened_at: '2026-11-05T10:00:00.000Z', business_date: '2026-11-05' } : null,
        submission: null
      } }
  },
  async command(request) {
    window.__shiftFixture.calls.push(['command', request])
    window.__shiftFixture.opened = true
    return { outcome: 'committed_local', result: { status: 'open' } }
  },
  async retryOperation() { throw new Error('No saved operation in this fixture') }
}
const rejectCloud = new Proxy({}, { get(_target, name) { throw new Error('Cloud API accessed: ' + String(name)) } })
window.api = { barLocal: bridge, pos: rejectCloud, outlets: rejectCloud }
const access = { capabilities: { 'pos.manage': true }, effectiveCapabilities: { 'pos.manage': true }, entitlement: { enterprise_addons: [] } }
createRoot(document.getElementById('root')).render(
  <AuthContext.Provider value={{ user: { id: 'cashier-1', name: 'Cashier One', role: 'cashier', localAuthority: true }, logout: async () => {} }}>
    <SettingsContext.Provider value={{ settings: { authority_mode: 'bar_local', hospitality_mode: 'bar_only', outlet_id: 'outlet-1', outlet_name: 'Main Bar', currency: 'P', cash_model: 'personal' }, setSettings() {} }}>
      <AccessContext.Provider value={access}><HposMyShift localAuthority /></AccessContext.Provider>
    </SettingsContext.Provider>
  </AuthContext.Provider>
)
`

test('rendered original My Shift reads and opens a shift through the local database only', {
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
  await page.getByRole('spinbutton', { name: 'Opening cash float' }).fill('25.50')
  await page.getByRole('button', { name: 'Start my shift' }).click()
  await page.getByText('Your shift was opened by the local Bar database.', { exact: false }).waitFor()
  const calls = await page.evaluate(() => window.__shiftFixture.calls)
  assert.equal(calls.filter(([kind]) => kind === 'command').length, 1)
  const command = calls.find(([kind]) => kind === 'command')[1]
  assert.equal(command.command, 'shift.open')
  assert.deepEqual(command.payload, { opening_float: '25.50' })
  assert.match(command.operation_id, /^[0-9a-f-]{36}$/i)
  assert.ok(calls.filter(([kind]) => kind === 'query').every(([, name]) => name === 'cashup.mine'))
  assert.deepEqual(errors, [])
})
