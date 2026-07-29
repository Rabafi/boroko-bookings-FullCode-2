import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { execSync } from 'child_process'

const ROOT = resolve(import.meta.dirname, '..')

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(ROOT, relativePath), 'utf8'))
}

describe('build configuration', () => {
  it('root package.json declares workspace products and build script', () => {
    const pkg = readJson('package.json')
    assert.ok(pkg.scripts.build, 'root must have a build script')
    assert.ok(pkg.workspaces, 'root must declare workspaces')
    assert.ok(pkg.workspaces.includes('apps/*'), 'workspaces must include apps/*')
  })

  it('each product app has a build script in its own package.json', () => {
    const products = ['lodge-camp', 'hotel', 'hospitality-pos']
    for (const product of products) {
      const appPkg = readJson(`apps/${product}/package.json`)
      assert.ok(
        appPkg.scripts?.build,
        `apps/${product}/package.json must have a build script`
      )
      assert.ok(
        appPkg.scripts?.dist,
        `apps/${product}/package.json must have a dist script`
      )
    }
  })

  it('scripts/product-app.mjs exists', () => {
    const scriptPath = resolve(ROOT, 'scripts/product-app.mjs')
    assert.ok(existsSync(scriptPath), 'scripts/product-app.mjs must exist')
  })

  it('scripts/verify-product-workspace.mjs exists', () => {
    const scriptPath = resolve(ROOT, 'scripts/verify-product-workspace.mjs')
    assert.ok(existsSync(scriptPath), 'scripts/verify-product-workspace.mjs must exist')
  })

  it('verify-product-workspace.mjs runs successfully', () => {
    const result = execSync('node scripts/verify-product-workspace.mjs', {
      cwd: ROOT,
      encoding: 'utf8'
    })
    assert.ok(result.includes('ok'), 'workspace verification should report ok')
  })

  it('electron-vite config file exists and is parseable', () => {
    const configFiles = ['electron.vite.config.js', 'electron.vite.config.mjs']
    const found = configFiles.find(f => existsSync(resolve(ROOT, f)))
    assert.ok(found, `none of [${configFiles.join(', ')}] found in root`)
    const content = readFileSync(resolve(ROOT, found), 'utf8')
    assert.ok(content.includes('defineConfig'), 'config must use defineConfig')
    assert.ok(content.includes('productId'), 'config must reference BOROKO_PRODUCT')
    assert.ok(content.includes('outDir'), 'config must declare outDir')
  })

  it('each product has product.json and electron-builder.json', () => {
    const products = ['lodge-camp', 'hotel', 'hospitality-pos']
    for (const product of products) {
      const productJson = resolve(ROOT, `apps/${product}/product.json`)
      const builderJson = resolve(ROOT, `apps/${product}/electron-builder.json`)
      assert.ok(existsSync(productJson), `apps/${product}/product.json must exist`)
      assert.ok(existsSync(builderJson), `apps/${product}/electron-builder.json must exist`)
      const manifest = JSON.parse(readFileSync(productJson, 'utf8'))
      assert.ok(manifest.id, `apps/${product}/product.json must have id`)
      assert.ok(manifest.name, `apps/${product}/product.json must have name`)
      const builder = JSON.parse(readFileSync(builderJson, 'utf8'))
      assert.ok(builder.appId, `apps/${product}/electron-builder.json must have appId`)
    }
  })

  it('product-app.mjs references valid product IDs and actions', () => {
    const content = readFileSync(resolve(ROOT, 'scripts/product-app.mjs'), 'utf8')
    assert.ok(content.includes('PRODUCT_IDS'), 'product-app.mjs must use PRODUCT_IDS')
    assert.ok(content.includes('electron-vite'), 'product-app.mjs must invoke electron-vite')
    assert.ok(content.includes('dev'), 'product-app.mjs must support dev action')
    assert.ok(content.includes('build'), 'product-app.mjs must support build action')
  })

  it('packages/product-config/index.js exports expected constants', () => {
    const config = readJson('packages/product-config/package.json')
    assert.ok(config.main || config.exports, 'product-config must declare entry')
    const content = readFileSync(resolve(ROOT, 'packages/product-config/index.js'), 'utf8')
    assert.ok(content.includes('PRODUCT_IDS'), 'must export PRODUCT_IDS')
    assert.ok(content.includes('lodge-camp'), 'must include lodge-camp')
    assert.ok(content.includes('hotel'), 'must include hotel')
    assert.ok(content.includes('hospitality-pos'), 'must include hospitality-pos')
  })
})
