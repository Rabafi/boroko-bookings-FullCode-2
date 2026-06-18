begin;

create or replace function public.app_reconcile_room_maintenance_status(p_lodge_id uuid, p_room_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
begin
  if p_room_id is null then return null; end if;

  if exists (
    select 1 from public.maintenance_tickets mt
    where mt.lodge_id = p_lodge_id and mt.room_id = p_room_id and mt.status <> 'resolved'
  ) then
    v_status := 'maintenance';
  elsif exists (
    select 1 from public.bookings b
    where b.lodge_id = p_lodge_id and b.room_id = p_room_id and b.status = 'checked_in'
  ) then
    v_status := 'occupied';
  else
    v_status := 'available';
  end if;

  update public.rooms
  set status = v_status, updated_at = now()
  where id = p_room_id and lodge_id = p_lodge_id and status is distinct from v_status;

  return v_status;
end;
$$;

create or replace function public.sync_room_maintenance_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.room_id is not null then
    perform public.app_reconcile_room_maintenance_status(old.lodge_id, old.room_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.room_id is not null then
    perform public.app_reconcile_room_maintenance_status(new.lodge_id, new.room_id);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists maintenance_room_status_sync on public.maintenance_tickets;
create trigger maintenance_room_status_sync
after insert or delete or update of status, room_id, lodge_id on public.maintenance_tickets
for each row execute function public.sync_room_maintenance_status();

revoke all on function public.app_reconcile_room_maintenance_status(uuid, uuid) from public;
revoke all on function public.sync_room_maintenance_status() from public;

create or replace function public.create_maintenance_ticket(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  if exists (
    select 1
    from public.maintenance_tickets mt
    where mt.id = v_id and mt.lodge_id = v_lodge_id
  ) then
    return jsonb_build_object('success', true, 'id', v_id, 'idempotent', true);
  end if;

  insert into public.maintenance_tickets (
    id, lodge_id, room_id, title, description, priority, status, reported_date,
    notes, labour_cost, parts_cost, total_cost, vendor_name, cost_notes
  ) values (
    v_id,
    v_lodge_id,
    nullif(payload->>'room_id', '')::uuid,
    coalesce(nullif(payload->>'title', ''), nullif(payload->>'issue', ''), 'Maintenance ticket'),
    coalesce(payload->>'description', ''),
    coalesce(nullif(payload->>'priority', ''), 'medium'),
    coalesce(nullif(payload->>'status', ''), 'open'),
    coalesce(nullif(payload->>'reported_date', '')::date, current_date),
    coalesce(payload->>'notes', payload->>'description', ''),
    coalesce(nullif(payload->>'labour_cost', '')::numeric, 0),
    coalesce(nullif(payload->>'parts_cost', '')::numeric, 0),
    coalesce(nullif(payload->>'total_cost', '')::numeric, 0),
    nullif(payload->>'vendor_name', ''),
    nullif(payload->>'cost_notes', '')
  );

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

create or replace function public.create_room(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_status text := coalesce(nullif(payload->>'status', ''), 'available');
  v_ticket_id uuid := coalesce(nullif(payload->>'maintenance_ticket_id', '')::uuid, gen_random_uuid());
  v_issue text := coalesce(nullif(btrim(payload->>'maintenance_issue'), ''), 'Room created under maintenance');
  v_existing boolean;
begin
  select exists (
    select 1 from public.rooms r where r.id = v_id and r.lodge_id = v_lodge_id
  ) into v_existing;

  if not v_existing then
    insert into public.rooms (
      id, lodge_id, room_number, room_type, rate_per_night, max_occupancy,
      status, description, photo, photos, amenities, updated_at
    ) values (
      v_id, v_lodge_id, payload->>'room_number', payload->>'room_type',
      coalesce((payload->>'rate_per_night')::numeric, 0),
      coalesce((payload->>'max_occupancy')::integer, 2),
      v_status, coalesce(payload->>'description', ''), coalesce(payload->>'photo', ''),
      coalesce(
        (select array_agg(x) from jsonb_array_elements_text(payload->'photos') x),
        case when payload->>'photo' is not null and payload->>'photo' <> ''
          then array[payload->>'photo'] else '{}'::text[] end
      ),
      coalesce(
        (select array_agg(x) from jsonb_array_elements_text(payload->'amenities') x),
        '{}'::text[]
      ),
      now()
    );
  end if;

  if v_status = 'maintenance' and not exists (
    select 1 from public.maintenance_tickets mt
    where mt.lodge_id = v_lodge_id and mt.room_id = v_id and mt.status <> 'resolved'
  ) then
    insert into public.maintenance_tickets (
      id, lodge_id, room_id, title, description, priority, status,
      reported_date, notes, labour_cost, parts_cost, total_cost
    ) values (
      v_ticket_id, v_lodge_id, v_id, v_issue,
      coalesce(payload->>'maintenance_description', ''),
      coalesce(nullif(payload->>'maintenance_priority', ''), 'medium'),
      'open', current_date, coalesce(payload->>'maintenance_description', ''), 0, 0, 0
    )
    on conflict (id) do nothing;
  end if;

  return jsonb_build_object(
    'success', true, 'id', v_id,
    'maintenance_ticket_id', case when v_status = 'maintenance' then v_ticket_id else null end,
    'idempotent', v_existing
  );
end;
$$;

drop function if exists public.update_room(uuid, uuid, jsonb);
drop function if exists public.update_room(uuid, uuid, jsonb, timestamptz);

create function public.update_room(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_current public.rooms%rowtype;
  v_status text;
  v_ticket_id uuid := coalesce(nullif(payload->>'maintenance_ticket_id', '')::uuid, gen_random_uuid());
  v_issue text := coalesce(nullif(btrim(payload->>'maintenance_issue'), ''), 'Room marked under maintenance');
begin
  select * into v_current
  from public.rooms r
  where r.id = p_id and r.lodge_id = p_lodge_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;
  if p_expected_updated_at is not null and v_current.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object(
      'success', false, 'error', 'conflict', 'conflict', true,
      'message', 'This record was updated on another device. Refresh and reapply your change.'
    );
  end if;

  v_status := case
    when payload ? 'status' then coalesce(nullif(payload->>'status', ''), 'available')
    else v_current.status
  end;

  if v_status <> 'maintenance' and exists (
    select 1 from public.maintenance_tickets mt
    where mt.lodge_id = p_lodge_id and mt.room_id = p_id and mt.status <> 'resolved'
  ) then
    return jsonb_build_object(
      'success', false,
      'error', 'Resolve the open maintenance ticket before changing this room status.'
    );
  end if;

  update public.rooms
  set room_number = case when payload ? 'room_number' then payload->>'room_number' else room_number end,
      room_type = case when payload ? 'room_type' then payload->>'room_type' else room_type end,
      rate_per_night = case when payload ? 'rate_per_night' then coalesce((payload->>'rate_per_night')::numeric, 0) else rate_per_night end,
      max_occupancy = case when payload ? 'max_occupancy' then coalesce((payload->>'max_occupancy')::integer, 2) else max_occupancy end,
      status = v_status,
      description = case when payload ? 'description' then coalesce(payload->>'description', '') else description end,
      photo = case when payload ? 'photo' then coalesce(payload->>'photo', '') else photo end,
      photos = case when payload ? 'photos' then coalesce(
        (select array_agg(x) from jsonb_array_elements_text(payload->'photos') x), '{}'::text[]
      ) else photos end,
      amenities = case when payload ? 'amenities' then coalesce(
        (select array_agg(x) from jsonb_array_elements_text(payload->'amenities') x), '{}'::text[]
      ) else amenities end,
      updated_at = now()
  where id = p_id and lodge_id = p_lodge_id;

  if v_status = 'maintenance' and not exists (
    select 1 from public.maintenance_tickets mt
    where mt.lodge_id = p_lodge_id and mt.room_id = p_id and mt.status <> 'resolved'
  ) then
    insert into public.maintenance_tickets (
      id, lodge_id, room_id, title, description, priority, status,
      reported_date, notes, labour_cost, parts_cost, total_cost
    ) values (
      v_ticket_id, p_lodge_id, p_id, v_issue,
      coalesce(payload->>'maintenance_description', ''),
      coalesce(nullif(payload->>'maintenance_priority', ''), 'medium'),
      'open', current_date, coalesce(payload->>'maintenance_description', ''), 0, 0, 0
    )
    on conflict (id) do nothing;
  end if;

  return jsonb_build_object(
    'success', true, 'id', p_id,
    'maintenance_ticket_id', case when v_status = 'maintenance' then v_ticket_id else null end
  );
end;
$$;

create or replace function public.set_room_status(p_id uuid, p_lodge_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_updated uuid;
begin
  if p_status = 'maintenance' and not exists (
    select 1 from public.maintenance_tickets mt
    where mt.lodge_id = p_lodge_id and mt.room_id = p_id and mt.status <> 'resolved'
  ) then
    insert into public.maintenance_tickets (
      lodge_id, room_id, title, description, priority, status,
      reported_date, notes, labour_cost, parts_cost, total_cost
    ) values (
      p_lodge_id, p_id, 'Room marked under maintenance', '', 'medium', 'open',
      current_date, 'Created automatically from a room status change.', 0, 0, 0
    );
  end if;

  if p_status <> 'maintenance' and exists (
    select 1 from public.maintenance_tickets mt
    where mt.lodge_id = p_lodge_id and mt.room_id = p_id and mt.status <> 'resolved'
  ) then
    return jsonb_build_object(
      'success', false,
      'error', 'Resolve the open maintenance ticket before changing this room status.'
    );
  end if;

  update public.rooms
  set status = p_status, updated_at = now()
  where id = p_id and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;
  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;

revoke all on function public.create_room(jsonb) from public;
revoke all on function public.create_maintenance_ticket(jsonb) from public;
revoke all on function public.update_room(uuid, uuid, jsonb, timestamptz) from public;
revoke all on function public.set_room_status(uuid, uuid, text) from public;
grant execute on function public.create_room(jsonb) to anon, authenticated, service_role;
grant execute on function public.create_maintenance_ticket(jsonb) to anon, authenticated, service_role;
grant execute on function public.update_room(uuid, uuid, jsonb, timestamptz) to anon, authenticated, service_role;
grant execute on function public.set_room_status(uuid, uuid, text) to anon, authenticated, service_role;

insert into public.maintenance_tickets (
  lodge_id, room_id, title, description, priority, status,
  reported_date, notes, labour_cost, parts_cost, total_cost
)
select
  r.lodge_id, r.id, 'Room marked under maintenance', '', 'medium', 'open',
  current_date, 'Automatically created to repair a missing maintenance record.', 0, 0, 0
from public.rooms r
where r.status = 'maintenance'
  and not exists (
    select 1 from public.maintenance_tickets mt
    where mt.lodge_id = r.lodge_id and mt.room_id = r.id and mt.status <> 'resolved'
  );

notify pgrst, 'reload schema';
commit;
