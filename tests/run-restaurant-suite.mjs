import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const restaurantTests = readdirSync(__dirname)
  .filter((file) => /^restaurant-.*\.test\.mjs$/.test(file))
  .sort()

if (restaurantTests.length === 0) {
  console.error('No restaurant regression tests found.')
  process.exit(1)
}

console.log(`Running ${restaurantTests.length} restaurant regression suites...`)

for (const file of restaurantTests) {
  console.log(`\n> node .\\tests\\${file}`)
  const result = spawnSync(process.execPath, [join(__dirname, file)], {
    cwd: join(__dirname, '..'),
    stdio: 'inherit'
  })
  if (result.status !== 0) process.exit(result.status || 1)
}

console.log(`\nRestaurant regression gate passed (${restaurantTests.length} suites).`)
