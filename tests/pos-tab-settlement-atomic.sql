-- Post-deploy verification for atomic tab settlement in create_pos_order_v3
-- (migration 20260905230000_pos_v3_atomic_tab_settlement.sql).
--
-- Run:  node tests/run-pos-settlement-sql.mjs
--       (requires POS_SETTLEMENT_TEST_DB_URL; otherwise the runner skips)
-- Or:   psql "$CONNECTION" -v ON_ERROR_STOP=1 -f tests/pos-tab-settlement-atomic.sql
--
-- Everything below is read-only introspection against the deployed function
-- definition, so it is safe to run against the linked project. It raises on
-- the first missing contract element. Behavioral (write-path) settlement
-- proof additionally requires the Bar POS app flow; pgTAP-style fixtures are
-- intentionally not pointed at production data here.

do $verify$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.create_pos_order_v3(jsonb)'::regprocedure)
    into v_definition;
  if v_definition is null then
    raise exception 'VERIFY FAILED: create_pos_order_v3(jsonb) is not installed';
  end if;

  -- Atomic settlement block: resolve-or-create, close, version, audit.
  if position('pos_tab_settled' in v_definition) = 0 then
    raise exception 'VERIFY FAILED: settlement audit (pos_tab_settled) missing from v3';
  end if;
  if position('tab_version = tab_version + 1' in v_definition) = 0 then
    raise exception 'VERIFY FAILED: tab version increment missing from v3 settlement';
  end if;
  if position('upsert_pos_tab(jsonb_build_object(' in v_definition) = 0 then
    raise exception 'VERIFY FAILED: nested tab resolve-or-create missing from v3';
  end if;
  if position('tab_already_settled' in v_definition) = 0 then
    raise exception 'VERIFY FAILED: already-settled tab rejection missing from v3';
  end if;
  -- Duplicate-settlement guard: whitespace-insensitive (later migrations
  -- reformat the predicate; what matters is the same orders check paired
  -- with the tab_already_settled rejection code).
  if position('o.status in (' in v_definition) = 0
     or position('''completed''' in v_definition) = 0
     or position('''settled''' in v_definition) = 0
     or position('tab_already_settled' in v_definition) = 0 then
    raise exception 'VERIFY FAILED: duplicate-settlement orders check missing from v3';
  end if;
  if position('if v_tab_id is null' in v_definition) = 0 then
    raise exception 'VERIFY FAILED: tab_id-wins resolution branch missing from v3 (new tabs must never mint over a resumed id)';
  end if;
  if position('tab_version_conflict' in v_definition) = 0 then
    raise exception 'VERIFY FAILED: resumed-tab version guard missing from v3';
  end if;
  if position('tab_version_required' in v_definition) = 0 then
    raise exception 'VERIFY FAILED: mandatory tab version missing from v3';
  end if;
  -- Lodge waiter attribution: whitespace-insensitive (the bar-scope call
  -- site was reflowed; what matters is the bar-scope branch resolving the
  -- waiter to the PIN-verified operator).
  if position('_pos_tab_is_bar_scope(v_lodge_id)' in v_definition) = 0
     or position('then v_operator_id' in v_definition) = 0
     or position('''waiter_id''' in v_definition) = 0 then
    raise exception 'VERIFY FAILED: lodge waiter attribution missing from v3 tab resolve';
  end if;
  -- Claim-first ordering: an exact replay must return before any tab lock,
  -- status/version validation, ownership check, or resolve-or-create.
  if position('return v_claim->''operation_result''' in v_definition) = 0 then
    raise exception 'VERIFY FAILED: idempotent replay return missing from v3';
  end if;
  if position('return v_claim->''operation_result''' in v_definition) > position('into v_tab_status' in v_definition) then
    raise exception 'VERIFY FAILED: replay must precede the tab lock (retry would reject its own settled tab)';
  end if;
  if position('return v_claim->''operation_result''' in v_definition) > position('_pos_tab_settlement_owner_error(payload' in v_definition) then
    raise exception 'VERIFY FAILED: replay must precede ownership validation';
  end if;
  if position('return v_claim->''operation_result''' in v_definition) > position('upsert_pos_tab(jsonb_build_object(' in v_definition) then
    raise exception 'VERIFY FAILED: replay must precede tab resolve-or-create';
  end if;
  -- Name resolution is caller-opted-in: legacy and non-tab flows never mint.
  if position('resolve_tab' in v_definition) = 0 then
    raise exception 'VERIFY FAILED: resolve_tab caller flag missing from v3';
  end if;
  -- Failed settlement closes roll back instead of committing with a warning.
  if position('nothing was committed. Retry with the same operation key.' in v_definition) = 0 then
    raise exception 'VERIFY FAILED: rollback-on-unsettled-close missing from v3';
  end if;
  -- Every tab settlement presents a version; non-Bar resolve keeps the
  -- validated payload waiter while Bar keeps the proof-verified operator.
  if position('tab_version_required' in v_definition) = 0 then
    raise exception 'VERIFY FAILED: mandatory tab version missing from v3';
  end if;
  -- Lodge waiter attribution: whitespace-insensitive (the bar-scope call
  -- site was reflowed; what matters is the bar-scope branch resolving the
  -- waiter to the PIN-verified operator).
  if position('_pos_tab_is_bar_scope(v_lodge_id)' in v_definition) = 0
     or position('then v_operator_id' in v_definition) = 0
     or position('''waiter_id''' in v_definition) = 0 then
    raise exception 'VERIFY FAILED: lodge waiter attribution missing from v3 tab resolve';
  end if;
  if position('''tab_closed'', v_tab_closed' in v_definition) = 0 then
    raise exception 'VERIFY FAILED: tab_closed result field missing from v3';
  end if;
  if position('''tab_close_warning'', v_tab_close_warning' in v_definition) = 0 then
    raise exception 'VERIFY FAILED: tab_close_warning result field missing from v3';
  end if;

  -- No pre-existing guard may have been dropped by the rewrite.
  if position('v_bar_tender_error text;' in v_definition) = 0 then
    raise exception 'VERIFY FAILED: Bar tender entitlement guard missing from v3';
  end if;
  if position('v_tab_owner_error text;' in v_definition) = 0 then
    raise exception 'VERIFY FAILED: tab settlement ownership guard missing from v3';
  end if;
  if position('v_tab_id uuid' in v_definition) = 0 then
    raise exception 'VERIFY FAILED: tab link declaration missing from v3';
  end if;
  if position('''receipt_number'', (' in v_definition) = 0 then
    raise exception 'VERIFY FAILED: server receipt identity fields missing from v3';
  end if;
  if position('Promotion minimum spend is not met' in v_definition) = 0 then
    raise exception 'VERIFY FAILED: promotion checkout repair missing from v3';
  end if;
  if (length(v_definition) - length(replace(lower(v_definition), '_claim_financial_operation', ''))) / length('_claim_financial_operation') <> 1 then
    raise exception 'VERIFY FAILED: financial-claim contract ambiguous or missing in v3';
  end if;

  -- Settlement trigger guard stays in place for direct writers.
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_validate_pos_tender_references'
  ) then
    raise exception 'VERIFY FAILED: tender reference trigger missing';
  end if;

  raise notice 'VERIFY OK: atomic tab settlement contract is live in create_pos_order_v3';
end
$verify$;

-- ══════════════════════════════════════════════════════════════════════
-- Behavioral settlement proof (P0 R-0002 recovery cases).
--
-- Runs ONLY through tests/run-pos-settlement-sql.mjs, which requires an
-- explicit POS_SETTLEMENT_TEST_DB_URL (a scratch project — never
-- production). Everything below executes inside one transaction that ALWAYS
-- rolls back: no fixture, order, tab, claim, or audit row survives, whether
-- the cases pass or fail. All ids are synthetic (gen_random_uuid), so a
-- collision with real data is impossible by construction.
--
-- Cases: (A) settle tab by id closes it atomically with the order;
-- (B) exact retry returns the identical receipt and creates nothing;
-- (C) a second new operation against the settled tab is rejected;
-- (D) a stale expected version records nothing; the correct version settles.
-- ══════════════════════════════════════════════════════════════════════
begin;

do $behavior$
declare
  v_lodge uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_outlet uuid := gen_random_uuid();
  v_shift uuid := gen_random_uuid();
  v_snap uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_tab1 uuid := gen_random_uuid();
  v_tab2 uuid := gen_random_uuid();
  v_o1 uuid := gen_random_uuid();
  v_o2 uuid := gen_random_uuid();
  v_o3 uuid := gen_random_uuid();
  v_token text := 'r0002-probe-token';
  v_now text := now()::text;
  v_items jsonb;
  v_base jsonb;
  v_ra jsonb;
  v_rb jsonb;
  v_rc jsonb;
  v_rd jsonb;
  v_re jsonb;
  v_n integer;
  v_status text;
  v_version integer;
begin
  -- ── Fixtures (all synthetic; rolled back at the end) ──
  insert into public.users (id, lodge_id, name, email, role, password_hash, status)
  values (v_user, v_lodge, 'Settlement Probe', 'probe-r0002@test.invalid', 'manager', 'test-only', 'active');
  insert into public.app_sessions (token_hash, session_type, user_id, lodge_id, role, expires_at)
  values (public.app_hash_token(v_token), 'desktop', v_user, v_lodge, 'manager', now() + interval '1 hour');
  perform set_config('app.session_token', v_token, true);
  insert into public.outlets (id, lodge_id, name, type)
  values (v_outlet, v_lodge, 'Probe', 'food');
  insert into public.pos_shifts (id, lodge_id, outlet_id, cashier_id, cashier_name, status)
  values (v_shift, v_lodge, v_outlet, v_user, 'Settlement Probe', 'open');
  insert into public.pos_catalog_snapshots (id, lodge_id, outlet_id, version_number, vat_enabled, vat_rate, payload, payload_hash)
  values (v_snap, v_lodge, v_outlet, 1, false, 0, jsonb_build_object(
    'items', jsonb_build_array(jsonb_build_object(
      'id', v_item, 'name', 'Probe Coffee', 'category', 'Drinks', 'price', 25,
      'is_available', true, 'inventory_item_id', null, 'depletion_qty', 1,
      'outlet_id', null, 'barcode', null, 'kitchen_station_id', null)),
    'modifier_groups', '[]'::jsonb, 'promotions', '[]'::jsonb,
    'vat_enabled', false, 'vat_rate', 0), 'r0002');
  insert into public.pos_tabs (id, lodge_id, outlet_id, table_name, tab_name, waiter_name, waiter_id, shift_id, items, status, opened_by, tab_version)
  values
    (v_tab1, v_lodge, v_outlet, 'R2T1', 'R2T1', 'Settlement Probe', v_user, v_shift, '[]'::jsonb, 'open', v_user, 1),
    (v_tab2, v_lodge, v_outlet, 'R2T2', 'R2T2', 'Settlement Probe', v_user, v_shift, '[]'::jsonb, 'open', v_user, 1);
  -- The order-items readiness trigger requires a real catalogue row behind
  -- the snapshot item. Non-stock keeps the fixture minimal without touching
  -- depletion logic (covered separately by the recipe suite).
  insert into public.pos_menu_items (id, lodge_id, outlet_id, name, category, price, is_available, stock_method, inventory_item_id)
  values (v_item, v_lodge, v_outlet, 'Probe Coffee', 'Drinks', 25, true, 'non_stock', null);

  v_items := jsonb_build_array(jsonb_build_object(
    'menu_item_id', v_item, 'quantity', 1, 'modifier_option_ids', '[]'::jsonb, 'item_notes', null));
  v_base := jsonb_build_object(
    'lodge_id', v_lodge, 'outlet_id', v_outlet, 'shift_id', v_shift,
    'catalog_snapshot_id', v_snap, 'source_device_id', 'r0002-probe',
    'client_created_at', v_now, 'payment_method', 'cash',
    'payment_breakdown', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 25)),
    'items', v_items, 'service_mode', 'table',
    'walk_in_name', 'R0002', 'waiter_name', 'Settlement Probe', 'waiter_id', v_user);

  -- ── Case A: settle tab T1 by id ──
  -- expected_tab_version is mandatory for tab_id since the version-guard
  -- migration; T1 was opened at version 1.
  v_ra := public.create_pos_order_v3(v_base || jsonb_build_object(
    'id', v_o1, 'submit_intent_id', v_o1, 'create_idempotency_key', 'r0002-first',
    'table_name', 'R2T1', 'tab_name', 'R2T1', 'tab_id', v_tab1, 'expected_tab_version', 1));
  if coalesce((v_ra->>'success')::boolean, false) is not true then
    raise exception 'BEHAVIOR A FAILED: tab settlement rejected: %', coalesce(v_ra->>'error', 'unknown');
  end if;
  if coalesce((v_ra->>'tab_closed')::boolean, false) is not true then
    raise exception 'BEHAVIOR A FAILED: tab_closed not reported';
  end if;
  select count(*) into v_n from public.pos_orders
   where lodge_id = v_lodge and tab_id = v_tab1 and status in ('completed', 'settled');
  if v_n <> 1 then raise exception 'BEHAVIOR A FAILED: expected 1 linked order, found %', v_n; end if;
  select status, tab_version into v_status, v_version from public.pos_tabs where id = v_tab1;
  if v_status <> 'closed' or v_version <> 2 then
    raise exception 'BEHAVIOR A FAILED: tab not closed/versioned (status=%, version=%)', v_status, v_version;
  end if;
  raise notice 'BEHAVIOR A OK: settle-by-id records the order and closes the tab atomically';

  -- ── Case B: exact retry returns the identical receipt, creates nothing ──
  -- Claim-first replay short-circuits before version validation, but the
  -- payload carries the version like a real client retry.
  v_rb := public.create_pos_order_v3(v_base || jsonb_build_object(
    'id', v_o1, 'submit_intent_id', v_o1, 'create_idempotency_key', 'r0002-first',
    'table_name', 'R2T1', 'tab_name', 'R2T1', 'tab_id', v_tab1, 'expected_tab_version', 1));
  if v_rb::text is distinct from v_ra::text then
    raise exception 'BEHAVIOR B FAILED: retry did not return the identical receipt';
  end if;
  select count(*) into v_n from public.pos_orders
   where lodge_id = v_lodge and tab_id = v_tab1 and status in ('completed', 'settled');
  if v_n <> 1 then raise exception 'BEHAVIOR B FAILED: retry created a second order'; end if;
  select tab_version into v_version from public.pos_tabs where id = v_tab1;
  if v_version <> 2 then raise exception 'BEHAVIOR B FAILED: retry re-closed the tab'; end if;
  raise notice 'BEHAVIOR B OK: exact retry replays the stored receipt with no new records';

  -- ── Case C: second new operation against the settled tab is rejected ──
  -- Case A closed T1 at version 2, so the fresh attempt presents version 2
  -- to reach the settled-tab gate (a stale version would fail earlier with
  -- tab_version_conflict instead of the expected tab_already_settled).
  v_rc := public.create_pos_order_v3(v_base || jsonb_build_object(
    'id', v_o2, 'submit_intent_id', v_o2, 'create_idempotency_key', 'r0002-second',
    'table_name', 'R2T1', 'tab_name', 'R2T1', 'tab_id', v_tab1, 'expected_tab_version', 2));
  if coalesce((v_rc->>'success')::boolean, true) is not false
     or coalesce(v_rc->>'code', '') <> 'tab_already_settled' then
    raise exception 'BEHAVIOR C FAILED: second settlement not rejected: %', left(v_rc::text, 200);
  end if;
  select count(*) into v_n from public.pos_orders
   where lodge_id = v_lodge and tab_id = v_tab1 and status in ('completed', 'settled');
  if v_n <> 1 then raise exception 'BEHAVIOR C FAILED: rejected settlement recorded an order'; end if;
  raise notice 'BEHAVIOR C OK: second settlement rejected, no duplicate payment';

  -- ── Case D: stale expected version records nothing; correct version settles ──
  v_rd := public.create_pos_order_v3(v_base || jsonb_build_object(
    'id', v_o3, 'submit_intent_id', v_o3, 'create_idempotency_key', 'r0002-stale',
    'table_name', 'R2T2', 'tab_name', 'R2T2', 'tab_id', v_tab2, 'expected_tab_version', 999));
  if coalesce((v_rd->>'success')::boolean, true) is not false
     or coalesce(v_rd->>'code', '') <> 'tab_version_conflict' then
    raise exception 'BEHAVIOR D FAILED: stale version not rejected: %', left(v_rd::text, 200);
  end if;
  select count(*) into v_n from public.pos_orders where lodge_id = v_lodge and tab_id = v_tab2;
  if v_n <> 0 then raise exception 'BEHAVIOR D FAILED: stale version recorded an order'; end if;
  v_re := public.create_pos_order_v3(v_base || jsonb_build_object(
    'id', v_o3, 'submit_intent_id', v_o3, 'create_idempotency_key', 'r0002-stale-retry',
    'table_name', 'R2T2', 'tab_name', 'R2T2', 'tab_id', v_tab2, 'expected_tab_version', 1));
  if coalesce((v_re->>'success')::boolean, false) is not true
     or coalesce((v_re->>'tab_closed')::boolean, false) is not true then
    raise exception 'BEHAVIOR D FAILED: correct version did not settle: %', left(v_re::text, 200);
  end if;
  raise notice 'BEHAVIOR D OK: stale version blocked with no effects; correct version settles';

  raise notice 'BEHAVIOR OK: all R-0002 recovery cases pass';
end
$behavior$;

rollback;
