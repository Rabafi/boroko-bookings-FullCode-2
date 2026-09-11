-- Manager-unlock + PIN-staff shift order attribution demo for
-- create_pos_order_v3 (Task B acceptance for 20260730100000).
--
-- Proves on live definitions: with a shared Till unlocked by a manager and
-- a PIN-verified waiter owning the open shift, the recorded order attributes
-- the OPERATOR (cashier_id) to the shift-owning waiter while the AUDIT actor
-- stays the manager.
--
-- Runs ONLY through tests/run-pos-attribution-sql.mjs, which requires an
-- explicit POS_SETTLEMENT_TEST_DB_URL (a scratch project — never
-- production). Everything executes inside one transaction that ALWAYS rolls
-- back: no fixture, order, proof, or audit row survives.
--
-- The operator-proof row is inserted directly with the exact shape the
-- PIN-unlock path mints (sha256 token hash, lodge/outlet/staff/shift scope,
-- created_by = unlocking manager, fresh expiry). Proof minting itself is
-- application PIN verification, covered by bar-till-operator-policy tests;
-- what is proven here is the server-side attribution once a valid proof
-- exists.
begin;

do $demo$
declare
  v_lodge uuid := gen_random_uuid();
  v_manager uuid := gen_random_uuid();
  v_waiter uuid := gen_random_uuid();
  v_outlet uuid := gen_random_uuid();
  v_shift uuid := gen_random_uuid();
  v_snap uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_tab uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_token text := 'attribution-demo-token';
  v_now text := now()::text;
  v_items jsonb;
  v_payload jsonb;
  v_result jsonb;
  v_cashier uuid;
  v_actor uuid;
begin
  -- ── Fixtures (all synthetic; rolled back at the end) ──
  insert into public.settings (lodge_id, lodge_name, company_name, business_type, property_type, currency, operating_profile)
  values (v_lodge, 'Attribution Demo', 'Attribution Demo', 'restaurant', 'restaurant', 'BWP', '{"hospitality_mode": "bar_only"}'::jsonb);
  insert into public.users (id, lodge_id, name, email, role, password_hash, status) values
    (v_manager, v_lodge, 'Demo Manager', 'demo-manager@test.invalid', 'manager', 'test-only', 'active'),
    (v_waiter, v_lodge, 'Demo Waiter', 'demo-waiter@test.invalid', 'cashier', 'test-only', 'active');
  insert into public.app_sessions (token_hash, session_type, user_id, lodge_id, role, expires_at)
  values (public.app_hash_token('attribution-demo-session'), 'desktop', v_manager, v_lodge, 'manager', now() + interval '1 hour');
  perform set_config('app.session_token', 'attribution-demo-session', true);
  insert into public.outlets (id, lodge_id, name, type)
  values (v_outlet, v_lodge, 'Demo Bar', 'beverage');
  insert into public.pos_shifts (id, lodge_id, outlet_id, cashier_id, cashier_name, status)
  values (v_shift, v_lodge, v_outlet, v_waiter, 'Demo Waiter', 'open');
  -- Active attendance proving the waiter for this outlet (required by the
  -- shift-ownership check alongside the open Till shift).
  insert into public.restaurant_shifts (lodge_id, staff_name, staff_user_id, outlet_id, status, clock_out)
  values (v_lodge, 'Demo Waiter', v_waiter, v_outlet, 'active', null);
  insert into public.pos_catalog_snapshots (id, lodge_id, outlet_id, version_number, vat_enabled, vat_rate, payload, payload_hash)
  values (v_snap, v_lodge, v_outlet, 1, false, 0, jsonb_build_object(
    'items', jsonb_build_array(jsonb_build_object(
      'id', v_item, 'name', 'Demo Beer', 'category', 'Drinks', 'price', 30,
      'is_available', true, 'inventory_item_id', null, 'depletion_qty', 1,
      'outlet_id', null, 'barcode', null, 'kitchen_station_id', null)),
    'modifier_groups', '[]'::jsonb, 'promotions', '[]'::jsonb,
    'vat_enabled', false, 'vat_rate', 0), 'attribution-demo');
  insert into public.pos_menu_items (id, lodge_id, outlet_id, name, category, price, is_available, stock_method, inventory_item_id)
  values (v_item, v_lodge, v_outlet, 'Demo Beer', 'Drinks', 30, true, 'non_stock', null);
  insert into public.pos_tabs (id, lodge_id, outlet_id, table_name, tab_name, waiter_name, waiter_id, shift_id, items, status, opened_by, tab_version)
  values (v_tab, v_lodge, v_outlet, 'DEMO1', 'DEMO1', 'Demo Waiter', v_waiter, v_shift, '[]'::jsonb, 'open', v_waiter, 1);
  -- The PIN-unlock-equivalent proof: minted by the manager for the waiter in
  -- the current shift/outlet, fresh expiry.
  insert into public.pos_till_operator_proofs (token_hash, lodge_id, outlet_id, staff_id, pos_shift_id, expires_at, created_by)
  values (encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'), v_lodge, v_outlet, v_waiter, v_shift, now() + interval '1 hour', v_manager);

  -- ── The order: manager session, waiter payload + PIN proof ──
  v_items := jsonb_build_array(jsonb_build_object(
    'menu_item_id', v_item, 'quantity', 1, 'modifier_option_ids', '[]'::jsonb, 'item_notes', null));
  v_payload := jsonb_build_object(
    'id', v_order, 'submit_intent_id', v_order, 'create_idempotency_key', 'attribution-demo-1',
    'lodge_id', v_lodge, 'outlet_id', v_outlet, 'shift_id', v_shift,
    'catalog_snapshot_id', v_snap, 'source_device_id', 'attribution-demo',
    'client_created_at', v_now, 'payment_method', 'cash',
    'payment_breakdown', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 30)),
    'items', v_items, 'service_mode', 'counter',
    'walk_in_name', 'Attribution', 'waiter_name', 'Demo Waiter', 'waiter_id', v_waiter,
    'table_name', 'DEMO1', 'tab_name', 'DEMO1', 'tab_id', v_tab, 'expected_tab_version', 1,
    '_operator_proof', v_token);
  v_result := public.create_pos_order_v3(v_payload);
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'ATTRIBUTION DEMO FAILED: order rejected: %', coalesce(v_result->>'error', left(v_result::text, 300));
  end if;
  if coalesce((v_result->>'cashier_id')::text, '') <> v_waiter::text then
    raise exception 'ATTRIBUTION DEMO FAILED: operator is %, expected shift-owning waiter %', coalesce(v_result->>'cashier_id', '?'), v_waiter;
  end if;

  -- ── Audit split: operator = waiter, actor = manager ──
  select o.cashier_id, a.actor_id into v_cashier, v_actor
    from public.pos_orders o
    join public.pos_audit_log a on a.order_id = o.id and a.action = 'pos_order_created'
   where o.id = v_order and o.lodge_id = v_lodge;
  if v_cashier is distinct from v_waiter then
    raise exception 'ATTRIBUTION DEMO FAILED: stored operator % is not the waiter %', v_cashier, v_waiter;
  end if;
  if v_actor is distinct from v_manager then
    raise exception 'ATTRIBUTION DEMO FAILED: stored audit actor % is not the manager %', v_actor, v_manager;
  end if;
  raise notice 'ATTRIBUTION DEMO OK: operator = shift-owning waiter, audit actor = unlocking manager';
end
$demo$;

rollback;
