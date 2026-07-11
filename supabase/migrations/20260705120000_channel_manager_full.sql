-- Channel Manager: mappings, config, reservation imports, and sync processing.
-- Extends enterprise_channel_sync_items with full channel management tables.

-- ── 1. Channel Mappings ───────────────────────────────────────────────────────
create table if not exists public.channel_mappings (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  channel_key text not null,
  source_type text not null check (source_type in ('room_type', 'rate_plan')),
  local_id uuid not null,
  channel_code text,
  channel_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lodge_id, channel_key, source_type, local_id)
);

alter table public.channel_mappings enable row level security;

create policy channel_mappings_lodge_policy on public.channel_mappings
  using (public.app_lodge_access(lodge_id));

grant select on public.channel_mappings to authenticated, anon;
revoke insert, update, delete on public.channel_mappings from authenticated, anon;

create index if not exists channel_mappings_lodge_idx on public.channel_mappings (lodge_id, channel_key);

-- ── 2. Channel Config ─────────────────────────────────────────────────────────
create table if not exists public.channel_config (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  channel_key text not null,
  channel_label text,
  enabled boolean not null default true,
  sync_availability boolean not null default true,
  sync_rates boolean not null default false,
  import_reservations boolean not null default false,
  credentials jsonb default '{}'::jsonb,
  settings jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lodge_id, channel_key)
);

alter table public.channel_config enable row level security;

create policy channel_config_lodge_policy on public.channel_config
  using (public.app_lodge_access(lodge_id));

grant select on public.channel_config to authenticated, anon;
revoke insert, update, delete on public.channel_config from authenticated, anon;

create index if not exists channel_config_lodge_idx on public.channel_config (lodge_id, enabled);

-- ── 3. Channel Reservation Imports ────────────────────────────────────────────
create table if not exists public.channel_reservation_imports (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  channel_key text not null,
  channel_reservation_id text not null,
  imported_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'confirmed', 'rejected', 'duplicate')),
  guest_name text,
  check_in date,
  check_out date,
  room_type_channel_code text,
  rate_amount numeric(12,2),
  notes text,
  payload jsonb default '{}'::jsonb,
  unique (lodge_id, channel_key, channel_reservation_id)
);

alter table public.channel_reservation_imports enable row level security;

create policy channel_reservation_imports_lodge_policy on public.channel_reservation_imports
  using (public.app_lodge_access(lodge_id));

grant select on public.channel_reservation_imports to authenticated, anon;
revoke insert, update, delete on public.channel_reservation_imports from authenticated, anon;

create index if not exists channel_reservation_imports_lodge_status_idx on public.channel_reservation_imports (lodge_id, status);

-- ── 4. RPCs ───────────────────────────────────────────────────────────────────

