-- Final POS financial contract repair.
--
-- This is intentionally a forward migration. It replaces the callable v3
-- functions introduced earlier without removing the legacy RPCs required by
-- installations that have not yet upgraded.

begin;

alter table public.settings
  add column if not exists timezone text not null default 'Africa/Gaborone',
  add column if not exists pos_offline_trading_hours integer not null default 72;

alter table public.pos_cashup_sessions
  add column if not exists idempotency_key text;

create unique index if not exists pos_cashup_sessions_lodge_idempotency_uidx
  on public.pos_cashup_sessions (lodge_id, idempotency_key)
  where idempotency_key is not null;

alter table public.booking_charges
  drop constraint if exists booking_charges_reversal_of_charge_id_fkey;

alter table public.booking_charges
  add constraint booking_charges_reversal_of_charge_id_fkey
  foreign key (reversal_of_charge_id)
  references public.booking_charges(id)
  on delete restrict;

create unique index if not exists booking_charges_pos_source_uidx
  on public.booking_charges (lodge_id, source_type, source_id)
  where source_type in ('pos_order', 'pos_return')
    and source_id is not null;

alter table public.pos_audit_log
  add column if not exists outlet_id uuid,
  add column if not exists shift_id uuid,
  add column if not exists order_id uuid,
  add column if not exists actor_id uuid,
  add column if not exists operator_id uuid,
  add column if not exists approver_id uuid,
  add column if not exists device_id text,
  add column if not exists amount_delta numeric,
  add column if not exists idempotency_key text,
  add column if not exists client_at timestamptz,
  add column if not exists server_at timestamptz not null default now(),
  add column if not exists before_snapshot jsonb,
  add column if not exists after_snapshot jsonb;

create index if not exists pos_audit_log_order_idx
  on public.pos_audit_log (lodge_id, order_id, created_at desc)
  where order_id is not null;

create table if not exists public.pos_pin_attempts (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  staff_id uuid,
  device_id text not null default 'unknown',
  capability text not null,
  succeeded boolean not null default false,
  attempted_at timestamptz not null default now()
);

create index if not exists pos_pin_attempts_rate_limit_idx
  on public.pos_pin_attempts (lodge_id, device_id, staff_id, attempted_at desc);

alter table public.pos_pin_attempts enable row level security;
revoke all on table public.pos_pin_attempts from public, anon, authenticated;
grant select, insert, update, delete on table public.pos_pin_attempts to service_role;

create or replace function public.get_lodge_business_date(p_lodge_id uuid)
returns date
language sql
security definer
set search_path to 'public'
as $$
  select (
    now() at time zone coalesce(
      (select nullif(btrim(s.timezone), '') from public.settings s where s.lodge_id = p_lodge_id limit 1),
      'Africa/Gaborone'
    )
  )::date;
$$;

revoke all on function public.get_lodge_business_date(uuid) from public;
grant execute on function public.get_lodge_business_date(uuid) to anon, authenticated, service_role;

create or replace function public._pos_user_has_capability(
  p_user_id uuid,
  p_capability text
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role text;
  v_overrides jsonb;
  v_override jsonb;
  v_default boolean := false;
begin
  select lower(coalesce(u.role, '')), coalesce(u.capability_overrides, '{}'::jsonb)
    into v_role, v_overrides
    from public.users u
   where u.id = p_user_id
     and coalesce(u.status, 'active') = 'active';

  if not found then
    return false;
  end if;

  v_default := case p_capability
    when 'pos.manage' then v_role in ('cashier', 'supervisor', 'manager', 'admin', 'super_admin')
    when 'pos.void' then v_role in ('supervisor', 'manager', 'admin', 'super_admin')
    when 'pos.discount' then v_role in ('supervisor', 'manager', 'admin', 'super_admin')
    when 'pos.price_override' then v_role in ('manager', 'admin', 'super_admin')
    when 'pos.menu_manage' then v_role in ('manager', 'admin', 'super_admin')
    when 'pos.reports' then v_role in ('supervisor', 'manager', 'admin', 'super_admin')
    when 'sync.manage' then v_role in ('manager', 'admin', 'super_admin')
    when 'settings.manage_general' then v_role in ('manager', 'admin', 'super_admin')
    else false
  end;

  v_override := v_overrides -> p_capability;
  if v_override is not null and jsonb_typeof(v_override) = 'boolean' then
    return (v_override::text)::boolean;
  end if;

  return v_default;
end;
$$;

revoke all on function public._pos_user_has_capability(uuid, text)
  from public, anon, authenticated;

create or replace function public._pos_validate_pin_internal(
  p_lodge_id uuid,
  p_staff_id uuid,
  p_pin text,
  p_capability text,
  p_device_id text
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pin_hash text;
  v_locked boolean;
  v_success boolean := false;
  v_device_id text := coalesce(nullif(btrim(p_device_id), ''), 'unknown');
begin
  select count(*) >= 5
    into v_locked
    from public.pos_pin_attempts a
   where a.lodge_id = p_lodge_id
     and a.device_id = v_device_id
     and (p_staff_id is null or a.staff_id = p_staff_id)
     and a.succeeded = false
     and a.attempted_at >= now() - interval '15 minutes';

  if v_locked then
    raise exception 'Too many failed PIN attempts. Try again in 15 minutes.'
      using errcode = '42501';
  end if;

  select u.pin_hash
    into v_pin_hash
    from public.users u
   where u.id = p_staff_id
     and u.lodge_id = p_lodge_id
     and coalesce(u.status, 'active') = 'active'
   for update;

  v_success :=
    v_pin_hash is not null
    and nullif(btrim(coalesce(p_pin, '')), '') is not null
    and extensions.crypt(p_pin, v_pin_hash) = v_pin_hash
    and public._pos_user_has_capability(p_staff_id, p_capability);

  insert into public.pos_pin_attempts (
    lodge_id, staff_id, device_id, capability, succeeded
  ) values (
    p_lodge_id, p_staff_id, v_device_id, p_capability, v_success
  );

  return v_success;
end;
$$;

revoke all on function public._pos_validate_pin_internal(uuid, uuid, text, text, text)
  from public, anon, authenticated;

create or replace function public._pos_resolve_pin_internal(
  p_lodge_id uuid,
  p_pin text,
  p_capability text,
  p_device_id text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user record;
  v_staff_id uuid;
  v_device_id text := coalesce(nullif(btrim(p_device_id), ''), 'unknown');
begin
  if (
    select count(*) >= 5
    from public.pos_pin_attempts a
    where a.lodge_id = p_lodge_id
      and a.device_id = v_device_id
      and a.succeeded = false
      and a.attempted_at >= now() - interval '15 minutes'
  ) then
    raise exception 'Too many failed PIN attempts. Try again in 15 minutes.'
      using errcode = '42501';
  end if;

  for v_user in
    select u.id, u.pin_hash
    from public.users u
    where u.lodge_id = p_lodge_id
      and coalesce(u.status, 'active') = 'active'
      and u.pin_hash is not null
    order by u.id
  loop
    if public._pos_user_has_capability(v_user.id, p_capability)
       and extensions.crypt(p_pin, v_user.pin_hash) = v_user.pin_hash then
      v_staff_id := v_user.id;
      exit;
    end if;
  end loop;

  insert into public.pos_pin_attempts (
    lodge_id, staff_id, device_id, capability, succeeded
  ) values (
    p_lodge_id, v_staff_id, v_device_id, p_capability, v_staff_id is not null
  );

  return v_staff_id;
end;
$$;

revoke all on function public._pos_resolve_pin_internal(uuid, text, text, text)
  from public, anon, authenticated;

create or replace function public.pos_resolve_approver_pin(
  p_lodge_id uuid,
  p_pin text,
  p_required_capability text default 'pos.void',
  p_device_id text default 'unknown'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_staff_id uuid;
  v_user record;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']
  );
  v_staff_id := public._pos_resolve_pin_internal(
    p_lodge_id, p_pin, p_required_capability, p_device_id
  );
  if v_staff_id is null then
    return jsonb_build_object('success', false, 'error', 'Invalid PIN or unauthorized approver');
  end if;
  select id, name, email, role, allowed_outlet_ids
    into v_user
    from public.users
   where id = v_staff_id;
  return jsonb_build_object(
    'success', true,
    'staff', jsonb_build_object(
      'id', v_user.id,
      'name', v_user.name,
      'email', v_user.email,
      'role', v_user.role,
      'allowed_outlet_ids', coalesce(v_user.allowed_outlet_ids, '{}'::uuid[])
    )
  );
end;
$$;

revoke all on function public.pos_resolve_approver_pin(uuid, text, text, text) from public;
grant execute on function public.pos_resolve_approver_pin(uuid, text, text, text)
  to anon, authenticated, service_role;

create or replace function public.pos_validate_pin(
  p_lodge_id uuid,
  p_staff_id uuid,
  p_pin text,
  p_required_capability text default 'pos.manage',
  p_device_id text default 'unknown'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user record;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']
  );

  if not public._pos_validate_pin_internal(
    p_lodge_id, p_staff_id, p_pin, p_required_capability, p_device_id
  ) then
    return jsonb_build_object(
      'success', false,
      'error', 'Invalid PIN or unauthorized staff member'
    );
  end if;

  select id, name, email, role, allowed_outlet_ids
    into v_user
    from public.users
   where id = p_staff_id
     and lodge_id = p_lodge_id;

  return jsonb_build_object(
    'success', true,
    'staff', jsonb_build_object(
      'id', v_user.id,
      'name', v_user.name,
      'email', v_user.email,
      'role', v_user.role,
      'allowed_outlet_ids', coalesce(v_user.allowed_outlet_ids, '{}'::uuid[])
    )
  );
end;
$$;

revoke all on function public.pos_validate_pin(uuid, uuid, text, text, text) from public;
grant execute on function public.pos_validate_pin(uuid, uuid, text, text, text)
  to anon, authenticated, service_role;

-- The old generic "try this PIN against every supervisor" contract enables PIN
-- probing and is no longer callable by client roles.
revoke all on function public.pos_validate_pin(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.pos_validate_pin(uuid, text, text) to service_role;

create or replace function public.pos_get_safe_staff(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']
  );

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', u.id,
        'name', u.name,
        'email', u.email,
        'role', u.role,
        'has_pin', u.pin_hash is not null,
        'allowed_outlet_ids', coalesce(u.allowed_outlet_ids, '{}'::uuid[]),
        'capability_overrides', coalesce(u.capability_overrides, '{}'::jsonb)
      )
      order by u.name
    )
      from public.users u
     where u.lodge_id = p_lodge_id
       and coalesce(u.status, 'active') = 'active'
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.pos_get_safe_staff(uuid) from public;
grant execute on function public.pos_get_safe_staff(uuid)
  to anon, authenticated, service_role;

create or replace function public.get_active_pos_catalog_snapshot(
  p_lodge_id uuid,
  p_outlet_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_snapshot record;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']
  );

  if p_outlet_id is not null then
    perform public.app_require_pos_outlet_access(p_lodge_id, p_outlet_id);
  end if;

  select s.*
    into v_snapshot
    from public.pos_catalog_snapshots s
   where s.lodge_id = p_lodge_id
     and s.outlet_id is not distinct from p_outlet_id
     and s.retired_at is null
   order by s.created_at desc
   limit 1;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', 'No active catalog snapshot found. Publish a catalog before trading.',
      'code', 'catalog_missing',
      'lodge_id', p_lodge_id,
      'outlet_id', p_outlet_id
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'snapshot_id', v_snapshot.id,
    'lodge_id', v_snapshot.lodge_id,
    'outlet_id', v_snapshot.outlet_id,
    'version_number', v_snapshot.version_number,
    'vat_enabled', v_snapshot.vat_enabled,
    'vat_rate', v_snapshot.vat_rate,
    'payload', v_snapshot.payload,
    'payload_hash', v_snapshot.payload_hash,
    'created_at', v_snapshot.created_at
  );
end;
$$;

revoke all on function public.get_active_pos_catalog_snapshot(uuid, uuid) from public;
grant execute on function public.get_active_pos_catalog_snapshot(uuid, uuid)
  to anon, authenticated, service_role;

create or replace function public.upsert_pos_modifier_groups(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_groups jsonb := coalesce(payload->'groups', '[]'::jsonb);
  v_group jsonb;
  v_count integer := 0;
begin
  perform public.app_require_lodge_role(
    v_lodge_id,
    array['manager', 'admin', 'super_admin']
  );
  if jsonb_typeof(v_groups) <> 'array' then
    return jsonb_build_object('success', false, 'error', 'groups must be an array');
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_lodge_id::text || ':pos-modifier-groups', 0)
  );

  update public.pos_modifier_groups
     set active = false,
         updated_at = now()
   where lodge_id = v_lodge_id;

  for v_group in select value from jsonb_array_elements(v_groups)
  loop
    if nullif(btrim(coalesce(v_group->>'name', '')), '') is null then
      return jsonb_build_object('success', false, 'error', 'Every modifier group requires a name');
    end if;
    if jsonb_typeof(coalesce(v_group->'options', '[]'::jsonb)) <> 'array' then
      return jsonb_build_object('success', false, 'error', 'Modifier options must be an array');
    end if;

    insert into public.pos_modifier_groups (
      id, lodge_id, name, applies_to_categories, options, active, updated_at
    ) values (
      coalesce(nullif(v_group->>'id', '')::uuid, gen_random_uuid()),
      v_lodge_id,
      btrim(v_group->>'name'),
      coalesce(
        array(select jsonb_array_elements_text(coalesce(v_group->'applies_to_categories', '[]'::jsonb))),
        '{}'::text[]
      ),
      coalesce(v_group->'options', '[]'::jsonb),
      coalesce((v_group->>'active')::boolean, true),
      now()
    )
    on conflict (id) do update set
      name = excluded.name,
      applies_to_categories = excluded.applies_to_categories,
      options = excluded.options,
      active = excluded.active,
      updated_at = now()
    where public.pos_modifier_groups.lodge_id = v_lodge_id;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('success', true, 'count', v_count);
