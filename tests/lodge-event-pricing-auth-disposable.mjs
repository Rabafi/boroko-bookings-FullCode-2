// Disposable-only rollback acceptance. The test uses real app_sessions rows;
// it never writes to production and all fixture rows are rolled back.
import dotenv from 'dotenv'
import { guardLodgeDisposableQuery } from './helpers/lodge-management-disposable.mjs'
dotenv.config({ path: '.env.disposable.local', quiet: true })

const ref = 'repsrmlomedqrmrdsbga'
const token = process.env.SUPABASE_ACCESS_TOKEN
if (!token || process.env.LUNA_REMEDIATION_EXPECTED_PROJECT_REF !== ref
  || process.env.LUNA_REMEDIATION_EXPECTED_DATABASE !== 'postgres'
  || process.env.LUNA_REMEDIATION_TARGET_MARKER !== 'LUNA-REMEDIATION-DISPOSABLE-v1') {
  throw new Error('Disposable target guard failed')
}

const query = `begin;
-- Exercise the desktop's anon API-key transport with a real app_sessions token.
-- Restore the fixture role and request context after both success and denial.
create function pg_temp.lodge_event_details_as_anon(p_event uuid, p_lodge uuid, p_token text)
returns jsonb language plpgsql as $staff_read$
declare
  v_result jsonb;
  v_session text := current_setting('app.session_token',true);
  v_claim_role text := current_setting('request.jwt.claim.role',true);
  v_claims text := current_setting('request.jwt.claims',true);
begin
  execute 'set local role anon';
  perform set_config('request.jwt.claim.role','anon',true);
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  perform set_config('app.session_token',coalesce(p_token,''),true);
  begin
    v_result := public.get_event_booking_details(p_event,p_lodge);
  exception when others then
    execute 'reset role';
    perform set_config('app.session_token',coalesce(v_session,''),true);
    perform set_config('request.jwt.claim.role',coalesce(v_claim_role,''),true);
    perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
    raise;
  end;
  execute 'reset role';
  perform set_config('app.session_token',coalesce(v_session,''),true);
  perform set_config('request.jwt.claim.role',coalesce(v_claim_role,''),true);
  perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
  return v_result;
end $staff_read$;
do $$
declare
  v_lodge uuid;
  v_other_lodge constant uuid := '99999999-9999-4999-8999-999999999991';
  v_actor constant uuid := '77777777-7777-4777-8777-777777777771';
  v_event constant uuid := '22222222-2222-4222-8222-222222222271';
  v_room_event constant uuid := '22222222-2222-4222-8222-222222222272';
  v_room constant uuid := '88888888-8888-4888-8888-888888888871';
  v_unpriced_event constant uuid := '22222222-2222-4222-8222-222222222273';
  v_unpriced_draft constant uuid := '22222222-2222-4222-8222-222222222275';
  v_overpaid_event constant uuid := '22222222-2222-4222-8222-222222222277';
  v_token constant text := 'disposable-event-session-token';
  v_expired_token constant text := 'disposable-event-expired-token';
  v_result jsonb;
  v_details jsonb;
  v_total numeric;
  v_invoice_balance numeric;
  v_invoice_reconciliation boolean;
  v_invoice_status text;
  v_failed boolean;
begin
  select id into v_lodge from public.settings order by id limit 1;
  if v_lodge is null then raise exception 'Disposable fixture needs one settings row'; end if;
  insert into public.users(id,lodge_id,name,email,role,password_hash,status)
  values(v_actor,v_lodge,'Disposable Event Auth Actor','event-auth-disposable@example.invalid','manager','rollback-only-test-hash','active')
  on conflict(id) do nothing;
  insert into public.rooms(id,lodge_id,room_number,room_type,rate_per_night,max_occupancy,status)
  values(v_room,v_lodge,'DISPOSABLE-EVENT-PRICE','room',500,2,'available') on conflict(id) do nothing;
  insert into public.app_sessions(token_hash,session_type,user_id,lodge_id,role,expires_at)
  values(public.app_hash_token(v_token),'desktop',v_actor,v_lodge,'manager',now()+interval '1 hour'),
        (public.app_hash_token(v_expired_token),'desktop',v_actor,v_lodge,'manager',now()-interval '1 hour');
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  perform set_config('app.session_token',v_token,true);

  -- This is the same scoped details RPC used by the signed-in desktop client.
  insert into public.conference_bookings(id,lodge_id,booking_date,start_time,end_time,client_name,event_type,reservation_scope,status,adults,children,subtotal,extras_total,charges_total,total_amount,amount_paid,balance_due,deposit_paid,payment_status,currency,updated_at)
  values(v_event,v_lodge,current_date,time '10:00',time '11:00','Disposable Event Detail','conference','venue_only','reserved',0,0,0,0,0,600,0,600,0,'unpaid','BWP',now());
  v_details := pg_temp.lodge_event_details_as_anon(v_event,v_lodge,v_token);
  if coalesce((v_details->>'success')::boolean,false) is not true then raise exception 'Valid authenticated event details failed: %',v_details; end if;
  select balance_due,reconciliation_required,payment_status
    into v_invoice_balance,v_invoice_reconciliation,v_invoice_status
    from public.get_invoice_summary(v_lodge,v_event) where event_booking_id=v_event;
  if v_invoice_balance is distinct from 600::numeric or v_invoice_reconciliation is not false
     or v_invoice_status is distinct from 'unpaid' then
    raise exception 'Ordinary venue invoice should expose its P600 collectible balance: %, %, %',v_invoice_balance,v_invoice_reconciliation,v_invoice_status;
  end if;
  v_failed := false;
  begin
    perform pg_temp.lodge_event_details_as_anon(v_event,v_other_lodge,v_token);
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'Cross-lodge event detail read was not rejected'; end if;
  perform set_config('app.session_token',v_expired_token,true);
  v_failed := false;
  begin
    perform pg_temp.lodge_event_details_as_anon(v_event,v_lodge,v_expired_token);
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'Expired desktop session was not rejected'; end if;
  perform set_config('app.session_token',v_token,true);

  -- A legacy event with receipts and no recorded total has an unresolved
  -- balance. The projection must not turn it into a negative collectible.
  insert into public.conference_bookings(id,lodge_id,booking_date,start_time,end_time,client_name,event_type,reservation_scope,status,adults,children,subtotal,extras_total,charges_total,total_amount,amount_paid,balance_due,deposit_paid,payment_status,currency,updated_at)
  values(v_overpaid_event,v_lodge,current_date,time '10:00',time '11:00','Disposable overpaid invoice','conference','venue_only','reserved',0,0,0,0,0,0,2500,0,2500,'paid','BWP',now());
  select balance_due,reconciliation_required,payment_status
    into v_invoice_balance,v_invoice_reconciliation,v_invoice_status
    from public.get_invoice_summary(v_lodge,v_overpaid_event) where event_booking_id=v_overpaid_event;
  if v_invoice_balance is not null or v_invoice_reconciliation is not true
     or v_invoice_status is distinct from 'reconciliation_required' then
    raise exception 'Overpaid zero-total event must remain unreconciled with no numeric balance: %, %, %',v_invoice_balance,v_invoice_reconciliation,v_invoice_status;
  end if;

  -- An unpriced reserved event and a deposit on an unpriced draft fail closed.
  v_failed := false;
  begin
    v_result := public.create_event_booking(jsonb_build_object(
      'id',v_unpriced_event,'lodge_id',v_lodge,'idempotency_key','test-unpriced-reserved-0001',
      'event_name','Unpriced reserved test','client_name','Disposable Guest','event_type','conference',
      'reservation_scope','venue_only','status','reserved','booking_date',current_date::text,
      'start_time','10:00','end_time','11:00','total_amount',0));
  exception when others then v_failed := sqlerrm ilike '%positive agreed%';
  end;
  if not v_failed then raise exception 'Unpriced reserved event was accepted: %',v_result; end if;
  v_failed := false;
  begin
    v_result := public.create_event_booking(jsonb_build_object(
      'id',v_unpriced_event,'lodge_id',v_lodge,'idempotency_key','test-unpriced-draft-0001',
      'event_name','Unpriced draft test','client_name','Disposable Guest','event_type','conference',
      'reservation_scope','venue_only','status','draft','booking_date',current_date::text,
      'start_time','10:00','end_time','11:00','total_amount',0,'deposit_amount',100,'payment_method','cash'));
  exception when others then v_failed := sqlerrm ilike '%unpriced%';
  end;
  if not v_failed then raise exception 'Unpriced draft accepted a deposit: %',v_result; end if;
  v_result := public.create_event_booking(jsonb_build_object(
    'id',v_unpriced_draft,'lodge_id',v_lodge,'idempotency_key','test-unpriced-draft-0002',
    'event_name','Unpriced draft test','client_name','Disposable Guest','event_type','conference',
    'reservation_scope','venue_only','status','draft','booking_date',current_date::text,
    'start_time','10:00','end_time','11:00','total_amount',0));
  if coalesce((v_result->>'success')::boolean,false) is not true then raise exception 'Explicit unpriced draft was not allowed: %',v_result; end if;
  v_result := public.update_event_payment(v_unpriced_draft,v_lodge,50,'cash','payment','test-unpriced-payment-0001',v_actor);
  if coalesce((v_result->>'success')::boolean,true) then raise exception 'Direct payment RPC accepted an unpriced draft: %',v_result; end if;

  -- A valid room charge satisfies the agreed consolidated total with a zero venue base.
  v_result := public.create_event_booking(jsonb_build_object(
    'id',v_room_event,'lodge_id',v_lodge,'idempotency_key','test-room-priced-000001',
    'event_name','Room-only priced event','client_name','Disposable Guest','event_type','conference',
    'reservation_scope','venue_with_rooms','status','reserved','booking_date',current_date::text,
    'check_in',current_date::text,'check_out',(current_date+1)::text,'start_time','10:00','end_time','11:00',
    'total_amount',0,'room_ids',jsonb_build_array(v_room)));
  if coalesce((v_result->>'success')::boolean,false) is not true then raise exception 'Valid room-only consolidated charge was rejected: %',v_result; end if;

  -- Legacy direct payment callers must receive the original successful result
  -- when they retry a same-key payment that paid the room-backed invoice in full.
  v_result := public.update_event_payment(v_room_event,v_lodge,500,'cash','payment','direct-room-full-payment-0001',v_actor);
  if coalesce((v_result->>'success')::boolean,false) is not true then raise exception 'Direct full-balance room payment failed: %',v_result; end if;
  v_result := public.update_event_payment(v_room_event,v_lodge,500,'cash','payment','direct-room-full-payment-0001',v_actor);
  if coalesce((v_result->>'success')::boolean,false) is not true or coalesce((v_result->>'idempotent')::boolean,false) is not true then
    raise exception 'Exact direct full-balance payment retry was not idempotent: %',v_result;
  end if;
  v_result := public.update_event_payment(v_room_event,v_lodge,499,'cash','payment','direct-room-full-payment-0001',v_actor);
  if coalesce((v_result->>'success')::boolean,true) then raise exception 'Changed direct payment payload reused the original key: %',v_result; end if;
  if (select count(*) from public.payments where conference_booking_id=v_room_event and idempotency_key='direct-room-full-payment-0001') <> 1 then
    raise exception 'Direct payment retry created more than one receipt';
  end if;

  -- Simulate the reported total/base split: P500 agreed base + P100 extra = P600.
  insert into public.conference_bookings(id,lodge_id,booking_date,start_time,end_time,client_name,event_type,reservation_scope,status,adults,children,subtotal,extras_total,charges_total,total_amount,amount_paid,balance_due,deposit_paid,payment_status,currency,updated_at)
  values('22222222-2222-4222-8222-222222222274',v_lodge,current_date,time '10:00',time '11:00','Disposable Edit','conference','venue_only','reserved',0,0,0,0,0,0,0,0,0,'unpaid','BWP',now());
  insert into public.event_booking_line_items(lodge_id,event_booking_id,line_type,description,category,quantity,unit_price,subtotal,source_reference,created_by)
  values(v_lodge,'22222222-2222-4222-8222-222222222274','venue','Event / venue fee','venue',1,500,500,'event-base:22222222-2222-4222-8222-222222222274',v_actor),
        (v_lodge,'22222222-2222-4222-8222-222222222274','manual','Extra','event_extra',1,100,100,'test-extra',v_actor);
  perform public.recalculate_event_totals('22222222-2222-4222-8222-222222222274');
  v_result := public.update_event_booking('22222222-2222-4222-8222-222222222274',v_lodge,
    jsonb_build_object('event_name','Edited name','total_amount',500),null,'test-event-edit-name-0001');
  if coalesce((v_result->>'success')::boolean,false) is not true then raise exception 'Name-only edit failed: %',v_result; end if;
  select total_amount into v_total from public.conference_bookings where id='22222222-2222-4222-8222-222222222274';
  if v_total<>600 then raise exception 'Name-only edit changed P600 consolidated event total to %',v_total; end if;

  v_result := public.cancel_event_booking(v_event,v_lodge,'Disposable cancellation test',true,'test-cancel-event-000001');
  if coalesce((v_result->>'success')::boolean,false) is not true then raise exception 'Event cancellation failed: %',v_result; end if;
  v_result := public.cancel_event_booking(v_event,v_lodge,'Disposable cancellation test',true,'test-cancel-event-000001');
  if coalesce((v_result->>'idempotent')::boolean,false) is not true then raise exception 'Exact event cancellation retry was not idempotent: %',v_result; end if;
  v_result := public.cancel_event_booking(v_event,v_lodge,'Changed cancellation reason',true,'test-cancel-event-000001');
  if coalesce((v_result->>'success')::boolean,true) then raise exception 'Changed cancellation payload reused the original key: %',v_result; end if;
end $$;
rollback;`

const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ query: guardLodgeDisposableQuery(query) })
})
const result = await response.json().catch(() => null)
if (!response.ok) throw new Error(`Disposable event acceptance failed (${response.status}): ${String(result?.message || '').slice(0, 800)}`)
console.log('EVENT_PRICE_AUTH_EDIT_DB_TEST_PASS', JSON.stringify(result?.result || result))
