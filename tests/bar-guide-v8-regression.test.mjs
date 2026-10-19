import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { execFileSync, spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { buildFinanceGuideBundle } from '../docs/bar-manual/build/remediation-candidate-2026-10-08-v8-review2/evidence/build_finance_guide_bundle.mjs'
import { chromium } from 'playwright'

const root=process.cwd()
const candidate=path.join(root,'docs/bar-manual/build/remediation-candidate-2026-10-08-v8-review2')
const v7=path.join(root,'docs/bar-manual/build/remediation-candidate-2026-10-08-v7')
const manualName='Tsa-Bonno-Bar-Customer-Manual.pdf'
const quickName='Tsa-Bonno-Bar-Quick-Start.pdf'
const verifier=path.join(candidate,'evidence/verify_v8_candidate.py')
const controlVerifier=path.join(candidate,'evidence/verify_finance_control_coverage.py')
const testTmp=fs.mkdtempSync(path.join(root,'tmp','bar-guide-v8-regressions-'))
const testEvidence=path.join(testTmp,'historical-v8-reports');fs.mkdirSync(testEvidence,{recursive:true})
process.once('exit',()=>fs.rmSync(testTmp,{recursive:true,force:true}))
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase()
const bundle=path.join(testTmp,'finance-guide.js')
const bundleReady=buildFinanceGuideBundle(root,bundle,candidate)

function scenarioOptions(scenario){
 const all={'accounting.read':true,'accounting.manage':true,'accounting.export':true,'accounting.bank_approve':true,'accounting.tax_file':true}
 const options={access:{role:'manager',capabilities:all}}
 if(scenario==='journal-timeout')options.submitErrorsRemaining=1
 if(scenario==='journal-recovery')options.statusResponse={found:false}
 if(scenario==='journal-status-error')options.statusError=true
 if(scenario==='journal-nonterminal')options.statusResponse={found:true,id:'fictional-draft-001',status:'draft'}
 if(scenario.startsWith('journal-terminal-'))options.statusResponse={found:true,id:'fictional-journal-001',status:scenario.slice('journal-terminal-'.length)}
 if(scenario==='journal-retry-success')options.retryResult={id:'fictional-journal-001',status:'submitted',operation_id:'3b7a260e-4db7-4e51-8ebc-32db9bbbe001',replayed:true}
 if(scenario==='bank-none')options.bankEmpty=true
 if(scenario==='tax-none')options.taxNoEligible=true
 if(scenario.endsWith('-cancel'))options.exportOutcome='cancel'
 if(scenario.endsWith('-error'))options.exportOutcome='error'
 if(scenario.endsWith('-noexport'))options.access={role:'cashier',capabilities:{'accounting.read':true,'accounting.manage':false,'accounting.export':false,'accounting.bank_approve':false,'accounting.tax_file':false}}
 return options
}
function fixtureServer(){
 const server=createServer((req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1')
  if(u.pathname==='/finance-guide.js'){res.setHeader('content-type','text/javascript');res.end(fs.readFileSync(bundle));return}
  if(u.pathname==='/finance-guide.css'){res.setHeader('content-type','text/css');res.end('');return}
  const page=u.searchParams.get('page')||'ledger',scenario=u.searchParams.get('scenario')||''
  const options=JSON.stringify(scenarioOptions(scenario)).replaceAll('<','\\u003c')
  res.setHeader('content-type','text/html; charset=utf-8')
  res.end(`<!doctype html><html data-product="hospitality-pos"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/finance-guide.css"></head><body><div id="root"></div><script>window.__BAR_FINANCE_PAGE__=${JSON.stringify(page)};window.__BAR_FINANCE_OPTIONS__=${options};</script><script src="/finance-guide.js"></script></body></html>`)
 })
 return server
}
async function startFixture(browser,base,pageName,scenario,intentOrRaw){
 const context=await browser.newContext({viewport:{width:1440,height:1100},deviceScaleFactor:1})
 if(intentOrRaw!==undefined){
  const key='restaurant-accounting:manual-journal:v2:fictional-bar-fixture:fictional-manager'
  await context.addInitScript(({key,value})=>localStorage.setItem(key,typeof value==='string'?value:JSON.stringify(value)),{key,value:intentOrRaw})
 }
 const page=await context.newPage();page.setDefaultTimeout(15000)
 await page.goto(`${base}/?page=${pageName}&scenario=${scenario}`)
 await page.getByRole('heading',{name:pageName==='ledger'?'General ledger':pageName==='bank'?'Bank reconciliation':'Tax working papers',exact:true}).waitFor({state:'visible'})
 return {context,page}
}
const seedIntent={version:2,scopeKey:'restaurant-accounting:manual-journal:v2:fictional-bar-fixture:fictional-manager',operationId:'3b7a260e-4db7-4e51-8ebc-32db9bbbe001',payload:{entry_date:'2026-10-08',description:'Fictional stock correction',reference_number:'FIC-REF-01',evidence_ref:'FIC-DOC-01',lines:[{account_id:'fictional-cash',debit:50,credit:0,memo:null},{account_id:'fictional-sales',debit:0,credit:50,memo:null}]},state:'unknown',draftId:null,status:null}

// These tests mount the actual renderer components. Every bridge method is an in-page fictional mock;
// there is no Electron IPC, server, database, financial posting or filesystem export.
test('actual General ledger recovery survives simulated timeout/restart and preserves the original request',async()=>{
 await bundleReady
 const server=fixtureServer();let browser
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const base=`http://127.0.0.1:${server.address().port}`
  const {context,page}=await startFixture(browser,base,'ledger','journal-timeout')
  const journalPanel=page.locator('section').filter({has:page.getByRole('heading',{name:'Submit manual journal',exact:true})});const form=journalPanel.locator('form')
  await page.getByLabel('Description',{exact:true}).fill('Fictional timeout journal')
  await page.getByLabel('Evidence / attachment reference',{exact:true}).fill('FIC-ATTACHMENT-001')
  const selects=form.locator('select');await selects.nth(0).selectOption('fictional-cash');await selects.nth(1).selectOption('fictional-sales')
  await form.locator('input[aria-label="Debit"]').nth(0).fill('50');await form.locator('input[aria-label="Credit"]').nth(1).fill('50')
  await page.getByRole('button',{name:'Submit journal',exact:true}).click()
  await page.getByRole('heading',{name:'Resolve pending journal submission',exact:true}).waitFor({state:'visible'})
  await page.getByText(/Fictional simulated lost-response timeout/).waitFor({state:'visible'})
  const submitButton=page.getByRole('button',{name:'Submit journal',exact:true})
  assert.equal(await submitButton.isDisabled(),true,'uncertain submission disables the original submit control')
  assert.equal(await submitButton.evaluate(button=>button.closest('fieldset')?.disabled),true,'uncertain submission locks the fieldset containing the original form')
  const firstCalls=await page.evaluate(()=>window.__BAR_FINANCE_CALLS__)
  const firstReadOperations=firstCalls.filter(x=>x.kind==='invoke').map(x=>x.operation)
  for(const operation of ['getAccounts','getLedgerPage','getPosMappings','getLedger'])assert.ok(firstReadOperations.includes(operation),`page load performs separate ${operation} RPC read`)
  const firstSubmit=firstCalls.find(x=>x.operation==='createAndSubmitManualJournal');assert.ok(firstSubmit?.fixtureOnly)
  assert.equal(firstCalls.filter(x=>x.operation==='createAndSubmitManualJournal').length,1,'one normal Submit click dispatches exactly once before timeout recovery')
  const original=firstSubmit.args[0];assert.match(original.operationId,/^[0-9a-f-]{36}$/i);assert.equal(original.payload.description,'Fictional timeout journal');assert.equal(original.payload.evidence_ref,'FIC-ATTACHMENT-001')
  assert.deepEqual(original.payload.lines.map(line=>line.account_id),['fictional-cash','fictional-sales'])
  assert.deepEqual(original.payload.lines.map(line=>[Number(line.debit),Number(line.credit)]),[[50,0],[0,50]])
  assert.equal(original.payload.lines.reduce((total,line)=>total+Number(line.debit),0),original.payload.lines.reduce((total,line)=>total+Number(line.credit),0),'normal Submit carries a balanced payload')
  const storedBefore=JSON.parse(await page.evaluate(()=>localStorage.getItem('restaurant-accounting:manual-journal:v2:fictional-bar-fixture:fictional-manager')))
  assert.equal(storedBefore.operationId,original.operationId);assert.deepEqual(storedBefore.payload,original.payload)
  // A browser reload represents reopening the same signed-in fixture profile; storage is preserved.
  await page.goto(`${base}/?page=ledger&scenario=journal-recovery`)
  await page.getByRole('heading',{name:'Resolve pending journal submission',exact:true}).waitFor({state:'visible'})
  const restored=JSON.parse(await page.evaluate(()=>localStorage.getItem('restaurant-accounting:manual-journal:v2:fictional-bar-fixture:fictional-manager')))
  assert.equal(restored.operationId,original.operationId);assert.deepEqual(restored.payload,original.payload)
  assert.equal(await submitButton.isDisabled(),true,'reopened recovery still disables journal submission')
  assert.equal(await submitButton.evaluate(button=>button.closest('fieldset')?.disabled),true)
  await page.getByRole('button',{name:'Check server status',exact:true}).click()
  await page.getByText(/No committed journal is visible yet\. The original request may still arrive/).waitFor({state:'visible'})
  const notFound=JSON.parse(await page.evaluate(()=>localStorage.getItem('restaurant-accounting:manual-journal:v2:fictional-bar-fixture:fictional-manager')))
  assert.equal(notFound.operationId,original.operationId);assert.deepEqual(notFound.payload,original.payload);assert.equal(notFound.state,'not_found')
  await page.reload();await page.getByRole('heading',{name:'Resolve pending journal submission',exact:true}).waitFor({state:'visible'})
  assert.equal(await submitButton.isDisabled(),true,'not-found does not unlock or discard the request after restart')
  assert.equal(await submitButton.evaluate(button=>button.closest('fieldset')?.disabled),true)
  await page.getByRole('button',{name:'Retry original submission',exact:true}).click()
  await page.getByText(/Journal submitted for independent approval\. Draft fictional-journal-001/).waitFor({state:'visible'})
  const calls=await page.evaluate(()=>window.__BAR_FINANCE_CALLS__)
  const statusCalls=calls.filter(x=>x.operation==='getManualJournalSubmissionStatus');assert.equal(statusCalls.length,1);assert.deepEqual(statusCalls[0].args,[original.operationId])
  const submits=calls.filter(x=>x.operation==='createAndSubmitManualJournal');assert.equal(submits.length,2,'the original uncertain attempt and its one retry are both retained across reload')
  for(const submission of submits){assert.equal(submission.args[0].operationId,original.operationId);assert.deepEqual(submission.args[0].payload,original.payload);assert.equal(submission.fixtureOnly,true)}
  assert.equal(await page.evaluate(()=>localStorage.getItem('restaurant-accounting:manual-journal:v2:fictional-bar-fixture:fictional-manager')),null)
  assert.deepEqual(calls.filter(x=>x.kind==='invoke'&&!['getReadiness','getAccounts','getLedgerPage','getLedger','getPosMappings','getManualJournalSubmissionStatus','createAndSubmitManualJournal'].includes(x.operation)),[])
  await context.close()
 }finally{if(browser)await browser.close();if(server.listening)await new Promise(resolve=>server.close(resolve))}
})

