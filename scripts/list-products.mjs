import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const appsDir = path.resolve(process.cwd(), 'apps')
for (const entry of fs.readdirSync(appsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const manifestPath = path.join(appsDir, entry.name, 'product.json')
  if (!fs.existsSync(manifestPath)) continue
  const product = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  console.log(`${product.id}: ${product.name} (${product.release_status})`)
}
