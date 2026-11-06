// Run the quotation conversion SQL contract as a required gate. The underlying
// node:test remains skippable in broad local suites, while this entrypoint
// forces a verified disposable connection and propagates the failure status.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const sqlTest = path.join(root, 'tests', 'campsite-quotation-conversion-sql.test.mjs')
const childEnv = { ...process.env, LUNA_REMEDIATION_REQUIRE_DB: '1' }
delete childEnv.NODE_TEST_CONTEXT
const result = spawnSync(process.execPath, ['--test', sqlTest], {
  cwd: root,
  env: childEnv,
  encoding: 'utf8'
})

if (result.error) {
  console.error('campsite-quotation-disposable: unable to start the SQL acceptance runner.')
  process.exit(1)
}
if (result.signal) {
  console.error('campsite-quotation-disposable: SQL acceptance runner was interrupted.')
  process.exit(1)
}
const output = String(result.stdout || '') + String(result.stderr || '')
if (output) process.stdout.write(output)
if (output.includes('BLOCKED campsite-quotation-disposable:')) {
  process.exit(2)
}
process.exit(result.status ?? 1)
