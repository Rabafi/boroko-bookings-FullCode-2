// Disposable-only two-session race: payment recording and duplicate-receipt
// voiding target the same booking. The fixture is committed briefly so the
// independent Supabase Management API requests can observe the same rows, then
// every synthetic row is removed in finally.
import crypto from 'node:crypto'
import dotenv from 'dotenv'
import { guardLodgeDisposableQuery } from './helpers/lodge-management-disposable.mjs'

dotenv.config({ path: '.env.disposable.local', quiet: true })
const ref = 'repsrmlomedqrmrdsbga'
const marker = 'LUNA-REMEDIATION-DISPOSABLE-v1'
const token = process.env.SUPABASE_ACCESS_TOKEN
if (!token || process.env.LUNA_REMEDIATION_EXPECTED_PROJECT_REF !== ref
  || process.env.LUNA_REMEDIATION_EXPECTED_DATABASE !== 'postgres'
  || process.env.LUNA_REMEDIATION_TARGET_MARKER !== marker) {
  throw new Error('Disposable target guard failed')
}

const ids = Object.fromEntries(['actor', 'customer', 'room', 'event', 'booking', 'source', 'duplicate', 'payment'].map((key) => [key, crypto.randomUUID()]))
const operationKeys = {
  void: `test:void-race:${ids.duplicate}`,
  payment: `test:payment-race:${ids.payment}`
}
const q = (value) => `'${String(value).replaceAll("'", "''")}'`
const uuid = (key) => `${q(ids[key])}::uuid`

async function sql(query, label, allowFailure = false) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: guardLodgeDisposableQuery(query) })
  })
  const body = await response.json().catch(() => null)
  if (!response.ok && !allowFailure) throw new Error(`${label} failed (${response.status}): ${String(body?.message || 'unknown').slice(0, 700)}`)
  return { ok: response.ok, body }
}

const sessionSetup = `
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  perform set_config('app.session_valid','true',true);
  perform set_config('app.lodge_id',v_lodge::text,true);
  perform set_config('app.session_role','manager',true);
  perform set_config('app.actor_id',${q(ids.actor)},true);
`

const setup = `begin;
do $$ declare v_lodge uuid;
begin
  select id into v_lodge from public.settings order by id limit 1;
  if v_lodge is null then raise exception 'Disposable fixture needs a settings row'; end if;
  insert into public.users(id,lodge_id,name,email,role,password_hash,status)
  values(${uuid('actor')},v_lodge,'Disposable Race Test Actor',${q(`race-${ids.actor}@example.invalid`)},'manager','rollback-only-test-hash','active');
  insert into public.customers(id,lodge_id,name)
  values(${uuid('customer')},v_lodge,'Disposable Race Test Guest');
  insert into public.rooms(id,lodge_id,room_number,room_type,rate_per_night,max_occupancy,status)
  values(${uuid('room')},v_lodge,${q(`RACE-${ids.room.slice(0, 8)}`)},'room',700,2,'available');
  insert into public.conference_bookings(
    id,lodge_id,booking_date,start_time,end_time,client_name,event_type,reservation_scope,status,
    adults,children,subtotal,extras_total,charges_total,total_amount,amount_paid,balance_due,
    deposit_paid,payment_status,currency,updated_at,notes
  ) values (
    ${uuid('event')},v_lodge,current_date,time '10:00',time '11:00','Disposable Race Test','conference',
    'venue_with_rooms','reserved',0,0,0,0,0,2000,0,2000,2000,'partial','BWP',now(),''
  );
  insert into public.bookings(
    id,lodge_id,room_id,customer_id,check_in,check_out,total_amount,amount_paid,charges_total,
    payment_status,status,notes,created_at,updated_at,source,vat_enabled,vat_rate,tents_count,vehicles_count
  ) values (
    ${uuid('booking')},v_lodge,${uuid('room')},${uuid('customer')},current_date,current_date+1,
    700,500,0,'partial','confirmed','[EVENT:${ids.event}] disposable concurrent fixture',now(),now(),'direct',false,0,0,0
  );
  insert into public.payments(id,booking_id,lodge_id,amount,method,type,paid_at,recorded_by,idempotency_key,conference_booking_id)
  values
    (${uuid('source')},null,v_lodge,2000,'cash','deposit',now(),${uuid('actor')},${q(`test:source:${ids.event}`)},${uuid('event')}),
    (${uuid('duplicate')},${uuid('booking')},v_lodge,500,'cash','payment',now(),${uuid('actor')},${q(`test:duplicate:${ids.booking}`)},null);
end $$;
commit;`