test('actual recovery component distinguishes not-found, nonterminal, terminal, status-error and unreadable states',async()=>{
 await bundleReady;const server=fixtureServer();let browser
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const base=`http://127.0.0.1:${server.address().port}`
  {
   const {context,page}=await startFixture(browser,base,'ledger','journal-nonterminal',seedIntent)
   await page.getByRole('heading',{name:'Resolve pending journal submission',exact:true}).waitFor({state:'visible'});await page.getByRole('button',{name:'Check server status',exact:true}).click()
   await page.getByText(/The original draft fictional-draft-001 is draft/).waitFor({state:'visible'})
   const saved=JSON.parse(await page.evaluate(()=>localStorage.getItem('restaurant-accounting:manual-journal:v2:fictional-bar-fixture:fictional-manager')))
   assert.equal(saved.operationId,seedIntent.operationId);assert.deepEqual(saved.payload,seedIntent.payload);assert.equal(saved.status,'draft');assert.equal(await page.getByRole('button',{name:'Retry original submission',exact:true}).count(),1)
   await context.close()
  }
  for(const status of ['submitted','approved','posted','rejected']){
   const {context,page}=await startFixture(browser,base,'ledger',`journal-terminal-${status}`,seedIntent)
   await page.getByRole('button',{name:'Check server status',exact:true}).click();await page.getByText(new RegExp(status==='rejected'?`The server confirms journal fictional-journal-001 was rejected`:`The server confirms journal fictional-journal-001 is ${status}`)).waitFor({state:'visible'})
   assert.equal(await page.getByRole('heading',{name:'Resolve pending journal submission',exact:true}).count(),0)
   assert.equal(await page.evaluate(()=>localStorage.getItem('restaurant-accounting:manual-journal:v2:fictional-bar-fixture:fictional-manager')),null)
   await context.close()
  }
  {
   const {context,page}=await startFixture(browser,base,'ledger','journal-status-error',seedIntent)
   await page.getByRole('button',{name:'Check server status',exact:true}).click();await page.getByText(/Submission status could not be confirmed/).waitFor({state:'visible'})
   assert.equal(await page.getByRole('button',{name:'Retry original submission',exact:true}).count(),1)
   assert.equal(JSON.parse(await page.evaluate(()=>localStorage.getItem('restaurant-accounting:manual-journal:v2:fictional-bar-fixture:fictional-manager'))).operationId,seedIntent.operationId)
   await context.close()
  }
  {
   const {context,page}=await startFixture(browser,base,'ledger','journal-unreadable','{bad-json')
   const recoveryError=page.getByRole('alert');await recoveryError.waitFor({state:'visible'})
   assert.ok((await recoveryError.innerText()).trim().length>0,'malformed saved recovery state must surface an error')
   assert.equal(await page.getByRole('heading',{name:'Resolve pending journal submission',exact:true}).count(),0)
   assert.equal(await page.getByRole('button',{name:'Submit journal',exact:true}).isDisabled(),true)
   const calls=await page.evaluate(()=>window.__BAR_FINANCE_CALLS__);assert.equal(calls.filter(x=>x.operation==='createAndSubmitManualJournal').length,0)
   await context.close()
  }
 }finally{if(browser)await browser.close();if(server.listening)await new Promise(resolve=>server.close(resolve))}
})

