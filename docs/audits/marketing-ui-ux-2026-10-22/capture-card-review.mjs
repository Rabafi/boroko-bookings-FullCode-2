import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
const root=process.cwd();
const require=createRequire(path.join(root,'package.json'));
const {chromium}=require('playwright');
const out=path.join(root,'docs/audits/marketing-ui-ux-2026-10-22/visual-review');
await fs.mkdir(out,{recursive:true});
const config=await fs.readFile('marketing-site/netlify.toml','utf8');
const csp=config.match(/Content-Security-Policy = "([^"]+)"/)[1];
const server=http.createServer(async(req,res)=>{try{let url=new URL(req.url,'http://localhost');let rel=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1);let f=path.join(root,'marketing-site',rel);let body=await fs.readFile(f);res.setHeader('Content-Security-Policy',csp);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.jpg':'image/jpeg'})[path.extname(f)]||'application/octet-stream');res.end(body)}catch{res.writeHead(404);res.end('Not found')}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;

let browser;const result=[];try{browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,timeout:25000});for(const width of [1440,390]){const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});await context.addInitScript(()=>localStorage.setItem('boroko-cookie-consent','denied'));await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.fulfill({status:200,body:'{}',contentType:'application/json'}));const page=await context.newPage();for(const [name,index,label]of [['index',12,'suite-cards'],['manager-app',3,'phone-cards'],['restaurant-pos',12,'photo-cards'],['booking-site',3,'booking-proof']]){await page.goto(base+'/'+name+'.html');await page.locator('img').nth(index).scrollIntoViewIfNeeded();await page.waitForTimeout(350);await page.evaluate(async()=>{await Promise.all([...document.images].filter(i=>i.complete).map(i=>i.decode().catch(()=>{})))});await page.screenshot({path:path.join(out,label+'-'+width+'.png')});result.push({name,width,index,file:label+'-'+width+'.png'});}await context.close();}}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));await fs.writeFile(path.join(out,'card-captures.json'),JSON.stringify(result,null,2))}console.log(JSON.stringify(result));