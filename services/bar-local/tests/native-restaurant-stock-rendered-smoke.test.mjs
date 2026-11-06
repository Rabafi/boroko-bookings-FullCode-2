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
import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router';import{AccessContext,AuthContext,SettingsContext}from'./src/renderer/src/app-context.jsx';import Stock from'./src/renderer/src/components/restaurant/RestaurantStock.jsx';
window.__stockFixture={queries:[],commands:[],cloud:[]};const scope={business_id:'11111111-1111-4111-8111-111111111111',outlet_id:'22222222-2222-4222-8222-222222222222',actor_staff_id:'33333333-3333-4333-8333-333333333333',device_id:'44444444-4444-4444-8444-444444444444'};const product='55555555-5555-4555-8555-555555555555';const bridge={async query(name,filters){window.__stockFixture.queries.push([name,filters]);const data=name==='stock.list'?[{product_id:product,name:'Bottled water',category:'Beverages',unit:'bottle',track_stock:true,active:true,quantity:'12.00',version:4,product_version:2,reorder_level:'5.00',unit_cost:'3.50'}]:name==='stock.history'&&filters.counts_only?[]:[];return{data,complete:true,unavailable:[],pagination:{has_more:false,next_cursor:null},scope,snapshot_watermark:9}},async readHposMenu(kind){if(kind!=='stock')throw Error('unexpected menu read');return{rows:[{id:product,name:'Bottled water',category:'Beverages',unit:'bottle',current_stock:'12.00',is_active:true,track_stock:true,reorder_level:'5.00',latest_unit_cost:'3.50',product_version:2,stock_version:4,updated_at:'4',outlet_id:scope.outlet_id}],complete:true,snapshot:'9|'+scope.business_id+'|'+scope.outlet_id}},async getOpenIntents(){return[]},async command(request){window.__stockFixture.commands.push(request);return{outcome:'committed_local',operation_id:request.operation_id,result:{product_id:product}}}};window.api={barLocal:bridge,inventory:new Proxy({}, {get(_t,key){window.__stockFixture.cloud.push(String(key));return()=>{throw Error('cloud inventory accessed')}}})};const access={role:'manager',capabilities:{'inventory.view':true,'inventory.manage':true},effectiveCapabilities:{'inventory.view':true,'inventory.manage':true},features:{},entitlement:{enterprise_addons:['bar_stock_purchasing_pro']}};createRoot(document.getElementById('root')).render(<MemoryRouter><AuthContext.Provider value={{user:{id:scope.actor_staff_id,role:'manager',localAuthority:true,lodge_id:scope.business_id}}}><SettingsContext.Provider value={{settings:{authority_mode:'bar_local',property_type:'bar',lodge_id:scope.business_id,outlet_id:scope.outlet_id,currency:'BWP'}}}><AccessContext.Provider value={access}><Stock/></AccessContext.Provider></SettingsContext.Provider></AuthContext.Provider></MemoryRouter>);`

test('rendered original Stock Pro reads and creates through local authority only', {
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
  await page.getByRole('cell', { name: /Bottled water/ }).waitFor()
  await page.getByText(/Stock Pro reads and changes inventory in the local Bar database/).waitFor()
  assert.equal(await page.getByRole('button', { name: /Start stocktake/ }).count(), 0)
  await page.getByRole('button', { name: /Add inventory item/ }).click()
  await page.getByLabel('Item name').fill('Glass water')
  await page.getByLabel('Stock category').selectOption('Beverages')
  await page.getByLabel('Opening stock').fill('6')
  await page.getByRole('button', { name: 'Create inventory item' }).click()
  await page.getByText(/Inventory item created in the local Bar database/).waitFor()
  const result = await page.evaluate(() => window.__stockFixture)
  assert.equal(result.commands.length, 1)
  assert.equal(result.commands[0].command, 'catalogue.stock_item.save')
  assert.equal(result.commands[0].payload.opening_stock, '6')
  assert.deepEqual(result.cloud, [])
  assert.deepEqual(errors, [])
})
