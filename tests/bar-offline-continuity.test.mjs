import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  FINANCIAL_SYNC_TABLES,
  pickNextReadySyncItemIndex
} from '../src/shared/syncQueue.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('trusted offline login remains locally unlockable for sixty days', () => {
  const auth = read('src/main/domains/authSession.js')
  const secureStore = read('src/main/domains/secureLocalStore.js')

  assert.match(auth, /TRUSTED_SESSION_MAX_AGE_MS\s*=\s*60\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/)
  assert.match(auth, /trusted-sessions\.json/)
  assert.match(auth, /bcrypt\.compare/)
  assert.match(auth, /trustedSessionExpiresAt[\s\S]*TRUSTED_SESSION_MAX_AGE_MS/)
  assert.match(secureStore, /safeStorage\.encryptString/)
})

test('PIN-bearing offline operations are encrypted in the durable queue', () => {
  const secrets = read('src/main/domains/secureQueueSecrets.js')
  assert.match(secrets, /'pin'/)
  assert.match(secrets, /'approval_pin'/)
  assert.match(secrets, /'manager_pin'/)
  assert.match(secrets, /electron-safeStorage/)
})

test('multi-parent queue dependencies wait for every Bar prerequisite', () => {
  const queue = [
    { _queue_id: 'sale-1' },
    { _queue_id: 'shift-1' },
    {
      _queue_id: 'cashup-1',
      _depends_on: 'shift-1',
      _depends_on_all: ['shift-1', 'sale-1']
    }
  ]

  assert.equal(pickNextReadySyncItemIndex(queue), 0)
  assert.equal(pickNextReadySyncItemIndex(queue.slice(1), new Set(['sale-1'])), 0)
  assert.equal(pickNextReadySyncItemIndex([queue[2]], new Set(['sale-1'])), 0)

  const waiting = [queue[2], queue[0]]
  assert.equal(pickNextReadySyncItemIndex(waiting), 1)
})

test('offline cash-up operations are classified as financial risk', () => {
  for (const operation of [
    'submit_pos_shift_cashup',
    'submit_pos_shift_cashup_with_attendance_pin',
    'review_pos_cashup_submission_offline',
    'finalize_pos_shift_cashup_v2'
  ]) {
    assert.equal(FINANCIAL_SYNC_TABLES.has(operation), true, operation)
  }
})

test('Bar Mode queues catalog, Till, sales, cash-up, and attendance replay', () => {
  const pos = read('src/main/domains/pos.js')
  for (const operation of [
    'publish_pos_catalog_snapshot_offline',
    'create_pos_menu_item_offline',
    'save_bar_pos_product_with_packs_offline',
    'clock_in_staff_with_attendance_pin_offline',
    'activate_shared_till_operator_offline',
    'open_pos_shift_with_id',
    'create_pos_order_v3',
    'submit_pos_shift_cashup_with_attendance_pin',
    'review_pos_cashup_submission_offline',
    'finalize_pos_shift_cashup_v2'
  ]) {
    assert.match(pos, new RegExp(`['\"]${operation}['\"]`), operation)
  }
  assert.match(pos, /_depends_on_all/)
})

test('database migration preserves authoritative replay and a sixty-day Bar catalog window', () => {
  const sql = read('supabase/migrations/20260816200000_bar_offline_continuity.sql')
  assert.match(sql, /pos_offline_trading_hours\s*=\s*greatest[\s\S]*1440/i)
  assert.match(sql, /app_session_ttl[\s\S]*interval '60 days'/i)
  assert.match(sql, /update public\.app_sessions[\s\S]*session_type = 'desktop'[\s\S]*revoked_at is null/i)
  assert.match(sql, /create or replace function public\.publish_pos_catalog_snapshot_offline/i)
  assert.match(sql, /create or replace function public\.activate_shared_till_operator_offline/i)
  assert.match(sql, /create or replace function public\.review_pos_cashup_submission_offline/i)
  assert.match(sql, /public\.app_require_lodge_role/)
  assert.match(sql, /public\.app_require_restaurant_lodge/)
})
