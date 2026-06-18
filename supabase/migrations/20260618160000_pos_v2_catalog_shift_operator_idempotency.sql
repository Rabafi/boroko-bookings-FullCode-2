-- Phase 2: Corrected v2 RPCs — catalog enforcement, shift validation,
--         server-side operator derivation, proper idempotency
--
-- This migration creates:
--   2.1 pos_catalog_snapshots table (immutable POS catalog)
--   2.2 get_active_pos_catalog_snapshot RPC
--   2.3 publish_pos_catalog_snapshot RPC
--   2.4 create_pos_order_v3 (mandatory catalog, shift, operator, idempotency)
--   2.5 pos_validate_pin RPC (server-side PIN validation)
--   2.6 pos_get_safe_staff RPC (strips pin_hash)
--   2.7 Line-level allocation columns on pos_order_items
--   2.8 Additional columns on pos_orders and booking_charges
--   2.9 users_safe view (strips pin_hash)
--
-- Backward-compatible: old RPCs remain callable.

begin;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2.1 Immutable POS catalog snapshots
-- ═══════════════════════════════════════════════════════════════════════════════

create table if not exists public.pos_catalog_snapshots (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  outlet_id uuid,
  version_number integer not null default 1,
  vat_enabled boolean not null default false,
  vat_rate numeric not null default 0,
  payload jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz
);

create index if not exists idx_pos_catalog_snapshots_lodge_outlet
  on public.pos_catalog_snapshots (lodge_id, outlet_id, created_at desc);

create unique index if not exists idx_pos_catalog_snapshots_active
  on public.pos_catalog_snapshots (lodge_id, outlet_id)
  where retired_at is null;

alter table public.pos_catalog_snapshots enable row level security;

drop policy if exists pos_catalog_snapshots_lodge_scope_select on public.pos_catalog_snapshots;
create policy pos_catalog_snapshots_lodge_scope_select
  on public.pos_catalog_snapshots
  for select
  using (public.app_lodge_access(lodge_id));

grant select on public.pos_catalog_snapshots to anon, authenticated;
grant select, insert, update on public.pos_catalog_snapshots to service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2.2 get_active_pos_catalog_snapshot
-- ═══════════════════════════════════════════════════════════════════════════════

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
  v_payload jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  select id, lodge_id, outlet_id, version_number, vat_enabled, vat_rate, payload, payload_hash, created_at
  into v_snapshot
  from public.pos_catalog_snapshots
  where lodge_id = p_lodge_id
    and (outlet_id = p_outlet_id or (p_outlet_id is null and outlet_id is null))
    and retired_at is null
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', 'No active catalog snapshot found. Publish a catalog before trading.',
      'code', 'catalog_missing'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'snapshot_id', v_snapshot.id,
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
grant execute on function public.get_active_pos_catalog_snapshot(uuid, uuid) to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2.3 publish_pos_catalog_snapshot
-- ═══════════════════════════════════════════════════════════════════════════════

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
  v_vat_enabled boolean;
  v_vat_rate numeric;
  v_next_version integer;
  v_snapshot_id uuid;
  v_payload jsonb;
  v_payload_hash text;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  select coalesce(max(version_number), 0) + 1
  into v_next_version
  from public.pos_catalog_snapshots
  where lodge_id = p_lodge_id
    and (outlet_id = p_outlet_id or (p_outlet_id is null and outlet_id is null));

  select coalesce(vat_enabled, false), coalesce(vat_rate, 0)
  into v_vat_enabled, v_vat_rate
  from public.settings
  where lodge_id = p_lodge_id
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pmi.id,
    'name', pmi.name,
    'category', pmi.category,
    'price', pmi.price,
    'is_available', pmi.is_available,
    'inventory_item_id', pmi.inventory_item_id,
    'depletion_qty', coalesce(pmi.depletion_qty, 1),
    'outlet_id', pmi.outlet_id,
    'auto_from_inventory', pmi.auto_from_inventory,
    'barcode', pmi.barcode
  ) order by pmi.name), '[]'::jsonb)
  into v_items
  from public.pos_menu_items pmi
  where pmi.lodge_id = p_lodge_id
    and (pmi.outlet_id = p_outlet_id or (p_outlet_id is null and pmi.outlet_id is null));

  v_payload := jsonb_build_object(
    'items', v_items,
    'vat_enabled', v_vat_enabled,
    'vat_rate', v_vat_rate
  );
  v_payload_hash := encode(sha256(v_payload::bytea), 'hex');

  -- Retire previous active snapshot
  update public.pos_catalog_snapshots
  set retired_at = now()
  where lodge_id = p_lodge_id
    and (outlet_id = p_outlet_id or (p_outlet_id is null and outlet_id is null))
    and retired_at is null;

  insert into public.pos_catalog_snapshots (lodge_id, outlet_id, version_number, vat_enabled, vat_rate, payload, payload_hash)
  values (p_lodge_id, p_outlet_id, v_next_version, v_vat_enabled, v_vat_rate, v_payload, v_payload_hash)
  returning id into v_snapshot_id;

  return jsonb_build_object(
    'success', true,
    'snapshot_id', v_snapshot_id,
    'version_number', v_next_version,
    'item_count', jsonb_array_length(v_items),
    'payload_hash', v_payload_hash
  );
