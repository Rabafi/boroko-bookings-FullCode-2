import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { PRODUCT_IDS } from '../packages/product-config/index.js'

const [productId, action] = process.argv.slice(2)
const validActions = new Set(['dev', 'build', 'dist', 'publish'])
if (!PRODUCT_IDS.includes(productId) || !validActions.has(action)) {
  throw new Error(`Usage: node scripts/product-app.mjs <${PRODUCT_IDS.join('|')}> <dev|build|dist|publish>`)
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...process.env, BOROKO_PRODUCT: productId }

function runNode(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: rootDir, env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(script)} ${args.join(' ')} exited with ${code}`)))
  })
}

function runNpm(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: rootDir, env, stdio: 'inherit', shell: process.platform === 'win32' })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`npm ${args.join(' ')} exited with ${code}`)))
  })
}

const electronViteCli = path.join(rootDir, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
const electronBuilderCli = path.join(rootDir, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
const serverPayload = path.join(rootDir, 'build', 'bar-local-server')

// Automatic Bar server setup installs only from the payload staged at build
// time. A normal build must fail closed when that payload is absent rather
// than shipping a setup screen that cannot work. Local development may omit
// it so unrelated work can still run; the setup screen then explains that the
// server package is missing.
async function ensureServerPayload({ required }) {
  if (productId !== 'hospitality-pos' || process.env.BAR_LOCAL_SKIP_SERVER_STAGE === '1') return
  if (existsSync(path.join(serverPayload, 'manifest.json'))) return
  if (!required) {
    console.warn('[product-app] Local Bar server payload is not staged. Automatic server setup will be unavailable in this development build. Run: npm run bar-local:stage')
    return
  }
  if (!existsSync(path.join(rootDir, 'services', 'bar-local', 'dist', 'server.js'))) {
    await runNpm(['--prefix', 'services/bar-local', 'run', 'build'])
  }
  await runNode(path.join(rootDir, 'scripts', 'stage-bar-local-server.mjs'), [])
}

if (action === 'dev') {
  await ensureServerPayload({ required: false })
  await runNode(electronViteCli, ['dev'])
}
if (action === 'build') {
  await ensureServerPayload({ required: true })
  await runNode(electronViteCli, ['build'])
}
if (action === 'dist') {
  await ensureServerPayload({ required: true })
  await runNode(electronViteCli, ['build'])
  await runNode(electronBuilderCli, ['--config', `apps/${productId}/electron-builder.json`, '--win', 'nsis', '--publish', 'never'])
}
if (action === 'publish') {
  await ensureServerPayload({ required: true })
  await runNode(electronViteCli, ['build'])
  await runNode(electronBuilderCli, ['--config', `apps/${productId}/electron-builder.json`, '--win', 'nsis', '--publish', 'always'])
}
