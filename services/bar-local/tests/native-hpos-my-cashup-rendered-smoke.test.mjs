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
import { AuthContext, SettingsContext } from './src/renderer/src/app-context.jsx'
import HposMyCashup from './src/renderer/src/components/hospitality-pos/HposMyCashup.jsx'

window.__handoverFixture = { submitted: false, commands: [] }
const scope = { business_id: 'business-1', outlet_id: 'outlet-1', actor_staff_id: 'cashier-1', role: 'cashier', device_id: 'device-1' }
const bridge = {
  async getOpenIntents() { return [] },
  async query(name) {
    if (name !== 'cashup.mine') throw new Error('Unexpected query ' + name)
    const submitted = window.__handoverFixture.submitted
    return { complete: true, unavailable: [], pagination: { has_more: false, next_cursor: null }, scope,
      snapshot_watermark: submitted ? 5 : 4, as_of: '2026-11-05T10:00:00.000Z', data: {
        shift: { id: 'shift-1', staff_id: 'cashier-1', version: submitted ? 4 : 3, status: submitted ? 'closed' : 'open', opening_float: '100.00' },
        submission: submitted ? { id: 'cashup-1', status: 'submitted', counted_by_method: { cash: '105.10' }, notes: 'Physical count' } : null
      } }
  },
  async command(request) {
    window.__handoverFixture.commands.push(request)
    window.__handoverFixture.submitted = true
    return { outcome: 'committed_local', result: { cashup_id: 'cashup-1', status: 'submitted' } }
  },
  async retryOperation() { throw new Error('This fixture has no saved handover') }
}
const rejectCloud = new Proxy({}, { get(_target, name) { throw new Error('Cloud API accessed: ' + String(name)) } })
window.api = { barLocal: bridge, pos: rejectCloud, outlets: rejectCloud }
createRoot(document.getElementById('root')).render(
  <AuthContext.Provider value={{ user: { id: 'cashier-1', name: 'Cashier One', localAuthority: true }, logout: async () => {} }}>
    <SettingsContext.Provider value={{ settings: { authority_mode: 'bar_local', outlet_id: 'outlet-1', outlet_name: 'Main Bar', currency: 'P', cash_model: 'personal' }, setSettings() {} }}>
      <HposMyCashup />
    </SettingsContext.Provider>
  </AuthContext.Provider>
)
`

test('rendered original My Cash-up submits an exact blind count through one atomic local command', {
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
  await page.getByRole('spinbutton', { name: 'Physical cash counted (P)' }).fill('105.10')
  await page.getByRole('textbox', { name: 'Cash-up note optional' }).fill('Physical count')
  await page.getByRole('button', { name: 'Submit cash-up for review' }).click()
  await page.getByText('Cash-up submitted for review', { exact: true }).waitFor()
  const commands = await page.evaluate(() => window.__handoverFixture.commands)
  assert.equal(commands.length, 1)
  assert.equal(commands[0].command, 'cashup.handover')
  assert.deepEqual(commands[0].payload, { shift_id: 'shift-1', expected_shift_version: 3, counted_cash: '105.10', notes: 'Physical count' })
  assert.match(commands[0].operation_id, /^[0-9a-f-]{36}$/i)
  assert.deepEqual(errors, [])
})