end;
$$;

revoke all on function public.publish_pos_catalog_snapshot(uuid, uuid) from public;
grant execute on function public.publish_pos_catalog_snapshot(uuid, uuid) to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2.7 Line-level allocation columns on pos_order_items
-- ═══════════════════════════════════════════════════════════════════════════════

alter table public.pos_order_items
  add column if not exists gross_subtotal numeric not null default 0,
  add column if not exists discount_allocated numeric not null default 0,
  add column if not exists tax_allocated numeric not null default 0,
  add column if not exists net_subtotal numeric not null default 0;

-- 2.8 Additional columns on pos_orders
alter table public.pos_orders
  add column if not exists transaction_type text not null default 'sale',
  add column if not exists original_order_id uuid references public.pos_orders(id) on delete set null,
  add column if not exists catalog_snapshot_id uuid,
  add column if not exists source_device_id text,
  add column if not exists client_created_at timestamptz,
  add column if not exists server_received_at timestamptz not null default now();

-- 2.8 Folio charge reversal columns on booking_charges
alter table public.booking_charges
  add column if not exists source_type text,
  add column if not exists source_id uuid,
  add column if not exists reversal_of_charge_id uuid;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2.5 pos_validate_pin — server-side PIN validation RPC
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.pos_validate_pin(
  p_lodge_id uuid,
  p_pin text,
  p_required_role text default 'supervisor'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user record;
  v_roles text[];
begin
  if p_pin is null or length(trim(p_pin)) < 4 then
    return jsonb_build_object('success', false, 'error', 'PIN must be at least 4 digits');
  end if;

  v_roles := case p_required_role
    when 'supervisor' then array['supervisor', 'manager', 'admin', 'super_admin']
    when 'manager' then array['manager', 'admin', 'super_admin']
    when 'admin' then array['admin', 'super_admin']
    else array['supervisor', 'manager', 'admin', 'super_admin']
  end;

  select id, name, email, role, pin_hash, allowed_outlet_ids
  into v_user
  from public.users
  where lodge_id = p_lodge_id
    and status = 'active'
    and pin_hash is not null
    and role = any(v_roles);

  -- Check PIN against each candidate
  -- Note: We cannot loop and compare inside SQL easily, so we check all matching users
  -- and return the first match. The client should call this for each candidate.
  -- Actually, we need to check PIN against each user. Use crypt() directly.
  for v_user in
    select id, name, email, role, pin_hash, allowed_outlet_ids
    from public.users
    where lodge_id = p_lodge_id
      and status = 'active'
      and pin_hash is not null
      and role = any(v_roles)
  loop
    if v_user.pin_hash = crypt(p_pin, v_user.pin_hash) then
      return jsonb_build_object(
        'success', true,
        'user_id', v_user.id,
        'name', v_user.name,
        'email', v_user.email,
        'role', v_user.role
      );
    end if;
  end loop;

  return jsonb_build_object('success', false, 'error', 'Invalid PIN or unauthorized approver');
end;
$$;

revoke all on function public.pos_validate_pin(uuid, text, text) from public;
grant execute on function public.pos_validate_pin(uuid, text, text) to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2.6 pos_get_safe_staff — returns staff without pin_hash
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.pos_get_safe_staff(
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', u.id,
      'name', u.name,
      'email', u.email,
      'role', u.role,
      'has_pin', (u.pin_hash is not null),
      'allowed_outlet_ids', u.allowed_outlet_ids
    ) order by u.name), '[]'::jsonb)
    from public.users u
    where u.lodge_id = p_lodge_id
      and u.status = 'active'
  );
