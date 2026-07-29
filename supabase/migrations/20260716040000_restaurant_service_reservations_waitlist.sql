-- Waiters need a bounded, auditable front-of-house workflow.  This is not a
-- table-setup or financial permission: it only supports live guest flow.

create table if not exists public.restaurant_service_events (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  reservation_id uuid references public.restaurant_reservations(id) on delete cascade,
  waitlist_entry_id uuid references public.restaurant_waitlist_entries(id) on delete cascade,
  action text not null,
  before_state jsonb,
  after_state jsonb,
  reason text,
  actor_id uuid,
  created_at timestamptz not null default now(),
  check ((reservation_id is not null) <> (waitlist_entry_id is not null))
);
alter table public.restaurant_service_events enable row level security;
create policy "restaurant_service_events_lodge_isolation" on public.restaurant_service_events
  for all using (lodge_id = (current_setting('request.jwt.claims', true)::jsonb->>'lodge_id')::uuid);

create or replace function public.update_restaurant_waitlist_entry(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid; v_before jsonb; v_after jsonb; v_actor uuid;
begin
  perform public.app_require_restaurant_lodge(v_lodge_id, array['cashier','supervisor','manager','admin']);
  v_actor := public.app_current_user_id();
  select to_jsonb(w.*) into v_before from public.restaurant_waitlist_entries w where w.id = (payload->>'id')::uuid and w.lodge_id = v_lodge_id for update;
  if v_before is null then raise exception 'Waitlist entry not found.' using errcode = 'P0002'; end if;
  if v_before->>'status' not in ('waiting','notified') then raise exception 'Only an active waitlist entry can be edited.' using errcode = '23514'; end if;
  if coalesce(nullif(trim(payload->>'customer_name'), ''), v_before->>'customer_name') is null then raise exception 'Guest name is required.' using errcode = '22023'; end if;
  if payload ? 'party_size' and coalesce((payload->>'party_size')::integer, 0) < 1 then raise exception 'Party size must be at least one.' using errcode = '22023'; end if;
  update public.restaurant_waitlist_entries set
    customer_name = coalesce(nullif(trim(payload->>'customer_name'), ''), customer_name), customer_phone = coalesce(payload->>'customer_phone', customer_phone),
    party_size = coalesce((payload->>'party_size')::integer, party_size), quoted_wait_minutes = coalesce((payload->>'quoted_wait_minutes')::integer, quoted_wait_minutes),
    notes = coalesce(payload->>'notes', notes), updated_at = now()
  where id = (payload->>'id')::uuid and lodge_id = v_lodge_id returning to_jsonb(restaurant_waitlist_entries.*) into v_after;
  insert into public.restaurant_service_events (lodge_id, waitlist_entry_id, action, before_state, after_state, actor_id) values (v_lodge_id, (payload->>'id')::uuid, 'waitlist_edited', v_before, v_after, v_actor);
  return jsonb_build_object('success', true, 'entry', v_after);
end; $$;

create or replace function public.remove_restaurant_waitlist_entry(p_id uuid, p_lodge_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_before jsonb; v_after jsonb; v_actor uuid;
begin
  perform public.app_require_restaurant_lodge(p_lodge_id, array['cashier','supervisor','manager','admin']);
  if nullif(trim(p_reason), '') is null then raise exception 'State why the guest left the waitlist.' using errcode = '22023'; end if;
  v_actor := public.app_current_user_id();
  select to_jsonb(w.*) into v_before from public.restaurant_waitlist_entries w where w.id = p_id and w.lodge_id = p_lodge_id for update;
  if v_before is null or v_before->>'status' not in ('waiting','notified') then raise exception 'Only an active waitlist entry can be removed.' using errcode = '23514'; end if;
  update public.restaurant_waitlist_entries set status = 'cancelled', notes = concat_ws(E'\n', notes, 'Removed: ' || trim(p_reason)), updated_at = now() where id = p_id and lodge_id = p_lodge_id returning to_jsonb(restaurant_waitlist_entries.*) into v_after;
  insert into public.restaurant_service_events (lodge_id, waitlist_entry_id, action, before_state, after_state, reason, actor_id) values (p_lodge_id, p_id, 'waitlist_removed', v_before, v_after, trim(p_reason), v_actor);
  return jsonb_build_object('success', true, 'entry', v_after);
end; $$;

create or replace function public.seat_restaurant_waitlist_entry(p_id uuid, p_lodge_id uuid, p_table_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_before jsonb; v_after jsonb; v_actor uuid;
begin
  perform public.app_require_restaurant_lodge(p_lodge_id, array['cashier','supervisor','manager','admin']);
  v_actor := public.app_current_user_id();
  if not exists (select 1 from public.pos_tables where id = p_table_id and lodge_id = p_lodge_id and active = true) then raise exception 'Choose an active table in this restaurant.' using errcode = '42501'; end if;
  select to_jsonb(w.*) into v_before from public.restaurant_waitlist_entries w where w.id = p_id and w.lodge_id = p_lodge_id for update;
  if v_before is null or v_before->>'status' not in ('waiting','notified') then raise exception 'Only an active waitlist entry can be seated.' using errcode = '23514'; end if;
  update public.restaurant_waitlist_entries set status = 'seated', assigned_table_id = p_table_id, updated_at = now() where id = p_id and lodge_id = p_lodge_id returning to_jsonb(restaurant_waitlist_entries.*) into v_after;
  insert into public.restaurant_service_events (lodge_id, waitlist_entry_id, action, before_state, after_state, actor_id) values (p_lodge_id, p_id, 'waitlist_seated', v_before, v_after, v_actor);
  return jsonb_build_object('success', true, 'entry', v_after);
end; $$;

create or replace function public.service_restaurant_reservation_action(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid; v_id uuid := nullif(payload->>'id', '')::uuid; v_action text := payload->>'action'; v_before jsonb; v_after jsonb; v_actor uuid; v_table_id uuid;
begin
  perform public.app_require_restaurant_lodge(v_lodge_id, array['cashier','supervisor','manager','admin']);
  if v_action not in ('confirmed','no_show','seated') then raise exception 'This reservation action is not available during service.' using errcode = '42501'; end if;
  v_actor := public.app_current_user_id();
  select to_jsonb(r.*) into v_before from public.restaurant_reservations r where r.id = v_id and r.lodge_id = v_lodge_id for update;
  if v_before is null or v_before->>'status' in ('cancelled','completed','no_show') then raise exception 'This reservation can no longer be changed.' using errcode = '23514'; end if;
  if v_action = 'seated' then
    v_table_id := nullif(payload->'table_ids'->>0, '')::uuid;
    if v_table_id is null or not exists (select 1 from public.pos_tables where id = v_table_id and lodge_id = v_lodge_id and active = true) then raise exception 'Choose an active table before seating the party.' using errcode = '22023'; end if;
  end if;
  update public.restaurant_reservations set status = v_action, assigned_table_id = case when v_action = 'seated' then v_table_id else assigned_table_id end, updated_by = v_actor, updated_at = now() where id = v_id and lodge_id = v_lodge_id returning to_jsonb(restaurant_reservations.*) into v_after;
  insert into public.restaurant_service_events (lodge_id, reservation_id, action, before_state, after_state, actor_id) values (v_lodge_id, v_id, 'reservation_' || v_action, v_before, v_after, v_actor);
  return jsonb_build_object('success', true, 'reservation', v_after);
end; $$;

revoke all on function public.update_restaurant_waitlist_entry(jsonb) from public;
grant execute on function public.update_restaurant_waitlist_entry(jsonb) to authenticated, service_role;
revoke all on function public.remove_restaurant_waitlist_entry(uuid, uuid, text) from public;
grant execute on function public.remove_restaurant_waitlist_entry(uuid, uuid, text) to authenticated, service_role;
revoke all on function public.seat_restaurant_waitlist_entry(uuid, uuid, uuid) from public;
grant execute on function public.seat_restaurant_waitlist_entry(uuid, uuid, uuid) to authenticated, service_role;
revoke all on function public.service_restaurant_reservation_action(jsonb) from public;
grant execute on function public.service_restaurant_reservation_action(jsonb) to authenticated, service_role;
