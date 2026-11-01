import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, writeFile, readFile, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const parent = path.join(root, '.tmp', 'bar-startup-electron')
await mkdir(parent, { recursive: true })
const work = await mkdtemp(path.join(parent, 'synthetic-'))
await build({ entryPoints: [path.join(root, 'src/main/bar-local/electronRuntime.js')], bundle: true,
  platform: 'node', format: 'cjs', target: 'node24', outfile: path.join(work, 'runtime.cjs') })
await copyFile(path.join(root, 'tests/bar-local/fixtures/startup-electron-relaunch.cjs'), path.join(work, 'main.cjs'))
await writeFile(path.join(work, 'preload.cjs'), `const {ipcRenderer}=require('electron');
window.addEventListener('DOMContentLoaded',()=>{ipcRenderer.invoke('barLocal:selectCloudWorkspace').catch(error=>console.error(error.message))},{once:true});`)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const child = spawn(createRequire(import.meta.url)('electron'), [path.join(work, 'main.cjs'), work],
  { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let stdout = '', stderr = '', finished = false
child.stdout.on('data', chunk => { stdout += chunk })
child.stderr.on('data', chunk => { stderr += chunk })
const ended = new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', code => { finished = true; resolve(code) })
})
const timeout = setTimeout(() => { if (!finished) child.kill() }, 60000)
try {
  const code = await ended
  if (code !== 0) throw Error(`Initial startup probe exited ${code}.`)
  const deadline = Date.now() + 60000
  let result
  while (Date.now() < deadline) {
    const failure = await readFile(path.join(work, 'error.json'), 'utf8').catch(() => null)
    if (failure) throw Error(`Native startup probe failed: ${failure}`)
    const text = await readFile(path.join(work, 'result.json'), 'utf8').catch(() => null)
    if (text) { result = JSON.parse(text); break }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  if (result?.passed !== true) throw Error('The fresh Electron runtime did not report a successful restart.')
  console.log(JSON.stringify({ ...result, directory: work }))
} finally {
  clearTimeout(timeout)
  await writeFile(path.join(work, 'initial-stdout.log'), stdout)
  await writeFile(path.join(work, 'initial-stderr.log'), stderr)
}
