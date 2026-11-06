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
import { MemoryRouter } from 'react-router'
import { AccessContext, AuthContext, SettingsContext } from './src/renderer/src/app-context.jsx'
import HposTeam from './src/renderer/src/components/hospitality-pos/HposTeam.jsx'

window.__teamFixture = { queries: [], commands: [] }
const scope = { business_id: 'business-1', outlet_id: 'outlet-1', actor_staff_id: 'manager-1', role: 'manager', device_id: 'device-1' }
const bridge = {
  async query(name, filters) {
    window.__teamFixture.queries.push([name, filters])
    const data = name === 'staff.list'
      ? [{ staff_id: 'manager-1', display_name: 'Manager One', role: 'manager', status: 'active', version: 1 },
          { staff_id: 'cashier-1', display_name: 'Cashier One', role: 'cashier', status: 'active', version: 1 }]
      : [{ attendance_id: 'attendance-1', staff_id: 'cashier-1', display_name: 'Cashier One', staff_role: 'cashier',
          clocked_in_at: '2026-11-05T08:00:00Z', status: 'open' }]
    return { data, complete: true, pagination: { has_more: false, next_cursor: null }, scope,
      snapshot_watermark: 1, as_of: '2026-11-05T10:00:00.000Z', unavailable: [] }
  },
  async command(intent) {
    window.__teamFixture.commands.push(intent)
    return { success: true, outcome: 'committed_local' }
  }
}
const rejectCloud = new Proxy({}, { get(_target, name) { throw new Error('Cloud API accessed: ' + String(name)) } })
window.api = { barLocal: bridge, pos: rejectCloud, outlets: rejectCloud }
const access = { capabilities: { 'pos.manage': true, 'staff.manage': true }, effectiveCapabilities: { 'pos.manage': true, 'staff.manage': true }, entitlement: { enterprise_addons: [] } }
createRoot(document.getElementById('root')).render(
  <MemoryRouter><AuthContext.Provider value={{ user: { id: 'manager-1', name: 'Manager One', role: 'manager', localAuthority: true }, logout: async () => {} }}>
    <SettingsContext.Provider value={{ settings: { authority_mode: 'bar_local', hospitality_mode: 'bar_only', outlet_id: 'outlet-1', outlet_name: 'Main Bar' }, setSettings() {} }}>
      <AccessContext.Provider value={access}><HposTeam /></AccessContext.Provider>
    </SettingsContext.Provider>
  </AuthContext.Provider></MemoryRouter>
)
`

test('rendered original Team board reads local attendance and commits clock actions only through local authority', {
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
  await page.locator('.hpos-shift-person strong').filter({ hasText: 'Cashier One' }).waitFor()
  await page.getByLabel('Staff member').waitFor()
  await page.getByLabel('Staff member').selectOption('cashier-1')
  await page.getByRole('button', { name: 'Clock in' }).click()
  await page.getByRole('button', { name: 'Clock out' }).click()
  await page.getByRole('button', { name: 'Clock out', exact: true }).last().click()
  const commands = await page.evaluate(() => window.__teamFixture.commands)
  assert.equal(commands[0].command, 'workforce.clock.in')
  assert.equal(commands[0].payload.staff_id, 'cashier-1')
  assert.equal(commands[1].command, 'workforce.clock.out')
  assert.equal(commands[1].payload.attendance_id, 'attendance-1')
  assert.ok(commands.every((command) => command.operation_id))
  assert.deepEqual([...new Set(await page.evaluate(() => window.__teamFixture.queries.map(([name]) => name)))].sort(), ['staff.list', 'workforce.attendance.current'])
  assert.deepEqual(errors, [])
})
