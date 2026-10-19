import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildRestaurantChildEnvironment, runRestaurantCommand, runRestaurantSuite, validateRestaurantDatabaseGate } from './run-restaurant-suite.mjs'
import { buildApprovedDisposableRestaurantRunnerEnvironment } from '../scripts/approved-disposable-restaurant-runner-env.mjs'

const dbSuite = 'restaurant-accounting-ledger-provenance-sql.test.mjs'
const sourceSuite = 'restaurant-accounting-ledger-manual-actor-linkage-contract.test.mjs'
const validEnv = () => ({
  PATH: process.env.PATH || '',
  SystemRoot: process.env.SystemRoot || '',
  LUNA_REMEDIATION_TEST_DB_URL: 'postgresql://fixture:db-secret@db.repsrmlomedqrmrdsbga.supabase.co:5432/postgres',
  LUNA_REMEDIATION_LEDGER_STAFF_SESSION: 'staff-session-secret-sentinel'
})
const tempEvidence = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'luna-runner-')), 'result.json')

test('absent approved config blocks database suites before any child or connection attempt', () => {
  const calls = []
  const output = []
  const evidenceFile = tempEvidence()
  const code = runRestaurantSuite({
    files: [dbSuite], keepGoing: true, evidenceFile, env: {},
    run: (...args) => { calls.push(args); throw new Error('database child must not spawn') },
    log: { log: value => output.push(String(value)), error: value => output.push(String(value)) }
  })
  assert.equal(code, 2)
  assert.equal(calls.length, 0)
  assert.ok(output.some(line => line.includes('BLOCKED:')))
  assert.ok(output.some(line => line.includes('connection attempts=0')))
  const report = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'))
  assert.equal(report.suites[0].status, 'blocked')
  assert.equal(report.suites[0].exit_code, 2)
})

test('wrong disposable URL target is rejected before preflight or database child spawn', () => {
  const env = { ...validEnv(), LUNA_REMEDIATION_TEST_DB_URL: 'postgresql://fixture:secret@db.otherproject.supabase.co:5432/postgres' }
  assert.equal(validateRestaurantDatabaseGate(env).ok, false)
  const calls = []
  const code = runRestaurantSuite({
    files: [dbSuite], keepGoing: true, evidenceFile: tempEvidence(), env,
    run: (...args) => { calls.push(args); throw new Error('wrong target must not spawn') },
    log: { log() {}, error() {} }
  })
  assert.equal(code, 2)
  assert.equal(calls.length, 0)
})

test('only validated database children receive secure settings and sanitized evidence retains output/counts', () => {
  const env = validEnv()
  const calls = []
  const evidenceFile = tempEvidence()
  const code = runRestaurantSuite({
    files: [sourceSuite, dbSuite], keepGoing: true, evidenceFile, env,
    run: (command, args, options) => {
      calls.push({ args, env: options.env })
      if (String(args[0]).includes('accounting-ledger-disposable-preflight')) {
        return { status: 0, stdout: '{"status":"verified"}\n', stderr: '' }
      }
      if (String(args[0]).endsWith(sourceSuite)) {
        return { status: 0, stdout: 'ℹ tests 1\nℹ pass 1\nℹ fail 0\nℹ skipped 0\n', stderr: '' }
      }
      return { status: 0, stdout: `ℹ tests 2\nℹ pass 2\nℹ fail 0\nℹ skipped 0\n${env.LUNA_REMEDIATION_TEST_DB_URL} ${env.LUNA_REMEDIATION_LEDGER_STAFF_SESSION}\n`, stderr: '' }
    },
    log: { log() {}, error() {} }
  })
  assert.equal(code, 0)
  assert.equal(calls.length, 3, 'preflight runs once before the two selected suites')
  assert.equal(Object.hasOwn(calls[1].env, 'LUNA_REMEDIATION_TEST_DB_URL'), false, 'source test receives no DB URL')
  assert.equal(calls[2].env.LUNA_REMEDIATION_TEST_DB_URL, env.LUNA_REMEDIATION_TEST_DB_URL)
  assert.equal(calls[2].env.LUNA_REMEDIATION_LEDGER_STAFF_SESSION, env.LUNA_REMEDIATION_LEDGER_STAFF_SESSION)
  assert.equal(calls[2].env.SUPABASE_DB_URL, undefined)
  const reportText = fs.readFileSync(evidenceFile, 'utf8')
  assert.doesNotMatch(reportText, /db-secret|staff-session-secret-sentinel/)
  const report = JSON.parse(reportText)
  assert.equal(report.suites[0].counts.tests, 1)
  assert.equal(report.suites[1].counts.passed, 2)
  assert.match(report.suites[1].stdout, /REDACTED/)
})