end;
$$;

revoke all on function public.upsert_pos_modifier_groups(jsonb) from public;
grant execute on function public.upsert_pos_modifier_groups(jsonb)
  to anon, authenticated, service_role;

create or replace function public.upsert_pos_promotions(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_promotions jsonb := coalesce(payload->'promotions', '[]'::jsonb);
  v_promotion jsonb;
  v_count integer := 0;
begin
  perform public.app_require_lodge_role(
    v_lodge_id,
    array['manager', 'admin', 'super_admin']
  );
  if jsonb_typeof(v_promotions) <> 'array' then
    return jsonb_build_object('success', false, 'error', 'promotions must be an array');
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_lodge_id::text || ':pos-promotions', 0)
  );

  update public.pos_promotions
     set active = false,
         updated_at = now()
   where lodge_id = v_lodge_id;

  for v_promotion in select value from jsonb_array_elements(v_promotions)
  loop
    if nullif(btrim(coalesce(v_promotion->>'name', '')), '') is null then
      return jsonb_build_object('success', false, 'error', 'Every promotion requires a name');
    end if;
    if lower(coalesce(v_promotion->>'discount_type', 'amount')) not in ('amount', 'percent') then
      return jsonb_build_object('success', false, 'error', 'Promotion discount type must be amount or percent');
    end if;

    insert into public.pos_promotions (
      id, lodge_id, name, discount_type, discount_value,
      applies_to_category, active, updated_at
    ) values (
      coalesce(nullif(v_promotion->>'id', '')::uuid, gen_random_uuid()),
      v_lodge_id,
      btrim(v_promotion->>'name'),
      lower(coalesce(v_promotion->>'discount_type', 'amount')),
      greatest(0, coalesce(nullif(v_promotion->>'discount_value', '')::numeric, 0)),
      coalesce(nullif(v_promotion->>'applies_to_category', ''), 'All'),
      coalesce((v_promotion->>'active')::boolean, true),
      now()
    )
    on conflict (id) do update set
      name = excluded.name,
      discount_type = excluded.discount_type,
      discount_value = excluded.discount_value,
      applies_to_category = excluded.applies_to_category,
      active = excluded.active,
      updated_at = now()
    where public.pos_promotions.lodge_id = v_lodge_id;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('success', true, 'count', v_count);
end;
$$;

revoke all on function public.upsert_pos_promotions(jsonb) from public;
grant execute on function public.upsert_pos_promotions(jsonb)
  to anon, authenticated, service_role;

create or replace function public.publish_pos_catalog_snapshot(
  p_lodge_id uuid,
  p_outlet_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_items jsonb;
  v_modifier_groups jsonb;
  v_promotions jsonb;
  v_vat_enabled boolean := false;
  v_vat_rate numeric := 0;
  v_next_version integer;
  v_snapshot_id uuid;
  v_payload jsonb;
  v_payload_hash text;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['manager', 'admin', 'super_admin']
  );

  if p_outlet_id is not null then
    perform public.app_require_pos_outlet_access(p_lodge_id, p_outlet_id);
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_lodge_id::text || ':catalog:' || coalesce(p_outlet_id::text, 'global'),
      0
    )
  );

  select coalesce(s.vat_enabled, false), coalesce(s.vat_rate, 0)
    into v_vat_enabled, v_vat_rate
    from public.settings s
   where s.lodge_id = p_lodge_id
   limit 1;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'name', m.name,
      'category', m.category,
      'price', m.price,
      'is_available', coalesce(m.is_available, true),
      'inventory_item_id', m.inventory_item_id,
      'depletion_qty', public._positive_depletion_qty(m.depletion_qty, 1),
      'outlet_id', m.outlet_id,
      'barcode', m.barcode
    )
    order by m.category, m.name
  ), '[]'::jsonb)
    into v_items
    from public.pos_menu_items m
   where m.lodge_id = p_lodge_id
     and (
       (p_outlet_id is null and m.outlet_id is null)
       or m.outlet_id = p_outlet_id
       or m.outlet_id is null
     );

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', g.id,
      'name', g.name,
      'applies_to_categories', coalesce(g.applies_to_categories, '{}'::text[]),
      'options', coalesce(g.options, '[]'::jsonb),
      'active', g.active
    )
    order by g.name
  ), '[]'::jsonb)
    into v_modifier_groups
    from public.pos_modifier_groups g
   where g.lodge_id = p_lodge_id
     and g.active = true;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'discount_type', p.discount_type,
      'discount_value', p.discount_value,
      'applies_to_category', p.applies_to_category,
      'active', p.active
    )
    order by p.name
  ), '[]'::jsonb)
    into v_promotions
    from public.pos_promotions p
   where p.lodge_id = p_lodge_id
     and p.active = true;

  v_payload := jsonb_build_object(
    'items', v_items,
    'modifier_groups', v_modifier_groups,
    'promotions', v_promotions,
    'vat_enabled', v_vat_enabled,
    'vat_rate', v_vat_rate
  );
  v_payload_hash := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');

  select coalesce(max(s.version_number), 0) + 1
    into v_next_version
    from public.pos_catalog_snapshots s
   where s.lodge_id = p_lodge_id
     and s.outlet_id is not distinct from p_outlet_id;

  update public.pos_catalog_snapshots
     set retired_at = now()
   where lodge_id = p_lodge_id
     and outlet_id is not distinct from p_outlet_id
     and retired_at is null;

  insert into public.pos_catalog_snapshots (
    lodge_id, outlet_id, version_number, vat_enabled, vat_rate,
    payload, payload_hash
  ) values (
    p_lodge_id, p_outlet_id, v_next_version, v_vat_enabled, v_vat_rate,
    v_payload, v_payload_hash
  )
  returning id into v_snapshot_id;

  return jsonb_build_object(
    'success', true,
    'snapshot_id', v_snapshot_id,
    'version_number', v_next_version,
    'payload_hash', v_payload_hash,
    'item_count', jsonb_array_length(v_items),
    'created_at', now()
  );
