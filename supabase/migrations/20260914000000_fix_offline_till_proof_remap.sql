-- Fix offline Till replay FK violation + duplicate-open handling.
--
-- Incident: Botswapelo Lounge 2026-09-13/14 dead-lettered 6 ops. Two
-- `activate_shared_till_operator_offline` replays failed with:
--   update or delete on table "pos_shifts" violates foreign key constraint
--   "pos_till_operator_proofs_pos_shift_id_fkey" on table
--   "pos_till_operator_proofs".
--
-- Root cause: 20260816200000 created the offline wrapper, which replays by
-- calling the authoritative `activate_shared_till_operator` (fresh random
-- UUID) and then remapping `pos_shifts.id` to the queued client UUID.
-- 20260820180000 later added a synchronous child row in
-- `pos_till_operator_proofs(pos_shift_id REFERENCES pos_shifts ON DELETE
-- RESTRICT)` inside the inner activation. The wrapper still remapped only
-- `pos_shifts.id`, so the UPDATE failed on the child FK. The same wrapper
-- also remapped when the inner call returned a pre-existing open shift
-- (`open_pos_shift_with_id` returns `already_open` for the same
-- lodge/outlet/cashier instead of creating), which must never be remapped.
--
-- Fix (forward-only, no DML, preserves existing grants):
--   1. Fresh replay (create_idempotency_key matches): remap proofs first,
--      then the shift row.
--   2. Pre-existing open shift (key mismatch / duplicate unlock while open):
--      return the existing shift with already_open=true instead of remapping.
-- The dependent `create_pos_order_v3` then unblocks via the existing
-- dependency + current-open-shift reattribution path.

begin;

create or replace function public.activate_shared_till_operator_offline(payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_lodge uuid:=nullif(payload->>'lodge_id','')::uuid;
  v_requested uuid:=nullif(payload->>'pos_shift_id','')::uuid;
  v_key text:=nullif(btrim(coalesce(payload->>'idempotency_key','')),'');
  v_actual uuid;
  v_result jsonb;
  v_shift jsonb;
  v_actual_row public.pos_shifts%rowtype;
begin
  perform public.app_require_restaurant_lodge(v_lodge,array['admin','manager','supervisor']);
  if v_requested is null then return jsonb_build_object('success',false,'error','Offline Till identity is required.'); end if;
  if exists(select 1 from public.pos_shifts where id=v_requested and lodge_id=v_lodge) then
    select to_jsonb(s) into v_shift from public.pos_shifts s where s.id=v_requested and s.lodge_id=v_lodge;
    return jsonb_build_object('success',true,'shift',v_shift,'replayed',true);
  end if;
  v_result:=public.activate_shared_till_operator(payload-'pos_shift_id');
  if not coalesce((v_result->>'success')::boolean,false) then return v_result; end if;
  v_actual:=nullif(v_result->'shift'->>'id','')::uuid;
  if v_actual is null then return jsonb_build_object('success',false,'error','The Till shift could not be confirmed. Refresh Till and try again.'); end if;
  if v_actual = v_requested then
    select to_jsonb(s) into v_shift from public.pos_shifts s where s.id=v_requested and s.lodge_id=v_lodge;
    return v_result||jsonb_build_object('shift',v_shift,'offline_replay',true);
  end if;
  select * into v_actual_row from public.pos_shifts where id=v_actual and lodge_id=v_lodge;
  if not found then return jsonb_build_object('success',false,'error','The Till shift could not be confirmed. Refresh Till and try again.'); end if;
  -- Duplicate unlock while a Till is already open for this outlet/cashier:
  -- the inner call returned the pre-existing shift (different idempotency
  -- key). Never remap a shift with live dependents; return it instead so the
  -- desktop reattributes dependents to the current open shift.
  if v_actual_row.create_idempotency_key is distinct from v_key then
    select to_jsonb(s) into v_shift from public.pos_shifts s where s.id=v_actual and s.lodge_id=v_lodge;
    return jsonb_build_object('success',true,'shift',v_shift,'replayed',false,'already_open',true,'offline_replay',true,'remap_skipped',true);
  end if;
  -- Fresh replay: move the synchronously-created operator proof(s) first so
  -- the subsequent shift-id remap does not violate
  -- pos_till_operator_proofs_pos_shift_id_fkey.
  if to_regclass('public.pos_till_operator_proofs') is not null then
    update public.pos_till_operator_proofs set pos_shift_id=v_requested where pos_shift_id=v_actual and lodge_id=v_lodge;
  end if;
  update public.pos_shifts set id=v_requested where id=v_actual and lodge_id=v_lodge;
  if not found then return jsonb_build_object('success',false,'error','The Till shift could not be linked to attendance. Do not take payments; refresh and try again.'); end if;
  select to_jsonb(s) into v_shift from public.pos_shifts s where s.id=v_requested and s.lodge_id=v_lodge;
  return v_result||jsonb_build_object('shift',v_shift,'offline_replay',true);
end
$$;

revoke all on function public.activate_shared_till_operator_offline(jsonb) from public;
grant execute on function public.activate_shared_till_operator_offline(jsonb) to anon, authenticated, service_role;

commit;
