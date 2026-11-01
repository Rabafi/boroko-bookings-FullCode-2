import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import test from 'node:test'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { getCommand } from '../../packages/bar-contracts/dist/index.js'

test('Modern local stock movements submit scoped commands and keep manager approval separate', { timeout: 90000 }, async () => {
  const component = fileURLToPath(new URL('../../src/renderer/src/components/hospitality-pos/bar-local/BarLocalOperationsPanel.jsx', import.meta.url))
  const businessId = '41000000-0000-4000-8000-000000000001'
  const outletId = '41000000-0000-4000-8000-000000000002'
  const destinationOutletId = '41000000-0000-4000-8000-000000000003'
  const productId = '41000000-0000-4000-8000-000000000004'
  const submissions = []
  const bundle = await build({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import Operations from ${JSON.stringify(component)};
      const ids={business:'${businessId}',outlet:'${outletId}',product:'${productId}'};
      const data={'stock.list':[{product_id:ids.product,name:'Synthetic tonic',sku:'SYN-TONIC',quantity:'20.000000',track_stock:true}],'stock.lot_balances':[{lot_id:'41000000-0000-4000-8000-000000000006',product_id:ids.product,name:'Synthetic tonic',sku:'SYN-TONIC',lot_code:'LOT-UI-1',remaining_quantity:'10.000000',version:2,sale_eligible:true,expiry_status:'in_date'},{lot_id:'41000000-0000-4000-8000-000000000007',product_id:ids.product,name:'Synthetic tonic',sku:'SYN-TONIC',lot_code:null,remaining_quantity:'2.000000',version:1,sale_eligible:false,expiry_status:'quarantined'}]};
      window.api={barLocal:{query:async(name)=>({data:data[name]??[],complete:true,scope:{business_id:ids.business,outlet_id:ids.outlet},snapshot_watermark:1,pagination:{has_more:false,next_cursor:null},unavailable:[]})}};
      function App(){const run=async(command,payload,pin='')=>{const response=await fetch('/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command,payload,pin})});if(!response.ok)throw new Error(await response.text());return{outcome:'committed_local',receipt:{operation_id:'local-stock-op'}}};return <Operations session={{business_id:ids.business,outlet_id:ids.outlet,staff:{staff_id:'${businessId}',role:'owner'}}} capabilities={['inventory.view','inventory.manage']} shift={null} staffRows={[]} customers={[]} version={1} blocked={false} localReady={true} onCommand={run} onApprovedCommand={run}/>};
      createRoot(document.getElementById('root')).render(<App/>);`,
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
        if (['stock.adjust', 'stock.waste', 'stock.lot.waste', 'stock.lot.release'].includes(submission.command)) assert.match(submission.pin, /^\d{4,12}$/)
        else assert.equal(submission.pin, '')
        const payload = ['stock.adjust', 'stock.waste', 'stock.lot.waste', 'stock.lot.release'].includes(submission.command)
          ? { ...submission.payload, approval_id: '41000000-0000-4000-8000-000000000005' }
          : submission.payload
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
    const form = page.locator('form').filter({ hasText: 'Record stock movement' })
    const movement = form.locator('select').nth(0)
    const product = form.locator('select').nth(1)
    await product.selectOption(productId)

    await form.getByRole('textbox', { name: 'Quantity' }).fill('5.500000')
    await form.getByRole('textbox', { name: 'Lot code' }).fill('LOT-UI-1')
    await form.getByRole('textbox', { name: 'Expires on' }).fill('2030-01-31')
    await form.getByRole('button', { name: 'Record stock movement' }).click()
    await page.getByRole('status').filter({ hasText: 'Committed by the local authority' }).waitFor()

    await movement.selectOption('stocktake')
    await form.getByRole('textbox', { name: 'Counted quantity' }).fill('19.250000')
    await form.getByRole('textbox', { name: 'Reason' }).fill('physical count')
    await form.getByRole('button', { name: 'Record stock movement' }).click()
    await page.getByRole('status').filter({ hasText: 'Committed by the local authority' }).waitFor()

    await movement.selectOption('adjust')
    await form.getByPlaceholder('-2.000000').fill('-1.000000')
    await form.getByRole('textbox', { name: 'Reason' }).fill('damaged stock')
    await form.getByLabel('Different manager PIN').fill('5678')
    await form.getByRole('button', { name: 'Record stock movement' }).click()
    await page.getByRole('status').filter({ hasText: 'Committed by the local authority' }).waitFor()

    await movement.selectOption('waste')
    await form.getByRole('textbox', { name: 'Quantity' }).fill('1.000000')
    await form.getByRole('combobox', { name: 'Lot to discard' }).selectOption('41000000-0000-4000-8000-000000000006')
    await form.getByRole('textbox', { name: 'Reason' }).fill('expired stock')
    await form.getByLabel('Different manager PIN').fill('5678')
    await form.getByRole('button', { name: 'Record stock movement' }).click()
    await page.getByRole('status').filter({ hasText: 'Committed by the local authority' }).waitFor()

    await movement.selectOption('transfer')
    await form.getByRole('textbox', { name: 'Quantity' }).fill('2.000000')
    await form.getByRole('textbox', { name: 'Destination outlet UUID' }).fill(destinationOutletId)
    await form.getByRole('textbox', { name: 'Reason' }).fill('move to second bar')
    await form.getByRole('button', { name: 'Record stock movement' }).click()
    await page.getByRole('status').filter({ hasText: 'Committed by the local authority' }).waitFor()

    const release = page.locator('form').filter({ hasText: 'Approve and release inspected lot' })
    await release.getByRole('combobox', { name: 'Quarantined lot' }).selectOption('41000000-0000-4000-8000-000000000007')
    await release.getByRole('textbox', { name: 'Verified lot code' }).fill('RETURN-VERIFIED')
    await release.getByRole('textbox', { name: 'Verified expiry date (blank only if none)' }).fill('2030-01-31')
    await release.getByRole('textbox', { name: 'Different manager PIN' }).fill('5678')
    await release.getByRole('textbox', { name: 'Inspection result and reason' }).fill('Packaging checked; in-date')
    await release.getByRole('button', { name: 'Approve and release inspected lot' }).click()
    await page.getByRole('status').filter({ hasText: 'Committed by the local authority' }).waitFor()

    assert.deepEqual(submissions.map(({ command }) => command), ['stock.receive', 'stock.stocktake', 'stock.adjust', 'stock.lot.waste', 'stock.transfer', 'stock.lot.release'])
    assert.deepEqual(submissions[0].payload, { product_id: productId, quantity: '5.500000', lot_code: 'LOT-UI-1', expires_on: '2030-01-31' })
    assert.deepEqual(submissions[1].payload, { product_id: productId, counted_quantity: '19.250000', reason: 'physical count' })
    assert.equal(submissions[2].payload.reason, 'damaged stock')
    assert.equal(submissions[2].pin, '5678')
    assert.deepEqual(submissions[3].payload, { lot_id: '41000000-0000-4000-8000-000000000006', product_id: productId, expected_version: 2, quantity: '1.000000', reason: 'expired stock' })
    assert.equal(submissions[3].pin, '5678')
    assert.deepEqual(submissions[4].payload, { product_id: productId, to_outlet_id: destinationOutletId, quantity: '2.000000', reason: 'move to second bar' })
    assert.deepEqual(submissions[5].payload, { lot_id: '41000000-0000-4000-8000-000000000007', expected_version: 1, verified_lot_code: 'RETURN-VERIFIED', verified_expires_on: '2030-01-31', no_expiry_confirmed: false, reason: 'Packaging checked; in-date' })
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
    await new Promise((resolve) => server.close(resolve))
  }
})
