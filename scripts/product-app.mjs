import { spawn } from 'node:child_process'
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

const electronViteCli = path.join(rootDir, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
const electronBuilderCli = path.join(rootDir, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')

if (action === 'dev') await runNode(electronViteCli, ['dev'])
if (action === 'build') await runNode(electronViteCli, ['build'])
if (action === 'dist') {
  await runNode(electronViteCli, ['build'])
  await runNode(electronBuilderCli, ['--config', `apps/${productId}/electron-builder.json`, '--win', 'nsis', '--publish', 'never'])
}
if (action === 'publish') {
  await runNode(electronViteCli, ['build'])
  await runNode(electronBuilderCli, ['--config', `apps/${productId}/electron-builder.json`, '--win', 'nsis', '--publish', 'always'])
}
