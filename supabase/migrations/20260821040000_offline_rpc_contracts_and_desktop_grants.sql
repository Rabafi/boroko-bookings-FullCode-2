-- Forward repair for the desktop application-session offline contracts.
--
-- The desktop calls Supabase with the anon role plus its signed
-- x-boroko-session context.  These wrappers keep the existing authoritative
-- business functions and add the missing stable-operation/payload contract;
-- they do not grant the underlying non-idempotent writers to anon.

begin;

-- Clock-out already has these columns for the PIN-protected attendance path.
-- Reuse the same proof columns so a plain My Shift/My Cash-up clock-out and a
-- PIN clock-out cannot produce two independent completions.
alter table public.restaurant_shifts
  add column if not exists clock_out_idempotency_key text,
  add column if not exists clock_out_payload_hash text;

create unique index if not exists restaurant_shifts_clock_out_operation_uidx
  on public.restaurant_shifts(lodge_id, clock_out_idempotency_key)
  where clock_out_idempotency_key is not null;

-- Plain attendance clock-out.  The delegated writer retains its lodge,
-- active-shift, actor/manager-role, open-Till and submitted-cash-up guards.
-- This wrapper adds an operation key, payload-hash conflict protection,
-- serializes retries, and records a financial audit event for the completed
-- attendance transition.
create or replace function public.clock_out_staff_offline(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_shift_id uuid := nullif(payload->>'shift_id', '')::uuid;
  v_key text := nullif(btrim(coalesce(payload->>'idempotency_key', payload->>'operation_key', '')), '');
  v_notes text := nullif(btrim(coalesce(payload->>'notes', '')), '');
  v_actor uuid := public.app_current_user_id();
  v_hash text;
  v_shift public.restaurant_shifts%rowtype;
  v_existing public.restaurant_shifts%rowtype;
  v_result jsonb;
begin
  perform public.app_require_restaurant_lodge(
    v_lodge_id,
    array['cashier','supervisor','manager','admin','super_admin']
  );
  if v_lodge_id is null or v_shift_id is null or v_key is null
     or length(v_key) < 8 or length(v_key) > 128 then
    return jsonb_build_object(
      'success', false,
      'error', 'lodge_id, shift_id and a stable clock-out retry key are required.'
    );
  end if;
  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'Your staff session could not be verified. Sign in again before clocking out.');
  end if;

  v_hash := encode(digest(jsonb_build_object(
    'lodge_id', v_lodge_id,
    'shift_id', v_shift_id,
    'notes', v_notes,
    'idempotency_key', v_key,
    'actor_id', v_actor
  )::text, 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(v_lodge_id::text || ':' || v_key, 0));

  -- Check the operation globally first so a key cannot be reused for another
  -- attendance shift, including after the original shift was completed.
  select * into v_existing
    from public.restaurant_shifts
   where lodge_id = v_lodge_id
     and clock_out_idempotency_key = v_key
   for update;
  if found then
    if v_existing.id <> v_shift_id or v_existing.clock_out_payload_hash is distinct from v_hash then
      raise exception 'Clock-out idempotency key was already used with a different payload' using errcode = '23505';
    end if;
    return jsonb_build_object('success', true, 'shift_id', v_shift_id, 'replayed', true);
  end if;

  select * into v_shift
    from public.restaurant_shifts
   where id = v_shift_id
     and lodge_id = v_lodge_id
   for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Attendance shift not found. Refresh and try again.');
  end if;
  if v_shift.clock_out_idempotency_key is not null then
    if v_shift.clock_out_idempotency_key <> v_key
       or v_shift.clock_out_payload_hash is distinct from v_hash then
      raise exception 'This attendance shift was already clocked out with a different payload' using errcode = '23505';
    end if;
    return jsonb_build_object('success', true, 'shift_id', v_shift_id, 'replayed', true);
  end if;
  if v_shift.status <> 'active' then
    return jsonb_build_object('success', false, 'error', 'This attendance shift is already closed and has no replay proof. Refresh the list.');
  end if;

  -- This is the existing authoritative guard set: target actor ownership or
  -- manager override, open Till/cash-up reconciliation, and atomic close.
  v_result := public.clock_out_staff(jsonb_build_object(
    'lodge_id', v_lodge_id,
    'shift_id', v_shift_id,
    'notes', v_notes
  ));
  if not coalesce((v_result->>'success')::boolean, false) then
    return v_result;
  end if;

  update public.restaurant_shifts
     set clock_out_idempotency_key = v_key,
         clock_out_payload_hash = v_hash
   where id = v_shift_id
     and lodge_id = v_lodge_id;

  perform public.log_restaurant_financial_action(
    v_lodge_id,
    'attendance.clocked_out',
    'restaurant_shift',
    v_shift_id,
    to_jsonb(v_shift),
    jsonb_build_object(
      'shift_id', v_shift_id,
      'clock_out_idempotency_key', v_key,
      'clock_out_payload_hash', v_hash,
      'clocked_out_by', v_actor,
      'notes', v_notes
    ),
    jsonb_build_object('offline_replay_contract', true)
  );

  return v_result || jsonb_build_object('success', true);
end;
$$;

-- Offline menu update.  The wrapper adds stable replay protection while the
-- reviewed online update RPC remains app-session guarded and is granted only
-- for that direct desktop administration path.
create or replace function public.update_pos_menu_item_offline(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_menu_item_id uuid := nullif(coalesce(payload->>'menu_item_id', payload->>'id'), '')::uuid;
  v_key text := nullif(btrim(coalesce(payload->>'operation_key', payload->>'idempotency_key', '')), '');
  v_hash text := encode(digest(payload::text, 'sha256'), 'hex');
  v_existing public.restaurant_catalog_operations%rowtype;
  v_result jsonb;
  v_actor uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager','admin','super_admin']);
  if v_lodge_id is null or v_menu_item_id is null or v_key is null
     or length(v_key) < 8 or length(v_key) > 128 then
    return jsonb_build_object('success', false, 'error', 'lodge_id, menu_item_id and a stable menu update retry key are required.');
  end if;
  v_actor := public.app_current_user_id();
  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'Your staff session could not be verified. Sign in again before updating the menu.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('pos-menu-update:' || v_lodge_id::text || ':' || v_key, 0));
  select * into v_existing
    from public.restaurant_catalog_operations
   where lodge_id = v_lodge_id
     and operation_key = v_key
   for update;
  if found then
    if v_existing.payload_hash is distinct from v_hash then
      raise exception 'Menu update operation key was already used with a different payload' using errcode = '23505';
    end if;
    return v_existing.result || jsonb_build_object('replayed', true);
  end if;

  v_result := public.update_pos_menu_item(
    v_menu_item_id,
    v_lodge_id,
    payload - 'lodge_id' - 'menu_item_id' - 'id' - 'operation_key' - 'idempotency_key'
  );
  if not coalesce((v_result->>'success')::boolean, false) then
    return v_result;
  end if;
  v_result := coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'success', true,
    'menu_item_id', v_menu_item_id,
    'operation_key', v_key,
    'offline_replay', true,
    'replayed', false
  );
  insert into public.restaurant_catalog_operations(
    lodge_id, operation_key, payload_hash, result, created_by
  ) values (
    v_lodge_id, v_key, v_hash, v_result, v_actor
  );
  perform public.log_restaurant_financial_action(
    v_lodge_id,
    'pos_menu_item.updated',
    'pos_menu_items',
    v_menu_item_id,
    null,
    v_result,
    jsonb_build_object('operation_key', v_key, 'payload_hash', v_hash, 'offline_replay_contract', true)
  );
  return v_result;
end;
$$;

-- Explicit least-privilege desktop-session grants.  Each listed function is
-- SECURITY DEFINER and performs its own lodge/session/role/outlet/identity
-- checks; the private implementation helpers remain ungranted.
revoke all on function public.clock_out_staff_offline(jsonb), public.update_pos_menu_item_offline(jsonb) from public;
grant execute on function public.clock_out_staff_offline(jsonb), public.update_pos_menu_item_offline(jsonb) to anon, authenticated, service_role;

revoke all on function public.activate_shared_till_operator(jsonb), public.link_my_pos_shift_to_attendance(jsonb) from public;
grant execute on function public.activate_shared_till_operator(jsonb), public.link_my_pos_shift_to_attendance(jsonb) to anon, authenticated, service_role;

revoke all on function public.get_staff_open_pos_shift(uuid,uuid), public.clock_in_staff(jsonb) from public;
grant execute on function public.get_staff_open_pos_shift(uuid,uuid), public.clock_in_staff(jsonb) to anon, authenticated, service_role;

-- Online menu administration still calls the reviewed authoritative writers.
-- Offline updates use the idempotent wrapper above; the direct update writer is
-- granted only for that explicitly online path and is never used by replay.
revoke all on function public.create_pos_menu_item(jsonb), public.update_pos_menu_item(uuid,uuid,jsonb) from public;
grant execute on function public.create_pos_menu_item(jsonb), public.update_pos_menu_item(uuid,uuid,jsonb) to anon, authenticated, service_role;

-- The base clock-out writer is an owner-only delegate for the two wrappers
-- (including the PIN-protected path).  No desktop, browser, or Legacy POS
-- caller invokes it directly, so never expose its non-idempotent contract to
-- an app session.
revoke all on function public.clock_out_staff(jsonb) from public, anon, authenticated;
grant execute on function public.clock_out_staff(jsonb) to service_role;

revoke all on function public.submit_pos_shift_cashup(jsonb), public.submit_pos_shift_cashup_with_attendance_pin(jsonb), public.review_pos_cashup_submission(jsonb) from public;
grant execute on function public.submit_pos_shift_cashup(jsonb), public.submit_pos_shift_cashup_with_attendance_pin(jsonb), public.review_pos_cashup_submission(jsonb) to anon, authenticated, service_role;

revoke all on function public.get_my_pos_cashup_submission(uuid,uuid), public.get_pos_shift_close_resolution(uuid,uuid,text) from public;
grant execute on function public.get_my_pos_cashup_submission(uuid,uuid), public.get_pos_shift_close_resolution(uuid,uuid,text) to anon, authenticated, service_role;

revoke all on function public.split_pos_tab_evenly(jsonb) from public;
grant execute on function public.split_pos_tab_evenly(jsonb) to anon, authenticated, service_role;

revoke all on function public.get_restaurant_setup_progress(uuid), public.set_restaurant_setup_stage(jsonb), public.record_restaurant_setup_evidence(jsonb) from public;
grant execute on function public.get_restaurant_setup_progress(uuid), public.set_restaurant_setup_stage(jsonb), public.record_restaurant_setup_evidence(jsonb) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
