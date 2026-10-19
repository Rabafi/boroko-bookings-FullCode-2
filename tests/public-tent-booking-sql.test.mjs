// F1 public permanent-tent parity: SQL contract on the disposable database.
// Applies 20261014080000 + its forward receipt correction only when the live
// function definitions prove those versions are not already present, then
// exercises end to end
// through the LIVE public envelope (create_online_booking -> legacy):
// - tent singles in ALL FIVE rate modes (site/person/tent/vehicle/composite)
//   price via accommodation_booking_expected_total with per-line counts;
// - a valid 2-adult + 1-child tent stay passes despite max_occupancy 2
//   (independent adult/child caps, no room-style gate);
// - adult/child/tent/vehicle overcapacity and tent-mode zero tents fail
//   closed with actionable errors and no booking row;
// - tent + room groups persist per-line tents/vehicles, the priced-family
//   'campsite' label on tent rows, details rows, and one invoice group;
// - exact replay returns the recorded booking; mismatched reuse conflicts;
// - room singles keep the room rate-plan path with zeroed counts;
// - full-lodge tent properties stay bookable as exclusive use;
// - anon keeps EXECUTE on the envelope while the legacy stays server-only.
// Genuine skip (test.skip) when LUNA_REMEDIATION_* disposable credentials
// are absent. Never touches production: the luna helper denies the linked
// project.
import test from 'node:test'
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
  test('public permanent-tent parity SQL contract (no disposable database)', {
    skip: 'LUNA_REMEDIATION_TEST_DB_URL absent: ' + (blocked?.message || 'no disposable database connection')
  }, () => {})
} else {
  const db = connected.client

  const lodge = randomUUID()
  const slug = 'f1-tent-' + randomUUID().slice(0, 8)
  const roomIds = {
    site: randomUUID(),
    person: randomUUID(),
    tent: randomUUID(),
    vehicle: randomUUID(),
    composite: randomUUID(),
    campsite: randomUUID(),
    room: randomUUID()
  }

  const call = async (text, params = []) => (await db.query(`select ${text} as result`, params)).rows[0].result
  const key = (tag) => `f1-tent-${tag}-` + randomUUID().replace(/-/g, '')
  const email = (tag) => `f1-tent-${tag}-${randomUUID().slice(0, 8)}@example.invalid`
  let phoneSequence = 0
  const nextPhone = () => `+267700${String(++phoneSequence).padStart(5, '0')}`
  // All stay dates stay in the future relative to the database clock so the
  // public check-in guard cannot age this suite out.
  const baseDate = String((await db.query(`select current_date as today`)).rows[0].today).slice(0, 10)
  const day = (offset) => {
    const d = new Date(baseDate + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + offset)
    return d.toISOString().slice(0, 10)
  }

  // This is an acceptance suite, never a migration installer. Require the
  // current live schema before fixtures so a stale target fails loudly and a
  // rerun cannot replay one-time source patches or downgrade later functions.
  const legacyDefinition = (await db.query("select pg_get_functiondef('public.create_online_booking_legacy(text,jsonb)'::regprocedure) as definition")).rows[0].definition
  const wrapperDefinition = (await db.query("select pg_get_functiondef('public.create_online_booking(text,jsonb)'::regprocedure) as definition")).rows[0].definition
  assert.ok(legacyDefinition.includes('public._is_campsite_priced_kind(v_room.accommodation_kind)'), 'live legacy function uses the priced-kind family')
  assert.ok(legacyDefinition.includes('v_room.capacity_adults'), 'live legacy function validates independent adult capacity')
  assert.ok(wrapperDefinition.includes('booking_accommodation_details'), 'live envelope verifies accommodation detail receipts')
  assert.ok(wrapperDefinition.includes('vehicles_count is distinct from'), 'live envelope binds per-line vehicle receipt counts')
  assert.ok(
    wrapperDefinition.toLowerCase().includes("jsonb_typeof(v_payload->'rooms') is distinct from 'array'"),
    'live public booking wrapper has the NULL-safe single-booking receipt predicate'
  )
  await db.query(
    `insert into public.settings(lodge_id, slug, lodge_name, currency, business_type, property_type,
       public_offer_rooms, public_offer_multi_room, public_offer_full_lodge, trial_started_at)
     values ($1, $2, 'F1 Tent Lodge', 'P', 'lodge', 'camp', true, true, true, null)`,
    [lodge, slug]
  )
  const addRoom = (id, number, kind, mode, rates, caps) => db.query(
    `insert into public.rooms(id, lodge_id, room_number, room_type, rate_per_night, max_occupancy, status,
       accommodation_kind, rate_mode, rate_per_person, rate_per_tent, rate_per_vehicle,
       capacity_adults, capacity_children, max_tents, max_vehicles)
     values ($1, $2, $3, $4, $5, $6, 'available', $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [id, lodge, number, kind === 'tent' ? 'Permanent tent' : kind, rates.site, caps.occ, kind, mode,
      rates.person, rates.tent, rates.vehicle, caps.adults, caps.children, caps.tents, caps.vehicles]
  )
  await addRoom(roomIds.site, 'T1', 'tent', 'site', { site: 100, person: 70, tent: 50, vehicle: 30 }, { occ: 2, adults: 2, children: 2, tents: 3, vehicles: 2 })
  await addRoom(roomIds.person, 'T2', 'tent', 'person', { site: 100, person: 70, tent: 50, vehicle: 30 }, { occ: 2, adults: 2, children: 2, tents: 3, vehicles: 2 })
  await addRoom(roomIds.tent, 'T3', 'tent', 'tent', { site: 100, person: 70, tent: 50, vehicle: 30 }, { occ: 2, adults: 2, children: 2, tents: 3, vehicles: 2 })
  await addRoom(roomIds.vehicle, 'T4', 'tent', 'vehicle', { site: 100, person: 70, tent: 50, vehicle: 30 }, { occ: 2, adults: 2, children: 2, tents: 3, vehicles: 2 })
  await addRoom(roomIds.composite, 'T5', 'tent', 'composite', { site: 100, person: 70, tent: 50, vehicle: 30 }, { occ: 2, adults: 2, children: 2, tents: 3, vehicles: 2 })
  await addRoom(roomIds.campsite, 'A1', 'campsite', 'site', { site: 150, person: 75, tent: 50, vehicle: 30 }, { occ: 6, adults: 4, children: 4, tents: 3, vehicles: 2 })
  await addRoom(roomIds.room, '101', 'room', 'site', { site: 300, person: 0, tent: 0, vehicle: 0 }, { occ: 2, adults: null, children: null, tents: null, vehicles: null })

  const guest = (tag) => ({
    guest_first_name: 'F1',
    guest_last_name: 'Tent',
    guest_email: email(tag),
    guest_phone: nextPhone(),
    notes: ''
  })

  async function bookSingle({ tag, roomKey, mode, counts, inDays = 7, expectTotal }) {
    const idem = key(tag)
    const payload = {
      idempotency_key: idem,
      booking_type: 'room',
      room_id: roomIds[roomKey],
      check_in: day(inDays),
      check_out: day(inDays + 2),
      adults: counts.adults,
      children: counts.children,
      tents: counts.tents,
      vehicles: counts.vehicles,
      ...guest(tag)
    }
    const result = await call('public.create_online_booking($1, $2)', [slug, JSON.stringify(payload)])
    assert.equal(result.success, true, `tent ${mode} single must succeed: ` + JSON.stringify(result).slice(0, 500))
    if (expectTotal !== undefined) {
      assert.equal(Number(result.total_amount), expectTotal, `tent ${mode} authoritative total`)
    }
    const booking = (await db.query(
      `select id, tents_count, vehicles_count, accommodation_kind, adults, children, total_amount
         from public.bookings where id = $1::uuid`,
      [result.booking_id]
    )).rows[0]
    const details = (await db.query(
      `select accommodation_kind, adults, children, tents, vehicles, rate_mode
         from public.booking_accommodation_details where booking_id = $1::uuid`,
      [result.booking_id]
    )).rows[0]
    return { result, booking, details, idem, payload }
  }

  test('tent singles price in all five rate modes with per-line counts', async () => {
    // 2 nights each. Site 100x2=200; person 70x2x2=280; tent 50x2x2=200;
    // vehicle 30x1x2=60; composite (100+70x2+50x2+30x1)x2=740.
    const site = await bookSingle({ tag: 'site', roomKey: 'site', mode: 'site', counts: { adults: 2, children: 0, tents: 0, vehicles: 0 }, expectTotal: 200 })
    const person = await bookSingle({ tag: 'person', roomKey: 'person', mode: 'person', counts: { adults: 2, children: 0, tents: 0, vehicles: 0 }, inDays: 10, expectTotal: 280 })
    const tent = await bookSingle({ tag: 'tent', roomKey: 'tent', mode: 'tent', counts: { adults: 2, children: 0, tents: 2, vehicles: 0 }, inDays: 12, expectTotal: 200 })
    const vehicle = await bookSingle({ tag: 'vehicle', roomKey: 'vehicle', mode: 'vehicle', counts: { adults: 1, children: 0, tents: 0, vehicles: 1 }, inDays: 14, expectTotal: 60 })
    const composite = await bookSingle({ tag: 'composite', roomKey: 'composite', mode: 'composite', counts: { adults: 2, children: 0, tents: 2, vehicles: 1 }, inDays: 16, expectTotal: 740 })
    for (const [name, created, expectedMode] of [
      ['site', site, 'site'],
      ['person', person, 'person'],
      ['tent', tent, 'tent'],
      ['vehicle', vehicle, 'vehicle'],
      ['composite', composite, 'composite']
    ]) {
      assert.equal(created.booking.accommodation_kind, 'campsite', `${name}: priced-family label stamped`)
      assert.equal(created.details.accommodation_kind, 'campsite', `${name}: details family label`)
      assert.equal(created.details.rate_mode, expectedMode, `${name}: details rate mode`)
      const invoiceCount = (await db.query(
        `select count(*)::integer as n from public.invoices where booking_id = $1::uuid and lodge_id = $2`,
        [created.result.booking_id, lodge]
      )).rows[0].n
      assert.equal(invoiceCount, 1, `${name}: invoice row persisted`)
    }
    assert.equal(tent.booking.tents_count, 2, 'tent-mode tents_count carried')
    assert.equal(composite.booking.vehicles_count, 1, 'composite vehicles_count carried')
    assert.equal(composite.details.tents, 2, 'composite details tents persisted')
    assert.equal(composite.details.vehicles, 1, 'composite details vehicles persisted')
    // Server-computed total agrees with the authoritative expected-total helper.
    const expected = await call(
      'public.accommodation_booking_expected_total($1, $2, $3, $4, 2, 0, 2, 0, null)',
      [lodge, roomIds.site, day(7), day(9)]
    )
    assert.equal(Number(expected), 200, 'helper agrees with the persisted site-mode total')
  })

  test('valid 2-adult + 1-child tent stay passes despite max_occupancy 2', async () => {
    const created = await bookSingle({
      tag: 'family', roomKey: 'site', mode: 'site',
      counts: { adults: 2, children: 1, tents: 1, vehicles: 0 }, inDays: 18
    })
    assert.equal(created.booking.adults, 2)
    assert.equal(created.booking.children, 1)
    assert.equal(created.details.tents, 1)
  })

  test('tent overcapacity fails closed with no booking row', async () => {
    const idem = key('overcap')
    const payload = {
      idempotency_key: idem,
      booking_type: 'room',
      room_id: roomIds.site,
      check_in: day(20),
      check_out: day(22),
      adults: 3,
      children: 0,
      tents: 1,
      vehicles: 0,
      ...guest('overcap')
    }
    const result = await call('public.create_online_booking($1, $2)', [slug, JSON.stringify(payload)])
    assert.equal(result.success, false, 'adult overcap must be rejected: ' + JSON.stringify(result).slice(0, 300))
    assert.match(String(result.error), /adult/i, 'actionable adult-capacity error')
    const rows = (await db.query(`select count(*)::integer as n from public.bookings where lodge_id = $1 and create_idempotency_key = $2`, [lodge, idem])).rows[0].n
    assert.equal(rows, 0, 'no partial booking persisted')

    const zeroTent = await call('public.create_online_booking($1, $2)', [slug, JSON.stringify({
      idempotency_key: key('zerotent'),
      booking_type: 'room',
      room_id: roomIds.tent,
      check_in: day(20),
      check_out: day(22),
      adults: 1,
      children: 0,
      tents: 0,
      vehicles: 0,
      ...guest('zerotent')
    })])
    assert.equal(zeroTent.success, false, 'tent-mode zero tents must be rejected')
    assert.match(String(zeroTent.error), /tent/i)
  })

  test('tent + room group persists per-line counts, labels, details and one invoice group', async () => {
    const idem = key('group')
    const payload = {
      idempotency_key: idem,
      booking_type: 'multi_room',
      rooms: [
        { room_id: roomIds.site, adults: 2, children: 0, tents: 2, vehicles: 0 },
        { room_id: roomIds.room, adults: 1, children: 0, tents: 0, vehicles: 0 }
      ],
      check_in: day(24),
      check_out: day(26),
      adults: 3,
      children: 0,
      tents: 2,
      vehicles: 0,
      ...guest('group')
    }
    const result = await call('public.create_online_booking($1, $2)', [slug, JSON.stringify(payload)])
    assert.equal(result.success, true, 'group must succeed: ' + JSON.stringify(result).slice(0, 500))
    assert.equal(result.group_invoice, true)
    assert.equal(result.booking_ids.length, 2)
    const tentRow = (await db.query(
      `select tents_count, vehicles_count, accommodation_kind from public.bookings where room_id = $1 and lodge_id = $2 and check_in = $3`,
      [roomIds.site, lodge, day(24)]
    )).rows[0]
    assert.equal(tentRow.tents_count, 2, 'tent line tents carried')
    assert.equal(tentRow.accommodation_kind, 'campsite', 'tent line family label')
    const roomRow = (await db.query(
      `select tents_count, vehicles_count, accommodation_kind from public.bookings where room_id = $1 and lodge_id = $2 and check_in = $3`,
      [roomIds.room, lodge, day(24)]
    )).rows[0]
    assert.equal(roomRow.tents_count, 0, 'room line tents zeroed')
    assert.equal(roomRow.accommodation_kind, 'room', 'room line keeps room label')
    const detailCount = (await db.query(
      `select count(*)::integer as n from public.booking_accommodation_details where booking_id = any($1::uuid[])`,
      [result.booking_ids]
    )).rows[0].n
    assert.equal(detailCount, 2, 'details rows for every group line')
    const groupCount = (await db.query(
      `select count(distinct l.group_id)::integer as n from public.booking_invoice_group_lines l where l.booking_id = any($1::uuid[]) and l.lodge_id = $2`,
      [result.booking_ids, lodge]
    )).rows[0].n
    assert.equal(groupCount, 1, 'one shared invoice group')
  })

  test('exact replay returns the recorded booking; mismatched reuse conflicts', async () => {
    const idem = key('replay')
    const payload = {
      idempotency_key: idem,
      booking_type: 'room',
      room_id: roomIds.campsite,
      check_in: day(27),
      check_out: day(29),
      adults: 2,
      children: 0,
      tents: 1,
      vehicles: 0,
      ...guest('replay')
    }
    const first = await call('public.create_online_booking($1, $2)', [slug, JSON.stringify(payload)])
    assert.equal(first.success, true)
    const replay = await call('public.create_online_booking($1, $2)', [slug, JSON.stringify(payload)])
    assert.equal(replay.success, true, 'identical replay succeeds')
    assert.equal(replay.idempotent, true, 'replay flagged idempotent')
    assert.equal(replay.booking_id, first.booking_id, 'replay returns the recorded booking')
    const clash = await call('public.create_online_booking($1, $2)', [slug, JSON.stringify({
      ...payload,
      check_in: day(28),
      check_out: day(30),
      guest_email: email('replay-clash')
    })])
    assert.equal(clash.success, false, 'mismatched reuse must not create')
    assert.equal(clash.code, 'idempotency_conflict', 'mismatched reuse conflicts, got: ' + JSON.stringify(clash).slice(0, 200))
  })

  test('room singles keep the room rate-plan path with zeroed counts', async () => {
    const created = await bookSingle({
      tag: 'room', roomKey: 'room', mode: 'site',
      counts: { adults: 1, children: 0, tents: 0, vehicles: 0 }, inDays: 18, expectTotal: 600
    })
    assert.equal(created.booking.accommodation_kind, 'room', 'room label untouched')
    assert.equal(created.booking.tents_count, 0)
    assert.equal(created.details.tents, 0, 'room details row with zeroed counts')
  })

  test('full-lodge tent properties stay bookable as exclusive use', async () => {
    const idem = key('fulllodge')
    const result = await call('public.create_online_booking($1, $2)', [slug, JSON.stringify({
      idempotency_key: idem,
      booking_type: 'full_lodge',
      check_in: day(60),
      check_out: day(62),
      adults: 2,
      children: 0,
      tents: 0,
      vehicles: 0,
      ...guest('fulllodge')
    })])
    assert.equal(result.success, true, 'full lodge must succeed: ' + JSON.stringify(result).slice(0, 500))
    const booking = (await db.query(
      `select is_exclusive_event from public.bookings where id = $1::uuid`,
      [result.booking_id]
    )).rows[0]
    assert.equal(booking.is_exclusive_event, true, 'exclusive-use guard intact')
    const details = (await db.query(
      `select count(*)::integer as n from public.booking_accommodation_details where booking_id = $1::uuid`,
      [result.booking_id]
    )).rows[0].n
    assert.equal(details, 1, 'exclusive booking persists its occupancy details')
  })

  test('public grants keep the envelope open and the legacy server-only', async () => {
    const envelope = await call(`has_function_privilege('anon', 'public.create_online_booking(text,jsonb)', 'EXECUTE')`, [])
    assert.equal(envelope, true, 'anon keeps envelope EXECUTE')
    const legacy = await call(`has_function_privilege('anon', 'public.create_online_booking_legacy(text,jsonb)', 'EXECUTE')`, [])
    assert.equal(legacy, false, 'legacy stays revoked from anon')
    const helper = await call(`has_function_privilege('anon', 'public._is_campsite_priced_kind(text)', 'EXECUTE')`, [])
    assert.equal(helper, false, 'priced-kind helper stays owner-only')
  })
}