end;
$$;

revoke all on function public.pos_get_safe_staff(uuid) from public;
grant execute on function public.pos_get_safe_staff(uuid) to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2.9 users_safe view — strips pin_hash for client consumption
-- ═══════════════════════════════════════════════════════════════════════════════

-- The previous migration created a smaller users_safe view. PostgreSQL does
-- not allow CREATE OR REPLACE VIEW to reorder/rename its existing columns, so
-- replace the view explicitly before publishing the expanded safe contract.
drop view if exists public.users_safe;

create view public.users_safe as
select
  id, auth_user_id, name, email, role, status, lodge_id,
  created_at, last_sign_in_at, last_desktop_sign_in_at, last_pwa_sign_in_at,
  last_activity_at, invite_sent_at, password_updated_at,
  pwa_enabled, pwa_password_set_at, pwa_disabled_reason, pwa_password_reset_by,
  allowed_outlet_ids, capability_overrides,
  (pin_hash is not null) as has_pin
from public.users;

grant select on public.users_safe to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2.4 create_pos_order_v3 — server-authoritative pricing
--
-- Contract:
--   - catalog_snapshot_id is MANDATORY
--   - shift_id is MANDATORY and must be open
--   - operator is derived from auth.uid(), not client-supplied
--   - Client prices are IGNORED; all prices resolved from immutable catalog
--   - Client totals are IGNORED; server computes everything
--   - Idempotency via financial_operation_idempotency table
--   - Transaction-scoped audit events
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.create_pos_order_v3(
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid;
  v_outlet_id uuid;
  v_shift_id uuid;
  v_catalog_snapshot_id uuid;
  v_items jsonb;
  v_payment_method text;
  v_payment_breakdown jsonb;
  v_walk_in_name text;
  v_room_id uuid;
  v_booking_id uuid;
  v_notes text;
  v_service_mode text;
  v_table_name text;
  v_tab_name text;
  v_waiter_name text;
  v_ticket_status text;
  v_idempotency_key text;
  v_client_created_at timestamptz;
  v_source_device_id text;
  v_manual_discount jsonb;
  v_promotion_id uuid;
  v_tip_total numeric;
  v_created_by uuid;

  -- Catalog
  v_snapshot record;
  v_snapshot_items jsonb;
  v_vat_enabled boolean;
  v_vat_rate numeric;

  -- Shift
  v_shift record;

  -- Order computation
  v_order_id uuid;
  v_line jsonb;
  v_menu_item_id uuid;
  v_db_price numeric;
  v_is_available boolean;
  v_depletion_qty numeric;
  v_inventory_item_id uuid;
  v_quantity numeric;
  v_line_subtotal numeric;
  v_line_gross numeric;
  v_line_discount numeric;
  v_line_tax numeric;
  v_line_net numeric;
  v_computed_gross numeric := 0;
  v_computed_discount numeric := 0;
  v_computed_tax numeric := 0;
  v_discount_total numeric := 0;
  v_tax_total numeric := 0;
  v_computed_total numeric;
  v_payment_total numeric := 0;
  v_breakdown_entry jsonb;
  v_breakdown_amount numeric;
  v_item_record jsonb;
  v_order_item_id uuid;

  -- Inventory
  v_stock numeric;
  v_required_stock numeric;

  -- Audit
  v_audit_id uuid;

  -- Idempotency
  v_request_hash text;
  v_cached_result jsonb;

  v_now timestamptz := now();
begin
  -- ── Extract payload fields ─────────────────────────────────────────────────
  v_lodge_id := (payload->>'lodge_id')::uuid;
  v_outlet_id := (payload->>'outlet_id')::uuid;
  v_shift_id := (payload->>'shift_id')::uuid;
  v_catalog_snapshot_id := (payload->>'catalog_snapshot_id')::uuid;
  v_items := payload->'items';
  v_payment_method := payload->>'payment_method';
  v_payment_breakdown := payload->'payment_breakdown';
  v_walk_in_name := payload->>'walk_in_name';
  v_room_id := (payload->>'room_id')::uuid;
  v_booking_id := (payload->>'booking_id')::uuid;
  v_notes := payload->>'notes';
  v_service_mode := payload->>'service_mode';
  v_table_name := payload->>'table_name';
  v_tab_name := payload->>'tab_name';
  v_waiter_name := payload->>'waiter_name';
  v_ticket_status := coalesce(payload->>'ticket_status', 'new');
  v_idempotency_key := payload->>'create_idempotency_key';
  v_client_created_at := (payload->>'client_created_at')::timestamptz;
  v_source_device_id := payload->>'source_device_id';
  v_manual_discount := payload->'manual_discount';
  v_promotion_id := (payload->>'promotion_id')::uuid;
  v_tip_total := coalesce((payload->>'tip_total')::numeric, 0);
  v_created_by := public.app_current_user_id();

  -- ── Validate required fields ───────────────────────────────────────────────
  if v_lodge_id is null then
    return jsonb_build_object('success', false, 'error', 'lodge_id is required');
  end if;

  if v_catalog_snapshot_id is null then
    return jsonb_build_object('success', false, 'error', 'catalog_snapshot_id is mandatory. Fetch an active catalog before trading.', 'code', 'catalog_refresh_required', 'manual_review_required', true);
  end if;

  if v_shift_id is null then
    return jsonb_build_object('success', false, 'error', 'shift_id is mandatory. Open a shift before creating orders.', 'code', 'shift_required');
  end if;

  if v_items is null or jsonb_array_length(v_items) = 0 then
    return jsonb_build_object('success', false, 'error', 'At least one item is required');
  end if;

  -- ── Role and outlet access ─────────────────────────────────────────────────
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  if v_outlet_id is not null then
    perform public.app_require_pos_outlet_access(v_outlet_id);
  end if;

  -- ── Idempotency check ──────────────────────────────────────────────────────
  if v_idempotency_key is not null then
    v_request_hash := encode(sha256((payload::text)::bytea), 'hex');
    v_cached_result := public._claim_financial_operation(
      v_lodge_id, v_idempotency_key, 'create_pos_order_v3', null, v_request_hash
    );
    if (v_cached_result->>'found')::boolean then
      if (v_cached_result->>'match')::boolean then
        return jsonb_build_object(
          'success', true,
          'id', (v_cached_result->'operation_result')->>'id',
          'total', (v_cached_result->'operation_result')->>'total',
          'idempotent', true,
          'replayed', true
        );
      else
        return jsonb_build_object('success', false, 'error', 'Idempotency key reused with different payload', 'code', 'idempotency_conflict');
      end if;
    end if;
  end if;

  -- ── Validate catalog snapshot ──────────────────────────────────────────────
  select id, lodge_id, outlet_id, version_number, vat_enabled, vat_rate, payload, payload_hash, created_at
  into v_snapshot
  from public.pos_catalog_snapshots
  where id = v_catalog_snapshot_id
    and retired_at is null;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Catalog snapshot not found or retired', 'code', 'catalog_refresh_required', 'manual_review_required', true);
  end if;

  if v_snapshot.lodge_id != v_lodge_id then
    return jsonb_build_object('success', false, 'error', 'Catalog snapshot does not belong to this lodge', 'code', 'catalog_refresh_required');
  end if;

  if v_snapshot.outlet_id is not null and v_snapshot.outlet_id != v_outlet_id then
    return jsonb_build_object('success', false, 'error', 'Catalog snapshot does not match this outlet', 'code', 'catalog_refresh_required');
  end if;

  -- Catalog age validation: reject if created after the client sale time
  if v_client_created_at is not null and v_snapshot.created_at > v_client_created_at + interval '5 minutes' then
    return jsonb_build_object('success', false, 'error', 'Catalog snapshot was created after the sale time. Refresh catalog.', 'code', 'catalog_refresh_required', 'manual_review_required', true);
  end if;

  -- Reject implausibly future-dated client timestamps (more than 5 minutes ahead)
  if v_client_created_at is not null and v_client_created_at > v_now + interval '5 minutes' then
    return jsonb_build_object('success', false, 'error', 'Client timestamp is in the future. Check device clock.', 'code', 'clock_drift');
  end if;

  v_vat_enabled := v_snapshot.vat_enabled;
  v_vat_rate := v_snapshot.vat_rate;
  v_snapshot_items := v_snapshot.payload->'items';

  -- ── Validate shift ─────────────────────────────────────────────────────────
  select id, lodge_id, outlet_id, cashier_id, status, opening_float
  into v_shift
  from public.pos_shifts
  where id = v_shift_id
    and lodge_id = v_lodge_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Shift not found for this lodge');
  end if;

  if v_shift.status != 'open' then
    return jsonb_build_object('success', false, 'error', 'Shift is not open', 'code', 'shift_not_open');
  end if;

  if v_shift.outlet_id is not null and v_outlet_id is not null and v_shift.outlet_id != v_outlet_id then
    return jsonb_build_object('success', false, 'error', 'Shift does not belong to this outlet');
  end if;

  -- ── Resolve operator server-side ───────────────────────────────────────────
  -- Ignore client-supplied cashier_id; derive from authenticated user
  -- v_created_by already holds app_current_user_id()

  -- ── Validate and price items from catalog ──────────────────────────────────
  v_computed_total := 0;
  v_discount_total := coalesce(
    case
      when v_manual_discount->>'type' = 'amount' then (v_manual_discount->>'value')::numeric
      when v_manual_discount->>'type' = 'percent' then 0  -- computed after gross
      else 0
    end, 0);

  for v_line in select * from jsonb_array_elements(v_items)
  loop
    v_menu_item_id := (v_line->>'menu_item_id')::uuid;
    v_quantity := coalesce((v_line->>'quantity')::numeric, 1);

    if v_quantity <= 0 then
      return jsonb_build_object('success', false, 'error', 'Item quantity must be positive');
    end if;

    -- Find item in immutable catalog snapshot
    v_item_record := null;
    for v_item_record in
      select * from jsonb_array_elements(v_snapshot_items) as item
      where (item->>'id')::uuid = v_menu_item_id
    loop
      exit;
    end loop;

    if v_item_record is null then
      return jsonb_build_object(
        'success', false,
        'error', format('Menu item %s not found in catalog snapshot. Refresh catalog.', v_menu_item_id),
        'code', 'catalog_refresh_required',
        'manual_review_required', true
      );
    end if;

    -- Server-authoritative price from catalog
    v_db_price := coalesce((v_item_record->>'price')::numeric, 0);
    v_is_available := coalesce((v_item_record->>'is_available')::boolean, true);
    v_inventory_item_id := (v_item_record->>'inventory_item_id')::uuid;
    v_depletion_qty := coalesce((v_item_record->>'depletion_qty')::numeric, 1);

    if not v_is_available then
      return jsonb_build_object('success', false, 'error', format('Item "%s" is not available for sale', v_item_record->>'name'));
    end if;

    -- Compute line totals (server-authoritative)
    v_line_gross := round(v_quantity * v_db_price, 2);
    v_line_discount := 0;
    v_line_tax := 0;
    v_line_net := v_line_gross;

    v_computed_gross := v_computed_gross + v_line_gross;
  end loop;

  -- Apply percent discount if applicable
  if v_manual_discount->>'type' = 'percent' then
    v_discount_total := round(v_computed_gross * (v_manual_discount->>'value')::numeric / 100, 2);
  end if;

  -- Apply VAT
  if v_vat_enabled and v_vat_rate > 0 then
    v_tax_total := round((v_computed_gross - v_discount_total) * v_vat_rate / 100, 2);
  end if;

  v_computed_total := round(greatest(0, v_computed_gross - v_discount_total) + v_tax_total + v_tip_total, 2);

  -- ── Validate payment totals ────────────────────────────────────────────────
  if v_payment_breakdown is not null and jsonb_array_length(v_payment_breakdown) > 0 then
    for v_breakdown_entry in select * from jsonb_array_elements(v_payment_breakdown)
    loop
      v_breakdown_amount := coalesce((v_breakdown_entry->>'amount')::numeric, 0);
      v_payment_total := v_payment_total + v_breakdown_amount;
    end loop;
  else
    v_payment_total := v_computed_total;
  end if;

  if v_payment_method != 'folio' and abs(v_payment_total - v_computed_total) > 0.01 then
    return jsonb_build_object(
      'success', false,
      'error', format('Payment total (%s) does not match order total (%s)', v_payment_total, v_computed_total)
    );
  end if;

  -- ── Insert order ───────────────────────────────────────────────────────────
  v_order_id := coalesce((payload->>'id')::uuid, gen_random_uuid());

  insert into public.pos_orders (
    id, lodge_id, room_id, booking_id, walk_in_name, status, total, notes,
    payment_method, outlet_id, create_idempotency_key, gross_total,
    discount_total, tax_rate, tax_total, tip_total, payment_breakdown,
    service_mode, table_name, tab_name, waiter_name, cashier_id, cashier_name,
    shift_id, ticket_status, transaction_type, catalog_snapshot_id,
    source_device_id, client_created_at, server_received_at
  ) values (
    v_order_id, v_lodge_id, v_room_id, v_booking_id, v_walk_in_name, 'open',
    v_computed_total, v_notes, v_payment_method, v_outlet_id, v_idempotency_key,
    v_computed_gross, v_discount_total, v_vat_rate, v_tax_total, v_tip_total,
    coalesce(v_payment_breakdown, '[]'::jsonb), v_service_mode, v_table_name,
    v_tab_name, v_waiter_name,
    v_created_by,  -- server-derived operator, NOT client-supplied
    (select name from public.users where id = v_created_by limit 1),
    v_shift_id, v_ticket_status, 'sale', v_catalog_snapshot_id,
    v_source_device_id, v_client_created_at, v_now
  );

  -- ── Insert order items with line-level allocations ─────────────────────────
  for v_line in select * from jsonb_array_elements(v_items)
  loop
    v_menu_item_id := (v_line->>'menu_item_id')::uuid;
    v_quantity := coalesce((v_line->>'quantity')::numeric, 1);

    -- Re-resolve from catalog
    v_db_price := 0;
    v_is_available := true;
    v_inventory_item_id := null;
    v_depletion_qty := 1;

    for v_item_record in
      select * from jsonb_array_elements(v_snapshot_items) as item
      where (item->>'id')::uuid = v_menu_item_id
    loop
      v_db_price := coalesce((v_item_record->>'price')::numeric, 0);
      v_is_available := coalesce((v_item_record->>'is_available')::boolean, true);
      v_inventory_item_id := (v_item_record->>'inventory_item_id')::uuid;
      v_depletion_qty := coalesce((v_item_record->>'depletion_qty')::numeric, 1);
      exit;
    end loop;

    v_line_gross := round(v_quantity * v_db_price, 2);
    v_line_discount := 0;
    v_line_tax := 0;
    v_line_net := v_line_gross;

    -- Proportional discount allocation
    if v_discount_total > 0 and v_computed_gross > 0 then
      v_line_discount := round(v_line_gross * v_discount_total / v_computed_gross, 2);
      v_line_net := v_line_gross - v_line_discount;
    end if;

    -- Proportional tax allocation
    if v_tax_total > 0 and (v_computed_gross - v_discount_total) > 0 then
      v_line_tax := round(v_line_net * v_tax_total / (v_computed_gross - v_discount_total), 2);
    end if;

    v_line_net := v_line_net + v_line_tax;

    insert into public.pos_order_items (
      id, lodge_id, order_id, menu_item_id, item_name, quantity, unit_price,
      subtotal, inventory_item_id, depletion_qty, category, modifiers,
      item_notes, gross_subtotal, discount_allocated, tax_allocated, net_subtotal
    ) values (
      gen_random_uuid(), v_lodge_id, v_order_id, v_menu_item_id,
      (v_item_record->>'name')::text, v_quantity, v_db_price,
      v_line_gross, v_inventory_item_id, v_depletion_qty,
      (v_item_record->>'category')::text,
      coalesce(v_line->'modifiers', '[]'::jsonb),
      v_line->>'item_notes',
      v_line_gross, v_line_discount, v_line_tax, v_line_net
    ) returning id into v_order_item_id;

    -- ── Inventory depletion ───────────────────────────────────────────────────
    if v_inventory_item_id is not null then
      v_required_stock := v_quantity * v_depletion_qty;

      update public.inventory_items
      set current_stock = current_stock - v_required_stock
      where id = v_inventory_item_id
        and current_stock >= v_required_stock;

      if not found then
        return jsonb_build_object('success', false, 'error', format('Insufficient stock for item "%s"', (v_item_record->>'name')::text));
      end if;

      insert into public.inventory_movements (
        lodge_id, inventory_item_id, delta, reference_type, reference_id, notes
      ) values (
        v_lodge_id, v_inventory_item_id, -v_required_stock,
        'pos_order', v_order_id, format('Order %s', v_order_id)
      );
    end if;
  end loop;

  -- ── Audit event ────────────────────────────────────────────────────────────
  insert into public.pos_audit_log (lodge_id, action, entity_type, entity_id, performed_by, details)
  values (
    v_lodge_id, 'order_created', 'pos_order', v_order_id, v_created_by,
    jsonb_build_object(
      'total', v_computed_total,
      'item_count', jsonb_array_length(v_items),
      'payment_method', v_payment_method,
      'catalog_snapshot_id', v_catalog_snapshot_id,
      'shift_id', v_shift_id,
      'operator_id', v_created_by,
      'source_device_id', v_source_device_id,
      'client_created_at', v_client_created_at
    )
  ) returning id into v_audit_id;

  -- ── Record idempotency ─────────────────────────────────────────────────────
  if v_idempotency_key is not null then
    perform public._record_financial_operation(
      v_lodge_id, v_idempotency_key, 'create_pos_order_v3', v_order_id,
      v_request_hash, jsonb_build_object('id', v_order_id, 'total', v_computed_total)
    );
  end if;

  -- ── Return result ──────────────────────────────────────────────────────────
  return jsonb_build_object(
    'success', true,
    'id', v_order_id,
    'total', v_computed_total,
    'gross_total', v_computed_gross,
    'discount_total', v_discount_total,
    'tax_total', v_tax_total,
    'tip_total', v_tip_total,
    'item_count', jsonb_array_length(v_items),
    'audit_id', v_audit_id
  );
end;
$$;

revoke all on function public.create_pos_order_v3(jsonb) from public;
grant execute on function public.create_pos_order_v3(jsonb) to anon, authenticated, service_role;

commit;
