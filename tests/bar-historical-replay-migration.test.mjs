// Static contract for the REVISED historical sale replay migration
// (20261015010000, revision 2, patch-live) plus the R6 cash-up
// reconciliation migration (20261014070000) and the R8 menu revision
// (20261010020000). The migrations are held for Codex review and remain
// unapplied; these tests reconstruct the live create_pos_order_v3 contract
// from the applied September 2026 chain, verify every patch anchor occurs
// exactly once, and verify the patched result preserves claim-first
// ordering and installs the historical admission, reconciliation event and
// completeness guarantees. They supersede the blocked Codex reproduction
// probes (docs/audits/2026-10-15/bar-remote-remediation/codex-review/).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const read = (p) => fs.readFileSync(path.resolve(p), 'utf8')

const MIGRATION = 'supabase/migrations/20261015010000_pos_historical_sale_replay_v1.sql'
const CASHUP = 'supabase/migrations/20261014070000_pos_late_sale_cashup_reconciliation.sql'
const MENU = 'supabase/migrations/20261010020000_pos_menu_read_app_session_contract.sql'
const SOURCE = 'src/main/domains/syncShared.js'
const INFRA = 'src/main/domains/infrastructure.js'

const sql = read(MIGRATION)
const cashup = read(CASHUP)
const menu = read(MENU)
const syncShared = read(SOURCE)
const infrastructure = read(INFRA)

const BASE = 'supabase/migrations/20260905230000_pos_v3_atomic_tab_settlement.sql'
const CHAIN = [
  'supabase/migrations/20260905231000_pos_v3_duplicate_settlement_guard.sql',
  'supabase/migrations/20260905232000_pos_v3_tab_version_guard.sql',
  'supabase/migrations/20260905233000_pos_v3_claim_first_tab_settlement.sql',
  'supabase/migrations/20260905234000_pos_v3_tab_version_waiter.sql',
  'supabase/migrations/20260922000001_pool_cash_only_guard.sql'
]

const pairRegex = /v_(?:old|new)(?:\s+text)?\s*:=\s*\$(\w+)\$([\s\S]*?)\$\1\$/g

const extractPairs = (text) => {
  const literals = []
  for (const m of text.matchAll(pairRegex)) literals.push(m[2])
  assert.equal(literals.length % 2, 0, 'old/new literals must come in pairs')
  const pairs = []
  for (let i = 0; i < literals.length; i += 2) pairs.push([literals[i], literals[i + 1]])
  return pairs
}

const extractV3Body = () => {
  const base = read(BASE)
  const start = base.indexOf('create or replace function public.create_pos_order_v3(payload jsonb)')
  assert.ok(start > 0, 'base v3 function found')
  const endMark = base.indexOf('\n$$;;', start) >= 0 ? '\n$$;;' : '\n$$;'
  const end = base.indexOf(endMark, start)
  assert.ok(end > start, 'base v3 function terminator found')
  return base.slice(start, end + endMark.length)
}

const applyChain = (definition) => {
  let out = definition
  for (const file of CHAIN.slice(0, 4)) {
    const pairs = extractPairs(read(file))
    for (const [oldText, newText] of pairs) {
      const occ = out.split(oldText).length - 1
      assert.equal(occ, 1, `${file}: anchor must occur exactly once in the reconstructed chain`)
      out = out.replace(oldText, () => newText)
    }
  }
  const pool = read(CHAIN[4])
  const guard = pool.match(/v_guard text := \$guard\$([\s\S]*?)\$guard\$/)[1]
  const anchor = 'select s.*\n    into v_snapshot'
  const pos = out.indexOf(anchor)
  assert.ok(pos > 0, 'pool guard snapshot anchor exists')
  out = out.slice(0, pos) + guard + out.slice(pos)
  return out
}

const liveV3 = applyChain(extractV3Body())

const applyMigrationTo = (definition) => {
  let out = definition
  const pairs = extractPairs(sql)
  assert.ok(pairs.length >= 6, 'revision carries the six ordered patch pairs')
  for (const [oldText, newText] of pairs) {
    const occ = out.split(oldText).length - 1
    assert.equal(occ, 1, 'migration anchor must occur exactly once in the live contract')
    out = out.replace(oldText, () => newText)
  }
  return out
}

test('revision removes the rejected body-copy approach and never drops receipts', () => {
  assert.doesNotMatch(sql, /_create_pos_order_v3_impl/, 'obsolete September 5 body copy is gone')
  assert.doesNotMatch(sql, /drop function/i)
  assert.match(sql, /REVISION 2/)
  assert.match(sql, /pg_get_functiondef\('public\.create_pos_order_v3\(jsonb\)'::regprocedure\)/)
  assert.match(sql, /at most[\s\S]*never evidence|never evidence/i)
})

