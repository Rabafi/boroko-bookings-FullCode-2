-- Bar Base deferred controls:
--   * source-derived setup timestamps (never client attested)
--   * scoped, audited alert acknowledgement/resolution and history
--   * idempotent Bar opening/closing/shift/deep-clean checklist templates
--
-- This migration intentionally preserves the existing restaurant contracts and
-- keeps every mutation behind the same app-session/capability checks used by
-- the desktop (anon key + x-boroko-session) and Manager PWA.

begin;

-- Restaurant Accounting also has a capability helper, but it intentionally
-- requires the accounting add-on. Bar Base controls use this small POS-only
-- capability contract so the checklist/alert controls do not unlock or depend
-- on Accounting & Workforce.
create or replace function public._bar_control_require_capability(
  p_lodge_id uuid,
  p_capability text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid := public.app_current_user_id();
  v_role text;
  v_override jsonb;
  v_allowed boolean := false;
begin
  if public.app_is_service_role() then return v_actor; end if;
  if not public.app_lodge_access(p_lodge_id) then raise exception 'Access denied for this lodge.' using errcode = '42501'; end if;
  select lower(coalesce(u.role, '')), u.capability_overrides->p_capability
    into v_role, v_override
    from public.users u
   where u.id = v_actor and u.lodge_id = p_lodge_id and coalesce(u.status, 'active') = 'active';
  if not found then raise exception 'A valid staff session is required.' using errcode = '42501'; end if;
  v_allowed := case p_capability
    when 'pos.view' then v_role in ('cashier', 'supervisor', 'manager', 'admin', 'super_admin')
    when 'pos.manage' then v_role in ('supervisor', 'manager', 'admin', 'super_admin')
    else false
  end;
  if v_override is not null and jsonb_typeof(v_override) = 'boolean' then v_allowed := (v_override::text)::boolean; end if;
  if not v_allowed then raise exception 'POS capability % is required', p_capability using errcode = '42501'; end if;
  return v_actor;
end;
$$;
revoke all on function public._bar_control_require_capability(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Source-derived setup completion timestamps
-- ---------------------------------------------------------------------------
create or replace function public.get_restaurant_setup_progress(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_settings jsonb;
  v_bar_only boolean := false;
  v_menu_count integer := 0;
  v_priced_menu_count integer := 0;
  v_inventory_count integer := 0;
  v_costed_inventory_count integer := 0;
  v_exported boolean := false;
  v_sale_tested boolean := false;
  v_drawer_closed boolean := false;
  v_cashup_approved boolean := false;
  v_digest_created boolean := false;
  v_staff_roles_ready boolean := false;
  v_staff_pins_ready boolean := false;
  v_first_completed_shift boolean := false;
  v_business_at timestamptz;
  v_tax_at timestamptz;
  v_outlets_at timestamptz;
  v_staff_accounts_at timestamptz;
  v_staff_roles_at timestamptz;
  v_staff_pins_at timestamptz;
  v_floor_plan_at timestamptz;
  v_menu_categories_at timestamptz;
  v_menu_pricing_at timestamptz;
  v_inventory_catalog_at timestamptz;
  v_stock_cost_at timestamptz;
  v_inventory_link_at timestamptz;
  v_supplier_at timestamptz;
  v_recipe_at timestamptz;
  v_sale_at timestamptz;
  v_drawer_at timestamptz;
  v_cashup_at timestamptz;
  v_checklist_at timestamptz;
  v_digest_at timestamptz;
  v_export_at timestamptz;
  v_go_live_at timestamptz;
  v_staff_count integer := 0;
  v_staff_role_audit_count integer := 0;
  v_staff_pin_audit_count integer := 0;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  select to_jsonb(s),
         coalesce(s.updated_at, s.created_at)
    into v_settings, v_business_at
    from public.settings s
   where s.lodge_id = p_lodge_id
   limit 1;
  v_tax_at := v_business_at;
  v_bar_only := coalesce(v_settings->>'hospitality_mode', v_settings->>'operating_mode', v_settings->'operating_profile'->>'hospitality_mode', '') = 'bar_only'
    or coalesce(v_settings->>'commercial_package_key', v_settings->'operating_profile'->>'commercial_package_key', '') = 'bar_pos';

  select count(*), count(*) filter (where coalesce(price, 0) > 0)
    into v_menu_count, v_priced_menu_count
    from public.pos_menu_items
   where lodge_id = p_lodge_id and coalesce(is_available, true);
  select count(*), count(*) filter (where coalesce(latest_unit_cost, 0) > 0)
    into v_inventory_count, v_costed_inventory_count
    from public.inventory_items
   where lodge_id = p_lodge_id;
  select exists(select 1 from public.restaurant_setup_evidence where lodge_id = p_lodge_id and evidence_key = 'data_export'),
         (select min(recorded_at) from public.restaurant_setup_evidence where lodge_id = p_lodge_id and evidence_key = 'data_export')
    into v_exported, v_export_at;
  select exists(select 1 from public.pos_orders where lodge_id = p_lodge_id and coalesce(status, '') not in ('voided', 'cancelled') and coalesce(payment_method, '') <> ''),
         (select min(coalesce(completed_at, created_at)) from public.pos_orders where lodge_id = p_lodge_id and coalesce(status, '') not in ('voided', 'cancelled') and coalesce(payment_method, '') <> '')
    into v_sale_tested, v_sale_at;
  select exists(select 1 from public.restaurant_cash_drawer_sessions where lodge_id = p_lodge_id and status = 'closed' and closed_at is not null),
         (select min(closed_at) from public.restaurant_cash_drawer_sessions where lodge_id = p_lodge_id and status = 'closed' and closed_at is not null)
    into v_drawer_closed, v_drawer_at;
  select exists(select 1 from public.pos_cashup_submissions where lodge_id = p_lodge_id and status = 'approved' and reviewed_by is not null and reviewed_at is not null),
         (select min(reviewed_at) from public.pos_cashup_submissions where lodge_id = p_lodge_id and status = 'approved' and reviewed_by is not null and reviewed_at is not null)
    into v_cashup_approved, v_cashup_at;
  select exists(select 1 from public.restaurant_owner_digest where lodge_id = p_lodge_id),
         (select min(created_at) from public.restaurant_owner_digest where lodge_id = p_lodge_id)
    into v_digest_created, v_digest_at;

  select count(*) into v_staff_count
    from public.users
   where lodge_id = p_lodge_id and coalesce(status, 'active') = 'active';
  select v_staff_count > 0 and count(*) filter (where nullif(btrim(coalesce(role, '')), '') is null) = 0
    into v_staff_roles_ready
    from public.users
   where lodge_id = p_lodge_id and coalesce(status, 'active') = 'active';
  select v_staff_count > 0 and count(*) filter (where pin_hash is null) = 0
    into v_staff_pins_ready
    from public.users
   where lodge_id = p_lodge_id and coalesce(status, 'active') = 'active';
  -- The access-audit trigger is the only timestamp evidence for role/PIN edits;
  -- legacy rows without an audit event therefore remain complete but untimestamped.
  select count(*) filter (where exists (
           select 1 from public.staff_access_audit a
            where a.lodge_id = u.lodge_id and a.staff_user_id = u.id
              and a.action in ('staff_account_created', 'staff_role_changed')
         )),
         max((select max(a.created_at) from public.staff_access_audit a where a.lodge_id = u.lodge_id and a.staff_user_id = u.id and a.action in ('staff_account_created', 'staff_role_changed')))
    into v_staff_role_audit_count, v_staff_roles_at
    from public.users u
   where u.lodge_id = p_lodge_id and coalesce(u.status, 'active') = 'active';
  select count(*) filter (where exists (
           select 1 from public.staff_access_audit a
            where a.lodge_id = u.lodge_id and a.staff_user_id = u.id
              and a.action = 'staff_approval_pin_changed'
         )),
         max((select max(a.created_at) from public.staff_access_audit a where a.lodge_id = u.lodge_id and a.staff_user_id = u.id and a.action = 'staff_approval_pin_changed'))
    into v_staff_pin_audit_count, v_staff_pins_at
    from public.users u
   where u.lodge_id = p_lodge_id and coalesce(u.status, 'active') = 'active';
  if not v_staff_roles_ready or v_staff_role_audit_count < v_staff_count then v_staff_roles_at := null; end if;
  if not v_staff_pins_ready or v_staff_pin_audit_count < v_staff_count then v_staff_pins_at := null; end if;

  select exists(select 1 from public.restaurant_shifts where lodge_id = p_lodge_id and status = 'completed' and clock_out is not null and staff_user_id is not null),
         (select min(clock_out) from public.restaurant_shifts where lodge_id = p_lodge_id and status = 'completed' and clock_out is not null and staff_user_id is not null)
    into v_first_completed_shift, v_go_live_at;
  select min(created_at) into v_staff_accounts_at from public.users where lodge_id = p_lodge_id and coalesce(status, 'active') = 'active';
  select min(created_at) into v_outlets_at from public.outlets where lodge_id = p_lodge_id and is_active;
  select min(created_at) into v_floor_plan_at from public.restaurant_tables where lodge_id = p_lodge_id;
  select min(coalesce(updated_at, created_at)) into v_menu_categories_at from public.pos_menu_items where lodge_id = p_lodge_id and coalesce(is_available, true) and nullif(btrim(category), '') is not null;
  select min(coalesce(updated_at, created_at)) into v_menu_pricing_at from public.pos_menu_items where lodge_id = p_lodge_id and coalesce(is_available, true) and coalesce(price, 0) > 0;
  select min(coalesce(updated_at, created_at)) into v_inventory_catalog_at from public.inventory_items where lodge_id = p_lodge_id;
  select min(coalesce(updated_at, created_at)) into v_stock_cost_at from public.inventory_items where lodge_id = p_lodge_id and coalesce(latest_unit_cost, 0) > 0;
  select min(coalesce(updated_at, created_at)) into v_inventory_link_at from public.pos_menu_items where lodge_id = p_lodge_id and inventory_item_id is not null;
  select min(created_at) into v_supplier_at from public.restaurant_suppliers where lodge_id = p_lodge_id;
  select min(created_at) into v_recipe_at from public.restaurant_recipes where lodge_id = p_lodge_id;
  if v_recipe_at is null then select min(created_at) into v_recipe_at from public.restaurant_prep_items where lodge_id = p_lodge_id; end if;
  select min(created_at) into v_checklist_at from public.restaurant_checklists where lodge_id = p_lodge_id;
  if v_bar_only then v_floor_plan_at := null; v_recipe_at := null; end if;
  if v_bar_only then
    -- No table/recipe evidence is required in Bar-only mode; a null timestamp
    -- makes that N/A semantics explicit to consumers.
    v_floor_plan_at := null;
    v_recipe_at := null;
  end if;
  if v_exported and v_sale_tested and v_drawer_closed and v_cashup_approved and v_digest_created then
    select greatest(v_export_at, v_sale_at, v_drawer_at, v_cashup_at, v_digest_at) into v_go_live_at;
  else
    v_go_live_at := null;
  end if;

  return jsonb_build_array(
    jsonb_build_object('stage_key','business_profile','detected',v_settings is not null,'completed_at',case when v_settings is not null then v_business_at else null end,'evidence',case when v_settings is not null then 'Business settings record found.' else 'No business settings record found.' end),
    jsonb_build_object('stage_key','tax_service','detected',v_settings is not null and nullif(btrim(coalesce(v_settings->>'currency','')), '') is not null,'completed_at',case when v_settings is not null and nullif(btrim(coalesce(v_settings->>'currency','')), '') is not null then v_tax_at else null end,'evidence',case when v_settings is not null and nullif(btrim(coalesce(v_settings->>'currency','')), '') is not null then 'Currency and VAT settings are stored; 0% VAT is treated as a valid configured rate.' else 'Currency and VAT settings are not complete.' end),
    jsonb_build_object('stage_key','outlets','detected',v_outlets_at is not null,'completed_at',v_outlets_at,'evidence',(select count(*)::text || ' active outlet(s) found.' from public.outlets where lodge_id=p_lodge_id and is_active)),
    jsonb_build_object('stage_key','staff_accounts','detected',v_staff_accounts_at is not null,'completed_at',v_staff_accounts_at,'evidence',(select count(*)::text || ' active staff account(s) found.' from public.users where lodge_id=p_lodge_id and coalesce(status,'active')='active')),
    jsonb_build_object('stage_key','staff_roles','detected',v_staff_roles_ready,'completed_at',case when v_staff_roles_ready then v_staff_roles_at else null end,'evidence',case when v_staff_roles_ready then 'Every active staff account has a role assignment for least-privilege access.' else 'One or more active staff accounts has no role assignment.' end),
    jsonb_build_object('stage_key','staff_pins','detected',v_staff_pins_ready,'completed_at',case when v_staff_pins_ready then v_staff_pins_at else null end,'evidence',case when v_staff_pins_ready then 'Every active staff account has a private attendance/POS PIN.' else 'One or more active staff accounts is missing a private attendance/POS PIN.' end),
    jsonb_build_object('stage_key','floor_plan','detected',v_bar_only or exists(select 1 from public.restaurant_tables where lodge_id=p_lodge_id),'completed_at',case when v_bar_only then null else v_floor_plan_at end,'evidence',case when v_bar_only then 'Bar-only operating profile detected; tables are not required.' else (select count(*)::text || ' table(s) found.' from public.restaurant_tables where lodge_id=p_lodge_id) end),
    jsonb_build_object('stage_key','menu_categories','detected',v_menu_categories_at is not null,'completed_at',v_menu_categories_at,'evidence',(select count(distinct nullif(btrim(category),''))::text || ' menu category or categories found.' from public.pos_menu_items where lodge_id=p_lodge_id)),
    jsonb_build_object('stage_key','menu_pricing','detected',v_priced_menu_count > 0,'completed_at',v_menu_pricing_at,'evidence',v_priced_menu_count::text || ' available menu item(s) with a positive price found.'),
    jsonb_build_object('stage_key','modifiers_combos','detected',v_inventory_count > 0,'completed_at',v_inventory_catalog_at,'evidence',v_inventory_count::text || ' inventory item(s) found for stock and cost reporting.'),
    jsonb_build_object('stage_key','kitchen_stations','detected',v_costed_inventory_count > 0,'completed_at',v_stock_cost_at,'evidence',v_costed_inventory_count::text || ' inventory item(s) have a positive unit cost.'),
    jsonb_build_object('stage_key','inventory','detected',v_inventory_link_at is not null,'completed_at',v_inventory_link_at,'evidence',(select count(*)::text || ' menu item(s) are linked to inventory for sale-to-stock reporting.' from public.pos_menu_items where lodge_id=p_lodge_id and inventory_item_id is not null)),
    jsonb_build_object('stage_key','suppliers_purchasing','detected',v_supplier_at is not null,'completed_at',v_supplier_at,'evidence',(select count(*)::text || ' supplier(s) found.' from public.restaurant_suppliers where lodge_id=p_lodge_id)),
    jsonb_build_object('stage_key','recipes_prep','detected',v_bar_only or v_recipe_at is not null,'completed_at',case when v_bar_only then null else v_recipe_at end,'evidence',case when v_bar_only then 'Bar-only operating profile detected; food recipes and prep batches are not required.' when v_recipe_at is not null then 'Recipe or prep configuration found.' else 'No recipe or prep configuration found; add it for prepared items so cost reporting remains complete.' end),
    jsonb_build_object('stage_key','payments_tips','detected',v_sale_tested,'completed_at',v_sale_at,'evidence',case when v_sale_tested then 'A non-voided paid Till sale with a recorded tender was found.' else 'No completed payment-tender test sale found.' end),
    jsonb_build_object('stage_key','receipt_hardware','detected',v_drawer_closed,'completed_at',v_drawer_at,'evidence',case when v_drawer_closed then 'A cash drawer session has been closed and reconciled.' else 'Device verification is required on the local POS computer; saved settings alone do not complete this stage.' end),
    jsonb_build_object('stage_key','daily_checklists','detected',v_cashup_approved,'completed_at',v_cashup_at,'evidence',case when v_cashup_approved then 'A manager-approved cash-up with a review record was found.' else 'No manager-approved cash-up was found.' end),
    jsonb_build_object('stage_key','guest_policy','detected',v_checklist_at is not null,'completed_at',v_checklist_at,'evidence',(select count(*)::text || ' operational checklist(s) found.' from public.restaurant_checklists where lodge_id=p_lodge_id)),
    jsonb_build_object('stage_key','data_backup','detected',v_digest_created,'completed_at',v_digest_at,'evidence',case when v_digest_created then 'An owner end-of-day digest has been generated.' else 'No owner end-of-day digest has been generated.' end),
    jsonb_build_object('stage_key','go_live_review','detected',v_go_live_at is not null,'completed_at',v_go_live_at,'evidence',case when v_go_live_at is not null then 'Sale, cash drawer close, manager cash-up approval, end-of-day digest, and protected export evidence found.' else 'Complete a supervised sale, manager-approved cash-up, drawer close, owner digest, and protected export.' end),
    jsonb_build_object('stage_key','first_completed_shift','detected',v_first_completed_shift,'completed_at',(select min(clock_out) from public.restaurant_shifts where lodge_id=p_lodge_id and status='completed' and clock_out is not null and staff_user_id is not null),'evidence',case when v_first_completed_shift then 'A staff-linked shift has been completed and clocked out.' else 'No completed staff-linked shift has been recorded yet.' end)
  );
end;
$$;

revoke all on function public.get_restaurant_setup_progress(uuid) from public;
grant execute on function public.get_restaurant_setup_progress(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Alert categories, outlet scope, and append-only lifecycle evidence
-- ---------------------------------------------------------------------------
alter table public.restaurant_alerts
  add column if not exists outlet_id uuid references public.outlets(id),
  add column if not exists category text,
  add column if not exists acknowledged_by uuid references public.users(id),
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledgement_reason text,
  add column if not exists resolved_reason text;

alter table public.restaurant_alerts
  drop constraint if exists restaurant_alerts_category_check;
alter table public.restaurant_alerts
  add constraint restaurant_alerts_category_check
  check (category is null or category in ('stock', 'financial', 'operational', 'compliance'));
update public.restaurant_alerts
   set category = case
     when lower(alert_type) in ('stock_low', 'inventory', 'inventory_adjustment', 'stocktake') then 'stock'
     when lower(alert_type) in ('cash_variance', 'payment_failure', 'payment', 'financial', 'refund') then 'financial'
     when lower(alert_type) in ('compliance') then 'compliance'
     else 'operational'
   end
 where category is null;

create index if not exists restaurant_alerts_lodge_outlet_status_idx
  on public.restaurant_alerts (lodge_id, outlet_id, is_resolved, created_at desc);

create table if not exists public.restaurant_alert_events (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete restrict,
  alert_id uuid not null references public.restaurant_alerts(id) on delete restrict,
  outlet_id uuid references public.outlets(id),
  event_type text not null check (event_type in ('acknowledged', 'resolved')),
  actor_id uuid not null references public.users(id),
  reason text not null,
  operation_id text not null,
  payload_hash text not null,
  created_at timestamptz not null default now()
);
alter table public.restaurant_alert_events
  add column if not exists operation_id text,
  add column if not exists payload_hash text;
update public.restaurant_alert_events
   set operation_id = coalesce(operation_id, 'legacy:' || id::text),
       payload_hash = coalesce(payload_hash, encode(extensions.digest(convert_to(jsonb_build_object('event_type', event_type, 'alert_id', alert_id, 'reason', reason)::text, 'UTF8'), 'sha256'), 'hex'))
 where operation_id is null or payload_hash is null;
alter table public.restaurant_alert_events
  alter column operation_id set not null,
  alter column payload_hash set not null;
alter table public.restaurant_alert_events drop constraint if exists restaurant_alert_events_lodge_id_fkey;
alter table public.restaurant_alert_events add constraint restaurant_alert_events_lodge_id_fkey foreign key (lodge_id) references public.settings(lodge_id) on delete restrict;
alter table public.restaurant_alert_events drop constraint if exists restaurant_alert_events_alert_id_fkey;
alter table public.restaurant_alert_events add constraint restaurant_alert_events_alert_id_fkey foreign key (alert_id) references public.restaurant_alerts(id) on delete restrict;
create unique index if not exists restaurant_alert_events_lodge_operation_uidx
  on public.restaurant_alert_events (lodge_id, operation_id);
create index if not exists restaurant_alert_events_lodge_alert_created_idx
  on public.restaurant_alert_events (lodge_id, alert_id, created_at desc);
alter table public.restaurant_alert_events enable row level security;
drop policy if exists restaurant_alert_events_lodge_scope_select on public.restaurant_alert_events;
create policy restaurant_alert_events_lodge_scope_select on public.restaurant_alert_events for select using (public.app_lodge_access(lodge_id));
revoke all on table public.restaurant_alerts from public, anon, authenticated;
revoke all on table public.restaurant_alert_events from public, anon, authenticated;

create or replace function public.record_exception_alert(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_alert_id uuid := gen_random_uuid();
  v_alert_type text := lower(btrim(coalesce(payload->>'alert_type', 'custom')));
  v_category_input text := lower(btrim(coalesce(payload->>'category', '')));
  v_category text := lower(btrim(coalesce(payload->>'category', '')));
  v_severity text := lower(btrim(coalesce(payload->>'severity', 'info')));
  v_message text := btrim(coalesce(payload->>'message', ''));
  v_entity_type text := nullif(payload->>'entity_type', '');
  v_entity_id uuid := nullif(payload->>'entity_id', '')::uuid;
  v_actor uuid;
begin
  v_actor := public._bar_control_require_capability(v_lodge_id, 'pos.manage');
  if v_alert_type not in ('stock_low', 'cash_variance', 'ticket_aging', 'shift_handover', 'inventory', 'maintenance', 'compliance', 'system', 'void_spike', 'discount_abuse', 'refund_spike', 'custom') then return jsonb_build_object('success', false, 'error', 'That alert subtype is not recognised.'); end if;
  if v_alert_type = 'custom' and v_category_input = '' then return jsonb_build_object('success', false, 'error', 'Custom alerts must declare a high-level category.'); end if;
  if v_category = '' then
    v_category := case
      when v_alert_type in ('stock_low', 'inventory') then 'stock'
      when v_alert_type in ('cash_variance', 'void_spike', 'discount_abuse', 'refund_spike') then 'financial'
      when v_alert_type in ('compliance') then 'compliance'
      else 'operational'
    end;
  end if;
  if v_category not in ('stock', 'financial', 'operational', 'compliance') then return jsonb_build_object('success', false, 'error', 'A valid high-level alert category is required: stock, financial, operational or compliance.'); end if;
  if v_severity not in ('info', 'low', 'medium', 'high', 'critical', 'warning') then return jsonb_build_object('success', false, 'error', 'Alert severity is not recognised.'); end if;
  if v_message = '' then return jsonb_build_object('success', false, 'error', 'Alert message is required'); end if;
  if length(v_message) > 2000 then return jsonb_build_object('success', false, 'error', 'Alert messages are limited to 2000 characters.'); end if;
  if v_entity_type is not null and length(v_entity_type) > 100 then return jsonb_build_object('success', false, 'error', 'Alert entity types are limited to 100 characters.'); end if;
  if v_outlet_id is not null then perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id); end if;
  insert into public.restaurant_alerts (id, lodge_id, outlet_id, category, alert_type, severity, message, entity_type, entity_id)
  values (v_alert_id, v_lodge_id, v_outlet_id, v_category, v_alert_type, v_severity, v_message, v_entity_type, v_entity_id);
  return jsonb_build_object('success', true, 'alert_id', v_alert_id, 'category', v_category, 'alert_type', v_alert_type, 'outlet_id', v_outlet_id, 'created_by', v_actor);
end;
$$;

create or replace function public.get_restaurant_alert_history(
  p_lodge_id uuid,
  p_alert_category text default null,
  p_outlet_id uuid default null,
  p_include_resolved boolean default true,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_alerts jsonb;
  v_actor uuid;
  v_role text;
  v_allowed_outlet_ids uuid[] := '{}'::uuid[];
begin
  v_actor := public._bar_control_require_capability(p_lodge_id, 'pos.view');
  if nullif(btrim(coalesce(p_alert_category, '')), '') is not null and lower(btrim(p_alert_category)) not in ('stock', 'financial', 'operational', 'compliance') then
    raise exception 'Alert category must be stock, financial, operational or compliance' using errcode = '22023';
  end if;
  select lower(coalesce(role, '')), coalesce(allowed_outlet_ids, '{}'::uuid[])
    into v_role, v_allowed_outlet_ids
    from public.users where id = v_actor and lodge_id = p_lodge_id;
  if p_outlet_id is not null then perform public.app_require_pos_outlet_access(p_lodge_id, p_outlet_id); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'lodge_id', a.lodge_id, 'outlet_id', a.outlet_id,
    'alert_type', a.alert_type, 'category', coalesce(a.category, 'operational'), 'severity', a.severity,
    'message', a.message, 'entity_type', a.entity_type, 'entity_id', a.entity_id,
    'is_resolved', a.is_resolved, 'acknowledged_by', a.acknowledged_by,
    'acknowledged_at', a.acknowledged_at, 'acknowledgement_reason', a.acknowledgement_reason,
    'resolved_by', a.resolved_by, 'resolved_at', a.resolved_at, 'resolved_reason', a.resolved_reason,
    'created_at', a.created_at,
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'event_type', e.event_type, 'actor_id', e.actor_id, 'reason', e.reason, 'operation_id', e.operation_id, 'created_at', e.created_at) order by e.created_at asc) from public.restaurant_alert_events e where e.alert_id = a.id), '[]'::jsonb)
  ) order by a.created_at desc), '[]'::jsonb)
    into v_alerts
    from (
      select a0.*
        from public.restaurant_alerts a0
       where a0.lodge_id = p_lodge_id
         and (p_include_resolved or not a0.is_resolved)
         and (nullif(btrim(coalesce(p_alert_category, '')), '') is null or lower(coalesce(a0.category, 'operational')) = lower(btrim(p_alert_category)))
         and (
           (p_outlet_id is not null and (a0.outlet_id is null or a0.outlet_id = p_outlet_id))
           or (p_outlet_id is null and (
             v_role not in ('cashier', 'supervisor')
             or a0.outlet_id is null
             or a0.outlet_id = any(v_allowed_outlet_ids)
           ))
         )
       order by a0.created_at desc
       limit greatest(1, least(coalesce(p_limit, 100), 500))
    ) a;
  return coalesce(v_alerts, '[]'::jsonb);
