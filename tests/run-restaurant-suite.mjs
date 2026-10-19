import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { childProcessExitCode } from '../scripts/test-run-result.mjs'
import { validateLedgerDisposableEnvironment } from './helpers/ledger-disposable-connection.mjs'

const testsDir = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(testsDir, '..')
const DISPOSABLE_MARKER = 'LUNA-REMEDIATION-DISPOSABLE-v1'
const DISPOSABLE_PROJECT = 'repsrmlomedqrmrdsbga'
const DISPOSABLE_DATABASE = 'postgres'
const productionLink = 'oicgpknsmtvcsjacymum'
const DATABASE_SUITES = new Set([
  'restaurant-accounting-behavioral.test.mjs',
  'restaurant-accounting-cutover-activation.test.mjs',
  'restaurant-accounting-ledger-provenance-sql.test.mjs',
  'restaurant-recipe-depletion-behavioral.test.mjs'
])
const PRECHECK_SCRIPT = resolve(rootDir, 'scripts/accounting-ledger-disposable-preflight-20261013.mjs')
const DEFAULT_EVIDENCE_DIR = resolve(rootDir, 'docs/audits/2026-10-07/accounting-remediation/evidence/desktop-acceptance-20261013')

export const discoverRestaurantSuites = () => readdirSync(testsDir).filter((file) => /^restaurant-.*\.test\.mjs$/.test(file)).sort()
export function selectRestaurantSuites(files, requested) {
  if (!requested) return files
  if (!/^[a-z0-9-]+\.test\.mjs$/i.test(requested) || !files.includes(requested)) {
    throw new Error('Requested Restaurant suite was not found by maintained discovery')
  }
  return [requested]
}

function runtimeEnvironment(source) {
  const env = {}
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'CI', 'NODE_ENV', 'TZ']) {
    if (source[name]) env[name] = source[name]
  }
  return env
}

export function validateRestaurantDatabaseGate(env = process.env) {
  const missing = ['LUNA_REMEDIATION_TEST_DB_URL', 'LUNA_REMEDIATION_LEDGER_STAFF_SESSION']
    .filter((name) => !String(env[name] || '').trim())
  if (missing.length) return { ok: false, blocked: true, message: `required approved settings are missing: ${missing.join(', ')}` }
  const guarded = {
    ...env,
    LUNA_REMEDIATION_TARGET_MARKER: DISPOSABLE_MARKER,
    LUNA_REMEDIATION_EXPECTED_DATABASE: DISPOSABLE_DATABASE,
    LUNA_REMEDIATION_EXPECTED_PROJECT_REF: DISPOSABLE_PROJECT
  }
  try {
    const target = validateLedgerDisposableEnvironment(guarded)
    return { ok: true, target }
  } catch (error) {
    return { ok: false, blocked: true, message: error?.message || 'approved disposable target validation failed' }
  }
}

export function buildRestaurantChildEnvironment(source = process.env, { database = false } = {}) {
  const env = runtimeEnvironment(source)
  if (!database) return env
  const gate = validateRestaurantDatabaseGate(source)
  if (!gate.ok) throw new Error(gate.message)
  env.LUNA_REMEDIATION_TARGET_MARKER = DISPOSABLE_MARKER
  env.LUNA_REMEDIATION_EXPECTED_DATABASE = DISPOSABLE_DATABASE
  env.LUNA_REMEDIATION_EXPECTED_PROJECT_REF = DISPOSABLE_PROJECT
  env.LUNA_REMEDIATION_TEST_DB_URL = source.LUNA_REMEDIATION_TEST_DB_URL
  env.LUNA_REMEDIATION_LEDGER_STAFF_SESSION = source.LUNA_REMEDIATION_LEDGER_STAFF_SESSION
  // Compatibility names are restricted to the four known DB suites. Both
  // values refer to the already-validated same disposable target.
  env.RESTAURANT_ACCOUNTING_DISPOSABLE_DB = '1'
  env.RESTAURANT_ACCOUNTING_TEST_DB_URL = source.LUNA_REMEDIATION_TEST_DB_URL
  env.RESTAURANT_ACCOUNTING_DISPOSABLE_ACK = `destroy-data-on:${gate.target.hostname}`
  return env
}

