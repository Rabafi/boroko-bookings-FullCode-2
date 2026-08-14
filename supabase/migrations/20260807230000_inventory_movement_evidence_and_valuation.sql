-- Inventory truth evidence: every new stock event carries a durable source,
-- operation identity, and the cost basis used at the time of the mutation.
-- Legacy rows are marked unknown_legacy rather than being reconstructed from
-- today's item cost.

begin;

alter table public.inventory_movements
  add column if not exists operation_id uuid,
  add column if not exists payload_hash text,
  add column if not exists source_document_type text,
  add column if not exists source_document_id uuid,
  add column if not exists lot_id uuid,
  add column if not exists valuation_method text,
  add column if not exists quantity_before numeric,
  add column if not exists quantity_after numeric,
  add column if not exists cost_basis numeric,
  add column if not exists recorded_at timestamptz;

alter table public.inventory_purchases
  add column if not exists operation_id uuid,
  add column if not exists payload_hash text,
  add column if not exists source_document_type text,
  add column if not exists source_document_id uuid,
  add column if not exists lot_id uuid,
  add column if not exists valuation_method text,
  add column if not exists evidence_ref text;

alter table public.stock_movements
  add column if not exists operation_id uuid,
  add column if not exists payload_hash text,
  add column if not exists source_document_type text,
  add column if not exists source_document_id uuid,
  add column if not exists valuation_method text,
  add column if not exists cost_basis numeric;

-- Backfill identity and source links only. Do not use current inventory cost to
-- manufacture historical valuation evidence.
update public.inventory_movements
   set operation_id = coalesce(operation_id, id),
       source_document_type = coalesce(source_document_type, reference_type, 'legacy_inventory_movement'),
       source_document_id = coalesce(source_document_id, reference_id),
       valuation_method = coalesce(valuation_method, 'unknown_legacy'),
       cost_basis = coalesce(cost_basis, abs(coalesce(total_cost, 0))),
       recorded_at = coalesce(recorded_at, created_at, now()),
       payload_hash = coalesce(payload_hash, encode(digest(jsonb_build_object(
         'id', id, 'lodge_id', lodge_id, 'item_id', item_id,
         'movement_type', movement_type, 'quantity', quantity,
         'unit_cost', unit_cost, 'total_cost', total_cost,
         'reference_type', reference_type, 'reference_id', reference_id,
         'created_at', created_at
       )::text, 'sha256'), 'hex'))
 where operation_id is null
    or source_document_type is null
    or valuation_method is null
    or cost_basis is null
    or recorded_at is null
    or payload_hash is null;

update public.inventory_purchases
   set operation_id = coalesce(operation_id, id),
       source_document_type = coalesce(source_document_type, 'inventory_purchase'),
       source_document_id = coalesce(source_document_id, id),
       valuation_method = coalesce(valuation_method, 'unknown_legacy'),
       payload_hash = coalesce(payload_hash, encode(digest(jsonb_build_object(
         'id', id, 'lodge_id', lodge_id, 'item_id', item_id, 'date', date,
         'quantity_purchased', quantity_purchased, 'unit_cost', unit_cost,
         'total_cost', total_cost, 'notes', notes
       )::text, 'sha256'), 'hex'))
 where operation_id is null
    or source_document_type is null
    or valuation_method is null
    or payload_hash is null;

update public.stock_movements
   set operation_id = coalesce(operation_id, id),
       source_document_type = coalesce(source_document_type, 'stock_transfer'),
       source_document_id = coalesce(source_document_id, id),
       valuation_method = coalesce(valuation_method, 'unknown_legacy'),
       cost_basis = coalesce(cost_basis, abs(coalesce(quantity, 0))),
       payload_hash = coalesce(payload_hash, encode(digest(jsonb_build_object(
         'id', id, 'lodge_id', lodge_id, 'inventory_item_id', inventory_item_id,
         'movement_type', movement_type, 'quantity', quantity,
         'from_outlet_id', from_outlet_id, 'to_outlet_id', to_outlet_id,
         'created_at', created_at
       )::text, 'sha256'), 'hex'))
 where operation_id is null
    or source_document_type is null
    or valuation_method is null
    or cost_basis is null
    or payload_hash is null;

