\set ON_ERROR_STOP on

begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into public.settings (lodge_id, lodge_name, vat_enabled, vat_rate)
values ('10000000-0000-4000-8000-000000000001', 'POS Contract Test', true, 10);

insert into public.users (
  id, lodge_id, name, email, role, password_hash, pin_hash, status
) values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Test Manager', 'pos-test@example.com', 'manager', 'unused',
  extensions.crypt('1234', extensions.gen_salt('bf')), 'active'
);

insert into public.outlets (id, lodge_id, name, type)
values (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Test Bar', 'beverage'
);

insert into public.inventory_items (
  id, lodge_id, outlet_id, name, category, unit, current_stock
) values (
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'Test Stock', 'Bar', 'unit', 10
);

insert into public.pos_menu_items (
  id, lodge_id, outlet_id, name, category, price,
  inventory_item_id, depletion_qty, is_available
) values (
  '50000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'Test Drink', 'Drinks', 10,
  '40000000-0000-4000-8000-000000000001', 1, true
);

insert into public.pos_modifier_groups (
  id, lodge_id, name, applies_to_categories, options, active
) values (
  '60000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Size', array['Drinks'],
  '[{"id":"70000000-0000-4000-8000-000000000001","name":"Large","price_delta":2}]',
  true
);

insert into public.pos_shifts (
  id, lodge_id, outlet_id, cashier_id, cashier_name, opening_float, status
) values (
  '80000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'Test Manager', 100, 'open'
);

select public.publish_pos_catalog_snapshot(
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001'
) as published \gset
select now() as client_at \gset

select public.create_pos_order_v3(jsonb_build_object(
  'id', '90000000-0000-4000-8000-000000000001',
  'lodge_id', '10000000-0000-4000-8000-000000000001',
  'outlet_id', '30000000-0000-4000-8000-000000000001',
  'shift_id', '80000000-0000-4000-8000-000000000001',
  'catalog_snapshot_id', (:'published'::jsonb)->>'snapshot_id',
  'source_device_id', 'integration-test',
  'client_created_at', :'client_at',
  'create_idempotency_key', 'integration-order-1',
  'payment_method', 'cash',
  'payment_breakdown', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 26.40)),
  'items', jsonb_build_array(jsonb_build_object(
    'menu_item_id', '50000000-0000-4000-8000-000000000001',
    'quantity', 2,
    'unit_price', 0.01,
    'modifier_option_ids', jsonb_build_array('70000000-0000-4000-8000-000000000001')
  ))
)) as order_result \gset

select 1 / (
  round((:'order_result'::jsonb->>'total')::numeric, 2) = 26.40
  and (select current_stock from public.inventory_items where id = '40000000-0000-4000-8000-000000000001') = 8
)::integer as order_assertions;

select public.create_pos_order_v3(jsonb_build_object(
  'id', '90000000-0000-4000-8000-000000000001',
  'lodge_id', '10000000-0000-4000-8000-000000000001',
  'outlet_id', '30000000-0000-4000-8000-000000000001',
  'shift_id', '80000000-0000-4000-8000-000000000001',
  'catalog_snapshot_id', (:'published'::jsonb)->>'snapshot_id',
  'source_device_id', 'integration-test',
  'client_created_at', :'client_at',
  'create_idempotency_key', 'integration-order-1',
  'payment_method', 'cash',
  'payment_breakdown', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 26.40)),
  'items', jsonb_build_array(jsonb_build_object(
    'menu_item_id', '50000000-0000-4000-8000-000000000001',
    'quantity', 2,
    'unit_price', 0.01,
    'modifier_option_ids', jsonb_build_array('70000000-0000-4000-8000-000000000001')
  ))
)) as replay_result \gset

select 1 / (
  (:'replay_result'::jsonb->>'id')::uuid = '90000000-0000-4000-8000-000000000001'
  and (select current_stock from public.inventory_items where id = '40000000-0000-4000-8000-000000000001') = 8
)::integer as idempotency_assertions;

select id as original_line_id
from public.pos_order_items
where order_id = '90000000-0000-4000-8000-000000000001'
\gset

select public.create_pos_return_v3(jsonb_build_object(
  'order_id', '90000000-0000-4000-8000-000000000001',
  'return_order_id', '90000000-0000-4000-8000-000000000002',
  'lodge_id', '10000000-0000-4000-8000-000000000001',
  'shift_id', '80000000-0000-4000-8000-000000000001',
  'approval_pin', '1234',
  'device_id', 'integration-test',
  'reason', 'Integration partial return',
  'return_idempotency_key', 'integration-return-1',
  'lines', jsonb_build_array(jsonb_build_object(
    'line_id', :'original_line_id',
    'quantity', 1
  ))
)) as return_result \gset

select 1 / (
  round(abs((:'return_result'::jsonb->>'total')::numeric), 2) = 13.20
  and (select current_stock from public.inventory_items where id = '40000000-0000-4000-8000-000000000001') = 9
)::integer as return_assertions;

select public.get_pos_shift_cashup_preview_v2(
  '80000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
) as preview \gset

select 1 / (
  round((:'preview'::jsonb->>'expected_cash_drawer')::numeric, 2) = 113.20
)::integer as preview_assertions;

select public.finalize_pos_shift_cashup_v2(jsonb_build_object(
  'lodge_id', '10000000-0000-4000-8000-000000000001',
  'shift_id', '80000000-0000-4000-8000-000000000001',
  'cashup_id', 'a0000000-0000-4000-8000-000000000001',
  'idempotency_key', 'integration-cashup-1',
  'counted_by_method', jsonb_build_object('cash', 113.20),
  'notes', 'Integration cash-up'
)) as cashup_result \gset

select 1 / (
  round(((:'cashup_result'::jsonb->'variance_by_method')->>'cash')::numeric, 2) = 0
  and (select status from public.pos_shifts where id = '80000000-0000-4000-8000-000000000001') = 'closed'
)::integer as cashup_assertions;

rollback;
