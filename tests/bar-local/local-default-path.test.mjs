import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const app = readFileSync(new URL('../../src/renderer/src/App.jsx', import.meta.url), 'utf8')
const main = readFileSync(new URL('../../src/main/index.js', import.meta.url), 'utf8')
const runtime = readFileSync(new URL('../../src/main/bar-local/electronRuntime.js', import.meta.url), 'utf8')

test('fresh hospitality POS chooses the business before auth and keeps local Bar isolated from Restaurant', () => {
  assert.match(app, /useState\('choose'\)/)
  assert.match(app, /if \(entryChoice === 'local'\) return <LocalAuthorityBoundary/)
  assert.match(app, /Continue with Restaurant/)
  assert.match(app, /Set up a local Bar on this computer/)
  assert.match(app, /selectLocalBarWorkspace\(\)/)
  assert.match(app, /window\.api\.barLocal\.selectCloudWorkspace\(\)/)
  assert.match(runtime, /workspace_choice_required:\s*this\.cloudStartupDeferred/)
  assert.match(runtime, /writeDurableAtomic\(join\(this\.root, 'workspace-choice\.json'\), makeBarWorkspaceSelection\('local_bar'\)\)/)
  assert.match(main, /barLocalRuntime\?\.mode === AUTHORITY_MODES\.BAR_LOCAL \|\| barLocalRuntime\?\.cloudStartupDeferred/)
  assert.ok(main.indexOf('barLocalRuntime?.cloudStartupDeferred') < main.indexOf('await db.initDatabase()'))
})