test('bank and tax export screens enforce eligible selection and pass the selected record to the fake bridge',async()=>{
 await bundleReady;const server=fixtureServer();let browser
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const base=`http://127.0.0.1:${server.address().port}`
  {
   const {context,page}=await startFixture(browser,base,'bank','bank-success');const selector=page.getByLabel('Completed reconciliation packet');const opts=await selector.locator('option').evaluateAll(items=>items.map(x=>({value:x.value,text:x.textContent})))
   assert.ok(opts.some(x=>x.value==='fictional-recon-2026-09'));assert.ok(opts.some(x=>x.value==='fictional-recon-2026-08'));assert.ok(!opts.some(x=>x.value==='fictional-recon-draft'))
   await selector.selectOption('fictional-recon-2026-08');await page.getByRole('button',{name:'CSV',exact:true}).click();await page.waitForFunction(()=>window.__BAR_FINANCE_CALLS__.some(x=>x.kind==='exportFile'))
   const exp=(await page.evaluate(()=>window.__BAR_FINANCE_CALLS__.filter(x=>x.kind==='exportFile')))[0]
   assert.equal(exp.operation,'exportBank');assert.deepEqual(exp.args,[{reconciliation_id:'fictional-recon-2026-08'}]);assert.equal(exp.format,'csv');assert.equal(exp.fixtureOnly,true)
   const unexpected=(await page.evaluate(()=>window.__BAR_FINANCE_CALLS__.filter(x=>x.kind==='invoke'&&!['getReadiness','getAccounts','getBank'].includes(x.operation))));assert.deepEqual(unexpected,[])
   await context.close()
  }
  {
   const {context,page}=await startFixture(browser,base,'bank','bank-none');const selector=page.getByLabel('Completed reconciliation packet');assert.equal(await selector.locator('option').count(),1)
   for(const name of ['JSON','XLSX','CSV','PDF'])assert.equal(await page.getByRole('button',{name,exact:true}).isDisabled(),true,`${name} disabled without a completed selection`)
   assert.equal((await page.evaluate(()=>window.__BAR_FINANCE_CALLS__)).filter(x=>x.kind==='exportFile').length,0);await context.close()
  }
  for(const outcome of ['cancel','error']){
   const {context,page}=await startFixture(browser,base,'bank',`bank-${outcome}`);await page.getByRole('button',{name:'PDF',exact:true}).click()
   await page.getByRole('alert').waitFor({state:'visible'})
   const exp=(await page.evaluate(()=>window.__BAR_FINANCE_CALLS__.filter(x=>x.kind==='exportFile')))[0];assert.equal(exp.operation,'exportBank');assert.equal(exp.format,'pdf');assert.deepEqual(exp.args,[{reconciliation_id:'fictional-recon-2026-09'}])
   await context.close()
  }
  {
   const {context,page}=await startFixture(browser,base,'bank','bank-noexport');assert.equal(await page.getByRole('button',{name:'JSON',exact:true}).count(),0);await context.close()
  }
  {
   const {context,page}=await startFixture(browser,base,'tax','tax-success');const selector=page.getByLabel('Approved tax return to export');const opts=await selector.locator('option').evaluateAll(items=>items.map(x=>({value:x.value,text:x.textContent})))
   assert.ok(opts.some(x=>x.value==='fictional-tax-approved'));assert.ok(opts.some(x=>x.value==='fictional-tax-filed'));assert.ok(!opts.some(x=>x.value==='fictional-tax-draft'));assert.ok(!opts.some(x=>x.value==='fictional-tax-reviewed'))
   await selector.selectOption('fictional-tax-filed');await page.getByRole('button',{name:'XLSX',exact:true}).click();await page.waitForFunction(()=>window.__BAR_FINANCE_CALLS__.some(x=>x.kind==='exportFile'))
   const exp=(await page.evaluate(()=>window.__BAR_FINANCE_CALLS__.filter(x=>x.kind==='exportFile')))[0];assert.equal(exp.operation,'exportTax');assert.deepEqual(exp.args,[{return_id:'fictional-tax-filed'}]);assert.equal(exp.format,'xlsx');await context.close()
  }
  {
   const {context,page}=await startFixture(browser,base,'tax','tax-none');const selector=page.getByLabel('Approved tax return to export');assert.equal(await selector.locator('option').count(),1)
   for(const name of ['JSON','XLSX','CSV','PDF'])assert.equal(await page.getByRole('button',{name,exact:true}).isDisabled(),true,`${name} disabled without approved/filed paper`)
   await context.close()
  }
  {
   const {context,page}=await startFixture(browser,base,'tax','tax-error');await page.getByRole('button',{name:'JSON',exact:true}).click();await page.getByRole('alert').waitFor({state:'visible'});assert.match(await page.getByRole('alert').innerText(),/Fictional incomplete-source export error/);await context.close()
  }
 }finally{if(browser)await browser.close();if(server.listening)await new Promise(resolve=>server.close(resolve))}
})

