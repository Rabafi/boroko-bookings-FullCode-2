import path from 'node:path'
import { fileURLToPath } from 'node:url'

const managerDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(managerDir, '..')
process.chdir(root)
await import('../scripts/build-brand-assets.mjs')
