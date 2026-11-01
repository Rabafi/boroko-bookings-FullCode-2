import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {chromium} from 'playwright'
import {createServer} from 'node:http'
import {fileURLToPath} from 'node:url'
import {getCommand} from '../../packages/bar-contracts/dist/index.js'

test('staff, loyalty and tip controls submit guarded contracts and preserve uncertainty',{timeout:90000},async()=>{
 const component=name=>fileURLToPath(new URL(`../../src/renderer/src/components/hospitality-pos/${name}.jsx`,import.meta.url))
 const id=n=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`
 const submissions=[],errors=[]
 const built=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';
 import Staff from ${JSON.stringify(component('BarLocalStaffStatus'))};
 import Loyalty from ${JSON.stringify(component('BarLocalLoyaltyAdjustment'))};
 import Tips from ${JSON.stringify(component('BarLocalTipActions'))};
 const id=n=>'30000000-0000-4000-8000-'+String(n).padStart(12,'0');const params=new URLSearchParams(location.search);
 function App(){const[blocked,setBlocked]=React.useState(false);const[committed,setCommitted]=React.useState(false);
 const run=async(command,payload,pin)=>{const response=await fetch('/command',{method:'POST',body:JSON.stringify({command,payload,pin})});if(!response.ok)throw Error(await response.text());if(params.has('uncertain')){setBlocked(true);return null}setCommitted(true);return {outcome:'committed_local'}};
 const staff=[{staff_id:id(1),display_name:'Current owner',role:'owner',status:'active'},{staff_id:id(2),display_name:'Other cashier',role:'cashier',status:'active'}];
 const query=async name=>({data:name==='sales.list'?[{sale_id:id(5),status:'returned',original_sale_id:null,receipt_number:1,total:'15.00',tip:'5.00'}]:name==='drawer.open_shifts'?[{shift_id:id(10),staff_id:id(11),display_name:'Recovery manager',opened_at:'2026-10-29T09:00:00Z'}]:[{id:id(6),staff_id:id(2),display_name:'Other cashier',amount:'2.50',status:'paid',shift_status:'closed',paid_at:'2026-10-26T10:00:00Z'}],complete:!params.has('incomplete'),scope:{business_id:id(3),outlet_id:id(4)},snapshot_watermark:1,pagination:{has_more:false}});
 return <>{params.get('mode')==='staff'?<Staff actor={staff[0]} staffRows={staff} blocked={blocked} onApproved={run}/>:params.get('mode')==='loyalty'?<Loyalty customers={[{customer_id:id(7),name:'Synthetic customer'}]} blocked={blocked} onApproved={run} onCommitted={async()=>{if(params.has('refreshfail'))throw Error('Read failed')}}/>:<Tips query={query} staffRows={staff} shift={{shift_id:id(8)}} blocked={blocked} canReadSales={true} onRun={run}/>}{committed&&<p data-testid="committed">Confirmed</p>}</>};createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,jsx:'automatic',platform:'browser'})
 const server=createServer(async(req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(built.outputFiles[0].text);return}
  if(req.url==='/command'){
   try{let body='';for await(const chunk of req)body+=chunk;const value=JSON.parse(body),definition=getCommand(value.command)
    if(definition.approval){assert.match(value.pin,/^\d{4,12}$/);definition.validate({...value.payload,approval_id:id(9)})}else definition.validate(value.payload)
    assert.ok(!('pin'in value.payload));submissions.push(value);res.end('{}')
   }catch(error){errors.push(error.message);res.statusCode=400;res.end(error.message)}return
  }
  res.end('<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>')
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser
 try{
  const executable=process.env.BAR_LOCAL_CHROMIUM_EXECUTABLE_PATH??process.env.LUNA_CHROMIUM_EXECUTABLE_PATH
  browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{})})
  const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept())
  const base=`http://127.0.0.1:${server.address().port}`
  await page.goto(base+'?mode=staff')
  assert.equal(await page.getByLabel('Staff member',{exact:true}).locator('option').filter({hasText:'Current owner'}).count(),0)
  await page.getByLabel('Staff member',{exact:true}).selectOption(id(2));await page.getByLabel('Reason',{exact:true}).fill('Suspend reviewed access')
  await page.getByLabel('Different authorised approver PIN',{exact:true}).fill('5678');await page.getByRole('button',{name:'Suspend selected staff'}).click()
  await page.getByTestId('committed').waitFor();assert.equal(submissions.at(-1).command,'staff.status');assert.equal(submissions.at(-1).payload.status,'suspended')
  await page.goto(base+'?mode=loyalty&refreshfail')
  await page.getByLabel('Correction customer',{exact:true}).selectOption(id(7));await page.getByLabel('Whole points (+ or −)',{exact:true}).fill('-5')
  await page.getByLabel('Correction reason',{exact:true}).fill('Correct reviewed balance');await page.getByLabel('Different authorised approver PIN',{exact:true}).fill('5678')
  await page.getByRole('button',{name:'Approve points correction'}).click();await page.getByRole('alert').filter({hasText:'committed, but the balance'}).waitFor()
  assert.equal(submissions.at(-1).payload.points,'-5');assert.equal(await page.getByLabel('Whole points (+ or −)',{exact:true}).inputValue(),'')
  await page.goto(base+'?mode=tips');await page.getByRole('button',{name:'Refresh tip records'}).waitFor()
  await page.getByLabel('Tip staff member',{exact:true}).selectOption(id(2));await page.getByLabel('Amount',{exact:true}).fill('2.50')
  await page.getByLabel('Tip source sale',{exact:true}).selectOption(id(5));await page.getByLabel('Allocation points (optional)',{exact:true}).fill('1.25')
  await page.getByRole('button',{name:'Allocate tip',exact:true}).click();await page.getByRole('status').filter({hasText:'Tip operation committed'}).waitFor()
  assert.equal(submissions.at(-1).command,'workforce.tip.allocate');assert.equal(submissions.at(-1).payload.points,'1.25')
  await page.getByRole('button',{name:'Refresh tip records'}).waitFor();await page.getByLabel('Tip action',{exact:true}).selectOption('payout')
  await page.getByLabel('Amount',{exact:true}).fill('2.50');await page.getByLabel('Reason',{exact:true}).fill('Counted tip payout');await page.getByLabel('Different authorised approver PIN',{exact:true}).fill('5678')
  await page.getByRole('button',{name:'Approve tip payout',exact:true}).click();await page.getByRole('status').filter({hasText:'Tip operation committed'}).waitFor()
  assert.equal(submissions.at(-1).command,'workforce.tip.payout')
  await page.getByRole('button',{name:'Refresh tip records'}).waitFor();await page.getByLabel('Tip action',{exact:true}).selectOption('reverse')
  await page.getByLabel('Paid tip payout',{exact:true}).selectOption(id(6));await page.getByLabel('Tip reversal recovery drawer',{exact:true}).selectOption(id(10));await page.getByLabel('Reason',{exact:true}).fill('Wrong cash recipient');await page.getByLabel('Different authorised approver PIN',{exact:true}).fill('5678')
  await page.getByRole('button',{name:'Approve payout reversal'}).click();await page.getByRole('status').filter({hasText:'Tip operation committed'}).waitFor()
  assert.equal(submissions.at(-1).command,'workforce.tip.payout.reverse')
  assert.equal(submissions.at(-1).payload.recovery_shift_id,id(10))
  await page.goto(base+'?mode=tips&incomplete');await page.getByRole('alert').filter({hasText:'incomplete'}).waitFor()
  assert.equal(await page.getByLabel('Tip action',{exact:true}).isDisabled(),true)
  assert.equal(submissions.length,5);assert.deepEqual(errors,[])
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
})
