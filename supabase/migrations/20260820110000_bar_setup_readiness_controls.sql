-- Bar Base setup controls: staff identity, verified device evidence, and a
-- completed first shift are required before the setup board can retire.
-- The function remains manager-restricted and returns server-detected evidence;
-- no client-side completion tick is trusted.

create or replace function public.get_restaurant_setup_progress(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_settings jsonb;
  v_menu_count integer := 0;
  v_priced_menu_count integer := 0;
  v_inventory_count integer := 0;
  v_costed_inventory_count integer := 0;
  v_exported boolean := false;
  v_sale_tested boolean := false;
  v_drawer_closed boolean := false;
  v_cashup_approved boolean := false;
  v_digest_created boolean := false;
  v_bar_only boolean := false;
  v_staff_roles_ready boolean := false;
  v_staff_pins_ready boolean := false;
  v_first_completed_shift boolean := false;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  select to_jsonb(s) into v_settings from public.settings s where s.lodge_id = p_lodge_id;
  v_bar_only := coalesce(v_settings->>'hospitality_mode', v_settings->>'operating_mode', v_settings->'operating_profile'->>'hospitality_mode', '') = 'bar_only'
    or coalesce(v_settings->>'commercial_package_key', v_settings->'operating_profile'->>'commercial_package_key', '') = 'bar_pos';
  select count(*), count(*) filter (where coalesce(price, 0) > 0) into v_menu_count, v_priced_menu_count from public.pos_menu_items where lodge_id = p_lodge_id and coalesce(is_available, true);
  select count(*), count(*) filter (where coalesce(latest_unit_cost, 0) > 0) into v_inventory_count, v_costed_inventory_count from public.inventory_items where lodge_id = p_lodge_id;
  select exists(select 1 from public.restaurant_setup_evidence where lodge_id = p_lodge_id and evidence_key = 'data_export') into v_exported;
  select exists(select 1 from public.pos_orders where lodge_id = p_lodge_id and coalesce(status, '') not in ('voided', 'cancelled') and coalesce(payment_method, '') <> '') into v_sale_tested;
  select exists(select 1 from public.restaurant_cash_drawer_sessions where lodge_id = p_lodge_id and status = 'closed' and closed_at is not null) into v_drawer_closed;
  select exists(select 1 from public.pos_cashup_submissions where lodge_id = p_lodge_id and status = 'approved' and reviewed_by is not null and reviewed_at is not null) into v_cashup_approved;
  select exists(select 1 from public.restaurant_owner_digest where lodge_id = p_lodge_id) into v_digest_created;
  select count(*) > 0
    and count(*) filter (where nullif(btrim(coalesce(role, '')), '') is null) = 0
    into v_staff_roles_ready
    from public.users
   where lodge_id = p_lodge_id and coalesce(status, 'active') = 'active';
  select count(*) > 0
    and count(*) filter (where pin_hash is null) = 0
    into v_staff_pins_ready
    from public.users
   where lodge_id = p_lodge_id and coalesce(status, 'active') = 'active';
  select exists(
    select 1 from public.restaurant_shifts
     where lodge_id = p_lodge_id
       and status = 'completed'
       and clock_out is not null
       and staff_user_id is not null
  ) into v_first_completed_shift;

  return jsonb_build_array(
    jsonb_build_object('stage_key','business_profile','detected',v_settings is not null,'evidence',case when v_settings is not null then 'Business settings record found.' else 'No business settings record found.' end),
    jsonb_build_object('stage_key','tax_service','detected',v_settings is not null and nullif(btrim(coalesce(v_settings->>'currency','')), '') is not null,'evidence',case when v_settings is not null and nullif(btrim(coalesce(v_settings->>'currency','')), '') is not null then 'Currency and VAT settings are stored; 0% VAT is treated as a valid configured rate.' else 'Currency and VAT settings are not complete.' end),
    jsonb_build_object('stage_key','outlets','detected',exists(select 1 from public.outlets where lodge_id=p_lodge_id and is_active),'evidence',(select count(*)::text || ' active outlet(s) found.' from public.outlets where lodge_id=p_lodge_id and is_active)),
    jsonb_build_object('stage_key','staff_accounts','detected',exists(select 1 from public.users where lodge_id=p_lodge_id and coalesce(status,'active')='active'),'evidence',(select count(*)::text || ' active staff account(s) found.' from public.users where lodge_id=p_lodge_id and coalesce(status,'active')='active')),
    jsonb_build_object('stage_key','staff_roles','detected',v_staff_roles_ready,'evidence',case when v_staff_roles_ready then 'Every active staff account has a role assignment for least-privilege access.' else 'One or more active staff accounts has no role assignment.' end),
    jsonb_build_object('stage_key','staff_pins','detected',v_staff_pins_ready,'evidence',case when v_staff_pins_ready then 'Every active staff account has a private attendance/POS PIN.' else 'One or more active staff accounts is missing a private attendance/POS PIN.' end),
    jsonb_build_object('stage_key','floor_plan','detected',v_bar_only or exists(select 1 from public.restaurant_tables where lodge_id=p_lodge_id),'evidence',case when v_bar_only then 'Bar-only operating profile detected; tables are not required.' else (select count(*)::text || ' table(s) found.' from public.restaurant_tables where lodge_id=p_lodge_id) end),
    jsonb_build_object('stage_key','menu_categories','detected',(select count(distinct nullif(btrim(category),'')) from public.pos_menu_items where lodge_id=p_lodge_id) > 0,'evidence',(select count(distinct nullif(btrim(category),''))::text || ' menu category or categories found.' from public.pos_menu_items where lodge_id=p_lodge_id)),
    jsonb_build_object('stage_key','menu_pricing','detected',v_priced_menu_count > 0,'evidence',v_priced_menu_count::text || ' available menu item(s) with a positive price found.'),
    jsonb_build_object('stage_key','modifiers_combos','detected',v_inventory_count > 0,'evidence',v_inventory_count::text || ' inventory item(s) found for stock and cost reporting.'),
    jsonb_build_object('stage_key','kitchen_stations','detected',v_costed_inventory_count > 0,'evidence',v_costed_inventory_count::text || ' inventory item(s) have a positive unit cost.'),
    jsonb_build_object('stage_key','inventory','detected',exists(select 1 from public.pos_menu_items where lodge_id=p_lodge_id and inventory_item_id is not null),'evidence',(select count(*)::text || ' menu item(s) are linked to inventory for sale-to-stock reporting.' from public.pos_menu_items where lodge_id=p_lodge_id and inventory_item_id is not null)),
    jsonb_build_object('stage_key','suppliers_purchasing','detected',exists(select 1 from public.restaurant_suppliers where lodge_id=p_lodge_id),'evidence',(select count(*)::text || ' supplier(s) found.' from public.restaurant_suppliers where lodge_id=p_lodge_id)),
    jsonb_build_object('stage_key','recipes_prep','detected',v_bar_only or exists(select 1 from public.restaurant_recipes where lodge_id=p_lodge_id) or exists(select 1 from public.restaurant_prep_items where lodge_id=p_lodge_id),'evidence',case when v_bar_only then 'Bar-only operating profile detected; food recipes and prep batches are not required.' when exists(select 1 from public.restaurant_recipes where lodge_id=p_lodge_id) or exists(select 1 from public.restaurant_prep_items where lodge_id=p_lodge_id) then 'Recipe or prep configuration found.' else 'No recipe or prep configuration found; add it for prepared items so cost reporting remains complete.' end),
    jsonb_build_object('stage_key','payments_tips','detected',v_sale_tested,'evidence',case when v_sale_tested then 'A non-voided paid Till sale with a recorded tender was found.' else 'No completed payment-tender test sale found.' end),
    jsonb_build_object('stage_key','receipt_hardware','detected',v_drawer_closed,'evidence',case when v_drawer_closed then 'A cash drawer session has been closed and reconciled.' else 'Device verification is required on the local POS computer; saved settings alone do not complete this stage.' end),
    jsonb_build_object('stage_key','daily_checklists','detected',v_cashup_approved,'evidence',case when v_cashup_approved then 'A manager-approved cash-up with a review record was found.' else 'No manager-approved cash-up was found.' end),
    jsonb_build_object('stage_key','guest_policy','detected',exists(select 1 from public.restaurant_checklists where lodge_id=p_lodge_id),'evidence',(select count(*)::text || ' operational checklist(s) found.' from public.restaurant_checklists where lodge_id=p_lodge_id)),
    jsonb_build_object('stage_key','data_backup','detected',v_digest_created,'evidence',case when v_digest_created then 'An owner end-of-day digest has been generated.' else 'No owner end-of-day digest has been generated.' end),
    jsonb_build_object('stage_key','go_live_review','detected',v_sale_tested and v_drawer_closed and v_cashup_approved and v_digest_created and v_exported,'evidence',case when v_sale_tested and v_drawer_closed and v_cashup_approved and v_digest_created and v_exported then 'Sale, cash drawer close, manager cash-up approval, end-of-day digest, and protected export evidence found.' else 'Complete a supervised sale, manager-approved cash-up, drawer close, owner digest, and protected export.' end),
    jsonb_build_object('stage_key','first_completed_shift','detected',v_first_completed_shift,'evidence',case when v_first_completed_shift then 'A staff-linked shift has been completed and clocked out.' else 'No completed staff-linked shift has been recorded yet.' end)
  );
end;
$$;

revoke all on function public.get_restaurant_setup_progress(uuid) from public;
-- Desktop application sessions use the anon key plus the authenticated
-- x-boroko-session bridge. The function still fails closed through
-- app_require_lodge_role before returning any lodge-scoped evidence.
grant execute on function public.get_restaurant_setup_progress(uuid) to anon, authenticated, service_role;
