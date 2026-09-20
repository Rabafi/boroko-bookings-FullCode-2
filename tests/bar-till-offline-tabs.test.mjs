import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const main = () => read('src/main/index.js')
const pos = () => read('src/main/domains/pos.js')
const sync = () => read('src/main/domains/infrastructure.js')
const terminal = () => read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
const checks = () => read('src/renderer/src/components/hospitality-pos/HposOpenChecks.jsx')

test('offline tabs open behind an unlocked Till, not a live proof', () => {
  const source = main()
  assert.match(source, /if \(sharedTillOperatorSessions\.get\(event\?\.sender\?\.id\)\) return null/)
  assert.match(source, /Unlock Till with the serving staff PIN before opening or changing a tab while offline\./)
})

test('offline tab saves store locally and queue last-writer-wins', () => {
  const source = pos()
  assert.match(source, /const tabQueueId = `pos-tab-\$\{id\}`/)
  assert.match(source, /queuedTabs\[queuedTabIndex\] = \{ \.\.\.queuedTabs\[queuedTabIndex\], data: \{ payload: row \}/)
  assert.match(source, /_pending_settlement: true/)
  assert.doesNotMatch(source, /Tab changes require a live connection/)
})

test('offline tab status changes queue behind their tab create', () => {
  const source = pos()
  assert.match(source, /_queue_id: `pos-tab-status-\$\{id\}-\$\{nextStatus\}`/)
  assert.match(source, /\.\.\.\(current\?\._pending_sync \? \{ _depends_on: `pos-tab-\$\{id\}` \} : \{\}\)/)
  assert.doesNotMatch(source, /Tab status changes require a live connection/)
})

test('offline tab sales queue behind their tab with a pinned version', () => {
  const source = pos()
  assert.match(source, /\.\.\.\(data\.tab_id \? \[`pos-tab-\$\{data\.tab_id\}`\] : \[\]\)/)
  assert.doesNotMatch(source, /Bar tab sales require a live connection/)
})

test('replay reattributes weeks-old tab work to the current open shift', () => {
  const source = sync()
  assert.match(source, /item\.table === 'upsert_pos_tab' \|\| item\.table === 'create_pos_order_v3'/)
  assert.match(source, /replay_shift_rewritten|Replay attributed to current open shift/)
  assert.match(source, /delete replayData\.payload\._operator_proof/)
})

test('tab version conflicts go straight to manager review', () => {
  const source = sync()
  assert.match(source, /tab_version_conflict\|tab_version_required\|tab_not_owned\|tab_already_settled/)
})

test('dead tab settlements reopen the local tab visibly', () => {
  const source = sync()
  assert.match(source, /status: 'open'/)
  assert.match(source, /_sync_error: errorMessage/)
})

test('tab financial tables stay visible to risk counts', () => {
  const queue = read('src/shared/syncQueue.js')
  assert.match(queue, /'upsert_pos_tab'/)
  assert.match(queue, /'update_pos_tab_status'/)
})

test('Open Tabs settles uncertified estimates and names pending sync', () => {
  const source = checks()
  assert.match(source, /tabSettleValue/)
  assert.match(source, /Pending sync/)
  assert.match(source, /server prices at replay/)
})

test('Till hold reports queued holds offline', () => {
  const source = terminal()
  assert.match(source, /Will send when online\./)
})