function parseCounts(output) {
  const last = (pattern) => {
    const values = [...String(output).matchAll(pattern)]
    return values.length ? Number(values.at(-1)[1]) : null
  }
  const tests = last(/(?:ℹ\s*tests|#\s*tests)\s+(\d+)/g)
  if (tests === null) return null
  return {
    tests,
    passed: last(/(?:ℹ\s*pass|#\s*pass)\s+(\d+)/g),
    failed: last(/(?:ℹ\s*fail|#\s*fail)\s+(\d+)/g),
    skipped: last(/(?:ℹ\s*skipped|#\s*skipped)\s+(\d+)/g)
  }
}

function redactOutput(value, source = process.env) {
  let output = String(value || '')
  for (const [name, secret] of Object.entries(source)) {
    if (/secret|password|token|session|service.?role|management|database.?url|db.?url|supabase.?key/i.test(name) && secret) {
      output = output.split(String(secret)).join('[REDACTED]')
    }
  }
  return output.replace(/(postgres(?:ql)?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
}

function evidencePath(pathOverride) {
  if (pathOverride) return resolve(pathOverride)
  return join(DEFAULT_EVIDENCE_DIR, `restaurant-maintained-run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
}

export function runRestaurantSuite({ files = discoverRestaurantSuites(), keepGoing = false, run = spawnSync, log = console,
  env = process.env, evidenceFile } = {}) {
  if (files.length === 0) {
    log.error('No restaurant regression tests found.')
    return 1
  }
  log.log(`Running ${files.length} restaurant regression suites...`)
  const failures = []
  const results = []
  const dbFiles = files.filter((file) => DATABASE_SUITES.has(file))
  let databaseGate = null
  let preflight = null
  if (dbFiles.length) {
    databaseGate = validateRestaurantDatabaseGate(env)
    if (databaseGate.ok) {
      const childEnv = buildRestaurantChildEnvironment(env, { database: true })
      const result = run(process.execPath, [PRECHECK_SCRIPT], {
        cwd: rootDir, stdio: 'pipe', encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, shell: false, env: childEnv
      })
      const output = redactOutput(`${result.stdout || ''}${result.stderr || ''}`, env)
      const code = childProcessExitCode(result)
      preflight = { exit_code: code, output, verified: code === 0 }
      if (!preflight.verified) databaseGate = { ok: false, blocked: true, message: 'approved database marker/staff preflight did not pass' }
      if (output) (code === 0 ? log.log : log.error)(output.trimEnd())
    }
  }
  for (const file of files) {
    log.log(`\nRestaurant suite: ${file}`)
    if (DATABASE_SUITES.has(file) && !databaseGate?.ok) {
      const message = `BLOCKED: ${databaseGate?.message || 'approved disposable database preflight was not completed'}; suite was not spawned; database connection attempts=0.`
      log.error(message)
      failures.push({ file, code: 2 })
      results.push({ suite: file, status: 'blocked', exit_code: 2, counts: null, stdout: '', stderr: message })
      if (!keepGoing) break
      continue
    }
    const database = DATABASE_SUITES.has(file)
    let childEnv
    try {
      childEnv = buildRestaurantChildEnvironment(env, { database })
    } catch (error) {
      const message = `BLOCKED: ${error?.message || 'approved disposable database settings are invalid'}; suite was not spawned; database connection attempts=0.`
      log.error(message)
      failures.push({ file, code: 2 })
      results.push({ suite: file, status: 'blocked', exit_code: 2, counts: null, stdout: '', stderr: message })
      if (!keepGoing) break
      continue
    }
    const result = run(process.execPath, [join(testsDir, file)], {
      cwd: rootDir, stdio: 'pipe', encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, shell: false, env: childEnv
    })
    const code = childProcessExitCode(result)
    const stdout = redactOutput(result.stdout || '', env)
    const stderr = redactOutput([result.stderr || '', result.error?.message || ''].filter(Boolean).join('\n'), env)
    if (stdout) log.log(stdout.trimEnd())
    if (stderr) log.error(stderr.trimEnd())
    results.push({ suite: file, status: code === 0 ? 'passed' : 'failed', exit_code: code, counts: parseCounts(`${stdout}\n${stderr}`), stdout, stderr })
    if (code !== 0) {
      failures.push({ file, code })
      if (!keepGoing || result.signal) break
    }
  }
  if (failures.length) {
    log.error(`Restaurant regression gate failed: ${failures.map(({file,code}) => `${file} (exit ${code})`).join(', ')}`)
  } else {
    log.log(`Restaurant regression gate passed (${files.length} suites).`)
  }
  const path = evidencePath(evidenceFile)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({
    generated_at: new Date().toISOString(), suite_count: files.length, failed_suite_count: failures.length,
    exit_code: failures.length ? failures[0].code : 0, database_gate: databaseGate?.ok ? 'verified_read_only' : dbFiles.length ? 'blocked' : 'not_required',
    database_preflight: preflight, suites: results
  }, null, 2) + '\n', 'utf8')
  log.log(`Restaurant suite evidence saved: ${path}`)
  return failures.length ? failures[0].code : 0
}

// Keep the operator-facing apply command on the normal maintained entry point,
// while routing it to the dedicated guarded database runner. Only the two
// approved secure inputs cross this process boundary; target guards are fixed
// here so the operator never has to supply or guess them.
export function runRestaurantCommand(args = process.argv.slice(2), { run = spawnSync, env = process.env, log = console, evidenceFile } = {}) {
  if (args.includes('--apply-candidate')) {
    if (args.length !== 1) {
      log.error('--apply-candidate cannot be combined with suite filters or other runner options.')
      return 2
    }
    const childEnv = {}
    for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']) {
      if (env[name]) childEnv[name] = env[name]
    }
    childEnv.LUNA_REMEDIATION_TARGET_MARKER = 'LUNA-REMEDIATION-DISPOSABLE-v1'
    childEnv.LUNA_REMEDIATION_EXPECTED_DATABASE = 'postgres'
    childEnv.LUNA_REMEDIATION_EXPECTED_PROJECT_REF = 'repsrmlomedqrmrdsbga'
    for (const name of ['LUNA_REMEDIATION_TEST_DB_URL', 'LUNA_REMEDIATION_LEDGER_STAFF_SESSION']) {
      if (env[name]) childEnv[name] = env[name]
    }
    const runner = resolve(testsDir, '../scripts/accounting-ledger-disposable-v4.mjs')
    const result = run(process.execPath, [runner, '--apply-candidate'], {
      cwd: resolve(testsDir, '..'),
      stdio: 'inherit',
      shell: false,
      env: childEnv
    })
    if (result.error) log.error(result.error.message)
    return childProcessExitCode(result)
  }

  try {
    const discovered = discoverRestaurantSuites()
    const filter = args.find((arg) => arg.startsWith('--suite='))?.slice('--suite='.length)
    const files = selectRestaurantSuites(discovered, filter)
    return runRestaurantSuite({ files, keepGoing: args.includes('--keep-going'), run, log, env, evidenceFile })
  } catch (error) {
    log.error(error?.message || error)
    return 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runRestaurantCommand()
}
