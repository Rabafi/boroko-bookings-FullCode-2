-- Barcode setup must remain authoritative even when a stale desktop/POS
-- catalogue or a second operator writes directly through an RPC.  Keep this
-- migration additive: deployed migrations are never edited in place.

create or replace function public.normalize_pos_barcode(p_value text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $$
declare
  v_value text := nullif(btrim(coalesce(p_value, '')), '');
  v_index integer;
  v_code integer;
begin
  if v_value is null then
    return null;
  end if;

  if char_length(v_value) > 128 then
    raise exception 'Barcode must be 128 characters or fewer.'
      using errcode = '22023';
  end if;

  -- PostgreSQL text cannot contain a NUL byte, but the remaining ASCII
  -- controls (including CR/LF) can arrive from a badly configured scanner.
  for v_index in 1..char_length(v_value) loop
    v_code := ascii(substr(v_value, v_index, 1));
    if v_code < 32 or v_code = 127 then
      raise exception 'Barcode contains unsupported control characters.'
        using errcode = '22023';
    end if;
  end loop;

  return v_value;
end;
$$;

revoke all on function public.normalize_pos_barcode(text) from public;

create or replace function public.validate_inventory_barcode_assignment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_barcode text;
  v_conflict record;
begin
  v_barcode := public.normalize_pos_barcode(new.barcode);
  new.barcode := v_barcode;

  if v_barcode is null then
    return new;
  end if;

  -- The table name and entity type are part of the lock key so that an
  -- inventory barcode and its corresponding sellable menu barcode may share
  -- the same physical code, while two records in the same catalogue cannot.
  perform pg_advisory_xact_lock(hashtextextended(
    format('pos-barcode:inventory:%s:%s', new.lodge_id, v_barcode), 0
  ));

  select ii.id,
         ii.name,
         ii.outlet_id,
         o.name as outlet_name
    into v_conflict
    from public.inventory_items ii
    left join public.outlets o on o.id = ii.outlet_id
   where ii.lodge_id = new.lodge_id
     and ii.id is distinct from new.id
     and coalesce(ii.is_active, true)
     and nullif(btrim(ii.barcode), '') = v_barcode
     and (new.outlet_id is null or ii.outlet_id is null or ii.outlet_id = new.outlet_id)
   limit 1;

  if found then
    raise exception 'barcode_conflict: Barcode is already assigned to inventory item "%"%s.',
      v_conflict.name,
      case when v_conflict.outlet_name is null then '' else format(' at outlet "%s"', v_conflict.outlet_name) end
      using errcode = '23505',
            detail = json_build_object(
              'code', 'barcode_conflict',
              'entity_type', 'inventory',
              'id', v_conflict.id,
              'outlet_id', v_conflict.outlet_id
            )::text;
  end if;

  return new;
end;
$$;

create or replace function public.validate_pos_menu_barcode_assignment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_barcode text;
  v_conflict record;
begin
  v_barcode := public.normalize_pos_barcode(new.barcode);
  new.barcode := v_barcode;

  if v_barcode is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    format('pos-barcode:menu:%s:%s', new.lodge_id, v_barcode), 0
  ));

  select mi.id,
         mi.name,
         mi.outlet_id,
         o.name as outlet_name
    into v_conflict
    from public.pos_menu_items mi
    left join public.outlets o on o.id = mi.outlet_id
   where mi.lodge_id = new.lodge_id
     and mi.id is distinct from new.id
     and coalesce(mi.is_available, true)
     and mi.archived_at is null
     and nullif(btrim(mi.barcode), '') = v_barcode
     and (new.outlet_id is null or mi.outlet_id is null or mi.outlet_id = new.outlet_id)
   limit 1;

  if found then
    raise exception 'barcode_conflict: Barcode is already assigned to menu item "%"%s.',
      v_conflict.name,
      case when v_conflict.outlet_name is null then '' else format(' at outlet "%s"', v_conflict.outlet_name) end
      using errcode = '23505',
            detail = json_build_object(
              'code', 'barcode_conflict',
              'entity_type', 'menu',
              'id', v_conflict.id,
              'outlet_id', v_conflict.outlet_id
            )::text;
  end if;

  return new;