const voidCall = `begin;
do $$ declare v_lodge uuid; v_result jsonb;
begin
  select lodge_id into v_lodge from public.bookings where id=${uuid('booking')};
  ${sessionSetup}
  perform pg_sleep(0.25);
  v_result := public.void_duplicate_event_payment(
    v_lodge,${uuid('event')},${uuid('source')},${uuid('duplicate')},500,
    'Synthetic concurrent duplicate receipt test',${q(operationKeys.void)}
  );
  if coalesce((v_result->>'success')::boolean,false) is not true then raise exception 'Void transaction rejected: %',v_result; end if;
end $$;
commit;`

const paymentCall = `begin;
do $$ declare v_lodge uuid; v_result jsonb;
begin
  select lodge_id into v_lodge from public.bookings where id=${uuid('booking')};
  ${sessionSetup}
  perform pg_sleep(0.25);
  v_result := public.update_booking_payment(
    ${uuid('booking')},v_lodge,100,'cash','payment',${q(operationKeys.payment)},${uuid('actor')},null
  );
  if coalesce((v_result->>'success')::boolean,false) is not true then raise exception 'Payment transaction rejected: %',v_result; end if;
end $$;
commit;`

const verify = `do $$ declare v_booking uuid := ${uuid('booking')}; v_duplicate uuid := ${uuid('duplicate')}; v_paid numeric; v_active numeric; v_voided timestamptz;
begin
  select amount_paid into v_paid from public.bookings where id=v_booking;
  select coalesce(sum(amount),0) into v_active from public.payment_reporting_active where booking_id=v_booking;
  select voided_at into v_voided from public.payments where id=v_duplicate;
  if v_voided is null or v_paid<>100 or v_active<>100 then
    raise exception 'Concurrent payment/void projection mismatch: booking paid %, active ledger %, duplicate voided %',v_paid,v_active,v_voided;
  end if;
  if (select count(*) from public.financial_audit_log where idempotency_key=${q(operationKeys.void)})<>1 then
    raise exception 'Concurrent correction did not write exactly one audit row';
  end if;
end $$;`

const cleanup = `begin;
delete from public.financial_audit_log where idempotency_key=${q(operationKeys.void)};
delete from public.financial_audit_log where idempotency_key=${q(operationKeys.payment)};
delete from public.payments where booking_id=${uuid('booking')} or conference_booking_id=${uuid('event')};
delete from public.payments where id in (${uuid('source')},${uuid('duplicate')},${uuid('payment')});
delete from public.conference_bookings where id=${uuid('event')};
delete from public.bookings where id=${uuid('booking')};
delete from public.rooms where id=${uuid('room')};
delete from public.customers where id=${uuid('customer')};
delete from public.users where id=${uuid('actor')};
commit;`

const cleanupStale = `begin;
delete from public.financial_audit_log
 where idempotency_key like 'test:void-race:%' or idempotency_key like 'test:payment-race:%';
delete from public.payments p using public.bookings b
 where p.booking_id=b.id and coalesce(b.notes,'') like '%disposable concurrent fixture';
delete from public.payments p using public.conference_bookings e
 where p.conference_booking_id=e.id and e.client_name='Disposable Race Test';
delete from public.bookings where coalesce(notes,'') like '%disposable concurrent fixture';
delete from public.conference_bookings where client_name='Disposable Race Test';
delete from public.rooms where room_number like 'RACE-%';
delete from public.customers where name='Disposable Race Test Guest';
delete from public.users where email like 'race-%@example.invalid';
commit;`

let setupAttempted = false
try {
  await sql(cleanupStale, 'Stale disposable race fixture cleanup')
  setupAttempted = true
  await sql(setup, 'Disposable race fixture setup')
  const outcomes = await Promise.allSettled([
    sql(voidCall, 'Concurrent duplicate void'),
    sql(paymentCall, 'Concurrent booking payment')
  ])
  if (!outcomes.every((outcome) => outcome.status === 'fulfilled' && outcome.value.ok)) {
    const reason = outcomes.filter((outcome) => outcome.status === 'rejected').map((outcome) => String(outcome.reason?.message || outcome.reason)).join('; ')
    throw new Error(`Concurrent financial request failed: ${reason || 'one transaction did not commit'}`)
  }
  await sql(verify, 'Concurrent financial projection verification')
  console.log('CASH_NEUTRAL_VOID_CONCURRENCY_PASS', JSON.stringify({ joined_requests: 2, active_booking_paid: 100, duplicate_voided: true }))
} finally {
  if (setupAttempted) await sql(cleanup, 'Disposable race fixture cleanup')
}
