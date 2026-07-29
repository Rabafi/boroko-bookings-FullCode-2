-- Stocktakes are created through security-definer RPCs, but the operator also
-- needs to read the draft header and its lines. Posting must leave an auditable
-- inventory movement for every counted variance.

drop policy if exists inventory_stocktakes_lodge_scope_select on public.inventory_stocktakes;
create policy inventory_stocktakes_lodge_scope_select
  on public.inventory_stocktakes
  for select
  using (public.app_lodge_access(lodge_id));

drop policy if exists inventory_stocktake_lines_lodge_scope_select on public.inventory_stocktake_lines;
create policy inventory_stocktake_lines_lodge_scope_select
  on public.inventory_stocktake_lines
  for select
  using (public.app_lodge_access(lodge_id));

create or replace function public.post_inventory_stocktake_session(
  p_stocktake_id uuid,
  p_lodge_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_session public.inventory_stocktakes%rowtype;
  v_line record;
  v_variance_count integer := 0;
  v_unit_cost numeric;
  v_actor_raw text := nullif(btrim(coalesce(current_setting('app.actor_id', true), '')), '');
  v_actor uuid := case when v_actor_raw ~ '^[0-9a-fA-F-]{36}$' then v_actor_raw::uuid else null end;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  select * into v_session
    from public.inventory_stocktakes
   where id = p_stocktake_id and lodge_id = p_lodge_id
   for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Stock take session not found'); end if;
  if v_session.status = 'posted' then
    select count(*) into v_variance_count from public.inventory_stocktake_lines
     where stocktake_id = p_stocktake_id and lodge_id = p_lodge_id and coalesce(variance_qty, 0) <> 0;
    return jsonb_build_object('success', true, 'variance_count', v_variance_count, 'idempotent', true);
  end if;
  if v_session.status <> 'open' then return jsonb_build_object('success', false, 'error', 'This stock take has already been posted'); end if;

  update public.inventory_stocktake_lines
     set counted_qty = coalesce(counted_qty, expected_qty),
         variance_qty = coalesce(counted_qty, expected_qty) - expected_qty,
         variance_cost = (coalesce(counted_qty, expected_qty) - expected_qty) * coalesce(unit_cost, 0),
         updated_at = now()
   where stocktake_id = p_stocktake_id and lodge_id = p_lodge_id;

  for v_line in
    select item_id, expected_qty, counted_qty, variance_qty, unit_cost
      from public.inventory_stocktake_lines
     where stocktake_id = p_stocktake_id and lodge_id = p_lodge_id
  loop
    select coalesce(latest_unit_cost, v_line.unit_cost, 0) into v_unit_cost
      from public.inventory_items
     where id = v_line.item_id and lodge_id = p_lodge_id
     for update;
    if not found then return jsonb_build_object('success', false, 'error', 'A counted inventory item no longer belongs to this restaurant'); end if;

    update public.inventory_items
       set current_stock = coalesce(v_line.counted_qty, v_line.expected_qty), updated_at = now()
     where id = v_line.item_id and lodge_id = p_lodge_id;

    if coalesce(v_line.variance_qty, 0) <> 0 then
      insert into public.inventory_movements (
        lodge_id, item_id, movement_type, quantity, unit_cost, total_cost,
        notes, reference_type, reference_id, source, created_by
      ) values (
        p_lodge_id, v_line.item_id, 'stocktake_adjustment', v_line.variance_qty, v_unit_cost,
        v_line.variance_qty * v_unit_cost, coalesce(nullif(p_notes, ''), 'Posted physical stocktake'),
        'inventory_stocktake', p_stocktake_id, 'stocktake', v_actor
      );
      v_variance_count := v_variance_count + 1;
    end if;
  end loop;

  update public.inventory_stocktakes
     set status = 'posted', notes = coalesce(nullif(p_notes, ''), notes),
         counted_at = coalesce(counted_at, now()), posted_at = now(), updated_at = now()
   where id = p_stocktake_id and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true, 'variance_count', v_variance_count);
end;
$$;

revoke all on function public.post_inventory_stocktake_session(uuid, uuid, text) from public;
grant execute on function public.post_inventory_stocktake_session(uuid, uuid, text) to authenticated, service_role;
