import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {chromium} from 'playwright'
import {createServer} from 'node:http'
import {getCommand} from '../../packages/bar-contracts/dist/index.js'

const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const component=new URL('../../src/renderer/src/components/hospitality-pos/BarLocalFinanceWorkspace.jsx',import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1')
test('real browser finance forms submit valid guarded contracts and block incomplete reads', {timeout:120000},async()=>{
 const submitted=[]
 const pageErrors=[]
 const built=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Finance,{LOCAL_FINANCE_FORMS}from ${JSON.stringify(decodeURIComponent(component))};
 const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
 const rows={suppliers:[{id:id(1),name:'Synthetic supplier'}],ap_invoices:[{id:id(2),invoice_number:'DRAFT',status:'draft',version:1},{id:id(3),invoice_number:'APPROVED',status:'approved',version:1}],ap_payments:[{id:id(4),reference:'PAYMENT',status:'posted',amount:'10.00'}],bank_accounts:[{id:id(5),name:'Synthetic bank',version:1,active:true}],bank_statement_lines:[{id:id(6),external_ref:'STATEMENT',amount:'-10.00'}],journal_entries:[{id:id(7),memo:'Synthetic journal'}],payroll_runs:[{id:id(8),period_start:'2026-10-01',status:'draft',version:1},{id:id(9),period_start:'2026-10-01',status:'prepared',version:2}],tax_codes:[],tax_return_periods:[],bank_reconciliations:[],budgets:[]};
 const accounts=[['1100','Bank asset'],['2000','Payables'],['2100','Input tax'],['5000','Expenses'],['6200','Deductions']].map(([code,name])=>({code,name,active:true}));
 const bad=new URLSearchParams(location.search).has('incomplete');window.__forms=LOCAL_FINANCE_FORMS;
 function App(){const[blocked,setBlocked]=React.useState(false);return <Finance blocked={blocked} query={async(name,filters)=>({data:name==='accounting.accounts.list'?accounts:rows[filters.kind]??[],complete:!bad,scope:{business_id:id(20),outlet_id:id(21),device_id:id(22),actor_staff_id:id(23)},snapshot_watermark:1,pagination:{has_more:false,next_cursor:null},unavailable:[]})} onRun={async(command,payload,pin)=>{const response=await fetch('/command',{method:'POST',body:JSON.stringify({command,payload,pin})});const body=await response.json();if(!response.ok)throw new Error(body.message);if(new URLSearchParams(location.search).has('uncertain')){setBlocked(true);return null}return body}}/>};createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,jsx:'automatic',platform:'browser',define:{'process.env.NODE_ENV':'"development"'}})
 const bundle=built.outputFiles[0].text
 const server=createServer(async(req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle);return}
  if(req.url==='/command'){
   try{let body='';for await(const chunk of req)body+=chunk;const value=JSON.parse(body);const definition=getCommand(value.command)
    const payload={...value.payload}
    if(definition.approval){assert.match(value.pin,/^\d{4,12}$/);payload.approval_id=id(50)}
    definition.validate(payload);assert.ok(!Object.hasOwn(value.payload,'pin'))
    submitted.push(value);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,outcome:'committed_local',result:{}}))
   }catch(error){res.statusCode=400;res.end(JSON.stringify({message:error.message}))}
   return
  }
  res.setHeader('Content-Type','text/html');res.end('<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>')
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 let browser
 try{
  const executable=process.env.BAR_LOCAL_CHROMIUM_EXECUTABLE_PATH??process.env.LUNA_CHROMIUM_EXECUTABLE_PATH
  browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{})})
  const page=await browser.newPage();page.setDefaultTimeout(10000)
  page.on('pageerror',error=>pageErrors.push(error.message));page.on('dialog',dialog=>dialog.accept())
  const base=`http://127.0.0.1:${server.address().port}`
  await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort())
  await page.goto(base);await page.getByRole('button',{name:'Refresh finance records'}).waitFor()
  const forms=await page.evaluate(()=>window.__forms)
  const fill=async input=>{
   if(input.optional)return
   const control=page.getByLabel(input.label+(input.optional?' (optional)':''),{exact:true})
   if(input.type==='checkbox'){await control.check();return}
   if(input.type==='select'){
    if(input.choices){await control.selectOption(input.initial??input.choices[0]);return}
    if(input.optional)return
    const values=await control.locator('option').evaluateAll(options=>options.map(option=>option.value).filter(Boolean))
    const preferred=input.source==='accounts'?(input.key.includes('expense')?'5000':input.key.includes('tax')?'2100':input.key.includes('deductions')?'6200':input.key.includes('payable')?'2000':'1100'):values[0]
    assert.ok(preferred,`No selectable ${input.label}`);await control.selectOption(preferred);return
   }
   let value=input.initial??'SYNTHETIC'
   if(input.type==='date')value='2026-10-26'
   if(input.type==='month')value='2026-10'
   if(input.type==='decimal')value=input.key.includes('rate')?'0.14':input.key==='quantity'?'1':input.key==='deductions'?'0.00':'10.00'
   if(input.key==='amount'&&input.label==='Amount'&&await page.getByRole('button',{name:'Bank statement lines',exact:true}).count())value='-10.00'
   await control.fill(value)
  }
  for(const form of forms){
   await page.getByLabel('Action',{exact:true}).selectOption({label:form.title})
   for(const input of form.fields)await fill(input)
   if(form.command==='accounting.journal.post'){
    await page.getByRole('button',{name:'Add line',exact:true}).click()
    const lineCards=page.locator('form div.rounded.border-slate-700.p-3')
    for(let index=0;index<2;index++){
     const card=lineCards.nth(index)
     await card.getByLabel('Ledger account',{exact:true}).selectOption(index===0?'5000':'1100')
     await card.getByLabel('Debit',{exact:true}).fill(index===0?'10.00':'0.00')
     await card.getByLabel('Credit',{exact:true}).fill(index===0?'0.00':'10.00')
    }
   }else for(const input of form.lines??[])await fill(input)
   if(form.command==='accounting.bank.reconcile')await page.getByLabel('Matching journal (optional)',{exact:true}).selectOption(id(7))
   if(form.approval)await page.getByLabel('Different authorised approver PIN',{exact:true}).fill('5678')
   await page.getByRole('button',{name:form.title,exact:true}).click()
   const outcome=await Promise.race([
    page.getByRole('status').filter({hasText:'Committed by the local authority'}).waitFor().then(()=> 'committed'),
    page.getByRole('alert').waitFor().then(()=> 'rejected')
   ])
   assert.equal(outcome,'committed',`${form.title} was rejected; page shows: ${await page.locator('body').innerText()}`)
   await page.getByRole('button',{name:'Refresh finance records'}).waitFor()
  }
  assert.equal(submitted.length,forms.length)
  const invoice=submitted.find(value=>value.command==='accounting.ap.invoice.upsert')
  assert.equal(invoice.payload.total,'11.40');assert.equal(invoice.payload.tax_total,'1.40')
  const finalise=submitted.find(value=>value.command==='accounting.payroll_run.finalise')
  assert.equal(finalise.payload.expected_version,2)
  await page.goto(base+'?incomplete');await page.getByRole('alert').first().waitFor()
  assert.equal(await page.getByRole('button',{name:'Supplier invoice',exact:true}).isDisabled(),true)
  assert.equal(submitted.length,forms.length)
  await page.goto(base+'?uncertain');await page.getByRole('button',{name:'Refresh finance records'}).waitFor()
  await page.getByLabel('Action',{exact:true}).selectOption({label:'Prepare tax draft'})
  await page.getByLabel('Accounting month',{exact:true}).fill('2026-10')
  await page.getByRole('button',{name:'Prepare tax draft',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'No committed result'}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Prepare tax draft',exact:true}).isDisabled(),true)
  assert.equal(submitted.length,forms.length+1)
  assert.deepEqual(pageErrors,[])
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
})
