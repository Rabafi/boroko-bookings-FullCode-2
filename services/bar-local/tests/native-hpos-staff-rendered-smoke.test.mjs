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
import { AccessContext, AuthContext, FeaturesContext, SettingsContext } from './src/renderer/src/app-context.jsx'
import Staff from './src/renderer/src/components/Staff.jsx'
window.__staffFixture = { queries: [], commands: [], cloudCalls: [] }
const scope = { business_id: '11111111-1111-4111-8111-111111111111', outlet_id: '22222222-2222-4222-8222-222222222222', actor_staff_id: '33333333-3333-4333-8333-333333333333' }
const rows = [{ staff_id: '44444444-4444-4444-8444-444444444444', display_name: 'Sam Cashier', role: 'cashier', status: 'active', version: 1, capabilities: ['pos.view'] }]
const bridge = {
 async query(name, filters) { window.__staffFixture.queries.push([name, filters]); return { data: rows, complete: true, pagination: { has_more: false, next_cursor: null }, scope, snapshot_watermark: 2 } },
 async command(intent) { window.__staffFixture.commands.push(intent); rows.push({ staff_id: '55555555-5555-4555-8555-555555555555', display_name: intent.payload.display_name, role: intent.payload.role, status: 'active', version: 1, capabilities: ['pos.view'] }); return { outcome: 'committed_local' } },
 async retryOperation(operationId) { return { outcome: 'committed_local', operationId } }
}
window.api = { barLocal: bridge, get users() { window.__staffFixture.cloudCalls.push('users'); throw new Error('cloud users IPC accessed') }, get usage() { window.__staffFixture.cloudCalls.push('usage'); throw new Error('cloud usage IPC accessed') }, get outlets() { window.__staffFixture.cloudCalls.push('outlets'); throw new Error('cloud outlets IPC accessed') } }
const access = { role: 'manager', capabilities: { 'staff.manage': true, 'staff.view': true }, effectiveCapabilities: { 'staff.manage': true, 'staff.view': true }, features: {}, entitlement: { plan: 'Pro', enterprise_addons: [] } }
createRoot(document.getElementById('root')).render(
 <MemoryRouter><AuthContext.Provider value={{ user: { id: scope.actor_staff_id, name: 'Manager One', role: 'manager', localAuthority: true }, logout: async () => {} }}>
  <SettingsContext.Provider value={{ settings: { authority_mode: 'bar_local', property_type: 'bar', hospitality_mode: 'bar_only', lodge_id: scope.business_id, outlet_id: scope.outlet_id, outlet_name: 'Main Bar' }, setSettings() {} }}>
   <AccessContext.Provider value={access}><FeaturesContext.Provider value={{}}><Staff /></FeaturesContext.Provider></AccessContext.Provider>
  </SettingsContext.Provider>
 </AuthContext.Provider></MemoryRouter>
)
`

test('rendered original Staff page creates identities through local authority and hides cloud account actions', {
  timeout: 60000,
  skip: !browserExecutable && 'No installed Chromium found; this smoke never downloads a browser.'
}, async (t) => {
 const bundle = await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false,
   platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } })
 const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
 t.after(() => browser.close())
 const page = await browser.newPage(); page.setDefaultTimeout(10000)
 const errors=[]; page.on('pageerror', error => errors.push(error.message))
 const server=createServer((_req,res)=>res.writeHead(200,{'content-type':'text/html'}).end(`<!doctype html><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`))
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve))})
 await page.goto(`http://127.0.0.1:${server.address().port}`)
 await page.getByText('Sam Cashier').waitFor()
 assert.equal(await page.getByRole('button',{name:'Service roles & access'}).count(),0)
 assert.equal(await page.getByRole('button',{name:'Access audit'}).count(),0)
 assert.equal(await page.getByRole('button',{name:'Edit'}).count(),0)
 assert.equal(await page.getByRole('button',{name:/Reset Password/}).count(),0)
 assert.equal(await page.getByText(/Staff ID: 44444444/).count(),1)
 await page.getByRole('button',{name:'Add Staff'}).click()
 await page.locator('#staff-member-form input').nth(0).fill('New Cashier')
 await page.locator('#staff-member-form input').nth(1).fill('1234')
 await page.locator('button[form=\"staff-member-form\"]').click()
 const result=await page.evaluate(()=>({commands:window.__staffFixture.commands,cloudCalls:window.__staffFixture.cloudCalls}))
 assert.equal(result.commands.length,1)
 assert.equal(result.commands[0].command,'staff.create')
 assert.equal(result.commands[0].payload.display_name,'New Cashier')
 assert.equal(result.commands[0].payload.pin,'1234')
 assert.ok(result.commands[0].operation_id)
 assert.deepEqual(result.cloudCalls,[])
 assert.deepEqual(errors,[])
})

