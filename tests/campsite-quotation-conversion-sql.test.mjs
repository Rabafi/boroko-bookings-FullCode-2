// Campsite quotation conversion carry: SQL contract on the disposable database.
// Applies supabase/migrations/20261014030000_campsite_quotation_conversion_carry.sql
// on top of the fully-migrated disposable schema and exercises end to end:
// - single-line campsite quotation converts with carried tents/vehicles,
//   accommodation_kind and a details row, with the quoted total verified;
// - quoted-total mismatch fails closed with a re-quote repair path;
// - room single-line conversion keeps legacy behavior (zeros, no kind);
// - multi-line campsite quotation with nonzero tents/vehicles converts
//   through the group contract (previously rejected with
//   quotation_group_mismatch);
// - exact replay of a converted quotation returns the recorded booking.
// Skips cleanly (exit 0) when LUNA_REMEDIATION_* disposable credentials are
// absent. Never touches production: the luna helper denies the linked project.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  connectVerifiedDisposableDatabase,
  DisposableDatabaseBlocked
} from './helpers/luna-disposable-database.mjs'

let connected = null
let blocked = null
try {
  connected = await connectVerifiedDisposableDatabase()
} catch (error) {
  if (error instanceof DisposableDatabaseBlocked) blocked = error
  else throw error
}

