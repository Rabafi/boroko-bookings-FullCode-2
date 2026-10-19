import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import { test, before, after } from 'node:test'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import { createProductSaveFlow } from '../src/shared/productSaveFlow.js'
import { parse } from '@babel/parser'
import { buildBarGuideProgressScratch } from './helpers/build-bar-guide-progress-scratch-v11.mjs'
const root=process.cwd(), draft=path.join(root,'docs/audits/2026-10-09/bar-v10-continuation/draft-v11-semantic-review-01')
// Keep frozen v11 evidence immutable; refresh this run's output under v12.
const evidenceDir=path.join(root,'docs/audits/2026-10-12/bar-v11-continuation/draft-v12-receipt-recovery-01/evidence')
const temp=fs.mkdtempSync(path.join(root,'tmp/bar-guide-product-v11-'))
let browser,server,base;const errors=[];const results=[]
before(async()=>{
 await build({entryPoints:[path.join(draft,'evidence/product-semantics-harness-v11.jsx')],outfile:path.join(temp,'harness.js'),bundle:true,jsx:'automatic',nodePaths:[path.join(root,'node_modules')],loader:{'.png':'dataurl','.svg':'dataurl'},logLevel:'warning'})
 const compiled=await postcss([tailwind({config:path.join(root,'tailwind.config.js')}),autoprefixer()]).process(fs.readFileSync(path.join(root,'src/renderer/src/index.css'),'utf8')+'\n'+fs.readFileSync(path.join(root,'src/renderer/src/styles/hospitality-pos.css'),'utf8'),{from:path.join(root,'src/renderer/src/index.css')})
 fs.writeFileSync(path.join(temp,'harness.css'),compiled.css)
 server=createServer((req,res)=>{if(req.url==='/harness.js'){res.setHeader('content-type','text/javascript');res.end(fs.readFileSync(path.join(temp,'harness.js')))}else if(req.url==='/harness.css'){res.setHeader('content-type','text/css');res.end(compiled.css)}else{res.setHeader('content-type','text/html');res.end('<!doctype html><html data-product="hospitality-pos"><head><meta charset="utf-8"><link rel="stylesheet" href="/harness.css"></head><body><div id="root"></div><script src="/harness.js"></script></body></html>')}})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
})
after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(evidenceDir,`product-component-results-v11-${process.pid}.json`),JSON.stringify({layer:'actual renderer components, fictional in-memory bridge only; no SQL or physical acceptance',results,page_errors:errors},null,2));fs.rmSync(temp,{recursive:true,force:true})})
async function open(scenario){const p=await browser.newPage({viewport:{width:1400,height:1100}});p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());await p.goto(base+'/?scenario='+scenario);if(scenario==='caller')await p.getByRole('button',{name:'Edit Fictional bottle',exact:true}).waitFor();else await p.getByLabel('Product name',{exact:true}).waitFor();return p}
async function ready(p){await p.getByLabel('Product name',{exact:true}).waitFor()}
const calls=p=>p.evaluate(()=>window.__PRODUCT_GUIDE_CALLS__)
test('actual Products caller fails to hydrate saved pack flags and sold-out state: guide must require edit review',async()=>{
 const p=await open('caller');await p.getByRole('button',{name:'Edit Fictional bottle',exact:true}).click();await ready(p)
 assert.equal(await p.getByRole('checkbox',{name:'6-pack',exact:true}).isChecked(),false)
 assert.equal(await p.getByRole('checkbox',{name:/Available for sale/}).isChecked(),true)
 await p.getByRole('button',{name:'Save changes',exact:true}).click()
 await p.waitForFunction(()=>window.__PRODUCT_GUIDE_CALLS__.some(c=>c.name==='saveBarProductWithStock'))
 const save=(await calls(p)).find(c=>c.name==='saveBarProductWithStock');assert.equal(save.payload.pack6,false);assert.equal(save.payload.pack6Barcode,null);assert.equal(save.payload.is_available,true);assert.equal(save.payload.opening_stock,0)
 results.push({case:'existing Products edit',observed:'saved pack unchecked, barcode omitted and sold-out state enabled by missing caller props; no opening quantity replay',payload:save.payload});await p.close()
})
test('stock-only Link existing input still invokes new createItem without selected identity or selling price',async()=>{
 const p=await open('stock-only');await ready(p);await p.getByLabel(/What are you adding/).selectOption('stock-only');await p.getByLabel('Product name',{exact:true}).fill('Fictional ingredient');await p.getByLabel(/Stock source/).selectOption('link');await p.locator('label').filter({hasText:/^Existing stock item/}).locator('select').selectOption('fictional-stock');await p.getByRole('button',{name:'Save product',exact:true}).click()
 await p.waitForFunction(()=>window.__PRODUCT_GUIDE_CALLS__.some(c=>c.name==='createItem'));const save=(await calls(p)).find(c=>c.name==='createItem');assert.equal(save.payload.inventory_item_id,undefined);assert.equal(save.payload.selling_price,undefined);assert.equal(save.payload.operation_key,undefined);assert.equal((await calls(p)).some(c=>c.name==='saveBarProductWithStock'),false)
 results.push({case:'stock-only link',observed:'new stock creation, not link; no stable operation key or selling price',payload:save.payload});await p.close()
})
test('unchanged uncertain direct save keeps key but edited failed form mints a different request',async()=>{
 const p=await open('unknown');await ready(p);await p.getByLabel('Product name',{exact:true}).fill('Fictional new bottle');await p.getByLabel(/^Selling price/).fill('40');await p.getByRole('button',{name:'Save product',exact:true}).click();await p.getByRole('button',{name:'I checked — retry',exact:true}).waitFor();await p.getByRole('button',{name:'I checked — retry',exact:true}).click();await p.waitForFunction(()=>window.__PRODUCT_GUIDE_CALLS__.filter(c=>c.name==='saveBarProductWithStock').length===2)
 let saves=(await calls(p)).filter(c=>c.name==='saveBarProductWithStock');assert.deepEqual(saves[0].payload,saves[1].payload)
 await p.getByLabel('Product name',{exact:true}).fill('Changed fictional bottle');await p.getByRole('button',{name:'Save product',exact:true}).click();await p.waitForFunction(()=>window.__PRODUCT_GUIDE_CALLS__.filter(c=>c.name==='saveBarProductWithStock').length===3);saves=(await calls(p)).filter(c=>c.name==='saveBarProductWithStock');assert.notEqual(saves[2].payload.operation_key,saves[0].payload.operation_key)
 results.push({case:'uncertain save edit',observed:'identical retry stable; editing failed form changes operation identity',keys:saves.map(c=>c.payload.operation_key)});await p.close()
})
test('recipe wizard availability checkbox is not honored by its actual saved payload',async()=>{
 const p=await open('recipe');await ready(p);await p.getByRole('checkbox',{name:/Available for sale/}).check();await p.getByRole('button',{name:'Save changes',exact:true}).click();await p.waitForFunction(()=>window.__PRODUCT_GUIDE_CALLS__.some(c=>c.name==='updateMenuItem'));const save=(await calls(p)).find(c=>c.name==='updateMenuItem');assert.equal(save.payload.is_available,false);assert.equal(save.payload.inventory_item_id,undefined)
 results.push({case:'recipe edit',observed:'initial availability retained despite checkbox; stock link omitted from update',payload:save.payload});await p.close()
})
test('wizard Cancel before Save and scanner fill create no catalog or stock mutation',async()=>{
 const p=await open('cancel');await ready(p);await p.getByRole('button',{name:'Scan Single barcode (optional)',exact:true}).click();await p.evaluate(()=>{for(const key of [...'000987','Enter'])window.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));});await p.waitForFunction(()=>Array.from(document.querySelectorAll('input')).some(input=>input.value==='000987'));assert.equal(await p.locator('label').filter({hasText:/^Single barcode \(optional\)/}).locator('input').inputValue(),'000987');await p.getByRole('button',{name:'Cancel',exact:true}).click();assert.deepEqual((await calls(p)).map(c=>c.name),['close']);assert.deepEqual(errors,[])
 results.push({case:'scan and Cancel',observed:'leading zeros preserved; only close callback'});await p.close()
})

