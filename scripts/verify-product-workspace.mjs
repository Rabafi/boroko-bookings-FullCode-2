import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const required = ['id', 'name', 'customer', 'database_product', 'current_implementation', 'release_status', 'shared_backend']
const expected = new Set(['lodge-camp', 'hotel', 'hospitality-pos'])
const appsDir = path.resolve(process.cwd(), 'apps')
const seen = new Set()

for (const entry of fs.readdirSync(appsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const appDir = path.join(appsDir, entry.name)
  const packagePath = path.join(appDir, 'package.json')
  const manifestPath = path.join(appDir, 'product.json')
  if (!fs.existsSync(packagePath) || !fs.existsSync(manifestPath)) throw new Error(`${entry.name} must have package.json and product.json`)
  const product = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  for (const field of required) if (!product[field]) throw new Error(`${entry.name} product.json is missing ${field}`)
  if (seen.has(product.id)) throw new Error(`Duplicate product id: ${product.id}`)
  seen.add(product.id)
}

for (const id of expected) if (!seen.has(id)) throw new Error(`Missing required product: ${id}`)
console.log(`product workspace: ok (${[...seen].sort().join(', ')})`)