end;
$$;

revoke all on function public.publish_pos_catalog_snapshot(uuid, uuid) from public;
grant execute on function public.publish_pos_catalog_snapshot(uuid, uuid)
  to anon, authenticated, service_role;

create or replace function public.create_pos_order_v3(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_shift_id uuid := nullif(payload->>'shift_id', '')::uuid;
  v_snapshot_id uuid := nullif(payload->>'catalog_snapshot_id', '')::uuid;
  v_order_id uuid := nullif(payload->>'id', '')::uuid;
  v_idempotency_key text := nullif(btrim(coalesce(payload->>'create_idempotency_key', '')), '');
  v_client_at timestamptz := nullif(payload->>'client_created_at', '')::timestamptz;
  v_device_id text := nullif(btrim(coalesce(payload->>'source_device_id', '')), '');
  v_payment_method text := lower(coalesce(nullif(payload->>'payment_method', ''), 'cash'));
  v_payment_breakdown jsonb := coalesce(payload->'payment_breakdown', '[]'::jsonb);
  v_items jsonb := coalesce(payload->'items', '[]'::jsonb);
  v_manual_discount jsonb := coalesce(payload->'manual_discount', '{}'::jsonb);
  v_promotion_id uuid := nullif(payload->>'promotion_id', '')::uuid;
  v_tip_total numeric := round(greatest(0, coalesce(nullif(payload->>'tip_total', '')::numeric, 0)), 2);
  v_booking_id uuid := nullif(payload->>'booking_id', '')::uuid;
  v_room_id uuid := nullif(payload->>'room_id', '')::uuid;
  v_actor_id uuid := public.app_current_user_id();
  v_operator_id uuid;
  v_actor_role text := lower(coalesce(public.app_current_role(), ''));
  v_snapshot record;
  v_shift record;
  v_offline_hours integer := 72;
  v_request_hash text;
  v_claim jsonb;
  v_result jsonb;
  v_line jsonb;
  v_catalog_item jsonb;
  v_modifier_group jsonb;
  v_modifier_option jsonb;
  v_modifier_id text;
  v_modifier_ids jsonb;
  v_resolved_modifiers jsonb;
  v_priced_items jsonb := '[]'::jsonb;
  v_priced_line jsonb;
  v_menu_item_id uuid;
  v_inventory_item_id uuid;
  v_quantity numeric;
  v_depletion_qty numeric;
  v_base_price numeric;
  v_modifier_total numeric;
  v_unit_price numeric;
  v_line_gross numeric;
  v_gross_total numeric := 0;
  v_discount_total numeric := 0;
  v_promotion_discount numeric := 0;
  v_manual_discount_amount numeric := 0;
  v_promotion jsonb;
  v_promotion_base numeric := 0;
  v_tax_total numeric := 0;
  v_total numeric := 0;
  v_payment_total numeric := 0;
  v_payment jsonb;
  v_usage record;
  v_stock numeric;
  v_line_count integer;
  v_line_index integer := 0;
  v_discount_allocated numeric := 0;
  v_tax_allocated numeric := 0;
  v_line_discount numeric;
  v_line_tax numeric;
  v_line_net numeric;
  v_order_item_id uuid;
  v_authoritative_items jsonb := '[]'::jsonb;
  v_folio_charge_id uuid;
begin
  if v_lodge_id is null or v_order_id is null or v_snapshot_id is null
     or v_shift_id is null or v_idempotency_key is null or v_client_at is null then
    return jsonb_build_object(
      'success', false,
      'error', 'id, lodge_id, catalog_snapshot_id, shift_id, client_created_at and create_idempotency_key are required'
    );
  end if;

  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    return jsonb_build_object('success', false, 'error', 'At least one POS item is required');
  end if;

  perform public.app_require_lodge_role(
    v_lodge_id,
    array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']
  );
  if v_outlet_id is not null then
    perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);
  end if;

  v_request_hash := encode(sha256(convert_to(payload::text, 'UTF8')), 'hex');
  v_claim := public._claim_financial_operation(
    v_lodge_id, v_idempotency_key, 'create_pos_order_v3', v_order_id, v_request_hash
  );
  if coalesce((v_claim->>'found')::boolean, false) then
    return v_claim->'operation_result';
  end if;
  if coalesce(v_claim->>'success', 'true') <> 'true' then
    return jsonb_build_object(
      'success', false,
      'error', coalesce(v_claim->>'error', 'Idempotency conflict'),
      'code', 'idempotency_conflict'
    );
  end if;

  select s.*
    into v_snapshot
    from public.pos_catalog_snapshots s
   where s.id = v_snapshot_id
   for share;

  if not found
     or v_snapshot.lodge_id <> v_lodge_id
     or v_snapshot.outlet_id is distinct from v_outlet_id then
    return jsonb_build_object(
      'success', false,
      'error', 'Catalog snapshot is missing or belongs to a different lodge/outlet',
      'code', 'catalog_refresh_required',
      'manual_review_required', true
    );
  end if;

  select coalesce(s.pos_offline_trading_hours, 72)
    into v_offline_hours
    from public.settings s
   where s.lodge_id = v_lodge_id
   limit 1;

  if v_snapshot.created_at > v_client_at
     or v_client_at > now() + interval '5 minutes'
     or now() - v_client_at > make_interval(hours => greatest(1, v_offline_hours)) then
    return jsonb_build_object(
      'success', false,
      'error', 'Catalog snapshot or device timestamp is outside the permitted offline trading window',
      'code', 'catalog_refresh_required',
      'manual_review_required', true
    );
  end if;

  select s.*
    into v_shift
    from public.pos_shifts s
   where s.id = v_shift_id
     and s.lodge_id = v_lodge_id
   for update;

  if not found or lower(v_shift.status) <> 'open' then
    return jsonb_build_object(
      'success', false,
      'error', 'A valid open shift is required',
      'code', 'shift_not_open'
    );
  end if;

  if v_shift.outlet_id is distinct from v_outlet_id then
    return jsonb_build_object('success', false, 'error', 'Shift does not belong to this outlet');
  end if;

  v_operator_id := coalesce(v_actor_id, v_shift.cashier_id);
  if v_operator_id is null then
    return jsonb_build_object('success', false, 'error', 'Authenticated POS operator could not be resolved');
  end if;

  if not public.app_is_service_role()
     and v_shift.cashier_id is not null
     and v_shift.cashier_id <> v_operator_id
     and v_actor_role not in ('supervisor', 'manager', 'admin', 'super_admin') then
    return jsonb_build_object('success', false, 'error', 'This operator is not assigned to the open shift');
  end if;

  for v_line in select value from jsonb_array_elements(v_items)
  loop
    v_menu_item_id := nullif(v_line->>'menu_item_id', '')::uuid;
    v_quantity := coalesce(nullif(v_line->>'quantity', '')::numeric, 0);

    if v_menu_item_id is null or v_quantity <= 0 or v_quantity <> trunc(v_quantity) then
      return jsonb_build_object('success', false, 'error', 'Every item requires a menu_item_id and a positive whole quantity');
    end if;

    select value
      into v_catalog_item
      from jsonb_array_elements(coalesce(v_snapshot.payload->'items', '[]'::jsonb))
     where nullif(value->>'id', '')::uuid = v_menu_item_id
     limit 1;

    if v_catalog_item is null or not coalesce((v_catalog_item->>'is_available')::boolean, false) then
      return jsonb_build_object(
        'success', false,
        'error', 'Item is unavailable in the immutable catalog snapshot',
        'code', 'catalog_refresh_required',
        'manual_review_required', true
      );
    end if;

    v_base_price := round(coalesce((v_catalog_item->>'price')::numeric, 0), 2);
    v_inventory_item_id := nullif(v_catalog_item->>'inventory_item_id', '')::uuid;
    v_depletion_qty := public._positive_depletion_qty(
      nullif(v_catalog_item->>'depletion_qty', '')::numeric,
      1
    );
    v_modifier_total := 0;
    v_resolved_modifiers := '[]'::jsonb;
    v_modifier_ids := coalesce(v_line->'modifier_option_ids', '[]'::jsonb);

    if jsonb_typeof(v_modifier_ids) <> 'array' or jsonb_array_length(v_modifier_ids) = 0 then
      select coalesce(jsonb_agg(m->>'id'), '[]'::jsonb)
        into v_modifier_ids
        from jsonb_array_elements(coalesce(v_line->'modifiers', '[]'::jsonb)) m
       where nullif(m->>'id', '') is not null;
    end if;

    for v_modifier_id in select value from jsonb_array_elements_text(v_modifier_ids)
    loop
      v_modifier_option := null;
      for v_modifier_group in
        select value
          from jsonb_array_elements(coalesce(v_snapshot.payload->'modifier_groups', '[]'::jsonb))
      loop
        if coalesce((v_modifier_group->>'active')::boolean, true)
           and (
             jsonb_array_length(coalesce(v_modifier_group->'applies_to_categories', '[]'::jsonb)) = 0
             or exists (
               select 1
                 from jsonb_array_elements_text(v_modifier_group->'applies_to_categories') c
                where lower(c.value) = lower(coalesce(v_catalog_item->>'category', 'Other'))
             )
           ) then
          select value
            into v_modifier_option
            from jsonb_array_elements(coalesce(v_modifier_group->'options', '[]'::jsonb))
           where value->>'id' = v_modifier_id
           limit 1;
          exit when v_modifier_option is not null;
        end if;
      end loop;

      if v_modifier_option is null then
        return jsonb_build_object(
          'success', false,
          'error', 'A selected modifier is not valid for this item',
          'code', 'catalog_refresh_required'
        );
      end if;

      v_modifier_total := v_modifier_total + coalesce((v_modifier_option->>'price_delta')::numeric, 0);
      v_resolved_modifiers := v_resolved_modifiers || jsonb_build_array(v_modifier_option);
    end loop;

    v_unit_price := round(v_base_price + v_modifier_total, 2);
    v_line_gross := round(v_quantity * v_unit_price, 2);
    v_gross_total := v_gross_total + v_line_gross;

    v_priced_items := v_priced_items || jsonb_build_array(jsonb_build_object(
      'menu_item_id', v_menu_item_id,
      'item_name', v_catalog_item->>'name',
      'category', coalesce(v_catalog_item->>'category', 'Other'),
      'quantity', v_quantity,
      'unit_price', v_unit_price,
      'gross_subtotal', v_line_gross,
      'inventory_item_id', v_inventory_item_id,
      'depletion_qty', v_depletion_qty,
      'modifiers', v_resolved_modifiers,
      'item_notes', nullif(v_line->>'item_notes', '')
    ));
  end loop;

  if v_promotion_id is not null then
    select value
      into v_promotion
      from jsonb_array_elements(coalesce(v_snapshot.payload->'promotions', '[]'::jsonb))
     where nullif(value->>'id', '')::uuid = v_promotion_id
       and coalesce((value->>'active')::boolean, true)
     limit 1;

    if v_promotion is null then
      return jsonb_build_object('success', false, 'error', 'Promotion is not valid in this catalog snapshot');
    end if;

    if lower(coalesce(v_promotion->>'applies_to_category', 'all')) = 'all' then
      v_promotion_base := v_gross_total;
    else
      select coalesce(sum((value->>'gross_subtotal')::numeric), 0)
        into v_promotion_base
        from jsonb_array_elements(v_priced_items)
       where lower(value->>'category') = lower(v_promotion->>'applies_to_category');
    end if;

    v_promotion_discount := case lower(coalesce(v_promotion->>'discount_type', 'amount'))
      when 'percent' then round(v_promotion_base * least(100, greatest(0, (v_promotion->>'discount_value')::numeric)) / 100, 2)
      else round(least(v_promotion_base, greatest(0, (v_promotion->>'discount_value')::numeric)), 2)
    end;
  end if;

  if jsonb_typeof(v_manual_discount) = 'object'
     and v_manual_discount <> '{}'::jsonb
     and coalesce((v_manual_discount->>'value')::numeric, 0) > 0 then
    if not public._pos_user_has_capability(v_operator_id, 'pos.discount') then
      return jsonb_build_object('success', false, 'error', 'This operator is not authorized to apply manual discounts');
    end if;
    if nullif(btrim(coalesce(v_manual_discount->>'reason', '')), '') is null then
      return jsonb_build_object('success', false, 'error', 'Manual discount reason is required');
    end if;
    v_manual_discount_amount := case lower(coalesce(v_manual_discount->>'type', 'amount'))
      when 'percent' then round(v_gross_total * least(100, greatest(0, (v_manual_discount->>'value')::numeric)) / 100, 2)
      else round(greatest(0, (v_manual_discount->>'value')::numeric), 2)
    end;
  end if;

  v_discount_total := round(least(v_gross_total, v_promotion_discount + v_manual_discount_amount), 2);
  if coalesce(v_snapshot.vat_enabled, false) and coalesce(v_snapshot.vat_rate, 0) > 0 then
    v_tax_total := round((v_gross_total - v_discount_total) * v_snapshot.vat_rate / 100, 2);
  end if;
  v_total := round(v_gross_total - v_discount_total + v_tax_total + v_tip_total, 2);

  if jsonb_typeof(v_payment_breakdown) <> 'array' then
    return jsonb_build_object('success', false, 'error', 'payment_breakdown must be an array');
  end if;
  for v_payment in select value from jsonb_array_elements(v_payment_breakdown)
  loop
    if coalesce((v_payment->>'amount')::numeric, 0) < 0 then
      return jsonb_build_object('success', false, 'error', 'Payment amounts cannot be negative');
    end if;
    v_payment_total := v_payment_total + coalesce((v_payment->>'amount')::numeric, 0);
  end loop;
  if abs(round(v_payment_total, 2) - v_total) > 0.01 then
    return jsonb_build_object(
      'success', false,
      'error', format('Authoritative total is %s but submitted tenders total %s', v_total, round(v_payment_total, 2)),
      'code', 'payment_total_mismatch',
      'authoritative_total', v_total,
      'manual_review_required', true
    );
  end if;

  if v_payment_method = 'folio' then
    if v_booking_id is null then
      return jsonb_build_object('success', false, 'error', 'Folio payment requires booking_id');
    end if;
    perform 1
      from public.bookings b
     where b.id = v_booking_id
       and b.lodge_id = v_lodge_id
       and b.status in ('confirmed', 'checked_in')
     for update;
    if not found then
      return jsonb_build_object('success', false, 'error', 'Active booking not found for folio charge');
    end if;
  end if;

  for v_usage in
    select
      nullif(value->>'inventory_item_id', '')::uuid as inventory_item_id,
      sum((value->>'quantity')::numeric * (value->>'depletion_qty')::numeric) as required_stock,
      min(value->>'item_name') as item_name
    from jsonb_array_elements(v_priced_items)
    where nullif(value->>'inventory_item_id', '') is not null
    group by nullif(value->>'inventory_item_id', '')::uuid
  loop
    select i.current_stock
      into v_stock
      from public.inventory_items i
     where i.id = v_usage.inventory_item_id
       and i.lodge_id = v_lodge_id
     for update;
    if not found or coalesce(v_stock, 0) < v_usage.required_stock then
      return jsonb_build_object(
        'success', false,
        'error', format('Insufficient stock for %s', v_usage.item_name),
        'code', 'insufficient_stock'
      );
    end if;
  end loop;

  insert into public.pos_orders (
    id, lodge_id, room_id, booking_id, walk_in_name, status, total, notes,
    completed_at, payment_method, outlet_id, create_idempotency_key,
    gross_total, discount_total, tax_rate, tax_total, tip_total,
    payment_breakdown, service_mode, table_name, tab_name, waiter_name,
    cashier_id, cashier_name, shift_id, ticket_status, transaction_type,
    catalog_snapshot_id, source_device_id, client_created_at, server_received_at
  ) values (
    v_order_id, v_lodge_id, v_room_id, v_booking_id,
    nullif(payload->>'walk_in_name', ''), 'completed', v_total,
    nullif(payload->>'notes', ''), now(), v_payment_method, v_outlet_id,
    v_idempotency_key, v_gross_total, v_discount_total,
    coalesce(v_snapshot.vat_rate, 0), v_tax_total, v_tip_total,
    v_payment_breakdown, nullif(payload->>'service_mode', ''),
    nullif(payload->>'table_name', ''), nullif(payload->>'tab_name', ''),
    nullif(payload->>'waiter_name', ''), v_operator_id,
    (select u.name from public.users u where u.id = v_operator_id),
    v_shift_id, coalesce(nullif(payload->>'ticket_status', ''), 'new'),
    'sale', v_snapshot_id, v_device_id, v_client_at, now()
  );

  v_line_count := jsonb_array_length(v_priced_items);
  for v_priced_line in select value from jsonb_array_elements(v_priced_items)
  loop
    v_line_index := v_line_index + 1;
    v_line_gross := (v_priced_line->>'gross_subtotal')::numeric;
    if v_line_index = v_line_count then
      v_line_discount := v_discount_total - v_discount_allocated;
      v_line_tax := v_tax_total - v_tax_allocated;
    else
      v_line_discount := case when v_gross_total > 0
        then round(v_line_gross * v_discount_total / v_gross_total, 2)
        else 0 end;
      v_line_tax := case when v_gross_total - v_discount_total > 0
        then round((v_line_gross - v_line_discount) * v_tax_total / (v_gross_total - v_discount_total), 2)
        else 0 end;
    end if;
    v_discount_allocated := v_discount_allocated + v_line_discount;
    v_tax_allocated := v_tax_allocated + v_line_tax;
    v_line_net := round(v_line_gross - v_line_discount + v_line_tax, 2);

    insert into public.pos_order_items (
      lodge_id, order_id, menu_item_id, item_name, quantity, unit_price,
      subtotal, inventory_item_id, depletion_qty, category, modifiers,
      item_notes, gross_subtotal, discount_allocated, tax_allocated, net_subtotal
    ) values (
      v_lodge_id, v_order_id,
      nullif(v_priced_line->>'menu_item_id', '')::uuid,
      v_priced_line->>'item_name',
      (v_priced_line->>'quantity')::integer,
      (v_priced_line->>'unit_price')::numeric,
      v_line_net,
      nullif(v_priced_line->>'inventory_item_id', '')::uuid,
      (v_priced_line->>'depletion_qty')::numeric,
      v_priced_line->>'category',
      coalesce(v_priced_line->'modifiers', '[]'::jsonb),
      nullif(v_priced_line->>'item_notes', ''),
      v_line_gross, v_line_discount, v_line_tax, v_line_net
    )
    returning id into v_order_item_id;

    v_authoritative_items := v_authoritative_items || jsonb_build_array(
      v_priced_line || jsonb_build_object(
        'id', v_order_item_id,
        'discount_allocated', v_line_discount,
        'tax_allocated', v_line_tax,
        'net_subtotal', v_line_net
      )
    );
  end loop;

  for v_usage in
    select
      nullif(value->>'inventory_item_id', '')::uuid as inventory_item_id,
      sum((value->>'quantity')::numeric * (value->>'depletion_qty')::numeric) as required_stock
    from jsonb_array_elements(v_priced_items)
    where nullif(value->>'inventory_item_id', '') is not null
    group by nullif(value->>'inventory_item_id', '')::uuid
  loop
    update public.inventory_items
       set current_stock = current_stock - v_usage.required_stock,
           updated_at = now()
     where id = v_usage.inventory_item_id
       and lodge_id = v_lodge_id;
  end loop;

  if v_payment_method = 'folio' then
    insert into public.booking_charges (
      lodge_id, booking_id, description, amount, category, quantity,
      outlet_id, source_type, source_id
    ) values (
      v_lodge_id, v_booking_id,
      'POS order ' || left(v_order_id::text, 8),
      v_total, 'pos', 1, v_outlet_id, 'pos_order', v_order_id
    )
    returning id into v_folio_charge_id;

    update public.pos_orders
       set folio_charge_id = v_folio_charge_id
     where id = v_order_id;
  end if;

  if v_manual_discount_amount > 0 then
    insert into public.pos_audit_log (
      lodge_id, outlet_id, shift_id, order_id, actor_id, operator_id,
      device_id, action, entity_type, entity_id, staff_id, amount_delta,
      idempotency_key, client_at, after_snapshot, details
    ) values (
      v_lodge_id, v_outlet_id, v_shift_id, v_order_id, v_actor_id, v_operator_id,
      v_device_id, 'pos_discount_applied', 'pos_order', v_order_id, v_operator_id,
      -v_manual_discount_amount, v_idempotency_key, v_client_at,
      v_manual_discount, v_manual_discount
    );
  end if;

  insert into public.pos_audit_log (
    lodge_id, outlet_id, shift_id, order_id, actor_id, operator_id,
    device_id, action, entity_type, entity_id, staff_id, amount_delta,
    idempotency_key, client_at, after_snapshot, details
  ) values (
    v_lodge_id, v_outlet_id, v_shift_id, v_order_id, v_actor_id, v_operator_id,
    v_device_id, 'pos_order_created', 'pos_order', v_order_id, v_operator_id,
    v_total, v_idempotency_key, v_client_at,
    jsonb_build_object(
      'total', v_total, 'gross_total', v_gross_total,
      'discount_total', v_discount_total, 'tax_total', v_tax_total,
      'tip_total', v_tip_total, 'catalog_snapshot_id', v_snapshot_id,
      'items', v_authoritative_items
    ),
    jsonb_build_object('payment_method', v_payment_method, 'folio_charge_id', v_folio_charge_id)
  );

  v_result := jsonb_build_object(
    'success', true,
    'id', v_order_id,
    'total', v_total,
    'gross_total', v_gross_total,
    'discount_total', v_discount_total,
    'tax_rate', coalesce(v_snapshot.vat_rate, 0),
    'tax_total', v_tax_total,
    'tip_total', v_tip_total,
    'payment_method', v_payment_method,
    'payment_breakdown', v_payment_breakdown,
    'catalog_snapshot_id', v_snapshot_id,
    'shift_id', v_shift_id,
    'cashier_id', v_operator_id,
    'folio_charge_id', v_folio_charge_id,
    'items', v_authoritative_items,
    'server_received_at', now()
  );

  perform public._record_financial_operation(
    v_lodge_id, v_idempotency_key, 'create_pos_order_v3',
    v_order_id, v_request_hash, v_result
  );

  return v_result;
