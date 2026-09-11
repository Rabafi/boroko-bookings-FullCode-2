-- Behavioral acceptance for atomic product/stock saves and modifier
-- enforcement (migrations 20260909000000..20260909030000).
--
-- Run:  node tests/run-bar-product-sql.mjs
--       (requires BAR_PRODUCT_TEST_DB_URL; otherwise the runner skips)
-- Or:   psql "$CONNECTION" -v ON_ERROR_STOP=1 -f tests/bar-product-atomic.sql
--
-- Everything mutating runs inside one transaction that is always rolled
-- back, so no fixture survives. Fixtures use a scratch lodge UUID with no
-- foreign-key parents: the touched tables scope by lodge_id without
-- requiring settings/outlet/user rows. Each case reports PASS/FAIL via
-- NOTICE; any failure raises at the end.
--
-- Cases:
--  M1-M10 save_bar_product_with_stock introspection (installed, locks,
--          versions, pack skip, auto-row cleanup, opening audit, outlet
--          auth, publication jobs).
--  T1-T10 modifier triggers on pos_order_items and pos_tabs (valid,
--          missing, null/forged, reversals, unrelated category, changed
--          requirements, tab valid/missing/malformed).
--  P1-P5  publication claim/complete/fail contracts (installed, newest
--          pending or expired claim, token plus live lease, supersession,
--          permanent failure).

begin;

do $bar_product_acceptance$
declare
  v_lodge uuid := '11111111-1111-4111-8111-111111111111';
  v_definition text;
  v_order_id uuid;
  v_failures text[] := '{}';
  v_case_ok boolean;
