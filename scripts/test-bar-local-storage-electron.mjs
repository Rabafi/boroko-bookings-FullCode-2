import {build} from 'esbuild'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdir,mkdtemp,writeFile,realpath,rm} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const parent=path.join(root,'.tmp','bar-sqlite-electron-smoke')
await mkdir(parent,{recursive:true})
const work=await mkdtemp(path.join(parent,'synthetic-'))
const bundle=path.join(work,'sqlite-intents.cjs')
await build({stdin:{contents:"export {openSqliteIntentJournal} from './src/main/bar-local/sqliteIntents.js';export {journalProtection} from './src/shared/barLocalJournalProtection.js';",resolveDir:root},bundle:true,platform:'node',format:'cjs',target:'node24',outfile:bundle})
const electron=createRequire(import.meta.url)('electron')
async function runProbe(name,fixture,env,extra=[]){
const child=spawn(electron,[path.join(root,'tests/bar-local/fixtures',fixture),bundle,work,...extra],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']})
let stdout='',stderr='',timedOut=false
child.stdout.on('data',chunk=>{stdout+=chunk})
child.stderr.on('data',chunk=>{stderr+=chunk})
const timer=setTimeout(()=>{timedOut=true;child.kill()},60000)
let code
try{code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1))})}finally{clearTimeout(timer)}
await writeFile(path.join(work,name+'-stdout.log'),stdout)
await writeFile(path.join(work,name+'-stderr.log'),stderr)
if(code!==0||timedOut)throw Error(`Bundled SQLite/Electron smoke failed (${code}${timedOut?', timeout':''}); evidence: ${work}\n${stderr}`)
const result=JSON.parse(stdout.trim())
if(result.state!=='committed_local'||result.revision!==5||result.backend!=='SqliteFrameStore'||!result.electron)throw Error('Bundled SQLite/Electron probe returned an incomplete result.')
return result
}
const node=await runProbe('node','sqlite-electron-smoke.cjs',{...process.env,ELECTRON_RUN_AS_NODE:'1'})
const nativeEnv={...process.env};delete nativeEnv.ELECTRON_RUN_AS_NODE;delete nativeEnv.ELECTRON_RENDERER_URL
const main=await runProbe('main','sqlite-electron-main-smoke.cjs',nativeEnv)
if(main.os_secure_storage!==true)throw Error('The real Electron main-process secure-storage probe did not pass.')
const restart=await runProbe('restart','sqlite-electron-reopen-smoke.cjs',nativeEnv,[main.synthetic_directory,main.operation_id])
if(restart.os_secure_storage!==true||restart.operation_id!==main.operation_id||restart.process_restart!==true)throw Error('OS-protected journal recovery in a separate Electron process did not pass.')
const nativeDir=await realpath(main.synthetic_directory),actualWork=await realpath(work)
if(!nativeDir.startsWith(actualWork+path.sep)||!path.basename(nativeDir).startsWith('native-'))throw Error('Unexpected native probe cleanup path')
await rm(nativeDir,{recursive:true})
delete main.synthetic_directory
await writeFile(path.join(work,'result.json'),JSON.stringify({node,main,restart},null,2))
console.log(JSON.stringify({node,main,restart,evidence:work}))
