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
  for (const name of readdirSync(cache).filter(x => /^chromium_headless_shell-\d+$/.test(x)).sort((a, b) => Number(b.split('-').at(-1)) - Number(a.split('-').at(-1)))) {
    const candidate = join(cache, name, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe')
    if (existsSync(candidate)) return candidate
  }
  return ''
})()

const entry = `
import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router';import{AuthContext,SettingsContext}from'./src/renderer/src/app-context.jsx';import Lots from'./src/renderer/src/components/restaurant/RestaurantInventoryLots.jsx';
window.__lotsFixture={queries:[],cloud:[]};const scope={business_id:'11111111-1111-4111-8111-111111111111',outlet_id:'22222222-2222-4222-8222-222222222222',actor_staff_id:'33333333-3333-4333-8333-333333333333',device_id:'44444444-4444-4444-8444-444444444444'};const product='55555555-5555-4555-8555-555555555555';const bridge={async query(name,filters){window.__lotsFixture.queries.push([name,filters]);const data=name==='stock.list'?[{product_id:product,name:'Bottled water',track_stock:true,quantity:'12',version:4}]:[{movement_id:'66666666-6666-4666-8666-666666666666',product_id:product,name:'Bottled water',lot_code:'BATCH-1',expires_on:'2026-11-12',received_quantity:'6.00',unit_cost:'3.50',reason:'purchase.receive'}];return{data,complete:true,unavailable:[],pagination:{has_more:false,next_cursor:null},scope,snapshot_watermark:9}},async readHposMenu(){return{rows:[],complete:true}},async command(){throw Error('unexpected mutation')}};const cloudApi=new Proxy({}, {get(_t,key){window.__lotsFixture.cloud.push(String(key));return()=>{throw Error('hosted workflow accessed')}}});window.api={barLocal:bridge,inventory:cloudApi,pos:cloudApi};createRoot(document.getElementById('root')).render(<MemoryRouter><AuthContext.Provider value={{user:{id:scope.actor_staff_id,role:'manager',localAuthority:true,lodge_id:scope.business_id}}}><SettingsContext.Provider value={{settings:{authority_mode:'bar_local',property_type:'bar',lodge_id:scope.business_id,outlet_id:scope.outlet_id,currency:'BWP'}}}><Lots/></SettingsContext.Provider></AuthContext.Provider></MemoryRouter>);`

test('rendered original Lots & Expiry screen shows local history without hosted actions', {
  timeout: 60000,
  skip: !browserExecutable && 'No installed Chromium found; this smoke never downloads a browser.'
}, async (t) => {
  const bundle = await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } })
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
  t.after(() => browser.close())
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByText('Bottled water').waitFor().catch(async () => { throw new Error(`${await page.locator('body').innerText()} | ${errors.join('; ')}`) })
  await page.getByText(/does not allocate sales to lots or track remaining quantity by lot/).waitFor()
  await page.getByText(/6.00 received \(balance by lot unavailable\)/).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Register lot' }).count(), 0)
  assert.equal(await page.getByRole('button', { name: /Correct expiry/ }).count(), 0)
  assert.equal(await page.getByRole('button', { name: /Write off/ }).count(), 0)
  const result = await page.evaluate(() => window.__lotsFixture)
  assert.deepEqual(result.queries.map(([name]) => name).sort(), ['stock.list', 'stock.lot_expiry'])
  assert.deepEqual(result.cloud, [])
  assert.deepEqual(errors, [])
})
