import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { refreshCachedTrialCountdown } from '../src/main/domains/trialCountdown.js'

const cachedTrial = {
  lodge_id: 'hotel-1',
  status: 'trial',
  daysLeft: 30,
  expired: false,
  plan: 'Trial',
  offline_valid_until: '2026-08-01T12:00:00.000Z'
}

test('offline trial countdown is recalculated from its authoritative deadline', () => {
  const result = refreshCachedTrialCountdown(cachedTrial, new Date('2026-07-31T11:59:00.000Z'))
  assert.equal(result.status, 'trial')
  assert.equal(result.daysLeft, 2)
  assert.equal(result.expired, false)
})

test('offline trial expires when its authoritative deadline is reached', () => {
  const result = refreshCachedTrialCountdown(cachedTrial, new Date('2026-08-01T12:00:00.000Z'))
  assert.equal(result.status, 'expired')
  assert.equal(result.daysLeft, 0)
  assert.equal(result.expired, true)
  assert.equal(result.plan, null)
  assert.equal(result.effective_features.hotel_mode, false)
})

test('licensed cached entitlements are not rewritten as trials', () => {
  const licensed = { status: 'licensed', daysLeft: null, plan: 'Enterprise' }
  assert.equal(refreshCachedTrialCountdown(licensed), licensed)
})

test('settings cannot retain a missing trial anchor', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20260721162000_trial_anchor_integrity.sql', import.meta.url), 'utf8')
  assert.match(migration, /trial_started_at = coalesce\(created_at, updated_at, now\(\)\)/i)
  assert.match(migration, /alter column trial_started_at set default now\(\)/i)
  assert.match(migration, /settings_trial_anchor_guard/i)
})
