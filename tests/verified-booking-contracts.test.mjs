import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getBookingFinancialView, isPendingBookingFinancial, bookingPaymentStatusLabel } from '../src/shared/bookingFinancials.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

function between(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `missing section start: ${start}`)
  const endIndex = end ? source.indexOf(end, startIndex + start.length) : -1
  return source.slice(startIndex, endIndex === -1 ? undefined : endIndex)
}

test('forward SQL migration contains atomic booking status/import/group/public contracts', () => {
  const sql = read('supabase/migrations/20260904090000_verified_booking_contracts.sql')
  assert.match(sql, /create or replace function public\.update_booking_status\(/)
  assert.match(sql, /paid_cancellation_requires_refund/)
  assert.match(sql, /checkout_balance_due/)
  assert.match(sql, /financial_audit_log/)
  assert.match(sql, /create or replace function public\.import_booking_row\(/)
  assert.match(sql, /update_booking_payment/)
  assert.match(sql, /create or replace function public\.update_campsite_booking\(/)
  assert.match(sql, /create or replace function public\.reschedule_accommodation_booking\(/)
  assert.match(sql, /set_config\('app\.campsite_tents'/)
  assert.match(sql, /create table if not exists public\.booking_group_idempotency/)
  assert.match(sql, /create or replace function public\.create_multi_room_booking\(/)
  assert.match(sql, /booking_invoice_group_lines/)
  assert.match(sql, /for update/)
  assert.match(sql, /order by value->>'room_id'/)
  assert.match(sql, /'booking_group_created'/)
  assert.match(sql, /quote_changed/)
  assert.match(sql, /create_online_booking_legacy/)
  assert.match(sql, /create table if not exists public\.public_booking_idempotency/)
  assert.match(sql, /idempotency_conflict/)
  assert.match(sql, /all_cancelled/)
  assert.match(sql, /v_legacy_fallback_key/)
  assert.match(sql, /v_key := v_hash/)
})

test('bulk booking import uses one authoritative row RPC and preserves per-row errors', () => {
  const source = read('src/main/domains/misc.js')
  const importer = between(source, 'export async function bulkImportBookings', 'async function createImportedEntity')
  assert.match(importer, /state\.supabase\.rpc\('import_booking_row'/)
  assert.match(importer, /p_amount_paid: amountPaid/)
  assert.match(importer, /p_target_status: targetStatus \|\| 'confirmed'/)
  assert.match(importer, /const importBookingId = randomUUID\(\)/)
  assert.match(importer, /p_booking_id: importBookingId/)
  assert.match(importer, /importedResult/)
  assert.match(importer, /errors\.push\(/)
  assert.doesNotMatch(importer, /from\('bookings'\)\s*\.\s*update/)
  assert.doesNotMatch(importer, /updateBookingPayment/)
})

test('desktop multi-room booking is one online RPC or one offline group intent', () => {
  const source = read('src/main/domains/bookings.js')
  const group = between(source, 'export async function createMultiRoomBooking', 'export async function updateBooking')
  assert.match(group, /rpc\('create_multi_room_booking'/)
  assert.match(group, /queueOperation\('rpc', 'create_multi_room_booking'/)
  assert.match(group, /_local_booking_ids/)
  assert.match(group, /p_total_amount: data\.total_amount \?\? null/)
  assert.match(group, /tents/)
  assert.match(group, /vehicles/)
  assert.equal((group.match(/queueOperation\(/g) || []).length, 1, 'offline group must not emit child queue operations')
  assert.ok(group.indexOf("queueOperation('rpc', 'create_multi_room_booking'") < group.indexOf("writeCache('bookings'"), 'group intent must be durable before optimistic children are exposed')
  assert.doesNotMatch(group, /createBooking\(/)
})

test('offline booking money remains an explicitly labelled estimate', () => {
  const source = read('src/main/domains/bookings.js')
  assert.match(source, /_estimated_total_amount/)
  assert.match(source, /_estimated_amount_paid/)
  assert.match(source, /_estimated_payment_status/)
  assert.match(source, /getBookingFinancialView\(/)
  const pending = {
    total_amount: 0,
    amount_paid: 0,
    _estimated_total_amount: 120,
    _estimated_amount_paid: 20,
    _estimated_payment_status: 'partial',
    _financial_estimate: true
  }
  assert.equal(isPendingBookingFinancial(pending), true)
  assert.deepEqual(getBookingFinancialView(pending), {
    pending: true,
    authoritative: false,
    total: 120,
    charges: 0,
    grandTotal: 120,
    amountPaid: 20,
    outstanding: 100,
    paymentStatus: 'partial',
    statusLabel: 'Pending confirmation'
  })
  assert.equal(bookingPaymentStatusLabel(pending), 'Pending confirmation')
  assert.equal(getBookingFinancialView({ total_amount: 120, amount_paid: 20, payment_status: 'partial' }).authoritative, true)
})

test('update and reschedule pricing use server quote contracts and offline estimate fields', () => {
  const source = read('src/main/domains/bookings.js')
  const update = between(source, 'export async function updateBooking', 'export async function updateBookingStatus')
  const reschedule = between(source, 'export async function rescheduleBooking', 'async function getNextBookingInvoiceNumber')
  assert.match(update, /quote_room_stay/)
  assert.match(update, /accommodation_booking_expected_total/)
  assert.match(update, /update_campsite_booking/)
  assert.match(update, /Could not verify the booking quote/)
  assert.match(update, /_pricing_estimate: true/)
  assert.match(reschedule, /reschedule_accommodation_booking/)
  assert.match(reschedule, /_estimated_total_amount/)
  assert.match(reschedule, /estimated: true/)
})

test('public form persists a UUID key for retries and clears it only after success', () => {
  const source = read('booking-site/src/pages/BookingPage.jsx')
  assert.match(source, /BOOKING_IDEMPOTENCY_KEY/)
  assert.match(source, /readSessionState\(BOOKING_IDEMPOTENCY_KEY\)/)
  assert.match(source, /idempotency_key: idempotencyKey/)
  assert.match(source, /clearSessionState\(BOOKING_IDEMPOTENCY_KEY\)/)
  const submit = between(source, 'async function handleSubmit', '  // Focus heading on mount')
  assert.ok(submit.indexOf('clearSessionState(BOOKING_IDEMPOTENCY_KEY)') > submit.indexOf('if (rpcError || !data?.success)'))
})

test('PWA entitlement and queue persistence fail closed and verify durable writes', () => {
  const api = read('manager-pwa/src/lib/api.js')
  const access = read('manager-pwa/src/lib/access.js')
  const runtime = read('manager-pwa/src/lib/runtime.js')
  assert.match(api, /entitlement_unverified: true/)
  assert.match(api, /enqueueOfflineOperationVerified/)
  assert.match(access, /offline_valid_until/)
  assert.doesNotMatch(access, /cached_at.*DEFAULT_OFFLINE_LEASE_DAYS/)
  assert.match(runtime, /writeLocalJsonVerified/)
  assert.match(runtime, /readLocalJsonVerified\(key\)/)
})

test('group replay marks every local child on failure and maps server IDs on success', () => {
  const source = read('src/main/domains/infrastructure.js')
  const queueContract = read('src/shared/syncQueue.js')
  assert.match(source, /'create_multi_room_booking'/)
  assert.match(source, /_local_booking_ids/)
  assert.match(source, /function patchQueuedBookingSyncStates/)
  assert.match(source, /serverBookingIds/)
  assert.match(source, /sync-conflict/)
  assert.match(source, /booking-invoice-groups/)
  assert.match(queueContract, /'create_multi_room_booking'/)
  assert.match(queueContract, /'update_campsite_booking'/)
  assert.match(queueContract, /'reschedule_accommodation_booking'/)
})

test('explicit public keys never become fresh operations after cancellation', () => {
  const sql = read('supabase/migrations/20260904090000_verified_booking_contracts.sql')
  assert.match(sql, /v_client_key_provided boolean/)
  assert.match(sql, /if v_client_key_provided or not v_all_cancelled then/)
})

test('invoice max+1 lookup is hard-gated', () => {
  const source = read('src/main/domains/finance.js')
  assert.match(source, /allowUnsafeLookup = false/)
  assert.match(source, /lookup fallback is disabled/)
  const bookings = read('src/main/domains/bookings.js')
  assert.doesNotMatch(bookings, /getNextInvoiceNumberByLookup/)
})

test('multi-room group keys serialize across different operation keys', () => {
  const sql = read('supabase/migrations/20261005050000_luna_booking_public_group_envelopes.sql')
  const group = between(sql, 'create or replace function public.create_multi_room_booking(', '$$;')
  assert.match(group, /pg_advisory_xact_lock\(pg_catalog\.hashtextextended\('booking-group-key:'\|\|p_lodge_id::text\|\|':'\|\|v_group_key,0\)\)/)
  assert.match(group, /where i\.lodge_id=p_lodge_id and i\.group_key=v_group_key for update/)
  assert.match(group, /'code','idempotency_conflict'/)
})
test('multi-room booking wrapper has one closed legacy-history guard', () => {
  const sql = read('supabase/migrations/20261005050000_luna_booking_public_group_envelopes.sql')
  const group = between(sql, 'create or replace function public.create_multi_room_booking(', '$$;')
  const legacyChecks = group.match(/^\s*if exists\(select 1 from public\.booking_group_idempotency/gm) || []
  assert.equal(legacyChecks.length, 1, 'the historical ambiguity guard must be a single IF branch')
  assert.match(group, /if exists\(select 1 from public\.booking_group_idempotency[\s\S]*?then\s*return jsonb_build_object\([\s\S]*?end if;/)
})

test('booking intent diagnostics grant the desktop staff-session transport and still authorize in-body', () => {
  const sql = read('supabase/migrations/20261005020000_luna_booking_create_intent_envelope.sql')
  assert.match(sql, /revoke all on function public\.get_booking_create_intent_diagnostics\(uuid\) from public,\s*anon/i)
  assert.match(sql, /grant execute on function public\.get_booking_create_intent_diagnostics\(uuid\) to anon,authenticated,service_role/i)
  assert.match(sql, /create or replace function public\.get_booking_create_intent_diagnostics[\s\S]*?app_require_lodge_role/i)
})
test('public booking rejections roll back partial legacy group writes before saving the immutable result', () => {
  const sql = read('supabase/migrations/20261005050000_luna_booking_public_group_envelopes.sql')
  const online = between(sql, 'create or replace function public.create_online_booking(', '$$;')
  assert.match(online, /begin\s+v_result:=public\.create_online_booking_legacy[\s\S]*?if coalesce\(\(v_result->>'success'\)::boolean,false\) is not true then[\s\S]*?raise exception[\s\S]*?exception when sqlstate 'ZL001'[\s\S]*?end;/i,
    'a returned business rejection must roll back every partial write from the legacy multi-room function')
  assert.match(online, /v_expected_booking_count[\s\S]*?jsonb_array_length\(v_payload->'rooms'\)/i,
    'the immutable receipt count must be bound to the complete requested room list')
  assert.match(online, /full join unnest\(v_booking_ids\) with ordinality[\s\S]*?b\.room_id is distinct from/i,
    'each returned booking must map to its requested room at the same ordinal')
})
test('public multi-room success requires one complete invoice-group mapping', () => {
  const sql = read('supabase/migrations/20261005050000_luna_booking_public_group_envelopes.sql')
  const online = between(sql, 'create or replace function public.create_online_booking(', '$$;')
  assert.match(online, /coalesce\(jsonb_typeof\(v_result\),'null'\)<>'object'\s+then[\s\S]*?raise exception/i,
    'malformed legacy output cannot become a persisted rejection')
  assert.match(online, /v_expected_booking_count<1[\s\S]*?booking_rejected/i,
    'empty or underspecified room groups receive a persisted definitive rejection before success')
  assert.match(online, /select array_agg\(distinct l\.group_id\),count\(distinct l\.booking_id\)[\s\S]*?from public\.booking_invoice_group_lines[\s\S]*?join public\.booking_invoice_groups/i,
    'the receipt maps all created children to one lodge-scoped invoice group')
  assert.match(online, /v_group_line_count<>array_length\(v_booking_ids,1\)[\s\S]*?g\.invoice_number is not distinct from v_result->>'invoice_number'/i,
    'the receipt rejects incomplete groups and validates the returned group invoice number')
})
test('exclusive/event create_booking_record replay is bound to its original immutable request', () => {
  const migrationPath = 'supabase/migrations/20261005070000_luna_exclusive_booking_intent_envelope.sql'
  const sql = read(migrationPath)
  const wrapper = between(sql, 'create or replace function public.create_booking_record(payload jsonb)', '$$;')
  assert.ok(/alter function public\.create_booking_record\(jsonb\)\s+rename to create_booking_record_pre_intent_v1/i.test(sql), 'legacy entry point must be retained as a private helper')
  assert.ok(/app_require_lodge_role/i.test(wrapper), 'the anon transport must resolve to an authorized employee in the RPC body')
  assert.ok(/v_existing\.request_hash is distinct from v_hash/i.test(wrapper) && /v_existing\.original_request is distinct from v_request/i.test(wrapper), 'exact actor-bound original request must be compared on replay')
  assert.ok(/booking-create-key:/i.test(wrapper) && /booking-create-id:/i.test(wrapper), 'key and booking ID races must serialize across entry points')
  assert.ok(/when sqlstate 'PZ001'/i.test(wrapper), 'definitive rejections must roll back legacy partial writes before saving the result')
  assert.ok(/'room_id',case when v_exclusive then null else v_room_id end/i.test(wrapper), 'mutable representative room must not alter an event retry')
  assert.ok(/'invoice_number',case when v_exclusive then null else v_invoice_number end/i.test(wrapper), 'server invoice number must not alter an event retry')
  assert.ok(/'notes',case when v_exclusive then btrim\(regexp_replace/i.test(wrapper), 'derived event group and room-count labels must not alter an event retry')
  assert.ok(/'total_amount',v_total,'room_count'/i.test(wrapper), 'receipt must preserve authoritative event amount and room count')
  assert.ok(/revoke all on function public\.create_booking_record_pre_intent_v1\(jsonb\) from public,\s*anon,\s*authenticated/i.test(sql), 'clients must not bypass the envelope through the legacy function')
})

test('desktop staff-session RPC grants include the anon API-key transport and enforce identity in-body', () => {
  const authClients = read('src/main/domains/authClients.js')
  assert.ok(/createClient\(SUPABASE_URL, key,[\s\S]*x-boroko-session/.test(authClients), 'desktop session header is the identity bridge')
  const grants = [
    ['supabase/migrations/20261005010000_luna_hotel_folio_intent_contract.sql', /grant execute on function public\.hotel_folio_mutation_v1\(uuid,text,text,jsonb\) to anon,\s*authenticated,\s*service_role/i],
    ['supabase/migrations/20261005020000_luna_booking_create_intent_envelope.sql', /grant execute on function public\.create_booking\([\s\S]*?\)\s*to anon,\s*authenticated,\s*service_role/i],
    ['supabase/migrations/20261005030000_luna_financial_reconciliation_v1.sql', /grant execute on function public\.get_financial_reconciliation_v1\(uuid\) to anon,\s*authenticated,\s*service_role/i],
    ['supabase/migrations/20261005040000_luna_financial_validation_run_v2.sql', /grant execute on function public\.record_financial_validation_run_v2\([\s\S]*?\) to anon,\s*authenticated,\s*service_role/i],
    ['supabase/migrations/20261005050000_luna_booking_public_group_envelopes.sql', /grant execute on function public\.create_multi_room_booking\([\s\S]*?\) to anon,\s*authenticated,\s*service_role/i],
    ['supabase/migrations/20261005070000_luna_exclusive_booking_intent_envelope.sql', /grant execute on function public\.create_booking_record\(jsonb\) to anon,\s*authenticated,\s*service_role/i],
    ['supabase/migrations/20261005080000_luna_quotation_conversion_intent.sql', /grant execute on function public\.convert_quotation_to_booking\([\s\S]*?\)\s*to anon,\s*authenticated,\s*service_role/i],
    ['supabase/migrations/20261005090000_luna_multi_room_quotation_atomicity.sql', /grant execute on function public\.create_multi_room_booking\([\s\S]*?\) to anon,authenticated,service_role/i]
  ]
  for (const [file, contract] of grants) assert.ok(contract.test(read(file)), 'missing guarded desktop role grant in ' + file)
  const hotel = read('supabase/migrations/20261005010000_luna_hotel_folio_intent_contract.sql')
  assert.ok(/hotel_folio_mutation_v1[\s\S]*?app_current_user_id\(\)/i.test(hotel) && /app_require_lodge_role/i.test(hotel), 'anon transport role is not business authorization')
})

test('quotation conversion uses exact stable keys and converted status cannot short-circuit replay', () => {
  const sql = read('supabase/migrations/20261005080000_luna_quotation_conversion_intent.sql')
  const wrapper = between(sql, 'create or replace function public.convert_quotation_to_booking(', '$$;')
  assert.ok(/alter function public\.convert_quotation_to_booking\(uuid,uuid,numeric,text,uuid\)\s+rename to convert_quotation_to_booking_pre_intent_v1/i.test(sql), 'legacy conversion must be retained only as a private helper')
  assert.ok(/app_require_lodge_role/i.test(wrapper) && /quotation-conversion:/i.test(wrapper), 'conversion must be scoped and use a stable quotation key')
  assert.ok(/v_existing\.request_hash is distinct from v_hash/i.test(wrapper) && /v_existing\.original_request is distinct from v_request/i.test(wrapper), 'changed terms must conflict with the original immutable request')
  assert.ok(/booking_create_intents/i.test(wrapper) && /manual_review_required/i.test(wrapper), 'legacy converted rows without an envelope require manual review')
  const bookings = read('src/main/domains/bookings.js')
  assert.ok(/group_id:\s*'quotation-'\s*\+\s*quotation\.id/.test(bookings), 'multi-room quote group identity must be stable')
  assert.ok(/idempotency_key:\s*'quotation-conversion:'\s*\+\s*quotation\.id/.test(bookings), 'multi-room quote conversion key must be stable')
  assert.ok(!/if \(quotation\?\.status === 'converted'\)\s*\{\s*throw/.test(bookings), 'converted status alone must not block exact server replay')
  assert.doesNotMatch(bookings, /if \(!isExactOnlineReplay\)\s*\{\s*await updateQuotation/, 'multi-room quote conversion must not persist lifecycle separately from its group intent')
})

test('multi-room retries enter the server envelope before mutable checks and preserve offline child mapping', () => {
  const source = read('src/main/domains/bookings.js')
  const group = between(source, 'export async function createMultiRoomBooking', 'export async function updateBooking')
  assert.ok(group.indexOf("rpc('create_multi_room_booking'") < group.indexOf("await assertCreationWithinUsageLimit"), 'server must resolve exact replay before mutable usage or availability reads')
  assert.ok(/function buildAccommodationGroupId\(\{ lodgeId, customerId, checkIn, checkOut, rooms = \[\] \}\)/.test(source), 'ordinary group key must remain stable for the same core request after restart')
  assert.match(group, /const samePayload = JSON\.stringify\(priorGroupIntent\.data\) === JSON\.stringify\(rpcPayload\)/, 'offline retry compares the complete saved payload')
  assert.match(group, /!samePayload && !compatibleLegacyQuotationPayload/, 'only the explicit old quotation envelope may omit the newly added total field')
  assert.ok(/_local_booking_ids/.test(group) && /pendingBookings\.length !== localIds\.length/.test(group), 'offline replay must preserve the complete local-to-server child mapping')
})
test('deep health RPC checks never execute financial or inventory mutations against an operator database', () => {
  const health = read('src/main/domains/health.js')
  const probeBlock = between(health, '// Mutative probes cannot safely use an installed operator database.', 'finance.contract = {')
  assert.ok(!/state\.supabase\.rpc|probeRpc\(/.test(probeBlock), 'deep health checks must not send mutation probes; RPC business errors may now be durably recorded intents')
  assert.ok(/skipped: true/.test(probeBlock) && /Not invoked against an installed operator database/.test(probeBlock), 'deep health must report mutation probes as skipped, not successful')
  assert.ok(/state\.supabase\.rpc\('get_booking_payments'/.test(health), 'existing read-only payment-ledger availability check remains active')
})

test('multi-room quotation conversion binds quote lifecycle and group receipt atomically', () => {
  const sql = read('supabase/migrations/20261005090000_luna_multi_room_quotation_atomicity.sql')
  const group = between(sql, 'create or replace function public.create_multi_room_booking(', '$$;')
  assert.match(group, /v_quotation_id[\s\S]*?for update/i, 'quote row must be locked when a quotation group starts')
  assert.match(group, /v_existing\.booking_ids[\s\S]*?manual_review_required/i, 'exact replay must reject an incomplete saved child receipt before repairing quote state')
  assert.match(group, /p_total_amount is not null[\s\S]*?v_quotation\.subtotal/i, 'a quote-backed group must stay bound to the accepted subtotal')
  assert.match(group, /quotation_tax_review_required/i, 'tax-inclusive quotations must not silently lose tax in group creation')
  assert.match(group, /STAY_GROUP:[\s\S]*?STAY_ROOMS:/i, 'quote comparison strips only the group metadata added by the client')
  const quoteUpdateAt = sql.indexOf('p_expected_updated_at timestamptz')
  const quoteUpdateStart = sql.lastIndexOf('create or replace function public.update_quotation(', quoteUpdateAt)
  const quoteUpdate = between(sql.slice(quoteUpdateStart), 'create or replace function public.update_quotation(', '$$;')
  const quoteUpdate3Start = sql.indexOf('create or replace function public.update_quotation(', quoteUpdateStart + 1)
  const quoteUpdate4Grant = sql.indexOf('revoke all on function public.update_quotation(uuid,uuid,jsonb,timestamptz)')
  const quoteUpdate3Grant = sql.indexOf('revoke all on function public.update_quotation(uuid,uuid,jsonb)')
  assert.ok(quoteUpdate4Grant > quoteUpdateStart && quoteUpdate3Grant > quoteUpdate3Start, 'privileges may only be changed after both renamed update_quotation overloads are recreated')
  assert.match(quoteUpdate, /quotation_conversion_owned_by_booking_intent/i, 'legacy status updates cannot overwrite the server-owned conversion link')
  assert.ok(quoteUpdate.indexOf("if v_quote.status='converted' then") >= 0 && quoteUpdate.indexOf('return public.update_quotation_pre_conversion_guard_v1') > quoteUpdate.indexOf("if v_quote.status='converted' then"), 'converted quotations must reject all field updates before the legacy helper can mutate financial history')
  assert.match(sql, /grant execute on function public\.update_quotation\(uuid,uuid,jsonb,timestamptz\) to anon,authenticated,service_role/i)
  assert.ok(group.includes("~ '^quotation-[0-9a-f]{8}-"), 'the group wrapper must recognize the reserved quotation group key')
  assert.match(group, /manual_review_required[\s\S]*?converted/i, 'converted legacy quotes without an exact group intent must fail closed')
  assert.match(group, /update public\.quotations[\s\S]*?set status='converted'[\s\S]*?converted_booking_id/i, 'quote status and group booking must commit together')
  const bookings = read('src/main/domains/bookings.js')
  const convert = between(bookings, 'const convertMultiRoomQuotation = async (quotation) => {', '  if (!state.isOnline) {')
  assert.doesNotMatch(convert, /await updateQuotation\(/, 'multi-room quote conversion must not queue a separate status mutation')
  assert.match(convert, /total_amount: quotation\.subtotal/, 'the group request carries the accepted quotation subtotal')
  assert.match(convert, /result\.quotation_id !== quotation\.id/, 'online success requires server confirmation of the quote link')
  assert.match(convert, /patchCachedQuotationSyncState\(/, 'offline UI projects conversion locally while retaining one group operation')
  assert.match(bookings, /refreshCache\('bookings', 'booking-invoice-groups', 'booking-invoice-group-lines', 'quotations'\)/, 'online group receipt refreshes the atomically updated quotation')
  const replay = read('src/main/domains/infrastructure.js')
  assert.match(replay, /'create_multi_room_booking'\]\.includes\(item\.table\)\) shouldRefreshQuotations = true/, 'offline group replay refreshes the server-owned quote state')
})