end;
$$;

revoke all on function public.create_pos_order_v3(jsonb) from public;
grant execute on function public.create_pos_order_v3(jsonb)
  to anon, authenticated, service_role;

create or replace function public.create_pos_return_v3(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_original_order_id uuid := nullif(payload->>'order_id', '')::uuid;
  v_return_order_id uuid := nullif(payload->>'return_order_id', '')::uuid;
  v_shift_id uuid := nullif(payload->>'shift_id', '')::uuid;
  v_approver_id uuid := nullif(payload->>'approver_id', '')::uuid;
  v_pin text := nullif(btrim(coalesce(payload->>'approval_pin', payload->>'pin', '')), '');
  v_device_id text := coalesce(nullif(payload->>'device_id', ''), 'unknown');
  v_reason text := nullif(btrim(coalesce(payload->>'reason', '')), '');
  v_key text := nullif(btrim(coalesce(payload->>'return_idempotency_key', '')), '');
  v_lines jsonb := coalesce(payload->'lines', '[]'::jsonb);
  v_actor_id uuid := public.app_current_user_id();
  v_request_hash text;
  v_claim jsonb;
  v_result jsonb;
  v_original record;
  v_shift record;
  v_original_item record;
  v_line jsonb;
  v_line_id uuid;
  v_requested_qty numeric;
  v_previous_qty numeric;
  v_new_qty numeric;
  v_original_gross numeric;
  v_original_discount numeric;
  v_original_tax numeric;
  v_original_net numeric;
  v_refund_gross numeric;
  v_refund_discount numeric;
  v_refund_tax numeric;
  v_refund_net numeric;
  v_total_gross numeric := 0;
  v_total_discount numeric := 0;
  v_total_tax numeric := 0;
  v_total_refund numeric := 0;
  v_return_items jsonb := '[]'::jsonb;
  v_return_item jsonb;
  v_return_item_id uuid;
  v_refund_breakdown jsonb := '[]'::jsonb;
  v_tender jsonb;
  v_tender_count integer;
  v_tender_index integer := 0;
  v_tender_allocated numeric := 0;
  v_tender_amount numeric;
  v_original_tender_total numeric := 0;
  v_charge record;
  v_reversed_amount numeric := 0;
begin
  if v_lodge_id is null or v_original_order_id is null or v_return_order_id is null
     or v_shift_id is null or v_pin is null
     or v_reason is null or v_key is null then
    return jsonb_build_object(
      'success', false,
      'error', 'order_id, return_order_id, lodge_id, shift_id, approver_id, approval PIN, reason and idempotency key are required'
    );
  end if;
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    return jsonb_build_object('success', false, 'error', 'At least one return line is required');
  end if;

  perform public.app_require_lodge_role(
    v_lodge_id,
    array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']
  );

  if v_approver_id is null then
    v_approver_id := public._pos_resolve_pin_internal(
      v_lodge_id, v_pin, 'pos.void', v_device_id
    );
  elsif not public._pos_validate_pin_internal(
    v_lodge_id, v_approver_id, v_pin, 'pos.void', v_device_id
  ) then
    v_approver_id := null;
  end if;
  if v_approver_id is null then
    return jsonb_build_object('success', false, 'error', 'Invalid PIN or unauthorized approver');
  end if;

  v_request_hash := encode(sha256(convert_to(payload::text, 'UTF8')), 'hex');
  v_claim := public._claim_financial_operation(
    v_lodge_id, v_key, 'create_pos_return_v3', v_return_order_id, v_request_hash
  );
  if coalesce((v_claim->>'found')::boolean, false) then
    return v_claim->'operation_result';
  end if;
  if coalesce(v_claim->>'success', 'true') <> 'true' then
    return jsonb_build_object(
      'success', false,
      'error', coalesce(v_claim->>'error', 'Idempotency conflict'),
      'code', 'idempotency_conflict'
    );
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_lodge_id::text || ':pos-return:' || v_original_order_id::text, 0)
  );

  select o.*
    into v_original
    from public.pos_orders o
   where o.id = v_original_order_id
     and o.lodge_id = v_lodge_id
   for update;

  if not found or v_original.transaction_type <> 'sale'
     or v_original.status in ('voided') then
    return jsonb_build_object('success', false, 'error', 'Original sale is not returnable');
  end if;

  if v_original.outlet_id is not null then
    perform public.app_require_pos_outlet_access(v_lodge_id, v_original.outlet_id);
  end if;

  select s.*
    into v_shift
    from public.pos_shifts s
   where s.id = v_shift_id
     and s.lodge_id = v_lodge_id
     and s.status = 'open'
   for update;
  if not found or v_shift.outlet_id is distinct from v_original.outlet_id then
    return jsonb_build_object('success', false, 'error', 'Return requires the current open shift for the original outlet');
  end if;

  perform 1
    from public.pos_return_lines r
   where r.lodge_id = v_lodge_id
     and r.original_order_id = v_original_order_id
   for update;

  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    v_line_id := nullif(v_line->>'line_id', '')::uuid;
    v_requested_qty := abs(coalesce(nullif(v_line->>'quantity', '')::numeric, 0));
    if v_line_id is null or v_requested_qty <= 0 then
      return jsonb_build_object('success', false, 'error', 'Each return line requires a valid line_id and positive quantity');
    end if;
    if v_requested_qty <> trunc(v_requested_qty) then
      return jsonb_build_object('success', false, 'error', 'Return quantities must be whole numbers');
    end if;

    select i.*
      into v_original_item
      from public.pos_order_items i
     where i.id = v_line_id
       and i.order_id = v_original_order_id
       and i.lodge_id = v_lodge_id
     for update;
    if not found then
      return jsonb_build_object('success', false, 'error', 'Original order line was not found');
    end if;

    select coalesce(sum(r.quantity), 0)
      into v_previous_qty
      from public.pos_return_lines r
     where r.lodge_id = v_lodge_id
       and r.original_order_item_id = v_line_id;
    v_new_qty := v_previous_qty + v_requested_qty;
    if v_new_qty > v_original_item.quantity then
      return jsonb_build_object(
        'success', false,
        'error', format('Return quantity exceeds the remaining quantity for %s', v_original_item.item_name)
      );
    end if;

    v_original_gross := coalesce(nullif(v_original_item.gross_subtotal, 0), v_original_item.quantity * v_original_item.unit_price);
    v_original_discount := coalesce(v_original_item.discount_allocated, 0);
    v_original_tax := coalesce(v_original_item.tax_allocated, 0);
    v_original_net := coalesce(nullif(v_original_item.net_subtotal, 0), nullif(v_original_item.subtotal, 0), v_original_gross);

    v_refund_gross :=
      round(v_original_gross * v_new_qty / v_original_item.quantity, 2)
      - round(v_original_gross * v_previous_qty / v_original_item.quantity, 2);
    v_refund_discount :=
      round(v_original_discount * v_new_qty / v_original_item.quantity, 2)
      - round(v_original_discount * v_previous_qty / v_original_item.quantity, 2);
    v_refund_tax :=
      round(v_original_tax * v_new_qty / v_original_item.quantity, 2)
      - round(v_original_tax * v_previous_qty / v_original_item.quantity, 2);
    v_refund_net :=
      round(v_original_net * v_new_qty / v_original_item.quantity, 2)
      - round(v_original_net * v_previous_qty / v_original_item.quantity, 2);

    v_total_gross := v_total_gross + v_refund_gross;
    v_total_discount := v_total_discount + v_refund_discount;
    v_total_tax := v_total_tax + v_refund_tax;
    v_total_refund := v_total_refund + v_refund_net;

    v_return_items := v_return_items || jsonb_build_array(jsonb_build_object(
      'original_order_item_id', v_line_id,
      'menu_item_id', v_original_item.menu_item_id,
      'item_name', 'Return: ' || v_original_item.item_name,
      'quantity', -v_requested_qty,
      'unit_price', v_original_item.unit_price,
      'subtotal', -v_refund_net,
      'inventory_item_id', v_original_item.inventory_item_id,
      'depletion_qty', v_original_item.depletion_qty,
      'category', v_original_item.category,
      'modifiers', v_original_item.modifiers,
      'gross_subtotal', -v_refund_gross,
      'discount_allocated', -v_refund_discount,
      'tax_allocated', -v_refund_tax,
      'net_subtotal', -v_refund_net
    ));
  end loop;

  v_total_refund := round(v_total_refund, 2);
  if v_total_refund <= 0 then
    return jsonb_build_object('success', false, 'error', 'Return value must be greater than zero');
  end if;

  if jsonb_typeof(v_original.payment_breakdown) = 'array'
     and jsonb_array_length(v_original.payment_breakdown) > 0 then
    select coalesce(sum(abs((value->>'amount')::numeric)), 0)
      into v_original_tender_total
      from jsonb_array_elements(v_original.payment_breakdown);
    v_tender_count := jsonb_array_length(v_original.payment_breakdown);
    for v_tender in select value from jsonb_array_elements(v_original.payment_breakdown)
    loop
      v_tender_index := v_tender_index + 1;
      if v_tender_index = v_tender_count then
        v_tender_amount := v_total_refund - v_tender_allocated;
      else
        v_tender_amount := case when v_original_tender_total > 0
          then round(v_total_refund * abs((v_tender->>'amount')::numeric) / v_original_tender_total, 2)
          else 0 end;
      end if;
      v_tender_allocated := v_tender_allocated + v_tender_amount;
      v_refund_breakdown := v_refund_breakdown || jsonb_build_array(jsonb_build_object(
        'method', coalesce(v_tender->>'method', v_original.payment_method, 'cash'),
        'amount', -v_tender_amount,
        'reference', v_tender->>'reference'
      ));
    end loop;
  else
    v_refund_breakdown := jsonb_build_array(jsonb_build_object(
      'method', coalesce(v_original.payment_method, 'cash'),
      'amount', -v_total_refund,
      'reference', null
    ));
  end if;

  if v_original.folio_charge_id is not null then
    select c.*
      into v_charge
      from public.booking_charges c
     where c.id = v_original.folio_charge_id
       and c.lodge_id = v_lodge_id
     for update;
    if not found then
      return jsonb_build_object('success', false, 'error', 'Original folio charge could not be locked');
    end if;

    perform 1
      from public.bookings b
     where b.id = v_charge.booking_id
       and b.lodge_id = v_lodge_id
     for update;

    select coalesce(sum(abs(c.amount)), 0)
      into v_reversed_amount
      from public.booking_charges c
     where c.reversal_of_charge_id = v_charge.id
       and c.voided_at is null;
    if v_reversed_amount + v_total_refund > v_charge.amount + 0.01 then
      return jsonb_build_object('success', false, 'error', 'Folio reversals would exceed the original charge');
    end if;
  end if;

  insert into public.pos_orders (
    id, lodge_id, room_id, booking_id, walk_in_name, status, total, notes,
    completed_at, payment_method, outlet_id, create_idempotency_key,
    gross_total, discount_total, tax_rate, tax_total, tip_total,
    payment_breakdown, cashier_id, cashier_name, shift_id, ticket_status,
    transaction_type, original_order_id, source_device_id,
    client_created_at, server_received_at
  ) values (
    v_return_order_id, v_lodge_id, v_original.room_id, v_original.booking_id,
    'Return: ' || coalesce(v_original.walk_in_name, 'Guest'), 'completed',
    -v_total_refund, v_reason, now(), v_original.payment_method,
    v_original.outlet_id, v_key, -v_total_gross, -v_total_discount,
    v_original.tax_rate, -v_total_tax, 0, v_refund_breakdown,
    coalesce(v_actor_id, v_shift.cashier_id),
    (select u.name from public.users u where u.id = coalesce(v_actor_id, v_shift.cashier_id)),
    v_shift_id, 'new', 'return', v_original_order_id, v_device_id, now(), now()
  );

  for v_return_item in select value from jsonb_array_elements(v_return_items)
  loop
    insert into public.pos_order_items (
      lodge_id, order_id, menu_item_id, item_name, quantity, unit_price,
      subtotal, inventory_item_id, depletion_qty, category, modifiers,
      gross_subtotal, discount_allocated, tax_allocated, net_subtotal
    ) values (
      v_lodge_id, v_return_order_id,
      nullif(v_return_item->>'menu_item_id', '')::uuid,
      v_return_item->>'item_name',
      (v_return_item->>'quantity')::integer,
      (v_return_item->>'unit_price')::numeric,
      (v_return_item->>'subtotal')::numeric,
      nullif(v_return_item->>'inventory_item_id', '')::uuid,
      (v_return_item->>'depletion_qty')::numeric,
      v_return_item->>'category',
      coalesce(v_return_item->'modifiers', '[]'::jsonb),
      (v_return_item->>'gross_subtotal')::numeric,
      (v_return_item->>'discount_allocated')::numeric,
      (v_return_item->>'tax_allocated')::numeric,
      (v_return_item->>'net_subtotal')::numeric
    )
    returning id into v_return_item_id;

    insert into public.pos_return_lines (
      lodge_id, original_order_id, original_order_item_id,
      return_order_id, return_order_item_id, quantity
    ) values (
      v_lodge_id, v_original_order_id,
      nullif(v_return_item->>'original_order_item_id', '')::uuid,
      v_return_order_id, v_return_item_id,
      abs((v_return_item->>'quantity')::numeric)
    );

    if nullif(v_return_item->>'inventory_item_id', '') is not null then
      update public.inventory_items
         set current_stock = current_stock
           + abs((v_return_item->>'quantity')::numeric)
           * public._positive_depletion_qty((v_return_item->>'depletion_qty')::numeric, 1),
             updated_at = now()
       where id = nullif(v_return_item->>'inventory_item_id', '')::uuid
         and lodge_id = v_lodge_id;
    end if;
  end loop;

  if v_original.folio_charge_id is not null then
    insert into public.booking_charges (
      lodge_id, booking_id, description, amount, category, quantity,
      outlet_id, source_type, source_id, reversal_of_charge_id
    ) values (
      v_lodge_id, v_original.booking_id,
      'POS return ' || left(v_return_order_id::text, 8),
      -v_total_refund, 'pos_return', 1, v_original.outlet_id,
      'pos_return', v_return_order_id, v_original.folio_charge_id
    );
  end if;

  insert into public.pos_override_log (
    id, lodge_id, order_id, action, requested_by, approved_by,
    reason, outlet_id, created_at, return_order_id, return_total
  ) values (
    coalesce(nullif(payload->>'override_log_id', '')::uuid, gen_random_uuid()),
    v_lodge_id, v_original_order_id, 'partial_return', v_actor_id,
    v_approver_id, v_reason, v_original.outlet_id, now(),
    v_return_order_id, v_total_refund
  );

  insert into public.pos_audit_log (
    lodge_id, outlet_id, shift_id, order_id, actor_id, operator_id,
    approver_id, device_id, action, entity_type, entity_id, staff_id,
    amount_delta, idempotency_key, after_snapshot, details
  ) values (
    v_lodge_id, v_original.outlet_id, v_shift_id, v_return_order_id,
    v_actor_id, coalesce(v_actor_id, v_shift.cashier_id), v_approver_id,
    v_device_id, 'pos_return_created', 'pos_return', v_return_order_id,
    v_approver_id, -v_total_refund, v_key,
    jsonb_build_object(
      'original_order_id', v_original_order_id,
      'total', -v_total_refund,
      'payment_breakdown', v_refund_breakdown,
      'items', v_return_items
    ),
    jsonb_build_object('reason', v_reason)
  );

  v_result := jsonb_build_object(
    'success', true,
    'id', v_return_order_id,
    'original_order_id', v_original_order_id,
    'total', -v_total_refund,
    'gross_total', -v_total_gross,
    'discount_total', -v_total_discount,
    'tax_total', -v_total_tax,
    'payment_breakdown', v_refund_breakdown,
    'shift_id', v_shift_id,
    'approved_by', v_approver_id,
    'approver_name', (select u.name from public.users u where u.id = v_approver_id),
    'items', v_return_items
  );

  perform public._record_financial_operation(
    v_lodge_id, v_key, 'create_pos_return_v3',
    v_return_order_id, v_request_hash, v_result
  );
  return v_result;
