import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const evidence = resolve(repoRoot, 'docs/engineering/typescript-migration/evidence')
const preimagePath = resolve(evidence, 'L02-preimages-workerA-2026-10-15/StarterBackup-before-history-reply-boundary-2026-10-15.jsx.txt')
const currentPath = resolve(repoRoot, 'src/renderer/src/components/StarterBackup.jsx')
const read = (path) => readFileSync(path, 'utf8')

function evaluate(source, mockRequire, windowValue) {
  const code = esbuild.transformSync(source, { loader: 'jsx', format: 'cjs', target: 'es2022', jsx: 'automatic' }).code
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'window', code)(mockRequire, module, module.exports, windowValue)
  return module.exports
}
function importComponent(source, api) {
  const states = []
  const effects = []
  let cursor = 0
  const react = {
    useState(initial) {
      const slot = cursor++
      if (!(slot in states)) states[slot] = typeof initial === 'function' ? initial() : initial
      return [states[slot], (next) => { states[slot] = typeof next === 'function' ? next(states[slot]) : next }]
    },
    useEffect(effect) { effects.push(effect) }
  }
  const jsxRuntime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' }
  const icons = Object.fromEntries(['AlertCircle', 'CalendarClock', 'CheckCircle2', 'Copy', 'Download', 'Eye', 'EyeOff', 'FileCheck2', 'FileKey2', 'FolderOpen', 'Loader2', 'ShieldCheck'].map((name) => [name, name]))
  const mockRequire = (specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    if (specifier === 'lucide-react') return icons
    throw new Error(`Unexpected import: ${specifier}`)
  }
  const imported = evaluate(source, mockRequire, { api })
  const render = () => { cursor = 0; return imported.default({ embedded: true }) }
  return { render, states, effects }
}
const flush = async () => { await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve)) }
async function snapshot(source, historyReply, { automationReply, reject = false } = {}) {
  const calls = []
  const api = { backup: {
    starterHistory: async (...args) => {
      calls.push(['starterHistory', ...args])
      if (reject) throw new Error('history unavailable')
      return historyReply
    },
    automationStatus: async (...args) => {
      calls.push(['automationStatus', ...args])
      if (reject) throw new Error('automation unavailable')
      return automationReply
    }
  } }
  const runtime = importComponent(source, api)
  let tree = runtime.render()
  for (const effect of runtime.effects.splice(0)) effect()
  await flush()
  let renderError = null
  try { tree = runtime.render() } catch (error) { renderError = `${error.name}: ${error.message}`; tree = null }
  return { calls, states: runtime.states, tree, renderError }
}

test('actual StarterBackup import preserves the main-built history envelope and unvalidated JSON rows', async () => {
  const before = read(preimagePath)
  const current = read(currentPath)
  const validRows = [{ id: 'backup-1', at: '2026-10-15T00:00:00.000Z', fileName: 'lodge.tbbackup', destination: 'C:/backups/lodge.tbbackup', complete: true }]
  const malformedRows = [123, 'persisted-row', { id: null, at: 0, fileName: 17, destination: { malformed: true }, complete: 'yes' }]
  for (const historyReply of [
    { success: true, lastBackupAt: validRows[0].at, lastBackupFileName: validRows[0].fileName, lastBackupComplete: true, ageDays: 0, state: 'current', reminderDays: 7, history: validRows },
    { success: true, lastBackupAt: 'not-a-date', lastBackupFileName: 17, lastBackupComplete: false, ageDays: Number.NaN, state: 'incomplete', reminderDays: 7, history: malformedRows },
    { success: true, lastBackupAt: null, lastBackupFileName: null, lastBackupComplete: null, ageDays: null, state: 'never', reminderDays: 7, history: [] },
    { success: false, error: 'history unavailable' },
    null,
    'malformed-response'
  ]) {
    const oldState = await snapshot(before, historyReply)
    const newState = await snapshot(current, historyReply)
    assert.deepEqual(newState.calls, oldState.calls)
    assert.deepEqual(newState.states, oldState.states)
    assert.equal(newState.renderError, oldState.renderError)
  }
  const oldMalformed = await snapshot(before, { success: true, lastBackupAt: null, lastBackupFileName: null, lastBackupComplete: false, ageDays: null, state: 'incomplete', reminderDays: 7, history: malformedRows })
  const newMalformed = await snapshot(current, { success: true, lastBackupAt: null, lastBackupFileName: null, lastBackupComplete: false, ageDays: null, state: 'incomplete', reminderDays: 7, history: malformedRows })
  assert.equal(oldMalformed.states[3].history, malformedRows)
  assert.equal(newMalformed.states[3].history, malformedRows)
  const oldRejected = await snapshot(before, undefined, { reject: true })
  const newRejected = await snapshot(current, undefined, { reject: true })
  assert.deepEqual(newRejected.calls, oldRejected.calls)
  assert.deepEqual(newRejected.states, oldRejected.states)
  assert.equal(newRejected.renderError, oldRejected.renderError)
})

test('actual StarterBackup import preserves JSON-backed automation status and error outcomes', async () => {
  const before = read(preimagePath)
  const current = read(currentPath)
  const history = [{ destination: { opaque: true }, fileName: 12, complete: 'yes' }]
  for (const automationReply of [
    { success: true, lodge_id: 'lodge-1', enabled: false, config: null, status: { last_success_at: null, last_success_sha256: null, last_success_destination: null, last_verified_at: null, next_due_at: '2026-10-15T00:00:00.000Z', last_failure_at: null, last_failure_reason: null, snoozed_until: null, audit_state: null, state: 'disabled' }, history: [], latest_history_entry: null },
    { success: true, lodge_id: 'lodge-1', enabled: true, config: { destination_folder: { malformed: true }, destination_label: 0, retained_copies: 'many', created_at: null, updated_at: {} }, status: { last_success_at: 'invalid-date', last_success_sha256: 42, last_success_destination: false, last_verified_at: {}, next_due_at: 'invalid-date', last_failure_at: null, last_failure_reason: 5, snoozed_until: '', audit_state: { opaque: true }, state: 'due' }, history, latest_history_entry: history[0] },
    { success: false, error: 'automation unavailable' },
    null,
    'malformed-response'
  ]) {
    const oldState = await snapshot(before, undefined, { automationReply })
    const newState = await snapshot(current, undefined, { automationReply })
    assert.deepEqual(newState.calls, oldState.calls)
    assert.deepEqual(newState.states, oldState.states)
    assert.equal(newState.renderError, oldState.renderError)
  }
  const malformed = await snapshot(current, undefined, { automationReply: { success: true, lodge_id: 'lodge-1', enabled: true, config: { destination_folder: { malformed: true }, destination_label: 0, retained_copies: 'many', created_at: null, updated_at: {} }, status: { last_success_at: 'invalid-date', last_success_sha256: 42, last_success_destination: false, last_verified_at: {}, next_due_at: 'invalid-date', last_failure_at: null, last_failure_reason: 5, snoozed_until: '', audit_state: { opaque: true }, state: 'due' }, history, latest_history_entry: history[0] } })
  assert.equal(malformed.states[7].config.destination_folder.malformed, true)
  assert.equal(malformed.states[7].history, history)
})
