import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testsDir = path.dirname(fileURLToPath(import.meta.url))

test('Windows protected-path helpers resolve junctions and prevent backup path aliases', (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows junction behavior is verified on Windows only.')
    return
  }
  const result = spawnSync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(testsDir, 'windows-path-safety.ps1')
  ], { cwd: path.resolve(testsDir, '..', '..', '..'), encoding: 'utf8', timeout: 15000 })
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr)
  assert.match(result.stdout, /Windows junction path safety passed/)
})
