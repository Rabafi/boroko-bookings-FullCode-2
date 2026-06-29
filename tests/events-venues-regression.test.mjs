import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

async function run() {
  const migration = await read('supabase/migrations/20260620180000_events_venues_foundation.sql')
  const conference = await read('src/main/domains/conference.js')
  const bookings = await read('src/main/domains/bookings.js')
  const conferenceUi = await read('src/renderer/src/components/Conference.jsx')
  const eventQuotationMigration = await read('supabase/migrations/20260618180000_event_lodge_quotations.sql')
  const financialIntegritySql = await read('supabase/migrations/20260618130000_financial_mutation_idempotency_and_booking_audit.sql')
  const posEventMigration = await read('supabase/migrations/20260620200000_pos_event_folio_support.sql')
  const eventParentIdRepair = await read('supabase/migrations/20260626120000_harden_event_booking_parent_id.sql')
  const eventIdempotencyMissRepair = await read('supabase/migrations/20260626123000_fix_event_booking_id_after_idempotency_miss.sql')
  const database = await read('src/main/database.js')
  const legacyPayloads = await read('legacy-pos/src/shared/payloads.js')
  const legacyTerminal = await read('legacy-pos/src/renderer/src/screens/POSTerminal.jsx')
  const legacyPreload = await read('legacy-pos/src/preload/index.js')
  const legacyMain = await read('legacy-pos/src/main/index.js')

  // ═══ MIGRATION: conference_bookings generalization ═══
  assert.match(migration, /ADD COLUMN IF NOT EXISTS customer_id uuid/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS event_name text/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS event_type text/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS reservation_scope text/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS status text/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS adults integer/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS children integer/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS subtotal numeric/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS extras_total numeric/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS charges_total numeric/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS amount_paid numeric/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS balance_due numeric/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS currency text/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS exclusive_booking_id uuid/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS create_idempotency_key text/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS created_by uuid/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS updated_at timestamptz/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS cancelled_at timestamptz/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS cancellation_reason text/)

  // Constraints
  assert.match(migration, /conference_bookings_event_type_chk/)
  assert.match(migration, /conference_bookings_reservation_scope_chk/)
  assert.match(migration, /conference_bookings_status_chk/)
  assert.match(migration, /conference_bookings_non_negative_financials_chk/)

  // Backfill
  assert.match(migration, /event_name = COALESCE/)
  assert.match(migration, /event_type = 'conference'/)
  assert.match(migration, /reservation_scope = 'venue_only'/)
  assert.match(migration, /amount_paid = COALESCE\(deposit_paid/)

  // ═══ MIGRATION: event_booking_resources ═══
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.event_booking_resources/)
  assert.match(migration, /resource_key text NOT NULL/)
  assert.match(migration, /resource_name_snapshot text NOT NULL/)
  assert.match(migration, /start_at timestamptz NOT NULL/)
  assert.match(migration, /end_at timestamptz NOT NULL/)
  assert.match(migration, /exclusive_use boolean/)
  assert.match(migration, /unit_price_snapshot numeric/)
  assert.match(migration, /event_resource_time_check/)

  // ═══ MIGRATION: event_booking_line_items ═══
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.event_booking_line_items/)
  assert.match(migration, /line_type text NOT NULL/)
  assert.match(migration, /description text NOT NULL/)
  assert.match(migration, /quantity numeric NOT NULL/)
  assert.match(migration, /unit_price numeric NOT NULL/)
  assert.match(migration, /subtotal numeric NOT NULL/)
  assert.match(migration, /inventory_item_id uuid/)
  assert.match(migration, /depletion_quantity numeric/)
  assert.match(migration, /voided_at timestamptz/)
  assert.match(migration, /void_reason text/)
  assert.match(migration, /event_line_item_type_check/)
  assert.match(migration, /event_line_item_quantity_check/)
  assert.match(migration, /event_line_item_non_negative/)

  // ═══ MIGRATION: event_booking_rooms ═══
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.event_booking_rooms/)
  assert.match(migration, /booking_id uuid NOT NULL REFERENCES public\.bookings/)
  assert.match(migration, /room_id uuid NOT NULL REFERENCES public\.rooms/)
  assert.match(migration, /relationship_type text/)
  assert.match(migration, /event_room_relationship_check/)
  assert.match(migration, /event_booking_rooms_event_booking_uidx/)
  assert.match(migration, /event_booking_rooms_booking_uidx/)

  // ═══ MIGRATION: POS event linkage ═══
  assert.match(migration, /ADD COLUMN IF NOT EXISTS event_booking_id uuid/)
  assert.match(migration, /REFERENCES public\.conference_bookings/)
  assert.match(migration, /pos_orders_event_booking_idx/)

  // ═══ MIGRATION: financial audit log extension ═══
  assert.match(migration, /ADD COLUMN IF NOT EXISTS event_booking_id uuid/)
  assert.match(migration, /financial_audit_log_event_idx/)
  assert.match(migration, /event_created/)
  assert.match(migration, /event_updated/)
  assert.match(migration, /event_cancelled/)
  assert.match(migration, /event_line_item_added/)
  assert.match(migration, /event_line_item_voided/)
  assert.match(migration, /event_room_linked/)
  assert.match(migration, /event_room_unlinked/)
  assert.match(migration, /event_payment_recorded/)
  assert.match(migration, /event_pos_charge_added/)
  assert.match(migration, /event_pos_charge_reversed/)

  // ═══ MIGRATION: RPCs exist ═══
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.create_event_booking\(payload jsonb\)/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.update_event_booking\(/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.add_event_line_item\(payload jsonb\)/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.void_event_line_item\(/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.update_event_payment\(/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.cancel_event_booking\(/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.recalculate_event_totals\(p_event_id uuid\)/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.check_event_resource_conflict\(/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_event_booking_details\(/)

  // ═══ MIGRATION: create_event_booking safety properties ═══
  assert.match(migration, /app_reject_pwa_financial_mutation/)
  assert.match(migration, /app_require_lodge_role/)

  // Idempotency
  assert.match(migration, /create_idempotency_key = v_idempotency_key/)
  assert.match(migration, /idempotent.*true/)

  // Advisory lock
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /booking-overlap/)

  // No fake room bookings for venue_only
  assert.match(migration, /v_reservation_scope = 'exclusive_lodge'/)
  assert.match(migration, /v_reservation_scope = 'venue_with_rooms'/)
  assert.doesNotMatch(migration, /venue_only[\s\S]{0,500}INSERT INTO public\.bookings/)

  // Exclusive lodge creates one authoritative booking
  assert.match(migration, /is_exclusive_event/)
  assert.match(migration, /event_daily_rate/)
  assert.match(migration, /exclusive_booking_id/)

  // Deposit through payment ledger
  assert.match(migration, /INSERT INTO public\.payments/)
  assert.match(migration, /conference_booking_id = p_event_id/)

  // Server-authoritative totals
  assert.match(migration, /recalculate_event_totals/)
  assert.match(migration, /total_amount = v_total/)
  assert.match(migration, /line_type <> 'pos'/)
  assert.match(migration, /line_type = 'pos'/)
  assert.doesNotMatch(migration, /FROM public\.pos_orders[\s\S]{0,180}INTO v_charges_total/)
  assert.doesNotMatch(migration, /CREATE EVENT[\s\S]{0,200}payment_status.*=.*payload/)

  // Parent must be inserted before room links reference it.
  assert.ok(
    migration.indexOf('INSERT INTO public.conference_bookings') <
      migration.indexOf('INSERT INTO public.event_booking_rooms'),
    'event parent must be inserted before event room links'
  )
  assert.match(eventParentIdRepair, /alter column id set default gen_random_uuid\(\)/i)
  assert.match(eventParentIdRepair, /v_event_id uuid := coalesce\(nullif\(payload->>''id''/)
  assert.match(eventParentIdRepair, /begin\\n  v_event_id := coalesce\(v_event_id/)
  assert.match(eventParentIdRepair, /create_event_booking still does not guarantee a generated event ID/)
  assert.match(eventIdempotencyMissRepair, /SELECT \.\.\. INTO clears target variables when no row is found/)
  assert.match(eventIdempotencyMissRepair, /v_event_id := coalesce\(v_event_id, nullif\(payload->>''id'', ''''\)::uuid, gen_random_uuid\(\)\)/)
  assert.match(eventIdempotencyMissRepair, /create_event_booking still clears v_event_id after idempotency lookup miss/)

  // ═══ MIGRATION: update_event_booking safety ═══
  assert.match(migration, /p_expected_updated_at/)
  assert.match(migration, /v_record\.updated_at IS DISTINCT FROM p_expected_updated_at/)

  // ═══ MIGRATION: add_event_line_item safety ═══
  assert.match(migration, /v_subtotal := round\(v_quantity \* v_unit_price/)
  assert.match(migration, /current_stock = current_stock - v_depletion_quantity/)
  assert.match(migration, /v_stock < v_depletion_quantity/)

  // ═══ MIGRATION: void restores inventory once ═══
  assert.match(migration, /current_stock = current_stock \+ v_line\.depletion_quantity/)
  assert.match(migration, /voided_at = now\(\)/)
  assert.match(migration, /void_reason = p_reason/)
  assert.doesNotMatch(migration, /void_event_line_item[\s\S]{0,300}DELETE FROM/)

  // ═══ MIGRATION: payment RPC safety ═══
  assert.match(migration, /conference_booking_id = p_event_id/)
  assert.match(migration, /idempotency_key = p_idempotency_key/)
  assert.match(migration, /recalculate_event_totals\(p_event_id\)/)
  assert.match(migration, /WHEN lower\(coalesce\(type, ''\)\) = 'refund' THEN -abs\(amount\)/)
  assert.match(migration, /CASE WHEN lower\(p_type\) = 'refund' THEN -abs\(p_amount\)/)

  // ═══ MIGRATION: cancel event safety ═══
  assert.match(migration, /p_reason text/)
  assert.match(migration, /p_cancel_linked_rooms/)
  assert.match(migration, /status = 'cancelled'/)
  assert.match(migration, /cancelled_at = now\(\)/)
  assert.match(migration, /cancellation_reason = p_reason/)

  // ═══ MIGRATION: idempotency index ═══
  assert.match(migration, /conference_bookings_lodge_idempotency_uidx/)
  assert.match(migration, /WHERE create_idempotency_key IS NOT NULL/)

  // ═══ MIGRATION: exclusive booking uniqueness ═══
  assert.match(migration, /conference_bookings_exclusive_booking_uidx/)
  assert.match(migration, /WHERE exclusive_booking_id IS NOT NULL/)

  // ═══ MIGRATION: RLS enabled on new tables ═══
  assert.match(migration, /ALTER TABLE public\.event_booking_resources ENABLE ROW LEVEL SECURITY/)
  assert.match(migration, /ALTER TABLE public\.event_booking_line_items ENABLE ROW LEVEL SECURITY/)
  assert.match(migration, /ALTER TABLE public\.event_booking_rooms ENABLE ROW LEVEL SECURITY/)

  // ═══ MIGRATION: grants ═══
  assert.match(migration, /GRANT.*ON public\.event_booking_resources.*TO service_role/)
  assert.match(migration, /GRANT.*ON public\.event_booking_line_items.*TO service_role/)
  assert.match(migration, /GRANT.*ON public\.event_booking_rooms.*TO service_role/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.create_event_booking/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.update_event_booking/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.add_event_line_item/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.void_event_line_item/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.update_event_payment/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.cancel_event_booking/)

  // ═══ COMPATIBILITY: existing conference RPCs not removed ═══
  assert.match(migration, /Old conference RPCs are kept as-is/)

  // ═══ DESKTOP: events.js domain layer exists ═══
  const eventsDomain = await read('src/main/domains/events.js')
  assert.match(eventsDomain, /export function getEventBookings/)
  assert.match(eventsDomain, /export async function getEventBookingById/)
  assert.match(eventsDomain, /export async function getEventBookingDetails/)
  assert.match(eventsDomain, /export async function createEventBooking/)
  assert.match(eventsDomain, /export async function updateEventBooking/)
  assert.match(eventsDomain, /export async function cancelEventBooking/)
  assert.match(eventsDomain, /export async function addEventLineItem/)
  assert.match(eventsDomain, /export async function voidEventLineItem/)
  assert.match(eventsDomain, /export async function updateEventPayment/)
  assert.match(eventsDomain, /export async function checkEventResourceAvailability/)
  assert.match(eventsDomain, /VALID_EVENT_TYPES/)
  assert.match(eventsDomain, /VALID_SCOPES/)
  assert.match(eventsDomain, /VALID_EVENT_STATUSES/)
  // events.js uses RPC for all mutations
  assert.match(eventsDomain, /rpc\('create_event_booking'/)
  assert.match(eventsDomain, /rpc\('update_event_booking'/)
  assert.match(eventsDomain, /rpc\('cancel_event_booking'/)
  assert.match(eventsDomain, /rpc\('add_event_line_item'/)
  assert.match(eventsDomain, /rpc\('void_event_line_item'/)
  assert.match(eventsDomain, /rpc\('update_event_payment'/)
  assert.match(eventsDomain, /rpc\('get_event_booking_details'/)
  assert.match(eventsDomain, /rpc\('check_event_resource_conflict'/)
  // events.js uses offline queue for mutations
  assert.match(eventsDomain, /queueOperation\('rpc', 'create_event_booking'/)
  assert.match(eventsDomain, /queueOperation\('rpc', 'update_event_booking'/)
  assert.match(eventsDomain, /queueOperation\('rpc', 'cancel_event_booking'/)
  assert.match(eventsDomain, /queueOperation\('rpc', 'update_event_payment'/)
  // events.js idempotency keys
  assert.match(eventsDomain, /idempotency_key/)
  assert.match(eventsDomain, /intentKey/)

  // ═══ PRELOAD: events API exposed ═══
  const preload = await read('src/preload/index.js')
  assert.match(preload, /events: \{/)
  assert.match(preload, /getAll: \(start, end\) => ipcRenderer\.invoke\('events:getAll'/)
  assert.match(preload, /getById: \(id\) => ipcRenderer\.invoke\('events:getById'/)
  assert.match(preload, /getDetails: \(id\) => ipcRenderer\.invoke\('events:getDetails'/)
  assert.match(preload, /create: \(data\) => ipcRenderer\.invoke\('events:create'/)
  assert.match(preload, /update: \(id, data\) => ipcRenderer\.invoke\('events:update'/)
  assert.match(preload, /cancel: \(id, reason, cancelLinkedRooms\) => ipcRenderer\.invoke\('events:cancel'/)
  assert.match(preload, /addLineItem: \(data\) => ipcRenderer\.invoke\('events:addLineItem'/)
  assert.match(preload, /voidLineItem: \(lineItemId, reason\) => ipcRenderer\.invoke\('events:voidLineItem'/)
  assert.match(preload, /updatePayment: \(id, amount, method, type, intentKey\) => ipcRenderer\.invoke\('events:updatePayment'/)
  assert.match(preload, /checkAvailability: \(resourceKey, startAt, endAt, excludeEventId\) => ipcRenderer\.invoke\('events:checkAvailability'/)

  // ═══ IPC: event handlers registered ═══
  const mainIndex = await read('src/main/index.js')
  assert.match(mainIndex, /ipcMain\.handle\('events:getAll'/)
  assert.match(mainIndex, /ipcMain\.handle\('events:getById'/)
  assert.match(mainIndex, /ipcMain\.handle\('events:getDetails'/)
  assert.match(mainIndex, /ipcMain\.handle\('events:create'/)
  assert.match(mainIndex, /ipcMain\.handle\('events:update'/)
  assert.match(mainIndex, /ipcMain\.handle\('events:cancel'/)
  assert.match(mainIndex, /ipcMain\.handle\('events:addLineItem'/)
  assert.match(mainIndex, /ipcMain\.handle\('events:voidLineItem'/)
  assert.match(mainIndex, /ipcMain\.handle\('events:updatePayment'/)
  assert.match(mainIndex, /ipcMain\.handle\('events:checkAvailability'/)
  // Event handlers require capabilities
  assert.match(mainIndex, /events:create[\s\S]{0,200}requireCapability\('conference\.manage'\)/)
  assert.match(mainIndex, /events:update[\s\S]{0,200}requireCapability\('conference\.manage'\)/)
  assert.match(mainIndex, /events:updatePayment[\s\S]{0,200}requireCapability\('payments\.record'\)/)
  assert.match(database, /createEventBooking as createEventVenueBooking/)
  assert.match(mainIndex, /events:create[\s\S]{0,200}db\.createEventVenueBooking/)

  // POS event folio uses the one-argument totals function and voids line
  // items instead of writing forbidden negative quantities/prices.
  assert.doesNotMatch(posEventMigration, /recalculate_event_totals\([^,\n]+,\s*[^)\n]+\)/)
  assert.match(posEventMigration, /voided_at = now\(\)/)
  assert.doesNotMatch(posEventMigration, /quantity = -quantity/)
  assert.doesNotMatch(posEventMigration, /unit_price = -unit_price/)

  // Legacy POS supports an explicit event folio target end to end.
  assert.match(legacyPayloads, /event_booking_id: input\.event_booking_id \|\| null/)
  assert.match(legacyPayloads, /event_booking_id: legacy\.event_booking_id/)
  assert.match(legacyPreload, /getEvents: \(\) => ipcRenderer\.invoke\('pos:get-events'\)/)
  assert.match(legacyMain, /ipcMain\.handle\('pos:get-events'/)
  assert.match(legacyTerminal, /<option value="event">Event Folio<\/option>/)
  assert.match(legacyTerminal, /event_booking_id: customerType === 'event' \? selectedEventId : null/)

  // ═══ NAVIGATION: renamed to Events & Venues ═══
  const desktopNav = await read('src/renderer/src/navigation/desktopNav.js')
  assert.match(desktopNav, /label: 'Events & Venues'/)

  // ═══ CONFERENCE.JSX: uses events API ═══
  assert.match(conferenceUi, /window\.api\.events\.getAll/)
  assert.match(conferenceUi, /window\.api\.events\.create/)
  assert.match(conferenceUi, /window\.api\.events\.update/)
  assert.match(conferenceUi, /window\.api\.events\.cancel/)
  assert.match(conferenceUi, /window\.api\.events\.updatePayment/)
  assert.match(conferenceUi, /EVENT_TYPES/)
  assert.match(conferenceUi, /RESERVATION_SCOPES/)
  assert.match(conferenceUi, /event_type/)
  assert.match(conferenceUi, /reservation_scope/)
  assert.match(conferenceUi, /event_name/)
  assert.match(conferenceUi, /window\.api\.events\.getDetails/)
  assert.match(conferenceUi, /window\.api\.events\.addLineItem/)
  assert.match(conferenceUi, /window\.api\.events\.voidLineItem/)
  assert.match(conferenceUi, /Event folio extras/)
  assert.match(conferenceUi, /Reserved venues/)
  assert.match(conferenceUi, /Guest rooms/)
  assert.match(conferenceUi, /Events & Venues/)

  // ═══ EXISTING: guard_exclusive_event_overlap preserved ═══
  assert.match(eventQuotationMigration, /guard_exclusive_event_overlap/)
  assert.match(eventQuotationMigration, /pg_advisory_xact_lock/)

  // ═══ EXISTING: financial_operation_idempotency preserved ═══
  assert.match(financialIntegritySql, /financial_operation_idempotency/)

  // ═══ DESKTOP: conference.js still has required functions ═══
  assert.match(conference, /export async function getConferenceBookings/)
  assert.match(conference, /export async function createConferenceBooking/)
  assert.match(conference, /export async function updateConferenceBooking/)
  assert.match(conference, /export async function updateConferenceBookingPayment/)
  assert.match(conference, /export async function deleteConferenceBooking/)
  assert.match(conference, /queueOperation\('rpc', 'create_conference_booking'/)
  assert.match(conference, /queueOperation\('rpc', 'update_conference_booking'/)
  assert.match(conference, /queueOperation\('rpc', 'delete_conference_booking'/)

  // ═══ DESKTOP: bookings.js exclusive event overlap preserved ═══
  assert.match(bookings, /checkExclusiveEventConflict/)
  assert.match(bookings, /is_exclusive_event/)
  assert.match(bookings, /fully reserved for an exclusive event/)

  // ═══ UI: Conference.jsx still loads and works ═══
  assert.match(conferenceUi, /window\.api\.events\.getAll/)
  assert.match(conferenceUi, /window\.api\.events\.create/)
  assert.match(conferenceUi, /window\.api\.events\.update/)
  assert.match(conferenceUi, /window\.api\.events\.cancel/)
  assert.match(conferenceUi, /window\.api\.events\.updatePayment/)
  assert.match(conferenceUi, /window\.api\.conference\.getAll/)
  assert.match(conferenceUi, /window\.api\.conference\.create/)
  assert.match(conferenceUi, /window\.api\.conference\.update/)
  assert.match(conferenceUi, /window\.api\.conference\.delete/)

  console.log('events-venues-regression: ok')
}

run().catch((error) => {
  console.error('events-venues-regression: failed')
  console.error(error?.stack || error)
  process.exitCode = 1
})
