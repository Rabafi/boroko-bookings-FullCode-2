import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function source(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function handlerBlock(mainSource, channel) {
  const marker = `ipcMain.handle('${channel}'`
  const start = mainSource.indexOf(marker)
  assert.notEqual(start, -1, `main handler exists: ${channel}`)
  const next = mainSource.indexOf('\n  ipcMain.handle(', start + marker.length)
  return mainSource.slice(start, next === -1 ? mainSource.length : next)
}

function assertInvokesPreloadChannel(preloadSource, channel) {
  assert.match(preloadSource, new RegExp(`invoke\\('${channel.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}'`), `preload invokes ${channel}`)
}

const recoveryMutationChannels = [
  'backup:recoveryBegin',
  'backup:recoveryStage',
  'backup:recoverySeal',
  'backup:recoveryApprove',
  'backup:recoveryExecute',
  'backup:recoveryDiscard'
]

const recoveryReadChannels = [
  'backup:recoveryPreview',
  'backup:recoveryGet',
  'backup:recoveryList',
  'backup:recoveryVerify'
]

const automationChannels = [
  'backup:automationStatus',
  'backup:automationConfigure',
  'backup:automationDisable',
  'backup:automationSnooze',
  'backup:automationClearSnooze',
  'backup:automationRunNow',
  'backup:chooseStarterAutomationFolder'
]

test('starterVerify and local rehearsal return metadata-only safe DTOs', () => {
  const main = source('src/main/index.js')
  const block = handlerBlock(main, 'backup:starterVerify')

  assert.match(main, /RECOVERY_IPC_DATA_KEYS/)
  assert.match(main, /stripRecoveryIpcData\s*=\s*\(value\)/)
  assert.match(block, /stripRecoveryIpcData\(verification\)/)
  assert.doesNotMatch(block, /return\s+verification\s*;/, 'raw verifier output must not cross IPC')

  const rehearsal = handlerBlock(main, 'backup:starterRestoreRehearsal')
  assert.match(rehearsal, /const rehearsal = await db\.createStarterRestoreRehearsal/)
  assert.match(rehearsal, /return stripRecoveryIpcData\(rehearsal\)/)
})

test('all recovery mutations require fresh Command Central reauthentication and recovery capability', () => {
  const main = source('src/main/index.js')
  for (const channel of recoveryMutationChannels) {
    const block = handlerBlock(main, channel)
    assert.match(block, /requireFreshCommandCentralReauth\(\)/, `${channel} requires fresh reauth`)
    assert.match(block, /requireCapability\('command_central\.recovery\.manage'\)/, `${channel} requires recovery capability`)
  }

  for (const channel of recoveryReadChannels) {
    const block = handlerBlock(main, channel)
    assert.match(block, /requireCapability\('command_central\.recovery\.manage'\)/, `${channel} requires recovery capability`)
  }

  // Preview and verification persist audit/state results even though their
  // responses are read-only metadata, so they also require a fresh unlock.
  for (const channel of ['backup:recoveryPreview', 'backup:recoveryVerify']) {
    const block = handlerBlock(main, channel)
    assert.match(block, /requireFreshCommandCentralReauth\(\)/, `${channel} requires fresh reauth`)
  }
})

test('recovery package chooser is protected before opening a customer file dialog', () => {
  const main = source('src/main/index.js')
  const block = handlerBlock(main, 'backup:recoveryChoosePackage')
  assert.match(block, /requireFreshCommandCentralReauth\(\)/)
  assert.match(block, /requireCapability\('command_central\.recovery\.manage'\)/)
  assert.match(block, /dialog\.showOpenDialog/)
  assert.match(block, /extensions:\s*\['tbbackup'\]/)
})

test('automation IPC always derives lodge scope from the active session', () => {
  const main = source('src/main/index.js')
  for (const channel of automationChannels.slice(0, -1)) {
    const block = handlerBlock(main, channel)
    assert.ok(block.includes('const lodgeId = db.getCurrentUser?.()?.lodge_id || db.getActiveProfile?.()?.lodge_id || null'), `${channel} derives active lodge`)
    assert.doesNotMatch(block, /payload\?\.(?:lodge_id|lodgeId)/, `${channel} does not trust renderer lodge ID`)
  }

  const configure = handlerBlock(main, 'backup:automationConfigure')
  assert.match(configure, /stripRendererLodgeScope\(payload\)/)
  assert.match(configure, /\.\.\.stripRendererLodgeScope\(payload\),\s*lodge_id:\s*lodgeId/)
  const runNow = handlerBlock(main, 'backup:automationRunNow')
  assert.match(runNow, /stripRendererLodgeScope\(payload\)/)
  assert.match(runNow, /\.\.\.stripRendererLodgeScope\(payload\),\s*lodgeId/)
})

test('recovery operation responses are scrubbed before crossing IPC and verification is awaited', () => {
  const main = source('src/main/index.js')
  for (const channel of ['backup:recoveryBegin', 'backup:recoveryStage', 'backup:recoverySeal', 'backup:recoveryApprove', 'backup:recoveryExecute', 'backup:recoveryDiscard', 'backup:recoveryGet']) {
    const block = handlerBlock(main, channel)
    assert.match(block, /stripRecoveryIpcData\(op\)/, `${channel} scrubs operation payload`)
    assert.doesNotMatch(block, /return\s+\{\s*success:\s*true,\s*operation:\s*op\s*\}/, `${channel} must not return raw operation`)
  }
  const verify = handlerBlock(main, 'backup:recoveryVerify')
  assert.match(verify, /const result = await db\.verifyStarterRecoveryOperation/)
  assert.match(verify, /stripRecoveryIpcData\(result\)/)
  assert.doesNotMatch(verify, /const result = db\.verifyStarterRecoveryOperation/)
})

test('Starter automation uses a separate capability-gated folder picker', () => {
  const main = source('src/main/index.js')
  const block = handlerBlock(main, 'backup:chooseStarterAutomationFolder')
  assert.match(block, /requireCapability\('backup\.starter_automation'\)/)
  assert.match(block, /requireCommercialFeature\('starter_backup_automation'/)
  assert.match(block, /dialog\.showOpenDialog/)
  assert.match(block, /openDirectory/)
})

test('startup and periodic scheduling both evaluate due state and invoke the runner', () => {
  const main = source('src/main/index.js')
  const start = main.indexOf('let starterAutomationSchedulerRunning')
  const end = main.indexOf('// -- Update IPC', start)
  assert.notEqual(start, -1, 'starter scheduler is wired in the main process')
  assert.notEqual(end, -1, 'starter scheduler has a bounded wiring block')
  const block = main.slice(start, end)

  assert.match(block, /db\.evaluateAutomationDueAtStartup\(\)/)
  assert.match(block, /if\s*\(due\?\.due === true\)[\s\S]*db\.runStarterBackupAutomationOnce\(/)
  assert.match(block, /runStarterAutomationScheduler\('startup'\)/)
  assert.match(block, /runStarterAutomationScheduler\('periodic_or_reconnect'\)/)
  assert.match(block, /25_000/)
  assert.match(block, /15 \* 60 \* 1000/)
  assert.match(block, /starterAutomationSchedulerRunning/)
})

test('preload, main handlers, and database facade remain in parity for recovery and automation', () => {
  const preload = source('src/preload/index.js')
  const main = source('src/main/index.js')
  const database = source('src/main/database.js')
  const channels = [...recoveryMutationChannels, ...recoveryReadChannels, 'backup:recoveryChoosePackage', ...automationChannels]

  for (const channel of channels) {
    assertInvokesPreloadChannel(preload, channel)
    assert.match(main, new RegExp(`ipcMain\\.handle\\('${channel.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}'`), `main handles ${channel}`)
  }

  for (const method of [
    'beginStarterRecoveryOperation', 'stageStarterRecoveryPackage', 'sealAndValidateStarterRecovery',
    'previewStarterRecovery', 'approveStarterRecovery', 'executeStarterRecovery',
    'discardStarterRecoveryOperation', 'getStarterRecoveryOperation', 'listStarterRecoveryOperations',
    'verifyStarterRecoveryOperation', 'getStarterBackupAutomationStatus', 'configureStarterBackupAutomation',
    'disableStarterBackupAutomation', 'snoozeStarterBackupAutomation', 'clearStarterBackupAutomationSnooze',
    'runStarterBackupAutomationOnce', 'evaluateAutomationDueAtStartup'
  ]) {
    assert.match(database, new RegExp(`\\b${method}\\b`), `database facade exposes ${method}`)
  }
})

test('Starter Backup exposes setup, passphrase visibility, status, and run-now controls', () => {
  const ui = source('src/renderer/src/components/StarterBackup.jsx')
  for (const channel of ['automationStatus', 'automationConfigure', 'automationRunNow', 'chooseStarterAutomationFolder']) {
    assert.match(ui, new RegExp(`backup\\?\\.${channel}`), `Starter Backup calls ${channel}`)
  }
  assert.match(ui, /showAutomationPassphrase/)
  assert.match(ui, /id="starter-automation-passphrase"/)
  assert.match(ui, /type=\{visible \? 'text' : 'password'\}/)
  assert.match(ui, /aria-label=\{visible \? 'Hide passphrase' : 'Show passphrase'\}/)
  assert.match(ui, /Weekly backup/)
  assert.match(ui, /Last checked backup/)
  assert.match(ui, /Back up now/)
  assert.match(ui, /Turn on weekly backups/)
})

test('Command Central exposes recovery navigation, disposable-target copy, and unlock guidance', () => {
  const admin = source('src/renderer/src/components/AdminCentral.jsx')
  const recovery = source('src/renderer/src/components/StarterRecoveryWorkspace.jsx')

  assert.match(admin, /id:\s*'recovery',\s*label:\s*'Data Recovery'/)
  assert.match(admin, /StarterRecoveryWorkspace/)
  assert.match(admin, /unlocked=\{reauthVerified\}/)
  assert.match(recovery, /Restore into a disposable recovery lodge/)
  assert.match(recovery, /never overwrites the customer['’]s live lodge/i)
  assert.match(recovery, /new quarantined disposable lodge/i)
  assert.match(recovery, /Local validation passed — not restored/)
  assert.match(recovery, /File validated locally\. No lodge has been restored/)
  assert.match(recovery, /Unlock changes/)
  assert.match(recovery, /Choose \.tbbackup file/)
})
