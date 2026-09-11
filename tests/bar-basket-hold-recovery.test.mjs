import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BASKET_DRAFT_TTL_MS,
  basketDraftKey,
  holdIntentKey,
  lastReceiptKey,
  reconcileHoldIntent,
} from '../src/shared/tillBasketRecovery.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const terminal = () => read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')

test('F5: canonical storage keys cannot diverge between writers and readers', () => {
  assert.equal(basketDraftKey('lodge', 'outlet', 'op', 'shift'), 'hpos-basket-draft:lodge:outlet:op:shift')
  assert.equal(holdIntentKey('lodge', 'outlet', 'op'), 'hpos-hold-intent:lodge:outlet:op:any')
  assert.equal(lastReceiptKey('lodge', 'outlet'), 'hpos-last-receipt:lodge:outlet')
  const source = terminal()
  assert.equal(/BASKET_DRAFT_PREFIX|HOLD_INTENT_PREFIX|LAST_RECEIPT_PREFIX/.test(source), false)
  assert.match(source, /basketDraftKey\(/)
  assert.match(source, /holdIntentKey\(/)
  assert.match(source, /lastReceiptKey\(/)
})

test('F5: hold intents reconcile by server tab identity, never heuristics', () => {
  const tabs = [{ id: 'tab-1', name: 'Thabo', updated_at: new Date().toISOString() }]
  assert.deepEqual(reconcileHoldIntent(null, tabs), { outcome: 'absent' })
  assert.deepEqual(reconcileHoldIntent({}, tabs), { outcome: 'absent' })
  // Same name, different id: NOT a confirmation.
  assert.equal(
    reconcileHoldIntent({ tabId: 'tab-9', tabName: 'Thabo', at: Date.now() }, tabs).outcome,
    'unknown',
  )
  // Matching id: confirmed even with a skewed clock or renamed tab.
  const confirmed = reconcileHoldIntent({ tabId: 'tab-1', tabName: 'Other', at: Date.now() - 3600000 }, tabs)
  assert.equal(confirmed.outcome, 'confirmed')
  assert.equal(confirmed.tab.id, 'tab-1')
  // Stale intents expire instead of haunting future mounts.
  assert.equal(
    reconcileHoldIntent({ tabId: 'tab-1', at: Date.now() - BASKET_DRAFT_TTL_MS - 1 }, tabs).outcome,
    'expired',
  )
})

test('F5: Till gates persistence, submits the held id, and preserves unknown outcomes', () => {
  const source = terminal()
  // Recovery initialization completes before draft persistence may run or delete.
  assert.match(source, /recoveryInitialized/)
  assert.match(source, /if \(loading \|\| !recoveryInitialized/)
  // The submitted hold carries the persisted intent id.
  assert.match(source, /const holdTabId = location\.state\?\.tabId \|\| selectedOpenTab\?\.id \|\| holdKey;/)
  assert.match(source, /id: holdTabId,/)
  assert.match(source, /tabId: holdTabId,/)
  // Storage failure blocks the hold instead of dispatching unrecorded work.
  assert.match(source, /if \(!writeJsonSetting\(holdIntentKey/)
  assert.match(source, /Nothing was held; check storage and retry/)
  // Intent survives unknown outcomes; explicit discard drops both records.
  assert.match(source, /Unknown outcomes preserve the intent/)
  assert.match(source, /if \(pendingRestore\?\.intentKey\) writeJsonSetting\(pendingRestore\.intentKey, null\)/)
  // Storage failure is actionable, not silent.
  assert.match(source, /draftPersistFailed/)
  assert.match(source, /will not survive a restart/)
})