test('approved child environment contains only OS essentials and the exact guarded target', () => {
  const env = { ...validEnv(), SUPABASE_DB_URL: 'do-not-forward', SERVICE_ROLE_KEY: 'do-not-forward' }
  const child = buildRestaurantChildEnvironment(env, { database: true })
  assert.equal(child.LUNA_REMEDIATION_EXPECTED_PROJECT_REF, 'repsrmlomedqrmrdsbga')
  assert.equal(child.LUNA_REMEDIATION_EXPECTED_DATABASE, 'postgres')
  assert.equal(child.LUNA_REMEDIATION_TARGET_MARKER, 'LUNA-REMEDIATION-DISPOSABLE-v1')
  assert.equal(Object.hasOwn(child, 'SUPABASE_DB_URL'), false)
  assert.equal(Object.hasOwn(child, 'SERVICE_ROLE_KEY'), false)
})

test('legacy disposable launch is hosted-target-only and removes the local reset/fallback implementation', () => {
  const source = {
    ...validEnv(),
    SUPABASE_DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    SUPABASE_SERVICE_ROLE_KEY: 'private-sentinel',
    LUNA_REMEDIATION_EXPECTED_PROJECT_REF: 'repsrmlomedqrmrdsbga'
  }
  const { env, target } = buildApprovedDisposableRestaurantRunnerEnvironment(source)
  assert.deepEqual(target, { hostname: 'db.repsrmlomedqrmrdsbga.supabase.co', project_ref: 'repsrmlomedqrmrdsbga', database: 'postgres' })
  assert.equal(env.LUNA_REMEDIATION_TEST_DB_URL, source.LUNA_REMEDIATION_TEST_DB_URL)
  assert.equal(env.LUNA_REMEDIATION_TARGET_MARKER, 'LUNA-REMEDIATION-DISPOSABLE-v1')
  assert.equal(Object.hasOwn(env, 'SUPABASE_DB_URL'), false)
  assert.equal(Object.hasOwn(env, 'SUPABASE_SERVICE_ROLE_KEY'), false)
  assert.doesNotMatch(env.LUNA_REMEDIATION_TEST_DB_URL, /127\.0\.0\.1|localhost/i)
  const legacyLauncher = fs.readFileSync(new URL('../scripts/run-disposable-restaurant-tests.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(legacyLauncher, /127\.0\.0\.1:54322|supabase\s+start|db',\s*'reset/i)
  assert.match(legacyLauncher, /buildApprovedDisposableRestaurantRunnerEnvironment/)
  assert.throws(() => buildApprovedDisposableRestaurantRunnerEnvironment({}), /LUNA_REMEDIATION_TEST_DB_URL is required/)
  assert.throws(() => buildApprovedDisposableRestaurantRunnerEnvironment({
    ...source,
    LUNA_REMEDIATION_TEST_DB_URL: 'postgresql://fixture:secret@127.0.0.1:54322/postgres'
  }), /no localhost fallback/i)
})

test('maintained --apply-candidate command dispatches only through the guarded candidate runner', () => {
  const source = {
    ...validEnv(),
    SUPABASE_DB_URL: 'must-not-forward',
    SUPABASE_SERVICE_ROLE_KEY: 'private-sentinel',
    DATABASE_URL: 'must-not-forward'
  }
  const calls = []
  const output = []
  const code = runRestaurantCommand(['--apply-candidate'], {
    env: source,
    run: (command, args, options) => {
      calls.push({ command, args, env: options.env })
      return { status: 0 }
    },
    log: { log: value => output.push(String(value)), error: value => output.push(String(value)) }
  })
  assert.equal(code, 0)
  assert.equal(calls.length, 1)
  assert.match(calls[0].args[0], /accounting-ledger-disposable-v4\.mjs$/)
  assert.deepEqual(calls[0].args.slice(1), ['--apply-candidate'])
  assert.equal(calls[0].env.LUNA_REMEDIATION_EXPECTED_PROJECT_REF, 'repsrmlomedqrmrdsbga')
  assert.equal(calls[0].env.LUNA_REMEDIATION_EXPECTED_DATABASE, 'postgres')
  assert.equal(calls[0].env.LUNA_REMEDIATION_TARGET_MARKER, 'LUNA-REMEDIATION-DISPOSABLE-v1')
  assert.equal(Object.hasOwn(calls[0].env, 'SUPABASE_DB_URL'), false)
  assert.equal(Object.hasOwn(calls[0].env, 'SUPABASE_SERVICE_ROLE_KEY'), false)
  assert.equal(Object.hasOwn(calls[0].env, 'DATABASE_URL'), false)
  assert.doesNotMatch(output.join('\n'), /db-secret|staff-session-secret-sentinel/)
})