create index if not exists inventory_movements_source_document_idx
  on public.inventory_movements (lodge_id, source_document_type, source_document_id, created_at desc);
create index if not exists inventory_movements_operation_idx
  on public.inventory_movements (lodge_id, operation_id, created_at desc);
create unique index if not exists inventory_purchases_operation_uidx
  on public.inventory_purchases (lodge_id, operation_id)
  where operation_id is not null;
create index if not exists stock_movements_source_document_idx
  on public.stock_movements (lodge_id, source_document_type, source_document_id, created_at desc);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_movements_valuation_method_chk') then
    alter table public.inventory_movements add constraint inventory_movements_valuation_method_chk
      check (valuation_method in ('moving_average', 'weighted_average', 'fifo', 'manual_count', 'standard_cost', 'unknown_legacy'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_movements_valuation_method_chk') then
    alter table public.stock_movements add constraint stock_movements_valuation_method_chk
      check (valuation_method in ('moving_average', 'weighted_average', 'fifo', 'manual_count', 'standard_cost', 'unknown_legacy'));
  end if;
end
$$;

create or replace function public._restaurant_inventory_movement_evidence_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.operation_id := coalesce(new.operation_id, new.id);
  new.source_document_type := coalesce(nullif(btrim(new.source_document_type), ''), nullif(btrim(new.reference_type), ''), 'legacy_inventory_movement');
  new.source_document_id := coalesce(new.source_document_id, new.reference_id);
  if new.reference_type = 'restaurant_inventory_lot' then
    new.lot_id := coalesce(new.lot_id, new.reference_id);
  end if;
  new.valuation_method := coalesce(new.valuation_method, 'moving_average');
  new.cost_basis := coalesce(new.cost_basis, abs(coalesce(new.total_cost, 0)));
  new.recorded_at := coalesce(new.recorded_at, new.created_at, now());
  new.payload_hash := coalesce(new.payload_hash, encode(digest(jsonb_build_object(
    'id', new.id, 'lodge_id', new.lodge_id, 'item_id', new.item_id,
    'movement_type', new.movement_type, 'quantity', new.quantity,
    'unit_cost', new.unit_cost, 'total_cost', new.total_cost,
    'reference_type', new.reference_type, 'reference_id', new.reference_id,
    'source_document_type', new.source_document_type,
    'source_document_id', new.source_document_id, 'valuation_method', new.valuation_method
  )::text, 'sha256'), 'hex'));
  return new;
end
$$;

drop trigger if exists restaurant_inventory_movement_evidence_defaults on public.inventory_movements;
create trigger restaurant_inventory_movement_evidence_defaults
before insert or update of reference_type, reference_id, quantity, unit_cost, total_cost
on public.inventory_movements
for each row execute function public._restaurant_inventory_movement_evidence_defaults();

create or replace function public._restaurant_inventory_purchase_evidence_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.operation_id := coalesce(new.operation_id, new.id);
  new.source_document_type := coalesce(nullif(btrim(new.source_document_type), ''), 'inventory_purchase');
  new.source_document_id := coalesce(new.source_document_id, new.id);
  new.valuation_method := coalesce(new.valuation_method, 'weighted_average');
  new.payload_hash := coalesce(new.payload_hash, encode(digest(jsonb_build_object(
    'id', new.id, 'lodge_id', new.lodge_id, 'item_id', new.item_id,
    'date', new.date, 'quantity_purchased', new.quantity_purchased,
    'unit_cost', new.unit_cost, 'total_cost', new.total_cost, 'notes', new.notes
  )::text, 'sha256'), 'hex'));
  return new;
end
$$;

drop trigger if exists restaurant_inventory_purchase_evidence_defaults on public.inventory_purchases;
create trigger restaurant_inventory_purchase_evidence_defaults
before insert or update of date, quantity_purchased, unit_cost, total_cost, notes
on public.inventory_purchases
for each row execute function public._restaurant_inventory_purchase_evidence_defaults();

create or replace function public._restaurant_stock_transfer_evidence_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.operation_id := coalesce(new.operation_id, new.id);
  new.source_document_type := coalesce(nullif(btrim(new.source_document_type), ''), 'stock_transfer');
  new.source_document_id := coalesce(new.source_document_id, new.id);
  new.valuation_method := coalesce(new.valuation_method, 'moving_average');
  new.cost_basis := coalesce(new.cost_basis, abs(coalesce(new.quantity, 0)));
  new.payload_hash := coalesce(new.payload_hash, encode(digest(jsonb_build_object(
    'id', new.id, 'lodge_id', new.lodge_id, 'inventory_item_id', new.inventory_item_id,
    'movement_type', new.movement_type, 'quantity', new.quantity,
    'from_outlet_id', new.from_outlet_id, 'to_outlet_id', new.to_outlet_id,
    'reference', new.reference, 'created_at', new.created_at
  )::text, 'sha256'), 'hex'));
  return new;
end
$$;

drop trigger if exists restaurant_stock_transfer_evidence_defaults on public.stock_movements;
create trigger restaurant_stock_transfer_evidence_defaults
before insert or update of movement_type, quantity, from_outlet_id, to_outlet_id
on public.stock_movements
for each row execute function public._restaurant_stock_transfer_evidence_defaults();

create or replace function public.get_inventory_financial_coverage(
  p_lodge_id uuid,
  p_start_date date default null,
  p_end_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.app_current_user_id();
  v_movements integer;
  v_purchases integer;
  v_transfers integer;
  v_legacy integer;
  v_missing integer;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  select count(*) into v_movements
    from public.inventory_movements m
   where m.lodge_id = p_lodge_id
     and (p_start_date is null or m.recorded_at::date >= p_start_date)
     and (p_end_date is null or m.recorded_at::date <= p_end_date);
  select count(*) into v_purchases
    from public.inventory_purchases p
   where p.lodge_id = p_lodge_id
     and (p_start_date is null or p.date >= p_start_date)
     and (p_end_date is null or p.date <= p_end_date);
  select count(*) into v_transfers
    from public.stock_movements s
   where s.lodge_id = p_lodge_id
     and (p_start_date is null or s.created_at::date >= p_start_date)
     and (p_end_date is null or s.created_at::date <= p_end_date);
  select count(*) into v_legacy
    from public.inventory_movements m
   where m.lodge_id = p_lodge_id
     and m.valuation_method = 'unknown_legacy'
     and (p_start_date is null or m.recorded_at::date >= p_start_date)
     and (p_end_date is null or m.recorded_at::date <= p_end_date);
  select count(*) into v_missing
    from public.inventory_movements m
   where m.lodge_id = p_lodge_id
     and (m.operation_id is null or m.source_document_type is null or m.payload_hash is null)
     and (p_start_date is null or m.recorded_at::date >= p_start_date)
     and (p_end_date is null or m.recorded_at::date <= p_end_date);
  return jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'movement_count', v_movements,
      'purchase_count', v_purchases,
      'transfer_count', v_transfers,
      'legacy_valuation_count', v_legacy,
      'missing_evidence_count', v_missing,
      'complete', v_legacy = 0 and v_missing = 0,
      'actor_id', v_actor
    )
  );
end
$$;

revoke all on function public._restaurant_inventory_movement_evidence_defaults() from public, anon, authenticated;
revoke all on function public._restaurant_inventory_purchase_evidence_defaults() from public, anon, authenticated;
revoke all on function public._restaurant_stock_transfer_evidence_defaults() from public, anon, authenticated;
revoke all on function public.get_inventory_financial_coverage(uuid, date, date) from public, anon;
grant execute on function public.get_inventory_financial_coverage(uuid, date, date) to authenticated, service_role;

commit;
