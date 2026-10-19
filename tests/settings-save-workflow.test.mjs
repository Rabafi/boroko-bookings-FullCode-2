import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const settingsUi = read('src/renderer/src/components/Settings.jsx')
const settingsDomain = read('src/main/domains/settings.js')
const main = read('src/main/index.js')

test('LodgingOS keeps an in-progress settings draft independent of global refreshes and Assistant toggles', () => {
  assert.match(settingsUi, /formRef\.current && savedFormSnapshotRef\.current/)
  assert.match(settingsUi, /preserveDraftChanges/)
  const toggle = settingsUi.match(/const toggleAssistant = \(\) => \{([\s\S]*?)\n  \}/)?.[1] || ''
  assert.match(toggle, /set\('assistant_enabled', nextEnabled\)/)
  assert.doesNotMatch(toggle, /setGlobalSettings/)
})

test('all LodgingOS save entry points share capability, validation, dirty-state, and timeout guards', () => {
  assert.match(settingsUi, /canAccessCapability\(access, 'settings\.manage_general'\)/)
  assert.match(settingsUi, /const validateSettingsForm = \(draft\)/)
  assert.match(settingsUi, /if \(!isFormDirty\)/)
  assert.match(settingsUi, /withSettingsSaveTimeout\(/)
  assert.match(settingsUi, /disabled=\{saving \|\| !canManageGeneralSettings \|\| !isFormDirty\}/)
  assert.match(settingsUi, /const res = await saveSettingsDraft\(\)/)
  assert.match(settingsUi, /if \(!isFormDirty && isEmailDirty\)/)
  assert.match(settingsUi, /Email setup has unsaved changes\. Use Save Email Setup first/)
})

test('settings persistence truthfully reports device-only, partial-schema, and remote saves', () => {
  assert.match(settingsDomain, /persistence: 'device_only'/)
  assert.match(settingsDomain, /retryRequired: true/)
  assert.match(settingsDomain, /persistence: skippedColumns\.length > 0 \? 'remote_partial' : 'remote'/)
  assert.match(settingsDomain, /skippedColumns,\n\s+warnings/)
  assert.match(main, /db\.saveSettings\(data, \{ includeMeta: true \}\)/)
  assert.match(main, /return \{ success: true, data: saved, meta: saveMeta \}/)
  assert.match(settingsUi, /const retryablePending = meta\.persistence === 'device_only'/)
  assert.match(settingsUi, /setGlobalSettings\(retryDraft\)/)
  assert.match(settingsUi, /savedFormSnapshotRef\.current = cloneSettings\(retrySnapshot\)/)
  assert.match(settingsUi, /!res\?\.retryablePending/)
})

test('settings save timeout is bounded and gives an actionable recovery message', () => {
  assert.match(settingsUi, /SETTINGS_SAVE_TIMEOUT_MS = 20000/)
  assert.match(settingsUi, /Saving settings timed out\. Check the internet connection and try Save Settings again\./)
  assert.match(settingsDomain, /SETTINGS_SAVE_TIMEOUT_MS = 15000/)
  assert.match(settingsDomain, /Saving settings timed out while contacting the server\./)
  assert.match(settingsDomain, /const saveDeadline = Date\.now\(\) \+ SETTINGS_SAVE_TIMEOUT_MS/)
  assert.match(settingsDomain, /const remainingMs = saveDeadline - Date\.now\(\)/)
})

test('Settings runs every hook before the loading early-return (no recovery-screen crash)', () => {
  // 2026-09-24: outlet-setup useState/useEffect sat below `if (!form)`,
  // so opening ?tab=outlets threw "Rendered more hooks than during the
  // previous render" once the form loaded. Hooks must stay unconditional.
  const guardAt = settingsUi.indexOf('if (!form) return (')
  assert.ok(guardAt > 0, 'loading guard must exist')
  const afterGuard = settingsUi.slice(guardAt)
  for (const hook of ['useState(', 'useEffect(', 'useMemo(', 'useCallback(', 'useRef(', 'useContext(']) {
    assert.equal(afterGuard.includes(hook), false, `no ${hook} may run after the loading early-return`)
  }
  assert.match(settingsUi, /outletSetupOutlets, setOutletSetupOutlets/)
  assert.ok(settingsUi.indexOf('outletSetupOutlets, setOutletSetupOutlets') < guardAt, 'outlet-setup hooks must run before the loading guard')
})
