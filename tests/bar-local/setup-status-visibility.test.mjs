import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { boundedSetupRead, classifyBarSetupStatus } from '../../src/renderer/src/utils/barSetupStatus.js'

test('only a positively verified absent status unlocks new registration', () => {
  assert.equal(classifyBarSetupStatus({ available: false, phase: null, can_resume: false }), 'absent')
  assert.equal(classifyBarSetupStatus({ available: true, attempt_id: 'saved-original', phase: 'failed' }), 'present')
  for (const unknown of [null, undefined, {}, {available:false}, {available:true, phase:'failed'}]) assert.throws(() => classifyBarSetupStatus(unknown))
})
test('protected-record rejection and slow status never become absent', async () => {
  await assert.rejects(() => boundedSetupRead(Promise.reject(new Error('SETUP_STATE_CORRUPT'))), /SETUP_STATE_CORRUPT/)
  await assert.rejects(() => boundedSetupRead(new Promise(() => {}), 10), /Do not create another Bar/)
})
test('saved status can display independently of slow preflight', async () => {
  const status = await boundedSetupRead(Promise.resolve({available:true,attempt_id:'original',phase:'failed'}))
  assert.equal(classifyBarSetupStatus(status), 'present')
  const app = readFileSync('src/renderer/src/App.jsx', 'utf8')
  const refresh = app.slice(app.indexOf('const refreshServerSetup'), app.indexOf('const serverSetupAvailable'))
  assert.doesNotMatch(refresh, /Promise\.all|catch\(\(\) => null\)/)
  assert.match(app, /refreshServerSetup\(\{ checkPreflight: false \}\)/)
  assert.match(app, /serverSetupCheck === 'absent' \? <>/)
})
test('chooser shows a saved Bar in the profile list and opens it without creating a company', () => {
  const chooser = readFileSync('src/renderer/src/components/LodgeChooser.jsx','utf8')
  const handler = chooser.slice(chooser.indexOf('const selectSavedLocalBar'), chooser.indexOf('const linkDraftToLocalBar'))
  assert.match(handler, /selectLocalBarWorkspace/)
  assert.match(handler, /restart_required !== true/)
  assert.match(handler, /workspace !== 'local_bar'/)
  assert.doesNotMatch(handler, /createDraftProfile|selectProfile/)
  assert.doesNotMatch(chooser, /Already started a local Bar setup/)
  assert.match(chooser, /localBarEntry\.status === 'ready' \? 'Open Bar'/)
  assert.match(chooser, /localBarEntry\.status === 'draft' \? 'Continue setup'/)

  const app = readFileSync('src/renderer/src/App.jsx', 'utf8')
  const choose = app.slice(app.indexOf('const chooseBar = async'), app.indexOf('return <main className="flex min-h-screen items-center justify-center bg-slate-950'))
  assert.match(choose, /savedLocalBarEntry\.status === 'ready' \|\| savedLocalBarEntry\.status === 'draft'/)
  assert.match(choose, /savedLocalBarEntry\.status === 'recovery'[\s\S]*resume_existing: true/)
  assert.match(choose, /else if \(localAuthorityState\.has_saved_cloud_business === true\)/)
  assert.match(choose, /else \{[\s\S]*setEntryChoice\('local'\)/)
  assert.match(choose, /setEntryChoice\('local'\)/)
  assert.doesNotMatch(choose, /createDraftProfile|selectProfile|initializeCompany|createCompany/)

  const runtime = readFileSync('src/main/bar-local/electronRuntime.js','utf8')
  assert.match(runtime, /request\?\.resume_existing === true/)
  assert.match(runtime, /runtime\.localBarChooserEntry\(\)\.status === 'none'\) throw/)
  assert.match(runtime, /getChooserEntry', \(\) => runtime\.localBarChooserEntry\(\)/)
})
