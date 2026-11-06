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
import { MemoryRouter, Route, Routes } from 'react-router'
import { AuthContext, SettingsContext, AccessContext } from './src/renderer/src/app-context.jsx'
import HposLayout from './src/renderer/src/components/hospitality-pos/HposLayout.jsx'

window.__managePinCalls = []
window.api = { barLocal: { verifyManagerPin: async (request) => {
  window.__managePinCalls.push(request)
  return request.staff_id === 'owner-staff-id' && request.pin === '123456789012'
    ? { success: true, verified: true }
    : { success: false, error: 'Local manager PIN verification failed.' }
} } }
function App() {
  return <AuthContext.Provider value={{ user: { id: 'owner-staff-id', name: 'Local Owner', role: 'owner', localAuthority: true }, login: async () => {}, logout: async () => {} }}>
    <SettingsContext.Provider value={{ settings: { authority_mode: 'bar_local', property_type: 'bar', hospitality_mode: 'bar_only', currency: 'BWP' }, setSettings() {} }}>
      <AccessContext.Provider value={{ capabilities: { 'pos.view': true, 'pos.manage': true, 'staff.manage': true }, effectiveCapabilities: { 'pos.view': true, 'pos.manage': true, 'staff.manage': true }, entitlement: { product_id: 'hospitality-pos', commercial_package_key: 'bar_pos', enterprise_addons: [] }, allowedOutletIds: [], refreshEntitlement: async () => ({}) }}>
        <MemoryRouter initialEntries={['/hpos/manage']}><Routes><Route element={<HposLayout />}><Route path='/hpos/manage' element={<h1>Manage home</h1>} /></Route></Routes></MemoryRouter>
      </AccessContext.Provider>
    </SettingsContext.Provider>
  </AuthContext.Provider>
}
createRoot(document.getElementById('root')).render(<App />)
`

test('rendered local Manage accepts the unchanged 12-digit owner setup PIN and verifies the owner identity', {
  timeout: 60000,
  skip: !browserExecutable && 'No installed Chromium found; this smoke never downloads a browser.'
}, async (t) => {
  const bundle = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false,
    platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.png': 'dataurl' }, define: { 'process.env.NODE_ENV': '"development"' }
  })
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
  t.after(() => browser.close())
  const page = await browser.newPage()
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const server = createServer((req, res) => {
    if (req.url !== '/') { res.writeHead(404).end(); return }
    res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections()
    return new Promise((resolve) => server.close(resolve))
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const pin = page.getByRole('textbox', { name: 'Manager PIN' })
  await pin.waitFor()
  await pin.fill('123456789012')
  assert.equal(await pin.inputValue(), '123456789012')
  await page.getByRole('button', { name: 'Unlock Manage' }).click()
  await page.getByRole('heading', { name: 'Manage home' }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.__managePinCalls), [{ staff_id: 'owner-staff-id', pin: '123456789012' }])
  assert.deepEqual(errors, [])
})
