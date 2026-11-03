import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { barLocalReadinessMessage } from '../../src/shared/barLocalOperatorMessages.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const workspace = readFileSync(join(root, 'src/renderer/src/components/hospitality-pos/BarLocalWorkspace.jsx'), 'utf8')
const helperSource = workspace.match(/function readinessStateFor\(readiness, now\) \{[\s\S]*?\n\}/)?.[0]
assert.ok(helperSource, 'readiness state classifier must exist in the Modern Bar workspace')
const readinessStateFor = runInNewContext(`(${helperSource})`)

test('readiness display distinguishes verified ready, blocked, stale, unknown, and unavailable states', () => {
  const now = 100000
  assert.equal(readinessStateFor({ ready: true, checkedAt: now - 1000 }, now), 'ready')
  assert.equal(readinessStateFor({ ready: false, checkedAt: now - 1000, blockers: ['catalogue'] }, now), 'blocked')
  assert.equal(readinessStateFor({ ready: true, checkedAt: now - 45000 }, now), 'stale')
  assert.equal(readinessStateFor({ ready: true, checkedAt: 0 }, now), 'stale')
  assert.equal(readinessStateFor(null, now), 'unknown')
  assert.equal(readinessStateFor({ ready: null, checkedAt: now - 1000 }, now), 'unknown')
  assert.equal(readinessStateFor({ ready: true, checkedAt: now, unavailable: true }, now), 'unavailable')
})

test('only a current positive local readiness response enables readiness-gated operations', () => {
  assert.match(workspace, /const localReady = readinessState === 'ready'/)
  assert.match(workspace, /disabled=\{readinessChecking\}/)
  assert.match(workspace, /'Checking…' : 'Check connection'/)
  assert.match(workspace, /barLocalReadinessMessage\(readinessState, readiness\?\.blockers \|\| \[\]\)/)
  assert.match(workspace, /canManageSettings && readinessState === 'blocked'/)
  assert.match(workspace, /catalogueVerified && catalogueEmpty === true/)
  assert.match(workspace, /!menuDraft\.productId && !catalogueVerified/)
  assert.match(barLocalReadinessMessage('blocked', ['empty_catalogue']), /Add your first product and opening stock/)
})

 test('returns and voids refuse stale readiness before requesting approval', () => {
  const returnHandler = workspace.slice(workspace.indexOf('const submitReturn ='), workspace.indexOf('const submitSaleVoid ='))
  const voidHandler = workspace.slice(workspace.indexOf('const submitSaleVoid ='), workspace.indexOf('const closeShift ='))
  for (const handler of [returnHandler, voidHandler]) {
    assert.ok(handler.indexOf("readinessStateFor(readiness, Date.now()) !== 'ready'") >= 0)
    assert.ok(handler.indexOf("readinessStateFor(readiness, Date.now())") < handler.indexOf('requestApprovalForCommand'))
  }
  assert.doesNotMatch(workspace, /selectedSale\.status !== 'completed'[^\n]*!readiness\?\.ready/)
})
