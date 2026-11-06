import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
const root=process.cwd();
const require=createRequire(path.join(root,'package.json'));
const {chromium}=require('playwright');
const out=path.join(root,'docs/audits/marketing-ui-ux-2026-10-22');
await fs.mkdir(out,{recursive:true});
const config=await fs.readFile('marketing-site/netlify.toml','utf8');
const csp=config.match(/Content-Security-Policy = "([^"]+)"/)[1];
const server=http.createServer(async(req,res)=>{try{let url=new URL(req.url,'http://localhost');let rel=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1);let f=path.join(root,'marketing-site',rel);let body=await fs.readFile(f);res.setHeader('Content-Security-Policy',csp);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.jpg':'image/jpeg'})[path.extname(f)]||'application/octet-stream');res.end(body)}catch{res.writeHead(404);res.end('Not found')}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
let browser;
const result={date:'2026-10-22',base,csp,pages:[],interactions:[]};
try{
browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,timeout:25000});
for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:900}});
 await context.route('**/*',async route=>{let url=new URL(route.request().url());if(url.origin===base)return route.continue(); if(url.hostname==='api.github.com')return route.fulfill({json:{tag_name:'v9.9.9',assets:[{name:'audit-x64.exe',browser_download_url:'https://example.invalid/audit.exe'}]}});return route.fulfill({status:200,contentType:'application/json',body:'{}'});});
 const page=await context.newPage();
 for(const name of ['index','lodge-app','hotel','restaurant-pos','bar-pos','packages','enterprise','contact','download','manager-app','booking-site']){
  const errors=[];const consoleErrors=[];
  const onError=e=>errors.push(e.message);const onConsole=m=>{if(m.type()==='error')consoleErrors.push(m.text())};page.on('pageerror',onError);page.on('console',onConsole);
  await page.goto(base+'/'+name+'.html',{waitUntil:'load'});await page.waitForTimeout(400);
  const metrics=await page.evaluate(()=>({title:document.title,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,words:document.body.innerText.trim().split(/\s+/).length,headings:[...document.querySelectorAll('h1,h2')].map(x=>x.textContent.trim()),images:[...document.images].filter(x=>!x.complete||x.naturalWidth===0).map(x=>x.getAttribute('src')),nav:[...document.querySelectorAll('header nav a')].map(x=>({text:x.textContent,rect:{x:x.getBoundingClientRect().x,y:x.getBoundingClientRect().y,w:x.getBoundingClientRect().width,h:x.getBoundingClientRect().height}})),version:document.querySelector('#download-version')?.textContent,inlineScripts:[...document.scripts].filter(x=>!x.src&&x.type!=='application/ld+json').length}));
  result.pages.push({name,width,...metrics,errors,consoleErrors});
  if(['index','hotel','restaurant-pos','bar-pos','packages','enterprise'].includes(name))await page.screenshot({path:path.join(out,name+'-'+width+'.png')});
  if(name==='enterprise'){await page.locator('[value="payment_gateway"]').check();result.interactions.push({name:'hotel-quote-selection-'+width,summary:await page.locator('#summary-addons').innerText()});}
  if(name==='hotel'&&width===390){await page.locator('.menu-toggle').click();await page.keyboard.press('Escape');result.interactions.push({name:'mobile-escape',open:await page.locator('#mobile-overlay').getAttribute('aria-hidden')});}
  if(name==='index'&&width===1440){await page.locator('.hero-actions [data-action="download"]').first().click();result.interactions.push({name:'modal-focus',value:await page.evaluate(()=>({tag:document.activeElement.tagName,text:document.activeElement.textContent,dialog:!!document.querySelector('[role="dialog"],[aria-modal="true"]')}))});await page.keyboard.press('Escape');result.interactions.push({name:'modal-escape',open:await page.locator('.download-modal').evaluate(x=>x.classList.contains('is-open'))});}
  page.off('pageerror',onError);page.off('console',onConsole);
 }
 await context.close();
}
// Local-only submission simulation. No real leads, emails, or analytics are sent.
const context=await browser.newContext({bypassCSP:true});const requests=[];
await context.route('**/*',async route=>{const req=route.request();const url=new URL(req.url());if(url.origin===base)return route.continue();requests.push({url:req.url(),method:req.method(),payload:req.postData()});if(url.hostname==='api.github.com')return route.fulfill({json:{tag_name:'v9.9.9',assets:[{name:'audit-x64.exe',browser_download_url:'https://example.invalid/audit.exe'}]}});return route.fulfill({status:url.pathname.includes('marketing_leads')?500:200,contentType:'application/json',body:'{}'});});
const page=await context.newPage();await page.goto(base+'/bar-pos.html');await page.locator('[data-action="download"]').first().click();for(const [name,value]of Object.entries({lodgeName:'AUDIT ONLY',contactName:'Audit',email:'audit@example.invalid'}))await page.locator('#download-form [name="'+name+'"]').fill(value);await page.locator('#download-form [type="submit"]').click();await page.waitForTimeout(1200);result.interactions.push({name:'lead-http500',url:page.url(),requests});await context.close();
}catch(e){result.error=e.stack;console.error(e)}finally{await fs.writeFile(path.join(out,'browser-evidence.json'),JSON.stringify(result,null,2));if(browser)await browser.close();await new Promise(r=>server.close(r));}console.log(JSON.stringify({pages:result.pages.length,interactions:result.interactions,error:result.error}));