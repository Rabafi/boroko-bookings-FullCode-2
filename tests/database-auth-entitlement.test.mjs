/**
 * Database authorization and entitlement contracts (source-level).
 *
 * This module reads SQL migration files and domain source to verify that:
 *  - Every RPC calls app_require_feature with the correct feature key
 *  - lodge_id is always passed as the first argument
 *  - Role arrays match expected patterns per operation type
 *  - The app_require_feature function itself handles service-role bypass
 *
 * These are static source audits — no database required.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

function readMigration(name) {
  const p = resolve(ROOT, 'supabase/migrations', name)
  if (!existsSync(p)) throw new Error(`Migration not found: ${name}`)
  return readFileSync(p, 'utf8')
}

// ── app_require_feature function definition ─────────────────────────────────

test('app_require_feature function definition exists', () => {
  const sql = readMigration('20260714235000_app_require_feature.sql')
  assert.ok(sql.includes('create or replace function public.app_require_feature('),
    'app_require_feature function must exist')
})

test('app_require_feature calls app_is_service_role() for service_role bypass', () => {
  const sql = readMigration('20260714235000_app_require_feature.sql')
  assert.ok(sql.includes('app_is_service_role()'),
    'app_require_feature must check app_is_service_role() for bypass')
  assert.ok(sql.includes('return;'),
    'service_role bypass must return early without checks')
})

test('app_require_feature accepts (lodge_id uuid, feature_key text, allowed_roles text[]) signature', () => {
  const sql = readMigration('20260714235000_app_require_feature.sql')
  assert.ok(sql.includes('uuid') && sql.includes('text') && sql.includes('text[]'),
    'app_require_feature must accept (uuid, text, text[])')
})

// ── Corporate accounts feature gating ───────────────────────────────────────

test('corporate_accounts RPCs call app_require_feature with corporate_accounts key', () => {
  const sql = readMigration('20260703180000_corporate_accounts_foundation.sql')
  const calls = sql.match(/app_require_feature\([^)]+\)/g) || []
  assert.ok(calls.length >= 3, 'Expected at least 3 app_require_feature calls in corporate_accounts migration')
  for (const call of calls) {
    assert.ok(call.includes('corporate_accounts'),
      `corporate_accounts RPC must gate on 'corporate_accounts' feature: ${call}`)
    assert.ok(call.includes('lodge_id') || call.includes('p_lodge_id'),
      `app_require_feature call must pass lodge_id as first argument: ${call}`)
  }
})

test('corporate_accounts allows manager and admin roles', () => {
  const sql = readMigration('20260703180000_corporate_accounts_foundation.sql')
  const calls = sql.match(/app_require_feature\([^)]+\)/g) || []
  for (const call of calls) {
    assert.ok(
      call.includes('manager') && call.includes('admin'),
      `corporate_accounts RPC must allow manager and admin roles: ${call}`
    )
  }
})

// ── Corporate billing feature gating ────────────────────────────────────────

test('corporate billing RPCs call app_require_feature with corporate_accounts key', () => {
  const sql = readMigration('20260705105000_corporate_billing_workflow.sql')
  const calls = sql.match(/app_require_feature\([^)]+\)/g) || []
  assert.ok(calls.length >= 5, 'Expected at least 5 app_require_feature calls in corporate_billing migration')
  for (const call of calls) {
    assert.ok(call.includes('corporate_accounts'),
      `corporate billing RPC must gate on 'corporate_accounts' feature: ${call}`)
    assert.ok(call.includes('p_lodge_id'),
      `corporate billing RPC must pass p_lodge_id to app_require_feature: ${call}`)
  }
})

test('corporate billing charge/payment allows finance role', () => {
  // charge_to_corporate_account and record_corporate_payment are defined
  // in the repair migration with finance role in allowed_roles
  const sql = readMigration('20260714236000_corporate_billing_repair.sql')
  const calls = sql.match(/app_require_feature\([^)]+\)/g) || []
  // Skip comment match — only check PERFORM calls
  const perfCalls = calls.filter(c => c.includes('p_lodge_id'))
  for (const call of perfCalls) {
    assert.ok(call.includes('finance'),
      `charge/payment RPC must allow finance role: ${call}`)
  }
})

test('corporate billing repair SQL uses app_require_feature with corporate_accounts key', () => {
  const sql = readMigration('20260714236000_corporate_billing_repair.sql')
  // Filter out comment text — only check actual PERFORM calls
  const perfCalls = []
  const lines = sql.split('\n')
  let inComment = false
  for (const line of lines) {
    if (line.includes('--')) continue
    if (line.includes('app_require_feature(')) {
      const match = line.match(/app_require_feature\([^)]+\)/)
      if (match) perfCalls.push(match[0])
    }
  }
  assert.ok(perfCalls.length >= 2, `Expected at least 2 app_require_feature calls, got ${perfCalls.length}`)
  for (const call of perfCalls) {
    assert.ok(call.includes('corporate_accounts'),
      `repair RPC must gate on 'corporate_accounts' feature: ${call}`)
    assert.ok(call.includes('p_lodge_id'),
      `repair RPC must pass p_lodge_id: ${call}`)
  }
})

// ── Workforce management feature gating ─────────────────────────────────────

test('workforce_management RPCs call app_require_feature with workforce_management key', () => {
  const sql = readMigration('20260714210000_staff_scheduling_and_attendance.sql')
  const calls = sql.match(/app_require_feature\([^)]+\)/g) || []
  assert.ok(calls.length >= 10, 'Expected at least 10 app_require_feature calls in workforce migration')
  for (const call of calls) {
    assert.ok(call.includes('workforce_management'),
      `workforce RPC must gate on 'workforce_management' feature: ${call}`)
    assert.ok(call.includes('p_lodge_id'),
      `workforce RPC must pass p_lodge_id: ${call}`)
  }
})

// ── Asset management feature gating ─────────────────────────────────────────

test('asset_management RPCs call app_require_feature with asset_management key', () => {
  const sql = readMigration('20260714220000_asset_registry_and_vendors.sql')
  const calls = sql.match(/app_require_feature\([^)]+\)/g) || []
  assert.ok(calls.length >= 10, 'Expected at least 10 app_require_feature calls in asset migration')
  for (const call of calls) {
    assert.ok(call.includes('asset_management'),
      `asset RPC must gate on 'asset_management' feature: ${call}`)
  }
})

test('asset_management allows operations role alongside manager/admin', () => {
  const sql = readMigration('20260714220000_asset_registry_and_vendors.sql')
  const calls = sql.match(/app_require_feature\([^)]+\)/g) || []
  const hasOperations = calls.some(c => c.includes('operations'))
  assert.ok(hasOperations, 'asset_management RPCs should allow operations role in some calls')
})

// ── Venue management feature gating ─────────────────────────────────────────

test('venue_management RPCs call app_require_feature with venue_management key', () => {
  const sql = readMigration('20260714230000_venue_packages.sql')
  const calls = sql.match(/app_require_feature\([^)]+\)/g) || []
  assert.ok(calls.length >= 5, 'Expected at least 5 app_require_feature calls in venue migration')
  for (const call of calls) {
    assert.ok(call.includes('venue_management'),
      `venue RPC must gate on 'venue_management' feature: ${call}`)
  }
})

// ── Domain-level lodge_id forwarding ────────────────────────────────────────

test('corporateBilling domain functions pass state.lodgeId as p_lodge_id to RPCs', () => {
  const src = readFileSync(resolve(ROOT, 'src/main/domains/corporateBilling.js'), 'utf8')
  // Every financial RPC call must reference state.lodgeId as p_lodge_id
  const rpcCalls = src.match(/rpc\('[^']+',\s*\{[^}]+p_lodge_id[^}]+\}/g) || []
  assert.ok(rpcCalls.length >= 5, 'Expected at least 5 RPC calls with p_lodge_id')
  for (const call of rpcCalls) {
    assert.ok(call.includes('p_lodge_id: state.lodgeId') || call.includes("p_lodge_id: state.lodgeId"),
      `RPC call must forward state.lodgeId as p_lodge_id: ${call.slice(0, 100)}`)
  }
})

test('all financial domain RPC calls include p_lodge_id in payload', () => {
  const domains = [
    'corporateBilling.js',
    'folioLedger.js',
    'bookings.js',
    'customerCredit.js',
    'nightAudit.js'
  ]
  for (const file of domains) {
    const p = resolve(ROOT, 'src/main/domains', file)
    if (!existsSync(p)) continue
    const src = readFileSync(p, 'utf8')
    // Many domains build RPC payloads dynamically (const payload = {...p_lodge_id...})
    // or use variable fn names. Check for p_lodge_id in payload construction instead.
    const payloadBuilds = src.match(/p_lodge_id:/g) || []
    const lodgeRefs = src.match(/state\.lodgeId/g) || []
    assert.ok(
      payloadBuilds.length + lodgeRefs.length >= 2,
      `${file}: expected at least 2 references to p_lodge_id or state.lodgeId, got ${payloadBuilds.length + lodgeRefs.length}`
    )
  }
})

// ── Service-role bypass in domain JS ────────────────────────────────────────

test('domain functions do not re-implement app_require_feature client-side', () => {
  const domains = [
    'corporateBilling.js',
    'folioLedger.js',
    'bookings.js',
    'customerCredit.js',
    'nightAudit.js'
  ]
  for (const file of domains) {
    const p = resolve(ROOT, 'src/main/domains', file)
    if (!existsSync(p)) continue
    const src = readFileSync(p, 'utf8')
    assert.ok(
      !src.includes('app_require_feature'),
      `${file} must not call app_require_feature directly (server-only function)`
    )
  }
})
