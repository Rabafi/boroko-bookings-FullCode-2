import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { childProcessExitCode } from '../scripts/test-run-result.mjs'

const testsDir = dirname(fileURLToPath(import.meta.url))
const discover = () => readdirSync(testsDir).filter((file) => /^restaurant-.*\.test\.mjs$/.test(file)).sort()

export function runRestaurantSuite({ files = discover(), keepGoing = false, run = spawnSync, log = console } = {}) {
  if (files.length === 0) {
    log.error('No restaurant regression tests found.')
    return 1
  }
  log.log(`Running ${files.length} restaurant regression suites...`)
  const failures = []
  for (const file of files) {
    log.log(`\nRestaurant suite: ${file}`)
    const result = run(process.execPath, [join(testsDir, file)], {
      cwd: join(testsDir, '..'),
      stdio: 'inherit',
      shell: false
    })
    const code = childProcessExitCode(result)
    if (result.error) log.error(result.error.message)
    if (code !== 0) {
      failures.push({ file, code })
      if (!keepGoing || result.signal) break
    }
  }
  if (failures.length) {
    log.error(`Restaurant regression gate failed: ${failures.map(({file,code}) => `${file} (exit ${code})`).join(', ')}`)
    return failures[0].code
  }
  log.log(`Restaurant regression gate passed (${files.length} suites).`)
  return 0
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runRestaurantSuite({ keepGoing: process.argv.includes('--keep-going') })
}
