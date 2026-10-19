import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const root = process.cwd()
const localDeno = path.join(root, 'tmp', 'l01-deno-2.9.7', 'deno.exe')
const deno = process.env.DENO_EXECUTABLE || (fs.existsSync(localDeno) ? localDeno : 'deno')
const cache = path.join(root, 'tmp', 'l01-deno-2.9.7', 'cache')
const config = path.join('supabase', 'functions', 'deno.json')
const lock = path.join('supabase', 'functions', 'deno.lock')
const pinnedDenoVersion = '2.9.7'
const entrypoints = [
  'supabase/functions/send-push/index.ts',
  'supabase/functions/send-booking-confirmation/index.ts'
]

if (!fs.existsSync(config)) throw new Error(`Missing Deno config: ${config}`)
if (!fs.existsSync(lock)) throw new Error(`Missing pinned Deno dependency lock: ${lock}`)
fs.mkdirSync(cache, { recursive: true })

const version = spawnSync(deno, ['--version'], { cwd: root, encoding: 'utf8', windowsHide: true })
if (version.error) throw version.error
if (version.status !== 0 || !new RegExp(`^deno ${pinnedDenoVersion.replaceAll('.', '\\.')}(?:\\s|$)`, 'm').test(version.stdout ?? '')) {
  throw new Error(`Expected official Deno ${pinnedDenoVersion}; got ${version.stdout?.split(/\r?\n/, 1)[0] ?? `exit ${version.status}`}`)
}

for (const entrypoint of entrypoints) {
  console.log(`[typecheck-l01-deno] ${entrypoint}`)
  const result = spawnSync(deno, ['check', '--frozen', '--lock', lock, '--config', config, entrypoint], {
    cwd: root,
    env: { ...process.env, DENO_DIR: cache },
    encoding: 'utf8',
    windowsHide: true
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw result.error
  if (result.status !== 0) process.exitCode = result.status ?? 1
}

if (!process.exitCode) console.log('[typecheck-l01-deno] PASS: both Edge Function entrypoints checked with real Deno; handlers were not run.')
