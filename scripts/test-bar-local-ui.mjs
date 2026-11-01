// Reuse an installed browser; this runner never downloads browser binaries.
import {existsSync,readdirSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const env={...process.env}
let executable=env.BAR_LOCAL_CHROMIUM_EXECUTABLE_PATH??env.LUNA_CHROMIUM_EXECUTABLE_PATH??chromium.executablePath()
if(!existsSync(executable)&&process.platform==='win32'&&env.LOCALAPPDATA){
 const cache=path.join(env.LOCALAPPDATA,'ms-playwright')
 if(existsSync(cache)){
  const installed=readdirSync(cache).filter(name=>/^chromium_headless_shell-\d+$/.test(name)).sort((a,b)=>Number(b.split('-').at(-1))-Number(a.split('-').at(-1)))
  for(const name of installed){
   const candidate=path.join(cache,name,'chrome-headless-shell-win64','chrome-headless-shell.exe')
   if(existsSync(candidate)){executable=candidate;break}
  }
 }
}
if(!existsSync(executable))throw Error('No installed Chromium was found. Set BAR_LOCAL_CHROMIUM_EXECUTABLE_PATH to an installed compatible browser. No tests were skipped or browser downloaded.')
env.BAR_LOCAL_CHROMIUM_EXECUTABLE_PATH=executable
async function run(command,args){
 const child=spawn(command,args,{cwd:root,env,stdio:'inherit',windowsHide:true})
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1))})
 if(code!==0)process.exit(Number(code))
}
if(process.platform==='win32')await run(process.env.ComSpec??'cmd.exe',['/d','/s','/c','npm --prefix packages/bar-contracts run build'])
else await run('npm',['--prefix','packages/bar-contracts','run','build'])
await run(process.execPath,['--test','--test-concurrency=1',
 'tests/bar-local/invoice-math.test.mjs','tests/bar-local/finance-browser.test.mjs',
 'tests/bar-local/handover-browser.test.mjs','tests/bar-local/operator-controls-browser.test.mjs',
 'tests/bar-local/startup-browser.test.mjs'])
