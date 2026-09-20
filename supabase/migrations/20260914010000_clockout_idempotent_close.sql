-- Idempotent clock-out close: stale queued retries must not dead-letter.
--
-- Incident: Botswapelo Lounge 2026-09-14. Two attendance shifts were closed
-- by the operator with fresh keys (cash-up submitted, clock-out ok), while
-- older queued clock-outs with superseded idempotency keys retried. The
-- function raised 'Clock-out idempotency key was already used with a
-- different payload' because the stored key differed, even though the work
-- (shift completed) was already done. The queue dead-lettered instead of
-- converging, and the message reads as a failure.
--
-- Fix (forward-only, no DML, preserves grants): when the target shift is
-- already completed, return success/replayed without comparing keys. Key
-- mismatch still raises only while the shift is active (true conflict).

begin;

create or replace function public.clock_out_staff_with_attendance_pin(payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_lodge_id uuid:=nullif(payload->>'lodge_id','')::uuid;
  v_shift_id uuid:=nullif(payload->>'shift_id','')::uuid;
  v_pin text:=payload->>'pin';
  v_key text:=nullif(btrim(payload->>'idempotency_key'),'');
  v_hash text:=encode(digest(jsonb_build_object('lodge_id',v_lodge_id,'shift_id',v_shift_id,'notes',nullif(payload->>'notes',''),'idempotency_key',v_key)::text,'sha256'),'hex');
  v_shift public.restaurant_shifts%rowtype;
  v_result jsonb;
begin
  perform public.app_require_restaurant_lodge(v_lodge_id,array['admin','manager','supervisor']);
  select * into v_shift from public.restaurant_shifts where id=v_shift_id and lodge_id=v_lodge_id for update;
  if not found then return jsonb_build_object('success',false,'error','Attendance shift not found. Refresh and try again.'); end if;
  -- Already closed by a newer key (operator retried at the terminal): the
  -- requested work is done. Converge instead of dead-lettering on key text.
  if v_shift.status<>'active' then return jsonb_build_object('success',true,'shift_id',v_shift.id,'replayed',true,'already_closed',true); end if;
  if v_key is not null and v_shift.clock_out_idempotency_key is not null then
    if v_shift.clock_out_idempotency_key<>v_key or v_shift.clock_out_payload_hash is distinct from v_hash then
      raise exception 'Clock-out idempotency key was already used with a different payload' using errcode='23505';
    end if;
    return jsonb_build_object('success',true,'shift_id',v_shift.id,'replayed',true);
  end if;
  if not public._restaurant_validate_attendance_pin(v_lodge_id,v_shift.staff_user_id,v_pin,coalesce(payload->>'device_id','shared-terminal')) then return jsonb_build_object('success',false,'error','Incorrect staff PIN.'); end if;
  v_result:=public.clock_out_staff(jsonb_build_object('lodge_id',v_lodge_id,'shift_id',v_shift_id,'notes',payload->>'notes'));
  if coalesce((v_result->>'success')::boolean,false) and v_key is not null then
    update public.restaurant_shifts set clock_out_idempotency_key=v_key,clock_out_payload_hash=v_hash where id=v_shift_id and lodge_id=v_lodge_id;
  end if;
  return v_result||jsonb_build_object('replayed',false);
end
$$;

revoke all on function public.clock_out_staff_with_attendance_pin(jsonb) from public,anon,authenticated;
grant execute on function public.clock_out_staff_with_attendance_pin(jsonb) to authenticated,service_role;

commit;
