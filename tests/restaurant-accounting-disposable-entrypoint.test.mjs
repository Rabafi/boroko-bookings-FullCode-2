import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runRestaurantCommand } from './run-restaurant-suite.mjs'

test('dedicated package route uses the maintained guarded entrypoint too', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts['test:restaurant:ledger-disposable'], 'node ./tests/run-restaurant-suite.mjs')
})

test('maintained apply command routes only to the guarded ledger runner with fixed target guards', () => {
  let invocation
  const code = runRestaurantCommand(['--apply-candidate'], {
    env: {
      PATH: 'safe-path',
      SystemRoot: 'windows-root',
      LUNA_REMEDIATION_TEST_DB_URL: 'approved-db-url-sentinel',
      LUNA_REMEDIATION_LEDGER_STAFF_SESSION: 'approved-staff-session-sentinel',
      SUPABASE_SERVICE_ROLE_KEY: 'must-not-cross-boundary',
      SUPABASE_DB_URL: 'must-not-cross-boundary'
    },
    run: (...args) => { invocation = args; return { status: 0, signal: null, error: null } },
    log: { log() {}, error() {} }
  })

  assert.equal(code, 0)
  assert.ok(invocation)
  assert.match(invocation[1][0], /scripts[\\/]accounting-ledger-disposable-v4\.mjs$/)
  assert.deepEqual(invocation[1].slice(1), ['--apply-candidate'])
  assert.equal(invocation[2].shell, false)
  assert.equal(invocation[2].env.LUNA_REMEDIATION_TARGET_MARKER, 'LUNA-REMEDIATION-DISPOSABLE-v1')
  assert.equal(invocation[2].env.LUNA_REMEDIATION_EXPECTED_DATABASE, 'postgres')
  assert.equal(invocation[2].env.LUNA_REMEDIATION_EXPECTED_PROJECT_REF, 'repsrmlomedqrmrdsbga')
  assert.equal(invocation[2].env.LUNA_REMEDIATION_TEST_DB_URL, 'approved-db-url-sentinel')
  assert.equal(invocation[2].env.LUNA_REMEDIATION_LEDGER_STAFF_SESSION, 'approved-staff-session-sentinel')
  assert.equal(Object.hasOwn(invocation[2].env, 'SUPABASE_SERVICE_ROLE_KEY'), false)
  assert.equal(Object.hasOwn(invocation[2].env, 'SUPABASE_DB_URL'), false)
})

test('maintained apply command rejects mixed test and mutation options before child launch', () => {
  let launched = false
  const code = runRestaurantCommand(['--apply-candidate', '--suite=restaurant-accounting-ledger-provenance-sql.test.mjs'], {
    run: () => { launched = true; return { status: 0 } },
    log: { log() {}, error() {} }
  })
  assert.equal(code, 2)
  assert.equal(launched, false)
})

test('secure configuration check reports presence only and never prints configured values', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/check-accounting-remediation-config.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
    shell: false,
    env: {
      PATH: process.env.PATH || '',
      SystemRoot: process.env.SystemRoot || '',
      LUNA_REMEDIATION_TEST_DB_URL: 'db-url-private-sentinel',
      LUNA_REMEDIATION_LEDGER_STAFF_SESSION: 'staff-session-private-sentinel'
    }
  })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /"LUNA_REMEDIATION_TEST_DB_URL":"present"/)
  assert.match(result.stdout, /"LUNA_REMEDIATION_LEDGER_STAFF_SESSION":"present"/)
  assert.doesNotMatch(result.stdout + result.stderr, /private-sentinel/)
})