test('all inventoried finance controls have current source anchors and customer task coverage',()=>{
 const report=path.join(testEvidence,'finance-control-coverage-final.json')
 const result=spawnSync('python',[controlVerifier,'--candidate-dir',candidate,'--manual',path.join(candidate,'pdf',manualName),'--report',report],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024})
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr)
 const parsed=JSON.parse(result.stdout);assert.equal(parsed.control_count,36);assert.equal(parsed.passed,36);assert.match(parsed.claim_scope,/not an exhaustive inventory/)
})

test('exact v7 PDF pair is red for the three new workflows; scratch and final v8 PDF pairs are green',t=>{
 const v7Manual=path.join(v7,'pdf',manualName),v7Quick=path.join(v7,'pdf',quickName)
 assert.equal(hash(v7Manual),'07EF3DEB0B79F00BFF5645C09CCF82135341632D7B86F211E071C1CA8C5989A9','protected exact v7 manual hash')
 assert.equal(hash(v7Quick),'BA3685843E2A7CC0ED1DC885D245184D7BA46FF90B2D4600C42206F30250CF8F','protected exact v7 quick-start hash')
 const redPath=path.join(testEvidence,'exact-v7-red-evidence.json')
 const red=spawnSync('python',[verifier,'--manual',v7Manual,'--quick',v7Quick,'--candidate-dir',v7,'--expect','red','--report',redPath],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024})
 assert.equal(red.status,0,red.stdout+'\n'+red.stderr);const redReport=JSON.parse(red.stdout);assert.equal(redReport.red_evidence_validated,true);assert.equal(Object.values(redReport.required_red_findings).every(Boolean),true)
 const scratch=path.join(testTmp,'candidate-v8-source');fs.mkdirSync(scratch,{recursive:true});fs.cpSync(path.join(candidate,'content'),path.join(scratch,'content'),{recursive:true});fs.cpSync(path.join(candidate,'screenshots'),path.join(scratch,'screenshots'),{recursive:true});fs.copyFileSync(path.join(candidate,'build_candidate.py'),path.join(scratch,'build_candidate.py'));fs.copyFileSync(path.join(candidate,'finance-control-coverage.csv'),path.join(scratch,'finance-control-coverage.csv'));fs.mkdirSync(path.join(scratch,'evidence'),{recursive:true})
 const pythonBuild=String.raw`import importlib.util,json,sys
from pathlib import Path
source,clone=map(Path,sys.argv[1:3])
spec=importlib.util.spec_from_file_location('bar_v8_scratch_builder',source)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
module.HERE=clone;module.CONTENT=clone/'content/candidate-content.json'
data=json.loads(module.CONTENT.read_text(encoding='utf-8'))
a,b=module.build(data,clone/'pdf')
print(json.dumps({'manual':str(a),'quick':str(b)}))`
 const built=JSON.parse(execFileSync('python',['-c',pythonBuild,path.join(candidate,'build_candidate.py'),scratch],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024}))
 const scratchReportPath=path.join(testEvidence,'scratch-v8-green-evidence.json')
 const scratchCheck=spawnSync('python',[verifier,'--manual',built.manual,'--quick',built.quick,'--candidate-dir',scratch,'--expect','green','--report',scratchReportPath],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024})
 assert.equal(scratchCheck.status,0,scratchCheck.stdout+'\n'+scratchCheck.stderr);const scratchReport=JSON.parse(scratchCheck.stdout);assert.deepEqual(scratchReport.failed,[])
 const scratchControls=spawnSync('python',[controlVerifier,'--candidate-dir',scratch,'--manual',built.manual],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(scratchControls.status,0,scratchControls.stdout+'\n'+scratchControls.stderr)
 const finalReportPath=path.join(testEvidence,'final-v8-green-evidence.json')
 const final=spawnSync('python',[verifier,'--manual',path.join(candidate,'pdf',manualName),'--quick',path.join(candidate,'pdf',quickName),'--candidate-dir',candidate,'--expect','green','--report',finalReportPath],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024})
 assert.equal(final.status,0,final.stdout+'\n'+final.stderr);const finalReport=JSON.parse(final.stdout);assert.deepEqual(finalReport.failed,[])
 assert.equal(scratchReport.task_count,126);assert.equal(finalReport.task_count,126);assert.equal(scratchReport.manual.pages,finalReport.manual.pages);assert.equal(scratchReport.quick_start.pages,finalReport.quick_start.pages)
 assert.notEqual(hash(path.join(candidate,'pdf',manualName)),hash(v7Manual));assert.notEqual(hash(path.join(candidate,'pdf',quickName)),hash(v7Quick))
 fs.writeFileSync(path.join(testEvidence,'red-green-summary.json'),JSON.stringify({red:{source:'exact v7 PDFs',manual_sha256:hash(v7Manual),quick_sha256:hash(v7Quick),required_red_findings:redReport.required_red_findings},scratch:{manual_sha256:scratchReport.manual.sha256,quick_sha256:scratchReport.quick_start.sha256,task_count:scratchReport.task_count,failed:scratchReport.failed},final:{manual_sha256:finalReport.manual.sha256,quick_sha256:finalReport.quick_start.sha256,task_count:finalReport.task_count,failed:finalReport.failed}},null,2)+'\n')
})
