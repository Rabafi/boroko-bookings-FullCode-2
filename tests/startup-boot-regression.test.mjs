import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Startup boot regression: the desktop main process must not hold the window
// hostage on a slow/dead network, and must not parse multi-MB caches
// synchronously before first paint.
//
// initDatabase() runs before createWindow() in src/main/index.js, so every
// await inside it delays the window. Guardrails:
//  1. Single short connectivity probe at startup (no retry loop).
//  2. Startup backup deferred off the critical path.
//  3. initDatabase marks itself initialized (the guard at the top relies on it).

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

function initDatabaseBody(source) {
  const start = source.indexOf('export async function initDatabase()')
  assert.ok(start >= 0, 'infrastructure.js must define initDatabase()')
  const end = source.indexOf('// ─── AUTH ─', start)
  assert.ok(end > start, 'infrastructure.js must keep the AUTH section marker after initDatabase()')
  return source.slice(start, end)
}

async function run() {
  const connectivity = await read('src/main/domains/connectivity.js')
  const infrastructure = await read('src/main/domains/infrastructure.js')
  const body = initDatabaseBody(infrastructure)

  // 1a. A short startup probe budget exists and is well under the 10s periodic budget.
  const startupTimeout = connectivity.match(/STARTUP_CONNECTIVITY_PROBE_TIMEOUT_MS\s*=\s*(\d+)/)
  assert.ok(startupTimeout, 'connectivity.js must export STARTUP_CONNECTIVITY_PROBE_TIMEOUT_MS')
  assert.ok(Number(startupTimeout[1]) <= 5000,
    `startup probe budget must be <= 5000ms, got ${startupTimeout[1]}ms`)
  assert.ok(Number(startupTimeout[1]) < 10000,
    'startup probe budget must be shorter than the periodic 10s probe budget')

  // 1b. checkOnline() honours a caller-supplied timeout (startup passes the short budget).
  assert.match(connectivity, /export async function checkOnline\(options\s*=\s*\{\}\)/,
    'checkOnline() must accept an optional options argument')
  assert.match(connectivity, /options\?\.timeoutMs/,
    'checkOnline() must honour options.timeoutMs for the abort timer')
  assert.match(body, /checkOnline\(\{\s*timeoutMs:\s*STARTUP_CONNECTIVITY_PROBE_TIMEOUT_MS\s*\}\)/,
    'initDatabase() must probe once with the short startup budget')

  // 1c. No retry loop around the startup probe (the old 2x10s + 2s sleep ≈ 22s block).
  assert.doesNotMatch(body, /for\s*\(\s*let attempt/,
    'initDatabase() must not retry-loop the startup connectivity probe')

  // 2. The synchronous startup backup must be gone from the critical path.
  const syncBackupCalls = [...body.matchAll(/^\s*createBackup\(\);/gm)]
    .filter((m) => {
      const before = body.slice(0, m.index)
      const openTimers = (before.match(/setTimeout\(\(\) => \{/g) || []).length
      const openIntervals = (before.match(/setInterval\(\(\) => \{/g) || []).length
      return openTimers + openIntervals === 0
    })
  assert.equal(syncBackupCalls.length, 0,
    'initDatabase() must not call createBackup() synchronously; defer it past first paint')
  assert.match(body, /setTimeout\(\(\) => \{[\s\S]*?createBackup\(\);/,
    'initDatabase() must schedule the startup backup in the background')

  // 3. The re-entry guard at the top of initDatabase() must actually latch.
  assert.match(body, /state\._initialized\s*=\s*true/,
    'initDatabase() must set state._initialized = true')

  console.log('startup-boot-regression: ok')
}

run().catch((error) => {
  console.error('startup-boot-regression: failed')
  console.error(error?.stack || error?.message || error)
  process.exitCode = 1
})
