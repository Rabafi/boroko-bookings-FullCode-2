-- Catalog snapshots are outlet-scoped. A Bar outlet created after its first
-- unassigned product must receive an immutable snapshot before a shift can
-- trade; a global/virtual-outlet snapshot cannot authorise a real outlet sale.

begin;

create or replace function public.ensure_initial_pos_catalog_snapshot(
  p_lodge_id uuid,
  p_outlet_id uuid
)
returns void
language plpgsql
security definer
set search_path to public
as $$
declare
  v_items jsonb;
  v_modifier_groups jsonb;
  v_promotions jsonb;
  v_vat_enabled boolean := false;
  v_vat_rate numeric := 0;
  v_next_version integer;
  v_payload jsonb;
  v_payload_hash text;
begin
  if p_lodge_id is null or p_outlet_id is null then
    raise exception 'A lodge and physical outlet are required for an initial POS catalog snapshot.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.outlets o
    where o.id = p_outlet_id
      and o.lodge_id = p_lodge_id
      and o.is_active = true
  ) then
    raise exception 'The initial POS catalog snapshot outlet is not an active outlet of this lodge.'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_lodge_id::text || ':catalog:' || p_outlet_id::text, 0)
  );

  if exists (
    select 1
    from public.pos_catalog_snapshots snapshot
    where snapshot.lodge_id = p_lodge_id
      and snapshot.outlet_id = p_outlet_id
      and snapshot.retired_at is null
  ) then
    return;
  end if;

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
    and (m.outlet_id = p_outlet_id or m.outlet_id is null);

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

  select coalesce(max(snapshot.version_number), 0) + 1
    into v_next_version
  from public.pos_catalog_snapshots snapshot
  where snapshot.lodge_id = p_lodge_id
    and snapshot.outlet_id = p_outlet_id;

  insert into public.pos_catalog_snapshots (
    lodge_id, outlet_id, version_number, vat_enabled, vat_rate, payload, payload_hash
  ) values (
    p_lodge_id, p_outlet_id, v_next_version, v_vat_enabled, v_vat_rate, v_payload, v_payload_hash
  );
end;
$$;

revoke all on function public.ensure_initial_pos_catalog_snapshot(uuid, uuid) from public, anon, authenticated;

create or replace function public.ensure_bar_mode_default_outlet(p_lodge_id uuid)
returns void
language plpgsql
security definer
set search_path to public
as $$
declare
  v_is_bar_mode boolean;
  v_sort_order integer;
  v_bar_outlet_id uuid;
begin
  if p_lodge_id is null then
    return;
  end if;

  select
    s.property_type = 'restaurant'
    and coalesce(s.operating_profile->>'hospitality_mode', '') = 'bar_only'
    into v_is_bar_mode
  from public.settings s
  where s.lodge_id = p_lodge_id;

  if not coalesce(v_is_bar_mode, false) then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('bar-default-outlet:' || p_lodge_id::text, 0));

  select o.id
    into v_bar_outlet_id
  from public.outlets o
  where o.lodge_id = p_lodge_id
    and o.type = 'beverage'
    and o.is_active = true
  order by o.sort_order, o.created_at, o.id
  limit 1;

  if v_bar_outlet_id is null then
    select coalesce(max(o.sort_order), 0) + 1
      into v_sort_order
    from public.outlets o
    where o.lodge_id = p_lodge_id;

    insert into public.outlets (lodge_id, name, type, is_active, sort_order)
    values (p_lodge_id, 'Bar', 'beverage', true, v_sort_order)
    returning id into v_bar_outlet_id;
  end if;

  perform public.ensure_initial_pos_catalog_snapshot(p_lodge_id, v_bar_outlet_id);
end;
$$;

revoke all on function public.ensure_bar_mode_default_outlet(uuid) from public, anon, authenticated;

-- The prior outlet backfill has already created the physical Bar row. This
-- pass creates a matching snapshot only where no active outlet snapshot exists.
select public.ensure_bar_mode_default_outlet(s.lodge_id)
from public.settings s
where s.property_type = 'restaurant'
  and coalesce(s.operating_profile->>'hospitality_mode', '') = 'bar_only';

commit;
