-- Fix: grant SELECT and enable RLS on pos_order_items and pos_menu_items
-- ─────────────────────────────────────────────────────────────────────────────
-- These two tables were created as part of the POS phase but were never
-- included in 20260401_phase1_grants.sql or 20260401_phase1_rls.sql.
-- Without SELECT grants + an RLS select policy the client-side nested join
--   supabase.from('pos_orders').select('*, pos_order_items(*)')
-- fails with a permission error, which causes getPosRevenueSummary to fall
-- back to the offline cache and return zero revenue in Reports.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ─── pos_order_items ─────────────────────────────────────────────────────────

revoke all privileges on table public.pos_order_items from anon, authenticated;
grant select on table public.pos_order_items to anon, authenticated;

alter table public.pos_order_items enable row level security;

drop policy if exists pos_order_items_lodge_scope_select on public.pos_order_items;
create policy pos_order_items_lodge_scope_select
  on public.pos_order_items
  for select
  using (public.app_lodge_access(lodge_id));

-- ─── pos_menu_items ──────────────────────────────────────────────────────────

revoke all privileges on table public.pos_menu_items from anon, authenticated;
grant select on table public.pos_menu_items to anon, authenticated;

alter table public.pos_menu_items enable row level security;

drop policy if exists pos_menu_items_lodge_scope_select on public.pos_menu_items;
create policy pos_menu_items_lodge_scope_select
  on public.pos_menu_items
  for select
  using (public.app_lodge_access(lodge_id));

commit;
