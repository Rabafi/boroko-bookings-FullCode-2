import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const required = ['id', 'name', 'customer', 'database_product', 'current_implementation', 'release_status', 'shared_backend']
const expected = new Set(['lodge-camp', 'hotel', 'hospitality-pos'])
const appsDir = path.resolve(process.cwd(), 'apps')
const seen = new Set()
const appIds = new Set()
const releaseRepos = new Set()

for (const entry of fs.readdirSync(appsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const appDir = path.join(appsDir, entry.name)
  const packagePath = path.join(appDir, 'package.json')
  const manifestPath = path.join(appDir, 'product.json')
  const buildConfigPath = path.join(appDir, 'electron-builder.json')
  if (!fs.existsSync(packagePath) || !fs.existsSync(manifestPath) || !fs.existsSync(buildConfigPath)) throw new Error(`${entry.name} must have package.json, product.json, and electron-builder.json`)
  const product = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const appPackage = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
  const buildConfig = JSON.parse(fs.readFileSync(buildConfigPath, 'utf8'))
  for (const field of required) if (!product[field]) throw new Error(`${entry.name} product.json is missing ${field}`)
  if (seen.has(product.id)) throw new Error(`Duplicate product id: ${product.id}`)
  if (!appPackage.scripts?.build || !appPackage.scripts?.dist || !appPackage.scripts?.['dist:publish']) throw new Error(`${entry.name} must expose build, dist, and dist:publish scripts`)
  if (!buildConfig.appId || !buildConfig.productName || !buildConfig.artifactName || !buildConfig.publish?.repo) throw new Error(`${entry.name} must declare installer and release identity`)
  const isLodgeCamp = product.id === 'lodge-camp'
  if (!isLodgeCamp && appIds.has(buildConfig.appId)) throw new Error(`${entry.name} reuses a Windows application ID`)
  if (!isLodgeCamp && releaseRepos.has(buildConfig.publish.repo)) throw new Error(`${entry.name} reuses a GitHub update feed`)
  appIds.add(buildConfig.appId)
  releaseRepos.add(buildConfig.publish.repo)
  seen.add(product.id)
}

for (const id of expected) if (!seen.has(id)) throw new Error(`Missing required product: ${id}`)
console.log(`product workspace: ok (${[...seen].sort().join(', ')})`)
