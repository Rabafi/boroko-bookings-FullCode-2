import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const REPAIR = 'supabase/migrations/20260711120000_lodge_camp_release_blockers_repair.sql'

function read(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8')
}

function latestCreatePosOrderBody() {
  const dir = join(ROOT, 'supabase/migrations')
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  let body = ''
  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8')
    const upper = sql.toUpperCase()
    const idx = upper.lastIndexOf('CREATE OR REPLACE FUNCTION PUBLIC.CREATE_POS_ORDER_V3')
    if (idx >= 0) {
      body = sql.slice(idx, idx + 40000)
    }
  }
  return body
}

describe('Lodge & Camp release-blocker repair', () => {
  it('repair migration exists and is the latest create_pos_order_v3 definition', () => {
    const sql = read(REPAIR)
    assert.ok(sql.includes('create or replace function public.create_pos_order_v3'), 'repairs create_pos_order_v3')
    const body = latestCreatePosOrderBody()
    assert.ok(body.includes('app_require_lodge_role'), 'latest order RPC uses app_require_lodge_role')
    assert.ok(!body.includes('user_lodge_roles'), 'latest order RPC must not reference user_lodge_roles')
    assert.ok(!body.includes('pos_outlets'), 'latest order RPC must not reference pos_outlets')
    assert.ok(!body.includes('public.gen_random_uuid'), 'latest order RPC must not call public.gen_random_uuid')
    assert.ok(body.includes('gen_random_uuid()'), 'uses gen_random_uuid without public schema')
    assert.ok(body.includes('pos_prep_tickets'), 'creates kitchen prep tickets')
    assert.ok(body.includes('_claim_financial_operation'), 'uses financial idempotency claim')
  })

  it('catalog publish uses live pos_promotions columns', () => {
    const sql = read(REPAIR)
    const idx = sql.toUpperCase().indexOf('CREATE OR REPLACE FUNCTION PUBLIC.PUBLISH_POS_CATALOG_SNAPSHOT')
    assert.ok(idx >= 0, 'repairs publish_pos_catalog_snapshot')
    const body = sql.slice(idx, idx + 5000)
    assert.ok(body.includes('discount_type'), 'reads discount_type')
    assert.ok(body.includes('discount_value'), 'reads discount_value')
    assert.ok(!body.includes("'type', p.type"), 'does not read nonexistent type column')
    assert.ok(body.includes('kitchen_station_id'), 'keeps kitchen station id in catalog payload')
  })

  it('void approval uses pin helpers rather than missing verify_pin/user_lodge_roles', () => {
    const sql = read(REPAIR)
    const idx = sql.toUpperCase().indexOf('CREATE OR REPLACE FUNCTION PUBLIC.APPROVE_POS_VOID_WITH_PIN')
    assert.ok(idx >= 0)
    const body = sql.slice(idx, idx + 6000)
    assert.ok(body.includes('_pos_validate_pin_internal') || body.includes('_pos_resolve_pin_internal'), 'uses pin helpers')
    assert.ok(!body.includes('user_lodge_roles'), 'no user_lodge_roles')
    assert.ok(!body.includes('verify_pin('), 'no missing verify_pin()')
    assert.ok(body.includes('event_booking_line_items'), 'reverses event folio charges')
  })

  it('guest portal session mint is lodge-scoped and token-hashed', () => {
    const sql = read(REPAIR)
    assert.ok(sql.includes('drop function if exists public.create_guest_portal_session(text, text)'), 'drops cross-tenant 2-arg mint')
    assert.ok(sql.includes('p_lodge_id uuid'), 'requires lodge id')
    assert.ok(sql.includes('app_require_lodge_role'), 'staff role gate for minting')
    assert.ok(sql.includes('token_hash'), 'stores hashed tokens')
    assert.ok(sql.includes("'hashed'"), 'stores non-secret token placeholder instead of plaintext secret')
    assert.ok(!sql.includes('b.booking_reference'), 'does not reference nonexistent booking_reference column')
  })

  it('implements missing guest portal RPCs used by booking-site UI', () => {
    const sql = read(REPAIR)
    for (const fn of [
      'get_guest_messages',
      'send_guest_message',
      'get_guest_requests',
      'get_guest_payment_history',
      'request_payment_link'
    ]) {
      assert.ok(sql.includes(`function public.${fn}`), `defines ${fn}`)
    }
    assert.ok(sql.includes('online_payments_unavailable') || sql.includes('Online payment links are not enabled'), 'payment link is unavailable without hosted checkout')
  })

  it('hardens manager auth sessions and throttling', () => {
    const sql = read(REPAIR)
    assert.ok(sql.includes("interval '14 days'"), 'PWA session TTL shortened')
    assert.ok(sql.includes('manager_auth_rate_limits'), 'rate limit table')
    assert.ok(sql.includes('revoke all on function public.authenticate_manager(text, text, uuid) from public, anon'), 'anon cannot brute force legacy password RPC')
  })

  it('desktop guest portal mint passes lodge_id', () => {
    const js = read('src/main/domains/guestPortal.js')
    assert.ok(js.includes('p_lodge_id: currentLodgeId'), 'passes lodge scope')
  })

  it('manager PWA no longer falls back to legacy password RPC on auth failure', () => {
    const api = read('manager-pwa/src/lib/api.js')
    const fnIdx = api.indexOf('export async function authenticateManager')
    const body = api.slice(fnIdx, fnIdx + 2200)
    assert.ok(body.includes('listManagerPwaMemberships') || body.includes('list_manager_pwa_memberships'), 'lists memberships after auth')
    assert.ok(body.includes('issueManagerPwaSession') || body.includes('issue_manager_pwa_session'), 'issues session after company selection')
    assert.ok(!body.includes("rpc('authenticate_manager'"), 'does not call legacy password RPC from client')
  })
})
