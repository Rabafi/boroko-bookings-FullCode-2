import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import test from 'node:test'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { getCommand } from '../../packages/bar-contracts/dist/index.js'

test('Modern local purchasing submits manager-approved orders through the local command callback', { timeout: 90000 }, async () => {
  const component = fileURLToPath(new URL('../../src/renderer/src/components/hospitality-pos/bar-local/BarLocalOperationsPanel.jsx', import.meta.url))
  const businessId = '40000000-0000-4000-8000-000000000001'
  const outletId = '40000000-0000-4000-8000-000000000002'
  const supplierId = '40000000-0000-4000-8000-000000000003'
  const productId = '40000000-0000-4000-8000-000000000004'
  const submissions = []
  const bundle = await build({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import Operations from ${JSON.stringify(component)};
      const ids={business:'${businessId}',outlet:'${outletId}',supplier:'${supplierId}',product:'${productId}'};
      const data={
        'stock.list':[{product_id:ids.product,name:'Synthetic tonic',sku:'SYN-TONIC',quantity:'4.000000',track_stock:true}],
        'suppliers.list':[{supplier_id:ids.supplier,name:'Synthetic supplier',version:3,active:true}],
        'purchase_orders.list':[]
      };
      window.__barData=data;
      window.api={barLocal:{query:async(name,filters)=>{window.__queries.push({name,filters});return{data:window.__barData[name]??[],complete:true,scope:{business_id:ids.business,outlet_id:ids.outlet},snapshot_watermark:1,pagination:{has_more:false,next_cursor:null},unavailable:[]}}}};
      function App(){const run=async(command,payload,pin='')=>{const response=await fetch('/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command,payload,pin})});if(!response.ok)throw new Error(await response.text());if(command==='purchase_order.create'){const id='40000000-0000-4000-8000-000000000006';const lineId='40000000-0000-4000-8000-000000000007';window.__barData['purchase_orders.list']=[{purchase_order_id:id,po_number:'LOCAL-PO-1',supplier_name:'Synthetic supplier',status:'ordered',ordered_on:'2026-10-28',total:'40.00'}];window.__barData['purchase_order.get']={purchase_order_id:id,po_number:'LOCAL-PO-1',supplier_id:ids.supplier,supplier:{name:'Synthetic supplier'},status:'ordered',ordered_on:'2026-10-28',total:'40.00',version:1,lines:[{purchase_order_line_id:lineId,product_id:ids.product,name_snapshot:'Synthetic tonic',sku_snapshot:'SYN-TONIC',quantity_ordered:'12.500000',quantity_received:'0.000000',quantity_remaining:'12.500000',unit_cost:'3.20'}]}}return{outcome:'committed_local',receipt:{operation_id:'local-op-1'}}};return <Operations session={{business_id:ids.business,outlet_id:ids.outlet,staff:{staff_id:'${businessId}',role:'owner'}}} capabilities={['inventory.view','inventory.manage']} shift={null} staffRows={[]} customers={[]} version={1} blocked={false} localReady={true} onCommand={run} onApprovedCommand={run}/>};
      window.__queries=[];createRoot(document.getElementById('root')).render(<App/>);`,
      resolveDir: process.cwd(),
      loader: 'jsx'
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    platform: 'browser',
    define: { 'process.env.NODE_ENV': '"development"' }
  })
  const server = createServer(async (request, response) => {
    if (request.url === '/bundle.js') {
      response.setHeader('Content-Type', 'text/javascript')
      response.end(bundle.outputFiles[0].text)
      return
    }
    if (request.url === '/command') {
      try {
        let body = ''
        for await (const chunk of request) body += chunk
        const submission = JSON.parse(body)
        const definition = getCommand(submission.command)
        const requiresApproval = ['purchase_order.create', 'purchase_order.cancel'].includes(submission.command)
        if (requiresApproval) assert.match(submission.pin, /^\d{4,12}$/)
        else assert.equal(submission.pin, '')
        const payload = requiresApproval ? { ...submission.payload, approval_id: '40000000-0000-4000-8000-000000000005' } : submission.payload
        definition.validate(payload)
        assert.equal(Object.hasOwn(submission.payload, 'pin'), false)
        submissions.push(submission)
        response.setHeader('Content-Type', 'application/json')
        response.end('{}')
      } catch (error) {
        response.statusCode = 400
        response.end(error instanceof Error ? error.message : 'invalid command')
      }
      return
    }
    response.setHeader('Content-Type', 'text/html')
    response.end('<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    const executable = process.env.BAR_LOCAL_CHROMIUM_EXECUTABLE_PATH ?? process.env.LUNA_CHROMIUM_EXECUTABLE_PATH
    browser = await chromium.launch({ headless: true, ...(executable ? { executablePath: executable } : {}) })
    const page = await browser.newPage()
    page.setDefaultTimeout(5000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const base = `http://127.0.0.1:${server.address().port}`
    await page.route('**/*', (route) => route.request().url().startsWith(base) ? route.continue() : route.abort())
    await page.goto(base)
    await page.getByRole('button', { name: 'Purchasing', exact: true }).click()
    await page.getByText('Purchase orders', { exact: true }).waitFor()
    await page.waitForTimeout(250)
    const screen = await page.evaluate(() => ({ queries: window.__queries, text: document.body.innerText }))
    assert.ok(screen.queries.some(({ name }) => name === 'suppliers.list'), JSON.stringify(screen))
    assert.match(screen.text, /Synthetic supplier/)
    const purchaseForm = page.locator('form').filter({ hasText: 'Create purchase order' })
    await purchaseForm.locator('select').nth(0).selectOption(supplierId)
    await purchaseForm.locator('select').nth(1).selectOption(productId)
    await purchaseForm.locator('input').nth(2).fill('12.500000')
    await purchaseForm.locator('input').nth(3).fill('3.20')
    await purchaseForm.locator('input').nth(4).fill('0.14')
    await purchaseForm.locator('input').nth(5).fill('5678')
    await page.getByRole('button', { name: 'Approve and create purchase order', exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'Committed by the local authority' }).waitFor()

    assert.equal(submissions.length, 1)
    assert.equal(submissions[0].command, 'purchase_order.create')
    assert.deepEqual(submissions[0].payload, {
      supplier_id: supplierId,
      expected_supplier_version: 3,
      lines: [{ product_id: productId, quantity: '12.500000', unit_cost: '3.20', tax_rate: '0.14' }]
    })
    await page.getByRole('button', { name: /LOCAL-PO-1/ }).click()
    const receiveForm = page.locator('form').filter({ hasText: 'Receive stock against this order' })
    await receiveForm.getByRole('textbox', { name: 'Quantity' }).fill('5.000000')
    await receiveForm.getByRole('textbox', { name: 'Unit cost' }).fill('3.20')
    await receiveForm.getByRole('textbox', { name: 'Lot code' }).fill('PO-LOT-1')
    await receiveForm.getByRole('textbox', { name: 'Expires on' }).fill('2030-02-28')
    await receiveForm.getByRole('button', { name: 'Receive into stock' }).click()
    await page.waitForTimeout(200)
    assert.equal(submissions.length, 2, await page.locator('body').innerText())
    assert.equal(submissions[1].command, 'purchase_order.receive')
    assert.deepEqual(submissions[1].payload, {
      purchase_order_id: '40000000-0000-4000-8000-000000000006',
      expected_version: 1,
      received_on: submissions[1].payload.received_on,
      lines: [{ purchase_order_line_id: '40000000-0000-4000-8000-000000000007', quantity: '5.000000', unit_cost: '3.20', lot_code: 'PO-LOT-1', expires_on: '2030-02-28' }]
    })
    assert.match(submissions[1].payload.received_on, /^\d{4}-\d{2}-\d{2}$/)
    const queryNames = await page.evaluate(() => window.__queries.map(({ name }) => name))
    assert.ok(queryNames.includes('purchase_orders.list'))
    assert.ok(queryNames.includes('purchase_order.get'))
    assert.ok(queryNames.includes('stock.list'))
    assert.ok(queryNames.every((name) => ['stock.list', 'suppliers.list', 'purchase_orders.list', 'purchase_order.get'].includes(name)))
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
    await new Promise((resolve) => server.close(resolve))
  }
})
