// Disposable-only synthetic acceptance. The transaction ends with ROLLBACK.
import dotenv from 'dotenv'
import { guardLodgeDisposableQuery } from './helpers/lodge-management-disposable.mjs'
dotenv.config({path:'.env.disposable.local',quiet:true})
const ref='repsrmlomedqrmrdsbga', token=process.env.SUPABASE_ACCESS_TOKEN
if(!token||process.env.LUNA_REMEDIATION_EXPECTED_PROJECT_REF!==ref||process.env.LUNA_REMEDIATION_EXPECTED_DATABASE!=='postgres'||process.env.LUNA_REMEDIATION_TARGET_MARKER!=='LUNA-REMEDIATION-DISPOSABLE-v1')throw new Error('Disposable target guard failed')
const query=`begin;
do $$
declare
 v_lodge uuid;
 v_actor constant uuid := '77777777-7777-4777-8777-777777777777';
 v_event constant uuid := '22222222-2222-4222-8222-222222222222';
 v_booking constant uuid := '33333333-3333-4333-8333-333333333333';
 v_room constant uuid := '88888888-8888-4888-8888-888888888888';
 v_foreign_lodge constant uuid := '99999999-9999-4999-8999-999999999999';
 v_source constant uuid := '44444444-4444-4444-8444-444444444444';
 v_duplicate constant uuid := '55555555-5555-4555-8555-555555555555';
 v_customer constant uuid := '66666666-6666-4666-8666-666666666666';
 v_result jsonb;
 v_paid numeric;
 v_event_paid numeric;
 v_voided timestamptz;
 v_count integer;
 v_report_count integer;
 v_report_paid numeric;
 v_report_balance numeric;
 v_event_details jsonb;
 v_invoice record;
 v_blocked boolean;
begin
 select id into v_lodge from public.settings order by id limit 1;
 if v_lodge is null then raise exception 'Disposable fixture needs one settings row'; end if;
 insert into public.users(id,lodge_id,name,email,role,password_hash,status)
 values(v_actor,v_lodge,'Disposable Correction Test Actor','disposable-correction-test@example.invalid','manager','rollback-only-test-hash','active')
 on conflict(id) do nothing;
 insert into public.customers(id,lodge_id,name) values(v_customer,v_lodge,'Disposable Correction Test Guest') on conflict(id) do nothing;
 insert into public.rooms(id,lodge_id,room_number,room_type,rate_per_night,max_occupancy,status)
 values(v_room,v_lodge,'DISPOSABLE-VOID-TEST','room',500,2,'available') on conflict(id) do nothing;
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
 perform set_config('app.session_valid','true',true);
 perform set_config('app.lodge_id',v_lodge::text,true);
 perform set_config('app.session_role','manager',true);
 perform set_config('app.actor_id',v_actor::text,true);
 insert into public.conference_bookings(id,lodge_id,booking_date,start_time,end_time,client_name,event_type,reservation_scope,status,adults,children,subtotal,extras_total,charges_total,total_amount,amount_paid,balance_due,deposit_paid,payment_status,currency,updated_at,notes)
 values(v_event,v_lodge,current_date,time '10:00',time '11:00','Disposable Correction Test','conference','venue_with_rooms','reserved',0,0,0,0,0,0,2000,0,2000,'partial','BWP',now(),'Rollback test only')
 on conflict(id) do nothing;
 insert into public.bookings(id,lodge_id,room_id,customer_id,check_in,check_out,total_amount,amount_paid,charges_total,payment_status,status,notes,created_at,updated_at,source,vat_enabled,vat_rate,tents_count,vehicles_count)
 values(v_booking,v_lodge,v_room,v_customer,current_date,current_date+1,500,500,0,'paid','confirmed','[EVENT:'||v_event::text||'] synthetic disposable fixture',now(),now(),'direct',false,0,0,0)
 on conflict(id) do nothing;
 insert into public.payments(id,booking_id,lodge_id,amount,method,type,paid_at,recorded_by,idempotency_key,conference_booking_id)
 values(v_source,null,v_lodge,2000,'cash','deposit',now(),v_actor,'test:event-source:'||v_event::text,v_event),
       (v_duplicate,v_booking,v_lodge,500,'cash','payment',now(),v_actor,'test:room-duplicate:'||v_booking::text,null)
 on conflict(id) do nothing;
 -- Authorization must fail before either the operation key or ledger changes.
 perform set_config('app.session_role','receptionist',true);
 v_blocked := false;
 begin
   v_result := public.void_duplicate_event_payment(v_lodge,v_event,v_source,v_duplicate,500,'Synthetic duplicate receipt test','test:void:'||v_duplicate::text);
   v_blocked := coalesce((v_result->>'success')::boolean,false) is false;
 exception when insufficient_privilege then v_blocked := true;
 end;
 if not v_blocked then raise exception 'Receptionist role was allowed to void an event duplicate'; end if;
 perform set_config('app.session_role','manager',true);
 v_blocked := false;
 begin
   v_result := public.void_duplicate_event_payment(v_foreign_lodge,v_event,v_source,v_duplicate,500,'Synthetic duplicate receipt test','test:void:foreign:'||v_duplicate::text);
   v_blocked := coalesce((v_result->>'success')::boolean,false) is false;
 exception when insufficient_privilege then v_blocked := true;
 end;
 if not v_blocked then raise exception 'Actor without lodge membership was allowed to void an event duplicate'; end if;
 v_result := public.void_duplicate_event_payment(v_lodge,v_event,v_source,v_duplicate,500,'Synthetic duplicate receipt test','test:void:'||v_duplicate::text);
 if coalesce((v_result->>'success')::boolean,false) is not true or coalesce((v_result->>'cash_movement')::numeric,1) <> 0 then
   raise exception 'First correction rejected or moved cash: %',v_result;
 end if;
 v_result := public.void_duplicate_event_payment(v_lodge,v_event,v_source,v_duplicate,500,'Synthetic duplicate receipt test','test:void:'||v_duplicate::text);
 if coalesce((v_result->>'idempotent')::boolean,false) is not true then raise exception 'Exact correction retry was not idempotent: %',v_result; end if;
 v_result := public.void_duplicate_event_payment(v_lodge,v_event,v_source,v_duplicate,500,'Changed correction reason','test:void:'||v_duplicate::text);
 if coalesce((v_result->>'success')::boolean,true) is not false then raise exception 'Changed payload retry was accepted: %',v_result; end if;
 select amount_paid into v_paid from public.bookings where id=v_booking;
 select amount_paid into v_event_paid from public.conference_bookings where id=v_event;
 select voided_at into v_voided from public.payments where id=v_duplicate;
 select count(*) into v_count from public.financial_audit_log where event_booking_id=v_event and idempotency_key='test:void:'||v_duplicate::text;
 if v_paid<>0 or v_event_paid<>2000 or v_voided is null or v_count<>1 then
   raise exception 'Correction projection/audit mismatch: booking %, event %, voided %, audit %',v_paid,v_event_paid,v_voided,v_count;
 end if;
 if (select count(*) from public.payments where id in(v_source,v_duplicate))<>2
    or (select count(*) from public.payment_reporting_active where id in(v_source,v_duplicate))<>1 then
   raise exception 'Original receipt history or active reporting projection mismatch';
 end if;
 -- Execute the legacy event branch: its booking CTE exposes id, not booking_id.
 -- This also verifies the prior active-receipt filtering survives the correction.
 if not exists (
   select 1 from public.get_invoice_summary(v_lodge,v_event) s
    where s.event_booking_id=v_event and s.room_count=1
      and s.invoice_kind='event_unconsolidated'
      and s.payment_count=1 and s.amount_paid=2000
 ) then raise exception 'Legacy event invoice room count or active receipt summary mismatch'; end if;
 select count(*) into v_report_count from public.get_payment_transaction_report(v_lodge,current_date,current_date)
  where payment_id in(v_source,v_duplicate);
 if v_report_count<>1 then raise exception 'Payment transaction report row count for source and duplicate was %',v_report_count; end if;
 select amount_paid,balance_due into v_report_paid,v_report_balance
   from public.get_outstanding_balance_report(v_lodge,current_date,current_date)
  where booking_id=v_booking;
 if v_report_paid is distinct from 0::numeric or v_report_balance is distinct from 500::numeric then
   raise exception 'Outstanding balance report reintroduced the voided receipt: paid %, due %',v_report_paid,v_report_balance;
 end if;
 v_result := public.reschedule_booking(v_booking,v_lodge,v_room,current_date+10,current_date+11,'Void-aware recalc test','test:reschedule:'||v_booking::text,'reject',true,500,null,v_actor);
 if coalesce((v_result->>'success')::boolean,false) is not true then raise exception 'Reschedule after void failed: %',v_result; end if;
 select amount_paid into v_paid from public.bookings where id=v_booking;
 if v_paid<>0 then raise exception 'Reschedule reintroduced a voided receipt into amount_paid: %',v_paid; end if;
 if pg_get_functiondef('public.reschedule_booking(uuid,uuid,uuid,date,date,text,text,text,boolean,numeric,timestamp with time zone,uuid)'::regprocedure) ilike '%from public.payments%'
    or pg_get_functiondef('public.apply_customer_credit_to_booking(uuid,uuid,uuid,numeric,text,text,uuid,timestamp with time zone)'::regprocedure) ilike '%from public.payments%'
    or pg_get_functiondef('public.reverse_customer_credit_entry(uuid,uuid,text,text,uuid)'::regprocedure) ilike '%from public.payments%' then
   raise exception 'A booking recalculation routine still reads raw payment rows';
 end if;
 if (select count(*) from public.get_event_invoice_payments(v_lodge,v_event) where id in(v_source,v_duplicate) and (id=v_duplicate and voided_at is not null or id=v_source and voided_at is null))<>2 then
   raise exception 'Event payment ledger does not retain source and mark duplicate';
 end if;
 v_event_details := public.get_event_booking_details(v_event,v_lodge);
 if not exists(select 1 from jsonb_array_elements(coalesce(v_event_details->'payments','[]'::jsonb)) payment
                where payment->>'id'=v_source::text
                  and payment ? 'voided_as_duplicate_of') then
   raise exception 'Event detail payment JSON omits void history metadata';
 end if;
 v_result := public.repair_event_invoice_identity(v_lodge,v_event,true,v_customer);
 if coalesce((v_result->>'success')::boolean,false) is not true or coalesce((v_result->>'dry_run')::boolean,false) is not true then raise exception 'Identity repair dry run failed: %',v_result; end if;
 v_result := public.repair_event_invoice_identity(v_lodge,v_event,false,v_customer);
 if coalesce((v_result->>'success')::boolean,false) is not true or (v_result->>'receipt_count')::integer<>2 then raise exception 'Identity/group repair failed or changed receipt history: %',v_result; end if;
 if (select count(*) from public.booking_invoice_groups where event_booking_id=v_event and customer_id=v_customer)<>1
    or (select count(*) from public.booking_invoice_group_lines l join public.booking_invoice_groups g on g.id=l.group_id where g.event_booking_id=v_event and l.booking_id=v_booking)<>1
    or (select customer_id from public.conference_bookings where id=v_event) is distinct from v_customer
    or (select customer_id from public.bookings where id=v_booking) is distinct from v_customer then
   raise exception 'Identity or group membership projection did not persist';
 end if;
 select * into v_invoice from public.get_invoice_summary(v_lodge,v_event);
 if not found or v_invoice.invoice_kind<>'event' or not v_invoice.reconciliation_required or v_invoice.balance_due is not null then
   raise exception 'Zero-total event receipt was not withheld on the grouped invoice projection: %',row_to_json(v_invoice);
 end if;
 v_result := public.record_customer_credit(v_lodge,v_customer,100,'cash','test:credit-receipt:'||v_booking::text,'void-recalc-test','Synthetic disposable credit for void-aware recalc',v_actor);
 if coalesce((v_result->>'success')::boolean,false) is not true then raise exception 'Synthetic customer credit receipt failed: %',v_result; end if;
 v_result := public.apply_customer_credit_to_booking(v_lodge,v_customer,v_booking,100,'test:credit-apply:'||v_booking::text,'Void-aware recalc test',v_actor,null);
 if coalesce((v_result->>'success')::boolean,false) is not true then raise exception 'Customer-credit allocation after void failed: %',v_result; end if;
 select amount_paid into v_paid from public.bookings where id=v_booking;
 if v_paid<>100 then raise exception 'Customer-credit allocation reintroduced a voided receipt into amount_paid: %',v_paid; end if;
end $$;
rollback;`
const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({query:guardLodgeDisposableQuery(query)})});const b=await r.json().catch(()=>null);if(!r.ok)throw new Error(`Disposable SQL behavior test failed ${r.status}: ${(b?.message||'unknown').slice(0,800)}`);console.log('CASH_NEUTRAL_VOID_DB_TEST_PASS',JSON.stringify(b.result||b))