-- Create channel mapping
create or replace function public.create_channel_mapping(
  p_lodge_id uuid,
  p_channel_key text,
  p_source_type text,
  p_local_id uuid,
  p_channel_code text default null,
  p_channel_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  insert into public.channel_mappings (lodge_id, channel_key, source_type, local_id, channel_code, channel_name)
  values (p_lodge_id, p_channel_key, p_source_type, p_local_id, p_channel_code, p_channel_name)
  on conflict (lodge_id, channel_key, source_type, local_id)
  do update set channel_code = excluded.channel_code, channel_name = excluded.channel_name, updated_at = now()
  returning id into v_id;

  return jsonb_build_object('success', true, 'mapping_id', v_id);
end;
$$;

grant execute on function public.create_channel_mapping(uuid, text, text, uuid, text, text) to authenticated;

-- Update channel mapping
create or replace function public.update_channel_mapping(
  p_lodge_id uuid,
  p_mapping_id uuid,
  p_channel_code text default null,
  p_channel_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  update public.channel_mappings
  set channel_code = coalesce(p_channel_code, channel_code),
      channel_name = coalesce(p_channel_name, channel_name),
      updated_at = now()
  where id = p_mapping_id and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Mapping not found');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.update_channel_mapping(uuid, uuid, text, text) to authenticated;

-- Delete channel mapping
create or replace function public.delete_channel_mapping(
  p_lodge_id uuid,
  p_mapping_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  delete from public.channel_mappings
  where id = p_mapping_id and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Mapping not found');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.delete_channel_mapping(uuid, uuid) to authenticated;

-- Create channel config
create or replace function public.create_channel_config(
  p_lodge_id uuid,
  p_channel_key text,
  p_channel_label text default null,
  p_enabled boolean default true,
  p_sync_availability boolean default true,
  p_sync_rates boolean default false,
  p_import_reservations boolean default false,
  p_credentials jsonb default '{}'::jsonb,
  p_settings jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  insert into public.channel_config (lodge_id, channel_key, channel_label, enabled, sync_availability, sync_rates, import_reservations, credentials, settings)
  values (p_lodge_id, p_channel_key, p_channel_label, p_enabled, p_sync_availability, p_sync_rates, p_import_reservations, p_credentials, p_settings)
  on conflict (lodge_id, channel_key)
  do update set
    channel_label = excluded.channel_label,
    enabled = excluded.enabled,
    sync_availability = excluded.sync_availability,
    sync_rates = excluded.sync_rates,
    import_reservations = excluded.import_reservations,
    credentials = excluded.credentials,
    settings = excluded.settings,
    updated_at = now()
  returning id into v_id;

  return jsonb_build_object('success', true, 'config_id', v_id);
end;
$$;

grant execute on function public.create_channel_config(uuid, text, text, boolean, boolean, boolean, boolean, jsonb, jsonb) to authenticated;

-- Update channel config
create or replace function public.update_channel_config(
  p_lodge_id uuid,
  p_config_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  update public.channel_config
  set
    channel_label = coalesce(nullif(p_payload->>'channel_label', ''), channel_label),
    sync_availability = coalesce((p_payload->>'sync_availability')::boolean, sync_availability),
    sync_rates = coalesce((p_payload->>'sync_rates')::boolean, sync_rates),
    import_reservations = coalesce((p_payload->>'import_reservations')::boolean, import_reservations),
    credentials = coalesce(nullif(p_payload->>'credentials', '')::jsonb, credentials),
    settings = coalesce(nullif(p_payload->>'settings', '')::jsonb, settings),
    updated_at = now()
  where id = p_config_id and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Config not found');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.update_channel_config(uuid, uuid, jsonb) to authenticated;

-- Enable channel
create or replace function public.enable_channel(
  p_lodge_id uuid,
  p_channel_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config_id uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  update public.channel_config
  set enabled = true, updated_at = now()
  where lodge_id = p_lodge_id and channel_key = p_channel_key
  returning id into v_config_id;

  if v_config_id is null then
    return jsonb_build_object('success', false, 'error', 'Channel config not found');
  end if;

  return jsonb_build_object('success', true, 'config_id', v_config_id);
end;
$$;

grant execute on function public.enable_channel(uuid, text) to authenticated;

-- Disable channel
create or replace function public.disable_channel(
  p_lodge_id uuid,
  p_channel_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config_id uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  update public.channel_config
  set enabled = false, updated_at = now()
  where lodge_id = p_lodge_id and channel_key = p_channel_key
  returning id into v_config_id;

  if v_config_id is null then
    return jsonb_build_object('success', false, 'error', 'Channel config not found');
  end if;

  return jsonb_build_object('success', true, 'config_id', v_config_id);
end;
$$;

grant execute on function public.disable_channel(uuid, text) to authenticated;

-- Get channel dashboard
create or replace function public.get_channel_dashboard(
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channels jsonb;
  v_pending_sync jsonb;
  v_pending_imports jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  select jsonb_agg(jsonb_build_object(
    'id', cc.id,
    'channel_key', cc.channel_key,
    'channel_label', cc.channel_label,
    'enabled', cc.enabled,
    'sync_availability', cc.sync_availability,
    'sync_rates', cc.sync_rates,
    'import_reservations', cc.import_reservations
  )) into v_channels
  from public.channel_config cc
  where cc.lodge_id = p_lodge_id
  order by cc.channel_label;

  select jsonb_agg(jsonb_build_object(
    'id', ecs.id,
    'channel_key', ecs.channel_key,
    'sync_type', ecs.sync_type,
    'status', ecs.status,
    'error', ecs.error,
    'created_at', ecs.created_at
  )) into v_pending_sync
  from public.enterprise_channel_sync_items ecs
  where ecs.lodge_id = p_lodge_id and ecs.status = 'queued'
  order by ecs.created_at desc;

  select jsonb_agg(jsonb_build_object(
    'id', cri.id,
    'channel_key', cri.channel_key,
    'channel_reservation_id', cri.channel_reservation_id,
    'status', cri.status,
    'guest_name', cri.guest_name,
    'check_in', cri.check_in,
    'check_out', cri.check_out,
    'rate_amount', cri.rate_amount,
    'imported_at', cri.imported_at
  )) into v_pending_imports
  from public.channel_reservation_imports cri
  where cri.lodge_id = p_lodge_id and cri.status = 'pending'
  order by cri.imported_at desc;

  return jsonb_build_object(
    'channels', coalesce(v_channels, '[]'::jsonb),
    'pending_sync_items', coalesce(v_pending_sync, '[]'::jsonb),
    'pending_imports', coalesce(v_pending_imports, '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_channel_dashboard(uuid) to authenticated;

-- Process channel sync queue
create or replace function public.process_channel_sync_queue(
  p_lodge_id uuid,
  p_channel_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_processed int := 0;
  v_failed int := 0;
  v_item record;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  for v_item in
    select * from public.enterprise_channel_sync_items
    where lodge_id = p_lodge_id
      and status = 'queued'
      and (p_channel_key is null or channel_key = p_channel_key)
    order by created_at asc
    limit 50
  loop
    begin
      update public.enterprise_channel_sync_items
      set status = 'completed', updated_at = now()
      where id = v_item.id;

      v_processed := v_processed + 1;
    exception when others then
      update public.enterprise_channel_sync_items
      set status = 'failed', error = sqlerrm, updated_at = now()
      where id = v_item.id;
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object('success', true, 'processed', v_processed, 'failed', v_failed);
end;
$$;

grant execute on function public.process_channel_sync_queue(uuid, text) to authenticated;

-- Import channel reservation
create or replace function public.import_channel_reservation(
  p_lodge_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_channel_key text := nullif(p_payload->>'channel_key', '');
  v_channel_reservation_id text := nullif(p_payload->>'channel_reservation_id', '');
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  if v_channel_key is null then
    return jsonb_build_object('success', false, 'error', 'Channel key is required');
  end if;
  if v_channel_reservation_id is null then
    return jsonb_build_object('success', false, 'error', 'Channel reservation ID is required');
  end if;

  insert into public.channel_reservation_imports (
    lodge_id, channel_key, channel_reservation_id, status,
    guest_name, check_in, check_out, room_type_channel_code,
    rate_amount, notes, payload
  )
  values (
    p_lodge_id, v_channel_key, v_channel_reservation_id, 'pending',
    nullif(p_payload->>'guest_name', ''),
    nullif(p_payload->>'check_in', '')::date,
    nullif(p_payload->>'check_out', '')::date,
    nullif(p_payload->>'room_type_channel_code', ''),
    nullif(p_payload->>'rate_amount', '')::numeric,
    nullif(p_payload->>'notes', ''),
    coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (lodge_id, channel_key, channel_reservation_id)
  do update set
    status = 'duplicate',
    updated_at = now()
  returning id into v_id;

  return jsonb_build_object('success', true, 'import_id', v_id, 'status', 'pending');
end;
$$;

grant execute on function public.import_channel_reservation(uuid, jsonb) to authenticated;

-- Confirm channel import (creates actual booking)
create or replace function public.confirm_channel_import(
  p_import_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_import record;
  v_room_id uuid;
  v_local_customer_id uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  select * into v_import
  from public.channel_reservation_imports
  where id = p_import_id and lodge_id = p_lodge_id;

  if v_import is null then
    return jsonb_build_object('success', false, 'error', 'Import not found');
  end if;

  if v_import.status != 'pending' and v_import.status != 'reviewed' then
    return jsonb_build_object('success', false, 'error', 'Import is not in a confirmable state');
  end if;

  -- Resolve room from mapping
  select cm.local_id into v_room_id
  from public.channel_mappings cm
  where cm.lodge_id = p_lodge_id
    and cm.channel_key = v_import.channel_key
    and cm.source_type = 'room_type'
    and cm.channel_code = v_import.room_type_channel_code
  limit 1;

  -- Create customer if guest name provided
  if v_import.guest_name is not null then
    insert into public.customers (lodge_id, first_name, last_name)
    values (
      p_lodge_id,
      split_part(v_import.guest_name, ' ', 1),
      coalesce(nullif(split_part(v_import.guest_name, ' ', 2), ''), 'Guest')
    )
    returning id into v_local_customer_id;
  end if;

  -- Update import status
  update public.channel_reservation_imports
  set status = 'confirmed', updated_at = now()
  where id = p_import_id;

  return jsonb_build_object(
    'success', true,
    'import_id', p_import_id,
    'customer_id', v_local_customer_id,
    'room_id', v_room_id
  );
end;
$$;

grant execute on function public.confirm_channel_import(uuid, uuid) to authenticated;

-- Reject channel import
create or replace function public.reject_channel_import(
  p_import_id uuid,
  p_lodge_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  update public.channel_reservation_imports
  set status = 'rejected', notes = coalesce(p_reason, notes), updated_at = now()
  where id = p_import_id and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Import not found');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.reject_channel_import(uuid, uuid, text) to authenticated;