begin
  -- ============ M: atomic save introspection ============
  select pg_get_functiondef('public.save_bar_product_with_stock(jsonb)'::regprocedure) into v_definition;
  if v_definition is null then
    raise exception 'ACCEPTANCE FAILED: save_bar_product_with_stock(jsonb) is not installed';
  end if;
  if position('bar-catalog:' in v_definition) = 0 then v_failures := v_failures || 'M2 advisory lock per key'; end if;
  if position('requires its loaded version' in v_definition) = 0 then v_failures := v_failures || 'M3 versions mandatory'; end if;
  if position('for update;' in v_definition) = 0 then v_failures := v_failures || 'M4 locked version reads'; end if;
  if position('v_pack_exists' in v_definition) = 0 then v_failures := v_failures || 'M5 pack skip'; end if;
  if position('created_at >= v_txn_start' in v_definition) = 0 then v_failures := v_failures || 'M6 auto-row cleanup scoped to txn'; end if;
  if position('''opening_stock''' in v_definition) = 0 then v_failures := v_failures || 'M7 opening audit'; end if;
  if position('app_require_pos_outlet_access' in v_definition) = 0 then v_failures := v_failures || 'M8 outlet auth'; end if;
  if position('catalog_publication_jobs' in v_definition) = 0 then v_failures := v_failures || 'M9 publication jobs in txn'; end if;
  if position('outlet_ids' in v_definition) = 0 then v_failures := v_failures || 'M10 outlet ids returned'; end if;
  raise notice 'M1-M10 introspection done (% failure(s))', coalesce(array_length(v_failures, 1), 0);

  -- ============ T: modifier trigger fixtures ============
  insert into public.pos_modifier_groups (id, lodge_id, name, applies_to_categories, min_selections, max_selections, options, active)
  values ('22222222-2222-4222-8222-222222222222', v_lodge, 'Steak temperature', array['Mains'], 1, 1,
          '[{"id":"o-rare","name":"Rare"},{"id":"o-well","name":"Well done"}]'::jsonb, true);
  v_order_id := gen_random_uuid();
  insert into public.pos_orders (id, lodge_id, total) values (v_order_id, v_lodge, 0);

  -- T1 valid selection inserts.
  v_case_ok := true;
  begin
    insert into public.pos_order_items (lodge_id, order_id, item_name, quantity, unit_price, subtotal, category, modifiers)
    values (v_lodge, v_order_id, 'Steak', 1, 100, 100, 'Mains', '[{"id":"o-rare","group_id":"22222222-2222-4222-8222-222222222222"}]'::jsonb);
  exception when others then v_case_ok := false;
  end;
  if not v_case_ok then v_failures := v_failures || 'T1 valid selection inserts'; end if;

  -- T2 missing required choice raises.
  v_case_ok := false;
  begin
    insert into public.pos_order_items (lodge_id, order_id, item_name, quantity, unit_price, subtotal, category, modifiers)
    values (v_lodge, v_order_id, 'Steak', 1, 100, 100, 'Mains', '[]'::jsonb);
  exception when others then
    if SQLERRM like 'Complete required choices:%' then v_case_ok := true; end if;
  end;
  if not v_case_ok then v_failures := v_failures || 'T2 missing choice raises'; end if;

  -- T3 JSON-null modifiers rejected by the trigger (the column accepts a
  -- JSON null value, so only the trigger can refuse it).
  v_case_ok := false;
  begin
    insert into public.pos_order_items (lodge_id, order_id, item_name, quantity, unit_price, subtotal, category, modifiers)
    values (v_lodge, v_order_id, 'Steak', 1, 100, 100, 'Mains', 'null'::jsonb);
  exception when others then
    if SQLERRM like '%must be a JSON array%' then v_case_ok := true; end if;
  end;
  if not v_case_ok then v_failures := v_failures || 'T3 null modifiers rejected'; end if;

  -- T4 forged option id rejected.
  v_case_ok := false;
  begin
    insert into public.pos_order_items (lodge_id, order_id, item_name, quantity, unit_price, subtotal, category, modifiers)
    values (v_lodge, v_order_id, 'Steak', 1, 100, 100, 'Mains', '[{"id":"o-forged"}]'::jsonb);
  exception when others then
    if SQLERRM like 'Complete required choices:%' then v_case_ok := true; end if;
  end;
  if not v_case_ok then v_failures := v_failures || 'T4 forged option rejected'; end if;

  -- T5 reversal rows pass without modifiers.
  v_case_ok := true;
  begin
    insert into public.pos_order_items (lodge_id, order_id, item_name, quantity, unit_price, subtotal, category, modifiers)
    values (v_lodge, v_order_id, 'Return: Steak', -1, 100, -100, 'Mains', '[]'::jsonb);
  exception when others then v_case_ok := false;
  end;
  if not v_case_ok then v_failures := v_failures || 'T5 reversal exempt'; end if;

  -- T6 unrelated category passes without selections.
  v_case_ok := true;
  begin
    insert into public.pos_order_items (lodge_id, order_id, item_name, quantity, unit_price, subtotal, category, modifiers)
    values (v_lodge, v_order_id, 'Beer', 2, 30, 60, 'Beer', '[]'::jsonb);
  exception when others then v_case_ok := false;
  end;
  if not v_case_ok then v_failures := v_failures || 'T6 unrelated category passes'; end if;

  -- T7 changed requirements block new sales afterwards.
  update public.pos_modifier_groups set min_selections = 2 where id = '22222222-2222-4222-8222-222222222222';
  v_case_ok := false;
  begin
    insert into public.pos_order_items (lodge_id, order_id, item_name, quantity, unit_price, subtotal, category, modifiers)
    values (v_lodge, v_order_id, 'Steak', 1, 100, 100, 'Mains', '[{"id":"o-rare","group_id":"22222222-2222-4222-8222-222222222222"}]'::jsonb);
  exception when others then
    if SQLERRM like 'Complete required choices:%' then v_case_ok := true; end if;
  end;
  if not v_case_ok then v_failures := v_failures || 'T7 raised minimum blocks'; end if;
  update public.pos_modifier_groups set min_selections = 1 where id = '22222222-2222-4222-8222-222222222222';

  -- T8 held-tab insert with valid selections succeeds.
  v_case_ok := true;
  begin
    insert into public.pos_tabs (lodge_id, tab_name, waiter_name, items, status)
    values (v_lodge, 'T8', 'Op', '[{"item_name":"Steak","category":"Mains","quantity":1,"modifiers":[{"id":"o-rare","group_id":"22222222-2222-4222-8222-222222222222"}]}]'::jsonb, 'open');
  exception when others then v_case_ok := false;
  end;
  if not v_case_ok then v_failures := v_failures || 'T8 tab hold valid succeeds'; end if;

  -- T9 held-tab insert missing choices raises.
  v_case_ok := false;
  begin
    insert into public.pos_tabs (lodge_id, tab_name, waiter_name, items, status)
    values (v_lodge, 'T9', 'Op', '[{"item_name":"Steak","category":"Mains","quantity":1,"modifiers":[]}]'::jsonb, 'open');
  exception when others then
    if SQLERRM like 'Complete required choices:%' then v_case_ok := true; end if;
  end;
  if not v_case_ok then v_failures := v_failures || 'T9 tab hold missing raises'; end if;

  -- T10 malformed tab rows rejected.
  v_case_ok := false;
  begin
    insert into public.pos_tabs (lodge_id, tab_name, waiter_name, items, status)
    values (v_lodge, 'T10', 'Op', '{"not":"an-array"}'::jsonb, 'open');
  exception when others then
    if SQLERRM like '%must be a JSON array%' then v_case_ok := true; end if;
  end;
  if not v_case_ok then v_failures := v_failures || 'T10 malformed tab rejected'; end if;

  -- ============ P: publication contracts ============
  select pg_get_functiondef('public.claim_catalog_publication_job(uuid,uuid,integer)'::regprocedure) into v_definition;
  if v_definition is null then v_failures := v_failures || 'P1 claim installed';
  else
    if position('lease_expires_at < now()' in v_definition) = 0 or position('order by version desc' in v_definition) = 0 then
      v_failures := v_failures || 'P2 claim newest pending or expired';
    end if;
  end if;
  select pg_get_functiondef('public.complete_catalog_publication_job(uuid,uuid)'::regprocedure) into v_definition;
  if v_definition is null then v_failures := v_failures || 'P3 complete installed';
  else
    if position('claim_token=p_claim_token' in v_definition) = 0 or position('lease_expires_at > now()' in v_definition) = 0 then
      v_failures := v_failures || 'P3 complete needs token plus live lease';
    end if;
    if position('superseded' in v_definition) = 0 then v_failures := v_failures || 'P4 supersede reported'; end if;
  end if;
  select pg_get_functiondef('public.fail_catalog_publication_job(uuid,uuid,text,boolean)'::regprocedure) into v_definition;
  if v_definition is null or position('p_permanent' in v_definition) = 0 then
    v_failures := v_failures || 'P5 permanent failure path';
  end if;

  if coalesce(array_length(v_failures, 1), 0) > 0 then
    raise exception 'ACCEPTANCE FAILED: %', array_to_string(v_failures, '; ');
  end if;
  raise notice 'BAR PRODUCT ACCEPTANCE: all cases passed';
end $bar_product_acceptance$;

rollback;
