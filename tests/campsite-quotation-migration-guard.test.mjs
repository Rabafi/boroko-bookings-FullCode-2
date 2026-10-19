import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Guard for migration 20261014030000 Part A: the runtime string patch expects
// exactly one tents/vehicles zero-fill in the checked-in multi-room source,
// and the replacement must mirror the request-side normalization already
// present in that function. If a later migration edits the comparison, this
// fails loudly here (and the migration itself raises at apply time) instead
// of patching the wrong expression. Behavioral proof lives in
// campsite-quotation-conversion.test.mjs; live proof in
// campsite-quotation-conversion-sql.test.mjs (disposable DB).
const multi = readFileSync(
  new URL('../supabase/migrations/20261005090000_luna_multi_room_quotation_atomicity.sql', import.meta.url),
  'utf8'
)
const migration = readFileSync(
  new URL('../supabase/migrations/20261014030000_campsite_quotation_conversion_carry.sql', import.meta.url),
  'utf8'
)

test('multi-room patch target occurs exactly once in the checked-in source', () => {
  const target = "'tents',0,'vehicles',0"
  const occurrences = multi.split(target).length - 1
  assert.equal(occurrences, 1, 'expected exactly one zero-fill site for the runtime patch')
})

test('migration replacement mirrors the request-side normalization', () => {
  // The replacement must mirror the request-side normalization already present
  // in the same function (v_requested_rooms block).
  const requestSide = "'tents',greatest(coalesce(nullif(btrim(x.value->>'tents'),''),'0')::integer,0),"
  assert.ok(multi.includes(requestSide), 'request-side tents normalization present in source')
  const vehiclesSide = "'vehicles',greatest(coalesce(nullif(btrim(x.value->>'vehicles'),''),'0')::integer,0)"
  assert.ok(multi.includes(vehiclesSide), 'request-side vehicles normalization present in source')
  // The migration embeds the replacement inside an E'' string, so quotes are
  // doubled there. Decode by collapsing doubled quotes, then compare.
  const decoded = migration.replace(/''/g, "'")
  assert.ok(decoded.includes(requestSide), 'migration replacement carries the tents expression')
  assert.ok(decoded.includes(vehiclesSide), 'migration replacement carries the vehicles expression')

  // The patched block must read like the request-side block.
  const patched = multi.replace(
    "'tents',0,'vehicles',0",
    "'tents',greatest(coalesce(nullif(btrim(x.value->>'tents'),''),'0')::integer,0),\n          'vehicles',greatest(coalesce(nullif(btrim(x.value->>'vehicles'),''),'0')::integer,0)"
  )
  const block = patched.slice(patched.indexOf('into v_quotation_rooms') - 420, patched.indexOf('into v_quotation_rooms') + 60)
  assert.match(block, /'tents',greatest\(coalesce\(nullif\(btrim\(x\.value->>'tents'\)/)
})

test('single-convert replacement preserves legacy markers and framing', () => {
  // Part B: inner conversion replacement must preserve every legacy marker.
  for (const marker of [
    'convert_quotation_to_booking_pre_intent_v1',
    'get_next_invoice_number',
    'update_booking_payment',
    "'booking_type', v_q.quotation_type",
    "'quotation-conversion:' || p_quotation_id::text",
    'accommodation_booking_expected_total',
    'booking_accommodation_details',
    'does not match the campsite rate',
    'notify pgrst'
  ]) {
    assert.ok(migration.includes(marker), 'migration carries marker: ' + marker)
  }
  // Migration must not touch the public envelope wrapper or its grants.
  assert.doesNotMatch(migration, /create or replace function public\.convert_quotation_to_booking\(/)
  // Balanced transaction + dollar-quoting.
  const begins = (migration.match(/^begin;/gm) || []).length
  const commits = (migration.match(/^commit;/gm) || []).length
  const dollars = (migration.match(/\$\$/g) || []).length
  assert.equal(begins, 1)
  assert.equal(commits, 1)
  assert.ok(dollars % 2 === 0 && dollars >= 4, 'balanced dollar-quoting')
})
