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
import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router';import{AuthContext,SettingsContext}from'./src/renderer/src/app-context.jsx';import Purchasing from'./src/renderer/src/components/restaurant/RestaurantPurchasing.jsx';
window.__purchasingFixture={queries:[],cloud:[]};const scope={business_id:'11111111-1111-4111-8111-111111111111',outlet_id:'22222222-2222-4222-8222-222222222222',actor_staff_id:'33333333-3333-4333-8333-333333333333',device_id:'44444444-4444-4444-8444-444444444444'};const product='55555555-5555-4555-8555-555555555555',supplier='66666666-6666-4666-8666-666666666666',order='77777777-7777-4777-8777-777777777777',line='88888888-8888-4888-8888-888888888888';const bridge={async query(name,filters){window.__purchasingFixture.queries.push([name,filters]);let data=[];if(name==='stock.list')data=[{product_id:product,name:'Bottled water',track_stock:true,active:true,quantity:'12',unit:'bottle',unit_cost:'3.5',version:4,product_version:2}];if(name==='suppliers.list')data=[{supplier_id:supplier,name:'Local Supplier',contact_name:'A. Person',phone:'70000000',email:'supplier@example.test',active:true,version:3}];if(name==='purchase_orders.list')data=[{purchase_order_id:order,po_number:'PO-000001'}];if(name==='purchase_order.get')data={purchase_order_id:order,supplier:{supplier_id:supplier,name:'Local Supplier',email:'supplier@example.test'},status:'ordered',ordered_on:'2026-11-05',total:'42.00',lines:[{purchase_order_line_id:line,product_id:product,name_snapshot:'Bottled water',quantity_ordered:'12',quantity_received:'0',quantity_remaining:'12',unit_cost:'3.5',line_total:'42'}]};return{data,complete:true,unavailable:[],pagination:{has_more:false,next_cursor:null},scope,snapshot_watermark:9}},async readHposMenu(){return{rows:[],complete:true}},async command(){throw Error('unexpected local mutation')}};const cloudApi=new Proxy({}, {get(_t,key){window.__purchasingFixture.cloud.push(String(key));return()=>{throw Error('hosted purchasing accessed')}}});window.api={barLocal:bridge,pos:cloudApi,inventory:cloudApi};createRoot(document.getElementById('root')).render(<MemoryRouter><AuthContext.Provider value={{user:{id:scope.actor_staff_id,role:'manager',localAuthority:true,lodge_id:scope.business_id}}}><SettingsContext.Provider value={{settings:{authority_mode:'bar_local',property_type:'bar',lodge_id:scope.business_id,outlet_id:scope.outlet_id,currency:'BWP'}}}><Purchasing/></SettingsContext.Provider></AuthContext.Provider></MemoryRouter>);`

test('rendered original Purchasing screen reads local records and fences hosted mutations', {
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
  await page.getByText('Local Supplier').first().waitFor()
  await page.getByText('Purchase order', { exact: true }).waitFor()
  await page.getByText(/Supplier changes, purchase order creation\/approval\/receiving/).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Add supplier' }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'New purchase order' }).count(), 0)
  await page.getByRole('button', { name: 'View details' }).click()
  await page.getByText('Bottled water').last().waitFor()
  const result = await page.evaluate(() => window.__purchasingFixture)
  assert.deepEqual(result.queries.map(([name]) => name).sort(), ['purchase_order.get', 'purchase_orders.list', 'stock.list', 'suppliers.list'])
  assert.deepEqual(result.cloud, [])
  assert.deepEqual(errors, [])
})
