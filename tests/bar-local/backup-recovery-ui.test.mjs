import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const modernPanel = join(root, 'src/renderer/src/components/hospitality-pos/BarLocalAdminPanel.jsx')
const legacyPanel = join(root, 'legacy-pos/src/renderer/src/components/BarLocalAdminPanel.jsx')
const modernClient = join(root, 'src/main/bar-local/client.js')
const legacyClient = join(root, 'legacy-pos/src/main/bar-local/client.js')
const modernPreload = join(root, 'src/preload/index.js')
const legacyPreload = join(root, 'legacy-pos/src/preload/index.js')
const runtime = join(root, 'src/main/bar-local/electronRuntime.js')
const legacyRuntime = join(root, 'legacy-pos/src/main/bar-local/runtime.js')
const legacyMain = join(root, 'legacy-pos/src/main/index.js')
const desktopApi = join(root, 'src/renderer/src/types/desktop-api.d.ts')

test('both desktop clients send the guarded restore drill request with an exact confirmation', () => {
  for (const file of [modernClient, legacyClient]) {
    const source = readFileSync(file, 'utf8')
    assert.match(source, /adminRestoreDrill/)
    assert.match(source, /\/v1\/admin\/backup\/restore-drill/)
    assert.match(source, /RESTORE_DRILL/)
    assert.match(source, /authorized_by/)
    assert.match(source, /reason/)
  }
})

test('restore drill IPC is registered and exposed for both applications', () => {
  assert.match(readFileSync(runtime, 'utf8'), /ipcMain\.handle\('barLocal:adminRestoreDrill'/)
  assert.match(readFileSync(modernPreload, 'utf8'), /adminRestoreDrill: \(request\) => invoke\('barLocal:adminRestoreDrill'/)
  assert.match(readFileSync(desktopApi, 'utf8'), /adminRestoreDrill\(request: unknown\)/)
  assert.match(readFileSync(legacyMain, 'utf8'), /ipcMain\.handle\('pos:bar-local:admin-restore-drill'/)
  assert.match(readFileSync(legacyPreload, 'utf8'), /adminRestoreDrill: \(request\) => ipcRenderer\.invoke\('pos:bar-local:admin-restore-drill'/)
  assert.match(readFileSync(legacyRuntime, 'utf8'), /adminRestoreDrill\(request\)/)
})

test('Modern admin panel reports scheduled backup health and never claims PITR', () => {
  const source = readFileSync(modernPanel, 'utf8')
  assert.match(source, /Scheduled backups/)
  assert.match(source, /backupSchedule/)
  assert.match(source, /schedule_message/)
  assert.match(source, /last_run_result/)
  assert.match(source, /latest_backup_age_hours/)
  assert.match(source, /not point-in-time recovery/)
  assert.match(source, /Guarded restore drill \(same PC\)/)
  assert.match(source, /adminRestoreDrill/)
  assert.match(source, /evidence_path/)
  assert.match(source, /temporary cluster/i)
  assert.match(source, /live database/i)
})

test('Legacy admin panel reports scheduled backup health and never claims PITR', () => {
  const source = readFileSync(legacyPanel, 'utf8')
  assert.match(source, /Scheduled backups/)
  assert.match(source, /schedule\?\.schedule_message/)
  assert.match(source, /schedule\?\.last_run_result/)
  assert.match(source, /schedule\?\.warning/)
  assert.match(source, /Guarded restore drill \(same PC\)/)
  assert.match(source, /adminRestoreDrill/)
  assert.match(source, /evidence_path/)
  assert.match(source, /temporary cluster/i)
})

test('restore drill UI requires an authorising name, a reason and an exact confirmation', () => {
  for (const file of [modernPanel, legacyPanel]) {
    const source = readFileSync(file, 'utf8')
    assert.match(source, /authorizedBy\.length < 3|authorizedBy\.trim\(\)\.length < 3/)
    assert.match(source, /reason\.length < 8|reason\.trim\(\)\.length < 8/)
    assert.match(source, /drillConfirm !== 'RESTORE_DRILL'/)
    // The drill control must never offer to replace the live database.
    assert.doesNotMatch(source, /replace the live database/i)
  }
})
