import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))

const enterpriseTests = readdirSync(__dirname)
  .filter((file) => /^enterprise-.*\.test\.mjs$/.test(file))
  .sort()

if (enterpriseTests.length === 0) {
  console.error('No Enterprise regression tests found.')
  process.exit(1)
}

console.log(`Running ${enterpriseTests.length} Enterprise regression suites...`)

for (const file of enterpriseTests) {
  console.log(`\n> node .\\tests\\${file}`)
  const result = spawnSync(process.execPath, [join(__dirname, file)], {
    cwd: join(__dirname, '..'),
    stdio: 'inherit'
  })

  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

console.log(`\nEnterprise regression gate passed (${enterpriseTests.length} suites).`)