test('Save & add another leaves a publication notice whose retry follows the new blank form key',async()=>{
 const p=await open('publication');await ready(p);await p.getByLabel('Product name',{exact:true}).fill('Fictional pending-publication item');await p.getByLabel(/^Selling price/).fill('30');await p.getByRole('button',{name:'Save & add another',exact:true}).click();await p.getByRole('button',{name:'Retry publication',exact:true}).waitFor()
 const productSave=(await calls(p)).find(c=>c.name==='saveBarProductWithStock');assert.ok(productSave?.payload?.operation_key);assert.equal(await p.getByLabel('Product name',{exact:true}).inputValue(),'')
 await p.getByRole('button',{name:'Retry publication',exact:true}).click();await p.waitForFunction(()=>window.__PRODUCT_GUIDE_CALLS__.some(c=>c.name==='retryProductRequest'))
 const retry=(await calls(p)).find(c=>c.name==='retryProductRequest');assert.notEqual(retry.key,productSave.payload.operation_key)
 results.push({case:'publication notice after Save & add another',observed:'Retry publication uses the next blank form operation key, not the saved item key',original_saved_key:productSave.payload.operation_key,retry_key:retry.key,fixture_only:true});await p.close()
})

test('modifier editor shows exact entry controls and sends only the parsed modifier payload',async()=>{
 const p=await open('caller');await p.getByRole('button',{name:/Add product/}).click();await p.getByRole('button',{name:'Manage sizes & extras',exact:true}).click()
 let dialog=p.getByRole('dialog',{name:'Modifier groups'});await dialog.waitFor()
 await dialog.getByLabel('Group name',{exact:true}).fill('Fictional sides')
 await dialog.getByLabel(/Options/).fill('Salad|0\nExtra sauce|15')
 await dialog.getByLabel('Minimum choices',{exact:true}).fill('1');await dialog.getByLabel('Maximum choices',{exact:true}).fill('2');await dialog.getByLabel(/Menu sections/).fill('Mains, Drinks')
 await dialog.getByRole('button',{name:'Done',exact:true}).click();assert.equal((await calls(p)).some(c=>c.name==='saveModifierGroup'),false,'Done closes without saving')
 await p.getByRole('button',{name:'Manage sizes & extras',exact:true}).click();dialog=p.getByRole('dialog',{name:'Modifier groups'});await dialog.waitFor()
 await dialog.getByRole('button',{name:'Save modifier group',exact:true}).click();await p.waitForFunction(()=>window.__PRODUCT_GUIDE_CALLS__.some(c=>c.name==='saveModifierGroup'))
 const call=(await calls(p)).find(c=>c.name==='saveModifierGroup');assert.equal(call.payload.name,'Fictional sides');assert.deepEqual(call.payload.options,[{name:'Salad',price_delta:0},{name:'Extra sauce',price_delta:15}]);assert.equal(call.payload.min_selections,1);assert.equal(call.payload.max_selections,2);assert.deepEqual(call.payload.applies_to_categories,['Mains','Drinks']);assert.equal((await calls(p)).some(c=>c.name==='saveBarProductWithStock'),false)
 results.push({case:'modifier group configuration',observed:'Done closes without persistence; Save modifier group sends the parsed options and selection/category settings only',payload:call.payload,fixture_only:true});await p.close()
})

