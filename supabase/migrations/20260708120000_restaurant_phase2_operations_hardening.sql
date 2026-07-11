begin;

alter table public.pos_modifier_groups
  add column if not exists min_selections integer not null default 0,
  add column if not exists max_selections integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pos_modifier_groups_min_selections_nonnegative'
  ) then
    alter table public.pos_modifier_groups
      add constraint pos_modifier_groups_min_selections_nonnegative
      check (min_selections >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'pos_modifier_groups_max_selections_valid'
  ) then
    alter table public.pos_modifier_groups
      add constraint pos_modifier_groups_max_selections_valid
      check (max_selections >= 0 and (max_selections = 0 or max_selections >= min_selections));
  end if;
end $$;

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
  v_min integer;
  v_max integer;
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

    v_min := greatest(0, coalesce(nullif(v_group->>'min_selections', '')::integer, 0));
    v_max := greatest(0, coalesce(nullif(v_group->>'max_selections', '')::integer, 0));
    if v_max <> 0 and v_max < v_min then
      return jsonb_build_object('success', false, 'error', 'Modifier maximum selections cannot be below minimum selections');
    end if;

    insert into public.pos_modifier_groups (
      id, lodge_id, name, applies_to_categories,
      min_selections, max_selections, options, active, updated_at
    ) values (
      coalesce(nullif(v_group->>'id', '')::uuid, gen_random_uuid()),
      v_lodge_id,
      btrim(v_group->>'name'),
      coalesce(
        array(select jsonb_array_elements_text(coalesce(v_group->'applies_to_categories', '[]'::jsonb))),
        '{}'::text[]
      ),
      v_min,
      v_max,
      coalesce(v_group->'options', '[]'::jsonb),
      coalesce((v_group->>'active')::boolean, true),
      now()
    )
    on conflict (id) do update set
      name = excluded.name,
      applies_to_categories = excluded.applies_to_categories,
      min_selections = excluded.min_selections,
      max_selections = excluded.max_selections,
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

create or replace function public.approve_pos_discount_with_pin(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_requested_by uuid := nullif(payload->>'requested_by', '')::uuid;
  v_approval_id uuid := coalesce(nullif(payload->>'approval_id', '')::uuid, gen_random_uuid());
  v_pin text := btrim(coalesce(payload->>'pin', ''));
  v_device_id text := coalesce(nullif(btrim(payload->>'device_id'), ''), 'unknown');
  v_reason text := btrim(coalesce(payload->>'reason', ''));
  v_discount_type text := lower(coalesce(nullif(payload->>'discount_type', ''), 'amount'));
  v_discount_value numeric := coalesce(nullif(payload->>'discount_value', '')::numeric, 0);
  v_discount_amount numeric := coalesce(nullif(payload->>'discount_amount', '')::numeric, 0);
  v_created_at timestamptz := coalesce(nullif(payload->>'created_at', '')::timestamptz, now());
  v_approved_by uuid;
  v_approver_name text;
begin
  perform public.app_require_lodge_role(
    v_lodge_id,
    array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']
  );

  if v_pin = '' then
    return jsonb_build_object('success', false, 'error', 'Manager PIN is required');
  end if;
  if v_reason = '' then
    return jsonb_build_object('success', false, 'error', 'A reason for the discount is required');
  end if;
  if v_discount_type not in ('amount', 'percent') then
    return jsonb_build_object('success', false, 'error', 'Discount type must be amount or percent');
  end if;
  if v_discount_value <= 0 or v_discount_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'Discount value must be greater than zero');
  end if;
  if v_outlet_id is not null and not exists (
    select 1 from public.pos_outlets o
     where o.id = v_outlet_id
       and o.lodge_id = v_lodge_id
       and coalesce(o.active, true) = true
  ) then
    return jsonb_build_object('success', false, 'error', 'Outlet not found for this lodge');
  end if;

  v_approved_by := public._pos_resolve_pin_internal(v_lodge_id, v_pin, 'pos.discount', v_device_id);
  if v_approved_by is null then
    return jsonb_build_object('success', false, 'error', 'Invalid PIN or unauthorized approver');
  end if;

  select coalesce(nullif(u.name, ''), nullif(u.email, ''), 'Manager')
    into v_approver_name
    from public.users u
   where u.id = v_approved_by;

  insert into public.pos_audit_log (
    lodge_id, outlet_id, actor_id, operator_id, approver_id,
    device_id, action, entity_type, entity_id, staff_id, amount_delta,
    idempotency_key, client_at, after_snapshot, details
  ) values (
    v_lodge_id, v_outlet_id, v_requested_by, v_requested_by, v_approved_by,
    v_device_id, 'pos_discount_approved', 'pos_discount_approval', v_approval_id, v_approved_by, -v_discount_amount,
    v_approval_id::text, v_created_at,
    payload - 'pin',
    jsonb_build_object(
      'approval_id', v_approval_id,
      'requested_by', v_requested_by,
      'approved_by', v_approved_by,
      'approver_name', v_approver_name,
      'discount_type', v_discount_type,
      'discount_value', v_discount_value,
      'discount_amount', v_discount_amount,
      'reason', v_reason
    )
  );

  return jsonb_build_object(
    'success', true,
    'approval_id', v_approval_id,
    'approved_by', v_approved_by,
    'approver_name', coalesce(v_approver_name, 'Manager'),
    'discount_type', v_discount_type,
    'discount_value', v_discount_value,
    'discount_amount', v_discount_amount
  );
end;
$$;

revoke all on function public.approve_pos_discount_with_pin(jsonb) from public;
grant execute on function public.approve_pos_discount_with_pin(jsonb)
  to anon, authenticated, service_role;

commit;
