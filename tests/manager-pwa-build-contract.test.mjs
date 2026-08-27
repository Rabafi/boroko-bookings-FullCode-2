import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(resolve(root, file), 'utf8')

const appPackage = JSON.parse(read('package.json'))
const viteConfig = read('manager-pwa/vite.config.js')
const buildInfo = read('manager-pwa/src/lib/buildInfo.js')
const appUpdate = read('manager-pwa/src/lib/appUpdate.js')
const app = read('manager-pwa/src/App.jsx')
const more = read('manager-pwa/src/pages/More.jsx')
const serviceWorker = read('manager-pwa/public/sw.js')

test('Manager PWA build metadata comes from the root app and a Vite build identifier', () => {
  assert.match(viteConfig, /readFileSync\(path\.resolve\(__dirname, '\.\.\/package\.json'\)/)
  assert.match(viteConfig, /rootPackage\.version/)
  assert.match(viteConfig, /__BOROKO_APP_VERSION__/)
  assert.match(viteConfig, /__BOROKO_APP_BUILD_ID__/)
  assert.match(viteConfig, /Date\.now\(\)\.toString\(36\)/)
  assert.equal(typeof appPackage.version, 'string')
  assert.ok(appPackage.version.length > 0)
  assert.match(buildInfo, /APP_VERSION = fallback\(__BOROKO_APP_VERSION__/)
  assert.match(buildInfo, /APP_BUILD_ID = fallback\(__BOROKO_APP_BUILD_ID__/)
})

test('service-worker checks are build-aware without disabling runtime asset caching', () => {
  assert.match(buildInfo, /version: APP_VERSION, build: APP_BUILD_ID/)
  assert.match(app, /register\(serviceWorkerUrl\(\), \{ updateViaCache: 'none' \}\)/)
  assert.match(app, /checkForAppUpdate\(\)/)
  assert.match(appUpdate, /await registration\.update\(\)/)
  assert.match(appUpdate, /registration\.waiting/)
  assert.match(serviceWorker, /const CACHE = 'boroko-manager-v4'/)
  assert.match(serviceWorker, /cache\.put\(event\.request, clone\)/)
})

test('More and the global prompt expose installed versus waiting build state', () => {
  assert.match(more, /Installed v\{APP_VERSION\}/)
  assert.match(more, /New build ready: v\{updateState\.version\}/)
  assert.match(more, /checkForAppUpdate\(\)/)
  assert.match(more, /applyAppUpdate\(\)/)
  assert.match(app, /New build ready/)
  assert.match(app, /v\{updateState\.version\} · build/)
})

console.log('manager-pwa-build-contract: ok')