test('actual stored product flow returns original committed result and retains missing-contract request outside actionable set',async()=>{
 const store=new Map();let dispatched=0
 const flow=createProductSaveFlow({readRequest:k=>store.get(k)||null,listRequests:()=>[...store.values()],writeRequest:e=>store.set(e.operation_key,structuredClone(e)),removeRequest:k=>store.delete(k),queueOffline:async()=>{},dispatchOnline:async()=>{dispatched++;return {transported:true,missing:true}},finalizeCommitted:async()=>({publication:'published'}),isOnline:()=>true,newId:()=> '11111111-1111-4111-8111-111111111111'})
 const key='fictional-committed-key';store.set(key,{operation_key:key,state:'committed',payload:{product:{name:'Original'}},result:{success:true,menu_item_id:'original-id'}})
 const result=await flow.save({operation_key:key,name:'Changed after commit'},'11111111-1111-4111-8111-111111111112')
 assert.equal(result.menu_item_id,'original-id');assert.equal(dispatched,0)
 store.set('fictional-upgrade-key',{operation_key:'fictional-upgrade-key',state:'unsent',payload:{}})
 await assert.rejects(flow.retry('fictional-upgrade-key'),/latest till update/)
 assert.equal(store.get('fictional-upgrade-key').state,'pending-upgrade');assert.equal(flow.ACTIONABLE,undefined);assert.equal(flow.ACTIONABLE_STATES.has('pending-upgrade'),false)
 const domain=fs.readFileSync(path.join(root,'src/main/domains/pos.js'),'utf8')
 const ast=parse(domain,{sourceType:'module'});const wrapper=ast.program.body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.id?.name==='getProductRequestStatus');assert.ok(wrapper)
 const definition=domain.slice(wrapper.declaration.start,wrapper.declaration.end)
 const actualStatus=()=>new Function('productSaveFlow',definition+'; return getProductRequestStatus();')(flow)
 assert.throws(actualStatus,/reading 'has'/,'Current domain references absent ACTIONABLE API; keyed recovery list cannot load')
 results.push({case:'actual pure flow and status handler',observed:'committed same key returns old result without changed-payload comparison; domain status handler throws on absent ACTIONABLE API for any keyed stored request; pending-upgrade also excluded from internal startup actionable set',physical_or_sql_proof:false})
})