end;
$$;

drop trigger if exists inventory_items_barcode_guard on public.inventory_items;
create trigger inventory_items_barcode_guard
before insert or update of barcode, outlet_id, lodge_id, is_active
on public.inventory_items
for each row execute function public.validate_inventory_barcode_assignment();

drop trigger if exists pos_menu_items_barcode_guard on public.pos_menu_items;
create trigger pos_menu_items_barcode_guard
before insert or update of barcode, outlet_id, lodge_id, is_available, archived_at
on public.pos_menu_items
for each row execute function public.validate_pos_menu_barcode_assignment();

create index if not exists idx_inventory_items_lodge_barcode_outlet_active
  on public.inventory_items (lodge_id, barcode, outlet_id)
  where barcode is not null and coalesce(is_active, true);

create index if not exists idx_pos_menu_items_lodge_barcode_outlet_active
  on public.pos_menu_items (lodge_id, barcode, outlet_id)
  where barcode is not null and coalesce(is_available, true) and archived_at is null;

create or replace function public.check_barcode_assignment(
  p_lodge_id uuid,
  p_barcode text,
  p_outlet_id uuid default null,
  p_entity_type text default 'menu',
  p_exclude_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_barcode text;
  v_entity text := lower(btrim(coalesce(p_entity_type, 'menu')));
  v_conflicts jsonb := '[]'::jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  if v_entity not in ('inventory', 'menu') then
    return jsonb_build_object('success', false, 'code', 'invalid_entity_type', 'error', 'Choose inventory or menu.');
  end if;

  begin
    v_barcode := public.normalize_pos_barcode(p_barcode);
  exception when others then
    return jsonb_build_object('success', false, 'code', 'invalid_barcode', 'error', sqlerrm);
  end;

  if v_barcode is null then
    return jsonb_build_object('success', true, 'available', true, 'normalized_barcode', null, 'conflicts', '[]'::jsonb);
  end if;

  if v_entity = 'inventory' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id,
      'name', q.name,
      'outlet_id', q.outlet_id,
      'outlet_name', q.outlet_name,
      'entity_type', 'inventory'
    ) order by q.name), '[]'::jsonb)
      into v_conflicts
      from (
        select ii.id, ii.name, ii.outlet_id, o.name as outlet_name
          from public.inventory_items ii
          left join public.outlets o on o.id = ii.outlet_id
         where ii.lodge_id = p_lodge_id
           and ii.id is distinct from p_exclude_id
           and coalesce(ii.is_active, true)
           and nullif(btrim(ii.barcode), '') = v_barcode
           and (p_outlet_id is null or ii.outlet_id is null or ii.outlet_id = p_outlet_id)
      ) q;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id,
      'name', q.name,
      'outlet_id', q.outlet_id,
      'outlet_name', q.outlet_name,
      'entity_type', 'menu'
    ) order by q.name), '[]'::jsonb)
      into v_conflicts
      from (
        select mi.id, mi.name, mi.outlet_id, o.name as outlet_name
          from public.pos_menu_items mi
          left join public.outlets o on o.id = mi.outlet_id
         where mi.lodge_id = p_lodge_id
           and mi.id is distinct from p_exclude_id
           and coalesce(mi.is_available, true)
           and mi.archived_at is null
           and nullif(btrim(mi.barcode), '') = v_barcode
           and (p_outlet_id is null or mi.outlet_id is null or mi.outlet_id = p_outlet_id)
      ) q;
  end if;

  return jsonb_build_object(
    'success', true,
    'available', jsonb_array_length(v_conflicts) = 0,
    'normalized_barcode', v_barcode,
    'conflicts', v_conflicts
  );
end;
$$;

revoke all on function public.validate_inventory_barcode_assignment() from public;
revoke all on function public.validate_pos_menu_barcode_assignment() from public;
revoke all on function public.check_barcode_assignment(uuid, text, uuid, text, uuid) from public;
grant execute on function public.check_barcode_assignment(uuid, text, uuid, text, uuid) to authenticated;