end;
$$;

create or replace function public.get_active_alerts(p_lodge_id uuid)
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  select public.get_restaurant_alert_history(p_lodge_id, null, null, false, 100);
$$;

create or replace function public.acknowledge_exception_alert(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_alert_id uuid := nullif(payload->>'alert_id', '')::uuid;
  v_reason text := btrim(coalesce(payload->>'reason', ''));
  v_operation_id text := nullif(btrim(coalesce(payload->>'operation_id', '')), '');
  v_payload_hash text;
  v_actor uuid;
  v_alert public.restaurant_alerts%rowtype;
  v_event public.restaurant_alert_events%rowtype;
begin
  v_actor := public._bar_control_require_capability(v_lodge_id, 'pos.manage');
  if v_alert_id is null or length(v_reason) < 3 or length(v_reason) > 500 then return jsonb_build_object('success', false, 'error', 'An alert and an acknowledgement reason between 3 and 500 characters are required.'); end if;
  if v_operation_id is null or length(v_operation_id) < 8 or length(v_operation_id) > 128 or v_operation_id !~ '^[A-Za-z0-9:_-]+$' then return jsonb_build_object('success', false, 'error', 'A stable acknowledgement operation ID is required for safe retry.'); end if;
  v_payload_hash := encode(extensions.digest(convert_to(jsonb_build_object('action', 'acknowledge', 'alert_id', v_alert_id, 'reason', v_reason)::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtext(v_lodge_id::text || ':' || v_operation_id));
  select * into v_event from public.restaurant_alert_events where lodge_id = v_lodge_id and operation_id = v_operation_id for update;
  if found then
    if v_event.payload_hash is distinct from v_payload_hash or v_event.event_type <> 'acknowledged' or v_event.alert_id <> v_alert_id then return jsonb_build_object('success', false, 'error', 'This acknowledgement operation ID was already used with a different payload.', 'conflict', true); end if;
    return jsonb_build_object('success', true, 'alert_id', v_event.alert_id, 'acknowledged_by', v_event.actor_id, 'acknowledged_at', v_event.created_at, 'replayed', true);
  end if;
  select * into v_alert from public.restaurant_alerts where id = v_alert_id and lodge_id = v_lodge_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Alert not found in this lodge.'); end if;
  if v_alert.outlet_id is not null then perform public.app_require_pos_outlet_access(v_lodge_id, v_alert.outlet_id); end if;
  if v_alert.is_resolved then return jsonb_build_object('success', false, 'error', 'A resolved alert cannot be acknowledged.'); end if;
  if v_alert.acknowledged_at is not null then return jsonb_build_object('success', false, 'error', 'This alert has already been acknowledged.'); end if;
  update public.restaurant_alerts set acknowledged_by = v_actor, acknowledged_at = now(), acknowledgement_reason = v_reason where id = v_alert.id;
  insert into public.restaurant_alert_events (lodge_id, alert_id, outlet_id, event_type, actor_id, reason, operation_id, payload_hash) values (v_lodge_id, v_alert.id, v_alert.outlet_id, 'acknowledged', v_actor, v_reason, v_operation_id, v_payload_hash) returning * into v_event;
  return jsonb_build_object('success', true, 'alert_id', v_event.alert_id, 'acknowledged_by', v_event.actor_id, 'acknowledged_at', v_event.created_at, 'operation_id', v_event.operation_id);
end;
$$;

create or replace function public.resolve_exception_alert(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_alert_id uuid := nullif(payload->>'alert_id', '')::uuid;
  v_reason text := btrim(coalesce(payload->>'reason', ''));
  v_operation_id text := nullif(btrim(coalesce(payload->>'operation_id', '')), '');
  v_payload_hash text;
  v_actor uuid;
  v_alert public.restaurant_alerts%rowtype;
  v_event public.restaurant_alert_events%rowtype;
begin
  v_actor := public._bar_control_require_capability(v_lodge_id, 'pos.manage');
  if v_alert_id is null or length(v_reason) < 3 or length(v_reason) > 500 then return jsonb_build_object('success', false, 'error', 'An alert and a resolution reason between 3 and 500 characters are required.'); end if;
  if v_operation_id is null or length(v_operation_id) < 8 or length(v_operation_id) > 128 or v_operation_id !~ '^[A-Za-z0-9:_-]+$' then return jsonb_build_object('success', false, 'error', 'A stable resolution operation ID is required for safe retry.'); end if;
  v_payload_hash := encode(extensions.digest(convert_to(jsonb_build_object('action', 'resolve', 'alert_id', v_alert_id, 'reason', v_reason)::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtext(v_lodge_id::text || ':' || v_operation_id));
  select * into v_event from public.restaurant_alert_events where lodge_id = v_lodge_id and operation_id = v_operation_id for update;
  if found then
    if v_event.payload_hash is distinct from v_payload_hash or v_event.event_type <> 'resolved' or v_event.alert_id <> v_alert_id then return jsonb_build_object('success', false, 'error', 'This resolution operation ID was already used with a different payload.', 'conflict', true); end if;
    return jsonb_build_object('success', true, 'alert_id', v_event.alert_id, 'resolved_by', v_event.actor_id, 'resolved_at', v_event.created_at, 'operation_id', v_event.operation_id, 'replayed', true);
  end if;
  select * into v_alert from public.restaurant_alerts where id = v_alert_id and lodge_id = v_lodge_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Alert not found in this lodge.'); end if;
  if v_alert.outlet_id is not null then perform public.app_require_pos_outlet_access(v_lodge_id, v_alert.outlet_id); end if;
  if v_alert.is_resolved then return jsonb_build_object('success', false, 'error', 'This alert is already resolved.'); end if;
  update public.restaurant_alerts set is_resolved = true, resolved_by = v_actor, resolved_at = now(), resolved_reason = v_reason where id = v_alert.id and not is_resolved;
  insert into public.restaurant_alert_events (lodge_id, alert_id, outlet_id, event_type, actor_id, reason, operation_id, payload_hash) values (v_lodge_id, v_alert.id, v_alert.outlet_id, 'resolved', v_actor, v_reason, v_operation_id, v_payload_hash) returning * into v_event;
  return jsonb_build_object('success', true, 'alert_id', v_event.alert_id, 'resolved_by', v_event.actor_id, 'resolved_at', v_event.created_at, 'operation_id', v_event.operation_id);
end;
$$;

revoke all on function public.get_restaurant_alert_history(uuid, text, uuid, boolean, integer) from public;
revoke all on function public.get_active_alerts(uuid) from public;
revoke all on function public.record_exception_alert(jsonb) from public;
revoke all on function public.acknowledge_exception_alert(jsonb) from public;
revoke all on function public.resolve_exception_alert(jsonb) from public;
grant execute on function public.get_restaurant_alert_history(uuid, text, uuid, boolean, integer) to anon, authenticated, service_role;
grant execute on function public.get_active_alerts(uuid) to anon, authenticated, service_role;
grant execute on function public.record_exception_alert(jsonb) to anon, authenticated, service_role;
grant execute on function public.acknowledge_exception_alert(jsonb) to anon, authenticated, service_role;
grant execute on function public.resolve_exception_alert(jsonb) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Idempotent Bar checklist templates and instances
-- ---------------------------------------------------------------------------
create table if not exists public.restaurant_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  template_key text not null,
  name text not null,
  checklist_type text not null,
  items jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lodge_id, template_key)
);
alter table public.restaurant_checklist_templates enable row level security;
drop policy if exists restaurant_checklist_templates_lodge_scope_select on public.restaurant_checklist_templates;
create policy restaurant_checklist_templates_lodge_scope_select on public.restaurant_checklist_templates for select using (public.app_lodge_access(lodge_id));
revoke all on table public.restaurant_checklist_templates from anon, authenticated;

alter table public.restaurant_checklists
  add column if not exists template_id uuid references public.restaurant_checklist_templates(id),
  add column if not exists template_key text,
  add column if not exists outlet_id uuid references public.outlets(id),
  add column if not exists created_by uuid references public.users(id),
  add column if not exists operation_id text,
  add column if not exists payload_hash text;
create unique index if not exists restaurant_checklists_lodge_operation_uidx
  on public.restaurant_checklists (lodge_id, operation_id)
  where operation_id is not null;

create or replace function public.seed_bar_checklist_templates(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inserted integer := 0;
begin
  perform public._bar_control_require_capability(p_lodge_id, 'pos.manage');
  if not exists (select 1 from public.settings s where s.lodge_id = p_lodge_id and (coalesce(to_jsonb(s)->>'hospitality_mode', to_jsonb(s)->>'operating_mode', to_jsonb(s)->'operating_profile'->>'hospitality_mode', '') = 'bar_only' or coalesce(to_jsonb(s)->>'commercial_package_key', to_jsonb(s)->'operating_profile'->>'commercial_package_key', '') = 'bar_pos')) then
    return jsonb_build_object('success', false, 'error', 'Bar checklist templates are only available for a Bar operating profile.');
  end if;
  insert into public.restaurant_checklist_templates (lodge_id, template_key, name, checklist_type, items)
  values
    (p_lodge_id, 'bar_opening', 'Bar Opening', 'bar_opening', '[{"label":"Confirm till, receipt and drawer hardware test on this POS computer."},{"label":"Verify opening float and cash drawer seal."},{"label":"Check bar stock counts and low-stock exceptions."},{"label":"Confirm menu availability, prices and outlet assignment."}]'::jsonb),
    (p_lodge_id, 'bar_closing', 'Bar Closing', 'bar_closing', '[{"label":"Stop new orders and confirm all open tabs are accounted for."},{"label":"Complete blind cash-up and submit the drawer count."},{"label":"Secure bar stock, cash and receipt records."},{"label":"Review active exceptions and hand over unresolved work."}]'::jsonb),
    (p_lodge_id, 'bar_end_of_shift', 'End of Shift', 'bar_end_of_shift', '[{"label":"Clock out with the staff member’s private PIN."},{"label":"Record shift handover notes and unresolved service work."},{"label":"Confirm open tabs and pending tickets have an owner."}]'::jsonb),
    (p_lodge_id, 'bar_weekly_deep_clean', 'Weekly Deep Clean', 'bar_weekly_deep_clean', '[{"label":"Deep-clean and inspect taps, lines, fridges and coolers."},{"label":"Clean glassware, speed rails, shelves and storage surfaces."},{"label":"Check spill kits, cleaning supplies and safety signage."},{"label":"Record maintenance issues as an incident before reopening."}]'::jsonb)
  on conflict (lodge_id, template_key) do nothing;
  get diagnostics v_inserted = row_count;
  return jsonb_build_object('success', true, 'inserted', v_inserted, 'template_keys', jsonb_build_array('bar_opening','bar_closing','bar_end_of_shift','bar_weekly_deep_clean'));
end;
$$;

create or replace function public.get_bar_checklist_templates(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_templates jsonb;
begin
  perform public._bar_control_require_capability(p_lodge_id, 'pos.view');
  select coalesce(jsonb_agg(to_jsonb(t) order by t.name), '[]'::jsonb) into v_templates from public.restaurant_checklist_templates t where t.lodge_id = p_lodge_id and t.active;
  return v_templates;
end;
$$;

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
  if v_template_key not in ('bar_opening','bar_closing','bar_end_of_shift','bar_weekly_deep_clean') then return jsonb_build_object('success', false, 'error', 'That Bar checklist template is not recognised.'); end if;
  if v_operation_id is null or length(v_operation_id) < 8 or length(v_operation_id) > 128 or v_operation_id !~ '^[A-Za-z0-9:_-]+$' then return jsonb_build_object('success', false, 'error', 'A stable checklist operation ID is required for safe retry.'); end if;
  if v_outlet_id is not null then perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id); end if;
  v_payload_hash := encode(extensions.digest(convert_to(jsonb_build_object('template_key', v_template_key, 'outlet_id', v_outlet_id)::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtext(v_lodge_id::text || ':' || v_operation_id));
  select id, payload_hash into v_existing_id, v_existing_hash from public.restaurant_checklists where lodge_id = v_lodge_id and operation_id = v_operation_id limit 1;
  if v_existing_id is not null then
    if v_existing_hash is distinct from v_payload_hash then return jsonb_build_object('success', false, 'error', 'This checklist operation ID was already used with a different template or outlet.', 'conflict', true); end if;
    return jsonb_build_object('success', true, 'checklist_id', v_existing_id, 'operation_id', v_operation_id, 'replayed', true);
  end if;
  select * into v_template from public.restaurant_checklist_templates where lodge_id = v_lodge_id and template_key = v_template_key and active;
  if not found then return jsonb_build_object('success', false, 'error', 'Seed the Bar checklist templates before creating an instance.'); end if;
  insert into public.restaurant_checklists (id, lodge_id, checklist_type, status, template_id, template_key, outlet_id, created_by, operation_id, payload_hash)
  values (v_id, v_lodge_id, v_template.checklist_type, 'pending', v_template.id, v_template.template_key, v_outlet_id, v_actor, v_operation_id, v_payload_hash)
  on conflict (lodge_id, operation_id) do nothing;
  if not found then
    select id, payload_hash into v_existing_id, v_existing_hash from public.restaurant_checklists where lodge_id = v_lodge_id and operation_id = v_operation_id;
    if v_existing_hash is distinct from v_payload_hash then return jsonb_build_object('success', false, 'error', 'This checklist operation ID was already used with a different template or outlet.', 'conflict', true); end if;
    return jsonb_build_object('success', true, 'checklist_id', v_existing_id, 'operation_id', v_operation_id, 'replayed', true);
  end if;
  for v_item in select * from jsonb_array_elements(v_template.items) loop
    insert into public.restaurant_checklist_items (checklist_id, item_label) values (v_id, btrim(coalesce(v_item->>'label', '')));
  end loop;
  return jsonb_build_object('success', true, 'checklist_id', v_id, 'template_key', v_template_key, 'operation_id', v_operation_id);
end;
$$;

revoke all on function public.seed_bar_checklist_templates(uuid) from public;
revoke all on function public.get_bar_checklist_templates(uuid) from public;
revoke all on function public.create_bar_checklist_from_template(jsonb) from public;
grant execute on function public.seed_bar_checklist_templates(uuid) to anon, authenticated, service_role;
grant execute on function public.get_bar_checklist_templates(uuid) to anon, authenticated, service_role;
grant execute on function public.create_bar_checklist_from_template(jsonb) to anon, authenticated, service_role;

commit;