test('every patch anchor exists exactly once in the reconstructed live contract', () => {
  // applyMigrationTo asserts exactly-once for all six pairs on the
  // reconstructed chain; a drifted contract also fails closed at deploy
  // time inside the migration's own occurrence checks.
  const patched = applyMigrationTo(liveV3)
  assert.match(patched, /v_historical_admission_id/)
  assert.match(patched, /_pos_tab_settlement_owner_error_historical/)
  assert.match(patched, /pos_historical_replay_admissions/)
  assert.match(patched, /pos_cashup_reconciliation_events/)
  assert.match(patched, /pos_order_historical_replay/)
})

test('claim-first ordering survives the historical admission patch (R2/R3)', () => {
  const patched = applyMigrationTo(liveV3)
  const claimIdx = patched.indexOf('_claim_financial_operation(')
  const tabIdx = patched.indexOf('-- Tab lock, status/version validation')
  const histOwnerIdx = patched.indexOf('_pos_tab_settlement_owner_error_historical(')
  const recordIdx = patched.indexOf('_record_financial_operation(')
  const consumeIdx = patched.indexOf('consumed_order_id = v_order_id')
  assert.ok(claimIdx > 0 && tabIdx > 0 && histOwnerIdx > 0 && recordIdx > 0 && consumeIdx > 0)
  assert.ok(claimIdx < tabIdx, 'claim/replay return still precedes the tab lock')
  assert.ok(tabIdx < histOwnerIdx, 'ownership still validated inside the tab preamble')
  assert.ok(recordIdx < consumeIdx, 'admission is consumed only after the receipt is recorded')
  assert.match(patched, /if coalesce\(\(v_claim->>'found'\)::boolean, false\) then[\s\S]{0,120}return v_claim->'operation_result'/)
})

