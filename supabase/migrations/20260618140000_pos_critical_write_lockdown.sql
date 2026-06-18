-- Phase 1: Immediate database lockdown
--
-- This migration:
--   1.1 Revokes direct return-ledger writes (pos_return_lines)
--   1.2 Audits all critical grants via regression-check functions
--   1.3 Locks down RPC execution on all critical POS/financial functions
--
-- Safe to apply: additive and backward-compatible. Old RPCs remain callable.
-- Only security-definer RPCs may write critical tables from here on.

begin;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1.1 Revoke direct return-ledger writes
-- ═══════════════════════════════════════════════════════════════════════════════
-- The current migration (20260613020000) grants anon/authenticated INSERT on
-- pos_return_lines.  Only the security-definer return RPC should write this
-- table.  Remove insert/update/delete for non-service roles.

revoke insert, update, delete
  on public.pos_return_lines
  from anon, authenticated;

grant select
  on public.pos_return_lines
  to anon, authenticated;

grant select, insert, update, delete
  on public.pos_return_lines
  to service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1.2 Revoke direct writes on all critical financial/POS tables
-- ═══════════════════════════════════════════════════════════════════════════════
-- Ensure that anon and authenticated can only SELECT from critical tables.
-- All mutations MUST flow through security-definer RPCs.

-- pos_orders: ensure read-only for client roles
revoke insert, update, delete
  on public.pos_orders
  from anon, authenticated;

grant select
  on public.pos_orders
  to anon, authenticated;

-- pos_order_items: ensure read-only for client roles
revoke insert, update, delete
  on public.pos_order_items
  from anon, authenticated;

grant select
  on public.pos_order_items
  to anon, authenticated;

-- booking_charges: ensure read-only for client roles
revoke insert, update, delete
  on public.booking_charges
  from anon, authenticated;

grant select
  on public.booking_charges
  to anon, authenticated;

-- payments: ensure read-only for client roles
revoke insert, update, delete
  on public.payments
  from anon, authenticated;

grant select
  on public.payments
  to anon, authenticated;

-- inventory_items: ensure read-only for client roles
revoke insert, update, delete
  on public.inventory_items
  from anon, authenticated;

grant select
  on public.inventory_items
  to anon, authenticated;

-- inventory_movements: ensure read-only for client roles
revoke insert, update, delete
  on public.inventory_movements
  from anon, authenticated;

grant select
  on public.inventory_movements
  to anon, authenticated;

-- pos_cashup_sessions: ensure read-only for client roles
revoke insert, update, delete
  on public.pos_cashup_sessions
  from anon, authenticated;

grant select
  on public.pos_cashup_sessions
  to anon, authenticated;

-- pos_shifts: ensure read-only for client roles
revoke insert, update, delete
  on public.pos_shifts
  from anon, authenticated;

grant select
  on public.pos_shifts
  to anon, authenticated;

-- pos_override_log: ensure read-only for client roles
revoke insert, update, delete
  on public.pos_override_log
  from anon, authenticated;

grant select
  on public.pos_override_log
  to anon, authenticated;

-- pos_audit_log: ensure read-only for client roles
revoke insert, update, delete
  on public.pos_audit_log
  from anon, authenticated;

grant select
  on public.pos_audit_log
  to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1.3 Lock down RPC execution on all critical functions
-- ═══════════════════════════════════════════════════════════════════════════════
-- Every critical RPC: REVOKE ALL FROM public, then GRANT EXECUTE to
-- anon, authenticated, service_role.  Authorization is enforced inside
-- the security-definer functions via app_require_lodge_role() etc.

-- Order creation
revoke all on function public.create_pos_order(jsonb) from public;
grant execute on function public.create_pos_order(jsonb) to anon, authenticated, service_role;

-- Void approval
revoke all on function public.approve_pos_void_with_pin(jsonb) from public;
grant execute on function public.approve_pos_void_with_pin(jsonb) to anon, authenticated, service_role;

-- Partial return
revoke all on function public.create_pos_partial_return_with_pin(jsonb) from public;
grant execute on function public.create_pos_partial_return_with_pin(jsonb) to anon, authenticated, service_role;

-- Cash-up upsert
revoke all on function public.upsert_pos_cashup(jsonb) from public;
grant execute on function public.upsert_pos_cashup(jsonb) to anon, authenticated, service_role;

-- Shifts (all variants)
revoke all on function public.open_pos_shift(uuid, uuid, text, numeric, text) from public;
grant execute on function public.open_pos_shift(uuid, uuid, text, numeric, text) to anon, authenticated, service_role;

revoke all on function public.close_pos_shift(uuid, uuid, numeric, text) from public;
grant execute on function public.close_pos_shift(uuid, uuid, numeric, text) to anon, authenticated, service_role;

revoke all on function public.open_pos_shift_with_id(jsonb) from public;
grant execute on function public.open_pos_shift_with_id(jsonb) to anon, authenticated, service_role;