if (blocked || !connected) {
  test('campsite quotation conversion SQL contract (no disposable database)', {
    skip: 'LUNA_REMEDIATION_TEST_DB_URL absent: ' + (blocked?.message || 'no disposable database connection')
  }, () => {})
} else {
  const db = connected.client

  const lodge = randomUUID()
  const userId = randomUUID()
  const customerId = randomUUID()
  const siteId = randomUUID()
  const roomId = randomUUID()
  const token = 'cq-admin-' + randomUUID()

  const call = async (text, params = []) => (await db.query(`select ${text} as result`, params)).rows[0].result

  async function asSession() {
    await db.query('begin')
    await db.query('set local role anon')
    await db.query("select set_config('request.jwt.claim.role','anon',true),set_config('app.session_token',$1,true)", [token])
  }
  async function endSession() {
    await db.query('rollback').catch(() => {})
  }

  // Acceptance requires the deployed feature chain and never applies its
  // one-time source rewrite. This keeps reruns from restoring stale function
  // bodies over later receipt/intention wrappers.
  const conversionDefinition = (await db.query(
    "select pg_get_functiondef('public.convert_quotation_to_booking_pre_intent_v1(uuid,uuid,numeric,text,uuid)'::regprocedure) as definition"
  )).rows[0].definition
  const groupDefinition = (await db.query(
    "select pg_get_functiondef('public.create_multi_room_booking(uuid,uuid,date,date,jsonb,numeric,numeric,text,text,uuid,text,text)'::regprocedure) as definition"
  )).rows[0].definition
  assert.ok(conversionDefinition.includes('v_single_line'), 'current single-line campsite conversion body is installed')
  assert.ok(conversionDefinition.includes('accommodation_booking_expected_total'), 'single-line conversion checks the server quote')
  assert.ok(groupDefinition.includes('x.value->>\'tents\''), 'current multi-room wrapper carries quoted tent occupancy')
  assert.ok(groupDefinition.includes('x.value->>\'vehicles\''), 'current multi-room wrapper carries quoted vehicle occupancy')

  const baseDate = String((await db.query('select current_date as today')).rows[0].today).slice(0, 10)
  const day = (offset) => {
    const date = new Date(`${baseDate}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + offset)
    return date.toISOString().slice(0, 10)
  }
  await db.query(
    `insert into public.users(id, lodge_id, name, email, role, password_hash, status)
     values ($1, $2, 'cq-manager', $3, 'manager', 'not-a-login-hash', 'active')`,
    [userId, lodge, `${userId}@example.invalid`]
  )
  await db.query(
    `insert into public.app_sessions(token_hash, session_type, user_id, lodge_id, role, expires_at)
     values (public.app_hash_token($1), 'desktop', $2::uuid, $3::uuid, 'manager', now() + interval '20 minutes')`,
    [token, userId, lodge]
  )
  await db.query(`insert into public.customers(id, lodge_id, name) values ($1, $2, 'Conversion Guest')`, [customerId, lodge])
  // Per-site nightly rate 150; 2 nights x 300 + nothing else = 300 for
  // (2 adults, 1 child, 2 tents, 1 vehicle) under rate_mode='site'.
  await db.query(
    `insert into public.rooms(id, lodge_id, room_number, room_type, rate_per_night, max_occupancy, status,
       accommodation_kind, rate_mode, rate_per_person, rate_per_tent, rate_per_vehicle,
       capacity_adults, capacity_children, max_tents, max_vehicles)
     values ($1, $2, 'A1', 'campsite', 150, 6, 'available',
       'campsite', 'site', 75, 50, 30, 4, 4, 3, 2)`,
    [siteId, lodge]
  )
  await db.query(
    `insert into public.rooms(id, lodge_id, room_number, room_type, rate_per_night, max_occupancy, status)
     values ($1, $2, '101', 'standard', 500, 2, 'available')`,
    [roomId, lodge]
  )

  async function makeQuotation({ id, room, lines, adults, children, subtotal, total }) {
    await db.query(
      `insert into public.quotations(id, quotation_number, lodge_id, customer_id, customer_name,
         room_id, room_name, check_in, check_out, adults, children,
         accommodation_lines, subtotal, tax_amount, total_amount, status)
       values ($1, $2, $3, $4, 'Conversion Guest',
         $5, 'line', current_date + 30, current_date + 32, $6, $7,
         $8::jsonb, $9, 0, $10, 'accepted')`,
      [id, 'Q-' + id.slice(0, 8), lodge, customerId, room, adults, children, JSON.stringify(lines), subtotal, total]
    )
  }

  after(async () => {
    await db.query('delete from public.booking_create_intents where lodge_id = $1', [lodge]).catch(() => {})
    await db.query('delete from public.booking_group_create_intents where lodge_id = $1', [lodge]).catch(() => {})
    await db.query('delete from public.booking_accommodation_details where lodge_id = $1', [lodge]).catch(() => {})
    await db.query('delete from public.invoices where lodge_id = $1', [lodge]).catch(() => {})
    await db.query('delete from public.bookings where lodge_id = $1', [lodge]).catch(() => {})
    await db.query('delete from public.quotations where lodge_id = $1', [lodge]).catch(() => {})
    await db.query('delete from public.rooms where lodge_id = $1', [lodge]).catch(() => {})
    await db.query('delete from public.customers where id = $1', [customerId]).catch(() => {})
    await db.query('delete from public.app_sessions where lodge_id = $1', [lodge]).catch(() => {})
    await db.query('delete from public.users where id = $1', [userId]).catch(() => {})
    await db.end().catch(() => {})
  })

  test('single-line campsite quotation converts with carried occupancy and details', async () => {
    const qid = randomUUID()
    await makeQuotation({
      id: qid,
      room: siteId,
      lines: [{ room_id: siteId, room_name: 'Site A1', adults: 2, children: 1, tents: 2, vehicles: 1, amount: 300 }],
      adults: 2,
      children: 1,
      subtotal: 300,
      total: 300
    })
    await asSession()
    try {
      const converted = await call(
        'public.convert_quotation_to_booking($1, $2, 0, $3, null)',
        [qid, lodge, 'cash']
      )
      assert.equal(converted.success, true)
      const bookingId = converted.booking_id
      assert.ok(bookingId)
      const row = (await db.query(
        `select tents_count, vehicles_count, accommodation_kind, adults, children, total_amount, quotation_id
           from public.bookings where id = $1 and lodge_id = $2`, [bookingId, lodge]
      )).rows[0]
      assert.equal(row.tents_count, 2)
      assert.equal(row.vehicles_count, 1)
      assert.equal(row.accommodation_kind, 'campsite')
      assert.equal(row.adults, 2)
      assert.equal(row.children, 1)
      assert.equal(Number(row.total_amount), 300)
      assert.equal(row.quotation_id, qid)
      const details = (await db.query(
        `select tents, vehicles, accommodation_kind, rate_mode from public.booking_accommodation_details
          where booking_id = $1 and lodge_id = $2`, [bookingId, lodge]
      )).rows[0]
      assert.equal(details.tents, 2)
      assert.equal(details.vehicles, 1)
      assert.equal(details.accommodation_kind, 'campsite')
      assert.equal(details.rate_mode, 'site')
      const quote = (await db.query(
        `select status, converted_booking_id from public.quotations where id = $1`, [qid]
      )).rows[0]
      assert.equal(quote.status, 'converted')
      assert.equal(quote.converted_booking_id, bookingId)

      // Exact replay returns the recorded booking without duplicating.
      const replayed = await call('public.convert_quotation_to_booking($1, $2, 0, $3, null)', [qid, lodge, 'cash'])
      assert.equal(replayed.success, true)
      assert.equal(replayed.booking_id, bookingId)
      const bookingCount = Number((await db.query(
        `select count(*)::integer as c from public.bookings where lodge_id = $1 and quotation_id = $2`, [lodge, qid]
      )).rows[0].c)
      assert.equal(bookingCount, 1)
    } finally {
      await endSession()
    }
  })

  test('quoted-total mismatch fails closed with a re-quote repair path', async () => {
    const qid = randomUUID()
    await makeQuotation({
      id: qid,
      room: siteId,
      lines: [{ room_id: siteId, room_name: 'Site A1', adults: 2, children: 1, tents: 2, vehicles: 1, amount: 999 }],
      adults: 2,
      children: 1,
      subtotal: 999,
      total: 999
    })
    await asSession()
    try {
      await assert.rejects(
        call('public.convert_quotation_to_booking($1, $2, 0, $3, null)', [qid, lodge, 'cash']),
        /does not match the campsite rate/
      )
      const count = Number((await db.query(
        `select count(*)::integer as c from public.bookings where lodge_id = $1 and quotation_id = $2`, [lodge, qid]
      )).rows[0].c)
      assert.equal(count, 0, 'no partial booking row on rejected conversion')
    } finally {
      await endSession()
    }
  })

  test('room single-line conversion keeps legacy behavior', async () => {
    const qid = randomUUID()
    await makeQuotation({
      id: qid,
      room: roomId,
      lines: [{ room_id: roomId, room_name: 'Room 101', adults: 2, children: 0, tents: 0, vehicles: 0, amount: 1000 }],
      adults: 2,
      children: 0,
      subtotal: 1000,
      total: 1000
    })
    await asSession()
    try {
      const converted = await call('public.convert_quotation_to_booking($1, $2, 0, $3, null)', [qid, lodge, 'cash'])
      assert.equal(converted.success, true)
      const row = (await db.query(
        `select tents_count, vehicles_count, accommodation_kind, total_amount from public.bookings
          where id = $1 and lodge_id = $2`, [converted.booking_id, lodge]
      )).rows[0]
      assert.equal(row.tents_count, 0)
      assert.equal(row.vehicles_count, 0)
      assert.equal(row.accommodation_kind, null)
      assert.equal(Number(row.total_amount), 1000)
      const details = Number((await db.query(
        `select count(*)::integer as c from public.booking_accommodation_details where booking_id = $1`,
        [converted.booking_id]
      )).rows[0].c)
      assert.equal(details, 0, 'no details row for room conversions')
    } finally {
      await endSession()
    }
  })

  test('multi-line campsite quotation with nonzero occupancy converts through the group contract', async () => {
    const qid = randomUUID()
    const site2Id = randomUUID()
    await db.query(`insert into public.rooms(id, lodge_id, room_number, room_type, rate_per_night, max_occupancy, status,
       accommodation_kind, rate_mode, rate_per_person, rate_per_tent, rate_per_vehicle,
       capacity_adults, capacity_children, max_tents, max_vehicles)
     values ($1, $2, 'A2', 'campsite', 150, 6, 'available',
       'campsite', 'site', 75, 50, 30, 4, 4, 3, 2)`, [site2Id, lodge])
    await makeQuotation({
      id: qid,
      room: siteId,
      lines: [
        { room_id: siteId, room_name: 'Site A1', adults: 2, children: 0, tents: 2, vehicles: 0, amount: 300 },
        { room_id: site2Id, room_name: 'Site A2', adults: 2, children: 0, tents: 1, vehicles: 0, amount: 300 }
      ],
      adults: 4,
      children: 0,
      subtotal: 600,
      total: 600
    })
    await asSession()
    try {
      const converted = await call(
        'public.create_multi_room_booking($1, $2, $3, $4, $5, $6, 0, null, $7, $8, $9, $10)',
        [lodge, customerId, day(30), day(32),
          JSON.stringify([
            { room_id: siteId, adults: 2, children: 0, tents: 2, vehicles: 0 },
            { room_id: site2Id, adults: 2, children: 0, tents: 1, vehicles: 0 }
          ]),
          600, `[STAY_GROUP:quotation-${qid}] [STAY_ROOMS:2]`, userId,
          `quotation-${qid}`, `quotation-conversion:${qid}`]
      )
      assert.equal(converted.success, true, JSON.stringify(converted).slice(0, 400))
      assert.equal(converted.quotation_id, qid)
      assert.equal(converted.booking_ids.length, 2)
      const tents = (await db.query(
        `select coalesce(sum(tents_count), 0)::integer as t from public.bookings where id = any($1::uuid[])`,
        [converted.booking_ids]
      )).rows[0].t
      assert.equal(tents, 3, 'per-line tent counts persisted across children')
    } finally {
      await endSession()
    }
  })
}