test('product semantics are red on exact v10 and green in scratch/current actual PDFs; binding negatives fail closed',()=>{
 const checker=path.join(root,'tests/bar-guide-product-v11-regression.py')
 for(const [label,pdfDir,red] of [
  ['exact-v10',path.join(root,'docs/bar-manual/build/remediation-candidate-2026-10-09-v10/pdf'),true],
  ['scratch',path.join(buildBarGuideProgressScratch(),'pdf'),false],
  ['current',path.join(draft,'pdf'),false],
 ]){
  const run=spawnSync('python',[checker,'--pdf-dir',pdfDir,...(red?['--red']:[])],{cwd:root,encoding:'utf8',timeout:120000})
  assert.equal(run.error,undefined,run.error?.message);assert.equal(run.status,0,label+': '+run.stdout+'\n'+run.stderr)
  const report=JSON.parse(run.stdout);assert.equal(report.outcome,red?'EXPECTED_RED_EXACT_V10':'PASS_ACTUAL_PDF')
  if(red)assert.ok(report.missing_semantics.some(s=>s.includes('fabricated pack-price')));else assert.deepEqual(report.missing_semantics,[])
  results.push({case:label+' actual PDF product semantics',report})
 }
 const proofTemp=fs.mkdtempSync(path.join(root,'tmp','bar-guide-product-bindings-v12-'))
 const proofSource=fs.readFileSync(path.join(draft,'evidence/verify_binding_evidence_v11.py'),'utf8')
 const v12Root='docs/audits/2026-10-12/bar-v11-continuation/draft-v12-receipt-recovery-01'
 const artifactName=`${v12Root}/evidence/binding-artifact-identities-v12-${process.pid}.json`
 const negativeName=`${v12Root}/evidence/binding-negative-proof-v12-${process.pid}.json`
 const proofReplacements=[
  ["(E/'binding-artifact-identities-v11.json').write_text(",`(ROOT/'${artifactName}').write_text(`],
  ["(E/'binding-negative-proof-v11.json').write_text(",`(ROOT/'${negativeName}').write_text(`],
 ]
 let isolatedProofSource=proofSource
 for(const [before,after] of proofReplacements){assert.equal(isolatedProofSource.split(before).length-1,1,'expected one frozen proof target: '+before);isolatedProofSource=isolatedProofSource.replace(before,after)}
 const isolatedProofScript=path.join(proofTemp,'verify_binding_evidence_v12_revalidation.py')
 fs.writeFileSync(isolatedProofScript,isolatedProofSource)
 let verify
 try{verify=spawnSync('python',[isolatedProofScript],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024})}finally{fs.rmSync(proofTemp,{recursive:true,force:true})}
 assert.equal(verify.error,undefined,verify.error?.message);assert.equal(verify.status,0,verify.stdout+'\n'+verify.stderr)
 const report=JSON.parse(verify.stdout);assert.equal(report.positive.independent_raw_ids,84);assert.equal(Object.keys(report.negative_fixtures).length,9)
 assert.ok(Object.values(report.negative_fixtures).every(r=>r.outcome==='EXPECTED_REJECTION'));results.push({case:'independent binding negative fixtures',report})
})