test('closed shifts fail closed unless a matching armed admission exists (R4)', () => {
  const patched = applyMigrationTo(liveV3)
  assert.match(patched, /if v_historical_admission_id is null\s*\n\s*or not found\s*\n\s*or \(select a\.shift_id/)
  assert.match(patched, /'code', 'historical_admission_missing'/)
  assert.match(patched, /a\.actor_id is not distinct from v_actor_id/)
  // No invented 56-day ceiling: the admission window follows the lodge's
  // configured offline trading hours (87600h for Bar-only, R4/policy).
  assert.doesNotMatch(sql, /make_interval\(days => 56\)/)
  assert.doesNotMatch(sql, /interval '56 days'/)
  assert.match(sql, /make_interval\(hours => greatest\(1, v_offline_hours\)\)/)
  assert.match(sql, /interval '24 hours'/)
})

test('the wrapper is receipt-first, scoped and idempotent (R3/R4/R5)', () => {
  assert.match(sql, /create or replace function public\.replay_pos_order_v3_historical_v1\(payload jsonb, p_replay_key text\)/)
  assert.match(sql, /v_replay_key <> 'hist-replay:' \|\| v_idempotency_key/)
  assert.match(syncShared, /POS_HISTORICAL_REPLAY_RPC = 'replay_pos_order_v3_historical_v1'/)
  const claimIdx = sql.indexOf('v_claim := public._claim_financial_operation(')
  const shiftIdx = sql.indexOf('from public.pos_shifts s')
  const scopeIdx = sql.indexOf("_pos_tab_is_bar_scope(v_lodge_id)")
  assert.ok(claimIdx > 0 && shiftIdx > 0 && scopeIdx > 0)
  assert.ok(claimIdx < shiftIdx, 'stored receipts return before any shift read')
  assert.ok(claimIdx < scopeIdx, 'stored receipts return before any scope/evidence check')
  assert.match(sql, /if lower\(v_shift\.status\) = 'open' then\s*\n\s*v_result := public\.create_pos_order_v3\(payload\)/)
  for (const code of ['historical_shift_unresolved', 'historical_time_mismatch', 'historical_window_expired', 'historical_replay_out_of_scope', 'historical_evidence_incomplete']) {
    assert.match(sql, new RegExp(`'code', '${code}'`), `${code} is classified structurally`)
  }
  assert.match(sql, /v_client_at < v_shift\.opened_at - interval '5 minutes'/)
  assert.match(sql, /v_client_at > v_shift\.closed_at \+ interval '5 minutes'/)
  assert.match(sql, /v_client_at > now\(\) \+ interval '5 minutes'/)
  assert.match(sql, /on conflict \(lodge_id, idempotency_key\) do update[\s\S]{0,400}consumed_at is null/)
  assert.doesNotMatch(sql, /gen_random_uuid\(\)[\s\S]{0,120}(idempotency|replay_key)/i, 'the replay never invents a fresh financial key')
})

test('admission helper and grants keep the private surfaces unreachable (R4)', () => {
  assert.match(sql, /create or replace function public\._pos_tab_settlement_owner_error_historical\(\s*p_admission_id uuid,/)
  assert.match(sql, /v_tab\.waiter_id is distinct from v_admission\.operator_id/)
  assert.match(sql, /revoke all on function public\._pos_tab_settlement_owner_error_historical\(uuid, jsonb\)\s*\n\s*from public, anon, authenticated, service_role;/)
  assert.match(sql, /grant execute on function public\.replay_pos_order_v3_historical_v1\(jsonb, text\)\s*\n\s*to anon, authenticated, service_role;/)
  assert.match(sql, /alter table public\.pos_historical_replay_admissions enable row level security/)
})

test('probe contract stays side-effect free and structured', () => {
  assert.match(sql, /if payload is null or jsonb_typeof\(payload\) <> 'object'[\s\S]{0,200}'code', 'replay_key_required'/)
  assert.match(infrastructure, /state\.supabase\.rpc\(POS_HISTORICAL_REPLAY_RPC, \{ payload: null, p_replay_key: null \}\)/)
  assert.match(syncShared, /isHistoricalReplayContractMissing/)
})

test('R6 gate: finalise refuses while a late-sale event is pending', () => {
  const finalize = read('supabase/migrations/20260807340000_cashup_variance_source_gl_posting.sql')
  const start = finalize.indexOf('create or replace function public.finalize_pos_shift_cashup_v2(payload jsonb)')
  assert.ok(start > 0)
  const end = finalize.indexOf('\n$$;', start)
  assert.ok(end > start)
  const body = finalize.slice(start, end)
  const pairs = extractPairs(cashup)
  assert.equal(pairs.length, 1, 'R6 carries exactly one guarded replacement pair')
  const [oldText, newText] = pairs[0]
  assert.equal(body.split(oldText).length - 1, 1, 'finalise claim anchor occurs exactly once')
  const patched = body.replace(oldText, () => newText)
  const claimIdx = patched.indexOf('_claim_financial_operation(')
  const gateIdx = patched.indexOf('cashup_reconciliation_required')
  const shiftIdx = patched.indexOf('select s.* into v_shift')
  assert.ok(claimIdx > 0 && gateIdx > 0 && shiftIdx > 0)
  assert.ok(claimIdx < gateIdx && gateIdx < shiftIdx, 'gate sits between claim and the locked shift')
  assert.match(patched, /e\.status = 'pending_review'/)
  // Resolution path: PIN-authorised, atomic, idempotent, never rewrites counts.
  assert.match(cashup, /create or replace function public\.resolve_pos_cashup_reconciliation_v1\(payload jsonb\)/)
  assert.match(cashup, /_restaurant_validate_manager_cashup_pin\(/)
  assert.match(cashup, /for update;/)
  assert.match(cashup, /'replayed', true/)
  assert.match(cashup, /'code', 'reconciliation_already_resolved'/)
  assert.doesNotMatch(cashup, /update public\.pos_cashup_submissions[\s\S]{0,200}set[\s\S]{0,120}(counted_by_method|expected_)/, 'never rewrites submitted counts or expectations')
  assert.doesNotMatch(cashup, /review_notes\s*=\s*left\(/, 'no note-only reconciliation remains')
  assert.match(cashup, /original_snapshot/)
  assert.match(cashup, /get_pos_cashup_reconciliation_events/)
  assert.match(cashup, /'reconciliation_required'/)
})

test('R8: menu read returns the complete catalogue and offers a fingerprint', () => {
  assert.doesNotMatch(menu, /limit 500/i, 'implicit 500-row truncation removed')
  assert.match(menu, /create or replace function public\.get_pos_menu_catalog_fingerprint_v1\(p_lodge_id uuid\)/)
  assert.match(menu, /'item_count', v_item_count/)
  assert.match(menu, /outlet_scoped/)
  assert.match(menu, /grant execute on function public\.get_pos_menu_catalog_fingerprint_v1\(uuid\) to anon, authenticated;/)
  assert.match(menu, /POS view capability is required/)
})
