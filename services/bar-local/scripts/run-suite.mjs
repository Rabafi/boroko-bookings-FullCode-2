// Explicit discovery keeps bootstrap/maintenance scripts out of node --test.
import {readdirSync} from 'node:fs'
import {spawn} from 'node:child_process'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const discovered=readdirSync(path.join(root,'tests')).filter(name=>name.endsWith('.test.mjs')).sort()
// These integration cases alter or stop their source PostgreSQL cluster. Run
// them in a final child process; Node sorts test paths, so list ordering in one
// invocation cannot prevent a promotion from fencing later DB contracts.
// The API shift-readiness listener also runs alone because its Windows libuv
// server shutdown can race teardown of neighbouring HTTP test workers.
const isolatedFinal=['db-physical-recovery.test.mjs','db-planned-replacement.test.mjs','api-shift-readiness.test.mjs']
const regular=discovered.filter(name=>!isolatedFinal.includes(name))
const finalCases=isolatedFinal.filter(name=>discovered.includes(name))
if(regular.length===0&&finalCases.length===0) throw new Error('No local service test files were discovered.')
console.log(`Running ${discovered.length} explicit service test files; isolated HTTP-shutdown and destructive recovery cases run last.`)
async function run(files,label){
 if(files.length===0)return 0
 console.log(`${label}: ${files.length} test files`)
 return await new Promise(resolve=>{
  const child=spawn(process.execPath,['--test','--test-force-exit','--test-concurrency=1',...files.map(name=>path.join(root,'tests',name))],{
   cwd:root,stdio:'inherit',env:process.env,windowsHide:true
  })
  child.once('error',error=>{console.error(error.message);resolve(1)})
  child.once('exit',(code,signal)=>resolve(code??(signal?1:0)))
 })
}
const regularCode=await run(regular,'regular contracts')
process.exitCode=regularCode
if(regularCode===0){
 const finalCode=await run(finalCases,'isolated HTTP shutdown/recovery')
 process.exitCode=finalCode
}
