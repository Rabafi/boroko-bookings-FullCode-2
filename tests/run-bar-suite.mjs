import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { childProcessExitCode } from '../scripts/test-run-result.mjs'

const testsDir = dirname(fileURLToPath(import.meta.url))
export function collectBarTests(entries) {
  return entries.filter((file) => /^bar-.*\.test\.mjs$/.test(file)).sort()
}
export function runBarSuite({ files = collectBarTests(readdirSync(testsDir)), run = spawnSync, log = console } = {}) {
  if (files.length === 0) {
    log.error('No Bar regression tests found.')
    return 1
  }
  log.log(`Running ${files.length} Bar regression files...`)
  const result = run(process.execPath, ['--test', ...files.map((file) => join(testsDir, file))], {
    cwd: join(testsDir, '..'),
    stdio: 'inherit',
    shell: false
  })
  if (result.error) log.error(result.error.message)
  return childProcessExitCode(result)
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runBarSuite()
}
