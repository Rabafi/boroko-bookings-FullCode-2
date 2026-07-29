-- Bar Base: server-authoritative stock aging read model.
--
-- This is deliberately a read-only projection over the existing inventory
-- movement ledger.  It does not create a second stock ledger, and it does not
-- expose lots/expiry/write-off controls (those remain Stock & Purchasing Pro).
create or replace function public.get_bar_stock_aging(
  p_lodge_id uuid,
  p_outlet_id uuid default null
)
returns table (
  item_id uuid,
  item_name text,
  category text,
  unit text,
  outlet_id uuid,
  current_stock numeric,
  reorder_level numeric,
  latest_unit_cost numeric,
  last_received_at timestamptz,
  last_sold_at timestamptz,
  days_since_receipt integer,
  days_since_sale integer,
  age_bucket text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_role text := lower(coalesce(public.app_current_role(), ''));
begin
  if p_lodge_id is null then
    raise exception 'Lodge is required';
  end if;

  -- Inventory.view is intentionally available to a cashier, but the
  -- database still owns both lodge and outlet isolation.
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']
  );

  -- Restricted operators must provide their assigned outlet.  A null outlet
  -- is intentionally lodge-wide for managers/admins only; otherwise a
  -- cashier or supervisor could inspect stock aging from another outlet.
  if p_outlet_id is null and v_role in ('cashier', 'supervisor') then
    raise exception 'Outlet context is required for this operator';
  end if;

  if p_outlet_id is not null
     and not exists (
       select 1 from public.outlets o
        where o.id = p_outlet_id
          and o.lodge_id = p_lodge_id
          and coalesce(o.is_active, true)
     ) then
    raise exception 'Outlet is not active for this business';
  end if;

  if p_outlet_id is not null then
    perform public.app_require_pos_outlet_access(p_lodge_id, p_outlet_id);
  end if;

  return query
  with movement_dates as (
    select
      im.item_id,
      max(im.created_at) filter (
        where im.movement_type in (
          'purchase', 'purchase_received', 'opening_stock',
          'adjustment_increase', 'pos_void_restore', 'transfer_in'
        )
        and im.quantity > 0
      ) as last_received_at,
      max(im.created_at) filter (
        where im.movement_type in ('pos_sale', 'recipe_sale')
        and im.quantity < 0
      ) as last_sold_at
    from public.inventory_movements im
    where im.lodge_id = p_lodge_id
    group by im.item_id
  )
  select
    ii.id,
    ii.name,
    coalesce(ii.category, 'Uncategorised'),
    coalesce(ii.unit, 'each'),
    ii.outlet_id,
    coalesce(ii.current_stock, 0),
    coalesce(ii.reorder_level, 0),
    coalesce(ii.latest_unit_cost, 0),
    md.last_received_at,
    md.last_sold_at,
    case when md.last_received_at is null then null
      else greatest(0, floor(extract(epoch from (now() - md.last_received_at)) / 86400))::integer
    end,
    case when md.last_sold_at is null then null
      else greatest(0, floor(extract(epoch from (now() - md.last_sold_at)) / 86400))::integer
    end,
    case
      when md.last_received_at is null then 'No receipt history'
      when now() - md.last_received_at <= interval '7 days' then 'Fresh (0–7 days)'
      when now() - md.last_received_at <= interval '30 days' then 'Aging (8–30 days)'
      when now() - md.last_received_at <= interval '90 days' then 'Stale (31–90 days)'
      else 'Critical (91+ days)'
    end
  from public.inventory_items ii
  left join movement_dates md on md.item_id = ii.id
  where ii.lodge_id = p_lodge_id
    and (p_outlet_id is null or ii.outlet_id is null or ii.outlet_id = p_outlet_id)
  order by
    case when md.last_received_at is null then 0 else 1 end,
    md.last_received_at asc nulls first,
    ii.name asc;
end;
$$;

revoke all on function public.get_bar_stock_aging(uuid, uuid) from public;
grant execute on function public.get_bar_stock_aging(uuid, uuid) to authenticated, service_role;