revoke all on function public.close_pos_shift_with_id(jsonb) from public;
grant execute on function public.close_pos_shift_with_id(jsonb) to anon, authenticated, service_role;

revoke all on function public.get_pos_shifts(uuid) from public;
grant execute on function public.get_pos_shifts(uuid) to anon, authenticated, service_role;

-- Menu CRUD
revoke all on function public.create_pos_menu_item(jsonb) from public;
grant execute on function public.create_pos_menu_item(jsonb) to anon, authenticated, service_role;

revoke all on function public.update_pos_menu_item(uuid, uuid, jsonb) from public;
grant execute on function public.update_pos_menu_item(uuid, uuid, jsonb) to anon, authenticated, service_role;

revoke all on function public.delete_pos_menu_item(uuid, uuid) from public;
grant execute on function public.delete_pos_menu_item(uuid, uuid) to anon, authenticated, service_role;

revoke all on function public.set_bar_pos_pack_template(jsonb) from public;
grant execute on function public.set_bar_pos_pack_template(jsonb) to anon, authenticated, service_role;

-- Inventory sync
revoke all on function public.sync_inventory_item_to_pos(uuid, uuid) from public;
grant execute on function public.sync_inventory_item_to_pos(uuid, uuid) to service_role;

-- Inventory adjustment (idempotent variant)
revoke all on function public.adjust_inventory_stock(uuid, uuid, numeric, text, uuid) from public;
grant execute on function public.adjust_inventory_stock(uuid, uuid, numeric, text, uuid) to anon, authenticated, service_role;

-- Table, tab, prep ticket management
revoke all on function public.upsert_pos_table(jsonb) from public;
grant execute on function public.upsert_pos_table(jsonb) to anon, authenticated, service_role;

revoke all on function public.upsert_pos_tab(jsonb) from public;
grant execute on function public.upsert_pos_tab(jsonb) to anon, authenticated, service_role;

revoke all on function public.update_pos_tab_status(uuid, text, text) from public;
grant execute on function public.update_pos_tab_status(uuid, text, text) to anon, authenticated, service_role;

revoke all on function public.update_pos_prep_ticket_status(uuid, text, uuid) from public;
grant execute on function public.update_pos_prep_ticket_status(uuid, text, uuid) to anon, authenticated, service_role;

-- Audit log
revoke all on function public.append_pos_audit_log(jsonb) from public;
grant execute on function public.append_pos_audit_log(jsonb) to anon, authenticated, service_role;

-- Modifier groups, promotions, floor layout
revoke all on function public.upsert_pos_modifier_groups(jsonb) from public;
grant execute on function public.upsert_pos_modifier_groups(jsonb) to anon, authenticated, service_role;

revoke all on function public.upsert_pos_promotions(jsonb) from public;
grant execute on function public.upsert_pos_promotions(jsonb) to anon, authenticated, service_role;

revoke all on function public.upsert_pos_floor_layout(jsonb) from public;
grant execute on function public.upsert_pos_floor_layout(jsonb) to anon, authenticated, service_role;

-- Booking payment (canonical)
revoke all on function public.update_booking_payment(uuid, uuid, numeric, text, text, text, uuid, timestamptz) from public;
grant execute on function public.update_booking_payment(uuid, uuid, numeric, text, text, text, uuid, timestamptz) to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1.2 continued: Regression-check function for grant audit
-- ═══════════════════════════════════════════════════════════════════════════════
-- Returns any table+role combination that has write (INSERT/UPDATE/DELETE)
-- privileges on the critical financial tables.  If the query returns rows,
-- the lockdown is incomplete.

create or replace function public.audit_critical_write_grants()
returns table (
  table_name text,
  role_name text,
  has_insert boolean,
  has_update boolean,
  has_delete boolean
)
language sql
security definer
set search_path to 'public'
as $$
  select
    c.relname::text as table_name,
    r.rolname::text as role_name,
    has_table_privilege(r.oid, c.oid, 'INSERT') as has_insert,
    has_table_privilege(r.oid, c.oid, 'UPDATE') as has_update,
    has_table_privilege(r.oid, c.oid, 'DELETE') as has_delete
  from pg_class c
  join pg_roles r on r.rolname in ('anon', 'authenticated')
  where c.relname in (
    'pos_orders', 'pos_order_items', 'pos_return_lines',
    'booking_charges', 'payments',
    'inventory_items', 'inventory_movements',
    'pos_cashup_sessions', 'pos_shifts',
    'pos_override_log', 'pos_audit_log'
  )
    and c.relnamespace = 'public'::regnamespace
    and (
      has_table_privilege(r.oid, c.oid, 'INSERT')
      or has_table_privilege(r.oid, c.oid, 'UPDATE')
      or has_table_privilege(r.oid, c.oid, 'DELETE')
    )
  order by c.relname, r.rolname;
$$;

revoke all on function public.audit_critical_write_grants() from public;
grant execute on function public.audit_critical_write_grants() to service_role;

commit;
