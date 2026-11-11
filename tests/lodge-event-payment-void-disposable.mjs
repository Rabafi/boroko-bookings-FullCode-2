// Disposable-only synthetic acceptance. The transaction ends with ROLLBACK.
import dotenv from 'dotenv'
dotenv.config({path:'.env.disposable.local',quiet:true})
const ref='repsrmlomedqrmrdsbga', token=process.env.SUPABASE_ACCESS_TOKEN
if(!token||process.env.LUNA_REMEDIATION_EXPECTED_PROJECT_REF!==ref||process.env.LUNA_REMEDIATION_EXPECTED_DATABASE!=='postgres'||process.env.LUNA_REMEDIATION_TARGET_MARKER!=='LUNA-REMEDIATION-DISPOSABLE-v1')throw new Error('Disposable target guard failed')
const query=`begin;
do $$
declare
 v_lodge uuid;
 v_actor constant uuid := '11111111-1111-4111-8111-111111111111';
 v_event constant uuid := '22222222-2222-4222-8222-222222222222';
 v_booking constant uuid := '33333333-3333-4333-8333-333333333333';
 v_source constant uuid := '44444444-4444-4444-8444-444444444444';
 v_duplicate constant uuid := '55555555-5555-4555-8555-555555555555';
 v_result jsonb;
 v_paid numeric;
 v_event_paid numeric;
 v_voided timestamptz;
 v_count integer;
 v_report_count integer;
begin
 select id into v_lodge from public.settings order by id limit 1;
 if v_lodge is null then raise exception 'Disposable fixture needs one settings row'; end if;
 perform set_config('request.jwt.claim.role','postgres',true);
 perform set_config('request.jwt.claims','{"role":"postgres"}',true);
 perform set_config('app.session_valid','true',true);
 perform set_config('app.session_role','manager',true);
 perform set_config('app.actor_id',v_actor::text,true);
 insert into public.conference_bookings(id,lodge_id,booking_date,start_time,end_time,client_name,event_type,reservation_scope,status,adults,children,subtotal,extras_total,charges_total,total_amount,amount_paid,balance_due,deposit_paid,payment_status,currency,updated_at,notes)
 values(v_event,v_lodge,current_date,time '10:00',time '11:00','Disposable Correction Test','conference','venue_with_rooms','reserved',0,0,0,0,0,0,2000,0,2000,'partial','BWP',now(),'Rollback test only')
 on conflict(id) do nothing;
 insert into public.bookings(id,lodge_id,room_id,check_in,check_out,total_amount,amount_paid,charges_total,payment_status,status,notes,created_at,updated_at,source,vat_enabled,vat_rate,tents_count,vehicles_count)
 values(v_booking,v_lodge,null,current_date,current_date+1,500,500,0,'paid','confirmed','[EVENT:'||v_event::text||'] synthetic disposable fixture',now(),now(),'direct',false,0,0,0)
 on conflict(id) do nothing;
 insert into public.payments(id,booking_id,lodge_id,amount,method,type,paid_at,recorded_by,idempotency_key,conference_booking_id)
 values(v_source,null,v_lodge,2000,'cash','deposit',now(),v_actor,'test:event-source:'||v_event::text,v_event),
       (v_duplicate,v_booking,v_lodge,500,'cash','payment',now(),v_actor,'test:room-duplicate:'||v_booking::text,null)
 on conflict(id) do nothing;
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
 select count(*) into v_report_count from public.get_payment_transaction_report(v_lodge,current_date,current_date)
  where payment_id in(v_source,v_duplicate);
 if v_report_count<>1 then raise exception 'Payment transaction report row count for source and duplicate was %',v_report_count; end if;
 if (select count(*) from public.get_event_invoice_payments(v_lodge,v_event) where id in(v_source,v_duplicate) and (id=v_duplicate and voided_at is not null or id=v_source and voided_at is null))<>2 then
   raise exception 'Event payment ledger does not retain source and mark duplicate';
 end if;
end $$;
rollback;`
const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({query})});const b=await r.json().catch(()=>null);if(!r.ok)throw new Error(`Disposable SQL behavior test failed ${r.status}: ${(b?.message||'unknown').slice(0,800)}`);console.log('CASH_NEUTRAL_VOID_DB_TEST_PASS',JSON.stringify(b.result||b))
