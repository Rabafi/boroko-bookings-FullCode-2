import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const app = readFileSync(new URL('../../src/renderer/src/App.jsx', import.meta.url), 'utf8')
const main = readFileSync(new URL('../../src/main/index.js', import.meta.url), 'utf8')
const runtime = readFileSync(new URL('../../src/main/bar-local/electronRuntime.js', import.meta.url), 'utf8')

test('fresh hospitality POS enters local setup by default and keeps cloud an explicit isolated choice', () => {
  assert.match(app, /useState\(IS_HPOS_PRODUCT\s*\?\s*'local'\s*:\s*'choose'\)/)
  assert.match(app, /if \(entryChoice === 'local'\) return <LocalAuthorityBoundary/)
  assert.match(app, /window\.api\.barLocal\.selectCloudWorkspace\(\)/)
  assert.match(runtime, /workspace_choice_required:\s*this\.cloudStartupDeferred/)
  assert.match(main, /barLocalRuntime\?\.mode === AUTHORITY_MODES\.BAR_LOCAL \|\| barLocalRuntime\?\.cloudStartupDeferred/)
  assert.ok(main.indexOf('barLocalRuntime?.cloudStartupDeferred') < main.indexOf('await db.initDatabase()'))
})
