import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {chromium} from 'playwright'
import {createServer} from 'node:http'
import {fileURLToPath} from 'node:url'
import {getCommand} from '../../packages/bar-contracts/dist/index.js'

test('handover form requires both operators, preserves uncertain input and refuses incomplete drawer reads',{timeout:60000},async()=>{
 const component=fileURLToPath(new URL('../../src/renderer/src/components/hospitality-pos/BarLocalDrawerHandover.jsx',import.meta.url))
 const id=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`
 const submitted=[],errors=[]
 const built=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Handover from ${JSON.stringify(component)};
 const id=n=>'20000000-0000-4000-8000-'+String(n).padStart(12,'0');const params=new URLSearchParams(location.search);
 function App(){const[blocked,setBlocked]=React.useState(false);return <Handover shift={{shift_id:id(1)}} blocked={blocked} query={async()=>({data:[{shift_id:id(2),staff_id:id(3),display_name:'Outgoing cashier',opened_at:'2026-10-26T09:00:00Z'}],complete:!params.has('incomplete'),scope:{business_id:id(4),outlet_id:id(5)},snapshot_watermark:1,pagination:{has_more:false}})} onApproved={async(command,payload,pin)=>{await fetch('/command',{method:'POST',body:JSON.stringify({command,payload,pin})});if(params.has('uncertain')){setBlocked(true);return null}return {outcome:'committed_local'}}}/>};createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,jsx:'automatic',platform:'browser'})
 const server=createServer(async(req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(built.outputFiles[0].text);return}
  if(req.url==='/command'){
   let body='';for await(const chunk of req)body+=chunk
   const value=JSON.parse(body)
   try{getCommand(value.command).validate({...value.payload,approval_id:id(6)});assert.equal(value.pin,'5678');assert.equal(value.payload.receiver_confirmed,true);assert.ok(!('pin'in value.payload));submitted.push(value);res.end('{}')}
   catch(error){errors.push(error.message);res.statusCode=400;res.end('{}')}return
  }
  res.end('<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>')
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser
 try{
  const executable=process.env.BAR_LOCAL_CHROMIUM_EXECUTABLE_PATH??process.env.LUNA_CHROMIUM_EXECUTABLE_PATH
  browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{})})
  const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept())
  const base=`http://127.0.0.1:${server.address().port}`
  const fill=async()=>{
   await page.getByLabel('Outgoing operator',{exact:true}).selectOption(id(2))
   await page.getByLabel('Cash received',{exact:true}).fill('30.00')
   await page.getByLabel('Handover reason',{exact:true}).fill('Counted cash transfer')
   await page.getByLabel('Outgoing operator PIN',{exact:true}).fill('5678')
  }
  await page.goto(base);await fill()
  assert.equal(await page.getByRole('button',{name:'Approve and record handover'}).isDisabled(),true)
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Approve and record handover'}).click()
  await page.getByRole('status').filter({hasText:'confirmed both drawer entries'}).waitFor()
  assert.equal(submitted.length,1);assert.equal(await page.getByLabel('Cash received',{exact:true}).inputValue(),'')
  await page.goto(base+'?uncertain');await fill();await page.getByRole('checkbox').check()
  await page.getByRole('button',{name:'Approve and record handover'}).click()
  await page.getByRole('alert').filter({hasText:'not confirmed'}).waitFor()
  assert.equal(await page.getByLabel('Cash received',{exact:true}).inputValue(),'30.00')
  assert.equal(await page.getByRole('button',{name:'Approve and record handover'}).isDisabled(),true)
  await page.goto(base+'?incomplete');await page.getByRole('alert').filter({hasText:'incomplete'}).waitFor()
  assert.equal(await page.getByLabel('Outgoing operator',{exact:true}).isDisabled(),true)
  assert.equal(submitted.length,2);assert.deepEqual(errors,[])
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
})
