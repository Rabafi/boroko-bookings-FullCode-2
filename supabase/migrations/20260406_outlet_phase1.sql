-- Outlet Phase 1: Introduce outlet model at the data layer only.
-- ─────────────────────────────────────────────────────────────────────────────
-- Goals:
--   1. Create outlets table (Kitchen, Bar, Front Desk per lodge)
--   2. Add nullable outlet_id FK to: pos_orders, pos_menu_items, expenses,
--      booking_charges, inventory_items
--   3. Backfill outlet_id from existing category values where deterministic
--   4. Update create/update RPCs to accept optional outlet_id
--
-- Safety rules:
--   - All outlet_id columns are nullable — no existing flow is broken
--   - No RPC signature changes that affect existing callers (named-param RPCs
--     are replaced in-place with CREATE OR REPLACE; positional-param RPCs like
--     add_booking_charge are left unchanged — Phase 2 will handle those)
--   - create_pos_order is not tracked here (no migration baseline); outlet_id
--     on pos_orders will remain NULL until Phase 2 updates that RPC
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ─── 1. Outlets table ────────────────────────────────────────────────────────

create table if not exists public.outlets (
  id         uuid        primary key default gen_random_uuid(),
  lodge_id   uuid        not null,
  name       text        not null,
  type       text        not null check (type in ('food', 'beverage', 'accommodation')),
  is_active  boolean     not null default true,
  sort_order int         not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists outlets_lodge_name_uidx
  on public.outlets (lodge_id, name);

-- ─── 2. Seed three outlets per existing lodge ────────────────────────────────
-- settings.lodge_id is the authoritative per-tenant UUID (added in auth_contract_v1).

insert into public.outlets (lodge_id, name, type, sort_order)
select lodge_id, 'Kitchen', 'food', 1
  from public.settings
 where lodge_id is not null
on conflict (lodge_id, name) do nothing;

insert into public.outlets (lodge_id, name, type, sort_order)
select lodge_id, 'Bar', 'beverage', 2
  from public.settings
 where lodge_id is not null
on conflict (lodge_id, name) do nothing;

insert into public.outlets (lodge_id, name, type, sort_order)
select lodge_id, 'Front Desk', 'accommodation', 3
  from public.settings
 where lodge_id is not null
on conflict (lodge_id, name) do nothing;

-- ─── 3. Add nullable outlet_id FK columns ────────────────────────────────────

alter table public.pos_orders
  add column if not exists outlet_id uuid references public.outlets(id);

alter table public.pos_menu_items
  add column if not exists outlet_id uuid references public.outlets(id);

alter table public.expenses
  add column if not exists outlet_id uuid references public.outlets(id);

alter table public.booking_charges
  add column if not exists outlet_id uuid references public.outlets(id);

alter table public.inventory_items
  add column if not exists outlet_id uuid references public.outlets(id);

-- ─── 4. Backfill outlet_id from existing category values ─────────────────────
-- pos_menu_items categories: 'Food' | 'Drinks' | 'Other'
-- inventory_items categories: 'Bar' | 'Kitchen' | 'Other'
-- Any row that doesn't match a known category stays NULL (shown as Unassigned).

update public.pos_menu_items pm
   set outlet_id = o.id
  from public.outlets o
 where o.lodge_id = pm.lodge_id
   and pm.outlet_id is null
   and pm.category = 'Food'
   and o.name = 'Kitchen';

update public.pos_menu_items pm
   set outlet_id = o.id
  from public.outlets o
 where o.lodge_id = pm.lodge_id
   and pm.outlet_id is null
   and pm.category = 'Drinks'
   and o.name = 'Bar';

update public.pos_menu_items pm
   set outlet_id = o.id
  from public.outlets o
 where o.lodge_id = pm.lodge_id
   and pm.outlet_id is null
   and pm.category = 'Other'
   and o.name = 'Front Desk';

update public.inventory_items ii
   set outlet_id = o.id
  from public.outlets o
 where o.lodge_id = ii.lodge_id
   and ii.outlet_id is null
   and ii.category = 'Bar'
   and o.name = 'Bar';

update public.inventory_items ii
   set outlet_id = o.id
  from public.outlets o
 where o.lodge_id = ii.lodge_id
   and ii.outlet_id is null
   and ii.category = 'Kitchen'
   and o.name = 'Kitchen';

update public.inventory_items ii
   set outlet_id = o.id
  from public.outlets o
 where o.lodge_id = ii.lodge_id
   and ii.outlet_id is null
   and ii.category = 'Other'
   and o.name = 'Front Desk';

-- ─── 5. RLS & grants for outlets ─────────────────────────────────────────────

alter table public.outlets enable row level security;

-- Tenants can read only their own outlets
create policy "outlets_select_own_lodge"
  on public.outlets for select
  using (lodge_id = app_lodge_access());

-- Outlets are managed only via migrations / admin; no direct insert/update/delete
-- from application roles.
revoke insert, update, delete on public.outlets from anon, authenticated;
grant select on public.outlets to anon, authenticated;

-- ─── 6. Update RPCs to accept optional outlet_id ─────────────────────────────
-- All changes use CREATE OR REPLACE on jsonb-payload RPCs.
-- The outlet_id key is read from the payload only if present; if absent or empty
-- the column retains its current value (updates) or is set to NULL (creates).

-- ── create_expense ────────────────────────────────────────────────────────────
create or replace function public.create_expense(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  insert into public.expenses (
    lodge_id,
    date,
    category,
    description,
    amount,
    outlet_id
  ) values (
    (payload->>'lodge_id')::uuid,
    (payload->>'date')::date,
    payload->>'category',
    payload->>'description',
    coalesce((payload->>'amount')::numeric, 0),
    nullif(payload->>'outlet_id', '')::uuid
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

grant execute on function public.create_expense(jsonb) to anon, authenticated;

-- ── update_expense ────────────────────────────────────────────────────────────
create or replace function public.update_expense(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated uuid;
begin
  update public.expenses
  set
    date        = case when payload ? 'date'        then (payload->>'date')::date                            else date        end,
    category    = case when payload ? 'category'    then payload->>'category'                                else category    end,
    description = case when payload ? 'description' then payload->>'description'                             else description end,
    amount      = case when payload ? 'amount'      then coalesce((payload->>'amount')::numeric, 0)         else amount      end,
    outlet_id   = case when payload ? 'outlet_id'   then nullif(payload->>'outlet_id', '')::uuid            else outlet_id   end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Expense not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

grant execute on function public.update_expense(uuid, uuid, jsonb) to anon, authenticated;

-- ── create_pos_menu_item ──────────────────────────────────────────────────────
create or replace function public.create_pos_menu_item(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  insert into public.pos_menu_items (
    lodge_id,
    name,
    category,
    price,
    is_available,
    barcode,
    inventory_item_id,
    depletion_qty,
    outlet_id
  ) values (
    (payload->>'lodge_id')::uuid,
    payload->>'name',
    coalesce(payload->>'category', 'Other'),
    coalesce((payload->>'price')::numeric, 0),
    coalesce((payload->>'is_available')::boolean, true),
    nullif(payload->>'barcode', ''),
    nullif(payload->>'inventory_item_id', '')::uuid,
    case
      when nullif(payload->>'inventory_item_id', '') is null then null
      else coalesce((payload->>'depletion_qty')::numeric, 1)
    end,
    nullif(payload->>'outlet_id', '')::uuid
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

grant execute on function public.create_pos_menu_item(jsonb) to anon, authenticated;

-- ── update_pos_menu_item ──────────────────────────────────────────────────────
create or replace function public.update_pos_menu_item(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated uuid;
begin
  update public.pos_menu_items
  set
    name              = case when payload ? 'name'
                               then payload->>'name'
                               else name end,
    category          = case when payload ? 'category'
                               then coalesce(payload->>'category', 'Other')
                               else category end,
    price             = case when payload ? 'price'
                               then coalesce((payload->>'price')::numeric, 0)
                               else price end,
    is_available      = case when payload ? 'is_available'
                               then coalesce((payload->>'is_available')::boolean, true)
                               else is_available end,
    barcode           = case when payload ? 'barcode'
                               then nullif(payload->>'barcode', '')
                               else barcode end,
    inventory_item_id = case when payload ? 'inventory_item_id'
                               then nullif(payload->>'inventory_item_id', '')::uuid
                               else inventory_item_id end,
    depletion_qty     = case
                          when payload ? 'inventory_item_id' then
                            case
                              when nullif(payload->>'inventory_item_id', '') is null then null
                              else coalesce((payload->>'depletion_qty')::numeric, 1)
                            end
                          when payload ? 'depletion_qty'
                            then coalesce((payload->>'depletion_qty')::numeric, 1)
                          else depletion_qty
                        end,
    outlet_id         = case when payload ? 'outlet_id'
                               then nullif(payload->>'outlet_id', '')::uuid
                               else outlet_id end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'POS menu item not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

grant execute on function public.update_pos_menu_item(uuid, uuid, jsonb) to anon, authenticated;

-- ── create_inventory_item ─────────────────────────────────────────────────────
create or replace function public.create_inventory_item(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  insert into public.inventory_items (
    lodge_id,
    name,
    category,
    unit,
    current_stock,
    reorder_level,
    latest_unit_cost,
    outlet_id
  ) values (
    (payload->>'lodge_id')::uuid,
    payload->>'name',
    coalesce(payload->>'category', 'Bar'),
    coalesce(payload->>'unit', 'unit'),
    coalesce((payload->>'current_stock')::numeric, 0),
    coalesce((payload->>'reorder_level')::numeric, 0),
    coalesce((payload->>'latest_unit_cost')::numeric, 0),
    nullif(payload->>'outlet_id', '')::uuid
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

grant execute on function public.create_inventory_item(jsonb) to anon, authenticated;

-- ── update_inventory_item ─────────────────────────────────────────────────────
create or replace function public.update_inventory_item(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated uuid;
begin
  update public.inventory_items
  set
    name          = case when payload ? 'name'
                           then payload->>'name'
                           else name end,
    category      = case when payload ? 'category'
                           then payload->>'category'
                           else category end,
    unit          = case when payload ? 'unit'
                           then payload->>'unit'
                           else unit end,
    reorder_level = case when payload ? 'reorder_level'
                           then coalesce((payload->>'reorder_level')::numeric, 0)
                           else reorder_level end,
    outlet_id     = case when payload ? 'outlet_id'
                           then nullif(payload->>'outlet_id', '')::uuid
                           else outlet_id end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Inventory item not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

grant execute on function public.update_inventory_item(uuid, uuid, jsonb) to anon, authenticated;

commit;
