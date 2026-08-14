import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const disposableFlag = process.env.RESTAURANT_ACCOUNTING_DISPOSABLE_DB
const disposableSupabaseHome = process.env.SUPABASE_CLI_HOME || resolve(root, '.supabase-cli-home')

if (disposableFlag !== '1') {
  console.error('Refusing to reset a local database without an explicit disposable-database opt-in.')
  console.error('PowerShell: $env:RESTAURANT_ACCOUNTING_DISPOSABLE_DB="1"; npm run test:restaurant:disposable')
  console.error('Use only against a disposable local Supabase database. A reset deletes its local data.')
  process.exit(2)
}

function cliCandidates() {
  const configured = process.env.SUPABASE_CLI_BIN
  const local = process.platform === 'win32'
    ? [resolve(root, 'node_modules', '.bin', 'supabase.cmd'), resolve(root, 'node_modules', 'supabase', 'bin', 'supabase.exe')]
    : [resolve(root, 'node_modules', '.bin', 'supabase'), resolve(root, 'node_modules', 'supabase', 'bin', 'supabase')]
  const global = process.platform === 'win32' ? ['supabase.exe', 'supabase.cmd', 'supabase'] : ['supabase']
  return [...(configured ? [configured] : []), ...local, ...global]
}

function runSupabase(args) {
  let lastError = null
  for (const command of cliCandidates()) {
    if (command.includes('\\') || command.includes('/') || command.startsWith('.')) {
      if (!existsSync(command)) continue
    }
    const isWindowsBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)
    // npm-installed Windows shims are safe to invoke through the shell when
    // addressed relative to cwd. Passing an absolute path with spaces to
    // shell:true makes cmd.exe split the workspace at "C:\\Users\\...".
    const shellCommand = isWindowsBatch && command.toLowerCase().startsWith(`${root.toLowerCase()}\\`)
      ? command.slice(root.length + 1)
      : command
    const result = spawnSync(shellCommand, args, {
      cwd: root,
      stdio: 'inherit',
      shell: isWindowsBatch,
      env: { ...process.env, SUPABASE_CLI_HOME: disposableSupabaseHome }
    })
    if (!result.error) return result
    lastError = result.error
    if (!['ENOENT', 'EINVAL'].includes(result.error.code)) return result
  }
  const error = new Error('Supabase CLI was not found. Install the Supabase CLI and ensure Docker is running before retrying.')
  error.cause = lastError
  throw error
}

let started = false
let exitCode = 1
try {
  console.log('Starting the disposable local Supabase stack...')
  const start = runSupabase(['start'])
  if (start.status !== 0) {
    console.error('Supabase could not start. This is a hard no-ship result for the restaurant behavioral gate.')
    process.exitCode = start.status || 1
  } else {
    started = true
    console.log('Resetting the disposable database and applying all ordered migrations...')
    const reset = runSupabase(['db', 'reset', '--local', '--yes'])
    if (reset.status !== 0) {
      console.error('Supabase database reset/migration application failed.')
      process.exitCode = reset.status || 1
    } else {
      const env = {
        ...process.env,
        RESTAURANT_ACCOUNTING_TEST_DB_URL: process.env.RESTAURANT_ACCOUNTING_TEST_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
      }
      console.log('Running the restaurant regression and behavioral suites against the reset database...')
      const tests = spawnSync(process.execPath, [resolve(root, 'tests', 'run-restaurant-suite.mjs')], {
        cwd: root,
        env,
        stdio: 'inherit',
        shell: false
      })
      exitCode = tests.status || 1
      process.exitCode = tests.status || 1
    }
  }
} catch (error) {
  console.error(error?.message || error)
  process.exitCode = 1
} finally {
  if (started && process.env.RESTAURANT_ACCOUNTING_KEEP_DB !== '1') {
    console.log('Stopping the disposable local Supabase stack...')
    try {
      const stop = runSupabase(['stop', '--no-backup'])
      if (stop.status !== 0 && process.exitCode === 0) process.exitCode = stop.status || 1
    } catch (error) {
      console.error(error?.message || error)
      if (process.exitCode === 0) process.exitCode = 1
    }
  } else if (started) {
    console.log('Keeping the local Supabase stack because RESTAURANT_ACCOUNTING_KEEP_DB=1.')
  }
}

process.exitCode = process.exitCode ?? exitCode
