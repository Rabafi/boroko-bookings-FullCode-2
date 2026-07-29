-- Replace self-attested setup ticks with evidence-based readiness detection.
-- A stage is only marked detected when the authoritative data for it exists.

create or replace function public.get_restaurant_setup_progress(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_settings jsonb;
  v_menu_count integer := 0;
  v_inventory_count integer := 0;
  v_detected boolean;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  select to_jsonb(s) into v_settings from public.settings s where s.lodge_id = p_lodge_id;
  select count(*) into v_menu_count from public.pos_menu_items where lodge_id = p_lodge_id and coalesce(is_available, true);
  select count(*) into v_inventory_count from public.inventory_items where lodge_id = p_lodge_id;

  return jsonb_build_array(
    jsonb_build_object('stage_key','business_profile','detected',v_settings is not null,'evidence',case when v_settings is not null then 'Business settings record found.' else 'No business settings record found.' end),
    jsonb_build_object('stage_key','tax_service','detected',coalesce(nullif(v_settings->>'vat_rate',''), nullif(v_settings->>'tax_rate','')) is not null,'evidence',case when coalesce(nullif(v_settings->>'vat_rate',''), nullif(v_settings->>'tax_rate','')) is not null then 'A tax setting is saved.' else 'No saved tax setting was detected.' end),
    jsonb_build_object('stage_key','outlets','detected',exists(select 1 from public.outlets where lodge_id=p_lodge_id and is_active),'evidence',(select count(*)::text || ' active outlet(s) found.' from public.outlets where lodge_id=p_lodge_id and is_active)),
    jsonb_build_object('stage_key','staff_accounts','detected',exists(select 1 from public.users where lodge_id=p_lodge_id and coalesce(status,'active')='active'),'evidence',(select count(*)::text || ' active staff account(s) found.' from public.users where lodge_id=p_lodge_id and coalesce(status,'active')='active')),
    jsonb_build_object('stage_key','staff_roles','detected',exists(select 1 from public.users where lodge_id=p_lodge_id and coalesce(status,'active')='active' and nullif(btrim(role),'') is not null),'evidence','Detected from active staff role assignments.'),
    jsonb_build_object('stage_key','staff_pins','detected',exists(select 1 from public.users where lodge_id=p_lodge_id and coalesce(status,'active')='active' and pin_hash is not null),'evidence',(select count(*)::text || ' active staff PIN(s) found.' from public.users where lodge_id=p_lodge_id and coalesce(status,'active')='active' and pin_hash is not null)),
    jsonb_build_object('stage_key','floor_plan','detected',exists(select 1 from public.restaurant_tables where lodge_id=p_lodge_id),'evidence',(select count(*)::text || ' table(s) found.' from public.restaurant_tables where lodge_id=p_lodge_id)),
    jsonb_build_object('stage_key','menu_categories','detected',(select count(distinct nullif(btrim(category),'')) from public.pos_menu_items where lodge_id=p_lodge_id) > 0,'evidence',(select count(distinct nullif(btrim(category),''))::text || ' menu category or categories found.' from public.pos_menu_items where lodge_id=p_lodge_id)),
    jsonb_build_object('stage_key','menu_pricing','detected',v_menu_count > 0,'evidence',v_menu_count::text || ' available priced menu item(s) found.'),
    jsonb_build_object('stage_key','modifiers_combos','detected',false,'evidence','Optional configuration: add a combo or modifier only when the menu needs it.'),
    jsonb_build_object('stage_key','kitchen_stations','detected',false,'evidence','Open Kitchen operations and configure stations when tickets need routing.'),
    jsonb_build_object('stage_key','inventory','detected',v_inventory_count > 0,'evidence',v_inventory_count::text || ' inventory item(s) found.'),
    jsonb_build_object('stage_key','suppliers_purchasing','detected',exists(select 1 from public.restaurant_suppliers where lodge_id=p_lodge_id),'evidence',(select count(*)::text || ' supplier(s) found.' from public.restaurant_suppliers where lodge_id=p_lodge_id)),
    jsonb_build_object('stage_key','recipes_prep','detected',exists(select 1 from public.restaurant_recipes where lodge_id=p_lodge_id) or exists(select 1 from public.restaurant_prep_items where lodge_id=p_lodge_id),'evidence',case when exists(select 1 from public.restaurant_recipes where lodge_id=p_lodge_id) or exists(select 1 from public.restaurant_prep_items where lodge_id=p_lodge_id) then 'Recipe or prep configuration found.' else 'No recipe or prep configuration found; optional for simple retail menus.' end),
    jsonb_build_object('stage_key','payments_tips','detected',exists(select 1 from public.pos_orders where lodge_id=p_lodge_id),'evidence',case when exists(select 1 from public.pos_orders where lodge_id=p_lodge_id) then 'A recorded Till sale proves a payment workflow has been used.' else 'No recorded Till sale yet.' end),
    jsonb_build_object('stage_key','receipt_hardware','detected',false,'evidence','This is checked live on the local POS computer, not guessed from a server record.'),
    jsonb_build_object('stage_key','daily_checklists','detected',exists(select 1 from public.restaurant_checklists where lodge_id=p_lodge_id),'evidence',(select count(*)::text || ' checklist(s) found.' from public.restaurant_checklists where lodge_id=p_lodge_id)),
    jsonb_build_object('stage_key','guest_policy','detected',exists(select 1 from public.restaurant_reservation_policies where lodge_id=p_lodge_id),'evidence',case when exists(select 1 from public.restaurant_reservation_policies where lodge_id=p_lodge_id) then 'Reservation policy configuration found.' else 'No reservation policy configuration found.' end),
    jsonb_build_object('stage_key','data_backup','detected',false,'evidence','A manager must run and verify an export from the protected data tools.'),
    jsonb_build_object('stage_key','go_live_review','detected',exists(select 1 from public.pos_orders where lodge_id=p_lodge_id) and exists(select 1 from public.restaurant_checklists where lodge_id=p_lodge_id),'evidence',case when exists(select 1 from public.pos_orders where lodge_id=p_lodge_id) and exists(select 1 from public.restaurant_checklists where lodge_id=p_lodge_id) then 'Recorded sale and operational checklist evidence found.' else 'A supervised sale and checklist are still required.' end)
  );
end;
$$;

revoke all on function public.get_restaurant_setup_progress(uuid) from public;
grant execute on function public.get_restaurant_setup_progress(uuid) to authenticated, service_role;
