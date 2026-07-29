-- Preserve stock truth while making a mistyped supplier expiry date correctable.

begin;

create table if not exists public.restaurant_inventory_lot_expiry_corrections (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  lot_id uuid not null references public.restaurant_inventory_lots(id) on delete cascade,
  previous_expires_on date,
  corrected_expires_on date,
  reason text not null,
  corrected_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.restaurant_inventory_lot_expiry_corrections enable row level security;
drop policy if exists restaurant_inventory_lot_expiry_corrections_scope on public.restaurant_inventory_lot_expiry_corrections;
create policy restaurant_inventory_lot_expiry_corrections_scope
  on public.restaurant_inventory_lot_expiry_corrections for all
  using (public.app_lodge_access(lodge_id)) with check (public.app_lodge_access(lodge_id));

create or replace function public.update_restaurant_inventory_lot_expiry(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(p_payload->>'lodge_id', '')::uuid;
  v_lot_id uuid := nullif(p_payload->>'lot_id', '')::uuid;
  v_new_expiry date := nullif(p_payload->>'expires_on', '')::date;
  v_reason text := nullif(btrim(coalesce(p_payload->>'reason', '')), '');
  v_actor_id uuid := public.app_current_user_id();
  v_lot public.restaurant_inventory_lots%rowtype;
begin
  perform public.app_require_restaurant_lodge(v_lodge_id, array['admin', 'manager', 'supervisor']);
  if v_actor_id is null or not exists (select 1 from public.users u where u.id = v_actor_id and u.lodge_id = v_lodge_id) then
    return jsonb_build_object('success', false, 'error', 'Your staff session could not be verified. Sign out and sign in again before correcting this expiry date.');
  end if;
  if v_lot_id is null then return jsonb_build_object('success', false, 'error', 'Lot ID is required.'); end if;

  select * into v_lot from public.restaurant_inventory_lots
   where id = v_lot_id and lodge_id = v_lodge_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Lot was not found for this business.'); end if;
  if v_lot.expires_on is not distinct from v_new_expiry then
    return jsonb_build_object('success', true, 'unchanged', true, 'id', v_lot.id);
  end if;
  if v_reason is null then
    return jsonb_build_object('success', false, 'error', 'Enter why the supplier expiry date is being corrected.');
  end if;

  update public.restaurant_inventory_lots set expires_on = v_new_expiry where id = v_lot.id;
  insert into public.restaurant_inventory_lot_expiry_corrections (
    lodge_id, lot_id, previous_expires_on, corrected_expires_on, reason, corrected_by
  ) values (v_lodge_id, v_lot.id, v_lot.expires_on, v_new_expiry, v_reason, v_actor_id);
  return jsonb_build_object('success', true, 'id', v_lot.id);
end;
$$;

revoke all on function public.update_restaurant_inventory_lot_expiry(jsonb) from public;
grant execute on function public.update_restaurant_inventory_lot_expiry(jsonb) to authenticated, service_role;

commit;
