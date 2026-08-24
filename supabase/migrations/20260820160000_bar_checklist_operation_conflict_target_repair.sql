-- 2026-08-20 — Repair Bar checklist retry conflict targeting.
--
-- restaurant_checklists uses a partial unique index because legacy rows may
-- have a null operation_id. PostgreSQL cannot infer that index from
-- ON CONFLICT (lodge_id, operation_id) alone, so the first checklist create
-- failed before inserting anything (SQLSTATE 42P10). Keep the nullable legacy
-- shape and make the conflict target match the deployed partial index.

begin;

create or replace function public.create_bar_checklist_from_template(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(p_payload->>'lodge_id', '')::uuid;
  v_template_key text := btrim(coalesce(p_payload->>'template_key', ''));
  v_outlet_id uuid := nullif(p_payload->>'outlet_id', '')::uuid;
  v_operation_id text := nullif(btrim(coalesce(p_payload->>'operation_id', '')), '');
  v_template public.restaurant_checklist_templates%rowtype;
  v_id uuid := gen_random_uuid();
  v_existing_id uuid;
  v_existing_hash text;
  v_payload_hash text;
  v_item jsonb;
  v_actor uuid;
begin
  v_actor := public._bar_control_require_capability(v_lodge_id, 'pos.manage');
  if v_template_key not in ('bar_opening','bar_closing','bar_end_of_shift','bar_weekly_deep_clean') then
    return jsonb_build_object('success', false, 'error', 'That Bar checklist template is not recognised.');
  end if;
  if v_operation_id is null
     or length(v_operation_id) < 8
     or length(v_operation_id) > 128
     or v_operation_id !~ '^[A-Za-z0-9:_-]+$' then
    return jsonb_build_object('success', false, 'error', 'A stable checklist operation ID is required for safe retry.');
  end if;
  if v_outlet_id is not null then
    perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);
  end if;
  v_payload_hash := encode(
    extensions.digest(
      convert_to(jsonb_build_object('template_key', v_template_key, 'outlet_id', v_outlet_id)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  perform pg_advisory_xact_lock(hashtext(v_lodge_id::text || ':' || v_operation_id));
  select id, payload_hash
    into v_existing_id, v_existing_hash
    from public.restaurant_checklists
   where lodge_id = v_lodge_id
     and operation_id = v_operation_id
   limit 1;
  if v_existing_id is not null then
    if v_existing_hash is distinct from v_payload_hash then
      return jsonb_build_object(
        'success', false,
        'error', 'This checklist operation ID was already used with a different template or outlet.',
        'conflict', true
      );
    end if;
    return jsonb_build_object(
      'success', true,
      'checklist_id', v_existing_id,
      'operation_id', v_operation_id,
      'replayed', true
    );
  end if;
  select *
    into v_template
    from public.restaurant_checklist_templates
   where lodge_id = v_lodge_id
     and template_key = v_template_key
     and active;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Seed the Bar checklist templates before creating an instance.');
  end if;
  insert into public.restaurant_checklists (
    id, lodge_id, checklist_type, status, template_id, template_key,
    outlet_id, created_by, operation_id, payload_hash
  )
  values (
    v_id, v_lodge_id, v_template.checklist_type, 'pending', v_template.id,
    v_template.template_key, v_outlet_id, v_actor, v_operation_id, v_payload_hash
  )
  on conflict (lodge_id, operation_id) where operation_id is not null do nothing;
  if not found then
    select id, payload_hash
      into v_existing_id, v_existing_hash
      from public.restaurant_checklists
     where lodge_id = v_lodge_id
       and operation_id = v_operation_id;
    if v_existing_hash is distinct from v_payload_hash then
      return jsonb_build_object(
        'success', false,
        'error', 'This checklist operation ID was already used with a different template or outlet.',
        'conflict', true
      );
    end if;
    return jsonb_build_object(
      'success', true,
      'checklist_id', v_existing_id,
      'operation_id', v_operation_id,
      'replayed', true
    );
  end if;
  for v_item in select * from jsonb_array_elements(v_template.items) loop
    insert into public.restaurant_checklist_items (checklist_id, item_label)
    values (v_id, btrim(coalesce(v_item->>'label', '')));
  end loop;
  return jsonb_build_object(
    'success', true,
    'checklist_id', v_id,
    'template_key', v_template_key,
    'operation_id', v_operation_id
  );
end;
$$;

revoke all on function public.create_bar_checklist_from_template(jsonb) from public;
grant execute on function public.create_bar_checklist_from_template(jsonb)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