end;
$$;

revoke all on function public.create_pos_return_v3(jsonb) from public;
grant execute on function public.create_pos_return_v3(jsonb)
  to anon, authenticated, service_role;

create or replace function public.approve_pos_void_with_pin(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_order_id uuid := nullif(payload->>'order_id', '')::uuid;
  v_approver_id uuid := nullif(payload->>'approved_by', '')::uuid;
  v_pin text := nullif(btrim(coalesce(payload->>'pin', '')), '');
  v_reason text := nullif(btrim(coalesce(payload->>'reason', '')), '');
  v_device_id text := coalesce(nullif(payload->>'device_id', ''), 'unknown');
  v_override_id uuid := coalesce(nullif(payload->>'override_log_id', '')::uuid, gen_random_uuid());
  v_actor_id uuid := public.app_current_user_id();
  v_order record;
  v_restored jsonb := '[]'::jsonb;
begin
  if v_lodge_id is null or v_order_id is null or v_pin is null or v_reason is null then
    return jsonb_build_object(
      'success', false,
      'error', 'lodge_id, order_id, PIN and reason are required'
    );
  end if;

  perform public.app_require_lodge_role(
    v_lodge_id,
    array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']
  );

  if exists (
    select 1
      from public.pos_override_log l
     where l.id = v_override_id
       and l.lodge_id = v_lodge_id
       and l.order_id = v_order_id
       and l.action = 'void'
  ) then
    return jsonb_build_object(
      'success', true,
      'id', v_order_id,
      'override_log_id', v_override_id,
      'already_applied', true
    );
  end if;

  select o.*
    into v_order
    from public.pos_orders o
   where o.id = v_order_id
     and o.lodge_id = v_lodge_id
   for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Order not found');
  end if;
  if v_order.status = 'voided' then
    return jsonb_build_object('success', false, 'error', 'Order is already voided');
  end if;
  if v_order.status = 'settled' then
    return jsonb_build_object('success', false, 'error', 'Settled orders must be returned in the current shift, not voided');
  end if;

  if v_order.outlet_id is not null then
    perform public.app_require_pos_outlet_access(v_lodge_id, v_order.outlet_id);
  end if;

  if v_approver_id is null then
    v_approver_id := public._pos_resolve_pin_internal(
      v_lodge_id, v_pin, 'pos.void', v_device_id
    );
  elsif not public._pos_validate_pin_internal(
    v_lodge_id, v_approver_id, v_pin, 'pos.void', v_device_id
  ) then
    v_approver_id := null;
  end if;
  if v_approver_id is null then
    return jsonb_build_object('success', false, 'error', 'Invalid PIN or unauthorized approver');
  end if;

  v_restored := public._restore_pos_order_stock(v_order_id, v_lodge_id);

  if v_order.folio_charge_id is not null then
    perform public.delete_booking_charge(
      v_order.folio_charge_id, v_lodge_id, 'Voided with POS order'
    );
  end if;

  update public.pos_orders
     set status = 'voided',
         updated_at = now()
   where id = v_order_id;

  insert into public.pos_override_log (
    id, lodge_id, order_id, action, requested_by, approved_by,
    reason, outlet_id, created_at
  ) values (
    v_override_id, v_lodge_id, v_order_id, 'void', v_actor_id,
    v_approver_id, v_reason, v_order.outlet_id, now()
  );

  insert into public.pos_audit_log (
    lodge_id, outlet_id, shift_id, order_id, actor_id, operator_id,
    approver_id, device_id, action, entity_type, entity_id, staff_id,
    amount_delta, before_snapshot, after_snapshot, details
  ) values (
    v_lodge_id, v_order.outlet_id, v_order.shift_id, v_order_id,
    v_actor_id, v_order.cashier_id, v_approver_id, v_device_id,
    'pos_order_voided', 'pos_order', v_order_id, v_approver_id,
    -v_order.total,
    jsonb_build_object('status', v_order.status, 'total', v_order.total),
    jsonb_build_object('status', 'voided'),
    jsonb_build_object('reason', v_reason, 'restored_stock', v_restored)
  );

  return jsonb_build_object(
    'success', true,
    'id', v_order_id,
    'override_log_id', v_override_id,
    'approved_by', v_approver_id,
    'approver_name', (select u.name from public.users u where u.id = v_approver_id),
    'restored_stock', v_restored
  );
end;
$$;

revoke all on function public.approve_pos_void_with_pin(jsonb) from public;
grant execute on function public.approve_pos_void_with_pin(jsonb)
  to anon, authenticated, service_role;

create or replace function public.get_pos_shift_cashup_preview_v2(
  p_shift_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_shift record;
  v_expected_by_method jsonb := '{}'::jsonb;
  v_gross_sales numeric := 0;
  v_discounts numeric := 0;
  v_tax numeric := 0;
  v_tips numeric := 0;
  v_returns numeric := 0;
  v_net_sales numeric := 0;
  v_order_count integer := 0;
  v_return_count integer := 0;
  v_void_count integer := 0;
  v_expected_cash numeric := 0;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']
  );

  select s.*
    into v_shift
    from public.pos_shifts s
   where s.id = p_shift_id
     and s.lodge_id = p_lodge_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Shift not found');
  end if;

  select
    coalesce(sum(case when o.transaction_type = 'sale' and o.status <> 'voided' then o.gross_total else 0 end), 0),
    coalesce(sum(case when o.transaction_type = 'sale' and o.status <> 'voided' then o.discount_total else 0 end), 0),
    coalesce(sum(case when o.transaction_type = 'sale' and o.status <> 'voided' then o.tax_total else 0 end), 0),
    coalesce(sum(case when o.transaction_type = 'sale' and o.status <> 'voided' then o.tip_total else 0 end), 0),
    coalesce(sum(case when o.transaction_type = 'return' and o.status <> 'voided' then abs(o.total) else 0 end), 0),
    coalesce(sum(case when o.status <> 'voided' then o.total else 0 end), 0),
    count(*) filter (where o.transaction_type = 'sale' and o.status <> 'voided'),
    count(*) filter (where o.transaction_type = 'return' and o.status <> 'voided'),
    count(*) filter (where o.status = 'voided')
  into
    v_gross_sales, v_discounts, v_tax, v_tips, v_returns, v_net_sales,
    v_order_count, v_return_count, v_void_count
  from public.pos_orders o
  where o.shift_id = p_shift_id
    and o.lodge_id = p_lodge_id
    and o.status in ('completed', 'settled', 'voided');

  select coalesce(jsonb_object_agg(t.method, t.amount), '{}'::jsonb)
    into v_expected_by_method
    from (
      select method, round(sum(amount), 2) as amount
      from (
        select
          lower(coalesce(p.value->>'method', o.payment_method, 'cash')) as method,
          coalesce((p.value->>'amount')::numeric, o.total, 0) as amount
        from public.pos_orders o
        cross join lateral jsonb_array_elements(
          case
            when jsonb_typeof(o.payment_breakdown) = 'array'
             and jsonb_array_length(o.payment_breakdown) > 0
              then o.payment_breakdown
            else jsonb_build_array(jsonb_build_object(
              'method', coalesce(o.payment_method, 'cash'),
              'amount', o.total
            ))
          end
        ) p(value)
        where o.shift_id = p_shift_id
          and o.lodge_id = p_lodge_id
          and o.status in ('completed', 'settled')
      ) x
      group by method
    ) t;

  v_expected_cash := round(
    coalesce(v_shift.opening_float, 0)
    + coalesce((v_expected_by_method->>'cash')::numeric, 0),
    2
  );

  return jsonb_build_object(
    'success', true,
    'shift_id', p_shift_id,
    'status', v_shift.status,
    'business_date', public.get_lodge_business_date(p_lodge_id),
    'opening_float', coalesce(v_shift.opening_float, 0),
    'gross_sales', round(v_gross_sales, 2),
    'discounts', round(v_discounts, 2),
    'vat', round(v_tax, 2),
    'tips', round(v_tips, 2),
    'returns', round(v_returns, 2),
    'net_sales', round(v_net_sales, 2),
    'expected_by_method', v_expected_by_method,
    'expected_cash_drawer', v_expected_cash,
    'order_count', v_order_count,
    'return_count', v_return_count,
    'void_count', v_void_count
  );
end;
$$;

revoke all on function public.get_pos_shift_cashup_preview_v2(uuid, uuid) from public;
grant execute on function public.get_pos_shift_cashup_preview_v2(uuid, uuid)
  to anon, authenticated, service_role;

create or replace function public.finalize_pos_shift_cashup_v2(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_shift_id uuid := nullif(payload->>'shift_id', '')::uuid;
  v_cashup_id uuid := coalesce(nullif(payload->>'cashup_id', '')::uuid, gen_random_uuid());
  v_key text := nullif(btrim(coalesce(payload->>'idempotency_key', '')), '');
  v_counted jsonb := coalesce(payload->'counted_by_method', '{}'::jsonb);
  v_notes text := nullif(payload->>'notes', '');
  v_actor_id uuid := public.app_current_user_id();
  v_shift record;
  v_preview jsonb;
  v_expected jsonb;
  v_variance jsonb;
  v_request_hash text;
  v_claim jsonb;
  v_result jsonb;
begin
  if v_lodge_id is null or v_shift_id is null or v_key is null then
    return jsonb_build_object(
      'success', false,
      'error', 'lodge_id, shift_id and idempotency_key are required'
    );
  end if;
  if jsonb_typeof(v_counted) <> 'object' then
    return jsonb_build_object('success', false, 'error', 'counted_by_method must be an object');
  end if;

  perform public.app_require_lodge_role(
    v_lodge_id,
    array['supervisor', 'manager', 'admin', 'super_admin']
  );

  v_request_hash := encode(sha256(convert_to(payload::text, 'UTF8')), 'hex');
  v_claim := public._claim_financial_operation(
    v_lodge_id, v_key, 'finalize_pos_shift_cashup_v2', v_cashup_id, v_request_hash
  );
  if coalesce((v_claim->>'found')::boolean, false) then
    return v_claim->'operation_result';
  end if;
  if coalesce(v_claim->>'success', 'true') <> 'true' then
    return jsonb_build_object(
      'success', false,
      'error', coalesce(v_claim->>'error', 'Idempotency conflict'),
      'code', 'idempotency_conflict'
    );
  end if;

  select s.*
    into v_shift
    from public.pos_shifts s
   where s.id = v_shift_id
     and s.lodge_id = v_lodge_id
   for update;
  if not found or v_shift.status <> 'open' then
    return jsonb_build_object('success', false, 'error', 'Shift is not open');
  end if;

  v_preview := public.get_pos_shift_cashup_preview_v2(v_shift_id, v_lodge_id);
  if coalesce((v_preview->>'success')::boolean, false) = false then
    return v_preview;
  end if;
  v_expected := coalesce(v_preview->'expected_by_method', '{}'::jsonb);

  select coalesce(
    jsonb_object_agg(
      methods.method,
      round(
        coalesce((v_counted->>methods.method)::numeric, 0)
        - coalesce((v_expected->>methods.method)::numeric, 0),
        2
      )
    ),
    '{}'::jsonb
  )
    into v_variance
    from (
      select jsonb_object_keys(v_counted) as method
      union
      select jsonb_object_keys(v_expected) as method
    ) methods;

  -- Cash is a drawer count, so its expectation includes the opening float.
  v_variance := jsonb_set(
    v_variance,
    '{cash}',
    to_jsonb(round(
      coalesce((v_counted->>'cash')::numeric, 0)
      - (v_preview->>'expected_cash_drawer')::numeric,
      2
    )),
    true
  );

  insert into public.pos_cashup_sessions (
    id, lodge_id, date, outlet_id, opening_float, expected_cash_drawer,
    expected_by_method, counted_by_method, variance_by_method, cash_over_short,
    orders_count, void_count, pending_count, gross_sales, returns_total,
    net_sales, notes, created_by, created_by_name, cashier_id, cashier_name,
    created_at, shift_id, idempotency_key
  ) values (
    v_cashup_id, v_lodge_id, (v_preview->>'business_date')::date,
    v_shift.outlet_id, coalesce(v_shift.opening_float, 0),
    (v_preview->>'expected_cash_drawer')::numeric,
    v_expected, v_counted, v_variance,
    coalesce((v_variance->>'cash')::numeric, 0),
    (v_preview->>'order_count')::integer,
    (v_preview->>'void_count')::integer,
    0, (v_preview->>'gross_sales')::numeric,
    (v_preview->>'returns')::numeric,
    (v_preview->>'net_sales')::numeric,
    v_notes, v_actor_id,
    (select u.name from public.users u where u.id = v_actor_id),
    v_shift.cashier_id, v_shift.cashier_name, now(), v_shift_id, v_key
  );

  update public.pos_shifts
     set status = 'closed',
         closed_at = now(),
         closing_cash = coalesce((v_counted->>'cash')::numeric, 0),
         close_notes = v_notes,
         close_idempotency_key = v_key
   where id = v_shift_id;

  update public.pos_orders
     set status = 'settled'
   where shift_id = v_shift_id
     and lodge_id = v_lodge_id
     and status = 'completed';

  insert into public.pos_audit_log (
    lodge_id, outlet_id, shift_id, actor_id, operator_id, action,
    entity_type, entity_id, staff_id, amount_delta, idempotency_key,
    after_snapshot, details
  ) values (
    v_lodge_id, v_shift.outlet_id, v_shift_id, v_actor_id,
    v_shift.cashier_id, 'cashup_finalized', 'pos_cashup', v_cashup_id,
    v_actor_id, coalesce((v_variance->>'cash')::numeric, 0), v_key,
    jsonb_build_object(
      'preview', v_preview,
      'counted_by_method', v_counted,
      'variance_by_method', v_variance
    ),
    jsonb_build_object('notes', v_notes)
  );

  v_result := jsonb_build_object(
    'success', true,
    'cashup_id', v_cashup_id,
    'shift_id', v_shift_id,
    'business_date', v_preview->>'business_date',
    'expected_cash_drawer', v_preview->'expected_cash_drawer',
    'expected_by_method', v_expected,
    'counted_by_method', v_counted,
    'variance_by_method', v_variance,
    'preview', v_preview
  );

  perform public._record_financial_operation(
    v_lodge_id, v_key, 'finalize_pos_shift_cashup_v2',
    v_cashup_id, v_request_hash, v_result
  );
  return v_result;
end;
$$;

revoke all on function public.finalize_pos_shift_cashup_v2(jsonb) from public;
grant execute on function public.finalize_pos_shift_cashup_v2(jsonb)
  to anon, authenticated, service_role;

-- Client roles remain read-only on critical financial state.
revoke insert, update, delete on
  public.pos_orders,
  public.pos_order_items,
  public.pos_return_lines,
  public.booking_charges,
  public.payments,
  public.inventory_items,
  public.inventory_movements,
  public.pos_cashup_sessions,
  public.pos_shifts,
  public.pos_override_log,
  public.pos_audit_log
from anon, authenticated;

commit;
